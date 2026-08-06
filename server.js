// server.js
// Phase 2: SautiKit voice webhook + media WebSocket stub.
// Persistence: Supabase (calls, transcripts, call-recordings Storage).
// Twilio has been removed from the telephony path.

require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const { GoogleGenAI } = require('@google/genai');

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

const BUSINESS_OWNER_WHATSAPP_NUMBER = process.env.BUSINESS_OWNER_WHATSAPP_NUMBER;

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
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

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

/** Normalize SautiKit (Twilio-compatible) voice webhook fields. */
function extractInboundCallFields(body = {}) {
  const callSid =
    body.CallSid ||
    body.callSid ||
    body.call_sid ||
    body.call_id ||
    body.CallId ||
    null;
  const fromNumber =
    body.From ||
    body.from ||
    body.callerNumber ||
    body.caller_number ||
    null;
  const toNumber =
    body.To ||
    body.to ||
    body.destinationNumber ||
    body.destination_number ||
    null;
  const callSessionState = String(
    body.callSessionState || body.CallSessionState || ''
  );
  return { callSid, fromNumber, toNumber, callSessionState };
}

function shouldSkipMediaStream(callSessionState) {
  const state = callSessionState.toLowerCase();
  if (!state) return false;
  return (
    state.includes('streamstopped') ||
    state.includes('streamerror') ||
    state.includes('completed') ||
    state.includes('hangup') ||
    state.includes('failed')
  );
}

