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
  isFillerCacheEnabled,
  lookupFillerPcm,
  putFillerPcm,
  isCancelableTtsStreamId,
  newCachedFillerStreamId,
  warmFillerAckPcm,
} = require('./src/speech/fillerPcmCache');
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
const { buildSystemPrompt, buildGreeting } = require('./src/prompts');
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
const { extractConversationEntities } = require('./src/conversation/entityExtraction');
const {
  buildBrainCapabilities,
  formatAuthorityPolicy,
} = require('./src/conversation/brainPolicy');
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
  resolvePrefetchedStreamSpeech,
  spokenTextForToolTurn,
} = require('./src/conversation/geminiVoice');
const {
  noteGeminiProviderError,
  noteGeminiProviderOk,
  getGeminiProviderHealth,
} = require('./src/conversation/geminiProviderHealth');
const {
  selectProductsForTurn,
  formatTargetedProductsForPrompt,
  normalizeProducts,
} = require('./src/conversation/productCatalog');
const {
  ensureRequiredEscalate,
  formatEscalateActionDirective,
} = require('./src/conversation/requiredEscalate');

/** Per-call tool toggles (escalate / end_call) from tenants.agent_tools. */
const callAgentTools = new Map();
/** Structured semantic state and actual runtime capabilities, keyed by callSid. */
const callBrainStates = new Map();
const callBrainCapabilities = new Map();
/** Per-call tenant grounding (product catalogue) for hold/order validation. */
const callTenantProfiles = new Map();
const {
  analyzeCallerLanguage,
  createLanguageState,
  resolveLanguageState,
  languageDirective,
} = require('./src/conversation/language');
const {
  generateDynamicGreeting,
  pickContextualAck,
  pickActionProgress,
  pickClarifyProgress,
  pickLlmRecoveryLine,
  pickLlmRecoverySaved,
  looksLikeCallerName,
  shouldSkipCallerTurn,
} = require('./src/conversation/dynamicSpeech');
const { prepareForTts } = require('./src/speech/ttsNormalize');
const {
  adaptiveFlushMs,
  decideCallerEvent,
  looksLikeEcho: turnLooksLikeEcho,
  classifyFinalDuringAgentSpeech,
  agentAwaitingReply,
} = require('./src/speech/turnTaking');
const { createSpokenStreamBuffer } = require('./src/speech/spokenStreamBuffer');
const {
  createOverlapHold,
  createAgentReplayMemory,
} = require('./src/speech/overlapHold');
const { createVoiceTurnTiming, createCallTranscript } = require('./src/speech/voiceTiming');
const { mergeInterimHypothesis } = require('./src/speech/interimBarge');
const { sautikitWebhookGuard } = require('./src/sautikit/webhook');
const {
  consumeLiveTransferWebhook,
  queuePendingLiveTransfer,
  hasPendingLiveTransfer,
  buildAnswerStreamXml,
  emptyVoiceXml,
} = require('./src/sautikit/pendingLiveTransfer');
const {
  summarizeHeaders,
  summarizeBody,
  createWsPayloadSampler,
} = require('./src/sautikit/safeLog');
const { isWhatsAppConfigured } = require('./src/notifications/whatsapp');
const {
  ownerLeadEvent,
  renderEventText,
} = require('./src/notifications/events');

/** Desk base for deep links in owner alerts. */
function deskBaseUrl() {
  return (
    String(
      process.env.DESK_PUBLIC_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        'https://scalers-project.vercel.app'
    ).trim() || 'https://scalers-project.vercel.app'
  );
}

