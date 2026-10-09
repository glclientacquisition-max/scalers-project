// server.js
// Phase 2: SautiKit voice webhook + media WebSocket stub.
// Persistence: Supabase (calls, transcripts, call-recordings Storage).
// Twilio has been removed from the telephony path.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const { GoogleGenAI } = require('@google/genai');
const {
  createSonioxSttSession,
  isSonioxConfigured,
  buildSttContext,
} = require('./src/speech/sonioxStt');
const {
  createSonioxTtsSession,
  isSonioxTtsConfigured,
} = require('./src/speech/sonioxTts');
const {
  resolveVoiceProfile,
  fillerLanguage,
  publicVoiceProfile,
  speedForLanguage,
} = require('./src/speech/voiceProfile');
const {
  detectSpeedRequest,
  nextSpeedScale,
} = require('./src/speech/speedControl');
const { applyPcmGain } = require('./src/speech/pcmUtil');
const {
  isFillerCacheEnabled,
  lookupFillerPcm,
  putFillerPcm,
  isCancelableTtsStreamId,
  newCachedFillerStreamId,
  warmFillerAckPcm,
} = require('./src/speech/fillerPcmCache');
const {
  isGreetingCacheEnabled,
  lookupGreetingPcm,
  putGreetingPcm,
} = require('./src/speech/greetingPcmCache');
const { mergeIdentityLexicon } = require('./src/speech/pronunciationLexicon');
const { classifySonioxError } = require('./src/speech/sonioxErrors');
const { getSonioxProviderHealth } = require('./src/speech/sonioxProviderHealth');
const {
  pickSpeechOutageLine,
  synthesizeEmergencyPcm,
  pcmDurationMs,
} = require('./src/speech/emergencyTts');
const {
  scheduleOutageClipWarm,
  warmOutageClips,
  loadOutageClip,
  getOutageClipStatus,
} = require('./src/speech/outageClips');
const { noteSpeechOutage } = require('./src/speech/speechOutageNotify');
const {
  resolveSonioxVoice,
  ttsVoiceNeedsSwap,
  ensureSonioxVoiceReady,
  listCuratedVoices,
  refreshCuratedVoicesFromDb,
} = require('./src/speech/sonioxVoice');
const { synthesizeTtsPreview } = require('./src/speech/ttsPreview');
const { writeWavResponse } = require('./src/speech/wavPack');
const {
  buildSystemPrompt,
  buildGreeting,
  VOICE_SYSTEM_PROMPT_ID,
  VOICE_SYSTEM_PROMPT_VERSION,
} = require('./src/prompts');
const { createVoiceTrace } = require('./src/speech/voiceTrace');
const voiceTraceBySid = new Map();

function bindVoiceTrace(callSid, trace) {
  if (!callSid || !trace) return;
  voiceTraceBySid.set(String(callSid), trace);
}

function forgetVoiceTrace(callSid) {
  if (callSid) voiceTraceBySid.delete(String(callSid));
}

const TOOL_ARG_KEYS = ['name', 'reason', 'type', 'item', 'serviceName', 'whenText', 'quantity'];
const TRACE_TOOL_FIELDS = [
  ['serviceRequest', 'create_service_request'],
  ['appointment', 'create_appointment'],
  ['appointmentUpdate', 'update_appointment'],
  ['escalate', 'escalate'],
  ['openItems', 'open_items'],
  ['fileLookup', 'file_lookup'],
  ['getEnquiry', 'get_enquiry'],
];

function summarizeToolArgs(value) {
  if (!value || typeof value !== 'object') return '';
  const parts = [];
  for (const key of TOOL_ARG_KEYS) {
    if (value[key] == null || value[key] === '') continue;
    parts.push(`${key}=${String(value[key]).replace(/\s+/g, ' ').slice(0, 80)}`);
  }
  return parts.join(' ');
}

function noteTracedGeminiTools(callSid, before, after, results) {
  const trace = voiceTraceBySid.get(String(callSid || ''));
  if (!trace || typeof trace.noteTool !== 'function') return;
  const seen = new Set();
  for (const result of results || []) {
    const name = String(result?.action || '');
    if (!name || name === 'tool_request') continue;
    seen.add(name);
    const argsSource = result.value && typeof result.value === 'object' ? result.value : result;
    trace.noteTool({
      name,
      status: result.status || null,
      args: summarizeToolArgs(argsSource),
    });
  }
  if (after?.consentBlocked || after?.needsVisitTime) {
    const status = after.consentBlocked ? 'consent_blocked' : 'needs_visit_time';
    for (const [field, name] of TRACE_TOOL_FIELDS) {
      if (!before?.[field] || seen.has(name)) continue;
      trace.noteTool({
        name,
        status,
        args: summarizeToolArgs(before[field]),
      });
    }
  }
}
const { openClosedStatus } = require('./src/conversation/businessHours');
const { bulletinClosureNotice } = require('./src/conversation/dailyBulletin');
const { parseAgentTools } = require('./src/conversation/agentTools');
const { parseGeminiResponse } = require('./src/conversation/toolMarkers');
const {
  createBrainState,
  inferIntent,
  observeCallerTurn,
  setNextBestAction,
  recordActionResults,
  formatBrainStateForPrompt,
} = require('./src/conversation/brainState');
const {
  attachCallerMemory,
  liveCallerFileStamp,
} = require('./src/conversation/callerMemory');
const {
  formatNameConfirmSpeech,
  looksLikeHistoryReview,
  looksLikeOpenVisitLookup,
  looksLikeVisitReviewMore,
  openLineHoldDecision,
  planVisitReadTurn,
  shouldPublishOpenFileSentence,
} = require('./src/conversation/openLineSpeech');
const { extractConversationEntities } = require('./src/conversation/entityExtraction');
const { collectKnownCallerNames } = require('./src/conversation/callerNameMatch');
const {
  buildBrainCapabilities,
  formatAuthorityPolicy,
} = require('./src/conversation/brainPolicy');
const {
  applyMessageOnlyCapabilities,
  messageFileOwnerName,
  heldMessageCallerName,
} = require('./src/conversation/messageOnly');
const { determineNextBestAction } = require('./src/conversation/nextBestAction');
const { logBrainTrace } = require('./src/conversation/brainObservability');
const {
  executeBrainTools,
  formatToolConfirmation,
} = require('./src/conversation/toolExecution');
const { deriveCallResolution } = require('./src/conversation/callResolution');
const { deriveCallSummary } = require('./src/conversation/callSummary');
const {
  schedulePostCallTranscriptReview,
  toolFlagsFromBrain,
  withSummaryWriteLock,
} = require('./src/conversation/callTranscriptReview');
const {
  extractGeminiText,
  extractThoughtSignature,
  extractGeminiParts,
  appendGeminiStreamParts,
  modelPartsForHistory,
  buildGeminiContents,
  geminiTurnTimeoutMs,
  withTimeout,
  isTimeoutError,
  isRetryableGeminiError,
  classifyGeminiError,
  isHardGeminiOutage,
  geminiPrimaryModel,
  geminiBackupModel,
  nextGeminiStreamAttempt,
  resolvePrefetchedStreamSpeech,
  spokenTextForToolTurn,
} = require('./src/conversation/geminiVoice');
const {
  noteGeminiProviderError,
  noteGeminiProviderOk,
  getGeminiProviderHealth,
} = require('./src/conversation/geminiProviderHealth');
const {
  getTelephonyProviderHealth,
  telephonyBillingRejectXml,
} = require('./src/sautikit/telephonyProviderHealth');
const {
  startTelephonyWalletProbe,
  probeSautikitWallet,
} = require('./src/sautikit/walletProbe');
const {
  notePlatformOpsDegrade,
  opsCooldownMs,
} = require('./src/notifications/platformOpsAlert');
const { platformOpsRecipients } = require('./src/notifications/platformOpsRecipients');
const {
  selectProductsForTurn,
  formatTargetedProductsForPrompt,
  normalizeProducts,
} = require('./src/conversation/productCatalog');
const {
  ensureRequiredEscalate,
  formatEscalateActionDirective,
} = require('./src/conversation/requiredEscalate');
const {
  ensureRequiredCreateRequest,
  formatCreateRequestDirective,
  guardToolPlan,
} = require('./src/conversation/requiredCreateRequest');

/** Per-call tool toggles (escalate / end_call) from tenants.agent_tools. */
const callAgentTools = new Map();
/** Structured semantic state and actual runtime capabilities, keyed by callSid. */
const callBrainStates = new Map();
const callBrainCapabilities = new Map();
/** Per-call tenant grounding (product catalogue) for hold/order validation. */
const callTenantProfiles = new Map();
/** First-forward hangup signals keyed by callSid (calls.summary.first_forward). */
const callFirstForward = new Map();

function patchFirstForward(callSid, patch = {}) {
  if (!callSid || !patch || typeof patch !== 'object') return;
  const prev = callFirstForward.get(callSid) || {};
  callFirstForward.set(callSid, { ...prev, ...patch });
}

async function persistFirstForwardAcceptance(callSid, durationSeconds) {
  if (!callSid) return null;
  const signals = callFirstForward.get(callSid) || {};
  const classified = classifyFirstForwardAcceptance({
    durationSeconds,
    greetingPlayed: signals.greetingPlayed,
    hasStt: signals.hasStt,
    bargedJob: signals.bargedJob,
    bargeText: signals.bargeText,
    firstCallerTurn: signals.firstCallerTurn,
    unfinished: signals.unfinished,
    weak: signals.weak,
    weakStt: signals.weakStt,
    connectToGreetingPcmMs: signals.connectToGreetingPcmMs,
  });
  try {
    await db.mergeCallSummaryMeta({
      callSid,
      patch: { first_forward: classified },
    });
    console.log(
      `[first-forward][${callSid}] bucket=${classified.bucket || 'none'} judge=${classified.judge ? 1 : 0}`
    );
  } catch (err) {
    console.warn(`[first-forward][${callSid}] persist failed:`, err?.message || err);
  }
  return classified;
}
/** SautiKit UUID call_id → Stream session SID (HD_…) for recording attach. */
const sidByProviderCallId = new Map();
const providerCallIdBySid = new Map();
const recordingFetchScheduled = new Set();
const {
  analyzeCallerLanguage,
  dominantSonioxLanguage,
  createLanguageState,
  resolveLanguageState,
  languageDirective,
} = require('./src/conversation/language');
const {
  generateDynamicGreeting,
  pickContextualAck,
  pickActionProgress,
  planEmptyGeminiSpeech,
  shouldSpeakHandoffNameAsk,
  pickLlmRecoveryLine,
  pickIdleNudgeLine,
  pickLlmRecoverySaved,
  shouldSkipCallerTurn,
  shouldSpeakThinkingAck,
  looksLikeBareCloser,
  polishSpokenReply,
  polishSpokenDetail,
  looksLikePaceOnlyTurn,
} = require('./src/conversation/dynamicSpeech');
const { resolveLocalReply, planCallerModelTurn } = require('./src/conversation/turnPolicy');
const { unfinishedTurnHold } = require('./src/conversation/unfinishedTurn');
const {
  drainSpokenSpeakSlots,
  isSpeakSlotOutcome,
} = require('./src/conversation/speakSlots');
const { narratesInternalAction, groundFilePriceLine } = require('./src/conversation/speechGuard');
const { noteSpokenPendingAsk } = require('./src/conversation/callCorrectives');
const { planLlmRecovery } = require('./src/conversation/llmRecovery');
const { prepareForTts } = require('./src/speech/ttsNormalize');
const {
  catalogueGeminiDirective,
  geminiCatalogueEnabled,
  geminiReasoningDown,
  planCatalogueMouth,
  softenCataloguePunctuation,
} = require('./src/speech/catalogueMouth');
const {
  shouldForwardOutboundPcm,
  isOrphanFragment,
} = require('./src/speech/outboundPcm');
const {
  decideTurnEnd,
  decideCallerEvent,
  bargePhaseInputs,
  callerEventClearsIdle,
  looksLikeEcho: turnLooksLikeEcho,
  classifyFinalDuringAgentSpeech,
  agentAwaitingReply,
} = require('./src/speech/turnTaking');
const {
  labelFlushedCallerTurn,
  observeCallerInput,
} = require('./src/speech/callerTurnLabel');
const {
  gateCallerFileSpeech,
  lockFileNameAsk,
  speakerBound,
} = require('./src/speech/callerFileSpeech');
const {
  authorizeSpeak,
  createSpeakCommit,
  commitTurnFacts,
  commitReadySpeakSlots,
} = require('./src/speech/speakPacket');
const {
  createToolHoldSession,
  fileReadFollowUp,
  holdSpeaksAfterAck,
  trimAckLead,
  turnRequestsTool,
} = require('./src/speech/toolHold');
const { appendFinalPart, joinUtteranceParts } = require('./src/speech/utteranceJoin');
const { queueToolOutcome, takeToolOutcome } = require('./src/conversation/toolOutcomeQueue');
const { coverageNextStepFor } = require('./src/conversation/coverageNextStep');
const {
  createSpokenStreamBuffer,
  joinSpokenPieces,
  speakPreparedSentences,
} = require('./src/speech/spokenStreamBuffer');
const { cutNoAiSlop } = require('./src/speech/noAiSlop');
const {
  createOverlapHold,
  createAgentReplayMemory,
} = require('./src/speech/overlapHold');
const { createLateFinalHold } = require('./src/speech/lateFinal');
const { createIdleNudgeController } = require('./src/speech/idleNudge');
const { createUnfinishedHold, unfinishedHoldMs } = require('./src/speech/unfinishedHold');
const { noteCallTerminal, callTerminalSince } = require('./src/speech/callLifecycle');
const { planBrainEndClose, runBrainEndClose, farewellHangupDelayMs } = require('./src/speech/callClose');
const {
  createVoiceTurnTiming,
  createCallTranscript,
  logConnectToGreetingPcm,
} = require('./src/speech/voiceTiming');
const { isDefaultShopName } = require('./src/conversation/businessAssistantIntro');
const {
  classifyFirstForwardAcceptance,
  looksLikeJobNoun,
} = require('./src/conversation/firstForwardAcceptance');
const { mergeInterimHypothesis } = require('./src/speech/interimBarge');
const { sautikitWebhookGuard } = require('./src/sautikit/webhook');
const {
  isWhatsAppEventKind,
  processWhatsAppReceived,
  platformPhoneNumberId,
  PLATFORM_SAUTIKIT_NUMBER_ID,
  PLATFORM_WHATSAPP_E164,
} = require('./src/sautikit/whatsappInbound');
const {
  consumeLiveTransferWebhook,
  queuePendingLiveTransfer,
  hasPendingLiveTransfer,
  buildAnswerStreamXml,
  emptyVoiceXml,
} = require('./src/sautikit/pendingLiveTransfer');
const {
  extractEventKind,
  extractEventCallSids,
  extractRecordingFields,
  isRecordingEvent,
} = require('./src/sautikit/recordingEvents');
const { fetchCallRecording } = require('./src/sautikit/recordingFetch');
const {
  summarizeHeaders,
  summarizeBody,
  createWsPayloadSampler,
} = require('./src/sautikit/safeLog');
const { isWhatsAppConfigured, sendOwnerWhatsApp, markWhatsAppRead, normalizeWhatsAppTo } = require('./src/notifications/whatsapp');
const { sendReserved } = require('./src/notifications/sendLedger');
const {
  ownerLeadEvent,
  renderEventText,
  renderEventSubject,
  displayOwnerCallerName,
  shouldSendOwnerLead,
  shouldDeferOwnerLeadForVisit,
  staffInboxAlreadyNotified,
  serviceRequestEvent,
  appointmentEvent,
} = require('./src/notifications/events');
const {
  dispatchCallerSms,
  appointmentCallerEvent,
  requestCallerEvent,
} = require('./src/notifications/callerSms');
const {
  TEXTBACK_META_KEY,
  SUPPRESS_WINDOW_MS,
  missedTextbackEnabled,
  missedCallEligible,
  recentlyTexted,
  sendMissedTextback,
} = require('./src/notifications/missedTextback');

/** Desk base for deep links in owner alerts. */
function deskBaseUrl() {
  return (
    String(
      process.env.DESK_PUBLIC_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        'https://app.scalers.co.ke'
    ).trim() || 'https://app.scalers.co.ke'
  );
}

function callDeskUrl(callId) {
  const id = String(callId || '').trim();
  if (!id) return null;
  return `${deskBaseUrl()}/calls/${encodeURIComponent(id)}`;
}
const {
  dispatchEscalationAlert,
  whatsAppSenderReady,
  emailFallbackReady,
  smsSenderReady,
} = require('./src/notifications/dispatch');
const {
  staffRecipients,
  dispatchToStaff,
} = require('./src/notifications/recipients');
const {
  probeSmsCredentials,
  getSmsStatus,
} = require('./src/notifications/sms');
const {
  liveTransferReady,
  liveTransferDestination,
  normalizeKenyaE164,
  envLiveTransferExecutorEnabled,
  envLiveTransferIgnoreHours,
} = require('./src/conversation/liveTransferReady');
const { parseHandoffMode } = require('./src/conversation/handoffMode');
const {
  resolveEscalation,
  buildEscalationText,
  teammateLabel,
} = require('./src/conversation/escalation');
const {
  shapeEscalationNotifyOutcome,
} = require('./src/conversation/escalationFeature');

function capabilitiesForProfile(profile = {}, parsedTools = null) {
  const tools = parsedTools || parseAgentTools(profile.agentTools);
  const ready = liveTransferReady({
    profile: { ...profile, agentTools: tools },
  });
  return applyMessageOnlyCapabilities(
    buildBrainCapabilities(
      { ...profile, agentTools: tools },
      {
        createServiceRequest: true,
        createAppointment: true,
        updateAppointment: true,
        notifyCallback: true,
        liveTransfer: ready.ready,
      }
    ),
    profile.afterHoursMode
  );
}

const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || null;

// Phase 2 boot requirements: Supabase only.
// PUBLIC_BASE_URL is optional — Stream URLs use req.headers.host (Localtunnel).
// GEMINI_API_KEY is optional at boot (lazy-loaded if /ws/relay LLM path is used).
const requiredEnvironmentVariables = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];
const missingEnvironmentVariables = requiredEnvironmentVariables.filter((name) => !process.env[name]);
if (missingEnvironmentVariables.length > 0) {
  console.error(`ERROR: Missing required environment variables: ${missingEnvironmentVariables.join(', ')}`);
  process.exit(1);
}

const db = require('./src/db');

async function hydrateCallerMemory(profile, callSid) {
  return attachCallerMemory(profile, {
    callSid,
    getCall: (sid) => db.getCall(sid),
    getCallerMemory: (opts) => db.getCallerMemory(opts),
  });
}

async function loadVisitReviewAppointments(callSid, profile) {
  try {
    const call = await db.getCall(callSid);
    const tenantId = profile?.id || call?.tenant_id;
    const phone = call?.from_number || profile?.callerMemory?.phone;
    if (!tenantId || !phone) return [];
    return await db.listCallerAppointmentsForReview({ tenantId, phone });
  } catch (err) {
    console.warn(`[${callSid}] visit review load failed:`, err?.message || err);
    return [];
  }
}

