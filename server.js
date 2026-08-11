// server.js
// Phase 2: SautiKit voice webhook + media WebSocket stub.
// Persistence: Supabase (calls, transcripts, call-recordings Storage).
// Twilio has been removed from the telephony path.

require('dotenv').config();
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
const { buildSystemPrompt, buildGreeting } = require('./src/prompts');
const { openClosedStatus } = require('./src/conversation/businessHours');
const { bulletinClosureNotice } = require('./src/conversation/dailyBulletin');
const { parseAgentTools } = require('./src/conversation/agentTools');
const { parseGeminiResponse } = require('./src/conversation/toolMarkers');

/** Per-call tool toggles (escalate / end_call) from tenants.agent_tools. */
const callAgentTools = new Map();
const {
  detectCallerLanguage,
  resolveCallLanguage,
  isBackchannel,
  languageDirective,
} = require('./src/conversation/language');
const {
  generateDynamicGreeting,
  pickContextualAck,
  shouldSkipCallerTurn,
} = require('./src/conversation/dynamicSpeech');
const { prepareForTts } = require('./src/speech/ttsNormalize');
const {
  adaptiveFlushMs,
  evaluateBargeIn,
  looksLikeEcho: turnLooksLikeEcho,
  classifyFinalDuringAgentSpeech,
} = require('./src/speech/turnTaking');
const {
  createSpokenStreamBuffer,
} = require('./src/speech/spokenStreamBuffer');
const { createVoiceTurnTiming } = require('./src/speech/voiceTiming');
const { mergeInterimHypothesis } = require('./src/speech/interimBarge');
const { sautikitWebhookGuard } = require('./src/sautikit/webhook');
const { isWhatsAppConfigured } = require('./src/notifications/whatsapp');
const {
  dispatchAlert,
  dispatchEscalationAlert,
  whatsAppSenderReady,
  emailFallbackReady,
} = require('./src/notifications/dispatch');
const {
  resolveEscalation,
  buildEscalationText,
  teammateLabel,
} = require('./src/conversation/escalation');

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

// Diagnostic middleware — log every inbound HTTP request (Localtunnel / SautiKit debug).
app.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] INCOMING REQUEST: ${req.method} ${req.url}`);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  next();
});

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

/**
 * Build the media WebSocket URL from the inbound request host so Localtunnel /
 * ngrok / production reverse proxies work without hard-coding PUBLIC_BASE_URL.
 */
function buildMediaStreamUrl(req) {
  const host = req.headers.host;
  if (!host) {
    throw new Error('Missing Host header — cannot build Stream WebSocket URL');
  }
  const forwarded = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const wsProto = forwarded === 'http' ? 'ws' : 'wss';
  return `${wsProto}://${host}/ws/media`;
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
  // Prefer the number the client actually dialed when present (outbound WebRTC tests).
  const toNumber =
    body.clientDialedNumber ||
    body.destinationNumber ||
    body.To ||
    body.to ||
    body.destination_number ||
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