function callDeskUrl(callId) {
  const id = String(callId || '').trim();
  if (!id) return null;
  return `${deskBaseUrl()}/calls/${encodeURIComponent(id)}`;
}
const {
  dispatchAlert,
  dispatchEscalationAlert,
  whatsAppSenderReady,
  emailFallbackReady,
  smsSenderReady,
} = require('./src/notifications/dispatch');
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
  return buildBrainCapabilities(
    { ...profile, agentTools: tools },
    {
      createServiceRequest: true,
      createAppointment: true,
      updateAppointment: true,
      notifyCallback: true,
      liveTransfer: ready.ready,
    }
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
  return (
    body.call_sid ||
    body.callSid ||
    body.CallSid ||
    body.sessionId ||
    body.SessionId ||
    body.data?.call_sid ||
    body.data?.callSid ||
    body.data?.sessionId ||
    body.payload?.call_sid ||
    body.payload?.callSid ||
    null
  );
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
  try {
    const derived = deriveCallResolution({ brainState });
    const summary = deriveCallSummary({ brainState });
    const saved = await db.setCallResolution({
      callSid,
      resolution: derived.resolution,
      primaryIntent: derived.primaryIntent || summary.primaryIntent,
      resolutionNote: derived.resolutionNote,
    });
    try {
      await db.mergeCallSummaryMeta({
        callSid,
        patch: {
          text: summary.text,
          brain_summary: summary.text,
          reason: summary.reason,
          primary_intent: derived.primaryIntent || summary.primaryIntent,
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
    schedulePostCallTranscriptReview({
      callSid,
      vertical: profile.vertical || '',
      derived,
      summary,
      toolFlags: toolFlagsFromBrain(brainState),
      turns: Array.isArray(opts.turns) ? opts.turns : null,
    });
    if (saved) {
      console.log(
        `[${source}] call resolution ${callSid} → ${derived.resolution}` +
          (derived.primaryIntent ? ` intent=${derived.primaryIntent}` : '')
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
    await persistCallResolution(callSid, source, { turns });
    return updated;
  } catch (err) {
    console.error(`[${source}] updateCallStatus failed:`, err?.message || err);
    return null;
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

    const preTerminal = detectCallTermination(req.body, callSessionState).terminal;

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

app.post('/', sautikitWebhookGuard, handleVoiceIncoming);
app.post('/voice/incoming', sautikitWebhookGuard, handleVoiceIncoming);
app.post('/voice', sautikitWebhookGuard, handleVoiceIncoming);

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
    const callSid =
      req.body.CallSid || req.body.callSid || req.body.call_sid || req.body.call_id;
    const recordingUrl =
      req.body.RecordingUrl || req.body.recording_url || req.body.recordingUrl;
    const recordingSid =
      req.body.RecordingSid || req.body.recording_sid || req.body.recordingSid;
    const recordingStatus =
      req.body.RecordingStatus || req.body.recording_status || req.body.status || 'completed';

    if (!callSid) {
      return res.status(400).json({ error: 'call_sid required' });
    }

    if (recordingStatus === 'completed' && recordingUrl) {
      const url = recordingUrl.endsWith('.mp3') ? recordingUrl : recordingUrl;
      await db.attachRecording({
        callSid,
        recordingSid,
        sourceUrl: url,
        recordingUrl: url,
      });
      await maybeSendWhatsAppNotification(callSid);
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
  // Always ACK immediately so SautiKit does not retry (DB work is best-effort).
  res.sendStatus(200);

  try {
    const body = req.body || {};
    console.log('[voice/events] payload', summarizeBody(body));

    const kind =
      req.headers['x-sautikit-event-kind'] ||
      body.kind ||
      body.event_type ||
      body.event ||
      body.type ||
      '';
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

    if (kindStr.includes('recording') && callSid) {
      const recordingUrl =
        body.recording_url ||
        body.url ||
        body.data?.recording_url ||
        body.data?.url ||
        body.payload?.recording_url ||
        null;
      const recordingSid = body.recording_sid || body.data?.recording_sid || null;
      if (recordingUrl) {
        try {
          await db.attachRecording({
            callSid,
            recordingSid,
            sourceUrl: recordingUrl,
            recordingUrl,
          });
          await maybeSendWhatsAppNotification(callSid);
        } catch (err) {
          console.error('[voice/events] attachRecording failed:', err?.message || err);
        }
      }
    }

    if (termination.terminal && callSid) {
      await markCallTerminalFromWebhook({
        callSid,
        status: termination.status,
        durationSeconds,
        source: 'voice/events',
      });
      if (termination.status === 'complete') {
        await maybeSendWhatsAppNotification(callSid);
      }
    } else if (termination.terminal && !callSid) {
      console.warn('[voice/events] terminal event without callSid — cannot update calls row');
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
  // Prefer small frames for smoother playback on the telephony side.
  for (let offset = 0; offset < pcm.length; offset += OUTBOUND_PCM_FRAME_BYTES) {
    const slice = pcm.subarray(offset, offset + OUTBOUND_PCM_FRAME_BYTES);
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
  let lastAgentText = '';
  let llmRecoveryOffered = false;
  let turnBusy = false;
  let utteranceParts = [];
  let utteranceTimer = null;
  const overlapHold = createOverlapHold();
  const agentReplay = createAgentReplayMemory();
  let fillerTimer = null;
  /** When true, discard the in-flight Gemini/TTS reply and wait for the caller turn. */
  let bargeInActive = false;
  let playbackGeneration = 0;
  let activePlaybackGeneration = 0;
  let pendingUtterance = null;
  let systemPrompt = buildSystemPrompt();
  let greetingLine = buildGreeting(process.env.BUSINESS_NAME || 'the business');
  let businessName = process.env.BUSINESS_NAME || 'the business';
  let agentName = process.env.AGENT_NAME || 'Receptionist';
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
    return summary;
  }
  let greetingStarted = false;
  /** Soniox 402/fatal: speak a local fallback once, then hang up. */
  let speechOutageStarted = false;
  let profileLoaded = false;
  let profileCallSid = null;
  /** Sticky call language: 'en' | 'sw' | 'sheng' | 'mixed' | 'unknown' */
  let callLanguage = 'unknown';
  let callLanguageState = createLanguageState();
  let brainProfile = {};
  let fillerUsedThisCall = false;
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
      teamDirectory: profile.teamDirectory || [],
      ttsLexicon: Array.isArray(profile.ttsLexicon) ? profile.ttsLexicon : [],
    };
    return buildSttContext(sttTenantSnapshot);
  }

  async function ensureTenantPrompt() {
    if (profileLoaded && profileCallSid === sessionCallSid) {
      return buildSttContext(sttTenantSnapshot);
    }
    try {
      const profile = await db.getTenantProfile({ callSid: sessionCallSid });
      brainProfile = profile;
      businessName = profile.businessName || businessName;
      agentName = profile.agentName || agentName;
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
        isOpen: openStatus === 'unknown' ? null : openStatus === 'open',
        afterHoursMode,
        closureNotice,
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

  async function playCachedFillerPcm(pcm, { text } = {}) {
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
    if (!isFillerCacheEnabled()) {
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
    greetingStarted = true;
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

  async function speakText(text, opts = {}) {
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
    // Starting intentional playback clears a prior barge latch.
    bargeInActive = false;
    speaking = true;
    speakStartedAt = Date.now();
    lastAgentText = String(text);
    if (!opts.isFiller && !opts.isReplay) {
      agentReplay.beginSpeech(text);
    }
    activePlaybackGeneration = ++playbackGeneration;
    const gen = activePlaybackGeneration;
    // One owner for TTS language + pronunciation prep (per-utterance + sticky call lang).
    const prepared = prepareForTts(text, {
      callLanguage,
      language: opts.language,
      extraLexicon: ttsLexiconOverrides,
    });
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
        capture: Boolean(opts.isFiller && isFillerCacheEnabled()),
      });
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
          const committed = agentReplay.commitPlayback();
          if (committed.lastAgentQuestion) {
            console.log(`[ws/media][${sidLabel()}] agent_question_committed`);
          }
        }
        if (!speechOutageStarted) releaseQueuedCallerSpeech(gen);
      }
    }
  }

  function cancelSpeech(reason) {
    const endingGen = activePlaybackGeneration;
    clearFillerTimer();
    bargeInActive = true;
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
    const decision = decideCallerEvent({
      text,
      speaking,
      turnBusy,
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
    cancelSpeech(`${source}/${decision.reason}`);
    return decision;
  }

  function looksLikeEcho(text) {
    return turnLooksLikeEcho(text, lastAgentText);
  }

  function kickPendingTurn() {
    if (turnBusy || !pendingUtterance) return;
    const text = pendingUtterance;
    pendingUtterance = null;
    runCallerTurn(text).catch((err) => {
      console.error(`[ws/media][${sidLabel()}] runCallerTurn error:`, err?.message || err);
    });
  }

  function currentLlmRecoveryLine() {
    return pickLlmRecoveryLine({
      language: callLanguage,
      alreadyOffered: llmRecoveryOffered,
    });
  }

  async function resolveLlmRecoverySpeech(userText = '') {
    const health = getGeminiProviderHealth();
    if (!llmRecoveryOffered && (health.billingExhausted || health.denied)) {
      void noteSpeechOutage({ profile: brainProfile, kind: 'llm' }).catch((err) => {
        console.warn(
          `[ws/media][${sidLabel()}] owner reasoning alert failed:`,
          err?.message || err
        );
      });
    }
    if (llmRecoveryOffered && looksLikeCallerName(userText)) {
      const name = String(userText || '').replace(/\s+/g, ' ').trim();
      try {
        await db.saveCallerInfo({
          callSid: sidLabel(),
          name,
          reason: 'Live line could not complete. Team to follow up.',
        });
        maybeSendWhatsAppNotification(sidLabel());
      } catch (err) {
        console.error(
          `[ws/media][${sidLabel()}] llm recovery save failed:`,
          err?.message || err
        );
      }
      llmRecoveryOffered = true;
      return pickLlmRecoverySaved({ language: callLanguage });
    }
    const line = currentLlmRecoveryLine();
    llmRecoveryOffered = true;
    return line;
  }

  async function runCallerTurn(userText) {
    const clean = String(userText || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (turnBusy) {
      // Merge continuation fragments into one pending utterance (don't drop context).
      pendingUtterance = pendingUtterance ? `${pendingUtterance} ${clean}` : clean;
      return;
    }

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
      console.log(
        `[ws/media][${sidLabel()}] agent_question_replay reason=${idleDecision.reason}`
      );
      await speakText(replayLine, { isReplay: true });
      return;
    }
    // Skip pure noise, but keep yes/no and short names when the agent just asked.
    if (shouldSkipCallerTurn(clean, { lastAgentText })) {
      console.log(`[ws/media][${sidLabel()}] skip non-substantive turn: ${clean}`);
      return;
    }

    overlapHold.discardExcept(0);
    turnBusy = true;
    bargeInActive = false;
    const turnTiming = createVoiceTurnTiming(sidLabel());
    activeTurnTiming = turnTiming;

    const callKey = sidLabel();
    const languageEvidence = analyzeCallerLanguage(clean);
    callLanguageState = resolveLanguageState(callLanguageState, languageEvidence);
    callLanguage = callLanguageState.current;
    const capabilities =
      callBrainCapabilities.get(callKey) ||
      capabilitiesForProfile(brainProfile, callAgentTools.get(callKey) || parseAgentTools(null));
    const previousBrainState =
      callBrainStates.get(callKey) || createBrainState(brainProfile);
    const provisionalIntent = inferIntent(clean);
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
    let brainState = observeCallerTurn(
      previousBrainState,
      {
        text: clean,
        languageState: callLanguageState,
        entities,
        profile: brainProfile,
        lastAgentText,
      }
    );
    const nextBestAction = determineNextBestAction({ state: brainState, capabilities });
    brainState = setNextBestAction(brainState, nextBestAction);
    callBrainStates.set(callKey, brainState);
    callBrainCapabilities.set(callKey, capabilities);
    logBrainTrace({
      callSid: callKey,
      phase: 'decision',
      state: brainState,
      decision: nextBestAction,
    });
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
    try {
      const actionMayExecute = ['CREATE_REQUEST', 'CAPTURE', 'ESCALATE', 'TRANSFER'].includes(
        nextBestAction.action
      );
      // Human handoff with missing name uses ASK_CLARIFICATION. Speak now so
      // the caller never waits silently on Gemini (live miss: HD_02bda14e6547).
      const handoffNameAsk =
        nextBestAction.action === 'ASK_CLARIFICATION' &&
        (brainState.intent === 'human' || Boolean(brainState.handoff?.requested)) &&
        (nextBestAction.slot === 'name' ||
          (Array.isArray(brainState.goal?.missingSlots) &&
            brainState.goal.missingSlots.includes('name')));
      const needsImmediateProgress = actionMayExecute || handoffNameAsk;

      // Action / handoff-clarify turns disable streaming and wait on Gemini+tools.
      // Speak progress immediately so orders/escalations are not dead air.
      /** @type {Promise<void>} */
      let actionProgressSpeak = Promise.resolve();
      if (needsImmediateProgress && tts && !bargeInActive) {
        const progressLine = handoffNameAsk
          ? pickClarifyProgress({
              action: nextBestAction.action,
              slot: nextBestAction.slot || 'name',
              intent: brainState.intent,
              language: callLanguage,
            })
          : pickActionProgress(nextBestAction.action, callLanguage);
        clearFillerTimer();
        turnTiming.markFiller();
        console.log(
          `[ws/media][${sidLabel()}] action-progress action=${nextBestAction.action}` +
            `${handoffNameAsk ? ' handoffNameAsk=1' : ''}` +
            ` lang=${callLanguage}: ${progressLine}`
        );
        // Persist progress in the desk transcript — callers hear this line.
        callTranscript.pushAgent(progressLine);
        progressAlreadySpoken = true;
        spokeThisTurn = true;
        actionProgressSpeak = speakText(progressLine)
          .then(() => {
            spokeThisTurn = true;
          })
          .catch(() => {});
      }

      // VOICE_FILLER=auto (default): adaptive ack only if first spoken audio is slow.
      // ack → always schedule a tiny backchannel; off → silence; custom → fixed phrase.
      // Skip when we already spoke an action-progress line for this turn.
      const fillerMode = (process.env.VOICE_FILLER || 'auto').toLowerCase();
      const useFiller =
        Boolean(tts) &&
        fillerMode !== 'off' &&
        !fillerUsedThisCall &&
        !needsImmediateProgress;
      const fillerDelayMs = Number(process.env.VOICE_FILLER_DELAY_MS || 400);
      const fillerText =
        fillerMode === 'ack' || fillerMode === 'auto'
          ? pickContextualAck(clean, callLanguage)
          : process.env.VOICE_FILLER;
      let fillerStarted = false;
      let firstSpokenChunk = false;

      if (useFiller && fillerText) {
        fillerTimer = setTimeout(() => {
          fillerTimer = null;
          // Adaptive: skip if LLM→TTS already started (stream chunk or full reply).
          if (turnBusy && !speaking && !bargeInActive && !firstSpokenChunk) {
            fillerStarted = true;
            fillerUsedThisCall = true;
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
        !needsImmediateProgress &&
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
          extraLexicon: ttsLexiconOverrides,
        });
        console.log(`[ws/media][${sidLabel()}] llm→tts stream open`);
        return speakSession;
      }

      async function onSpokenChunk(chunk) {
        const text = String(chunk || '').trim();
        if (!text || !tts) return;
        firstSpokenChunk = true;
        spokeThisTurn = true;
        turnTiming.markFirstSpokenChunk();
        stopFillerForReply();
        if (bargeInActive) return;

        const session = await ensureReplySpeakSession();
        if (!session || bargeInActive) {
          try {
            session?.cancel();
          } catch {
            /* ignore */
          }
          speakSession = null;
          return;
        }

        if (!speaking || activePlaybackGeneration !== playbackGeneration) {
          const prev = activePlaybackGeneration;
          speaking = true;
          speakStartedAt = Date.now();
          activePlaybackGeneration = ++playbackGeneration;
          streamPlaybackGen = activePlaybackGeneration;
          if (prev > 0) overlapHold.reassignPending(prev, activePlaybackGeneration);
        }
        activeOutboundStreamId = session.streamId;

        session.pushText(text);
        spokenChunks.push(text);
        lastAgentText = spokenChunks.join(' ');
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
        };
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
          await actionProgressSpeak;
          callTranscript.pushAgent(result.spokenText);
          turnTiming.markFirstSpokenChunk();
          await speakText(result.spokenText);
          spokeThisTurn = true;
        }
      } else if (streamOn) {
        turnTiming.markLlmStart();
        result = await runGeminiTurnStreaming(messages, sidLabel(), turnSystemPrompt, {
          onSpokenChunk,
          shouldAbort: () => bargeInActive,
        });
        stopFillerForReply();

        if (speakSession) {
          if (bargeInActive) {
            try {
              speakSession.cancel();
            } catch {
              /* ignore */
            }
            console.log(`[ws/media][${sidLabel()}] discarding streamed reply after barge-in`);
            discardUnspokenAssistant(result?.spokenText || spokenChunks.join(' '));
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
                  const committed = agentReplay.commitPlayback();
                  if (committed.lastAgentQuestion) {
                    console.log(`[ws/media][${sidLabel()}] agent_question_committed`);
                  }
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
              const reply =
                result?.timedOut || result?.llmFailed
                  ? await resolveLlmRecoverySpeech(clean)
                  : planned.reply;
              callTranscript.pushAgent(reply);
              turnTiming.markFirstSpokenChunk();
              await speakText(reply);
              spokeThisTurn = true;
              turnOutcome = result?.timedOut ? 'stream_timeout' : 'stream_fallback_full';
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
            const reply =
              result?.timedOut || result?.llmFailed
                ? await resolveLlmRecoverySpeech(clean)
                : planned.reply;
            callTranscript.pushAgent(reply);
            turnTiming.markFirstSpokenChunk();
            await speakText(reply);
            spokeThisTurn = true;
            turnOutcome = result?.timedOut ? 'stream_timeout' : 'stream_fallback_full';
          }
        } else {
          discardUnspokenAssistant(result?.spokenText || '');
          bargeInActive = false;
          logTurnTiming(turnTiming, { outcome: 'barge_in' });
          if (activeTurnTiming === turnTiming) activeTurnTiming = null;
          return;
        }
      } else {
        turnTiming.markLlmStart();
        result = await runGeminiTurn(messages, sidLabel(), turnSystemPrompt);
        stopFillerForReply();
        if (speakSession) {
          try {
            speakSession.cancel();
          } catch {
            /* ignore */
          }
          speakSession = null;
        }
        const reply =
          result?.spokenText ||
          (result?.actionConfirmation
            ? ''
            : result?.timedOut || result?.llmFailed
              ? await resolveLlmRecoverySpeech(clean)
              : '');
        if (bargeInActive) {
          console.log(`[ws/media][${sidLabel()}] discarding Gemini reply after barge-in`);
          discardUnspokenAssistant(reply);
          bargeInActive = false;
          logTurnTiming(turnTiming, { outcome: 'barge_in' });
          if (activeTurnTiming === turnTiming) activeTurnTiming = null;
          return;
        }
        // Finish "let me save that" before the tool confirmation so they don't overlap.
        await actionProgressSpeak;
        // Handoff name-ask already spoke the required question — skip duplicate model prose.
        const skipDuplicateAsk =
          handoffNameAsk &&
          progressAlreadySpoken &&
          !result?.actionConfirmation;
        if (reply && !skipDuplicateAsk) {
          callTranscript.pushAgent(reply);
          turnTiming.markFirstSpokenChunk();
          await speakText(reply);
          spokeThisTurn = true;
        }
      }

      if (result?.actionConfirmation && !bargeInActive) {
        await actionProgressSpeak;
        callTranscript.pushAgent(result.actionConfirmation);
        await speakText(result.actionConfirmation);
        spokeThisTurn = true;
      }

      // Hard guarantee: every completed caller turn must produce agent audio.
      if (!spokeThisTurn && !bargeInActive && tts) {
        const guarantee = handoffNameAsk
          ? pickClarifyProgress({
              action: nextBestAction.action,
              slot: nextBestAction.slot || 'name',
              intent: brainState.intent,
              language: callLanguage,
            })
          : actionMayExecute
            ? pickActionProgress(nextBestAction.action, callLanguage)
            : await resolveLlmRecoverySpeech(clean);
        console.warn(
          `[ws/media][${sidLabel()}] turn speech guarantee fired action=${nextBestAction.action}`
        );
        callTranscript.pushAgent(guarantee);
        turnTiming.markFirstSpokenChunk();
        await speakText(guarantee);
        spokeThisTurn = true;
        turnOutcome = 'speech_guarantee';
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
      if (!bargeInActive && !progressAlreadySpoken && !spokeThisTurn) {
        const recovery = await resolveLlmRecoverySpeech(clean);
        callTranscript.pushAgent(recovery);
        await speakText(recovery);
      }
      logTurnTiming(turnTiming, { outcome: 'error' });
      if (activeTurnTiming === turnTiming) activeTurnTiming = null;
    } finally {
      clearFillerTimer();
      if (activeTurnTiming === turnTiming) {
        logTurnTiming(turnTiming, { outcome: 'early_return' });
        activeTurnTiming = null;
      }
      turnBusy = false;
      kickPendingTurn();
    }
  }

  function flushUtterance() {
    if (utteranceTimer) {
      clearTimeout(utteranceTimer);
      utteranceTimer = null;
    }
    if (!utteranceParts.length) return;
    const text = utteranceParts.join('').replace(/\s+/g, ' ').trim();
    utteranceParts = [];
    if (!text) return;
    if (overlapHold.alreadyReleased(text)) {
      console.log(`[ws/media][${sidLabel()}] caller_turn_duplicate_suppressed`);
      return;
    }
    overlapHold.markReleased(text);
    if (turnBusy) {
      pendingUtterance = pendingUtterance ? `${pendingUtterance} ${text}` : text;
      return;
    }
    console.log(`[ws/media][${sidLabel()}] caller_turn_processed`);
    runCallerTurn(text).catch((err) => {
      console.error(`[ws/media][${sidLabel()}] runCallerTurn error:`, err?.message || err);
    });
  }

  function scheduleUtteranceFlush() {
    if (utteranceTimer) clearTimeout(utteranceTimer);
    // Adaptive fallback if Soniox endpoint marker is delayed/missing.
    const pendingText = utteranceParts.join('').replace(/\s+/g, ' ').trim();
    const flushMs = adaptiveFlushMs({
      text: pendingText,
      lastAgentText,
    });
    console.log(
      `[ws/media][${sidLabel()}] schedule flush in ${flushMs}ms chars=${pendingText.length}`
    );
    utteranceTimer = setTimeout(() => flushUtterance(), flushMs);
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

      const isInterim = !evt.isFinal;

      // Instant barge-in on accumulated interim tokens while TTS/LLM is busy.
      if (isInterim) {
        if (speaking || turnBusy) {
          interimBargeText = mergeInterimHypothesis(interimBargeText, text);
          const interimDecision = maybeBargeIn(interimBargeText, 'interim speech');
          if (
            speaking &&
            !interimDecision.interrupt &&
            (interimDecision.queue || interimDecision.action === 'queue')
          ) {
            overlapHold.noteInterim(interimBargeText, activePlaybackGeneration);
          }
        } else {
          interimBargeText = '';
        }
        return;
      }

      // Finals: one turn-taking decision, then act.
      interimBargeText = '';
      const decision = maybeBargeIn(text, 'final speech');

      if (decision.reason === 'echo') {
        console.log(
          `[ws/media][${sidLabel()}] drop echo final while TTS: ${text.slice(0, 80)}`
        );
        return;
      }

      if (decision.replay) {
        const replay = hearAgainReplayText();
        if (replay) {
          console.log(
            `[ws/media][${sidLabel()}] agent_question_replay reason=${decision.reason}`
          );
          void speakText(replay, { isReplay: true });
        }
        return;
      }

      if (decision.action === 'barge_listen') {
        return;
      }

      if (decision.action === 'ignore' || decision.action === 'skip') {
        if (decision.queue) {
          utteranceParts.push(text);
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
        console.log(
          `[ws/media][${sidLabel()}] caller_turn_queued gen=${activePlaybackGeneration}`
        );
        return;
      }
      if (overlapHold.alreadyReleased(text)) {
        overlapHold.consumeInterimIfMatches(text);
        console.log(`[ws/media][${sidLabel()}] caller_turn_duplicate_suppressed`);
        return;
      }
      overlapHold.consumeInterimIfMatches(text);
      utteranceParts.push(text);
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
      flushUtterance();
    }
  }

  function bindMediaTts(voiceId) {
    const session = createSonioxTtsSession({
      callSid: sidLabel(),
      voiceId,
      onAudio: (pcm, meta = {}) => {
        // Drop outbound audio after barge-in cancel / superseded playback generation.
        if (!speaking) return;
        if (activePlaybackGeneration !== playbackGeneration) return;
        // Drop orphan filler / cancelled-stream PCM that arrives late.
        if (
          activeOutboundStreamId &&
          meta.streamId &&
          meta.streamId !== activeOutboundStreamId
        ) {
          return;
        }
        if (activeTurnTiming) activeTurnTiming.markFirstPcm();
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

  // Greet once the tenant profile is loaded (correct business/agent name) and TTS is up.
  // TTS connects in parallel with tenant fetch so first PCM is not serial.
  (async () => {
    if (greetingStarted) return;
    greetingStarted = true;
    try {
      await ensureTenantPrompt();
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
      if (!readyTts) {
        console.warn(
          `[ws/media][${sidLabel()}] greeting skipped — TTS not ready`
        );
        await handleSpeechProviderOutage('tts not ready');
        return;
      }

      // Instant local greeting (correct tenant name). Do not wait on Gemini.
      greetingLine = await generateDynamicGreeting({
        businessName,
        agentName,
        servicesCatalog: brainProfile.servicesCatalog,
        servicesOffered: brainProfile.servicesOffered,
        isOpen: openStatus === 'unknown' ? null : openStatus === 'open',
        afterHoursMode,
        closureNotice,
        callSid: sidLabel(),
        mode: 'instant',
      });
      if (speechOutageStarted) return;
      console.log(
        `[ws/media][${sidLabel()}] greeting mode=instant agent=${agentName} open=${openStatus} afterHours=${afterHoursMode} bulletinClosed=${Boolean(closureNotice)}: ${greetingLine}`
      );

      const spoken = await speakText(greetingLine);
      if (spoken?.outage || speechOutageStarted) return;
      if (spoken?.ok) {
        callTranscript.pushAgent(greetingLine);
        messages.push({ role: 'assistant', content: greetingLine, local: true });
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
    } catch (err) {
      console.error(`[ws/media][${sidLabel()}] greeting failed:`, err?.message || err);
      try {
        const fallback = buildGreeting(businessName, {
          agentName,
          servicesCatalog: brainProfile.servicesCatalog,
          servicesOffered: brainProfile.servicesOffered,
          isOpen: openStatus === 'unknown' ? null : openStatus === 'open',
          afterHoursMode,
          closureNotice,
        });
        await speakText(fallback);
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
            const maybeSid =
              meta.callSid ||
              meta.sessionId ||
              meta.call_sid ||
              meta.call_id ||
              meta.streamSid ||
              parsed.sessionId ||
              parsed.streamSid ||
              null;
            if (maybeSid && !sessionCallSid) {
              sessionCallSid = String(maybeSid);
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
async function maybeSendEscalationNotification(callSid, escalate = {}) {
  const call = await db.getCall(callSid);
  if (!call) return { ok: false, reason: 'Call record was not found.' };
  if (call.escalation_sent) return { ok: true, channel: 'already_sent' };
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

    const resolved = resolveEscalation(teamDirectory, escalate.teammate);
    const teammate = resolved.teammate;
    const callerName = String(escalate.name || call.name || '').trim() || null;
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
      name: callerName || call.name,
      reason: reason || call.reason,
      callerNumber: call.from_number,
      recordingUrl: call.recording_url,
    };
    const body = buildEscalationText({
      ...lead,
      teammate,
      requested: resolved.requested,
      match: resolved.match,
    });

    const sent = await dispatchEscalationAlert({
      teammatePhone: teammate?.phone || null,
      ownerPhone: ownerNumber,
      ownerEmail,
      body,
      lead,
      channels: notifyChannels,
      subject: `Escalation for ${teammateLabel(teammate)}${businessName ? ` — ${businessName}` : ''}`,
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
      // Desk already has the escalation note via saveEscalation — treat as soft success
      // so the caller hears a follow-up promise instead of a hard failure.
      const refreshed = await db.getCall(callSid);
      if (refreshed?.name && refreshed?.reason) {
        await maybeSendWhatsAppNotification(callSid);
      }
      await db.markEscalationSent(callSid);
      const softOutcome = shapeEscalationNotifyOutcome({
        ok: true,
        soft: true,
        channel: 'desk_note',
        reason: 'No live SMS/WA/email channel; escalation saved on the call for the desk.',
      });
      await db.mergeCallSummaryMeta({
        callSid,
        patch: { escalation_notify: softOutcome },
      });
      return {
        ok: true,
        soft: true,
        transfer: transferQueued,
        channel: 'desk_note',
        sent: [{ channel: 'desk_note', role: 'desk', to: null }],
        reason: softOutcome.reason,
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
      patch: { escalation_notify: liveOutcome },
    });
    return {
      ok: true,
      soft: false,
      transfer: transferQueued,
      channel: liveOutcome.channels.map((c) => c.channel).join(',') || 'alert',
      sent,
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

async function maybeSendWhatsAppNotification(callSid) {
  // Lead alert: WhatsApp owner number when sender is ready; email fallback otherwise.
  const call = await db.getCall(callSid);
  if (!call) return;

  const hasCallerInfo = Boolean(call.name && call.reason);
  if (!hasCallerInfo) return;

  if (ownerNotifyInProgress.has(callSid)) return;
  if (call.whatsapp_sent) return;
  ownerNotifyInProgress.add(callSid);

  try {
    let ownerNumber = process.env.BUSINESS_OWNER_WHATSAPP_NUMBER || null;
    let ownerEmail = process.env.OWNER_ALERT_EMAIL || null;
    let businessName = process.env.BUSINESS_NAME || null;
    let notifyChannels = null;
    try {
      const profile = await db.getTenantProfile({ callSid });
      ownerNumber = profile.whatsappNumber || ownerNumber;
      ownerEmail = profile.alertEmail || ownerEmail;
      businessName = profile.businessName || businessName;
      notifyChannels = profile.notifyChannels || null;
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
      name: call.name,
      reason: call.reason,
      callerNumber: call.from_number,
      recordingUrl: call.recording_url,
    };

    const result = await dispatchAlert({
      to: ownerNumber,
      email: ownerEmail,
      body,
      lead,
      channels: notifyChannels,
    });
    if (!result.channel) {
      console.warn(`[${callSid}] Owner notify skipped (${result.reason || 'unknown'}). Lead ready:`, {
        name: call.name,
        phone: call.from_number,
        reason: call.reason,
        recording: call.recording_url,
        ownerNumber: ownerNumber || null,
        ownerEmail: ownerEmail || null,
        smsSender: smsSenderReady(),
        whatsappSender: whatsAppSenderReady(),
        emailFallback: emailFallbackReady(),
      });
      return;
    }

    await db.markWhatsappSent(callSid);
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

/** Dedicated hold/order/enquiry alert — does not mark lead whatsapp_sent. */
async function maybeSendServiceRequestNotification(callSid, request) {
  if (!request) return;
  let ownerNumber = process.env.BUSINESS_OWNER_WHATSAPP_NUMBER || null;
  let ownerEmail = process.env.OWNER_ALERT_EMAIL || null;
  let businessName = process.env.BUSINESS_NAME || 'your business';
  let notifyChannels = null;
  try {
    const profile = await db.getTenantProfile({ callSid });
    ownerNumber = profile.whatsappNumber || ownerNumber;
    ownerEmail = profile.alertEmail || ownerEmail;
    businessName = profile.businessName || businessName;
    notifyChannels = profile.notifyChannels || null;
  } catch (err) {
    console.warn(
      `[${callSid}] tenant lookup for request notify failed:`,
      err?.message || err
    );
  }

  const type = String(request.request_type || 'enquiry').toLowerCase();
  const typeLabel =
    type === 'hold'
      ? 'HOLD / PICKUP'
      : type === 'order'
        ? 'ORDER'
        : type === 'callback'
          ? 'CALLBACK'
          : 'ENQUIRY';

  const lines = [
    `${typeLabel} — ${businessName}`,
    request.item ? `Item: ${request.item}` : null,
    request.quantity ? `Qty: ${request.quantity}` : null,
    request.when_text ? `When: ${request.when_text}` : null,
    request.caller_name ? `Caller: ${request.caller_name}` : null,
    request.caller_phone ? `Phone: ${request.caller_phone}` : null,
    request.notes ? `Notes: ${request.notes}` : null,
    'Open Requests in Scalers desk to mark fulfilled.',
  ].filter(Boolean);

  const body = lines.join('\n');
  const lead = {
    businessName,
    name: request.caller_name || 'Caller',
    reason: `${typeLabel}: ${[request.item, request.when_text].filter(Boolean).join(' — ')}`,
    callerNumber: request.caller_phone,
  };

  const result = await dispatchAlert({
    to: ownerNumber,
    email: ownerEmail,
    body,
    lead,
    channels: notifyChannels,
    subject: `${typeLabel} — ${businessName}`,
  });
  if (result.channel) {
    console.log(
      `[${callSid}] Request notify (${type}) via ${result.channel}` +
        (result.to ? ` → ${result.to}` : '')
    );
  } else {
    console.warn(
      `[${callSid}] Request notify skipped (${result.reason || 'unknown'})`
    );
  }
}

/** Visit booking alert for home-services appointments. */
async function maybeSendAppointmentNotification(callSid, appointment, kind = 'created') {
  if (!appointment) return;
  let ownerNumber = process.env.BUSINESS_OWNER_WHATSAPP_NUMBER || null;
  let ownerEmail = process.env.OWNER_ALERT_EMAIL || null;
  let businessName = process.env.BUSINESS_NAME || 'your business';
  let notifyChannels = null;
  try {
    const profile = await db.getTenantProfile({ callSid });
    ownerNumber = profile.whatsappNumber || ownerNumber;
    ownerEmail = profile.alertEmail || ownerEmail;
    businessName = profile.businessName || businessName;
    notifyChannels = profile.notifyChannels || null;
  } catch (err) {
    console.warn(
      `[${callSid}] tenant lookup for appointment notify failed:`,
      err?.message || err
    );
  }

  const status = String(appointment.status || 'requested').toLowerCase();
  const title =
    kind === 'updated'
      ? status === 'cancelled'
        ? 'VISIT CANCELLED'
        : 'VISIT UPDATED'
      : 'VISIT REQUEST';

  const lines = [
    `${title} — ${businessName}`,
    appointment.service_name ? `Service: ${appointment.service_name}` : null,
    appointment.when_text ? `When: ${appointment.when_text}` : null,
    appointment.address_landmark
      ? `Where: ${appointment.address_landmark}`
      : null,
    appointment.caller_name ? `Caller: ${appointment.caller_name}` : null,
    appointment.caller_phone ? `Phone: ${appointment.caller_phone}` : null,
    appointment.notes ? `Notes: ${appointment.notes}` : null,
    `Status: ${status}`,
    'Open Appointments in Scalers desk to confirm or cancel.',
  ].filter(Boolean);

  const body = lines.join('\n');
  const lead = {
    businessName,
    name: appointment.caller_name || 'Caller',
    reason: `${title}: ${[appointment.service_name, appointment.when_text]
      .filter(Boolean)
      .join(' — ')}`,
    callerNumber: appointment.caller_phone,
  };

  const result = await dispatchAlert({
    to: ownerNumber,
    email: ownerEmail,
    body,
    lead,
    subject: `${title} — ${businessName}`,
    channels: notifyChannels,
  });
  if (result.channel) {
    console.log(
      `[${callSid}] Appointment notify (${kind}/${status}) via ${result.channel}` +
        (result.to ? ` → ${result.to}` : '')
    );
  } else {
    console.warn(
      `[${callSid}] Appointment notify skipped (${result.reason || 'unknown'})`
    );
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
        const provisionalIntent = inferIntent(data.voicePrompt);
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
        let brainState = observeCallerTurn(
          previousBrainState,
          {
            text: data.voicePrompt,
            languageState: callLanguageState,
            entities,
            profile: brainProfile,
          }
        );
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
          formatTargetedProductsForPrompt(turnMatches, {
            totalCatalogSize: catalogSize,
            queryText: data.voicePrompt,
            catalog: brainProfile.productCatalog,
          }),
          languageDirective(callLanguage),
        ]
          .filter(Boolean)
          .join('\n\n');

        const reply = await runGeminiTurn(messages, callSid, turnPrompt);
        const replyText = [reply.spokenText, reply.actionConfirmation]
          .filter(Boolean)
          .join(' ');
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
  const enforcedParsed = ensureRequiredEscalate(parsed, state, capabilities);
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
  if (savedInfo?.name && savedInfo?.reason && !escalationRequested) {
    maybeSendWhatsAppNotification(callSid);
  }

  for (const result of execution.results) {
    console.log(
      `[${callSid}] brain action=${result.action} status=${result.status}` +
        (result.reason ? ` reason=${result.reason}` : '')
    );
  }
  return execution;
}

/**
 * Stream Gemini tokens → onSpokenChunk (sentence/clause flushes) → TTS.
 * Falls back to non-streaming generateContent on stream failure.
 */
async function runGeminiTurnStreaming(
  messages,
  callSid,
  systemPrompt = buildSystemPrompt(),
  { onSpokenChunk, shouldAbort } = {}
) {
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const contents = buildGeminiContents(messages);
  const buffer = createSpokenStreamBuffer();
  let fullText = '';
  let streamFailed = false;
  let thoughtSignature = '';
  let modelParts = [];
  const timeoutMs = geminiTurnTimeoutMs();

  try {
    console.log(
      `[${callSid}] Calling Gemini stream (model: ${model}, messages: ${messages.length}, timeoutMs=${timeoutMs})`
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
          fullText += delta;
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
  } catch (err) {
    if (isTimeoutError(err) && fullText) {
      console.warn(
        `[${callSid}] Gemini stream timed out after ${timeoutMs}ms with partial text chars=${fullText.length}`
      );
    } else {
      streamFailed = true;
      console.error(
        `[${callSid}] Gemini stream failed, falling back to generateContent:`,
        err?.message || err
      );
    }
  }

  if (streamFailed && !fullText) {
    return runGeminiTurn(messages, callSid, systemPrompt);
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
  const execution = await safeApplyGeminiTools(callSid, parsed);
  const actionConfirmation = formatToolConfirmation(
    execution.results,
    callBrainStates.get(callSid)?.language?.current || 'en'
  );
  const spokenText = spokenTextForToolTurn({
    spoken: spokenTextWithoutToolFallback({
      spoken: buffer.getSpokenEmitted() || parsed.spokenText,
      actionConfirmation,
    }),
    toolResults: execution.results,
  });

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
    actionConfirmation,
    toolResults: execution.results,
    shouldEndCall: execution.shouldEndCall,
    streamed: !streamFailed,
  };
}

// Runs one turn of the conversation through Gemini, preserving the chat
// history and executing the caller-info / end-call signals via structured
// markers returned in the model output.
async function runGeminiTurn(messages, callSid, systemPrompt = buildSystemPrompt()) {
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const maxAttempts = Math.max(1, Number(process.env.GEMINI_MAX_RETRIES || 3));
  let response;
  let lastErr = null;
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
      shouldEndCall: false,
      llmFailed: true,
      timedOut: isTimeoutError(lastErr),
    };
  }

  const outputText = extractGeminiText(response);
  const parsed = parseGeminiResponse(outputText);
  const execution = await safeApplyGeminiTools(callSid, parsed);
  const actionConfirmation = formatToolConfirmation(
    execution.results,
    callBrainStates.get(callSid)?.language?.current || 'en'
  );
  const spokenText = spokenTextForToolTurn({
    spoken: spokenTextWithoutToolFallback({
      spoken: parsed.spokenText,
      actionConfirmation,
    }),
    toolResults: execution.results,
  });

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
    actionConfirmation,
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
  if (String(process.env.SAUTIKIT_VALIDATE_WEBHOOKS || '').toLowerCase() === 'true') {
    console.log(`✓ SautiKit webhook signature validation ON`);
  }
});