let geminiClient = null;
function getGeminiClient() {
  if (geminiClient) return geminiClient;
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return geminiClient;
}

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(
  express.urlencoded({
    extended: true,
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Diagnostic middleware — inbound HTTP summary (no raw headers; TD-P1-4).
app.use((req, res, next) => {
  console.log(
    `[${new Date().toISOString()}] ${req.method} ${req.url}`,
    summarizeHeaders(req.headers)
  );
  next();
});

const PROCESS_STARTED_AT = new Date().toISOString();

function resolveVoiceGitSha() {
  const fromEnv = String(
    process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_SHA || ''
  ).trim();
  if (fromEnv) return fromEnv;
  try {
    return (
      fs.readFileSync(path.join(__dirname, 'scripts', '.deploy-sha'), 'utf8').trim() || null
    );
  } catch {
    return null;
  }
}

function resolveVoiceGitBranch() {
  const branch = String(
    process.env.RAILWAY_GIT_BRANCH || process.env.GIT_BRANCH || ''
  ).trim();
  return branch || null;
}

app.get('/healthz', (_req, res) => {
  const sms = getSmsStatus();
  res.status(200).json({
    ok: true,
    gitSha: resolveVoiceGitSha(),
    gitBranch: resolveVoiceGitBranch(),
    startedAt: PROCESS_STARTED_AT,
    soniox: {
      stt: isSonioxConfigured(),
      tts: isSonioxTtsConfigured(),
      defaultVoice: resolveSonioxVoice(),
      lastError: getSonioxProviderHealth(),
      outageClips: getOutageClipStatus(),
      curatedVoices: listCuratedVoices().map((v) => ({
        id: v.id,
        description: v.description,
        default: v.default,
      })),
    },
    gemini: {
      configured: Boolean(process.env.GEMINI_API_KEY),
      model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
      lastError: getGeminiProviderHealth(),
    },
    telephony: {
      configured: Boolean(process.env.SAUTIKIT_API_KEY),
      lastError: getTelephonyProviderHealth(),
    },
    platformOps: {
      dryRun: String(process.env.VOICE_PLATFORM_OPS_DRY_RUN || '').toLowerCase() === 'true',
      cooldownMs: opsCooldownMs(),
    },
    notify: {
      sms: {
        configured: sms.configured,
        verified: sms.verified,
        shortcode: sms.shortcode,
        code: sms.code,
        description: sms.description,
        balance: sms.balance,
        checkedAt: sms.checkedAt,
      },
      whatsapp: whatsAppSenderReady(),
      email: emailFallbackReady(),
    },
    liveTransfer: {
      executor: envLiveTransferExecutorEnabled(),
      ignoreHours: envLiveTransferIgnoreHours(),
    },
    voiceProfile: publicVoiceProfile(),
  });
});

/** Ops: force a TextSMS balance probe (no SMS charged). */
app.get('/internal/sms/status', async (req, res) => {
  if (!voicePreviewAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const status = await probeSmsCredentials({ force: true });
  return res.status(200).json({ ok: Boolean(status.verified), sms: status });
});

/** Ops: force SautiKit wallet probe (may fire telephony platform alert). */
app.post('/internal/telephony/wallet-probe', async (req, res) => {
  if (!voicePreviewAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const result = await probeSautikitWallet();
  return res.status(200).json(result);
});

/** Staging proof: fire platform ops alert with VOICE_PLATFORM_OPS_DRY_RUN=true. */
app.post('/internal/platform/ops-alert', async (req, res) => {
  if (!voicePreviewAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const kind = String(req.body?.kind || 'speech').trim();
  const result = await notePlatformOpsDegrade(kind, {
    channel: 'manual',
    message: String(req.body?.message || 'staging probe').trim(),
  });
  return res.status(200).json({ ok: Boolean(result.ok), result });
});

/** Owner desk re-ping. Same dispatch as live escalate. Force retries after a failed notify. */
app.post('/internal/desk/escalate', async (req, res) => {
  if (!voicePreviewAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const callSid = String(req.body?.callSid || '').trim();
  if (!callSid) {
    return res.status(400).json({ ok: false, reason: 'callSid required' });
  }
  try {
    const result = await maybeSendEscalationNotification(callSid, {
      teammate: String(req.body?.teammate || '').trim() || undefined,
      name: String(req.body?.callerName || '').trim() || undefined,
      reason: String(req.body?.reason || '').trim() || 'Desk ping',
      force: req.body?.force !== false,
      pingId: String(req.body?.pingId || '').trim().slice(0, 80) || undefined,
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      reason: err?.message || String(err),
    });
  }
});

app.get('/api/voices', async (_req, res) => {
  try {
    const voices = await refreshCuratedVoicesFromDb({ force: true });
    res.status(200).json({ voices });
  } catch (err) {
    res.status(200).json({ voices: listCuratedVoices() });
  }
});

function voicePreviewAuthorized(req) {
  const secret = String(process.env.VOICE_INTERNAL_SECRET || '').trim();
  if (!secret) {
    return process.env.NODE_ENV !== 'production';
  }
  const header = String(req.headers['x-voice-internal-secret'] || '').trim();
  return header === secret;
}

app.post('/api/tts/preview', async (req, res) => {
  if (!voicePreviewAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!isSonioxTtsConfigured()) {
    return res.status(503).json({ error: 'Soniox TTS not configured' });
  }

  const text = String(req.body?.text || '').trim();
  if (!text || text.length > 500) {
    return res.status(400).json({ error: 'text required (max 500 chars)' });
  }

  try {
    const voiceId = req.body?.voiceId || req.body?.soniox_voice_id || null;
    const result = await synthesizeTtsPreview({
      text,
      callLanguage: req.body?.callLanguage,
      language: req.body?.language,
      lexicon: req.body?.lexicon,
      voiceId,
    });
    const resolvedVoice = resolveSonioxVoice(voiceId);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Disposition', 'inline; filename="preview.wav"');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Spoken-Text', encodeURIComponent(result.spokenText));
    res.setHeader('X-Tts-Language', result.language);
    res.setHeader('X-Soniox-Voice', resolvedVoice);
    return writeWavResponse(res, result.wav);
  } catch (err) {
    console.error('[api/tts/preview] failed:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'preview failed' });
  }
});

/**
 * Build the media WebSocket URL from the inbound request host so Localtunnel /
 * ngrok / production reverse proxies work without hard-coding PUBLIC_BASE_URL.
 */
function requestHost(req) {
  return String(req.headers.host || '').trim();
}

function requestHttpProto(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (forwarded === 'http' || forwarded === 'https') return forwarded;
  return 'https';
}

function buildMediaStreamUrl(req) {
  const host = requestHost(req);
  if (!host) {
    throw new Error('Missing Host header — cannot build Stream WebSocket URL');
  }
  const wsProto = requestHttpProto(req) === 'http' ? 'ws' : 'wss';
  return `${wsProto}://${host}/ws/media`;
}

function buildVoiceTransferContinueUrl(req, callSid) {
  const host = requestHost(req);
  if (!host) {
    throw new Error('Missing Host header — cannot build transfer Redirect URL');
  }
  const sid = encodeURIComponent(String(callSid || '').trim());
  return `${requestHttpProto(req)}://${host}/voice/transfer?callSid=${sid}`;
}

/** Digits-only phone compare (+2547… vs 2547…). */
function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function phonesMatch(a, b) {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  return Boolean(da && db && da === db);
}

/**
 * WebRTC / some SautiKit payloads put our tenant DID in callerNumber.
 * If `from` matches a known tenant DID, swap so:
 *   from = customer (caller)
 *   to   = tenant DID (agent number)
 */
function correctCallerCalleeNumbers({ fromNumber, toNumber, tenantDids = [] }) {
  const dids = tenantDids.filter(Boolean);
  if (!fromNumber || !dids.length) {
    return { fromNumber, toNumber, swapped: false };
  }
  const fromIsTenantDid = dids.some((did) => phonesMatch(fromNumber, did));
  if (!fromIsTenantDid) {
    return { fromNumber, toNumber, swapped: false };
  }
  // Already looks correct if `to` is also our DID and `from` isn't — shouldn't reach here.
  return {
    fromNumber: toNumber || fromNumber,
    toNumber: fromNumber,
    swapped: true,
  };
}

/** Normalize SautiKit voice webhook fields (live payload shape). */
function extractInboundCallFields(body = {}) {
  const nested = body.call || body.payload || body.data || {};
  const callSid =
    body.sessionId ||
    body.SessionId ||
    body.streamSid ||
    body.CallSid ||
    body.callSid ||
    body.call_sid ||
    body.call_id ||
    body.CallId ||
    nested.id ||
    nested.sessionId ||
    nested.call_id ||
    null;
  const fromNumber =
    body.callerNumber ||
    body.From ||
    body.from ||
    body.caller_number ||
    nested.callerNumber ||
    nested.from ||
    null;
  // SautiKit voice_callback "to" is our tenant DID. Some WebRTC shapes flip it.
  const toNumber =
    body.destinationNumber ||
    body.clientDialedNumber ||
    body.To ||
    body.to ||
    body.destination_number ||
    nested.destinationNumber ||
    nested.to ||
    null;
  const callSessionState = String(
    body.callSessionState ||
      body.CallSessionState ||
      body.streamEvent ||
      body.streamStatus ||
      body.status ||
      ''
  );
  return {
    callSid,
    fromNumber,
    toNumber,
    callSessionState,
    streamSid: body.streamSid || null,
    streamEvent: body.streamEvent || null,
  };
}

function shouldSkipMediaStream(callSessionState, body = {}, callSid = '') {
  if (hasPendingLiveTransfer(callSid)) return true;

  const state = String(callSessionState || '').toLowerCase();
  const streamEvent = String(body.streamEvent || '').toLowerCase();
  if (!state && !streamEvent) return false;

  // SautiKit VoiceProxy can deliver a first callback with callSessionState
  // already "Completed" while the leg is still being set up. isActive /
  // direction / duration mark it as call-set-up, not a re-invoke after a
  // running stream. Never skip Stream on that first webhook or the carrier
  // answers with its own downtime message and /ws/media never opens.
  const durationSeconds = extractEventDurationSeconds(body);
  const hasCallSetupFields =
    body.isActive !== undefined ||
    body.direction !== undefined ||
    (durationSeconds != null && durationSeconds >= 0);
  if (state === 'completed' && hasCallSetupFields) return false;

  // Stream already running / finished — never re-issue <Stream/>.
  const skipTokens = [
    'streamstarted',
    'stream-started',
    'streamstopped',
    'stream-stopped',
    'streamerror',
    'stream-error',
    'completed',
    'hangup',
    'failed',
    'busy',
    'no-answer',
  ];
  return skipTokens.some((t) => state.includes(t) || streamEvent.includes(t));
}

/** Extract callSid from SautiKit event / lifecycle payloads (many shapes). */
function extractEventCallSid(body = {}) {
  return extractEventCallSids(body)[0] || null;
}

function rememberProviderCallIds(sessionSid, body = {}) {
  const sid = String(sessionSid || '').trim();
  if (!sid) return;
  const ids = extractEventCallSids(body);
  for (const id of ids) {
    if (id === sid) continue;
    sidByProviderCallId.set(id, sid);
    providerCallIdBySid.set(sid, id);
  }
}

function resolveAttachCallSids(body = {}, extra = []) {
  const out = [];
  const push = (value) => {
    const text = String(value || '').trim();
    if (!text || out.includes(text)) return;
    out.push(text);
  };
  for (const id of extra) push(id);
  for (const id of extractEventCallSids(body)) {
    push(id);
    push(sidByProviderCallId.get(id));
  }
  return out;
}

async function attachProviderRecording({
  callSids = [],
  recordingUrl = null,
  recordingSid = null,
  fetchIfMissing = false,
  source = 'voice/events',
} = {}) {
  const ids = [...new Set((callSids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const extraSids = [];
  for (const callSid of ids) {
    try {
      const existing = await db.getCall(callSid);
      if (existing?.recording_url) return callSid;
    } catch {
      /* lookup is best-effort */
    }
  }
  let url = recordingUrl;
  if (!url && fetchIfMissing) {
    for (const id of ids) {
      const fetched = await fetchCallRecording(id);
      if (fetched.sessionId) extraSids.push(fetched.sessionId);
      if (fetched.downloadUrl) {
        url = fetched.downloadUrl;
        console.log(
          `[${source}] recording fetched callSid=${id} status=${fetched.status}`
        );
        break;
      }
      if (fetched.status === 404 || fetched.status === 410) {
        console.warn(
          `[${source}] no provider recording callSid=${id} status=${fetched.status}`
        );
      } else if (fetched.status && fetched.status !== 'not_configured') {
        console.warn(
          `[${source}] recording fetch pending callSid=${id} status=${fetched.status}`
        );
      }
    }
  }
  if (!url) {
    if (ids.length) {
      console.warn(
        `[${source}] recording missing URL callSids=${ids.join(',')}`
      );
    }
    return null;
  }
  const uniqueIds = [...new Set([...extraSids, ...ids].filter(Boolean))];
  for (const callSid of uniqueIds) {
    try {
      await db.attachRecording({
        callSid,
        recordingSid,
        sourceUrl: url,
        recordingUrl: url,
      });
      console.log(`[${source}] attachRecording ok callSid=${callSid}`);
      return callSid;
    } catch (err) {
      console.warn(
        `[${source}] attachRecording miss callSid=${callSid}:`,
        err?.message || err
      );
    }
  }
  return null;
}

function scheduleRecordingFetch(callSids, source) {
  const ids = [...new Set((callSids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return;
  const key = ids.join('|');
  if (recordingFetchScheduled.has(key)) return;
  recordingFetchScheduled.add(key);
  setTimeout(() => {
    attachProviderRecording({
      callSids: ids,
      fetchIfMissing: true,
      source: `${source}+retry`,
    }).catch((err) => {
      console.warn(`[${source}] delayed recording fetch failed:`, err?.message || err);
    });
  }, 8000);
}

/** Pull duration (seconds) from whatever field SautiKit used. */
function extractEventDurationSeconds(body = {}) {
  const raw =
    body.duration_seconds ??
    body.durationSeconds ??
    body.durationInSeconds ??
    body.Duration ??
    body.duration ??
    body.call_duration ??
    body.data?.duration_seconds ??
    body.data?.durationSeconds ??
    body.data?.duration ??
    body.payload?.duration_seconds ??
    body.payload?.duration ??
    null;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Detect call termination from workspace events or voice lifecycle callbacks.
 * Returns { terminal, status } where status is 'complete' | 'failed' | 'no_answer'.
 */
function detectCallTermination(body = {}, kind = '') {
  const kindStr = String(kind || '').toLowerCase();
  const event =
    String(
      body.event ||
        body.event_type ||
        body.event_kind ||
        body.type ||
        body.kind ||
        body.name ||
        ''
    ).toLowerCase();
  const sessionState = String(
    body.callSessionState ||
      body.CallSessionState ||
      body.streamStatus ||
      body.status ||
      body.data?.callSessionState ||
      body.data?.status ||
      body.payload?.status ||
      ''
  ).toLowerCase();

  const haystack = `${kindStr} ${event} ${sessionState}`;

  if (
    haystack.includes('no-answer') ||
    haystack.includes('no_answer') ||
    haystack.includes('noanswer')
  ) {
    return { terminal: true, status: 'no_answer' };
  }
  if (
    haystack.includes('fail') ||
    haystack.includes('error') ||
    haystack.includes('busy') ||
    event === 'call.failed' ||
    kindStr.includes('call.failed')
  ) {
    return { terminal: true, status: 'failed' };
  }
  if (
    haystack.includes('completed') ||
    haystack.includes('complete') ||
    haystack.includes('hangup') ||
    haystack.includes('ended') ||
    event === 'call.completed' ||
    event === 'call.ended' ||
    kindStr.includes('call.completed') ||
    kindStr.includes('call.ended')
  ) {
    // Avoid treating recording.completed alone as call completion when no session state.
    if (haystack.includes('recording') && !haystack.includes('call') && !sessionState.includes('complet')) {
      return { terminal: false, status: null };
    }
    return { terminal: true, status: 'complete' };
  }

  return { terminal: false, status: null };
}

async function persistCallResolution(callSid, source = 'call', opts = {}) {
  if (!callSid) return null;
  const brainState = callBrainStates.get(callSid);
  if (!brainState) return null;
  return withSummaryWriteLock(callSid, () =>
    writeHangupSummary(callSid, source, opts, brainState)
  );
}

async function writeHangupSummary(callSid, source, opts, brainState) {
  try {
    const call = await db.getCall(callSid);
    const derived = deriveCallResolution({
      brainState,
      callId: call?.id || null,
    });
    const summary = deriveCallSummary({ brainState });
    const primaryIntent = summary.primaryIntent || null;
    const saved = await db.setCallResolution({
      callSid,
      resolution: derived.resolution,
      primaryIntent,
      resolutionNote: derived.resolutionNote,
    });
    try {
      await db.mergeCallSummaryMeta({
        callSid,
        patch: {
          text: summary.text,
          brain_summary: summary.text,
          reason: summary.reason,
          primary_intent: primaryIntent,
          products: summary.products,
          actions: summary.actions,
          instructions: summary.instructions,
          language: summary.language,
        },
      });
    } catch (err) {
      console.warn(
        `[${source}] mergeCallSummaryMeta failed:`,
        err?.message || err
      );
    }
    const profile = callTenantProfiles.get(callSid) || {};
    if (opts.review !== false) {
      schedulePostCallTranscriptReview({
        callSid,
        vertical: profile.vertical || '',
        derived,
        summary,
        toolFlags: toolFlagsFromBrain(brainState, call?.id || null),
        turns: Array.isArray(opts.turns) ? opts.turns : null,
        callStatus: opts.callStatus || null,
      });
    }
    if (saved) {
      console.log(
        `[${source}] call resolution ${callSid} → ${derived.resolution}` +
          (primaryIntent ? ` intent=${primaryIntent}` : '')
      );
    }
    return saved;
  } catch (err) {
    console.warn(
      `[${source}] setCallResolution failed:`,
      err?.message || err
    );
    return null;
  }
}

async function markCallTerminalFromWebhook({ callSid, status, durationSeconds, source, turns }) {
  if (!callSid) {
    console.warn(`[${source}] termination detected but no callSid — skipping DB update`);
    return null;
  }
  try {
    const updated = await db.updateCallStatus({
      callSid,
      status,
      durationSeconds,
    });
    console.log(`[${source}] marked call ${callSid} status=${status}`, {
      durationSeconds: durationSeconds ?? null,
      found: Boolean(updated),
    });
    // Best-effort outcome while Brain state may still be in memory.
    await persistCallResolution(callSid, source, { turns, callStatus: status });
    await persistFirstForwardAcceptance(callSid, durationSeconds);
    if (updated) {
      // Fire-and-forget: SMS latency must not hold the webhook open.
      maybeSendMissedTextback({ callSid, call: updated }).catch((err) =>
        console.warn(`[${source}] missed text-back failed:`, err?.message || err)
      );
    }
    return updated;
  } catch (err) {
    console.error(`[${source}] updateCallStatus failed:`, err?.message || err);
    return null;
  }
}

// One in-flight text-back per call; the summary marker closes the rest.
const textbackInProgress = new Set();

async function maybeSendMissedTextback({ callSid, call }) {
  if (!callSid || !call) return;
  if (textbackInProgress.has(callSid)) return;
  const eligible = missedCallEligible(call);
  if (!eligible.ok) return;
  textbackInProgress.add(callSid);
  try {
    let businessName = process.env.BUSINESS_NAME || null;
    let notifyChannels = null;
    let tenantId = call.tenant_id || null;
    try {
      const profile = await db.getTenantProfile({ callSid });
      businessName = profile.businessName || businessName;
      notifyChannels = profile.notifyChannels || null;
      tenantId = profile.id || tenantId;
    } catch (err) {
      console.warn(`[${callSid}] tenant lookup for text-back failed:`, err?.message || err);
      return;
    }
    if (!missedTextbackEnabled(notifyChannels)) return;
    // A retrying caller during an outage gets one text per window, not one per attempt.
    const recent = await db.listRecentCallsFromNumber({
      tenantId: call.tenant_id,
      callerNumber: call.from_number,
      sinceIso: new Date(Date.now() - SUPPRESS_WINDOW_MS).toISOString(),
    });
    if (recentlyTexted(recent)) return;
    const sent = await sendMissedTextback({
      to: call.from_number,
      businessName,
      ledger: {
        tenantId,
        callId: call.id || null,
        callSid,
      },
    });
    if (!sent.channel) return;
    await db.mergeCallSummaryMeta({
      callSid,
      patch: { [TEXTBACK_META_KEY]: new Date().toISOString() },
    });
    console.log(`[${callSid}] missed-call text-back sent`);
  } finally {
    textbackInProgress.delete(callSid);
  }
}

// ---------------------------------------------------------------------------
// 1. Inbound voice webhook — SautiKit POSTs here (voice_callback_url).
//    Mounted on BOTH `/` and `/voice/incoming` because some number routing
//    configs point at the tunnel root (logs showed POST / → 404 before).
// ---------------------------------------------------------------------------
async function handleVoiceIncoming(req, res) {
  try {
    const extracted = extractInboundCallFields(req.body);
    let fromNumber = extracted.fromNumber;
    let toNumber = extracted.toNumber;
    const callSessionState = extracted.callSessionState;
    // Always have a durable id for Supabase even if SautiKit omits CallSid.
    const callSid = extracted.callSid || `sautikit_call_${Date.now()}`;
    rememberProviderCallIds(callSid, req.body);

    // Load tenant DIDs and undo WebRTC/header flips before persisting.
    let tenantDids = [];
    try {
      tenantDids = await db.listActiveTenantDids();
    } catch (err) {
      console.warn('[voice/incoming] listActiveTenantDids failed:', err?.message || err);
      tenantDids = [process.env.SAUTIKIT_DID, process.env.TENANT_DID].filter(Boolean);
    }
    const corrected = correctCallerCalleeNumbers({ fromNumber, toNumber, tenantDids });
    if (corrected.swapped) {
      console.warn('[voice/incoming] caller/callee looked flipped (from matched tenant DID) — swapping', {
        before: { fromNumber, toNumber },
        after: { fromNumber: corrected.fromNumber, toNumber: corrected.toNumber },
        tenantDids,
      });
    }
    fromNumber = corrected.fromNumber;
    toNumber = corrected.toNumber;

    console.log('[voice/incoming]', {
      path: req.path || req.url,
      callSid,
      callSidSource: extracted.callSid ? 'payload' : 'fallback',
      fromNumber,
      toNumber,
      swapped: corrected.swapped,
      callSessionState: callSessionState || '(initial)',
      host: req.headers.host,
      body: summarizeBody(req.body),
    });

    // SautiKit re-invokes the voice URL on StreamStarted / Completed / etc.
    // Returning another Stream document re-forks and errors — send empty XML.
    // A first webhook whose callSessionState is already "Completed" is still
    // call-set-up (it carries callerNumber/destinationNumber/isActive). Open
    // the stream, persist the call, and let the later Completed event close it.
    const sid = extracted.callSid || callSid;
    if (shouldSkipMediaStream(callSessionState, req.body, sid)) {
      const transferXml = consumeLiveTransferWebhook({
        callSid: sid,
        callSessionState,
        body: req.body,
      });
      if (transferXml?.xml) {
        persistLiveTransferAction(sid, transferXml);
        console.log(
          `[voice/incoming] live transfer action=${transferXml.action} — no re-Stream`
        );
        return res.type('text/xml').send(transferXml.xml);
      }
      const termination = detectCallTermination(req.body, callSessionState);
      if (termination.terminal) {
        noteCallTerminal(sid, { source: 'voice/incoming', status: termination.status });
        // Fire-and-forget so we still return TwiML immediately.
        markCallTerminalFromWebhook({
          callSid: sid,
          status: termination.status,
          durationSeconds: extractEventDurationSeconds(req.body),
          source: 'voice/incoming',
        }).catch(() => {});
      }
      console.log('[voice/incoming] lifecycle edge — empty <Response/> (no re-Stream)');
      return res
        .type('text/xml')
        .send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }

    // Prepaid SautiKit balance empty or 402. Reject before Stream so the leg
    // never reaches /ws/media. Probe HTTP errors (403), timeouts, and
    // never-probed state do not set this flag (fail open). A later healthy
    // probe clears it so calls resume without a restart.
    const telephonyReject = telephonyBillingRejectXml();
    if (telephonyReject) {
      console.warn(`[${callSid}] telephony wallet exhausted — reject`);
      return res.type('text/xml').send(telephonyReject);
    }

    const preTerminal = detectCallTermination(req.body, callSessionState).terminal;

    try {
      const gate = await db.packageInboundOpen({ toNumber, fromNumber });
      if (gate && gate.open === false) {
        console.warn(`[${callSid}] package exhausted — reject`);
        return res
          .type('text/xml')
          .send('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');
      }
    } catch (gateErr) {
      console.warn(
        '[voice/incoming] package gate failed (answering):',
        gateErr?.message || gateErr
      );
    }

    try {
      await db.upsertCall({
        callSid,
        fromNumber: fromNumber || 'unknown',
        toNumber,
        provider: 'sautikit',
      });
      if (preTerminal) {
        // The setup webhook already says Completed. Do not mark the row
        // complete before /ws/media has a chance to write transcript/state.
        setTimeout(() => {
          markCallTerminalFromWebhook({
            callSid,
            status: 'complete',
            durationSeconds: extractEventDurationSeconds(req.body),
            source: 'voice/incoming-setup-terminal',
          }).catch(() => {});
        }, 3000);
      }
    } catch (dbErr) {
      if (dbErr?.code === 'unassigned_did') {
        console.warn(`[${callSid}] unassigned number — reject`);
        return res
          .type('text/xml')
          .send('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');
      }
      // Do not fail the webhook / Stream setup if DB is briefly unavailable.
      console.error('[voice/incoming] DB upsert failed (continuing with Stream):', dbErr?.message || dbErr);
    }

    const streamUrl = `${buildMediaStreamUrl(req)}?callSid=${encodeURIComponent(callSid)}`;
    // SautiKit requires connect="true" on Stream or the leg hangs up in ~1s.
    // Pass callSid on the WS URL so /ws/media can bind the session without
    // waiting for the first metadata frame. Redirect after Stream runs when
    // the media socket closes (StreamStopped does not re-hit this URL).
    const twiml = buildAnswerStreamXml({
      streamUrl,
      continueUrl: buildVoiceTransferContinueUrl(req, callSid),
    });

    res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('[voice/incoming] Webhook handling failed:', err);
    res.sendStatus(500);
  }
}

async function noteWhatsAppDeliveryFailed(row = {}) {
  const status = String(row.status || '');
  if (status !== 'failed' && status !== 'undelivered') return;
  const wamid = String(row.wamid || '').trim();
  if (!wamid) return;
  const errors = Array.isArray(row.raw?.errors) ? row.raw.errors : [];
  const code = Number(errors[0]?.code);
  const reason = code === 131042 ? 'whatsapp_billing' : 'whatsapp_delivery_failed';
  try {
    const sent = await db.findNotifySendByProviderMessageId(wamid);
    if (!sent?.call_sid) return;
    await db.mergeCallSummaryMeta({
      callSid: sent.call_sid,
      patch: {
        escalation_sent: false,
        whatsapp_sent: false,
        escalation_notify: {
          ok: false,
          soft: false,
          stage: 'failed',
          channels: [],
          reason,
          at: new Date().toISOString(),
        },
      },
    });
  } catch (err) {
    console.warn('[whatsapp] delivery note failed:', err?.message || err);
  }
}

async function handleWhatsAppWebhook(req, res) {
  res.sendStatus(200);
  try {
    const body = req.body || {};
    const data = body.data && typeof body.data === 'object' ? body.data : null;
    console.log('[whatsapp/events] payload', {
      kind: req.headers?.['x-sautikit-event-kind'] || body.kind || null,
      eventId: req.headers?.['x-sautikit-event-id'] || body.event_id || null,
      bodyKeys: Object.keys(body),
      dataKeys: data ? Object.keys(data) : [],
      hasEntry: Array.isArray(body.entry) || Array.isArray(data?.entry),
      messagingProduct:
        body.messaging_product ||
        body.value?.messaging_product ||
        data?.messaging_product ||
        data?.value?.messaging_product ||
        null,
      phoneNumberId:
        body.metadata?.phone_number_id ||
        body.value?.metadata?.phone_number_id ||
        data?.metadata?.phone_number_id ||
        data?.value?.metadata?.phone_number_id ||
        null,
    });
    const result = await processWhatsAppReceived({
      body,
      headers: req.headers,
      persistInbound: (row) => db.persistPlatformWhatsAppInbound(row),
      persistStatus: async (row) => {
        await db.persistWhatsAppStatus(row);
        await noteWhatsAppDeliveryFailed(row);
      },
      markRead: (wamid) => markWhatsAppRead(wamid),
      sendText: async ({ to, body, replyTo }) => {
        // Platform-billed reply: notify_sends row (tenant null) keyed by the
        // inbound wamid, so a webhook redelivery cannot send or count twice.
        const waTo = normalizeWhatsAppTo(to);
        const reserved = await sendReserved(
          {
            ledger: { tenantId: null, kind: 'platform_wa_reply' },
            key: replyTo ? `wa:${replyTo}` : `wa:${waTo}:${new Date().toISOString().slice(0, 16)}`,
            kind: 'platform_wa_reply',
            channel: 'whatsapp',
            to: waTo,
            body,
          },
          () => sendOwnerWhatsApp({ to, body, windowOpen: true })
        );
        if (!reserved.legacy && !reserved.sent) {
          console.warn(`[whatsapp/events] reply skipped (${reserved.reason})`);
          return null;
        }
        const json = reserved.legacy
          ? await sendOwnerWhatsApp({ to, body, windowOpen: true })
          : reserved.result;
        await db.persistPlatformWhatsAppOutbound({
          identity: 'platform',
          phoneNumberId: platformPhoneNumberId(),
          sautikitNumberId: PLATFORM_SAUTIKIT_NUMBER_ID,
          e164: PLATFORM_WHATSAPP_E164,
          contactWaId: normalizeWhatsAppTo(to),
          wamid: json?.id || json?.wamid || json?.message_id || null,
          type: 'text',
          body,
          payload: json,
        });
        return json;
      },
    });
    console.log('[whatsapp/events]', result);
  } catch (err) {
    console.error('[whatsapp/events] failed after ACK:', err?.message || err);
  }
}

function handleSautikitRootPost(req, res) {
  if (isWhatsAppEventKind(req)) return handleWhatsAppWebhook(req, res);
  return handleVoiceIncoming(req, res);
}

app.post('/', sautikitWebhookGuard, handleSautikitRootPost);
app.post('/voice/incoming', sautikitWebhookGuard, handleVoiceIncoming);
app.post('/voice', sautikitWebhookGuard, handleVoiceIncoming);
// Workspace WhatsApp inbound (whatsapp.event.received). Do not resolveTenantId(DID).
app.post('/whatsapp/events', sautikitWebhookGuard, handleWhatsAppWebhook);

function persistLiveTransferAction(callSid, transferXml) {
  if (!callSid || !transferXml?.xml) return;
  if (
    transferXml.action !== 'dial' &&
    transferXml.action !== 'fallback' &&
    transferXml.action !== 'bridged'
  ) {
    return;
  }
  const attempt = transferXml.attempt || {};
  db.saveTransferAttempt({
    callSid,
    attempt: {
      status: attempt.status,
      mode: 'cold_dial',
      to: attempt.to || null,
      caller_id: attempt.callerId || null,
      timeout_s: attempt.timeoutS || null,
      sautikit_dial_status: transferXml.action,
      ended_at: transferXml.action === 'dial' ? null : new Date().toISOString(),
    },
  }).catch(() => {});
}

async function handleVoiceTransferContinue(req, res) {
  try {
    const extracted = extractVoiceNumbers(req.body || {});
    const callSid =
      String(req.query?.callSid || '').trim() || extracted.callSid || '';
    const transferXml = consumeLiveTransferWebhook({
      callSid,
      callSessionState: extracted.callSessionState,
      body: req.body || {},
      source: 'transfer_continue',
    });
    if (transferXml?.xml) {
      persistLiveTransferAction(callSid, transferXml);
      console.log(
        `[voice/transfer] live transfer action=${transferXml.action} callSid=${callSid}`
      );
      return res.type('text/xml').send(transferXml.xml);
    }
    console.log(
      `[voice/transfer] no pending Dial callSid=${callSid || 'none'} — empty Response`
    );
    return res.type('text/xml').send(emptyVoiceXml());
  } catch (err) {
    console.error('[voice/transfer] failed:', err?.message || err);
    return res.type('text/xml').send(emptyVoiceXml());
  }
}

app.post('/voice/transfer', sautikitWebhookGuard, handleVoiceTransferContinue);

// ---------------------------------------------------------------------------
// 2. Recording attach helper (provider-agnostic). Used when a recording URL
//    is available from SautiKit events (Phase 2+) or manual hooks.
// ---------------------------------------------------------------------------
app.post('/voice/recording-status', sautikitWebhookGuard, async (req, res) => {
  try {
    const body = req.body || {};
    const rec = extractRecordingFields(body);
    const callSids = resolveAttachCallSids(body, [
      body.CallSid,
      body.callSid,
      body.call_sid,
      body.call_id,
    ]);
    const recordingStatus = String(
      body.RecordingStatus || body.recording_status || body.status || 'completed'
    ).toLowerCase();

    if (!callSids.length) {
      return res.status(400).json({ error: 'call_sid required' });
    }

    if (recordingStatus === 'completed' || rec.recordingUrl) {
      await attachProviderRecording({
        callSids,
        recordingUrl: rec.recordingUrl,
        recordingSid: rec.recordingSid,
        fetchIfMissing: !rec.recordingUrl,
        source: 'voice/recording-status',
      });
      const attachedSid = callSids[0];
      if (attachedSid) await maybeSendWhatsAppNotification(attachedSid);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[voice/recording-status] Webhook handling failed:', err);
    res.sendStatus(500);
  }
});

// ---------------------------------------------------------------------------
// 2b. SautiKit workspace events — call.completed / recording.ready
// ---------------------------------------------------------------------------
app.post('/voice/events', sautikitWebhookGuard, async (req, res) => {
  if (isWhatsAppEventKind(req)) {
    return handleWhatsAppWebhook(req, res);
  }
  // Always ACK immediately so SautiKit does not retry (DB work is best-effort).
  res.sendStatus(200);

  try {
    const body = req.body || {};
    console.log('[voice/events] payload', summarizeBody(body));

    const kind = extractEventKind(req.headers, body);
    const callSid = extractEventCallSid(body);
    const durationSeconds = extractEventDurationSeconds(body);

    console.log('[voice/events]', {
      kind: String(kind),
      callSid,
      eventId: req.headers['x-sautikit-event-id'] || null,
      bodyKeys: Object.keys(body),
      callSessionState: body.callSessionState || body.CallSessionState || null,
    });

    const kindStr = String(kind).toLowerCase();
    const streamState = String(body.callSessionState || body.streamEvent || '').toLowerCase();
    if (
      callSid &&
      hasPendingLiveTransfer(callSid) &&
      (streamState.includes('streamstop') || streamState.includes('stream-stop'))
    ) {
      console.log(
        `[voice/events] StreamStopped with pending Dial callSid=${callSid} (events_url cannot return Dial; wait for /voice/transfer Redirect)`
      );
    }

    const termination = detectCallTermination(body, kind);
    const rec = extractRecordingFields(body);
    const attachSids = resolveAttachCallSids(body, [callSid]);
    if (callSid) rememberProviderCallIds(callSid, body);

    if (isRecordingEvent(kindStr, body) && attachSids.length) {
      const attached = await attachProviderRecording({
        callSids: attachSids,
        recordingUrl: rec.recordingUrl,
        recordingSid: rec.recordingSid,
        fetchIfMissing: !rec.recordingUrl,
        source: 'voice/events',
      });
      if (attached) {
        await maybeSendWhatsAppNotification(attached);
      } else if (!rec.recordingUrl) {
        scheduleRecordingFetch(attachSids, 'voice/events');
      }
    } else if (isRecordingEvent(kindStr, body) && !attachSids.length) {
      console.warn('[voice/events] recording event without callSid — cannot attach');
    }

    if (termination.terminal && callSid) {
      const terminalSid = sidByProviderCallId.get(callSid) || callSid;
      // The media socket may stay open a few seconds after this. Its timers
      // (idle nudge, held-turn reply) must not speak into an ended call.
      noteCallTerminal(terminalSid, { source: 'voice/events', status: termination.status });
      await markCallTerminalFromWebhook({
        callSid: terminalSid,
        status: termination.status,
        durationSeconds,
        source: 'voice/events',
      });
      if (termination.status === 'complete') {
        await maybeSendWhatsAppNotification(terminalSid);
        if (!rec.recordingUrl) {
          scheduleRecordingFetch(attachSids, 'voice/events');
        }
      }
    } else if (termination.terminal && !callSid) {
      console.warn('[voice/events] terminal event without callSid — cannot update calls row');
      if (termination.status === 'complete' && attachSids.length) {
        scheduleRecordingFetch(attachSids, 'voice/events');
      }
    }
  } catch (err) {
    // Already returned 200; log only so SautiKit does not retry forever.
    console.error('[voice/events] Webhook handling failed (after 200 ACK):', err);
  }
});

// ---------------------------------------------------------------------------
// 3. Media WebSocket (/ws/media) — SautiKit audio.drachtio.org fork
//    Use noServer + manual upgrade so we never fight another WSS on :3000
//    (dual path-based WSS on one HTTP server is a common cause of bare 1006).
// ---------------------------------------------------------------------------
const server = http.createServer(app);

const mediaWss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
  handleProtocols: (protocols) => {
    try {
      const list = Array.from(protocols || []);
      if (list.includes('audio.drachtio.org')) return 'audio.drachtio.org';
      return list[0] || 'audio.drachtio.org';
    } catch {
      return 'audio.drachtio.org';
    }
  },
});

// Legacy ConversationRelay path (unused in Phase 2 SautiKit flow).
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

function toNodeBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data.map((part) => toNodeBuffer(part)));
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.from(String(data));
}

function looksLikeJsonText(text) {
  const trimmed = text.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

server.on('upgrade', (req, socket, head) => {
  try {
    const pathname = new URL(req.url || '', 'http://localhost').pathname;
    console.log(`[upgrade] pathname=${pathname} proto=${req.headers['sec-websocket-protocol'] || ''}`);

    if (pathname === '/ws/media') {
      mediaWss.handleUpgrade(req, socket, head, (ws) => {
        mediaWss.emit('connection', ws, req);
      });
      return;
    }

    if (pathname === '/ws/relay') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
      return;
    }

    console.warn(`[upgrade] rejecting unknown path ${pathname}`);
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  } catch (err) {
    console.error('[upgrade] error:', err?.message || err);
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  }
});

/** ~20 ms of mono pcm_s16le @ 16 kHz — matches typical SautiKit inbound frames. */
const OUTBOUND_PCM_FRAME_BYTES = 640;

function sendPcmToMedia(ws, pcm) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !pcm || !pcm.length) return;
  // Fixed phone gain on the whole utterance. Do not even-out 20 ms frames (pumping).
  const boosted = applyPcmGain(pcm, resolveVoiceProfile().gain);
  // Prefer small frames for smoother playback on the telephony side.
  for (let offset = 0; offset < boosted.length; offset += OUTBOUND_PCM_FRAME_BYTES) {
    const slice = boosted.subarray(offset, offset + OUTBOUND_PCM_FRAME_BYTES);
    try {
      ws.send(slice, { binary: true });
    } catch (err) {
      console.warn('[ws/media] outbound PCM send failed:', err?.message || err);
      break;
    }
  }
}

/**
 * Stop already-queued outbound audio on the media bridge (barge-in).
 * SautiKit/drachtio mod_audio_fork understands `{ type: "killAudio" }`.
 */
function clearMediaPlayback(ws) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const payloads = [
    { type: 'killAudio' },
    // Compatibility fallbacks seen across forks / Twilio-style bridges.
    { event: 'clear' },
    { type: 'clear' },
  ];
  for (const payload of payloads) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (err) {
      console.warn(
        `[ws/media] clear/killAudio send failed (${payload.type || payload.event}):`,
        err?.message || err
      );
    }
  }
}

mediaWss.on('connection', (ws, req) => {
  const connectedAt = Date.now();
  let sessionCallSid = null;
  try {
    const q = new URL(req.url || '', 'http://localhost').searchParams;
    sessionCallSid = q.get('callSid') || q.get('sessionId') || null;
  } catch {
    /* ignore */
  }

  console.log(
    `[ws/media] connected from ${req.socket.remoteAddress} proto=${ws.protocol || '(none)'} url=${req.url} callSid=${sessionCallSid || 'unknown'}`
  );
  console.log('[ws/media] upgrade', summarizeHeaders(req.headers));
  const sampleWsPayload = createWsPayloadSampler(3);

  try {
    if (req.socket) {
      req.socket.setKeepAlive(true, 10000);
      req.socket.setNoDelay(true);
    }
  } catch {
    /* ignore */
  }

  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  let textFrames = 0;
  let binaryFrames = 0;
  let stt = null;
  let tts = null;
  let speaking = false;
  let speakStartedAt = 0;
  let playbackBytes = 0;
  let playbackStartedAt = 0;
  let lastAgentText = '';
  let llmRecoveryOffered = false;
  let emptyRepairOffered = false;
  let turnBusy = false;
  let utteranceParts = [];
  let utteranceLanguages = [];
  let utteranceTimer = null;
  let utteranceStartedAt = 0;
  /** Idle check-in only after the caller has actually spoken. */
  let heardCallerUtterance = false;
  /** Brain END is in flight. No idle nudge and no next caller turn. */
  let callEnding = false;
  const overlapHold = createOverlapHold();
  const lateFinals = createLateFinalHold();
  const agentReplay = createAgentReplayMemory();
  const speakCommit = createSpeakCommit();
  // The carrier said the call ended (Completed webhook) or the socket closed.
  // Nothing more is spoken: no idle nudge, no held-turn reply.
  function callIsOver() {
    if (ws.readyState !== WebSocket.OPEN) return true;
    const ended = callTerminalSince(sidLabel(), connectedAt);
    if (ended) {
      console.log(
        `[ws/media][${sidLabel()}] call already ended (${ended.source || 'webhook'} ${ended.status || ''}), nothing more spoken`
      );
      return true;
    }
    return false;
  }
  const idleNudge = createIdleNudgeController({
    canFire: () =>
      ws.readyState === WebSocket.OPEN &&
      !callEnding &&
      !speaking &&
      !turnBusy &&
      !speechOutageStarted &&
      !utteranceParts.length &&
      !pendingUtterance &&
      !callIsOver(),
    speak: () => {
      // Re-checked at speak time: the end can land between fire and speak.
      if (callIsOver()) return null;
      const line = pickIdleNudgeLine({ language: callLanguage });
      console.log(`[ws/media][${sidLabel()}] idle_nudge`);
      return speakText(line, { isIdleNudge: true }).then((spoken) => {
        if (spoken?.ok) {
          callTranscript.pushAgent(line);
          messages.push({ role: 'assistant', content: line, local: true });
        }
      });
    },
  });
  // An unfinished caller turn ("Nilikuwa nauliza,") is held, not answered.
  // New caller words merge with it. If the caller stays quiet for the hold
  // window, it is answered by the model (holdTimedOut), never by an
  // early-return line such as the file-name ask.
  const unfinishedHold = createUnfinishedHold({
    delayMs: unfinishedHoldMs(),
    canFire: () =>
      ws.readyState === WebSocket.OPEN &&
      !speaking &&
      !turnBusy &&
      !utteranceParts.length &&
      !pendingUtterance,
    onTimeout: (text, signals) => {
      if (callEnding || callIsOver()) return;
      console.log(
        `[ws/media][${sidLabel()}] unfinished hold timed out after ${unfinishedHold.delayMs}ms, replying: ${text}`
      );
      runCallerTurn(text, { ...signals, holdTimedOut: true }).catch((err) => {
        console.error(`[ws/media][${sidLabel()}] runCallerTurn error:`, err?.message || err);
      });
    },
  });
  function commitAgentQuestionIfNeeded(opts = {}) {
    const snap = agentReplay.snapshot();
    const committed = agentReplay.commitPlayback();
    const spokenAsk = snap.pendingSpeech;
    const brain = callBrainStates.get(sidLabel());
    if (brain && spokenAsk) {
      noteSpokenPendingAsk(brain, spokenAsk);
      callBrainStates.set(sidLabel(), brain);
    }
    if (snap.pendingIsQuestion) {
      console.log(`[ws/media][${sidLabel()}] agent_question_committed`);
      // Do not poke "still there?" after the greeting. Wait until the caller has spoken.
      idleNudge.arm({
        skip: Boolean(opts.isIdleNudge) || !heardCallerUtterance,
      });
    }
    return committed;
  }
  function noteCallerSpeechForIdle(text) {
    const sample = String(text || '').trim();
    if (!sample || sample.length < 3) return;
    if (looksLikeEcho(text)) return;
    idleNudge.clear();
  }
  let fillerTimer = null;
  /** When true, discard the in-flight Gemini/TTS reply and wait for the caller turn. */
  let bargeInActive = false;
  /** Sticky for the turn that was barged. The next caller turn clears it. */
  let suppressReplyRemainder = false;
  /** Line that was playing when barge cancelled TTS. Tails of it are not re-spoken. */
  let bargeCancelledText = '';
  let playbackGeneration = 0;
  let activePlaybackGeneration = 0;
  let pendingUtterance = null;
  let pendingTurnSignals = {
    unfinished: false,
    weak: false,
    weakStt: false,
    tokenLanguages: [],
  };
  let systemPrompt = buildSystemPrompt();
  let greetingLine = buildGreeting(process.env.BUSINESS_NAME || 'the business');
  let businessName = process.env.BUSINESS_NAME || 'the business';
  let agentName = process.env.AGENT_NAME || 'Receptionist';
  let spokenName = '';
  let greetingInvite = '';
  let hoursSchedule = null;
  let openStatus = 'unknown';
  let afterHoursMode = 'serve';
  let closureNotice = null;
  let messages = [{ role: 'system', content: systemPrompt }];
  const callTranscript = createCallTranscript();
  function logTurnTiming(timing, extra) {
    if (!timing) return null;
    const summary = timing.log(extra);
    callTranscript.stampFromSummary(summary);
    voiceTrace.commitTurn({
      outcome: extra?.outcome || 'ok',
      latency: summary,
      turnStartedAt: timing.turnStartedAt,
    });
    return summary;
  }
  let greetingStarted = false;
  let greetingAwaitingFirstPcm = false;
  // A barge cancels the greeting before its name ask can be heard.
  // Until this process commits that line, the caller turn must say it.
  let greetingInterrupted = false;
  let greetingSettled = false;
  let fileNameAsksCommitted = 0;
  const firstForward = {
    greetingPlayed: false,
    greetingLogged: false,
    hasStt: false,
    bargedJob: false,
    bargeText: '',
    firstCallerTurn: '',
    connectToGreetingPcmMs: null,
  };

  function noteGreetingPcm({ cached = false } = {}) {
    if (firstForward.greetingLogged) return;
    firstForward.greetingLogged = true;
    firstForward.greetingPlayed = true;
    greetingAwaitingFirstPcm = false;
    const at = Date.now();
    const logged = logConnectToGreetingPcm({
      callSid: sidLabel(),
      connectedAt,
      firstPcmAt: at,
      cached,
    });
    firstForward.connectToGreetingPcmMs = logged.connect_to_greeting_pcm_ms;
    if (sessionCallSid) {
      patchFirstForward(sessionCallSid, {
        greetingPlayed: true,
        connectToGreetingPcmMs: logged.connect_to_greeting_pcm_ms,
      });
    }
  }

  /** Soniox 402/fatal: speak a local fallback once, then hang up. */
  let speechOutageStarted = false;
  let profileLoaded = false;
  let profileCallSid = null;
  /** Sticky call language: 'en' | 'sw' | 'sheng' | 'mixed' | 'unknown' */
  let callLanguage = 'unknown';
  let callLanguageState = createLanguageState();
  let brainProfile = {};
  /** Caller-requested TTS speed scale for this call (1 = profile default). */
  let ttsSpeedScale = 1;
  /** Soniox stream id for the in-flight thinking-ack (cancel this only — keep reply prefetch). */
  let fillerStreamId = null;
  /** Only PCM from this stream id is forwarded (drops orphan filler / cancelled audio). */
  let activeOutboundStreamId = null;
  /** Resolves when TTS session is assigned and connected (or null if unavailable). */
  let resolveTtsReady = null;
  const ttsReadyPromise = new Promise((resolve) => {
    resolveTtsReady = resolve;
  });
  /** @type {ReturnType<typeof createVoiceTurnTiming>|null} */
  let activeTurnTiming = null;
  // The turn whose thinking-ack started last, and when. A tool hold on that
  // same turn is skipped while the ack is recent (HD_c98820e579e1 t10).
  let thinkingAckTurn = null;
  let thinkingAckAtMs = 0;
  // An ack or a hold played on this turn: a tool outcome drops its "Okay." lead.
  let ackPlayedTurn = null;
  /** Rolling interim hypothesis while agent is busy (for barge-in). */
  let interimBargeText = '';
  /** Optional per-tenant TTS lexicon overrides: [{ match, say }]. */
  let ttsLexiconOverrides = [];
  /** Tenant-selected Soniox voice from curated catalog. */
  let tenantSonioxVoiceId = null;
  /** Voice id the live TTS websocket was opened with. */
  let ttsSessionVoiceId = null;
  /** Latest tenant fields used to build Soniox STT context (hearing path). */
  let sttTenantSnapshot = null;

  const sidLabel = () => sessionCallSid || `media_${connectedAt}`;
  const voiceTrace = createVoiceTrace({
    callId: () => sidLabel(),
    tenantId: () => brainProfile?.id || null,
    voiceId: () => resolveSonioxVoice(tenantSonioxVoiceId),
  });
  function publishVoiceTrace() {
    bindVoiceTrace(sessionCallSid, voiceTrace);
    bindVoiceTrace(sidLabel(), voiceTrace);
  }
  publishVoiceTrace();

  function publishSttContext(profile) {
    if (!profile) {
      sttTenantSnapshot = null;
      return null;
    }
    sttTenantSnapshot = {
      businessName: profile.businessName || businessName,
      agentName: profile.agentName || agentName,
      vertical: profile.vertical || 'general',
      servicesCatalog: profile.servicesCatalog || [],
      businessLocations: profile.businessLocations || [],
      // Coverage towns bias hearing too. HD_015bae4a4af2 heard "Kitengele"
      // because the snapshot never carried coverage_areas.
      businessPolicies: profile.businessPolicies || {},
      teamDirectory: profile.teamDirectory || [],
      ttsLexicon: Array.isArray(profile.ttsLexicon) ? profile.ttsLexicon : [],
      callerMemory: profile.callerMemory
        ? {
            name: profile.callerMemory.fileOwnerName || profile.callerMemory.name || null,
            fileOwnerName:
              profile.callerMemory.fileOwnerName || profile.callerMemory.name || null,
            alternateNames: Array.isArray(profile.callerMemory.alternateNames)
              ? profile.callerMemory.alternateNames
              : [],
          }
        : null,
    };
    return buildSttContext(sttTenantSnapshot);
  }

  async function ensureTenantPrompt() {
    if (profileLoaded && profileCallSid === sessionCallSid) {
      return buildSttContext(sttTenantSnapshot);
    }
    try {
      const profile = await db.getTenantProfile({ callSid: sessionCallSid });
      await hydrateCallerMemory(profile, sessionCallSid);
      brainProfile = profile;
      businessName = profile.businessName || businessName;
      agentName = profile.agentName || agentName;
      spokenName = profile.spokenName || '';
      greetingInvite = profile.greetingInvite || '';
      hoursSchedule = profile.hoursSchedule || null;
      afterHoursMode = profile.afterHoursMode || 'serve';
      openStatus = openClosedStatus(hoursSchedule);
      closureNotice = bulletinClosureNotice(profile.dailyBulletin);
      systemPrompt = buildSystemPrompt(profile);
      ttsLexiconOverrides = Array.isArray(profile.ttsLexicon)
        ? profile.ttsLexicon
        : [];
      tenantSonioxVoiceId = profile.sonioxVoiceId || null;
      if (sessionCallSid) {
        const parsedTools = parseAgentTools(profile.agentTools);
        callAgentTools.set(sessionCallSid, parsedTools);
        callTenantProfiles.set(sessionCallSid, profile);
        callBrainStates.set(sessionCallSid, createBrainState(profile));
        callBrainCapabilities.set(
          sessionCallSid,
          capabilitiesForProfile(profile, parsedTools)
        );
      }
      greetingLine = buildGreeting(businessName, {
        agentName,
        spokenName,
        greetingInvite,
        isOpen: openStatus === 'unknown' ? null : openStatus === 'open',
        afterHoursMode,
        closureNotice,
        callerFileName:
          afterHoursMode === 'message' ? messageFileOwnerName(profile) : '',
      });
      messages = [{ role: 'system', content: systemPrompt }];
      profileLoaded = true;
      profileCallSid = sessionCallSid;
      const tools = parseAgentTools(profile.agentTools);
      const sttCtx = publishSttContext(profile);
      console.log(
        `[ws/media][${sidLabel()}] tenant prompt loaded business=${businessName || 'unknown'} agent=${agentName} voice=${resolveSonioxVoice(tenantSonioxVoiceId)} open=${openStatus} afterHours=${afterHoursMode} bulletinClosed=${Boolean(closureNotice)} customPrompt=${Boolean(profile.llmSystemPrompt)} escalate=${tools.escalate} endCall=${tools.end_call} ttsLexicon=${ttsLexiconOverrides.length} sttTerms=${sttCtx?.terms?.length || 0} langs=en,sw,sheng(auto)`
      );
      return sttCtx;
    } catch (err) {
      profileLoaded = true;
      profileCallSid = sessionCallSid;
      publishSttContext(null);
      console.warn(
        `[ws/media][${sidLabel()}] tenant prompt load failed, using defaults:`,
        err?.message || err
      );
      return null;
    }
  }

  function clearFillerTimer() {
    if (fillerTimer) {
      clearTimeout(fillerTimer);
      fillerTimer = null;
    }
  }

  function lastAskedQuestion() {
    return agentAwaitingReply(lastAgentText) || agentReplay.isAwaiting();
  }

  function hearAgainReplayText() {
    return agentReplay.pickReplay();
  }

  function releaseQueuedCallerSpeech(endedGeneration) {
    const gen =
      endedGeneration != null ? endedGeneration : activePlaybackGeneration;
    const { text, duplicate } = overlapHold.drain(gen);
    if (duplicate) {
      console.log(
        `[ws/media][${sidLabel()}] caller_turn_duplicate_suppressed gen=${gen}`
      );
      return;
    }
    if (text) {
      utteranceParts.push(text);
      console.log(
        `[ws/media][${sidLabel()}] caller_turn_released gen=${gen}`
      );
      scheduleUtteranceFlush();
      return;
    }
    if (utteranceParts.length) {
      scheduleUtteranceFlush();
      return;
    }
    kickPendingTurn();
  }

  function hangupAfterSpeechOutage(delayMs) {
    setTimeout(() => {
      try {
        ws.close(1000, 'speech_outage');
      } catch {
        /* ignore */
      }
    }, Math.max(400, Number(delayMs) || 2500));
  }

  /**
   * Play PCM that did not come from a live Soniox stream (clone-voice clip / espeak).
   */
  async function playLocalPcm(pcm) {
    if (!pcm || !pcm.length) return 0;
    speaking = true;
    speakStartedAt = Date.now();
    activePlaybackGeneration = ++playbackGeneration;
    const gen = activePlaybackGeneration;
    if (ws.readyState === WebSocket.OPEN) sendPcmToMedia(ws, pcm);
    const waitMs = pcmDurationMs(pcm, 16000) + 200;
    await sleep(waitMs);
    if (activePlaybackGeneration === gen) {
      speaking = false;
      releaseQueuedCallerSpeech(gen);
    }
    return waitMs;
  }

  async function playCachedFillerPcm(pcm, { text, trace = true } = {}) {
    if (!pcm || !pcm.length) return { ok: false, empty: true };
    const streamId = newCachedFillerStreamId();
    bargeInActive = false;
    speaking = true;
    speakStartedAt = Date.now();
    lastAgentText = String(text || '');
    activePlaybackGeneration = ++playbackGeneration;
    const gen = activePlaybackGeneration;
    fillerStreamId = streamId;
    activeOutboundStreamId = streamId;
    if (activeTurnTiming) activeTurnTiming.markFirstPcm();
    if (trace) {
      voiceTrace.noteFiller({ text: String(text || ''), before: String(text || ''), language: callLanguage });
    }
    if (ws.readyState === WebSocket.OPEN) sendPcmToMedia(ws, pcm);
    const waitMs = pcmDurationMs(pcm, 16000);
    await sleep(waitMs);
    if (activePlaybackGeneration === gen) {
      speaking = false;
      if (activeOutboundStreamId === streamId) activeOutboundStreamId = null;
      if (fillerStreamId === streamId) fillerStreamId = null;
      if (!speechOutageStarted) releaseQueuedCallerSpeech(gen);
    }
    return { ok: true, cached: true };
  }

  async function speakThinkingAck(fillerText) {
    // Cached filler PCM was rendered at the profile speed; once the caller
    // asks for a different pace, render fillers fresh at the scaled speed.
    if (!isFillerCacheEnabled() || ttsSpeedScale !== 1) {
      return speakText(fillerText, { isFiller: true });
    }
    const found = lookupFillerPcm({
      voiceId: tenantSonioxVoiceId,
      text: fillerText,
      callLanguage,
      extraLexicon: ttsLexiconOverrides,
    });
    if (found.pcm) {
      console.log(
        `[ws/media][${sidLabel()}] thinking-ack cached lang=${callLanguage} bytes=${found.pcm.length}`
      );
      return playCachedFillerPcm(found.pcm, { text: fillerText });
    }
    return speakText(fillerText, { isFiller: true, fillerCacheKey: found.key });
  }

  /**
   * Soniox STT+TTS are billed out (402) or otherwise dead. Speak the clone-voice
   * downtime recording (same voice as the greeting) and hang up.
   */
  async function handleSpeechProviderOutage(reason) {
    if (speechOutageStarted) return { ok: false, outage: true };
    speechOutageStarted = true;
    unfinishedHold.close();
    greetingStarted = true;
    idleNudge.close();
    const clip = loadOutageClip(callLanguage, { voiceId: tenantSonioxVoiceId });
    const line = pickSpeechOutageLine(clip?.language || callLanguage);
    console.error(
      `[ws/media][${sidLabel()}] speech provider outage (${reason}): speaking clone-voice downtime clip`
    );
    void noteSpeechOutage({ profile: brainProfile }).catch((err) => {
      console.warn(
        `[ws/media][${sidLabel()}] owner outage alert failed:`,
        err?.message || err
      );
    });
    try {
      const pcm = await synthesizeEmergencyPcm(line, {
        language: callLanguage,
        voiceId: tenantSonioxVoiceId,
      });
      if (pcm?.length) {
        const waitMs = await playLocalPcm(pcm);
        callTranscript.pushAgent(line);
        messages.push({ role: 'assistant', content: line, local: true });
        hangupAfterSpeechOutage(waitMs);
        return { ok: true, outage: true, emergency: true };
      }
      console.error(
        `[ws/media][${sidLabel()}] emergency TTS produced no audio after ${reason}`
      );
    } catch (err) {
      console.error(
        `[ws/media][${sidLabel()}] emergency TTS failed:`,
        err?.message || err
      );
    }
    hangupAfterSpeechOutage(800);
    return { ok: false, outage: true };
  }


  /**
   * Greeting only. One open Soniox stream, one pushText per sentence, one end.
   * The cache stores this streamed render under the existing prepared-text key.
   * The slop cut does not run here. This is not speakText's single full-string push.
   */
  async function speakGreetingSentences(text, opts = {}) {
    if (!text) return { ok: false };
    if (speechOutageStarted) return { ok: false, outage: true };
    if (!tts && ttsReadyPromise) {
      try {
        await Promise.race([
          ttsReadyPromise,
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      } catch {
        /* ignore */
      }
    }
    if (!tts) {
      console.warn(
        `[ws/media][${sidLabel()}] greeting skipped — TTS unavailable: ${String(text).slice(0, 80)}`
      );
      return handleSpeechProviderOutage('tts unavailable');
    }
    bargeInActive = false;
    suppressReplyRemainder = false;
    if (/[.!?]$/.test(String(text).trim())) bargeCancelledText = '';
    lastAgentText = String(text);
    agentReplay.beginSpeech(text);
    activePlaybackGeneration = ++playbackGeneration;
    const gen = activePlaybackGeneration;
    const armId = `arming-${gen}`;
    activeOutboundStreamId = armId;
    speaking = true;
    speakStartedAt = Date.now();
    const extraLexicon = Array.isArray(opts.extraLexicon)
      ? opts.extraLexicon
      : mergeIdentityLexicon(ttsLexiconOverrides, { businessName, agentName });
    const prepared = prepareForTts(text, {
      callLanguage,
      extraLexicon,
    });
    voiceTrace.noteCall({
      stage: 'tts',
      path: 'greeting',
      text: prepared.text,
      before: String(text || ''),
      language: prepared.language,
    });
    console.log(
      `[ws/media][${sidLabel()}] greeting tts sentences lang=${prepared.language}` +
        ` original=${JSON.stringify(prepared.original)}` +
        ` spoken=${JSON.stringify(prepared.text)}`
    );
    let session = null;
    try {
      session = await tts.beginSpeak({
        callLanguage,
        language: prepared.language,
        alreadyPrepared: true,
        speedScale: 1,
        extraLexicon,
        capture: Boolean(opts.greetingCacheKey && isGreetingCacheEnabled() && ttsSpeedScale === 1),
      });
      if (bargeInActive || activePlaybackGeneration !== gen) {
        try {
          session.cancel();
        } catch {
          /* ignore */
        }
        if (activeOutboundStreamId === armId) activeOutboundStreamId = null;
        if (activePlaybackGeneration === gen) {
          activePlaybackGeneration = ++playbackGeneration;
        }
        return { ok: false, cancelled: true };
      }
      activeOutboundStreamId = session.streamId;
      const streamed = await speakPreparedSentences(session, prepared.text);
      const spoken = streamed.spoken;
      if (
        opts.greetingCacheKey &&
        spoken?.pcm?.length &&
        !spoken.cancelled &&
        isGreetingCacheEnabled()
      ) {
        putGreetingPcm(opts.greetingCacheKey, spoken.pcm);
      }
      if (!streamed.chunks.length || spoken?.empty) return { ok: false, empty: true };
      return { ok: !spoken?.cancelled, sentences: streamed.chunks.length };
    } catch (err) {
      console.error(`[ws/media][${sidLabel()}] greeting TTS failed:`, err?.message || err);
      try {
        session?.cancel();
      } catch {
        /* ignore */
      }
      const classified = classifySonioxError(err);
      if (classified.billing || classified.fatal) {
        return handleSpeechProviderOutage(
          `tts ${classified.code || classified.message}`
        );
      }
      return { ok: false };
    } finally {
      if (activePlaybackGeneration === gen) {
        speaking = false;
        if (
          activeOutboundStreamId === session?.streamId ||
          activeOutboundStreamId === armId
        ) {
          activeOutboundStreamId = null;
        }
        if (!speechOutageStarted) {
          commitAgentQuestionIfNeeded();
          releaseQueuedCallerSpeech(gen);
        }
      }
    }
  }

  async function speakToolHold(spoken) {
    if (!spoken?.speak || bargeInActive) return;
    if (
      spoken.kind === 'hold' &&
      thinkingAckTurn &&
      thinkingAckTurn === activeTurnTiming &&
      !holdSpeaksAfterAck({ kind: spoken.kind, ackAtMs: thinkingAckAtMs })
    ) {
      console.log(
        `[ws/media][${sidLabel()}] tool hold skipped after thinking-ack ${Date.now() - thinkingAckAtMs}ms: ${spoken.line}`
      );
      return;
    }
    if (spoken.kind === 'hold') ackPlayedTurn = activeTurnTiming;
    await speakText(spoken.line, {
      isFiller: spoken.kind === 'hold',
      skipFileGate: spoken.kind === 'hold',
    });
  }

  async function speakText(text, opts = {}) {
    if (!opts.skipFileGate && !opts.isFiller && !opts.isReplay && !opts.isIdleNudge) {
      const gated = gateCallerFileSpeech(text, callBrainStates.get(sidLabel()));
      if (!gated.speak) {
        console.log(
          `[ws/media][${sidLabel()}] file speech held reason=${gated.reason}`
        );
        return { ok: false, gated: true };
      }
      text = gated.line;
    }
    if (!text) return { ok: false };
    if (speechOutageStarted) return { ok: false, outage: true };
    // Greeting / early turns can race tenantWarm → TTS session create.
    if (!tts && ttsReadyPromise) {
      try {
        await Promise.race([
          ttsReadyPromise,
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ]);
      } catch {
        /* ignore */
      }
    }
    if (!tts) {
      console.warn(
        `[ws/media][${sidLabel()}] speakText skipped — TTS unavailable: ${String(text).slice(0, 80)}`
      );
      return handleSpeechProviderOutage('tts unavailable');
    }
    if (isOrphanFragment(bargeCancelledText, text)) {
      console.log(`[ws/media][${sidLabel()}] drop fragment restart after barge`);
      return { ok: false, fragment: true };
    }
    // Starting intentional playback clears a prior barge latch.
    bargeInActive = false;
    suppressReplyRemainder = false;
    if (/[.!?]$/.test(String(text).trim())) bargeCancelledText = '';
    lastAgentText = String(text);
    if (!opts.isFiller && !opts.isReplay) {
      agentReplay.beginSpeech(text);
    }
    activePlaybackGeneration = ++playbackGeneration;
    const gen = activePlaybackGeneration;
    // Hold a placeholder stream id until Soniox binds the real one.
    // speaking is true so barge still applies, but orphan PCM from the
    // cancelled stream cannot match this id.
    const armId = `arming-${gen}`;
    activeOutboundStreamId = armId;
    speaking = true;
    speakStartedAt = Date.now();
    // One owner for TTS language + pronunciation prep (per-utterance + sticky call lang).
    const extraLexicon = Array.isArray(opts.extraLexicon)
      ? opts.extraLexicon
      : mergeIdentityLexicon(ttsLexiconOverrides, { businessName, agentName });
    const prepared = prepareForTts(text, {
      callLanguage,
      language: opts.language,
      extraLexicon,
    });
    if (opts.isFiller) {
      voiceTrace.noteFiller({
        text: prepared.text,
        before: String(text),
        language: prepared.language,
      });
    } else {
      if (opts.tracePath) voiceTrace.noteCanned({ path: opts.tracePath, text });
      voiceTrace.noteTts({
        text: prepared.text,
        before: String(text),
        language: prepared.language,
      });
    }
    console.log(
      `[ws/media][${sidLabel()}] tts prep lang=${prepared.language}` +
        ` original=${JSON.stringify(prepared.original)}` +
        ` spoken=${JSON.stringify(prepared.text)}`
    );
    let session = null;
    try {
      // beginSpeak so we can track/cancel this stream without killing a reply prefetch.
      session = await tts.beginSpeak({
        language: prepared.language,
        callLanguage,
        alreadyPrepared: true,
        speed: speedForLanguage(prepared.language),
        speedScale: ttsSpeedScale,
        capture: Boolean(
          ((opts.isFiller && isFillerCacheEnabled()) ||
            (opts.isGreeting && isGreetingCacheEnabled())) &&
            ttsSpeedScale === 1
        ),
      });
      if (bargeInActive || activePlaybackGeneration !== gen) {
        try {
          session.cancel();
        } catch {
          /* ignore */
        }
        if (activeOutboundStreamId === armId) activeOutboundStreamId = null;
        // Supersede this generation so finally does not commit audio the caller never heard.
        if (activePlaybackGeneration === gen) {
          activePlaybackGeneration = ++playbackGeneration;
        }
        return { ok: false, cancelled: true };
      }
      activeOutboundStreamId = session.streamId;
      if (opts.isFiller) fillerStreamId = session.streamId;
      const pushed = session.pushText(prepared.text);
      if (!pushed.pushed) {
        session.cancel();
        return { ok: false, empty: true };
      }
      const spoken = await session.end();
      if (
        opts.isFiller &&
        opts.fillerCacheKey &&
        spoken?.pcm?.length &&
        !spoken.cancelled
      ) {
        putFillerPcm(opts.fillerCacheKey, spoken.pcm);
      }
      if (
        opts.isGreeting &&
        opts.greetingCacheKey &&
        spoken?.pcm?.length &&
        !spoken.cancelled
      ) {
        putGreetingPcm(opts.greetingCacheKey, spoken.pcm);
      }
      return { ok: true };
    } catch (err) {
      console.error(`[ws/media][${sidLabel()}] TTS speak failed:`, err?.message || err);
      try {
        session?.cancel();
      } catch {
        /* ignore */
      }
      const classified = classifySonioxError(err);
      if (classified.billing || classified.fatal) {
        return handleSpeechProviderOutage(
          `tts ${classified.code || classified.message}`
        );
      }
      return { ok: false };
    } finally {
      if (opts.isFiller && fillerStreamId && session?.streamId === fillerStreamId) {
        fillerStreamId = null;
      }
      if (activePlaybackGeneration === gen) {
        speaking = false;
        if (activeOutboundStreamId === session?.streamId) {
          activeOutboundStreamId = null;
        }
        if (!opts.isFiller && !opts.isReplay && !speechOutageStarted) {
          commitAgentQuestionIfNeeded({ isIdleNudge: opts.isIdleNudge });
        }
        if (!speechOutageStarted) releaseQueuedCallerSpeech(gen);
      }
    }
  }

  function cancelSpeech(reason) {
    voiceTrace.noteBarge({ reason: String(reason || '') });
    const endingGen = activePlaybackGeneration;
    clearFillerTimer();
    idleNudge.clear();
    bargeInActive = true;
    suppressReplyRemainder = true;
    bargeCancelledText = lastAgentText;
    playbackGeneration += 1;
    speaking = false;
    interimBargeText = '';
    fillerStreamId = null;
    activeOutboundStreamId = null;
    agentReplay.abandonPlayback();
    console.log(`[ws/media][${sidLabel()}] barge-in cancel (${reason})`);
    if (tts) {
      try {
        tts.cancel();
      } catch {
        /* ignore */
      }
    }
    clearMediaPlayback(ws);
    if (activeTurnTiming) {
      logTurnTiming(activeTurnTiming, { outcome: 'barge_in' });
      activeTurnTiming = null;
    }
    releaseQueuedCallerSpeech(endingGen);
  }

  function discardUnspokenAssistant(reply) {
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && last.content === reply) {
      messages.pop();
    }
  }

  let lastBargeSkipLogAt = 0;
  function maybeBargeIn(text, source) {
    // After a barge has cancelled the reply, the caller's final is the next
    // turn, not a continuation of the cancelled one (HD_015bae4a4af2 t6).
    const phaseInputs = bargePhaseInputs({
      speaking,
      turnBusy,
      bargeInActive,
      isFinal: String(source || '').startsWith('final'),
    });
    const decision = decideCallerEvent({
      text,
      speaking: phaseInputs.speaking,
      turnBusy: phaseInputs.turnBusy,
      speakStartedAt,
      lastAgentText,
      lastAgentAskedQuestion: lastAskedQuestion(),
      replayText: hearAgainReplayText(),
      now: Date.now(),
    });
    if (!decision.interrupt) {
      // Rate-limited diagnostics (interim STT is chatty).
      const now = Date.now();
      const sample = String(text || '').trim();
      if (
        (speaking || turnBusy) &&
        sample.length >= 5 &&
        now - lastBargeSkipLogAt > 900 &&
        decision.reason !== 'idle'
      ) {
        lastBargeSkipLogAt = now;
        console.log(
          `[ws/media][${sidLabel()}] barge skipped (${decision.reason}) src=${source}: ${sample.slice(0, 80)}`
        );
      }
      return decision;
    }
    if (!greetingSettled) greetingInterrupted = true;
    if (looksLikeJobNoun(text)) {
      firstForward.bargedJob = true;
      firstForward.bargeText = String(text || '').trim();
      if (sessionCallSid) {
        patchFirstForward(sessionCallSid, {
          bargedJob: true,
          bargeText: firstForward.bargeText,
          hasStt: true,
          firstCallerTurn: firstForward.firstCallerTurn || firstForward.bargeText,
        });
      }
    }
    cancelSpeech(`${source}/${decision.reason}`);
    return decision;
  }

  function looksLikeEcho(text) {
    return turnLooksLikeEcho(text, lastAgentText);
  }

  function kickPendingTurn() {
    if (callEnding || turnBusy || !pendingUtterance) return;
    const text = pendingUtterance;
    const signals = pendingTurnSignals;
    pendingUtterance = null;
    pendingTurnSignals = {
      unfinished: false,
      weak: false,
      weakStt: false,
      tokenLanguages: [],
    };
    runCallerTurn(text, signals).catch((err) => {
      console.error(`[ws/media][${sidLabel()}] runCallerTurn error:`, err?.message || err);
    });
  }

  function currentLlmRecoveryLine() {
    return pickLlmRecoveryLine({
      language: callLanguage,
      alreadyOffered: llmRecoveryOffered,
    });
  }

  async function resolveLlmRecoverySpeech(userText = '', opts = {}) {
    const health = getGeminiProviderHealth();
    if (!llmRecoveryOffered && (health.billingExhausted || health.denied)) {
      void noteSpeechOutage({ profile: brainProfile, kind: 'llm' }).catch((err) => {
        console.warn(
          `[ws/media][${sidLabel()}] owner reasoning alert failed:`,
          err?.message || err
        );
      });
    }
    const planned = planLlmRecovery({
      userText,
      alreadyOffered: llmRecoveryOffered,
      language: callLanguage,
    });
    if (planned.saved && planned.name) {
      try {
        await db.saveCallerInfo({
          callSid: sidLabel(),
          name: planned.name,
          reason: 'Live line could not complete. Team to follow up.',
        });
        maybeSendWhatsAppNotification(sidLabel());
      } catch (err) {
        console.error(
          `[ws/media][${sidLabel()}] llm recovery save failed:`,
          err?.message || err
        );
      }
    }
    // A catalogue outage speaks the Phase-0 list and must not burn the
    // name-ask offer. The next miss still asks for a name.
    if (opts.consumeOffer !== false) llmRecoveryOffered = true;
    return planned.spoken;
  }

  // A demand spike or a broken stream asks them to repeat once.
  // The reach-them name line is only for credits or a denied project.
  async function speechWhenModelMissed(result, userText, localReply) {
    if (result?.llmHardDown) {
      const mouth = planCatalogueMouth({
        localReply,
        text: userText,
        profile: brainProfile,
        language: callLanguage,
        reasoningDown: true,
        geminiCatalogue: geminiCatalogueEnabled(),
      });
      if (mouth.speakLocal && mouth.line) {
        await resolveLlmRecoverySpeech(userText, { consumeOffer: false });
        return mouth.line;
      }
      return resolveLlmRecoverySpeech(userText);
    }
    const planned = planEmptyGeminiSpeech({
      brainState,
      language: callLanguage,
      userText,
      llmDown: false,
      alreadyOffered: emptyRepairOffered,
      toolResults: result?.toolResults,
    });
    if (planned.speak && planned.line) {
      emptyRepairOffered = true;
      return planned.line;
    }
    return '';
  }

  async function runCallerTurn(userText, opts = {}) {
    let clean = String(userText || '').replace(/\s+/g, ' ').trim();
    const labelTurn = (text) =>
      labelFlushedCallerTurn({
        text,
        turnEnd: {
          ...(opts.turnEnd && typeof opts.turnEnd === 'object' ? opts.turnEnd : {}),
          unfinished: opts.turnEnd?.unfinished === true || opts.unfinished === true,
          weak: opts.turnEnd?.weak === true || opts.weak === true,
          weakStt: opts.turnEnd?.weakStt === true || opts.weakStt === true,
        },
      });
    let flushed = labelTurn(clean);
    if (!clean) return;
    idleNudge.clear();
    if (turnBusy) {
      // Merge continuation fragments into one pending utterance (don't drop context).
      pendingUtterance = pendingUtterance ? `${pendingUtterance} ${clean}` : clean;
      if (flushed.unfinished) pendingTurnSignals.unfinished = true;
      if (flushed.weak) pendingTurnSignals.weak = true;
      if (flushed.weakStt) pendingTurnSignals.weakStt = true;
      if (Array.isArray(opts.tokenLanguages) && opts.tokenLanguages.length) {
        pendingTurnSignals.tokenLanguages = (pendingTurnSignals.tokenLanguages || []).concat(
          opts.tokenLanguages
        );
      }
      return;
    }
    // A held unfinished turn joins these words, and its timer stops.
    if (unfinishedHold.pending()) {
      clean = unfinishedHold.take(clean);
      flushed = labelTurn(clean);
      console.log(`[ws/media][${sidLabel()}] unfinished hold merged: ${clean}`);
    }
    // A new caller turn may speak. The previous barge must not swallow it.
    suppressReplyRemainder = false;

    const idleDecision = decideCallerEvent({
      text: clean,
      speaking: false,
      turnBusy: false,
      lastAgentText,
      lastAgentAskedQuestion: lastAskedQuestion(),
      replayText: hearAgainReplayText(),
      phase: 'idle',
      isFinal: true,
    });
    const replayLine = hearAgainReplayText();
    if (idleDecision.replay && replayLine) {
      // Mid-call replay must not speak a canned line and end the turn.
      console.log(
        `[ws/media][${sidLabel()}] agent_question_replay reason=${idleDecision.reason} stays-on-stream`
      );
    }
    // Skip pure noise, but keep yes/no and short names when the agent just asked.
    const skipBrain = callBrainStates.get(sidLabel());
    if (
      shouldSkipCallerTurn(clean, {
        lastAgentText,
        pendingAsk: skipBrain?.conversation?.pendingAsk,
        questionsAsked: skipBrain?.conversation?.questionsAsked,
      })
    ) {
      console.log(`[ws/media][${sidLabel()}] skip non-substantive turn: ${clean}`);
      voiceTrace.beginTurn({ callerText: clean });
      voiceTrace.noteTurnEnd({ decision: 'skip', reason: 'non_substantive' });
      voiceTrace.commitTurn({ outcome: 'skip' });
      return;
    }

    overlapHold.discardExcept(0);
    turnBusy = true;
    bargeInActive = false;
    const turnTiming = createVoiceTurnTiming(sidLabel());
    activeTurnTiming = turnTiming;

    const callKey = sidLabel();
    // An unfinished caller turn is held before Brain observes it, so the
    // merged words are observed once. Every reply waits, the file-name ask
    // and local lines included. The hold timer answers it if the caller stays
    // quiet (holdTimedOut), and the idle nudge stays armed as a second net.
    const unfinishedGate = unfinishedTurnHold(callBrainStates.get(callKey) || null, {
      text: clean,
      profile: brainProfile,
      agentAwaitingReply: Boolean(lastAskedQuestion()),
      holdTimedOut: opts.holdTimedOut === true,
    });
    if (unfinishedGate) {
      console.log(
        `[ws/media][${callKey}] unfinished turn, reply waits ${unfinishedHold.delayMs}ms lang=${callLanguage}: ${clean}`
      );
      voiceTrace.beginTurn({ callerText: clean, language: callLanguageState });
      voiceTrace.noteTurnEnd({ decision: 'hold', reason: 'unfinished' });
      voiceTrace.commitTurn({ outcome: 'hold' });
      unfinishedHold.hold(clean, {
        unfinished: true,
        weak: flushed.weak,
        weakStt: flushed.weakStt,
        tokenLanguages: opts.tokenLanguages,
      });
      idleNudge.arm({ skip: !heardCallerUtterance });
      if (activeTurnTiming === turnTiming) activeTurnTiming = null;
      turnBusy = false;
      kickPendingTurn();
      return;
    }
    const languageEvidence = analyzeCallerLanguage(clean, {
      tokenLanguages: opts.tokenLanguages,
    });
    callLanguageState = resolveLanguageState(callLanguageState, languageEvidence);
    callLanguage = callLanguageState.current;

    // Caller asking for slower/faster speech adjusts the actual voice speed,
    // so the model never needs "..." chains to pace itself.
    const speedRequest = detectSpeedRequest(clean);
    if (speedRequest) {
      const nextScale = nextSpeedScale(ttsSpeedScale, speedRequest.action);
      if (nextScale !== ttsSpeedScale) {
        ttsSpeedScale = nextScale;
        console.log(
          `[ws/media][${callKey}] caller speed request=${speedRequest.action} scale=${ttsSpeedScale}`
        );
      }
    }
    // Live miss HD_391a57aae9e9: "slower" must not restart who-is-speaking / visit SOP.
    if (looksLikePaceOnlyTurn(clean)) {
      // Okay / Sawa must not speak-and-return. The model keeps the sentence stream.
      console.log(`[ws/media][${callKey}] pace-only stays on sentence stream lang=${callLanguage}`);
    }
    const capabilities =
      callBrainCapabilities.get(callKey) ||
      capabilitiesForProfile(brainProfile, callAgentTools.get(callKey) || parseAgentTools(null));
    const previousBrainState =
      callBrainStates.get(callKey) || createBrainState(brainProfile);
    const provisionalIntent = inferIntent(clean, {
      vertical: brainProfile?.vertical,
    });
    const entityIntent =
      provisionalIntent === 'general_enquiry' &&
      previousBrainState.goal.status === 'active'
        ? previousBrainState.intent
        : provisionalIntent;
    const entities = extractConversationEntities(clean, {
      profile: brainProfile,
      intent: entityIntent,
      state: previousBrainState,
    });
    const fileStamp = liveCallerFileStamp(brainProfile?.callerMemory);
    let brainState = observeCallerTurn(
      previousBrainState,
      observeCallerInput(
        {
          text: clean,
          languageState: callLanguageState,
          entities,
          profile: brainProfile,
          lastAgentText,
        },
        {
          turnEnd: {
            unfinished: flushed.unfinished,
            weak: flushed.weak,
            weakStt: flushed.weakStt,
          },
        }
      )
    );
    if (liveCallerFileStamp(brainProfile?.callerMemory) !== fileStamp) {
      systemPrompt = buildSystemPrompt(brainProfile);
    }
    const nextBestAction = determineNextBestAction({ state: brainState, capabilities });
    brainState = setNextBestAction(brainState, nextBestAction);
    if (
      previousBrainState?.caller?.nameConfirmed !== true &&
      brainState?.caller?.nameConfirmed === true
    ) {
      brainState.caller.nameJustConfirmed = true;
    }
    callBrainStates.set(callKey, brainState);
    callBrainCapabilities.set(callKey, capabilities);
    logBrainTrace({
      callSid: callKey,
      phase: 'decision',
      state: brainState,
      decision: nextBestAction,
    });
    voiceTrace.beginTurn({ callerText: clean, language: callLanguageState });
    voiceTrace.noteLanguage({
      detected: languageEvidence.language,
      sticky: callLanguage,
      soniox: dominantSonioxLanguage(opts.tokenLanguages),
      confidence: languageEvidence.confidence,
    });
    voiceTrace.noteTurnEnd({ decision: 'flush', reason: 'caller_turn_processed' });
    console.log(
      `[ws/media][${callKey}] caller turn lang=${callLanguage}` +
        ` detected=${languageEvidence.language} confidence=${languageEvidence.confidence}` +
        ` intent=${brainState.intent} goal=${brainState.goal.primary}` +
        ` next=${nextBestAction.action}: ${clean}`
    );
    callTranscript.pushCaller(clean);
    messages.push({ role: 'user', content: clean });

    const turnMatches = selectProductsForTurn({
      catalog: brainProfile.productCatalog,
      queryText: clean,
      entities: brainState.entities,
      intent: brainState.intent,
    });
    const catalogSize = normalizeProducts(brainProfile.productCatalog).length;
    const turnSystemPrompt = [
      systemPrompt,
      formatAuthorityPolicy(capabilities),
      formatBrainStateForPrompt(brainState),
      formatEscalateActionDirective(brainState),
      formatCreateRequestDirective(brainState),
      formatTargetedProductsForPrompt(turnMatches, {
        totalCatalogSize: catalogSize,
        queryText: clean,
        catalog: brainProfile.productCatalog,
      }),
      languageDirective(callLanguage),
    ]
      .filter(Boolean)
      .join('\n\n');

    let spokeThisTurn = false;
    let progressAlreadySpoken = false;
    let hidInternalNarration = false;
    let speechHold = { holdSpeech: false, holdNameConfirm: false, holdVisitLookup: false };
    let suppressModelSpeech = false;
    let spokeLookupSentence = false;
    try {
      // Ground the file fact and commit it before the name ask and before END.
      // A later gate reads the packet. It does not refuse the outcome.
      function slotRows(state) {
        const slots = state?.conversation?.speakSlots;
        if (!Array.isArray(slots)) return [];
        return slots
          .filter((slot) => slot && slot.line)
          .map((slot) => ({
            outcome: String(slot.outcome || ''),
            line: String(slot.line || ''),
            language: slot.language || null,
          }));
      }
      function packetRows() {
        return [...speakCommit.unsaidPublic(), ...speakCommit.unsaidStepUp()].map((row) => ({
          tier: row.tier,
          outcome: row.outcome,
          text: row.text,
        }));
      }
      function traceCommittedPackets(before) {
        const seen = new Set(before.map((row) => `${row.tier}|${row.outcome}|${row.text}`));
        for (const row of packetRows()) {
          const key = `${row.tier}|${row.outcome}|${row.text}`;
          if (seen.has(key)) continue;
          voiceTrace.noteSpeakPacket({
            tier: row.tier,
            outcome: row.outcome,
            text: row.text,
            committed: true,
          });
          seen.add(key);
        }
      }
      function noteSlotDrain(before) {
        const after = slotRows(brainState);
        const removed = before.filter(
          (slot) => !after.some((row) => row.outcome === slot.outcome && row.line === slot.line)
        );
        if (removed.length) voiceTrace.noteSpeakSlots({ action: 'drain', slots: removed });
      }
      // A booking or callback confirmed after a barge-in is still owed.
      // Speak it first, before a local fact or the model reply.
      const owedOutcome = takeToolOutcome(brainState);
      if (owedOutcome) {
        callBrainStates.set(callKey, brainState);
        console.log(`[ws/media][${callKey}] speaking queued tool outcome`);
        callTranscript.pushAgent(owedOutcome);
        const owedSpoken = await speakText(owedOutcome);
        if (owedSpoken?.ok) {
          messages.push({ role: 'assistant', content: owedOutcome, local: true });
        } else {
          queueToolOutcome(brainState, owedOutcome);
          callBrainStates.set(callKey, brainState);
        }
      }
      const slotsBeforeReply = slotRows(brainState);
      const localReply = resolveLocalReply({
        text: clean,
        state: brainState,
        profile: brainProfile,
        language: callLanguage,
        agentName,
        businessName,
        nextBestAction,
      });
      const enqueuedSlots = slotRows(brainState).filter(
        (slot) =>
          !slotsBeforeReply.some((row) => row.outcome === slot.outcome && row.line === slot.line)
      );
      if (enqueuedSlots.length) {
        voiceTrace.noteSpeakSlots({ action: 'enqueue', slots: enqueuedSlots });
      }
      function noteCatalogueListed() {
        if (!brainState.conversation || typeof brainState.conversation !== 'object') {
          brainState.conversation = {};
        }
        brainState.conversation.catalogueListed = true;
        callBrainStates.set(callKey, brainState);
      }
      // Local Phase-0 breath owns a services ask, including one the name gate
      // would otherwise take, and a Yes while that list is still pending.
      const catalogueMouth = planCatalogueMouth({
        localReply,
        text: clean,
        profile: brainProfile,
        language: callLanguage,
        state: brainState,
        callerTurns: brainState?.conversation?.answersReceived,
        catalogueListed: brainState?.conversation?.catalogueListed === true,
        reasoningDown:
          geminiReasoningDown(getGeminiProviderHealth()) ||
          !String(process.env.GEMINI_API_KEY || '').trim(),
        geminiCatalogue: geminiCatalogueEnabled(),
      });
      const packetsBeforeFacts = packetRows();
      const localPacket = commitTurnFacts(speakCommit, {
        localReply,
        catalogueLine:
          catalogueMouth.speakLocal && catalogueMouth.line ? catalogueMouth.line : '',
        catalogueListed: brainState?.conversation?.catalogueListed === true,
        groundedPrice: groundFilePriceLine({
          profile: brainProfile,
          text: clean,
          callerTurns: brainState?.conversation?.answersReceived,
          state: brainState,
          language: callLanguage,
        }),
      });
      traceCommittedPackets(packetsBeforeFacts);
      if (localReply && !localPacket && !authorizeSpeak(localReply)) {
        voiceTrace.noteSpeakPacket({
          tier: 'private',
          outcome: localReply.outcome,
          text: localReply.line,
          committed: false,
        });
        console.log(
          `[ws/media][${callKey}] ${localReply.outcome} local line not spoken lang=${callLanguage}: ${localReply.line}`
        );
      }
      // Phone file already has a name: ask only that. Do not let the model
      // ask as if the name were missing, and do not attach visits.
      // A greeting barge reaches this gate before Gemini. The model does not run.
      // A committed public fact still speaks before that ask.
      // The unfinished hold was decided before Brain observed this turn. A
      // held fragment that timed out is answered by the model, not the ask.
      const nameGate = planCallerModelTurn(brainState, {
        greetingBarged: greetingInterrupted && !greetingSettled,
        fileNameAskCommitted: fileNameAsksCommitted > 0,
        unfinishedDecided: true,
        holdTimedOut: opts.holdTimedOut === true,
      });
      if (nameGate.nameAskDeferred) {
        console.log(`[ws/media][${callKey}] name ask deferred: held fragment timed out, model replies`);
      }
      const fileNameAsk = lockFileNameAsk(nameGate.line, callLanguage);
      const nameJustConfirmed = brainState?.caller?.nameJustConfirmed === true;
      const askingName = !nameGate.runModel && Boolean(fileNameAsk) && !nameJustConfirmed;
      const endClose = planBrainEndClose({
        action: nextBestAction.action,
        language: callLanguage,
      });
      const packetsBeforeSlots = packetRows();
      if (askingName || nameJustConfirmed || endClose.close) {
        commitReadySpeakSlots(speakCommit, brainState, {
          nameJustConfirmed: nameJustConfirmed || endClose.close,
          catalogueListed: brainState?.conversation?.catalogueListed === true,
        });
      }
      traceCommittedPackets(packetsBeforeSlots);
      const planned = speakCommit.planCommittedSpeech({
        endAction: endClose.close ? 'END' : '',
        nameAsk: askingName ? fileNameAsk : '',
        nameJustConfirmed,
        state: brainState,
      });
      if (planned.farewell) {
        callEnding = true;
        unfinishedHold.close();
        console.log(
          `[ws/media][${callKey}] brain-end farewell lang=${callLanguage}: ${endClose.line}`
        );
        await runBrainEndClose({
          action: nextBestAction.action,
          language: callLanguage,
          idle: idleNudge,
          speak: async (line) => {
            bargeInActive = false;
            suppressReplyRemainder = false;
            callTranscript.pushAgent(line);
            turnTiming.markFirstSpokenChunk();
            playbackBytes = 0;
            playbackStartedAt = 0;
            await speakText(line);
            spokeThisTurn = true;
          },
          hangup: () => {
            const delay = farewellHangupDelayMs({
              bytes: playbackBytes,
              startedAt: playbackStartedAt,
            });
            console.log(`[ws/media][${sidLabel()}] brain-end hangup in ${delay}ms`);
            setTimeout(() => {
              try {
                ws.close(1000, 'end_call');
              } catch {
                /* ignore */
              }
            }, delay);
          },
        });
        return;
      }
      if (planned.lines.length) {
        const slotsBeforePlanned = slotRows(brainState);
        drainSpokenSpeakSlots(brainState, planned.lines);
        noteSlotDrain(slotsBeforePlanned);
        callBrainStates.set(callKey, brainState);
        const spokeCatalogue =
          catalogueMouth.speakLocal &&
          Boolean(catalogueMouth.line) &&
          planned.lines.includes(catalogueMouth.line);
        if (spokeCatalogue && catalogueMouth.reason === 'outage') {
          await resolveLlmRecoverySpeech(clean, { consumeOffer: false });
        }
        if (spokeCatalogue) {
          noteCatalogueListed();
          console.log(
            `[ws/media][${callKey}] catalogue fallback reason=${catalogueMouth.reason} lang=${callLanguage}: ${catalogueMouth.line}`
          );
        }
        if (askingName && planned.lines.includes(fileNameAsk)) {
          brainState.caller.fileNameAskSpoken = true;
          fileNameAsksCommitted += 1;
          callBrainStates.set(callKey, brainState);
          console.log(`[ws/media][${callKey}] file name ask: ${fileNameAsk}`);
          if (planned.lines.length > 1) {
            console.log(
              `[ws/media][${callKey}] local answer before name ask: ${planned.lines[0]}`
            );
          }
        } else if (nameJustConfirmed) {
          console.log(
            `[ws/media][${callKey}] pending public after name lang=${callLanguage}: ${planned.lines[0]}`
          );
        }
        bargeInActive = false;
        suppressReplyRemainder = false;
        for (const line of planned.lines) {
          callTranscript.pushAgent(line);
          turnTiming.markFirstSpokenChunk();
          const nameAsk = askingName && line === fileNameAsk;
          await speakText(
            line,
            speakCommit.wasSpoken(line)
              ? { skipFileGate: true, ...(nameAsk ? { tracePath: 'file_name_ask' } : {}) }
              : nameAsk
                ? { tracePath: 'file_name_ask' }
                : {}
          );
          spokeThisTurn = true;
        }
        return;
      }
      // Name Yes: a public fact the name gate did not speak is still the answer.
      // SpeakPacket already returned when it spoke the fact. This speaks a
      // public slot that is still unanswered, then Voice drains that line.
      if (
        localReply &&
        nameJustConfirmed &&
        isSpeakSlotOutcome(localReply.outcome) &&
        !speakCommit.wasSpoken(localReply.line)
      ) {
        const heldPacket = authorizeSpeak(localReply);
        const catalogueAlready =
          localReply.outcome === 'catalogue' &&
          (brainState?.conversation?.catalogueListed === true ||
            brainState?.conversation?.catalogueAnswered === true);
        if (heldPacket && heldPacket.tier === 'public' && !catalogueAlready) {
          const heldFact = heldPacket.text;
          const slotsBeforeHeld = slotRows(brainState);
          drainSpokenSpeakSlots(brainState, [heldFact]);
          noteSlotDrain(slotsBeforeHeld);
          callBrainStates.set(callKey, brainState);
          console.log(
            `[ws/media][${callKey}] speak slot after name yes ${localReply.outcome} lang=${callLanguage}: ${heldFact}`
          );
          bargeInActive = false;
          suppressReplyRemainder = false;
          callTranscript.pushAgent(heldFact);
          turnTiming.markFirstSpokenChunk();
          playbackBytes = 0;
          playbackStartedAt = 0;
          await speakText(heldFact, { skipFileGate: true });
          spokeThisTurn = true;
          return;
        }
      }
      speechHold = holdCallerSpeech(callKey, messages);
      const fileReadAsk = localReply?.outcome === 'file_read';
      // Name lock holds speech in the hold record, but must not publish the
      // open file. A visit lookup after the lock still can.
      suppressModelSpeech = shouldPublishOpenFileSentence(speechHold, fileReadAsk);
      const visitAsk =
        looksLikeOpenVisitLookup(clean) ||
        looksLikeVisitReviewMore(clean) ||
        looksLikeHistoryReview(clean);
      let visitAppointments = [];
      if (
        visitAsk &&
        brainState?.messageOnly !== true &&
        brainState?.caller?.nameConfirmed === true &&
        brainState?.caller?.nameJustConfirmed !== true
      ) {
        visitAppointments = await loadVisitReviewAppointments(callKey, brainProfile);
      }
      const visitRead = planVisitReadTurn({
        nameConfirmed: brainState?.caller?.nameConfirmed === true,
        nameJustConfirmed: brainState?.caller?.nameJustConfirmed === true,
        callerText: clean,
        messageOnly: brainState?.messageOnly === true,
        language: callLanguage,
        openVisits: brainState?.returning?.openVisits,
        appointments: visitAppointments,
        cursor: brainState?.conversation?.visitReview || null,
      });
      if (visitRead.runModel === false && visitRead.line) {
        if (!brainState.conversation || typeof brainState.conversation !== 'object') {
          brainState.conversation = {};
        }
        brainState.conversation.visitReview = visitRead.cursor;
        callBrainStates.set(callKey, brainState);
        console.log(`[ws/media][${callKey}] visit read before model: ${visitRead.line}`);
        bargeInActive = false;
        suppressReplyRemainder = false;
        callTranscript.pushAgent(visitRead.line);
        turnTiming.markFirstSpokenChunk();
        await speakText(visitRead.line, { tracePath: 'visit_read' });
        spokeThisTurn = true;
        return;
      }
      // A committed public fact already returned above. Gemini does not own that list.
      let catalogueSystemPrompt = turnSystemPrompt;
      // letGemini is always false. A catalogue ask already returned above.
      if (catalogueMouth.letGemini) {
        const note = catalogueGeminiDirective({
          profile: brainProfile,
          localReply,
        });
        if (note) catalogueSystemPrompt = `${turnSystemPrompt}\n\n${note}`;
        console.log(
          `[ws/media][${callKey}] catalogue gemini listen lang=${callLanguage}`
        );
      }
      const bareCloser = looksLikeBareCloser(clean);

      const actionMayExecute = ['CREATE_REQUEST', 'CAPTURE', 'ESCALATE', 'TRANSFER'].includes(
        nextBestAction.action
      );
      // Handoff name-ask is still detected (live miss: HD_b4cb560bae33 / Alvin).
      // It must not speak a canned line or force the sentence stream off.
      const handoffNameAsk =
        !bareCloser &&
        shouldSpeakHandoffNameAsk({
          nextBestAction,
          brainState,
          userText: clean,
        });
      // Tool turns still wait on Gemini. The progress one-shot must not take
      // the turn, and a handoff name-ask must not force the stream off.
      const needsImmediateProgress = actionMayExecute;

      /** @type {Promise<void>} */
      let actionProgressSpeak = Promise.resolve();
      if ((needsImmediateProgress || handoffNameAsk) && tts && !bargeInActive) {
        const progressLine = pickActionProgress(nextBestAction.action, callLanguage);
        console.log(
          `[ws/media][${sidLabel()}] action-progress action=${nextBestAction.action}` +
            `${handoffNameAsk ? ' handoffNameAsk=1' : ''}` +
            ` lang=${callLanguage} withheld: ${progressLine}`
        );
      }

      // VOICE_FILLER=auto (default): adaptive ack on this turn if first audio is slow.
      // Later turns may ack again. Do not latch the ack for the whole call.
      // ack → always schedule a tiny backchannel; off → silence; custom → fixed phrase.
      // Tool turns (ESCALATE / CREATE_REQUEST) get the same adaptive ack. The
      // action-progress line above is withheld, so skipping the ack left 1.5-1.7 s
      // of dead air until Gemini returned the tool block (HD_ee813bcf6248 t6-t12).
      const fillerMode = (process.env.VOICE_FILLER || 'auto').toLowerCase();
      const useFiller =
        Boolean(tts) &&
        fillerMode !== 'off' &&
        !bareCloser && shouldSpeakThinkingAck(clean);
      const fillerDelayMs = resolveVoiceProfile().fillerDelayMs;
      const fillerText =
        fillerMode === 'ack' || fillerMode === 'auto'
          ? pickContextualAck(clean, fillerLanguage(callLanguage))
          : process.env.VOICE_FILLER;
      let fillerStarted = false;
      let firstSpokenChunk = false;

      if (useFiller && fillerText) {
        fillerTimer = setTimeout(() => {
          fillerTimer = null;
          // Adaptive: skip if LLM→TTS already started (stream chunk or full reply).
          if (turnBusy && !speaking && !bargeInActive && !firstSpokenChunk) {
            fillerStarted = true;
            thinkingAckTurn = turnTiming;
            thinkingAckAtMs = Date.now();
            ackPlayedTurn = turnTiming;
            turnTiming.markFiller();
            console.log(
              `[ws/media][${sidLabel()}] thinking-ack lang=${callLanguage}: ${fillerText}`
            );
            speakThinkingAck(fillerText).catch(() => {});
          }
        }, fillerDelayMs);
      }

      const streamOn =
        Boolean(process.env.GEMINI_API_KEY) &&
        Boolean(tts) &&
        (!needsImmediateProgress || suppressModelSpeech) &&
        (process.env.VOICE_LLM_STREAM || 'on').toLowerCase() !== 'off';

      let speakSession = null;
      /** @type {Promise<any>|null} */
      let speakSessionReady = null;
      let streamPlaybackGen = 0;
      const spokenChunks = [];

      // Warm Soniox TTS while Gemini starts so first chunk isn't paying setup latency.
      if (streamOn && tts) {
        speakSessionReady = tts
          .beginSpeak({
            callLanguage,
            speedScale: ttsSpeedScale,
            extraLexicon: ttsLexiconOverrides,
          })
          .then((session) => {
            speakSession = session;
            console.log(`[ws/media][${sidLabel()}] llm→tts stream prefetched`);
            return session;
          })
          .catch((err) => {
            console.warn(
              `[ws/media][${sidLabel()}] TTS prefetch failed:`,
              err?.message || err
            );
            speakSessionReady = null;
            return null;
          });
      }

      function stopFillerForReply() {
        clearFillerTimer();
        if (!fillerStarted) return;
        fillerStarted = false;
        // Drop filler PCM via generation bump + cancel ONLY the filler stream.
        // Do NOT tts.cancel() with no id — that kills the prefetched reply stream.
        playbackGeneration += 1;
        speaking = false;
        const cancelId = fillerStreamId;
        fillerStreamId = null;
        if (activeOutboundStreamId && cancelId && activeOutboundStreamId === cancelId) {
          activeOutboundStreamId = null;
        }
        if (tts && isCancelableTtsStreamId(cancelId)) {
          try {
            tts.cancel(cancelId);
          } catch {
            /* ignore */
          }
        }
        clearMediaPlayback(ws);
        console.log(`[ws/media][${sidLabel()}] filler cancelled for reply audio`);
      }

      async function ensureReplySpeakSession() {
        if (speakSession) return speakSession;
        if (speakSessionReady) {
          const prefetched = await speakSessionReady;
          if (prefetched) return prefetched;
        }
        speakSession = await tts.beginSpeak({
          callLanguage,
          speedScale: ttsSpeedScale,
          extraLexicon: ttsLexiconOverrides,
        });
        console.log(`[ws/media][${sidLabel()}] llm→tts stream open`);
        return speakSession;
      }

      async function onSpokenChunk(chunk) {
        // Visit, hold, and order lookups speak nameConfirmSpeech, not the model.
        if (suppressModelSpeech) return;
        // Streamed chunks are spoken before tools run, so a saved claim or a
        // number the caller never said must not reach TTS. Confirmation of a
        // save comes from formatToolConfirmation after the tool result.
        // A sentence that narrates the send ("I've sent that to the team",
        // "I sent your name") is dropped. It must not become a repeat-ask.
        const rawChunk = String(chunk || '');
        const polishedDetail = polishSpokenDetail(String(chunk || ''), {
          callerTurns: brainState.conversation?.answersReceived || [],
          profile: brainProfile,
          toolResults: [],
          capabilities,
          state: brainState,
          language: callLanguage,
        });
        const polished = polishedDetail.text;
        if (typeof voiceTrace !== 'undefined' && voiceTrace) {
          voiceTrace.noteTransform({
            stage: 'polish',
            before: rawChunk,
            after: polished,
            reason: polishedDetail.reason || (polished.trim() ? 'rewritten' : 'dropped'),
            dropReasons: polishedDetail.dropReasons,
          });
        }
        if (!polished) {
          if (rawChunk.trim() && narratesInternalAction(rawChunk)) hidInternalNarration = true;
          return;
        }
        // Model text only. Visit / hold / order lines go out through
        // speakLookupSentence and must not pass through this cut.
        const gated = gateCallerFileSpeech(polished, brainState);
        if (!gated.speak) {
          console.log(
            `[ws/media][${sidLabel()}] file speech held reason=${gated.reason}`
          );
          if (typeof voiceTrace !== 'undefined' && voiceTrace) {
            voiceTrace.noteTransform({
              stage: 'file_speech',
              before: polished,
              after: '',
              reason: gated.reason || 'held',
            });
          }
          return;
        }
        if (typeof voiceTrace !== 'undefined' && voiceTrace && gated.line !== polished) {
          voiceTrace.noteTransform({
            stage: 'file_speech',
            before: polished,
            after: gated.line,
            reason: gated.reason || 'trimmed',
          });
        }
        const text = cutNoAiSlop(gated.line);
        if (typeof voiceTrace !== 'undefined' && voiceTrace) {
          voiceTrace.noteTransform({
            stage: 'no_ai_slop',
            before: gated.line,
            after: text,
          });
        }
        if (!text) return;
        if (!tts) return;
        if (suppressReplyRemainder || bargeInActive) return;
        if (isOrphanFragment(bargeCancelledText, text)) {
          console.log(`[ws/media][${sidLabel()}] drop fragment restart after barge`);
          return;
        }
        firstSpokenChunk = true;
        spokeThisTurn = true;
        turnTiming.markFirstSpokenChunk();
        stopFillerForReply();
        if (bargeInActive || suppressReplyRemainder) return;

        const session = await ensureReplySpeakSession();
        if (!session || bargeInActive || suppressReplyRemainder) {
          try {
            session?.cancel();
          } catch {
            /* ignore */
          }
          speakSession = null;
          return;
        }

        const startingPlayback = !speaking || activePlaybackGeneration !== playbackGeneration;
        if (startingPlayback) {
          const prev = activePlaybackGeneration;
          activePlaybackGeneration = ++playbackGeneration;
          streamPlaybackGen = activePlaybackGeneration;
          speakStartedAt = Date.now();
          if (prev > 0) overlapHold.reassignPending(prev, activePlaybackGeneration);
        }
        activeOutboundStreamId = session.streamId;
        speaking = true;
        if (/[.!?]$/.test(text)) bargeCancelledText = '';

        if (typeof voiceTrace !== 'undefined' && voiceTrace && typeof prepareForTts === 'function') {
          const traced = prepareForTts(text, {
            callLanguage,
            extraLexicon: typeof ttsLexiconOverrides !== 'undefined' ? ttsLexiconOverrides : [],
          });
          voiceTrace.noteTts({
            text: traced.text,
            before: text,
            language: traced.language,
          });
        }
        session.pushText(text);
        spokenChunks.push(text);
        lastAgentText = spokenChunks.join(' ');
      }

      async function speakLookupSentence() {
        if (!suppressModelSpeech || spokeLookupSentence || bargeInActive) return false;
        const gatedLookup = gateCallerFileSpeech(
          String(nameConfirmSpeech(callKey) || '').trim(),
          callBrainStates.get(callKey)
        );
        const sentence = gatedLookup.speak ? gatedLookup.line : '';
        if (!sentence || !tts) {
          try {
            speakSession?.cancel();
          } catch {
            /* ignore */
          }
          speakSession = null;
          return false;
        }
        stopFillerForReply();
        const session = await ensureReplySpeakSession();
        if (!session || bargeInActive || suppressReplyRemainder) {
          try {
            session?.cancel();
          } catch {
            /* ignore */
          }
          speakSession = null;
          return false;
        }
        const startingPlayback = !speaking || activePlaybackGeneration !== playbackGeneration;
        if (startingPlayback) {
          const prev = activePlaybackGeneration;
          activePlaybackGeneration = ++playbackGeneration;
          streamPlaybackGen = activePlaybackGeneration;
          speakStartedAt = Date.now();
          if (prev > 0) overlapHold.reassignPending(prev, activePlaybackGeneration);
        }
        activeOutboundStreamId = session.streamId;
        speaking = true;
        firstSpokenChunk = true;
        spokeThisTurn = true;
        turnTiming.markFirstSpokenChunk();
        if (/[.!?]$/.test(sentence)) bargeCancelledText = '';
        session.pushText(sentence);
        spokenChunks.push(sentence);
        lastAgentText = spokenChunks.join(' ');
        agentReplay.beginSpeech(sentence);
        try {
          await session.end();
        } catch (err) {
          console.error(
            `[ws/media][${sidLabel()}] TTS stream end failed:`,
            err?.message || err
          );
        } finally {
          if (activePlaybackGeneration === streamPlaybackGen) {
            speaking = false;
            commitAgentQuestionIfNeeded();
            releaseQueuedCallerSpeech(streamPlaybackGen);
          } else {
            agentReplay.abandonPlayback();
          }
          speakSession = null;
        }
        callTranscript.pushAgent(sentence);
        spokeLookupSentence = true;
        console.log(`[ws/media][${sidLabel()}] lookup sentence on stream: ${sentence}`);
        return true;
      }

      function traceModelResult(result) {
        voiceTrace.noteModelOutput({
          provider: 'gemini',
          model: result?.model || geminiPrimaryModel(),
          promptId: VOICE_SYSTEM_PROMPT_ID,
          promptVersion: VOICE_SYSTEM_PROMPT_VERSION,
          language: callLanguage,
          outputText: result?.rawText || '',
          chars: Number.isFinite(result?.rawChars)
            ? result.rawChars
            : String(result?.rawText || '').length,
          spokenEmitted: result?.spokenEmitted ?? null,
          firstTokenAt: result?.firstTokenAt || null,
        });
      }

      let result;
      let turnOutcome = 'ok';
      if (!process.env.GEMINI_API_KEY) {
        result = {
          spokenText:
            callLanguage === 'sw'
              ? 'Samahani, siwezi kufikia taarifa za biashara sasa hivi. Tafadhali jaribu tena.'
              : "Sorry, I can't access the business information right now. Please try again.",
          shouldEndCall: false,
          rawText:
            callLanguage === 'sw'
              ? 'Samahani, siwezi kufikia taarifa za biashara sasa hivi. Tafadhali jaribu tena.'
              : "Sorry, I can't access the business information right now. Please try again.",
          model: 'canned',
        };
        voiceTrace.noteCanned({ path: 'llm_unavailable', text: result.spokenText });
        traceModelResult(result);
        stopFillerForReply();
        if (speakSession) {
          try {
            speakSession.cancel();
          } catch {
            /* ignore */
          }
          speakSession = null;
        }
        if (!bargeInActive) {
          if (suppressModelSpeech) {
            await speakLookupSentence();
          } else {
            await actionProgressSpeak;
            callTranscript.pushAgent(result.spokenText);
            turnTiming.markFirstSpokenChunk();
            await speakText(
              catalogueMouth.letGemini
                ? softenCataloguePunctuation(result.spokenText)
                : result.spokenText,
              { tracePath: 'llm_unavailable' }
            );
            spokeThisTurn = true;
          }
        }
      } else if (streamOn) {
        turnTiming.markLlmStart();
        voiceTrace.noteModelRequest({
          provider: 'gemini',
          model: geminiPrimaryModel(),
          promptId: VOICE_SYSTEM_PROMPT_ID,
          promptVersion: VOICE_SYSTEM_PROMPT_VERSION,
          language: callLanguage,
        });
        result = await runGeminiTurnStreaming(messages, sidLabel(), catalogueSystemPrompt, {
          onSpokenChunk,
          shouldAbort: () => bargeInActive,
          onToolHold: speakToolHold,
          catalogueBreath: catalogueMouth.letGemini,
        });
        traceModelResult(result);
        stopFillerForReply();

        if (suppressModelSpeech) {
          if (bargeInActive) {
            try {
              speakSession?.cancel();
            } catch {
              /* ignore */
            }
            console.log(`[ws/media][${sidLabel()}] discarding streamed reply after barge-in`);
            discardUnspokenAssistant(result?.spokenText || spokenChunks.join(' '));
            queueToolOutcome(callBrainStates.get(callKey), result?.actionConfirmation || result?.bargedActionConfirmation);
            bargeInActive = false;
            speakSession = null;
            if (activePlaybackGeneration === streamPlaybackGen) {
              speaking = false;
              releaseQueuedCallerSpeech(streamPlaybackGen);
            }
            logTurnTiming(turnTiming, { outcome: 'barge_in' });
            if (activeTurnTiming === turnTiming) activeTurnTiming = null;
            return;
          }
          await speakLookupSentence();
        } else if (speakSession) {
          if (bargeInActive) {
            try {
              speakSession.cancel();
            } catch {
              /* ignore */
            }
            console.log(`[ws/media][${sidLabel()}] discarding streamed reply after barge-in`);
            discardUnspokenAssistant(result?.spokenText || spokenChunks.join(' '));
            queueToolOutcome(callBrainStates.get(callKey), result?.actionConfirmation || result?.bargedActionConfirmation);
            bargeInActive = false;
            speakSession = null;
            if (activePlaybackGeneration === streamPlaybackGen) {
              speaking = false;
              releaseQueuedCallerSpeech(streamPlaybackGen);
            }
            logTurnTiming(turnTiming, { outcome: 'barge_in' });
            if (activeTurnTiming === turnTiming) activeTurnTiming = null;
            return;
          }
          const planned = resolvePrefetchedStreamSpeech({
            spokenChunks: spokenChunks.join(' '),
            spokenText: result?.spokenText,
            actionConfirmation: result?.actionConfirmation,
            timedOut: result?.timedOut,
            llmFailed: result?.llmFailed,
            fallbackLine: currentLlmRecoveryLine(),
          });
          if (planned.alreadySpoken) {
            if (planned.reply) {
              agentReplay.beginSpeech(planned.reply);
            }
            try {
              await speakSession.end();
            } catch (err) {
              console.error(
                `[ws/media][${sidLabel()}] TTS stream end failed:`,
                err?.message || err
              );
            } finally {
              if (activePlaybackGeneration === streamPlaybackGen) {
                speaking = false;
                if (planned.reply) {
                  commitAgentQuestionIfNeeded();
                } else {
                  agentReplay.abandonPlayback();
                }
                releaseQueuedCallerSpeech(streamPlaybackGen);
              } else {
                agentReplay.abandonPlayback();
              }
              speakSession = null;
            }
            if (planned.reply) callTranscript.pushAgent(planned.reply);
            spokeThisTurn = true;
          } else {
            try {
              speakSession.cancel();
            } catch {
              /* ignore */
            }
            speakSession = null;
            if (planned.speakNow && planned.reply && !bargeInActive) {
              const missed = Boolean(result?.timedOut || result?.llmFailed);
              const reply = missed
                ? await speechWhenModelMissed(result, clean, localReply)
                : catalogueMouth.letGemini
                  ? softenCataloguePunctuation(cutNoAiSlop(planned.reply))
                  : cutNoAiSlop(planned.reply);
              if (reply) {
                callTranscript.pushAgent(reply);
                turnTiming.markFirstSpokenChunk();
                await speakText(reply, missed ? { tracePath: 'speech_repair' } : undefined);
                spokeThisTurn = true;
                turnOutcome = result?.llmHardDown
                  ? 'speech_guarantee'
                  : result?.timedOut
                    ? 'stream_timeout'
                    : missed
                      ? 'speech_repair'
                      : 'stream_fallback_full';
              }
            }
          }
        } else if (!bargeInActive) {
          // Stream produced no flushable chunks (or TTS never opened) — speak full reply.
          if (speakSessionReady) {
            try {
              const unused = await speakSessionReady;
              unused?.cancel?.();
            } catch {
              /* ignore */
            }
          }
          const planned = resolvePrefetchedStreamSpeech({
            spokenChunks: '',
            spokenText: result?.spokenText,
            actionConfirmation: result?.actionConfirmation,
            timedOut: result?.timedOut,
            llmFailed: result?.llmFailed,
            fallbackLine: currentLlmRecoveryLine(),
          });
          if (planned.speakNow && planned.reply) {
            const missed = Boolean(result?.timedOut || result?.llmFailed);
            const reply = missed
              ? await speechWhenModelMissed(result, clean, localReply)
              : catalogueMouth.letGemini
                ? softenCataloguePunctuation(cutNoAiSlop(planned.reply))
                : cutNoAiSlop(planned.reply);
            if (reply) {
              callTranscript.pushAgent(reply);
              turnTiming.markFirstSpokenChunk();
              await speakText(reply, missed ? { tracePath: 'speech_repair' } : undefined);
              spokeThisTurn = true;
              turnOutcome = result?.llmHardDown
                ? 'speech_guarantee'
                : result?.timedOut
                  ? 'stream_timeout'
                  : missed
                    ? 'speech_repair'
                    : 'stream_fallback_full';
            }
          }
        } else {
          discardUnspokenAssistant(result?.spokenText || '');
          queueToolOutcome(callBrainStates.get(callKey), result?.actionConfirmation || result?.bargedActionConfirmation);
          bargeInActive = false;
          logTurnTiming(turnTiming, { outcome: 'barge_in' });
          if (activeTurnTiming === turnTiming) activeTurnTiming = null;
          return;
        }
      } else {
        turnTiming.markLlmStart();
        voiceTrace.noteModelRequest({
          provider: 'gemini',
          model: geminiPrimaryModel(),
          promptId: VOICE_SYSTEM_PROMPT_ID,
          promptVersion: VOICE_SYSTEM_PROMPT_VERSION,
          language: callLanguage,
        });
        result = await runGeminiTurn(messages, sidLabel(), catalogueSystemPrompt, {
          shouldAbort: () => bargeInActive,
          onToolHold: speakToolHold,
        });
        traceModelResult(result);
        stopFillerForReply();
        if (speakSession) {
          try {
            speakSession.cancel();
          } catch {
            /* ignore */
          }
          speakSession = null;
        }
        const modelLine = result?.spokenText
          ? catalogueMouth.letGemini
            ? softenCataloguePunctuation(cutNoAiSlop(result.spokenText))
            : cutNoAiSlop(result.spokenText)
          : '';
        const reply =
          (result?.spokenText ? modelLine : '') ||
          (result?.actionConfirmation
            ? ''
            : result?.timedOut || result?.llmFailed
              ? await speechWhenModelMissed(result, clean, localReply)
              : '');
        if (bargeInActive) {
          console.log(`[ws/media][${sidLabel()}] discarding Gemini reply after barge-in`);
          discardUnspokenAssistant(reply);
          queueToolOutcome(callBrainStates.get(callKey), result?.actionConfirmation || result?.bargedActionConfirmation);
          bargeInActive = false;
          logTurnTiming(turnTiming, { outcome: 'barge_in' });
          if (activeTurnTiming === turnTiming) activeTurnTiming = null;
          return;
        }
        // Finish the progress line before the tool confirmation so they don't overlap.
        await actionProgressSpeak;
        // Handoff name-ask already spoke the required question — skip duplicate model prose.
        const skipDuplicateAsk =
          handoffNameAsk &&
          progressAlreadySpoken &&
          !result?.actionConfirmation;
        if (suppressModelSpeech) {
          await speakLookupSentence();
        } else if (reply && !skipDuplicateAsk) {
          callTranscript.pushAgent(reply);
          turnTiming.markFirstSpokenChunk();
          await speakText(
            reply,
            !result?.spokenText && (result?.timedOut || result?.llmFailed)
              ? { tracePath: 'speech_repair' }
              : undefined
          );
          spokeThisTurn = true;
        }
      }

      if (result?.actionConfirmation && !bargeInActive) {
        const confirmation = String(result.actionConfirmation).trim();
        const lookupSpoken = spokenChunks.join(' ').trim();
        // The lookup sentence is already on the stream. Do not speakText it.
        const alreadySaid =
          /take a message|nitachukua ujumbe/i.test(lookupSpoken) &&
          /take a message|nitachukua ujumbe/i.test(confirmation);
        if (!(spokeLookupSentence && confirmation === lookupSpoken) && !alreadySaid) {
          await actionProgressSpeak;
          // "Alright." already played: say "They'll call you back.", not
          // "Okay. They'll call you back." (HD_4d6ac592aeb3 t4).
          const outcomeLine = trimAckLead(result.actionConfirmation, {
            acked: ackPlayedTurn === turnTiming,
          });
          callTranscript.pushAgent(outcomeLine);
          await speakText(outcomeLine);
          spokeThisTurn = true;
        }
      }

      // A coverage answer from Gemini that ends on a bare list gets the next
      // step, like the local coverage line (HD_ee813bcf6248 t6/t8).
      if (spokeThisTurn && !bargeInActive && !suppressModelSpeech && !result?.actionConfirmation) {
        const coverageNext = coverageNextStepFor(
          spokenChunks.join(' ').trim() || String(result?.spokenText || ''),
          { profile: brainProfile, language: callLanguage, state: brainState }
        );
        if (coverageNext) {
          console.log(`[ws/media][${sidLabel()}] coverage next step lang=${callLanguage}: ${coverageNext}`);
          callTranscript.pushAgent(coverageNext);
          const askSpoken = await speakText(coverageNext);
          if (askSpoken?.ok) messages.push({ role: 'assistant', content: coverageNext, local: true });
        }
      }

      if (!result?.actionConfirmation && result?.bargedActionConfirmation) {
        queueToolOutcome(callBrainStates.get(callKey), result.bargedActionConfirmation);
      }

      // Empty Gemini success asks them to repeat once. A 503 or a broken
      // stream does the same. Credits or a denied project still uses the
      // reach-them name line, once.
      if (!spokeThisTurn && !hidInternalNarration && !bargeInActive && tts) {
        if (result?.timedOut || result?.llmFailed) {
          const guarantee = await speechWhenModelMissed(result, clean, localReply);
          if (guarantee) {
            console.warn(
              `[ws/media][${sidLabel()}] turn speech ${result?.llmHardDown ? 'guarantee' : 'repair'} action=${nextBestAction.action}` +
                ` slot=${nextBestAction.slot || ''} llmHardDown=${result?.llmHardDown ? 1 : 0}`
            );
            callTranscript.pushAgent(guarantee);
            turnTiming.markFirstSpokenChunk();
            await speakText(guarantee, {
              tracePath: result?.llmHardDown ? 'speech_guarantee' : 'speech_repair',
            });
            spokeThisTurn = true;
            turnOutcome = result?.llmHardDown ? 'speech_guarantee' : 'speech_repair';
          } else {
            console.log(
              `[ws/media][${sidLabel()}] turn speech quiet action=${nextBestAction.action} reason=model_miss`
            );
          }
        } else {
          const planned = planEmptyGeminiSpeech({
            brainState,
            language: callLanguage,
            userText: clean,
            llmDown: false,
            alreadyOffered: emptyRepairOffered,
            toolResults: result?.toolResults,
          });
          if (planned.speak && planned.line) {
            emptyRepairOffered = true;
            console.warn(
              `[ws/media][${sidLabel()}] turn speech repair action=${nextBestAction.action} kind=${planned.kind}`
            );
            callTranscript.pushAgent(planned.line);
            turnTiming.markFirstSpokenChunk();
            await speakText(planned.line, { tracePath: planned.kind || 'speech_repair' });
            spokeThisTurn = true;
            turnOutcome = 'speech_repair';
          } else {
            console.log(
              `[ws/media][${sidLabel()}] turn speech quiet action=${nextBestAction.action} reason=empty_answer`
            );
            turnOutcome = 'speech_quiet';
          }
        }
      }

      if (result?.shouldEndCall && !bargeInActive) {
        console.log(`[ws/media][${sidLabel()}] end-call marker — closing media shortly`);
        setTimeout(() => {
          try {
            ws.close(1000, 'end_call');
          } catch {
            /* ignore */
          }
        }, 800);
      } else if (hasPendingLiveTransfer(sessionCallSid) && !bargeInActive) {
        // Staging spikes proved SautiKit does not continue the voice document
        // after Stream (no Redirect, no StreamStopped on /voice/incoming).
        // Closing media leaves dead air. Keep the AI on the line; SMS already sent.
        console.warn(
          `[ws/media][${sidLabel()}] live transfer Dial blocked — Stream does not continue; AI stays`
        );
      }
      logTurnTiming(turnTiming, { outcome: turnOutcome });
      if (activeTurnTiming === turnTiming) activeTurnTiming = null;
    } catch (err) {
      console.error(`[ws/media][${sidLabel()}] turn failed:`, err?.message || err);
      if (callEnding) {
        try {
          ws.close(1000, 'end_call');
        } catch {
          /* ignore */
        }
      } else if (!bargeInActive && !progressAlreadySpoken && !spokeThisTurn) {
        const recovery = await resolveLlmRecoverySpeech(clean);
        callTranscript.pushAgent(recovery);
        await speakText(recovery, { tracePath: 'llm_recovery' });
      }
      logTurnTiming(turnTiming, { outcome: 'error' });
      if (activeTurnTiming === turnTiming) activeTurnTiming = null;
    } finally {
      if (speechHold.holdNameConfirm) clearNameJustConfirmed(callKey);
      clearFillerTimer();
      if (activeTurnTiming === turnTiming) {
        logTurnTiming(turnTiming, { outcome: 'early_return' });
        activeTurnTiming = null;
      }
      turnBusy = false;
      kickPendingTurn();
    }
  }

  function flushUtterance(turnEnd) {
    if (utteranceTimer) {
      clearTimeout(utteranceTimer);
      utteranceTimer = null;
    }
    utteranceStartedAt = 0;
    if (callEnding) {
      utteranceParts = [];
      utteranceLanguages = [];
      return;
    }
    if (!utteranceParts.length) return;
    const rawText = joinUtteranceParts(utteranceParts);
    const tokenLanguages = utteranceLanguages.slice();
    utteranceParts = [];
    utteranceLanguages = [];
    if (!rawText) return;
    // #584 decideTurnEnd passes { unfinished: true } into this flush.
    // Do not drop that flag on the way to Brain observe.
    const label = labelFlushedCallerTurn({ text: rawText, turnEnd });
    if (overlapHold.alreadyReleased(rawText)) {
      voiceTrace.noteTurnEnd({ decision: 'drop', reason: 'duplicate' });
      console.log(`[ws/media][${sidLabel()}] caller_turn_duplicate_suppressed`);
      return;
    }
    const text = lateFinals.merge(rawText);
    lateFinals.noteClosed(Date.now());
    overlapHold.markReleased(text);
    if (turnBusy) {
      pendingUtterance = pendingUtterance ? `${pendingUtterance} ${text}` : text;
      if (label.unfinished) pendingTurnSignals.unfinished = true;
      if (label.weak) pendingTurnSignals.weak = true;
      if (label.weakStt) pendingTurnSignals.weakStt = true;
      if (tokenLanguages.length) {
        pendingTurnSignals.tokenLanguages = (pendingTurnSignals.tokenLanguages || []).concat(
          tokenLanguages
        );
      }
      return;
    }
    console.log(`[ws/media][${sidLabel()}] caller_turn_processed`);
    heardCallerUtterance = true;
    if (!firstForward.firstCallerTurn) {
      firstForward.firstCallerTurn = text;
      firstForward.hasStt = true;
      if (sessionCallSid) {
        patchFirstForward(sessionCallSid, {
          hasStt: true,
          firstCallerTurn: text,
          unfinished: label.unfinished,
          weak: label.weak,
          weakStt: label.weakStt,
        });
      }
    }
    runCallerTurn(text, { unfinished: label.unfinished, turnEnd, tokenLanguages }).catch((err) => {
      console.error(`[ws/media][${sidLabel()}] runCallerTurn error:`, err?.message || err);
    });
  }

  function pendingUtteranceText() {
    return joinUtteranceParts(utteranceParts);
  }

  function noteUtteranceClock() {
    if (!utteranceStartedAt && utteranceParts.length) utteranceStartedAt = Date.now();
  }

  function utteranceWaitedMs() {
    if (!utteranceStartedAt) return 0;
    return Date.now() - utteranceStartedAt;
  }

  function applyTurnEnd(decision) {
    if (!decision || decision.action === 'drop') {
      if (utteranceTimer) {
        clearTimeout(utteranceTimer);
        utteranceTimer = null;
      }
      return;
    }
    if (decision.action === 'wait') {
      if (utteranceTimer) clearTimeout(utteranceTimer);
      const waitMs = Math.max(0, Number(decision.waitMs) || 0);
      console.log(
        `[ws/media][${sidLabel()}] turn_end wait ${waitMs}ms reason=${decision.reason} unfinished=${decision.unfinished ? 1 : 0}`
      );
      utteranceTimer = setTimeout(() => {
        utteranceTimer = null;
        const again = decideTurnEnd({
          text: pendingUtteranceText(),
          endpoint: true,
          waitedMs: utteranceWaitedMs(),
          lastAgentText,
        });
        applyTurnEnd(again);
      }, waitMs);
      return;
    }
    // The decision, including unfinished, is the flush. Do not drop it.
    flushUtterance(decision);
  }

  function considerTurnEnd(endpoint) {
    noteUtteranceClock();
    applyTurnEnd(
      decideTurnEnd({
        text: pendingUtteranceText(),
        endpoint: Boolean(endpoint),
        waitedMs: utteranceWaitedMs(),
        lastAgentText,
      })
    );
  }

  function scheduleUtteranceFlush() {
    considerTurnEnd(false);
  }

  function onSttEvent(evt) {
    if (evt.type === 'error') {
      const classified = evt.classified || classifySonioxError(evt.raw);
      if (classified.billing || classified.fatal) {
        void handleSpeechProviderOutage(
          `stt ${classified.code || classified.message}`
        );
      }
      return;
    }

    if (evt.type === 'transcript' && evt.text) {
      const text = String(evt.text).trim();
      if (!text) return;
      voiceTrace.noteStt({
        text,
        isFinal: Boolean(evt.isFinal),
        tokens: evt.tokens,
      });
      if (evt.isFinal) {
        const tags = Array.isArray(evt.tokenLanguages)
          ? evt.tokenLanguages
          : (Array.isArray(evt.tokens) ? evt.tokens : [])
              .map((token) => token && token.language)
              .filter(Boolean);
        if (tags.length) utteranceLanguages.push(...tags);
      }

      const isInterim = !evt.isFinal;

      // Any caller words keep a held unfinished turn waiting for its final,
      // even one short word the idle rules ignore (HD_015bae4a4af2 answered
      // "For" mid-sentence). The hold caps how long postpones can stretch it.
      if (unfinishedHold.pending() && !looksLikeEcho(text)) unfinishedHold.postpone(text);

      // Instant barge-in on accumulated interim tokens while TTS/LLM is busy.
      if (isInterim) {
        if (speaking || turnBusy) {
          interimBargeText = mergeInterimHypothesis(interimBargeText, text);
          const interimDecision = maybeBargeIn(interimBargeText, 'interim speech');
          if (callerEventClearsIdle(interimDecision)) {
            noteCallerSpeechForIdle(interimBargeText);
          }
          if (
            speaking &&
            !interimDecision.interrupt &&
            (interimDecision.queue || interimDecision.action === 'queue')
          ) {
            overlapHold.noteInterim(interimBargeText, activePlaybackGeneration);
          }
        } else {
          const idleInterim = decideCallerEvent({
            text,
            speaking: false,
            turnBusy: false,
            lastAgentText,
            lastAgentAskedQuestion: lastAskedQuestion(),
            replayText: hearAgainReplayText(),
            phase: 'idle',
          });
          if (callerEventClearsIdle(idleInterim)) noteCallerSpeechForIdle(text);
          interimBargeText = '';
        }
        return;
      }

      // Finals: one turn-taking decision, then act.
      interimBargeText = '';
      const decision = maybeBargeIn(text, 'final speech');

      if (decision.reason === 'echo') {
        voiceTrace.noteTurnEnd({ decision: 'drop', reason: 'echo' });
        console.log(
          `[ws/media][${sidLabel()}] drop echo final while TTS: ${text.slice(0, 80)}`
        );
        return;
      }

      if (decision.replay) {
        voiceTrace.noteTurnEnd({ decision: 'replay', reason: decision.reason || 'replay' });
        const replay = hearAgainReplayText();
        if (replay) {
          if (callerEventClearsIdle(decision)) noteCallerSpeechForIdle(text);
          console.log(
            `[ws/media][${sidLabel()}] agent_question_replay reason=${decision.reason}`
          );
          void speakText(replay, { isReplay: true }).then(() => {
            if (callEnding) return;
            if (agentAwaitingReply(replay)) {
              idleNudge.arm({ skip: !heardCallerUtterance });
            }
          });
        }
        return;
      }

      if (callerEventClearsIdle(decision)) noteCallerSpeechForIdle(text);

      if (decision.action === 'barge_listen') {
        voiceTrace.noteTurnEnd({ decision: 'hold', reason: 'barge_listen' });
        return;
      }

      if (decision.action === 'ignore' || decision.action === 'skip') {
        if (!decision.queue && lateFinals.hold(text, { reason: decision.reason || '' })) {
          voiceTrace.noteTurnEnd({ decision: 'hold', reason: 'late_final' });
          console.log(
            `[ws/media][${sidLabel()}] late_final held reason=${decision.reason || ''} ${text.slice(0, 80)}`
          );
          return;
        }
        voiceTrace.noteTurnEnd({
          decision: decision.action,
          reason: decision.reason || '',
        });
        if (decision.queue) {
          appendFinalPart(utteranceParts, evt.text);
          if (!(speaking && !bargeInActive)) scheduleUtteranceFlush();
        }
        return;
      }

      if (speaking && !bargeInActive) {
        const overlap = classifyFinalDuringAgentSpeech(text, lastAgentText, {
          lastAgentAskedQuestion: lastAskedQuestion(),
          speakStartedAt,
        });
        if (overlap === 'drop_echo') {
          console.log(
            `[ws/media][${sidLabel()}] drop echo final while TTS: ${text.slice(0, 80)}`
          );
          return;
        }
        // Hold until this playback generation ends — do not Gemini while TTS is active.
        overlapHold.enqueue(text, activePlaybackGeneration);
        voiceTrace.noteTurnEnd({ decision: 'queue', reason: 'agent_speaking' });
        console.log(
          `[ws/media][${sidLabel()}] caller_turn_queued gen=${activePlaybackGeneration}`
        );
        return;
      }
      if (overlapHold.alreadyReleased(text)) {
        overlapHold.consumeInterimIfMatches(text);
        voiceTrace.noteTurnEnd({ decision: 'drop', reason: 'duplicate' });
        console.log(`[ws/media][${sidLabel()}] caller_turn_duplicate_suppressed`);
        return;
      }
      overlapHold.consumeInterimIfMatches(text);
      appendFinalPart(utteranceParts, evt.text);
      scheduleUtteranceFlush();
      return;
    }

    if (evt.type === 'endpoint' || evt.type === 'finished') {
      if (speaking) {
        if (!overlapHold.hasPending(activePlaybackGeneration)) {
          interimBargeText = '';
        }
        return;
      }
      interimBargeText = '';
      if (!turnBusy) {
        bargeInActive = false;
      }
      const leftover = overlapHold.takeAllInterims();
      if (leftover && !overlapHold.alreadyReleased(leftover)) {
        utteranceParts.push(leftover);
      }
      considerTurnEnd(true);
    }
  }

  function bindMediaTts(voiceId) {
    const session = createSonioxTtsSession({
      callSid: sidLabel(),
      voiceId,
      onAudio: (pcm, meta = {}) => {
        // Drop outbound audio after barge-in cancel, a generation change,
        // or PCM from a stream that is no longer the active utterance.
        if (
          !shouldForwardOutboundPcm({
            speaking,
            playbackGeneration,
            activePlaybackGeneration,
            activeStreamId: activeOutboundStreamId,
            frameStreamId: meta.streamId,
          })
        ) {
          return;
        }
        if (activeTurnTiming) {
          activeTurnTiming.markFirstPcm();
          const fillerAudio = Boolean(fillerStreamId && meta.streamId === fillerStreamId);
          if (!fillerAudio) activeTurnTiming.markFirstReplyPcm();
        }
        if (greetingAwaitingFirstPcm) noteGreetingPcm({ cached: false });
        if (!playbackStartedAt) playbackStartedAt = Date.now();
        playbackBytes += pcm.length;
        if (ws.readyState === WebSocket.OPEN) sendPcmToMedia(ws, pcm);
        // Live clone-voice audio means we can record downtime clips for the next outage.
        scheduleOutageClipWarm({ voiceId: tenantSonioxVoiceId });
      },
    });
    tts = session;
    ttsSessionVoiceId = resolveSonioxVoice(voiceId);
    return session;
  }

  // Warm tenant prompt early when callSid is already on the WS URL.
  const tenantWarm =
    sessionCallSid
      ? ensureTenantPrompt().catch(() => null)
      : Promise.resolve(null);

  if (isSonioxConfigured()) {
    try {
      stt = createSonioxSttSession({
        callSid: sidLabel(),
        onEvent: onSttEvent,
        // Prefer awaited profile; fall back quickly if load is slow (audio still buffers).
        contextPromise: tenantWarm.then((ctx) => ctx || buildSttContext(sttTenantSnapshot)),
      });
      stt.ready.catch((err) => {
        console.error(`[ws/media] Soniox STT failed to start:`, err?.message || err);
        stt = null;
      });
    } catch (err) {
      console.error(`[ws/media] Soniox STT init error:`, err?.message || err);
      stt = null;
    }
  } else {
    console.warn('[ws/media] SONIOX_API_KEY missing — skipping STT for this call');
  }

  if (isSonioxTtsConfigured()) {
    try {
      const session = bindMediaTts(tenantSonioxVoiceId);
      session.ready
        .then(() => {
          resolveTtsReady(session);
        })
        .catch((err) => {
          console.error(`[ws/media] Soniox TTS failed to start:`, err?.message || err);
          tts = null;
          resolveTtsReady(null);
        });
    } catch (err) {
      console.error(`[ws/media] Soniox TTS init error:`, err?.message || err);
      tts = null;
      resolveTtsReady(null);
    }
  } else {
    console.warn('[ws/media] SONIOX_API_KEY missing — skipping TTS for this call');
    resolveTtsReady(null);
  }

  function markGreetingFileNameAsk(line) {
    if (greetingInterrupted || fileNameAsksCommitted > 0) return;
    if (!/\b(?:am i speaking with|je,?\s*naongea na|naongea na)\s+\S/i.test(String(line || ''))) {
      return;
    }
    const state = sessionCallSid ? callBrainStates.get(sessionCallSid) : null;
    if (!state?.caller || state.caller.nameConfirmed === true) return;
    state.caller.fileNameAskSpoken = true;
    fileNameAsksCommitted += 1;
    callBrainStates.set(sessionCallSid, state);
  }

  // Greet once the tenant profile is loaded (correct shop name). Cached PCM
  // plays before TTS-ready wait so answer-to-greeting is not dead air.
  (async () => {
    if (greetingStarted) return;
    greetingStarted = true;
    try {
      await ensureTenantPrompt();
      if (speechOutageStarted) return;
      // Every answered call starts at profile pace. A faster ask on the last
      // call must not ride this greeting or the rest of this session.
      ttsSpeedScale = 1;
      console.log(`[ws/media][${sidLabel()}] caller speed scale=1`);
      if (isDefaultShopName(businessName)) {
        console.warn(
          `[ws/media][${sidLabel()}] greeting skipped — default shop name`
        );
        await handleSpeechProviderOutage('default shop name');
        return;
      }

      // Instant local greeting (correct tenant name). Do not wait on Gemini.
      greetingLine = await generateDynamicGreeting({
        businessName,
        agentName,
        spokenName,
        greetingInvite,
        vertical: brainProfile?.vertical || '',
        servicesCatalog: brainProfile.servicesCatalog,
        servicesOffered: brainProfile.servicesOffered,
        isOpen: openStatus === 'unknown' ? null : openStatus === 'open',
        afterHoursMode,
        closureNotice,
        callerFileName:
          afterHoursMode === 'message' ? messageFileOwnerName(brainProfile) : '',
        callSid: sidLabel(),
        mode: 'instant',
      });
      if (speechOutageStarted) return;
      console.log(
        `[ws/media][${sidLabel()}] greeting mode=instant agent=${agentName} open=${openStatus} afterHours=${afterHoursMode} bulletinClosed=${Boolean(closureNotice)}: ${greetingLine}`
      );

      const found = lookupGreetingPcm({
        voiceId: tenantSonioxVoiceId,
        text: greetingLine,
        extraLexicon: ttsLexiconOverrides,
        businessName,
        agentName,
      });
      voiceTrace.noteCall({ stage: 'canned', path: 'greeting', text: greetingLine });
      if (found.pcm && isGreetingCacheEnabled()) {
        noteGreetingPcm({ cached: true });
        voiceTrace.noteCall({
          stage: 'tts',
          path: 'greeting',
          text: greetingLine,
          language: callLanguage,
        });
        await playCachedFillerPcm(found.pcm, { text: greetingLine, trace: false });
        callTranscript.pushAgent(greetingLine);
        messages.push({ role: 'assistant', content: greetingLine, local: true });
        if (!greetingInterrupted) markGreetingFileNameAsk(greetingLine);
      } else {
        let readyTts = await ttsReadyPromise;
        if (speechOutageStarted) return;
        if (
          readyTts &&
          ttsVoiceNeedsSwap(ttsSessionVoiceId, tenantSonioxVoiceId)
        ) {
          console.log(
            `[ws/media][${sidLabel()}] tts voice swap ${ttsSessionVoiceId} → ${resolveSonioxVoice(tenantSonioxVoiceId)}`
          );
          try {
            readyTts.close();
          } catch {
            /* ignore */
          }
          tts = null;
          try {
            const next = bindMediaTts(tenantSonioxVoiceId);
            readyTts = await next.ready.then(() => next);
          } catch (err) {
            console.error(`[ws/media] Soniox TTS voice swap failed:`, err?.message || err);
            readyTts = null;
            tts = null;
          }
        }
        if (!readyTts || !tts) {
          console.warn(
            `[ws/media][${sidLabel()}] greeting skipped — TTS not ready`
          );
          await handleSpeechProviderOutage('tts not ready');
          return;
        }

        greetingAwaitingFirstPcm = true;
        const spoken = await speakGreetingSentences(greetingLine, {
          greetingCacheKey: found.key,
          extraLexicon: found.extraLexicon,
        });
        if (spoken?.outage || speechOutageStarted) return;
        if (spoken?.ok) {
          callTranscript.pushAgent(greetingLine);
          messages.push({ role: 'assistant', content: greetingLine, local: true });
          if (!greetingInterrupted && !spoken.cancelled) markGreetingFileNameAsk(greetingLine);
        }
      }
      if (tts && isFillerCacheEnabled()) {
        void warmFillerAckPcm({
          tts,
          voiceId: tenantSonioxVoiceId,
          extraLexicon: ttsLexiconOverrides,
          shouldAbort: () => speechOutageStarted || turnBusy || !tts,
        })
          .then((result) => {
            if (result?.warmed) {
              console.log(
                `[ws/media][${sidLabel()}] filler pcm warmed n=${result.warmed}`
              );
            }
          })
          .catch(() => {});
      }
      greetingSettled = true;
    } catch (err) {
      greetingSettled = true;
      console.error(`[ws/media][${sidLabel()}] greeting failed:`, err?.message || err);
      try {
        if (isDefaultShopName(businessName) || !tts) {
          await handleSpeechProviderOutage('greeting failed');
          return;
        }
        const fallback = buildGreeting(businessName, {
          agentName,
          spokenName,
          greetingInvite,
          vertical: brainProfile?.vertical || '',
          servicesCatalog: brainProfile.servicesCatalog,
          servicesOffered: brainProfile.servicesOffered,
          isOpen: openStatus === 'unknown' ? null : openStatus === 'open',
          afterHoursMode,
          closureNotice,
        });
        greetingAwaitingFirstPcm = true;
        await speakGreetingSentences(fallback);
        messages.push({ role: 'assistant', content: fallback, local: true });
      } catch {
        /* ignore */
      }
    }
  })();

  ws.on('message', (data, isBinary) => {
    try {
      const buf = toNodeBuffer(data);
      const asText = buf.toString('utf8');

      // Trust the WebSocket binary bit — PCM can coincidentally start with '{'/'['.
      if (!isBinary) {
        textFrames += 1;
        if (looksLikeJsonText(asText)) {
          try {
            const parsed = JSON.parse(asText);
            const wsSample = sampleWsPayload(parsed);
            if (wsSample) {
              console.log('[ws/media] payload sample', wsSample);
            }

            const meta = parsed.metadata || parsed;
            const incomingCallSid =
              meta.callSid ||
              meta.call_sid ||
              meta.call_id ||
              parsed.callSid ||
              null;
            const maybeSid =
              incomingCallSid ||
              meta.sessionId ||
              meta.streamSid ||
              parsed.sessionId ||
              parsed.streamSid ||
              null;
            if (
              incomingCallSid &&
              sessionCallSid &&
              String(incomingCallSid) !== String(sessionCallSid)
            ) {
              ttsSpeedScale = 1;
              console.log(
                `[ws/media][${sessionCallSid}] caller speed scale=1 (new callSid=${incomingCallSid})`
              );
            }
            if (maybeSid && !sessionCallSid) {
              sessionCallSid = String(maybeSid);
              ttsSpeedScale = 1;
              publishVoiceTrace();
              console.log(`[ws/media] bound session callSid=${sessionCallSid}`);
              ensureTenantPrompt().catch(() => {});
            }
          } catch (parseErr) {
            console.log(
              '[ws/media] text frame (non-JSON):',
              asText.slice(0, 80),
              '| parseError=',
              parseErr?.message || parseErr
            );
          }
        } else if (textFrames <= 3) {
          console.log('[ws/media] text frame sample:', asText.slice(0, 80));
        }
        return;
      }

      binaryFrames += 1;
      if (binaryFrames <= 5 || binaryFrames % 50 === 0) {
        console.log(
          `[ws/media] binary audio frame #${binaryFrames} (${buf.length} bytes) callSid=${sessionCallSid || 'unknown'}`
        );
      }
      // Keep feeding STT during TTS so barge-in can fire; echo is filtered in onSttEvent.
      if (stt) stt.sendAudio(buf);
    } catch (err) {
      console.error(
        '[ws/media] message handler error (socket kept open):',
        err?.message || err,
        err?.stack
      );
    }
  });

  ws.on('close', (code, reason) => {
    const ms = Date.now() - connectedAt;
    console.log(
      `[ws/media] closed after ${ms}ms code=${code} reason=${reason?.toString?.() || ''} callSid=${sessionCallSid || 'unknown'} frames={text:${textFrames},binary:${binaryFrames}}`
    );
    clearFillerTimer();
    speakCommit.clear();
    idleNudge.close();
    unfinishedHold.close();
    if (utteranceTimer) {
      clearTimeout(utteranceTimer);
      utteranceTimer = null;
    }
    if (stt) {
      try {
        stt.close();
      } catch {
        /* ignore */
      }
      stt = null;
    }
    if (tts) {
      try {
        tts.close();
      } catch {
        /* ignore */
      }
      tts = null;
    }
    void voiceTrace.finishCall();
    if (sessionCallSid && callTranscript.size()) {
      db.appendTranscript({ callSid: sessionCallSid, turns: callTranscript.turns() }).catch(
        (err) => {
          console.error(`[ws/media] transcript flush failed:`, err?.message || err);
        }
      );
    }
    // Fallback: if SautiKit never posts call.completed, still leave the row finished.
    // Do not close the desk row while a cold Dial is waiting on Redirect.
    if (sessionCallSid && !hasPendingLiveTransfer(sessionCallSid)) {
      const durationSeconds = Math.max(0, Math.round(ms / 1000));
      markCallTerminalFromWebhook({
        callSid: sessionCallSid,
        status: 'complete',
        durationSeconds,
        source: 'ws/media',
        turns: callTranscript.turns(),
      })
        .catch(() => {})
        .finally(() => {
          callAgentTools.delete(sessionCallSid);
          callBrainStates.delete(sessionCallSid);
          callBrainCapabilities.delete(sessionCallSid);
          callTenantProfiles.delete(sessionCallSid);
        });
    }
  });

  ws.on('error', (err) => {
    console.error('[ws/media] error:', err?.message || err);
  });
});

const mediaKeepalive = setInterval(() => {
  for (const ws of mediaWss.clients) {
    if (ws.isAlive === false) {
      console.warn('[ws/media] keepalive missed — terminating stale socket');
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (err) {
      console.warn('[ws/media] ping failed:', err?.message || err);
    }
  }
}, 15000);

mediaWss.on('close', () => clearInterval(mediaKeepalive));

// ---------------------------------------------------------------------------
// Owner lead notification (Telegram interim; WhatsApp when Business is linked).
// Fires from save_caller_info and recording/events webhooks. Sends once per call.
// ---------------------------------------------------------------------------
const ownerNotifyInProgress = new Set();
const escalationNotifyInProgress = new Set();

/**
 * Escalation notify from TEAM DIRECTORY.
 * Plug-and-play: WhatsApp to teammate/owner when SautiKit WA is configured;
 * email fallback when WhatsApp is unavailable.
 */
function liveConnectMetaPatch(profile, transferQueued) {
  if (parseHandoffMode(profile?.handoffMode) !== 'live_transfer') return {};
  if (transferQueued) {
    return {
      live_connect: { ran: true, at: new Date().toISOString() },
    };
  }
  const ready = liveTransferReady({ profile: profile || {} });
  return {
    live_connect: {
      ran: false,
      stamp: 'Notify only (live connect unavailable)',
      reason: ready.reason || 'unavailable',
    },
  };
}

async function maybeSendEscalationNotification(callSid, escalate = {}) {
  const call = await db.getCall(callSid);
  if (!call) return { ok: false, reason: 'Call record was not found.' };
  const force = escalate.force === true;
  if (call.escalation_sent && !force) return { ok: true, channel: 'already_sent' };
  if (escalationNotifyInProgress.has(callSid)) {
    return { ok: false, reason: 'An escalation is already in progress.' };
  }
  escalationNotifyInProgress.add(callSid);

  try {
    let ownerNumber = process.env.BUSINESS_OWNER_WHATSAPP_NUMBER || null;
    let ownerEmail = process.env.OWNER_ALERT_EMAIL || null;
    let businessName = process.env.BUSINESS_NAME || null;
    let teamDirectory = [];
    let notifyChannels = null;
    let loadedProfile = null;
    try {
      const profile = await db.getTenantProfile({ callSid });
      loadedProfile = profile;
      ownerNumber = profile.whatsappNumber || ownerNumber;
      ownerEmail = profile.alertEmail || ownerEmail;
      businessName = profile.businessName || businessName;
      teamDirectory = profile.teamDirectory || [];
      notifyChannels = profile.notifyChannels || null;
    } catch (err) {
      console.warn(`[${callSid}] tenant lookup for escalation failed:`, err?.message || err);
    }

    const resolved = resolveEscalation(teamDirectory, escalate.teammate, {
      ownerPhone: ownerNumber,
    });
    const teammate = resolved.teammate;
    const callerName =
      displayOwnerCallerName(escalate.name || call.name) || null;
    let reason =
      String(escalate.reason || call.reason || call.escalate_reason || '').trim() || null;
    if (resolved.match === 'fallback' && resolved.requested) {
      const asked = `Asked for ${resolved.requested}`;
      reason = reason ? `${reason} (${asked})` : asked;
    }

    if (callerName || reason) {
      await db.saveCallerInfo({
        callSid,
        name: callerName || undefined,
        reason: reason || undefined,
      });
    }

    await db.saveEscalation({ callSid, teammate, reason });

    const lead = {
      businessName,
      name: callerName || 'Caller',
      reason: reason || call.reason,
      callerNumber: call.from_number,
      recordingUrl: call.recording_url,
    };
    const body = buildEscalationText({
      ...lead,
      callerName: lead.name,
      teammate,
      requested: resolved.requested,
      match: resolved.match,
    });

    const sent = await dispatchEscalationAlert({
      teammatePhone: teammate?.phone || null,
      teammateEmail: teammate?.email || null,
      ownerPhone: ownerNumber,
      ownerEmail,
      body,
      lead,
      channels: notifyChannels,
      subject: `Escalation for ${teammateLabel(teammate)}${businessName ? `. ${businessName}` : ''}`,
      ledger: {
        tenantId: loadedProfile?.id || call.tenant_id || null,
        callId: call.id || null,
        callSid,
        kind: 'escalation',
        force,
        pingId: escalate.pingId || null,
      },
    });

    const transferQueued = await maybeQueueLiveTransfer({
      callSid,
      escalate,
      teamDirectory,
      profile: loadedProfile || {},
      callerNumber: call.from_number,
    });

    if (!sent.length) {
      console.warn(`[${callSid}] Escalation notify skipped (no working channel). Ready:`, {
        teammate: teammateLabel(teammate),
        name: lead.name,
        phone: lead.callerNumber,
        reason: lead.reason,
        smsSender: smsSenderReady(),
        smsStatus: getSmsStatus(),
        whatsappSender: whatsAppSenderReady(),
        emailFallback: emailFallbackReady(),
        ownerNumber: ownerNumber || null,
        ownerEmail: ownerEmail || null,
        teammatePhone: teammate?.phone || null,
      });
      const failed = shapeEscalationNotifyOutcome({
        ok: false,
        reason: sent.reason || 'No live SMS/WA/email channel.',
      });
      await db.mergeCallSummaryMeta({
        callSid,
        patch: {
          escalation_notify: failed,
          ...liveConnectMetaPatch(loadedProfile || {}, transferQueued),
        },
      });
      return {
        ok: false,
        soft: false,
        transfer: transferQueued,
        channel: null,
        reason: failed.reason,
        escalation_notify: failed,
      };
    }

    for (const s of sent) {
      console.log(
        `[${callSid}] Escalation notify via ${s.channel}` +
          (s.role ? ` (${s.role})` : '') +
          (s.to ? ` → ${s.to}` : '') +
          ` for ${teammateLabel(teammate)}`
      );
    }

    await db.markEscalationSent(callSid);
    await db.markWhatsappSent(callSid);
    const liveOutcome = shapeEscalationNotifyOutcome({
      ok: true,
      soft: false,
      sent,
      channel: sent.map((item) => item.channel).filter(Boolean).join(',') || 'alert',
    });
    await db.mergeCallSummaryMeta({
      callSid,
      patch: {
        escalation_notify: liveOutcome,
        ...liveConnectMetaPatch(loadedProfile || {}, transferQueued),
      },
    });
    return {
      ok: true,
      soft: false,
      transfer: transferQueued,
      channel: liveOutcome.channels.map((c) => c.channel).join(',') || 'alert',
      sent,
      escalation_notify: liveOutcome,
    };
  } catch (err) {
    console.error(`[${callSid}] Escalation notification failed:`, err?.message || err);
    const failed = shapeEscalationNotifyOutcome({
      ok: false,
      reason: err?.message || String(err),
    });
    await db
      .mergeCallSummaryMeta({ callSid, patch: { escalation_notify: failed } })
      .catch(() => {});
    return { ok: false, reason: failed.reason };
  } finally {
    escalationNotifyInProgress.delete(callSid);
  }
}

async function maybeQueueLiveTransfer({
  callSid,
  escalate,
  teamDirectory,
  profile,
  callerNumber,
} = {}) {
  const dest = liveTransferDestination(teamDirectory, escalate?.teammate);
  const ready = liveTransferReady({ profile });
  if (!ready.ready || !dest) return false;
  const callerE164 = normalizeKenyaE164(callerNumber);
  if (callerE164 && callerE164 === dest.phone) {
    console.warn(
      `[${callSid}] live transfer skipped: Dial destination is the caller ${dest.phone}`
    );
    return false;
  }
  const callerId = normalizeKenyaE164(profile?.did) || null;
  const queued = queuePendingLiveTransfer({
    callSid,
    to: dest.phone,
    callerId,
  });
  if (!queued) return false;
  await db
    .saveTransferAttempt({
      callSid,
      attempt: {
        status: queued.status,
        mode: 'cold_dial',
        to: dest.phone,
        caller_id: callerId,
        timeout_s: queued.timeoutS,
        started_at: new Date().toISOString(),
        teammate: { name: dest.name, role: dest.role, phone: dest.phone },
      },
    })
    .catch((err) => {
      console.warn(`[${callSid}] saveTransferAttempt failed:`, err?.message || err);
    });
  console.log(`[${callSid}] live transfer queued Dial ${dest.phone}`);
  return true;
}

async function maybeSendWhatsAppNotification(callSid, opts = {}) {
  // Lead alert: WhatsApp owner number when sender is ready; email fallback otherwise.
  const call = await db.getCall(callSid);
  if (!call) return;

  if (!shouldSendOwnerLead(call)) return;

  if (staffInboxAlreadyNotified(call)) return;

  const brain = callBrainStates.get(callSid);
  if (
    shouldDeferOwnerLeadForVisit({
      midCall: opts.midCall === true,
      brainIntent: brain?.intent,
      goalStatus: brain?.goal?.status,
    })
  ) {
    return;
  }

  if (ownerNotifyInProgress.has(callSid)) return;
  if (call.whatsapp_sent) return;
  ownerNotifyInProgress.add(callSid);

  try {
    let ownerNumber = process.env.BUSINESS_OWNER_WHATSAPP_NUMBER || null;
    let ownerEmail = process.env.OWNER_ALERT_EMAIL || null;
    let businessName = process.env.BUSINESS_NAME || null;
    let notifyChannels = null;
    let teamDirectory = [];
    let tenantId = call.tenant_id || null;
    try {
      const profile = await db.getTenantProfile({ callSid });
      ownerNumber = profile.whatsappNumber || ownerNumber;
      ownerEmail = profile.alertEmail || ownerEmail;
      businessName = profile.businessName || businessName;
      notifyChannels = profile.notifyChannels || null;
      teamDirectory = profile.teamDirectory || [];
      tenantId = profile.id || tenantId;
    } catch (err) {
      console.warn(`[${callSid}] tenant lookup for notify failed:`, err?.message || err);
    }

    const event = ownerLeadEvent(
      { ...call, callUrl: callDeskUrl(call.id) },
      businessName
    );
    const body = renderEventText(event);
    const lead = {
      businessName,
      name: event.caller?.name || call.name,
      reason: event.caller?.reason || call.reason,
      callerNumber: call.from_number,
      recordingUrl: call.recording_url,
    };
    const inbox = staffRecipients('inbox', {
      teamDirectory,
      ownerPhone: ownerNumber,
      ownerEmail,
    });
    const { sent } = await dispatchToStaff({
      recipients: inbox.recipients,
      body,
      lead,
      channels: notifyChannels,
      ledger: {
        tenantId,
        callId: call.id || null,
        callSid,
        kind: 'lead',
      },
    });
    const result = sent[0] || { channel: null, reason: inbox.source === 'none' ? 'no_inbox_recipient' : 'send_failed' };
    if (!result.channel) {
      console.warn(`[${callSid}] Owner notify skipped (${result.reason || 'unknown'}). Lead ready:`, {
        name: call.name,
        phone: call.from_number,
        reason: call.reason,
        recording: call.recording_url,
        ownerNumber: ownerNumber || null,
        ownerEmail: ownerEmail || null,
        inbox: inbox.source,
        smsSender: smsSenderReady(),
        whatsappSender: whatsAppSenderReady(),
        emailFallback: emailFallbackReady(),
      });
      return;
    }

    await db.markWhatsappSent(callSid);
    await db.mergeCallSummaryMeta({
      callSid,
      patch: {
        owner_notify_body: body,
        owner_notify_channel: result.channel,
        owner_notify_kind: 'lead',
      },
    });
    console.log(
      `[${callSid}] Lead notify via ${result.channel}` +
        (result.to ? ` → ${result.to}` : '') +
        ` accepted`
    );
  } catch (err) {
    console.error(`[${callSid}] Owner notification failed:`, err?.message || err);
  } finally {
    ownerNotifyInProgress.delete(callSid);
  }
}

/** Dedicated hold/order/enquiry alert. Marks the call so hangup does not also send a lead. */
async function maybeSendServiceRequestNotification(callSid, request) {
  if (!request) return;
  let ownerNumber = process.env.BUSINESS_OWNER_WHATSAPP_NUMBER || null;
  let ownerEmail = process.env.OWNER_ALERT_EMAIL || null;
  let businessName = process.env.BUSINESS_NAME || 'your business';
  let notifyChannels = null;
  let teamDirectory = [];
  let tenantId = null;
  try {
    const profile = await db.getTenantProfile({ callSid });
    ownerNumber = profile.whatsappNumber || ownerNumber;
    ownerEmail = profile.alertEmail || ownerEmail;
    businessName = profile.businessName || businessName;
    notifyChannels = profile.notifyChannels || null;
    teamDirectory = profile.teamDirectory || [];
    tenantId = profile.id || null;
  } catch (err) {
    console.warn(
      `[${callSid}] tenant lookup for request notify failed:`,
      err?.message || err
    );
  }

  const callRow = await db.getCall(callSid).catch(() => null);
  const ledger = {
    tenantId: tenantId || callRow?.tenant_id || null,
    callId: callRow?.id || null,
    callSid,
  };

  const event = serviceRequestEvent(request, businessName);
  const body = renderEventText(event);
  const lead = {
    businessName,
    name: request.caller_name || 'Caller',
    reason: `${event.title}: ${[request.item, request.when_text].filter(Boolean).join('. ')}`,
    callerNumber: request.caller_phone,
  };

  const inbox = staffRecipients('inbox', {
    teamDirectory,
    ownerPhone: ownerNumber,
    ownerEmail,
  });
  const { sent } = await dispatchToStaff({
    recipients: inbox.recipients,
    body,
    lead,
    channels: notifyChannels,
    subject: renderEventSubject(event),
    ledger: { ...ledger, kind: 'service_request' },
  });
  const result = sent[0] || { channel: null, reason: 'no_inbox_recipient' };
  if (result.channel) {
    console.log(
      `[${callSid}] Request notify (${event.title}) via ${result.channel}` +
        (result.to ? ` → ${result.to}` : '')
    );
    try {
      await db.markWhatsappSent(callSid);
      await db.mergeCallSummaryMeta({
        callSid,
        patch: {
          owner_notify_body: body,
          owner_notify_channel: result.channel,
          owner_notify_kind: 'service_request',
        },
      });
    } catch (err) {
      console.warn(
        `[${callSid}] request notify mark sent failed:`,
        err?.message || err
      );
    }
  } else {
    console.warn(
      `[${callSid}] Request notify skipped (${result.reason || 'unknown'})`
    );
  }

  const callerEvent = requestCallerEvent({ ...request, businessName });
  try {
    const caller = await dispatchCallerSms({
      to: request.caller_phone,
      event: callerEvent,
      channels: notifyChannels,
      ledger,
    });
    if (caller.channel) {
      await db.mergeCallSummaryMeta({
        callSid,
        patch: { caller_notify_body: caller.body, caller_notify_kind: callerEvent.kind },
      });
      console.log(`[${callSid}] Caller notify (${callerEvent.kind}) via sms → ${caller.to}`);
    }
  } catch (err) {
    console.warn(`[${callSid}] Caller notify failed:`, err?.message || err);
  }
}

/** Visit booking alert for home-services appointments. */
async function maybeSendAppointmentNotification(callSid, appointment, kind = 'created') {
  if (!appointment) return;
  let ownerNumber = process.env.BUSINESS_OWNER_WHATSAPP_NUMBER || null;
  let ownerEmail = process.env.OWNER_ALERT_EMAIL || null;
  let businessName = process.env.BUSINESS_NAME || 'your business';
  let notifyChannels = null;
  let teamDirectory = [];
  let tenantId = null;
  try {
    const profile = await db.getTenantProfile({ callSid });
    ownerNumber = profile.whatsappNumber || ownerNumber;
    ownerEmail = profile.alertEmail || ownerEmail;
    businessName = profile.businessName || businessName;
    notifyChannels = profile.notifyChannels || null;
    teamDirectory = profile.teamDirectory || [];
    tenantId = profile.id || null;
  } catch (err) {
    console.warn(
      `[${callSid}] tenant lookup for appointment notify failed:`,
      err?.message || err
    );
  }

  const callRow = await db.getCall(callSid).catch(() => null);
  const ledger = {
    tenantId: tenantId || callRow?.tenant_id || null,
    callId: callRow?.id || null,
    callSid,
  };

  const event = appointmentEvent(appointment, businessName, kind);
  const body = renderEventText(event);
  const lead = {
    businessName,
    name: appointment.caller_name || 'Caller',
    reason: `${event.title}: ${[appointment.service_name, appointment.when_text]
      .filter(Boolean)
      .join('. ')}`,
    callerNumber: appointment.caller_phone,
  };

  const inbox = staffRecipients('inbox', {
    teamDirectory,
    ownerPhone: ownerNumber,
    ownerEmail,
  });
  const { sent } = await dispatchToStaff({
    recipients: inbox.recipients,
    body,
    lead,
    subject: renderEventSubject(event),
    channels: notifyChannels,
    ledger: { ...ledger, kind: 'appointment' },
  });
  const result = sent[0] || { channel: null, reason: 'no_inbox_recipient' };
  if (result.channel) {
    console.log(
      `[${callSid}] Appointment notify (${kind}) via ${result.channel}` +
        (result.to ? ` → ${result.to}` : '')
    );
    try {
      await db.markWhatsappSent(callSid);
      await db.mergeCallSummaryMeta({
        callSid,
        patch: {
          owner_notify_body: body,
          owner_notify_channel: result.channel,
          owner_notify_kind: 'appointment',
        },
      });
    } catch (err) {
      console.warn(
        `[${callSid}] appointment notify mark sent failed:`,
        err?.message || err
      );
    }
  } else {
    console.warn(
      `[${callSid}] Appointment notify skipped (${result.reason || 'unknown'})`
    );
  }

  const callerEvent = appointmentCallerEvent(
    { ...appointment, businessName },
    kind
  );
  try {
    const caller = await dispatchCallerSms({
      to: appointment.caller_phone,
      event: callerEvent,
      channels: notifyChannels,
      ledger,
    });
    if (caller.channel) {
      await db.mergeCallSummaryMeta({
        callSid,
        patch: { caller_notify_body: caller.body, caller_notify_kind: callerEvent.kind },
      });
      console.log(`[${callSid}] Caller notify (${callerEvent.kind}) via sms → ${caller.to}`);
    }
  } catch (err) {
    console.warn(`[${callSid}] Caller notify failed:`, err?.message || err);
  }
}

wss.on('connection', (ws) => {
  let callSid = null;
  let systemPrompt = buildSystemPrompt();
  let messages = [{ role: 'system', content: systemPrompt }];
  let transcriptLog = [];
  let callLanguage = 'unknown';
  let callLanguageState = createLanguageState();
  let brainProfile = {};

  ws.on('message', async (raw) => {
    let data;
    try {
      try {
        data = JSON.parse(raw.toString());
      } catch {
        console.warn('[ws] Failed to parse incoming message as JSON');
        return;
      }

      if (data.type === 'setup') {
        callSid = data.callSid;
        await db.upsertCall({
          callSid,
          fromNumber: data.from,
          toNumber: data.to,
          provider: 'sautikit',
        });
        try {
          const profile = await db.getTenantProfile({ callSid, toNumber: data.to });
          await hydrateCallerMemory(profile, callSid);
          brainProfile = profile;
          systemPrompt = buildSystemPrompt(profile);
          const parsedTools = parseAgentTools(profile.agentTools);
          callAgentTools.set(callSid, parsedTools);
          callTenantProfiles.set(callSid, profile);
          callBrainStates.set(callSid, createBrainState(profile));
          callBrainCapabilities.set(callSid, capabilitiesForProfile(profile, parsedTools));
          messages = [{ role: 'system', content: systemPrompt }];
        } catch (err) {
          console.warn(`[${callSid}] tenant prompt load failed:`, err?.message || err);
        }
        console.log(`[${callSid}] WebSocket connected: ${data.from} → ${data.to}`);
        return; // welcomeGreeting in the TwiML already handles the opening line
      }

      if (data.type === 'prompt') {
        if (!callSid) {
          console.warn('[ws] Received prompt before setup message; ignoring');
          return;
        }

        transcriptLog.push(`Caller: ${data.voicePrompt}`);
        messages.push({ role: 'user', content: data.voicePrompt });

        const languageEvidence = analyzeCallerLanguage(data.voicePrompt);
        callLanguageState = resolveLanguageState(callLanguageState, languageEvidence);
        callLanguage = callLanguageState.current;
        const capabilities =
          callBrainCapabilities.get(callSid) ||
          capabilitiesForProfile(brainProfile, callAgentTools.get(callSid) || parseAgentTools(null));
        const previousBrainState =
          callBrainStates.get(callSid) || createBrainState(brainProfile);
        const provisionalIntent = inferIntent(data.voicePrompt, {
          vertical: brainProfile?.vertical,
        });
        const entityIntent =
          provisionalIntent === 'general_enquiry' &&
          previousBrainState.goal.status === 'active'
            ? previousBrainState.intent
            : provisionalIntent;
        const entities = extractConversationEntities(data.voicePrompt, {
          profile: brainProfile,
          intent: entityIntent,
          state: previousBrainState,
        });
        const fileStamp = liveCallerFileStamp(brainProfile?.callerMemory);
        let brainState = observeCallerTurn(
          previousBrainState,
          observeCallerInput({
            text: data.voicePrompt,
            languageState: callLanguageState,
            entities,
            profile: brainProfile,
          })
        );
        if (liveCallerFileStamp(brainProfile?.callerMemory) !== fileStamp) {
          systemPrompt = buildSystemPrompt(brainProfile);
        }
        const decision = determineNextBestAction({ state: brainState, capabilities });
        brainState = setNextBestAction(brainState, decision);
        callBrainStates.set(callSid, brainState);
        logBrainTrace({
          callSid,
          phase: 'decision',
          state: brainState,
          decision,
        });
        const turnMatches = selectProductsForTurn({
          catalog: brainProfile.productCatalog,
          queryText: data.voicePrompt,
          entities: brainState.entities,
          intent: brainState.intent,
        });
        const catalogSize = normalizeProducts(brainProfile.productCatalog).length;
        const turnPrompt = [
          systemPrompt,
          formatAuthorityPolicy(capabilities),
          formatBrainStateForPrompt(brainState),
          formatEscalateActionDirective(brainState),
      formatCreateRequestDirective(brainState),
          formatTargetedProductsForPrompt(turnMatches, {
            totalCatalogSize: catalogSize,
            queryText: data.voicePrompt,
            catalog: brainProfile.productCatalog,
          }),
          languageDirective(callLanguage),
        ]
          .filter(Boolean)
          .join('\n\n');

        const nameGate = planCallerModelTurn(brainState, {
          greetingBarged: false,
          fileNameAskCommitted: brainState?.caller?.fileNameAskSpoken === true,
        });
        const relayNameAsk = lockFileNameAsk(nameGate.line, callLanguage);
        if (!nameGate.runModel && relayNameAsk) {
          brainState.caller.fileNameAskSpoken = true;
          callBrainStates.set(callSid, brainState);
          transcriptLog.push(`Agent: ${relayNameAsk}`);
          ws.send(JSON.stringify({ type: 'text', token: relayNameAsk, last: true }));
          await db.appendTranscript({ callSid, transcript: transcriptLog.join('\n') });
          return;
        }

        const promptText = String(data.voicePrompt || '');
        const promptVisitAsk =
          looksLikeOpenVisitLookup(promptText) ||
          looksLikeVisitReviewMore(promptText) ||
          looksLikeHistoryReview(promptText);
        let promptAppointments = [];
        if (
          promptVisitAsk &&
          brainState?.messageOnly !== true &&
          brainState?.caller?.nameConfirmed === true &&
          brainState?.caller?.nameJustConfirmed !== true
        ) {
          promptAppointments = await loadVisitReviewAppointments(callSid, brainProfile);
        }
        const promptVisitRead = planVisitReadTurn({
          nameConfirmed: brainState?.caller?.nameConfirmed === true,
          nameJustConfirmed: brainState?.caller?.nameJustConfirmed === true,
          callerText: promptText,
          messageOnly: brainState?.messageOnly === true,
          language: callLanguage,
          openVisits: brainState?.returning?.openVisits,
          appointments: promptAppointments,
          cursor: brainState?.conversation?.visitReview || null,
        });
        if (promptVisitRead.runModel === false && promptVisitRead.line) {
          if (!brainState.conversation || typeof brainState.conversation !== 'object') {
            brainState.conversation = {};
          }
          brainState.conversation.visitReview = promptVisitRead.cursor;
          callBrainStates.set(callSid, brainState);
          transcriptLog.push(`Agent: ${promptVisitRead.line}`);
          ws.send(JSON.stringify({ type: 'text', token: promptVisitRead.line, last: true }));
          await db.appendTranscript({ callSid, transcript: transcriptLog.join('\n') });
          return;
        }

        const reply = await runGeminiTurn(messages, callSid, turnPrompt);
        const replyBody = [reply.spokenText, reply.actionConfirmation]
          .filter(Boolean)
          .join(' ');
        const gatedReply = gateCallerFileSpeech(replyBody, brainState);
        const replyText = gatedReply.speak ? gatedReply.line : '';
        if (replyText) {
          transcriptLog.push(`Agent: ${replyText}`);
          ws.send(JSON.stringify({ type: 'text', token: replyText, last: true }));
        }

        await db.appendTranscript({ callSid, transcript: transcriptLog.join('\n') });

        if (reply.shouldEndCall) {
          // Give the TTS a moment to finish playing before tearing down.
          setTimeout(() => ws.send(JSON.stringify({ type: 'end' })), 1200);
        }
      }
    } catch (err) {
      console.error(`[${callSid || 'unknown'}] WebSocket message handler error:`, err?.message || err, err?.stack);
      // Attempt to send an end-call message to gracefully close the relay
      try {
        ws.send(JSON.stringify({ type: 'end' }));
      } catch (closeErr) {
        console.error(`[${callSid || 'unknown'}] Failed to send end-call on error:`, closeErr?.message);
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`[${callSid || 'unknown'}] WebSocket error:`, err?.message || err);
  });

  ws.on('close', () => {
    console.log(`[${callSid || 'unknown'}] WebSocket closed`);
    if (callSid) {
      forgetVoiceTrace(callSid);
      forgetVoiceTrace(sidLabel());
      db.appendTranscript({ callSid, transcript: transcriptLog.join('\n') }).catch((err) => {
        console.error(`[${callSid}] Failed to flush transcript on close:`, err?.message || err);
      });
      persistCallResolution(callSid, 'ws/fallback')
        .catch(() => {})
        .finally(() => {
          callAgentTools.delete(callSid);
          callBrainStates.delete(callSid);
          callBrainCapabilities.delete(callSid);
          callTenantProfiles.delete(callSid);
        });
    }
  });
});

const AI_FALLBACK_LINE =
  "Sorry, I'm having a technical issue and couldn't complete that. Please try again.";

function spokenTextWithoutToolFallback({ spoken = '', actionConfirmation = '' } = {}) {
  const text = String(spoken || '').trim();
  if (text) return text;
  // Empty model text is not a technical failure. Tool confirmations speak later;
  // the turn guarantee asks the next slot if nothing else was spoken.
  return actionConfirmation ? '' : '';
}

/**
 * Context for the final speech guard: the caller's own words, the business
 * file, and this turn's tool results are the only sources of numbers and of
 * saved claims. Same contract as the streamed chunks.
 */
function finalSpeechGuardOpts(callSid, toolResults = []) {
  const state = callBrainStates.get(callSid) || createBrainState();
  return {
    language: state.language?.current || 'en',
    state,
    profile: callTenantProfiles.get(callSid) || {},
    capabilities: callBrainCapabilities.get(callSid) || {},
    callerTurns: state.conversation?.answersReceived || [],
    toolResults,
  };
}

async function safeApplyGeminiTools(callSid, parsed) {
  try {
    return await applyGeminiTools(callSid, parsed);
  } catch (err) {
    console.error(
      `[${callSid}] applyGeminiTools failed:`,
      err?.message || err,
      err?.stack
    );
    return {
      results: [
        {
          action: 'tool_request',
          status: 'failed',
          reason: String(err?.message || err).slice(0, 300),
        },
      ],
      shouldEndCall: false,
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Lightweight one-shot Gemini text (greetings / helpers). No chat history.
 */
async function generateGeminiText({
  callSid,
  systemInstruction,
  userText,
  temperature = 0.7,
  maxOutputTokens = 80,
  thinkingLevel = 'MINIMAL',
}) {
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const response = await getGeminiClient().models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: String(userText || 'Go.') }] }],
    config: {
      systemInstruction: { parts: [{ text: String(systemInstruction || '') }] },
      temperature,
      maxOutputTokens,
      thinkingConfig: { thinkingLevel },
    },
  });
  const text = extractGeminiText(response).trim();
  console.log(`[${callSid}] Gemini one-shot text chars=${text.length}`);
  return text;
}

function geminiVoiceConfig(systemPrompt) {
  return {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    // Slightly lower temp + shorter cap → faster, more consistent phone lines.
    temperature: Number(process.env.GEMINI_VOICE_TEMPERATURE || 0.35),
    maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 256),
    // MINIMAL keeps voice latency down; set GEMINI_THINKING_LEVEL=LOW if needed.
    thinkingConfig: {
      thinkingLevel: process.env.GEMINI_THINKING_LEVEL || 'MINIMAL',
    },
  };
}

/**
 * Apply parsed tool markers (save_caller_info / escalate / create_service_request).
 */
async function applyGeminiTools(callSid, parsed) {
  const tools = callAgentTools.get(callSid) || parseAgentTools(null);
  const capabilities =
    callBrainCapabilities.get(callSid) ||
    capabilitiesForProfile(callTenantProfiles.get(callSid) || {}, tools);
  const state = callBrainStates.get(callSid) || createBrainState();
  const groundedProfile = callTenantProfiles.get(callSid) || {};
  // Tool contract: required tools first, then the guard strips what the caller
  // never consented to or never said (ack turns, invented quantity, day-only
  // visits). Gemini's own markers pass through the same gate as injected ones.
  const enforcedParsed = guardToolPlan(
    ensureRequiredEscalate(
      ensureRequiredCreateRequest(parsed, state, capabilities),
      state,
      capabilities
    ),
    state,
    capabilities
  );
  if (enforcedParsed.consentBlocked || enforcedParsed.needsVisitTime) {
    console.log(
      `[${callSid}] tool guard ${enforcedParsed.consentBlocked ? 'consent_blocked' : 'needs_visit_time'}`
    );
  }
  const execution = await executeBrainTools({
    parsed: enforcedParsed,
    capabilities,
    completedFingerprints: state.actions.completedFingerprints,
    priorHolds: state.actions.openHolds || [],
    productCatalog: groundedProfile.productCatalog || null,
    agentName: groundedProfile.agentName || process.env.AGENT_NAME || '',
    businessName:
      groundedProfile.businessName || process.env.BUSINESS_NAME || '',
    hoursSchedule: groundedProfile.hoursSchedule || null,
    nameConfirmed: state.caller?.nameConfirmed === true,
    heldCallerName: state.messageOnly
      ? heldMessageCallerName(state.caller)
      : String(state.caller?.name || '').trim(),
    openAppointments: groundedProfile.openAppointments || [],
    callerPhone: state.caller?.phone || '',
    knownNames: collectKnownCallerNames({
      profile: groundedProfile,
      state,
    }),
    businessPolicies: groundedProfile.businessPolicies || null,
    businessLocations: groundedProfile.businessLocations || null,
    fieldMeta: groundedProfile.fieldMeta || null,
    handlers: {
      createServiceRequest: async (request) => {
        const created = await db.createServiceRequest({
          callSid,
          type: request.type,
          name: request.name || parsed.name,
          phone: request.phone,
          item: request.item,
          quantity: request.quantity,
          whenText: request.whenText,
          notes: request.notes || parsed.reason,
        });
        if (created) {
          console.log(
            `[${callSid}] service_request created id=${created.id} type=${created.request_type}`
          );
          maybeSendServiceRequestNotification(callSid, created).catch((err) => {
            console.error(`[${callSid}] service request notify error:`, err?.message || err);
          });
        }
        return created;
      },
      updateServiceRequest: async (request) => {
        const updated = await db.updateServiceRequest({
          id: request.id,
          type: request.type,
          name: request.name || parsed.name,
          phone: request.phone,
          item: request.item,
          quantity: request.quantity,
          whenText: request.whenText,
          notes: request.notes || parsed.reason,
        });
        if (updated) {
          console.log(
            `[${callSid}] service_request updated id=${updated.id} type=${updated.request_type} when=${updated.when_text || ''}`
          );
        }
        return updated;
      },
      createAppointment: async (appointment) => {
        const created = await db.createAppointment({
          callSid,
          serviceName: appointment.serviceName,
          name: appointment.name || parsed.name,
          phone: appointment.phone,
          whenText: appointment.whenText,
          landmark: appointment.landmark,
          notes: appointment.notes || parsed.reason,
          windowStart: appointment.windowStart,
          windowEnd: appointment.windowEnd,
        });
        if (created) {
          console.log(
            `[${callSid}] appointment created id=${created.id} service=${created.service_name}`
          );
          maybeSendAppointmentNotification(callSid, created, 'created').catch((err) => {
            console.error(`[${callSid}] appointment notify error:`, err?.message || err);
          });
        }
        return created;
      },
      updateAppointment: async (appointment) => {
        const updated = await db.updateAppointment({
          callSid,
          appointmentId: appointment.appointmentId,
          phone: appointment.phone,
          status: appointment.status,
          whenText: appointment.whenText,
          landmark: appointment.landmark,
          notes: appointment.notes,
          serviceName: appointment.serviceName,
          windowStart: appointment.windowStart,
          windowEnd: appointment.windowEnd,
        });
        if (updated) {
          console.log(
            `[${callSid}] appointment updated id=${updated.id} status=${updated.status}`
          );
          maybeSendAppointmentNotification(callSid, updated, 'updated').catch((err) => {
            console.error(`[${callSid}] appointment update notify error:`, err?.message || err);
          });
        }
        return updated;
      },
      saveCallerInfo: (info) =>
        db.saveCallerInfo({
          callSid,
          name: info.name || undefined,
          reason: info.reason || undefined,
        }),
      escalate: (escalation) =>
        maybeSendEscalationNotification(callSid, escalation),
    },
  });
  if (enforcedParsed.needsVisitTime) {
    // Day-only visit never reached the calendar. Speak the time ask, not dead air.
    execution.results.push({
      action: 'create_appointment',
      status: 'invalid',
      code: 'unparsed_when',
      reason: 'Visit has a day but no time.',
      missingSlots: ['when_text'],
      hours: { whenText: String(enforcedParsed.needsVisitTime) },
    });
  }

  let updatedState = recordActionResults(state, execution.results);
  if (execution.shouldEndCall) {
    updatedState = setNextBestAction(updatedState, {
      action: 'END',
      reason: 'The response included a permitted end-call action.',
    });
  }
  callBrainStates.set(callSid, updatedState);
  logBrainTrace({
    callSid,
    phase: 'action_result',
    state: updatedState,
    toolResults: execution.results,
  });

  const savedInfo = execution.results.find(
    (result) => result.action === 'save_caller_info' && result.status === 'succeeded'
  );
  const escalationRequested = execution.results.some(
    (result) => result.action === 'escalate'
  );
  const visitSaved = execution.results.some(
    (result) =>
      (result.action === 'create_appointment' ||
        result.action === 'update_appointment') &&
      (result.status === 'succeeded' || result.status === 'updated')
  );
  if (savedInfo?.name && savedInfo?.reason && !escalationRequested && !visitSaved) {
    maybeSendWhatsAppNotification(callSid, { midCall: true });
  }
  if (visitSaved) {
    persistCallResolution(callSid, 'tool', { review: false }).catch((err) => {
      console.warn(
        `[${callSid}] tool visit persist failed:`,
        err?.message || err
      );
    });
  }

  for (const result of execution.results) {
    console.log(
      `[${callSid}] brain action=${result.action} status=${result.status}` +
        (result.reason ? ` reason=${result.reason}` : '')
    );
  }
  noteTracedGeminiTools(callSid, parsed, enforcedParsed, execution.results);
  return execution;
}

/**
 * Stream Gemini tokens → onSpokenChunk (sentence/clause flushes) → TTS.
 * No audio yet: retry the same model once, then one backup model on 503.
 * Audio already started: do not restart. Credits and denied are not retried.
 */

function nameJustConfirmed(callSid) {
  return callBrainStates.get(callSid)?.caller?.nameJustConfirmed === true;
}

function latestCallerUtterance(messages) {
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return String(messages[i].content || '');
  }
  return '';
}

function holdCallerSpeech(callSid, messages) {
  const caller = callBrainStates.get(callSid)?.caller;
  return openLineHoldDecision({
    nameConfirmed: caller?.nameConfirmed === true,
    nameJustConfirmed: caller?.nameJustConfirmed === true,
    callerText: latestCallerUtterance(messages),
  });
}

function clearNameJustConfirmed(callSid) {
  const caller = callBrainStates.get(callSid)?.caller;
  if (caller) caller.nameJustConfirmed = false;
}

function nameConfirmSpeech(callSid) {
  const state = callBrainStates.get(callSid);
  return formatNameConfirmSpeech({
    openVisits: state?.returning?.openVisits,
    openRequests: state?.returning?.openRequests,
    language: state?.language?.current,
  });
}

async function applyToolsWithHold(callSid, parsed, hooks = {}) {
  const shouldAbort = hooks.shouldAbort;
  let session = null;
  if (turnRequestsTool(parsed) && !shouldAbort?.()) {
    const state = callBrainStates.get(callSid);
    session = createToolHoldSession({
      language: state?.language?.current || 'en',
      seed: `${callSid}:${state?.conversation?.turnCount || 0}`,
    });
  }
  if (session && shouldAbort?.()) session.cancel();
  // Start the tool first. The hold covers that wait. It does not run before it.
  const toolPromise = safeApplyGeminiTools(callSid, parsed);
  let holdSpeech = Promise.resolve();
  if (session && session.phase !== 'cancelled') {
    const begun = session.begin();
    if (begun.speak && typeof hooks.onToolHold === 'function') {
      holdSpeech = Promise.resolve(hooks.onToolHold(begun));
    }
  }
  const [execution] = await Promise.all([toolPromise, holdSpeech]);
  let toolHoldCancelled = false;
  if (session) {
    const state = callBrainStates.get(callSid);
    const fileRead = fileReadFollowUp(execution.results);
    const follow = session.finish({
      barge: Boolean(shouldAbort?.()),
      bound: speakerBound(state),
      fileFacts: Boolean(fileRead),
      resultLine: fileRead?.resultLine || '',
    });
    toolHoldCancelled = follow.reason === 'barge';
    if (
      fileRead &&
      follow.speak &&
      !toolHoldCancelled &&
      typeof hooks.onToolHold === 'function'
    ) {
      await hooks.onToolHold(follow);
    }
  }
  return { execution, toolHoldCancelled };
}

async function runGeminiTurnStreaming(
  messages,
  callSid,
  systemPrompt = buildSystemPrompt(),
  { onSpokenChunk, shouldAbort, onToolHold, catalogueBreath } = {}
) {
  const primary = geminiPrimaryModel();
  const backup = geminiBackupModel();
  const contents = buildGeminiContents(messages);
  let model = primary;
  const breath = catalogueBreath === true;
  let buffer = createSpokenStreamBuffer({ catalogueBreath: breath });
  let fullText = '';
  let firstTokenAt = null;
  let streamFailed = false;
  let streamErr = null;
  let thoughtSignature = '';
  let modelParts = [];
  const timeoutMs = geminiTurnTimeoutMs();
  let attempt = 0;

  while (attempt < 3) {
    fullText = '';
    firstTokenAt = null;
    buffer = createSpokenStreamBuffer({ catalogueBreath: breath });
    thoughtSignature = '';
    modelParts = [];
    streamErr = null;
    streamFailed = false;
    try {
      console.log(
        `[${callSid}] Calling Gemini stream (model: ${model}, attempt: ${attempt + 1}, messages: ${messages.length}, timeoutMs=${timeoutMs})`
      );
      await withTimeout(
        (async () => {
          const stream = await getGeminiClient().models.generateContentStream({
            model,
            contents,
            config: geminiVoiceConfig(systemPrompt),
          });

          for await (const chunk of stream) {
            if (shouldAbort?.()) {
              console.log(`[${callSid}] Gemini stream aborted (barge-in)`);
              break;
            }
            modelParts = appendGeminiStreamParts(modelParts, chunk);
            thoughtSignature = extractThoughtSignature(chunk) || thoughtSignature;
            const delta = extractGeminiText(chunk);
            if (!delta) continue;
            if (!firstTokenAt) firstTokenAt = Date.now();
            fullText = joinSpokenPieces(fullText, delta);
            const pieces = buffer.push(delta);
            for (const piece of pieces) {
              if (shouldAbort?.()) break;
              if (typeof onSpokenChunk === 'function') {
                try {
                  await onSpokenChunk(piece);
                } catch (err) {
                  console.warn(
                    `[${callSid}] spoken chunk TTS failed:`,
                    err?.message || err
                  );
                }
              }
            }
          }
        })(),
        timeoutMs,
        'Gemini stream'
      );
      console.log(
        `[${callSid}] Gemini stream done chars=${fullText.length} spokenEmitted=${buffer.getSpokenEmitted().length}`
      );
      break;
    } catch (err) {
      streamErr = err;
      const spoke = Boolean(String(fullText).trim());
      const next = nextGeminiStreamAttempt({
        err,
        attempt,
        spoke,
        primary,
        backup,
      });
      if (next.action === 'stop') {
        if (isTimeoutError(err) && spoke) {
          console.warn(
            `[${callSid}] Gemini stream timed out after ${timeoutMs}ms with partial text chars=${fullText.length}`
          );
        } else {
          streamFailed = true;
          console.error(
            `[${callSid}] Gemini stream failed; stopping:`,
            err?.message || err
          );
        }
        break;
      }
      console.warn(
        `[${callSid}] Gemini stream ${next.action} model=${next.model} after:`,
        err?.message || err
      );
      if (next.waitMs) await sleep(next.waitMs);
      model = next.model;
      attempt += 1;
    }
  }

  if (streamFailed && !fullText) {
    const hardDown = isHardGeminiOutage(streamErr);
    if (streamErr && !isTimeoutError(streamErr)) {
      noteGeminiProviderError(classifyGeminiError(streamErr), streamErr);
    }
    return {
      spokenText: '',
      rawText: fullText || buffer.getRaw() || '',
      firstTokenAt,
      spokenEmitted: buffer.getSpokenEmitted().length,
      model,
      actionConfirmation: '',
      toolResults: [],
      shouldEndCall: false,
      streamed: false,
      llmFailed: true,
      llmHardDown: hardDown,
      timedOut: isTimeoutError(streamErr),
    };
  }

  if (!shouldAbort?.()) {
    for (const piece of buffer.finish()) {
      if (typeof onSpokenChunk === 'function') {
        try {
          await onSpokenChunk(piece);
        } catch (err) {
          console.warn(
            `[${callSid}] spoken chunk TTS failed:`,
            err?.message || err
          );
        }
      }
    }
  } else {
    // Finalize buffer state without speaking remainder.
    buffer.finish();
  }

  const parsed = parseGeminiResponse(fullText || buffer.getRaw());
  const heldTools = await applyToolsWithHold(callSid, parsed, { shouldAbort, onToolHold });
  const execution = heldTools.execution;
  let actionConfirmation = formatToolConfirmation(
    execution.results,
    callBrainStates.get(callSid)?.language?.current || 'en'
  );
  // A barge cancelled the hold. The outcome is not spoken on this turn, but
  // the caller is still owed it on the next one (toolOutcomeQueue).
  const bargedActionConfirmation = heldTools.toolHoldCancelled ? actionConfirmation : '';
  if (heldTools.toolHoldCancelled) actionConfirmation = '';
  const spokenText = polishSpokenReply(
    spokenTextForToolTurn({
      spoken: spokenTextWithoutToolFallback({
        spoken: buffer.getSpokenEmitted() || parsed.spokenText,
        actionConfirmation,
      }),
      toolResults: execution.results,
    }),
    finalSpeechGuardOpts(callSid, execution.results)
  );

  const geminiParts = modelPartsForHistory({
    geminiParts: modelParts,
    text: fullText || buffer.getRaw(),
    thoughtSignature,
  });
  messages.push({
    role: 'assistant',
    content: [spokenText, actionConfirmation].filter(Boolean).join(' '),
    geminiParts,
    thoughtSignature: thoughtSignature || undefined,
  });
  return {
    spokenText,
    rawText: fullText || buffer.getRaw() || '',
    firstTokenAt,
    spokenEmitted: buffer.getSpokenEmitted().length,
    model,
    actionConfirmation,
    bargedActionConfirmation,
    toolResults: execution.results,
    shouldEndCall: execution.shouldEndCall,
    streamed: !streamFailed,
  };
}

// Runs one turn of the conversation through Gemini, preserving the chat
// history and executing the caller-info / end-call signals via structured
// markers returned in the model output.
async function runGeminiTurn(
  messages,
  callSid,
  systemPrompt = buildSystemPrompt(),
  hooks = {}
) {
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const maxAttempts = Math.max(1, Number(process.env.GEMINI_MAX_RETRIES || 3));
  let response;
  let lastErr = null;
  let firstTokenAt = null;
  const contents = buildGeminiContents(messages);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.log(
        `[${callSid}] Calling Gemini API (model: ${model}, messages: ${messages.length}, attempt: ${attempt}/${maxAttempts})`
      );

      response = await withTimeout(
        getGeminiClient().models.generateContent({
          model,
          contents,
          config: geminiVoiceConfig(systemPrompt),
        }),
        geminiTurnTimeoutMs(),
        'Gemini generateContent'
      );
      console.log(`[${callSid}] Gemini response received`);
      firstTokenAt = Date.now();
      lastErr = null;
      noteGeminiProviderOk();
      break;
    } catch (err) {
      lastErr = err;
      noteGeminiProviderError(classifyGeminiError(err), err);
      const retryable = !isTimeoutError(err) && isRetryableGeminiError(err);
      console.error(
        `[${callSid}] Gemini API call failed:`,
        `status=${err?.status || 'N/A'}`,
        `attempt=${attempt}/${maxAttempts}`,
        `retryable=${retryable}`,
        `message=${err?.message || err}`
      );
      if (!retryable || attempt >= maxAttempts) break;
      const backoffMs = Math.min(2000, 250 * 2 ** (attempt - 1));
      await sleep(backoffMs);
    }
  }

  if (lastErr || !response) {
    // Keep the call open so the caller can try again after a transient outage.
    return {
      spokenText: '',
      rawText: '',
      firstTokenAt: null,
      spokenEmitted: 0,
      model,
      shouldEndCall: false,
      llmFailed: true,
      llmHardDown: isHardGeminiOutage(lastErr),
      timedOut: isTimeoutError(lastErr),
    };
  }

  const outputText = extractGeminiText(response);
  const parsed = parseGeminiResponse(outputText);
  const heldTools = await applyToolsWithHold(callSid, parsed, hooks);
  const execution = heldTools.execution;
  let actionConfirmation = formatToolConfirmation(
    execution.results,
    callBrainStates.get(callSid)?.language?.current || 'en'
  );
  // A barge cancelled the hold. The outcome is not spoken on this turn, but
  // the caller is still owed it on the next one (toolOutcomeQueue).
  const bargedActionConfirmation = heldTools.toolHoldCancelled ? actionConfirmation : '';
  if (heldTools.toolHoldCancelled) actionConfirmation = '';
  const spokenText = polishSpokenReply(
    spokenTextForToolTurn({
      spoken: spokenTextWithoutToolFallback({
        spoken: parsed.spokenText,
        actionConfirmation,
      }),
      toolResults: execution.results,
    }),
    finalSpeechGuardOpts(callSid, execution.results)
  );

  const thoughtSignature = extractThoughtSignature(response) || undefined;
  messages.push({
    role: 'assistant',
    content: [spokenText, actionConfirmation].filter(Boolean).join(' '),
    geminiParts: modelPartsForHistory({
      geminiParts: extractGeminiParts(response),
      text: outputText,
      thoughtSignature,
    }),
    thoughtSignature,
  });

  return {
    spokenText,
    rawText: outputText,
    firstTokenAt,
    spokenEmitted: String(outputText || '').length,
    model,
    actionConfirmation,
    bargedActionConfirmation,
    toolResults: execution.results,
    shouldEndCall: execution.shouldEndCall,
  };
}

server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log(`📞 Voice webhook: POST /voice/incoming (SautiKit XML Stream → /ws/media)`);
  console.log(`📡 Media WebSocket: /ws/media (Host-based wss URL for Localtunnel)`);
  if (PUBLIC_BASE_URL) {
    console.log(`🌐 PUBLIC_BASE_URL: ${PUBLIC_BASE_URL}`);
  } else {
    console.log(`🌐 PUBLIC_BASE_URL not set — Stream URLs use request Host header`);
  }
  console.log(`✓ Supabase database initialized`);
  if (process.env.GEMINI_API_KEY) {
    console.log(`✓ GEMINI_API_KEY present (lazy-loaded on LLM use)`);
  } else {
    console.log(`ℹ GEMINI_API_KEY not set (optional for Phase 2 webhook tests)`);
  }
  if (isSonioxConfigured()) {
    console.log(`✓ SONIOX_API_KEY present (STT on /ws/media)`);
    if (isSonioxTtsConfigured()) {
      console.log(
        `✓ Soniox TTS enabled default voice=${resolveSonioxVoice()}`
      );
      refreshCuratedVoicesFromDb({ force: true })
        .then((voices) => {
          console.log(
            `✓ Soniox voice catalog loaded count=${voices.length} source=db-or-fallback`
          );
          return ensureSonioxVoiceReady({ log: console.log });
        })
        .then(() => warmOutageClips())
        .then((result) => {
          if (result?.ok) {
            console.log(
              `✓ Clone-voice downtime clips ready langs=${(result.warmed || []).join(',')}`
            );
          } else {
            console.warn(
              '⚠ Clone-voice downtime clips not warmed (Soniox billing or TTS down). Packaged WAV or espeak will play on outage.'
            );
          }
        })
        .catch((err) => {
          console.warn(
            `⚠ Soniox voice readiness check failed: ${err?.message || err}`
          );
        });
    } else {
      console.log(`ℹ SONIOX_API_KEY missing — no spoken replies`);
    }
  } else {
    console.log(`ℹ SONIOX_API_KEY not set — PCM will be logged only`);
  }
  if (smsSenderReady()) {
    probeSmsCredentials({ force: true })
      .then((status) => {
        if (status.verified) {
          console.log(
            `✓ SMS notify verified via TextSMS (shortcode=${status.shortcode}` +
              `${status.balance != null ? ` balance=${status.balance}` : ''}) — primary for leads + escalation`
          );
        } else {
          console.warn(
            `⚠ SMS env set but TextSMS probe failed code=${status.code} ${status.description || ''}` +
              ` — fix TEXTSMS_API_KEY / PARTNER_ID / SHORTCODE (escalation falls back to WA/email/desk)`
          );
        }
      })
      .catch((err) => {
        console.warn(`⚠ SMS probe error: ${err?.message || err}`);
      });
  } else {
    console.log(
      `ℹ SMS notify not set (TEXTSMS_API_KEY + TEXTSMS_PARTNER_ID + TEXTSMS_SHORTCODE)`
    );
  }
  if (whatsAppSenderReady()) {
    console.log(`✓ WhatsApp notify ready (secondary when SMS unavailable)`);
  } else if (process.env.SAUTIKIT_API_KEY) {
    console.log(`ℹ SAUTIKIT_API_KEY present — set SAUTIKIT_WHATSAPP_NUMBER_ID (or CONNECTION_ID) to enable WhatsApp alerts`);
  } else {
    console.log(`ℹ WhatsApp notify not configured`);
  }
  if (emailFallbackReady()) {
    console.log(`✓ Email alert fallback ready (from ${process.env.ALERT_EMAIL_FROM})`);
  } else {
    console.log(`ℹ Email fallback not set (RESEND_API_KEY + ALERT_EMAIL_FROM)`);
  }
  if (process.env.SAUTIKIT_API_KEY) {
    startTelephonyWalletProbe();
    console.log(`✓ Telephony wallet probe scheduled (VOICE_TELEPHONY_WALLET_PROBE_MS)`);
  }
  if (String(process.env.VOICE_PLATFORM_OPS_DRY_RUN || '').toLowerCase() === 'true') {
    console.log(`ℹ Platform ops alerts in DRY_RUN (log only)`);
  }
  void platformOpsRecipients({ force: true })
    .then(({ emails, source }) => {
      if (emails.length) {
        console.log(
          `✓ Platform ops alert list: ${emails.length} email(s) from ${source === 'admin' ? 'Super Admin' : 'SCALERS_OPS_ALERT_EMAILS'} (email only)`
        );
      }
    })
    .catch(() => {});
  if (String(process.env.SAUTIKIT_VALIDATE_WEBHOOKS || '').toLowerCase() === 'true') {
    console.log(`✓ SautiKit webhook signature validation ON`);
  }
});