function shouldSkipMediaStream(callSessionState, body = {}) {
  const state = String(callSessionState || '').toLowerCase();
  const streamEvent = String(body.streamEvent || '').toLowerCase();
  if (!state && !streamEvent) return false;

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

async function markCallTerminalFromWebhook({ callSid, status, durationSeconds, source }) {
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
      bodyKeys: Object.keys(req.body || {}),
    });
    console.log('[voice/incoming] RAW BODY:', JSON.stringify(req.body, null, 2));

    // SautiKit re-invokes the voice URL on StreamStarted / Completed / etc.
    // Returning another Stream document re-forks and errors — send empty XML.
    if (shouldSkipMediaStream(callSessionState, req.body)) {
      const termination = detectCallTermination(req.body, callSessionState);
      if (termination.terminal) {
        // Fire-and-forget so we still return TwiML immediately.
        markCallTerminalFromWebhook({
          callSid: extracted.callSid || callSid,
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

    try {
      await db.upsertCall({
        callSid,
        fromNumber: fromNumber || 'unknown',
        toNumber,
        provider: 'sautikit',
      });
    } catch (dbErr) {
      // Do not fail the webhook / Stream setup if DB is briefly unavailable.
      console.error('[voice/incoming] DB upsert failed (continuing with Stream):', dbErr?.message || dbErr);
    }

    const streamUrl = `${buildMediaStreamUrl(req)}?callSid=${encodeURIComponent(callSid)}`;
    // SautiKit requires connect="true" on Stream or the leg hangs up in ~1s.
    // Pass callSid on the WS URL so /ws/media can bind the session without
    // waiting for the first metadata frame.
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Stream url="${streamUrl}" name="ai-receptionist" track="inbound_track" connect="true" outputSamplingRate="16000" bidirectionalSamplingRate="16000" />
</Response>`;

    res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('[voice/incoming] Webhook handling failed:', err);
    res.sendStatus(500);
  }
}

app.post('/', sautikitWebhookGuard, handleVoiceIncoming);
app.post('/voice/incoming', sautikitWebhookGuard, handleVoiceIncoming);
app.post('/voice', sautikitWebhookGuard, handleVoiceIncoming);

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
    console.log('[VOICE EVENT PAYLOAD]', JSON.stringify(body, null, 2));

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
  console.log('[ws/media] upgrade headers:', JSON.stringify(req.headers, null, 2));

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
  let turnBusy = false;
  let utteranceParts = [];
  let utteranceTimer = null;
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
  const transcriptLog = [];
  let greetingStarted = false;
  let profileLoaded = false;
  let profileCallSid = null;
  /** Sticky call language: 'en' | 'sw' | 'sheng' | 'mixed' | 'unknown' */
  let callLanguage = 'unknown';
  let fillerUsedThisCall = false;
  /** @type {ReturnType<typeof createVoiceTurnTiming>|null} */
  let activeTurnTiming = null;
  /** Rolling interim hypothesis while agent is busy (for barge-in). */
  let interimBargeText = '';
  /** Optional per-tenant TTS lexicon overrides: [{ match, say }]. */
  let ttsLexiconOverrides = [];
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
      if (sessionCallSid) {
        callAgentTools.set(sessionCallSid, parseAgentTools(profile.agentTools));
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
        `[ws/media][${sidLabel()}] tenant prompt loaded business=${businessName || 'unknown'} agent=${agentName} open=${openStatus} afterHours=${afterHoursMode} bulletinClosed=${Boolean(closureNotice)} customPrompt=${Boolean(profile.llmSystemPrompt)} escalate=${tools.escalate} endCall=${tools.end_call} ttsLexicon=${ttsLexiconOverrides.length} sttTerms=${sttCtx?.terms?.length || 0} langs=en,sw,sheng(auto)`
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

  function releaseQueuedCallerSpeech() {
    if (utteranceParts.length) {
      scheduleUtteranceFlush();
      return;
    }
    kickPendingTurn();
  }

  async function speakText(text, opts = {}) {
    if (!tts || !text) return;
    // Starting intentional playback clears a prior barge latch.
    bargeInActive = false;
    speaking = true;
    speakStartedAt = Date.now();
    lastAgentText = String(text);
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
    try {
      await tts.speak(prepared.text, {
        language: prepared.language,
        callLanguage,
        alreadyPrepared: true,
      });
    } catch (err) {
      console.error(`[ws/media][${sidLabel()}] TTS speak failed:`, err?.message || err);
    } finally {
      if (activePlaybackGeneration === gen) {
        speaking = false;
        releaseQueuedCallerSpeech();
      }
    }
  }

  function cancelSpeech(reason) {
    clearFillerTimer();
    bargeInActive = true;
    playbackGeneration += 1;
    speaking = false;
    interimBargeText = '';
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
      activeTurnTiming.log({ outcome: 'barge_in' });
      activeTurnTiming = null;
    }
    releaseQueuedCallerSpeech();
  }

  function discardUnspokenAssistant(reply) {
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && last.content === reply) {
      messages.pop();
    }
  }

  let lastBargeSkipLogAt = 0;
  function maybeBargeIn(text, source) {
    const decision = evaluateBargeIn({
      text,
      speaking,
      turnBusy,
      speakStartedAt,
      lastAgentText,
      isBackchannel,
    });
    if (!decision.barge) {
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
      return false;
    }
    cancelSpeech(`${source}/${decision.reason}`);
    return true;
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

  async function runCallerTurn(userText) {
    const clean = String(userText || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (turnBusy) {
      // Merge continuation fragments into one pending utterance (don't drop context).
      pendingUtterance = pendingUtterance ? `${pendingUtterance} ${clean}` : clean;
      return;
    }

    // Skip pure noise, but keep yes/no and short names when the agent just asked.
    if (shouldSkipCallerTurn(clean, { lastAgentText })) {
      console.log(`[ws/media][${sidLabel()}] skip non-substantive turn: ${clean}`);
      return;
    }

    turnBusy = true;
    bargeInActive = false;
    const turnTiming = createVoiceTurnTiming(sidLabel());
    activeTurnTiming = turnTiming;

    const detected = detectCallerLanguage(clean);
    callLanguage = resolveCallLanguage(callLanguage, detected);
    console.log(
      `[ws/media][${sidLabel()}] caller turn lang=${callLanguage} detected=${detected}: ${clean}`
    );
    transcriptLog.push(`Caller: ${clean}`);
    messages.push({ role: 'user', content: clean });

    const turnSystemPrompt = `${systemPrompt}\n\n${languageDirective(callLanguage)}`;

    try {
      // VOICE_FILLER=auto (default): adaptive ack only if first spoken audio is slow.
      // ack → always schedule a tiny backchannel; off → silence; custom → fixed phrase.
      const fillerMode = (process.env.VOICE_FILLER || 'auto').toLowerCase();
      const useFiller =
        Boolean(tts) && fillerMode !== 'off' && !fillerUsedThisCall;
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
            speakText(fillerText).catch(() => {});
          }
        }, fillerDelayMs);
      }

      const streamOn =
        Boolean(process.env.GEMINI_API_KEY) &&
        Boolean(tts) &&
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
        // Drop filler PCM via generation bump only — do NOT tts.cancel() here,
        // or we kill the prefetched reply stream on the same Soniox socket.
        playbackGeneration += 1;
        speaking = false;
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
          speaking = true;
          speakStartedAt = Date.now();
          activePlaybackGeneration = ++playbackGeneration;
          streamPlaybackGen = activePlaybackGeneration;
        }

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
              ? 'Asante — mtu kutoka kwa biashara atakupigia simu hivi karibuni.'
              : 'Thanks — someone from the business will call you back shortly.',
          shouldEndCall: true,
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
          transcriptLog.push(`Agent: ${result.spokenText}`);
          turnTiming.markFirstSpokenChunk();
          await speakText(result.spokenText);
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
              releaseQueuedCallerSpeech();
            }
            turnTiming.log({ outcome: 'barge_in' });
            if (activeTurnTiming === turnTiming) activeTurnTiming = null;
            return;
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
              releaseQueuedCallerSpeech();
            }
            speakSession = null;
          }
          const reply = result?.spokenText || spokenChunks.join(' ') || AI_FALLBACK_LINE;
          transcriptLog.push(`Agent: ${reply}`);
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
          const reply = result?.spokenText || AI_FALLBACK_LINE;
          transcriptLog.push(`Agent: ${reply}`);
          turnTiming.markFirstSpokenChunk();
          await speakText(reply);
          turnOutcome = 'stream_fallback_full';
        } else {
          discardUnspokenAssistant(result?.spokenText || '');
          bargeInActive = false;
          turnTiming.log({ outcome: 'barge_in' });
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
        const reply = result?.spokenText || AI_FALLBACK_LINE;
        if (bargeInActive) {
          console.log(`[ws/media][${sidLabel()}] discarding Gemini reply after barge-in`);
          discardUnspokenAssistant(reply);
          bargeInActive = false;
          turnTiming.log({ outcome: 'barge_in' });
          if (activeTurnTiming === turnTiming) activeTurnTiming = null;
          return;
        }
        transcriptLog.push(`Agent: ${reply}`);
        turnTiming.markFirstSpokenChunk();
        await speakText(reply);
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
      }
      turnTiming.log({ outcome: turnOutcome });
      if (activeTurnTiming === turnTiming) activeTurnTiming = null;
    } catch (err) {
      console.error(`[ws/media][${sidLabel()}] turn failed:`, err?.message || err);
      turnTiming.log({ outcome: 'error' });
      if (activeTurnTiming === turnTiming) activeTurnTiming = null;
      if (!bargeInActive) {
        // Persist exactly what the caller hears so dashboard transcripts expose
        // failures instead of ending after the caller's last line.
        transcriptLog.push(`Agent: ${AI_FALLBACK_LINE}`);
        await speakText(AI_FALLBACK_LINE);
      }
    } finally {
      clearFillerTimer();
      if (activeTurnTiming === turnTiming) {
        turnTiming.log({ outcome: 'early_return' });
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
    if (turnBusy) {
      pendingUtterance = pendingUtterance ? `${pendingUtterance} ${text}` : text;
      return;
    }
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
    if (evt.type === 'transcript' && evt.text) {
      const text = String(evt.text).trim();
      if (!text) return;

      const isInterim = !evt.isFinal;

      // Instant barge-in on accumulated interim tokens while TTS/LLM is busy.
      if (isInterim) {
        if (speaking || turnBusy) {
          interimBargeText = mergeInterimHypothesis(interimBargeText, text);
          maybeBargeIn(interimBargeText, 'interim speech');
        } else {
          interimBargeText = '';
        }
        return;
      }

      // Finals replace the interim hypothesis.
      interimBargeText = '';
      maybeBargeIn(text, 'final speech');
      if (speaking && !bargeInActive) {
        const overlap = classifyFinalDuringAgentSpeech(text, lastAgentText);
        if (overlap === 'drop_echo') {
          console.log(
            `[ws/media][${sidLabel()}] drop echo final while TTS: ${text.slice(0, 80)}`
          );
          return;
        }
        // Real overlap that wasn't strong enough to barge — keep for after playback.
        utteranceParts.push(text);
        console.log(
          `[ws/media][${sidLabel()}] queue overlapping final while TTS: ${text.slice(0, 80)}`
        );
        return;
      }
      utteranceParts.push(text);
      scheduleUtteranceFlush();
      return;
    }

    if (evt.type === 'endpoint' || evt.type === 'finished') {
      interimBargeText = '';
      // Do not clear bargeInActive while a Gemini turn is still in flight — that flag
      // must survive until runCallerTurn discards the unspoken reply.
      if (!turnBusy) {
        bargeInActive = false;
      }
      if (speaking) {
        // Rare: endpoint while still speaking without a barge — wait for silence path.
        return;
      }
      flushUtterance();
    }
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
      tts = createSonioxTtsSession({
        callSid: sidLabel(),
        onAudio: (pcm) => {
          // Drop outbound audio after barge-in cancel / superseded playback generation.
          if (!speaking) return;
          if (activePlaybackGeneration !== playbackGeneration) return;
          if (activeTurnTiming) activeTurnTiming.markFirstPcm();
          if (ws.readyState === WebSocket.OPEN) sendPcmToMedia(ws, pcm);
        },
      });
      tts.ready.catch((err) => {
        console.error(`[ws/media] Soniox TTS failed to start:`, err?.message || err);
        tts = null;
      });
    } catch (err) {
      console.error(`[ws/media] Soniox TTS init error:`, err?.message || err);
      tts = null;
    }
  } else {
    console.warn('[ws/media] SONIOX_VOICE missing — skipping TTS for this call');
  }

  // Greet once media + TTS + tenant prompt are ready.
  // Greeting is generated fresh by Gemini (dynamic) with a fast time-of-day fallback.
  (async () => {
    if (greetingStarted) return;
    greetingStarted = true;
    try {
      await ensureTenantPrompt();
      if (tts) await tts.ready;

      // Instant local greeting by default (correct business name, no Gemini wait).
      // Set VOICE_GREETING_MODE=gemini only if you want an LLM-written opener.
      greetingLine = await generateDynamicGreeting({
        businessName,
        agentName,
        isOpen: openStatus === 'unknown' ? null : openStatus === 'open',
        afterHoursMode,
        closureNotice,
        callSid: sidLabel(),
        generateText: generateGeminiText,
        mode: process.env.VOICE_GREETING_MODE || 'instant',
      });
      console.log(
        `[ws/media][${sidLabel()}] greeting mode=${process.env.VOICE_GREETING_MODE || 'instant'} agent=${agentName} open=${openStatus} afterHours=${afterHoursMode} bulletinClosed=${Boolean(closureNotice)}: ${greetingLine}`
      );

      await speakText(greetingLine);
      transcriptLog.push(`Agent: ${greetingLine}`);
      messages.push({ role: 'assistant', content: greetingLine });
    } catch (err) {
      console.error(`[ws/media][${sidLabel()}] greeting failed:`, err?.message || err);
      try {
        const fallback = buildGreeting(businessName, {
          agentName,
          isOpen: openStatus === 'unknown' ? null : openStatus === 'open',
          afterHoursMode,
          closureNotice,
        });
        await speakText(fallback);
        messages.push({ role: 'assistant', content: fallback });
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
            console.log('[WS INCOMING PAYLOAD]', JSON.stringify(parsed, null, 2));

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
              asText.slice(0, 200),
              '| parseError=',
              parseErr?.message || parseErr
            );
          }
        } else {
          console.log('[ws/media] text frame:', asText.slice(0, 500));
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
    if (sessionCallSid && transcriptLog.length) {
      db.appendTranscript({ callSid: sessionCallSid, transcript: transcriptLog.join('\n') }).catch(
        (err) => {
          console.error(`[ws/media] transcript flush failed:`, err?.message || err);
        }
      );
    }
    // Fallback: if SautiKit never posts call.completed, still leave the row finished.
    if (sessionCallSid) {
      const durationSeconds = Math.max(0, Math.round(ms / 1000));
      markCallTerminalFromWebhook({
        callSid: sessionCallSid,
        status: 'complete',
        durationSeconds,
        source: 'ws/media',
      }).catch(() => {});
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
  if (!call) return;
  if (call.escalation_sent) return;
  if (escalationNotifyInProgress.has(callSid)) return;
  escalationNotifyInProgress.add(callSid);

  try {
    let ownerNumber = process.env.BUSINESS_OWNER_WHATSAPP_NUMBER || null;
    let ownerEmail = process.env.OWNER_ALERT_EMAIL || null;
    let businessName = process.env.BUSINESS_NAME || null;
    let teamDirectory = [];
    try {
      const profile = await db.getTenantProfile({ callSid });
      ownerNumber = profile.whatsappNumber || ownerNumber;
      ownerEmail = profile.alertEmail || ownerEmail;
      businessName = profile.businessName || businessName;
      teamDirectory = profile.teamDirectory || [];
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
      subject: `Escalation for ${teammateLabel(teammate)}${businessName ? ` — ${businessName}` : ''}`,
    });

    if (!sent.length) {
      console.warn(`[${callSid}] Escalation notify skipped (no working channel). Ready:`, {
        teammate: teammateLabel(teammate),
        name: lead.name,
        phone: lead.callerNumber,
        reason: lead.reason,
        whatsappSender: whatsAppSenderReady(),
        emailFallback: emailFallbackReady(),
        ownerNumber: ownerNumber || null,
        ownerEmail: ownerEmail || null,
        teammatePhone: teammate?.phone || null,
      });
      const refreshed = await db.getCall(callSid);
      if (refreshed?.name && refreshed?.reason) {
        await maybeSendWhatsAppNotification(callSid);
      }
      return;
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
  } catch (err) {
    console.error(`[${callSid}] Escalation notification failed:`, err?.message || err);
  } finally {
    escalationNotifyInProgress.delete(callSid);
  }
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
    try {
      const profile = await db.getTenantProfile({ callSid });
      ownerNumber = profile.whatsappNumber || ownerNumber;
      ownerEmail = profile.alertEmail || ownerEmail;
      businessName = profile.businessName || businessName;
    } catch (err) {
      console.warn(`[${callSid}] tenant lookup for notify failed:`, err?.message || err);
    }

    const lead = {
      businessName,
      name: call.name,
      reason: call.reason,
      callerNumber: call.from_number,
      recordingUrl: call.recording_url,
    };

    const result = await dispatchAlert({ to: ownerNumber, email: ownerEmail, lead });
    if (!result.channel) {
      console.warn(`[${callSid}] Owner notify skipped (${result.reason || 'unknown'}). Lead ready:`, {
        name: call.name,
        phone: call.from_number,
        reason: call.reason,
        recording: call.recording_url,
        ownerNumber: ownerNumber || null,
        ownerEmail: ownerEmail || null,
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

const CONTEXT_WINDOW = 16;

wss.on('connection', (ws) => {
  let callSid = null;
  let systemPrompt = buildSystemPrompt();
  let messages = [{ role: 'system', content: systemPrompt }];
  let transcriptLog = [];

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
          systemPrompt = buildSystemPrompt(profile);
          callAgentTools.set(callSid, parseAgentTools(profile.agentTools));
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

        const reply = await runGeminiTurn(messages, callSid, systemPrompt);
        if (reply.spokenText) {
          transcriptLog.push(`Agent: ${reply.spokenText}`);
          ws.send(JSON.stringify({ type: 'text', token: reply.spokenText, last: true }));
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
    }
  });
});

const AI_FALLBACK_LINE =
  "Sorry, we're having a technical issue on our end — the business will call you back shortly. Thanks for your patience.";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGeminiError(err) {
  const status = Number(err?.status || err?.code || 0);
  if (status === 429 || status === 503 || status === 500) return true;
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('503') || msg.includes('429') || msg.includes('unavailable') || msg.includes('overloaded');
}

function extractGeminiText(response) {
  if (typeof response?.text === 'string') return response.text;
  if (Array.isArray(response?.candidates?.[0]?.content?.parts)) {
    return response.candidates[0].content.parts
      .filter((part) => part && !part.thought && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
  }
  return '';
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

function buildGeminiContents(messages) {
  const recentMessages = messages.slice(-CONTEXT_WINDOW);
  return recentMessages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
}

function geminiVoiceConfig(systemPrompt) {
  return {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    // Slightly lower temp + shorter cap → faster, more consistent phone lines.
    temperature: Number(process.env.GEMINI_VOICE_TEMPERATURE || 0.35),
    maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 120),
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
  if (!tools.escalate) parsed.escalate = null;
  const shouldEndCall = Boolean(parsed.shouldEndCall && tools.end_call);

  if (parsed.serviceRequest) {
    try {
      const created = await db.createServiceRequest({
        callSid,
        type: parsed.serviceRequest.type,
        name: parsed.serviceRequest.name || parsed.name,
        phone: parsed.serviceRequest.phone,
        item: parsed.serviceRequest.item,
        quantity: parsed.serviceRequest.quantity,
        whenText: parsed.serviceRequest.whenText,
        notes: parsed.serviceRequest.notes || parsed.reason,
      });
      if (created) {
        console.log(
          `[${callSid}] service_request created id=${created.id} type=${created.request_type}`
        );
      }
    } catch (err) {
      console.error(
        `[${callSid}] createServiceRequest error:`,
        err?.message || err
      );
    }
  }

  if (parsed.name || parsed.reason) {
    const saved = await db.saveCallerInfo({
      callSid,
      name: parsed.name || undefined,
      reason: parsed.reason || undefined,
    });
    if (saved?.name && saved?.reason && !parsed.escalate) {
      maybeSendWhatsAppNotification(callSid);
    }
  }

  if (parsed.escalate) {
    maybeSendEscalationNotification(callSid, parsed.escalate).catch((err) => {
      console.error(`[${callSid}] escalate notify error:`, err?.message || err);
    });
  }

  return shouldEndCall;
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

  try {
    console.log(
      `[${callSid}] Calling Gemini stream (model: ${model}, messages: ${messages.length})`
    );
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
      const delta = extractGeminiText(chunk);
      if (!delta) continue;
      fullText += delta;
      const pieces = buffer.push(delta);
      for (const piece of pieces) {
        if (shouldAbort?.()) break;
        if (typeof onSpokenChunk === 'function') {
          await onSpokenChunk(piece);
        }
      }
    }
    console.log(
      `[${callSid}] Gemini stream done chars=${fullText.length} spokenEmitted=${buffer.getSpokenEmitted().length}`
    );
  } catch (err) {
    streamFailed = true;
    console.error(
      `[${callSid}] Gemini stream failed, falling back to generateContent:`,
      err?.message || err
    );
  }

  if (streamFailed && !fullText) {
    return runGeminiTurn(messages, callSid, systemPrompt);
  }

  if (!shouldAbort?.()) {
    for (const piece of buffer.finish()) {
      if (typeof onSpokenChunk === 'function') {
        await onSpokenChunk(piece);
      }
    }
  } else {
    // Finalize buffer state without speaking remainder.
    buffer.finish();
  }

  const parsed = parseGeminiResponse(fullText || buffer.getRaw());
  const spokenText =
    buffer.getSpokenEmitted() || parsed.spokenText || AI_FALLBACK_LINE;
  const shouldEndCall = await applyGeminiTools(callSid, parsed);

  messages.push({ role: 'assistant', content: spokenText });
  return { spokenText, shouldEndCall, streamed: !streamFailed };
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

      response = await getGeminiClient().models.generateContent({
        model,
        contents,
        config: geminiVoiceConfig(systemPrompt),
      });
      console.log(`[${callSid}] Gemini response received`);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const retryable = isRetryableGeminiError(err);
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
    return { spokenText: AI_FALLBACK_LINE, shouldEndCall: false };
  }

  const outputText = extractGeminiText(response);
  const parsed = parseGeminiResponse(outputText);
  const spokenText = parsed.spokenText || AI_FALLBACK_LINE;
  const shouldEndCall = await applyGeminiTools(callSid, parsed);

  messages.push({ role: 'assistant', content: spokenText });

  return { spokenText, shouldEndCall };
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
    console.log(
      `✓ SONIOX_API_KEY present (STT on /ws/media)${process.env.SONIOX_VOICE ? ` voice=${process.env.SONIOX_VOICE}` : ''}`
    );
    if (isSonioxTtsConfigured()) {
      console.log(`✓ SONIOX_VOICE present (TTS replies enabled)`);
    } else {
      console.log(`ℹ SONIOX_VOICE not set — STT only, no spoken replies`);
    }
  } else {
    console.log(`ℹ SONIOX_API_KEY not set — PCM will be logged only`);
  }
  if (whatsAppSenderReady()) {
    console.log(`✓ WhatsApp notify ready (preferred for leads + escalation)`);
  } else if (process.env.SAUTIKIT_API_KEY) {
    console.log(`ℹ SAUTIKIT_API_KEY present — set SAUTIKIT_WHATSAPP_NUMBER_ID (or CONNECTION_ID) to enable WhatsApp alerts`);
  } else {
    console.log(`ℹ WhatsApp notify not configured — will use email fallback if set`);
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