// ---------------------------------------------------------------------------
// 1. Inbound voice webhook — SautiKit POSTs here (voice_callback_url).
//    Respond with TwiML/XML <Connect><Stream/></Connect> (JSON Stream is still
//    on SautiKit's roadmap). WebSocket URL is derived from Host (Localtunnel).
// ---------------------------------------------------------------------------
app.post('/voice/incoming', async (req, res) => {
  try {
    const { callSid, fromNumber, toNumber, callSessionState } = extractInboundCallFields(req.body);

    console.log('[voice/incoming]', {
      callSid,
      fromNumber,
      toNumber,
      callSessionState: callSessionState || '(initial)',
      host: req.headers.host,
    });

    // SautiKit re-invokes the voice URL on StreamStopped / Completed / etc.
    // Returning another Stream document re-forks and errors — send empty XML.
    if (shouldSkipMediaStream(callSessionState)) {
      return res
        .type('text/xml')
        .send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }

    if (callSid) {
      await db.upsertCall({
        callSid,
        fromNumber,
        toNumber,
        provider: 'sautikit',
      });
    } else {
      console.warn('[voice/incoming] No call_sid/CallSid in payload; skipping DB upsert');
    }

    const streamUrl = buildMediaStreamUrl(req);
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${streamUrl}" />
    </Connect>
</Response>`;

    res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('[voice/incoming] Webhook handling failed:', err);
    res.sendStatus(500);
  }
});

// ---------------------------------------------------------------------------
// 2. Recording attach helper (provider-agnostic). Used when a recording URL
//    is available from SautiKit events (Phase 2+) or manual hooks.
// ---------------------------------------------------------------------------
app.post('/voice/recording-status', async (req, res) => {
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
// 3. Media + ConversationRelay WebSockets
//    /ws/media  — SautiKit bidirectional media stream (Localtunnel test path)
//    /ws/relay  — legacy Twilio ConversationRelay text relay
// ---------------------------------------------------------------------------
const server = http.createServer(app);

const mediaWss = new WebSocketServer({
  server,
  path: '/ws/media',
  // SautiKit forks audio with the audio.drachtio.org subprotocol.
  handleProtocols: (protocols) => {
    const list = Array.from(protocols);
    if (list.includes('audio.drachtio.org')) return 'audio.drachtio.org';
    return list[0] || false;
  },
});

mediaWss.on('connection', (ws, req) => {
  console.log(`[ws/media] connected from ${req.socket.remoteAddress} proto=${ws.protocol || '(none)'}`);

  ws.on('message', (data, isBinary) => {
    if (!isBinary && typeof data === 'string') {
      console.log('[ws/media] text frame:', data.slice(0, 500));
      return;
    }
    if (!isBinary && Buffer.isBuffer(data)) {
      const asText = data.toString('utf8');
      // First frame from SautiKit is often JSON openMetadata as text.
      if (asText.startsWith('{') || asText.startsWith('[')) {
        console.log('[ws/media] text/json frame:', asText.slice(0, 500));
        return;
      }
    }
    const bytes = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
    console.log(`[ws/media] binary audio frame (${bytes} bytes)`);
  });

  ws.on('close', (code, reason) => {
    console.log(`[ws/media] closed code=${code} reason=${reason?.toString?.() || ''}`);
  });

  ws.on('error', (err) => {
    console.error('[ws/media] error:', err?.message || err);
  });
});

const wss = new WebSocketServer({ server, path: '/ws/relay' });

// ---------------------------------------------------------------------------
// WhatsApp notification to the business owner. Fires from two different
// places (save_caller_info tool use, and the recording-status webhook)
// because either one might complete last — this function is the single
// gate that only actually sends once both name+reason AND the recording
// are present, and only once ever per call.
// ---------------------------------------------------------------------------
const whatsappSendInProgress = new Set();

async function maybeSendWhatsAppNotification(callSid) {
  // Twilio WhatsApp removed from Phase 2. SautiKit WhatsApp lands in a later cutover.
  if (!BUSINESS_OWNER_WHATSAPP_NUMBER) {
    console.warn(`[${callSid}] WhatsApp notification skipped: BUSINESS_OWNER_WHATSAPP_NUMBER not configured.`);
    return;
  }

  const call = await db.getCall(callSid);
  if (!call) return;

  const hasCallerInfo = Boolean(call.name && call.reason);
  const hasRecording = Boolean(call.recording_url);
  if (!hasCallerInfo || !hasRecording) return;

  if (whatsappSendInProgress.has(callSid)) return;
  if (call.whatsapp_sent) return;
  whatsappSendInProgress.add(callSid);

  try {
    console.warn(
      `[${callSid}] WhatsApp provider not wired yet (Twilio removed). Lead ready:`,
      {
        name: call.name,
        phone: call.from_number,
        reason: call.reason,
        recording: call.recording_url,
      }
    );
    // Mark sent only when a real provider is configured in a later phase.
  } catch (err) {
    console.error(`[${callSid}] WhatsApp notification failed:`, err);
  } finally {
    whatsappSendInProgress.delete(callSid);
  }
}

const SYSTEM_PROMPT = `You are a friendly phone receptionist answering a
missed call on behalf of a small business in Kenya. Your only job this call:
1. Get the caller's name.
2. Get a short reason for their call.
3. Briefly confirm both back to them in one sentence.
4. Tell them the business will get back to them soon, then say goodbye.

Speak in warm, natural, conversational English — plain and friendly, the
way a real receptionist would talk on the phone, not stiff or robotic.

Keep every reply to 1-2 short sentences — this is a live phone call, not
chat. When you have both the caller's name and reason, respond with one
natural confirmation sentence and also append a structured marker block
using this exact format:

###TOOL###
{"save_caller_info":{"name":"<name>","reason":"<reason>"}}
###ENDTOOL###

If the call should end after your goodbye, also append the marker:
###ENDCALL###

Do not include any other JSON or markup in your spoken response.`;

const CONTEXT_WINDOW = 6;

wss.on('connection', (ws) => {
  let callSid = null;
  let messages = [{ role: 'system', content: SYSTEM_PROMPT }];
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

        const reply = await runGeminiTurn(messages, callSid);
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

// Runs one turn of the conversation through Gemini, preserving the chat
// history and executing the caller-info / end-call signals via structured
// markers returned in the model output.
async function runGeminiTurn(messages, callSid) {
  let response;
  try {
    console.log(`[${callSid}] Calling Gemini API (model: gemini-3.6-flash, messages: ${messages.length})`);

    const recentMessages = messages.slice(-CONTEXT_WINDOW);
    const contents = recentMessages
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      }));

    response = await getGeminiClient().models.generateContent({
      model: 'gemini-3.6-flash',
      contents,
      config: {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        temperature: 0.7,
        maxOutputTokens: 300,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    });
    console.log(`[${callSid}] Gemini response received`);
  } catch (err) {
    console.error(
      `[${callSid}] Gemini API call failed:`,
      `status=${err?.status || 'N/A'}`,
      `message=${err?.message || err}`
    );
    return { spokenText: AI_FALLBACK_LINE, shouldEndCall: true };
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
  if (process.env.GEMINI_API_KEY) {
    console.log(`✓ GEMINI_API_KEY present (lazy-loaded on LLM use)`);
  } else {
    console.log(`ℹ GEMINI_API_KEY not set (optional for Phase 2 webhook tests)`);
  }
});
