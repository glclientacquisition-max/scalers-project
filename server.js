// server.js
// Phase 2: SautiKit voice webhook + media WebSocket stub.
// Persistence: Supabase (calls, transcripts, call-recordings Storage).
// Twilio has been removed from the telephony path.

require('dotenv').config();
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const { GoogleGenAI } = require('@google/genai');
const { createSonioxSttSession, isSonioxConfigured } = require('./src/speech/sonioxStt');
const {
  createSonioxTtsSession,
  isSonioxTtsConfigured,
} = require('./src/speech/sonioxTts');
const { buildSystemPrompt, buildGreeting } = require('./src/prompts');
const { sautikitWebhookGuard } = require('./src/sautikit/webhook');
const {
  isWhatsAppConfigured,
  buildLeadText,
  sendOwnerWhatsApp,
} = require('./src/notifications/whatsapp');

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

// ---------------------------------------------------------------------------
// 1. Inbound voice webhook — SautiKit POSTs here (voice_callback_url).
//    Mounted on BOTH `/` and `/voice/incoming` because some number routing
//    configs point at the tunnel root (logs showed POST / → 404 before).
// ---------------------------------------------------------------------------
async function handleVoiceIncoming(req, res) {
  try {
    const extracted = extractInboundCallFields(req.body);
    const fromNumber = extracted.fromNumber;
    const toNumber = extracted.toNumber;
    const callSessionState = extracted.callSessionState;
    // Always have a durable id for Supabase even if SautiKit omits CallSid.
    const callSid = extracted.callSid || `sautikit_call_${Date.now()}`;

    console.log('[voice/incoming]', {
      path: req.path || req.url,
      callSid,
      callSidSource: extracted.callSid ? 'payload' : 'fallback',
      fromNumber,
      toNumber,
      callSessionState: callSessionState || '(initial)',
      host: req.headers.host,
      bodyKeys: Object.keys(req.body || {}),
    });
    console.log('[voice/incoming] RAW BODY:', JSON.stringify(req.body, null, 2));

    // SautiKit re-invokes the voice URL on StreamStarted / Completed / etc.
    // Returning another Stream document re-forks and errors — send empty XML.
    if (shouldSkipMediaStream(callSessionState, req.body)) {
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
  try {
    const kind =
      req.headers['x-sautikit-event-kind'] ||
      req.body?.kind ||
      req.body?.event_type ||
      req.body?.type ||
      '';
    const body = req.body || {};
    const callSid =
      body.call_sid ||
      body.callSid ||
      body.sessionId ||
      body.data?.call_sid ||
      body.data?.sessionId ||
      body.payload?.call_sid ||
      null;

    console.log('[voice/events]', {
      kind: String(kind),
      callSid,
      eventId: req.headers['x-sautikit-event-id'] || null,
      bodyKeys: Object.keys(body),
    });

    const kindStr = String(kind).toLowerCase();

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
        await db.attachRecording({
          callSid,
          recordingSid,
          sourceUrl: recordingUrl,
          recordingUrl,
        });
        await maybeSendWhatsAppNotification(callSid);
      }
    }

    if (kindStr.includes('completed') && callSid) {
      const duration =
        body.duration_seconds ??
        body.durationInSeconds ??
        body.data?.duration_seconds ??
        null;
      if (duration != null) {
        try {
          const call = await db.getCall(callSid);
          if (call?._raw?.id) {
            // Duration lives on calls; best-effort via summary if no direct updater.
            console.log(`[voice/events] call ${callSid} completed duration=${duration}`);
          }
        } catch (err) {
          console.warn('[voice/events] duration log failed:', err?.message || err);
        }
      }
      await maybeSendWhatsAppNotification(callSid);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[voice/events] Webhook handling failed:', err);
    res.sendStatus(500);
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
  let bargedIn = false;
  let pendingUtterance = null;
  let systemPrompt = buildSystemPrompt();
  let greetingLine = buildGreeting();
  let messages = [{ role: 'system', content: systemPrompt }];
  const transcriptLog = [];
  let greetingStarted = false;
  let profileLoaded = false;

  const sidLabel = () => sessionCallSid || `media_${connectedAt}`;

  async function ensureTenantPrompt() {
    if (profileLoaded) return;
    profileLoaded = true;
    try {
      const profile = await db.getTenantProfile({ callSid: sessionCallSid });
      systemPrompt = buildSystemPrompt(profile);
      greetingLine = buildGreeting(profile.businessName);
      messages = [{ role: 'system', content: systemPrompt }];
      console.log(
        `[ws/media][${sidLabel()}] tenant prompt loaded business=${profile.businessName || 'unknown'} customPrompt=${Boolean(profile.llmSystemPrompt)}`
      );
    } catch (err) {
      console.warn(
        `[ws/media][${sidLabel()}] tenant prompt load failed, using defaults:`,
        err?.message || err
      );
    }
  }

  function clearFillerTimer() {
    if (fillerTimer) {
      clearTimeout(fillerTimer);
      fillerTimer = null;
    }
  }

  async function speakText(text) {
    if (!tts || !text) return;
    speaking = true;
    bargedIn = false;
    speakStartedAt = Date.now();
    lastAgentText = String(text);
    try {
      await tts.speak(text);
    } catch (err) {
      console.error(`[ws/media][${sidLabel()}] TTS speak failed:`, err?.message || err);
    } finally {
      speaking = false;
    }
  }

  function cancelSpeech(reason) {
    clearFillerTimer();
    if (!tts) return;
    bargedIn = true;
    console.log(`[ws/media][${sidLabel()}] barge-in cancel (${reason})`);
    try {
      tts.cancel();
    } catch {
      /* ignore */
    }
    speaking = false;
  }

  function looksLikeEcho(text) {
    const a = String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const b = String(lastAgentText || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!a || !b) return false;
    if (b.includes(a) || a.includes(b.slice(0, Math.min(40, b.length)))) return true;
    return false;
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
      pendingUtterance = clean;
      return;
    }
    turnBusy = true;
    console.log(`[ws/media][${sidLabel()}] caller turn: ${clean}`);
    transcriptLog.push(`Caller: ${clean}`);
    messages.push({ role: 'user', content: clean });

    try {
      const geminiPromise = process.env.GEMINI_API_KEY
        ? runGeminiTurn(messages, sidLabel(), systemPrompt)
        : Promise.resolve({
            spokenText: "Thanks — someone from the business will call you back shortly.",
            shouldEndCall: true,
          });

      // Delayed filler: only if Gemini is still thinking after FILLER_DELAY_MS.
      const useFiller = Boolean(tts) && process.env.VOICE_FILLER !== 'off';
      const fillerDelayMs = Number(process.env.VOICE_FILLER_DELAY_MS || 450);
      const fillerText = process.env.VOICE_FILLER || 'Sawa, nakucheckia…';
      let fillerPromise = Promise.resolve();
      let fillerStarted = false;

      if (useFiller) {
        fillerPromise = new Promise((resolve) => {
          fillerTimer = setTimeout(() => {
            fillerTimer = null;
            // Reply may already be ready — skip filler.
            if (turnBusy && !speaking) {
              fillerStarted = true;
              speakText(fillerText).then(resolve, resolve);
            } else {
              resolve();
            }
          }, fillerDelayMs);
        });
      }

      const result = await geminiPromise;
      clearFillerTimer();
      if (fillerStarted && tts) {
        try {
          tts.cancel();
        } catch {
          /* ignore */
        }
        await fillerPromise.catch(() => {});
      }

      const reply = result?.spokenText || AI_FALLBACK_LINE;
      transcriptLog.push(`Agent: ${reply}`);
      await speakText(reply);

      if (result?.shouldEndCall && !bargedIn) {
        console.log(`[ws/media][${sidLabel()}] end-call marker — closing media shortly`);
        setTimeout(() => {
          try {
            ws.close(1000, 'end_call');
          } catch {
            /* ignore */
          }
        }, 800);
      }
    } catch (err) {
      console.error(`[ws/media][${sidLabel()}] turn failed:`, err?.message || err);
      await speakText(AI_FALLBACK_LINE);
    } finally {
      clearFillerTimer();
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
      pendingUtterance = text;
      return;
    }
    runCallerTurn(text).catch((err) => {
      console.error(`[ws/media][${sidLabel()}] runCallerTurn error:`, err?.message || err);
    });
  }

  function scheduleUtteranceFlush() {
    if (utteranceTimer) clearTimeout(utteranceTimer);
    // Fallback if Soniox endpoint marker is delayed/missing.
    utteranceTimer = setTimeout(() => flushUtterance(), 900);
  }

  function onSttEvent(evt) {
    if (evt.type === 'transcript' && evt.text) {
      const text = String(evt.text).trim();
      if (!text) return;

      // Barge-in while agent audio is playing (including during an in-flight turn).
      if (speaking) {
        const spokenForMs = Date.now() - speakStartedAt;
        if (spokenForMs >= 400 && text.length >= 10 && !looksLikeEcho(text)) {
          cancelSpeech('caller speech');
          if (evt.isFinal) {
            utteranceParts.push(text);
            scheduleUtteranceFlush();
          }
        }
        return;
      }

      // Ignore STT while Gemini is thinking / filler pending (no agent audio yet).
      if (turnBusy) return;

      if (evt.isFinal) {
        utteranceParts.push(text);
        scheduleUtteranceFlush();
      }
      return;
    }
    if (evt.type === 'endpoint') {
      if (speaking) return;
      if (turnBusy) return;
      flushUtterance();
    }
  }

  // Warm tenant prompt early when callSid is already on the WS URL.
  if (sessionCallSid) {
    ensureTenantPrompt().catch(() => {});
  }

  if (isSonioxConfigured()) {
    try {
      stt = createSonioxSttSession({
        callSid: sidLabel(),
        onEvent: onSttEvent,
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
          // Drop outbound audio after barge-in cancel.
          if (!speaking) return;
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
  (async () => {
    if (greetingStarted) return;
    greetingStarted = true;
    try {
      await ensureTenantPrompt();
      if (tts) await tts.ready;
      await speakText(greetingLine);
      transcriptLog.push(`Agent: ${greetingLine}`);
      messages.push({ role: 'assistant', content: greetingLine });
    } catch (err) {
      console.error(`[ws/media][${sidLabel()}] greeting failed:`, err?.message || err);
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
// WhatsApp notification to the business owner. Fires from two different
// places (save_caller_info tool use, and the recording-status webhook)
// because either one might complete last — this function is the single
// gate that only actually sends once both name+reason AND the recording
// are present, and only once ever per call.
// ---------------------------------------------------------------------------
const whatsappSendInProgress = new Set();

async function maybeSendWhatsAppNotification(callSid) {
  const call = await db.getCall(callSid);
  if (!call) return;

  const hasCallerInfo = Boolean(call.name && call.reason);
  // Prefer sending once we have name+reason; recording is a nice-to-have.
  if (!hasCallerInfo) return;

  if (whatsappSendInProgress.has(callSid)) return;
  if (call.whatsapp_sent) return;
  whatsappSendInProgress.add(callSid);

  try {
    let ownerNumber =
      process.env.BUSINESS_OWNER_WHATSAPP_NUMBER || null;
    let businessName = process.env.BUSINESS_NAME || null;
    try {
      const profile = await db.getTenantProfile({ callSid });
      ownerNumber = profile.whatsappNumber || ownerNumber;
      businessName = profile.businessName || businessName;
    } catch (err) {
      console.warn(`[${callSid}] tenant lookup for WhatsApp failed:`, err?.message || err);
    }

    if (!ownerNumber) {
      console.warn(
        `[${callSid}] WhatsApp notification skipped: no owner number (tenants.whatsapp_notification_number or BUSINESS_OWNER_WHATSAPP_NUMBER)`
      );
      return;
    }

    if (!isWhatsAppConfigured()) {
      console.warn(
        `[${callSid}] WhatsApp provider not configured (need SAUTIKIT_API_KEY + SAUTIKIT_WHATSAPP_NUMBER_ID). Lead ready:`,
        {
          name: call.name,
          phone: call.from_number,
          reason: call.reason,
          recording: call.recording_url,
          ownerNumber,
        }
      );
      return;
    }

    const lead = {
      businessName,
      name: call.name,
      reason: call.reason,
      callerNumber: call.from_number,
      recordingUrl: call.recording_url,
    };
    const body = buildLeadText(lead);
    const result = await sendOwnerWhatsApp({ to: ownerNumber, body, lead });
    await db.markWhatsappSent(callSid);
    console.log(`[${callSid}] WhatsApp lead notify accepted:`, result);
  } catch (err) {
    console.error(`[${callSid}] WhatsApp notification failed:`, err?.message || err);
  } finally {
    whatsappSendInProgress.delete(callSid);
  }
}

const CONTEXT_WINDOW = 10;

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

// Runs one turn of the conversation through Gemini, preserving the chat
// history and executing the caller-info / end-call signals via structured
// markers returned in the model output.
async function runGeminiTurn(messages, callSid, systemPrompt = buildSystemPrompt()) {
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const maxAttempts = Math.max(1, Number(process.env.GEMINI_MAX_RETRIES || 3));
  let response;
  let lastErr = null;

  const recentMessages = messages.slice(-CONTEXT_WINDOW);
  const contents = recentMessages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.log(
        `[${callSid}] Calling Gemini API (model: ${model}, messages: ${messages.length}, attempt: ${attempt}/${maxAttempts})`
      );

      response = await getGeminiClient().models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: { parts: [{ text: systemPrompt }] },
          temperature: 0.7,
          maxOutputTokens: 300,
          // gemini-3.6-flash rejects thinkingBudget:0; MINIMAL keeps latency low.
          thinkingConfig: {
            thinkingLevel: 'MINIMAL',
          },
        },
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

  let outputText = '';
  if (typeof response?.text === 'string') {
    outputText = response.text;
  } else if (Array.isArray(response?.candidates?.[0]?.content?.parts)) {
    outputText = response.candidates[0].content.parts
      .filter((part) => part && !part.thought && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
  }

  const parsed = parseGeminiResponse(outputText);
  const spokenText = parsed.spokenText || AI_FALLBACK_LINE;
  const shouldEndCall = parsed.shouldEndCall;

  if (parsed.name && parsed.reason) {
    await db.saveCallerInfo({ callSid, name: parsed.name, reason: parsed.reason });
    maybeSendWhatsAppNotification(callSid);
  }

  messages.push({ role: 'assistant', content: spokenText });

  return { spokenText, shouldEndCall };
}

function parseGeminiResponse(responseText) {
  const output = { spokenText: responseText, shouldEndCall: false };
  const toolMatch = /###TOOL###([\s\S]*?)###ENDTOOL###/i.exec(responseText);
  const endCallMatch = /###ENDCALL###/i.exec(responseText);

  if (toolMatch) {
    const toolJson = toolMatch[1].trim();
    try {
      const parsed = JSON.parse(toolJson);
      if (parsed.save_caller_info) {
        output.name = parsed.save_caller_info.name;
        output.reason = parsed.save_caller_info.reason;
      }
    } catch (err) {
      console.warn('[parseGeminiResponse] Failed to parse tool JSON:', err?.message || err);
    }
    output.spokenText = responseText.replace(toolMatch[0], '').trim();
  }

  if (endCallMatch) {
    output.shouldEndCall = true;
    output.spokenText = output.spokenText.replace(endCallMatch[0], '').trim();
  }

  return output;
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
  if (process.env.PUBLIC_BASE_URL) {
    console.log(`🌐 PUBLIC_BASE_URL: ${process.env.PUBLIC_BASE_URL}`);
  } else {
    console.log(`🌐 PUBLIC_BASE_URL not set — Stream URLs use request Host header`);
  }
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
  if (process.env.SAUTIKIT_API_KEY) {
    console.log(
      `✓ SAUTIKIT_API_KEY present${isWhatsAppConfigured() ? ' (WhatsApp notify ready)' : ' (WhatsApp number id not set yet)'}`
    );
  } else {
    console.log(`ℹ SAUTIKIT_API_KEY not set — WhatsApp lead notify disabled`);
  }
  if (String(process.env.SAUTIKIT_VALIDATE_WEBHOOKS || '').toLowerCase() === 'true') {
    console.log(`✓ SautiKit webhook signature validation ON`);
  }
});
