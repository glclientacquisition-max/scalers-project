// server.js
// Phase 1 telephony layer: receives forwarded missed calls, hands the call
// to Twilio ConversationRelay, and runs the conversation loop through Gemini.
// Persistence: Supabase (calls, transcripts, call-recordings Storage).

require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const { GoogleGenAI } = require('@google/genai');
const twilio = require('twilio');

const PORT = process.env.PORT || 3000;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

const requiredEnvironmentVariables = [
  'PUBLIC_BASE_URL',
  'GEMINI_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];
const missingEnvironmentVariables = requiredEnvironmentVariables.filter((name) => !process.env[name]);
if (missingEnvironmentVariables.length > 0) {
  console.error(`ERROR: Missing required environment variables: ${missingEnvironmentVariables.join(', ')}`);
  process.exit(1);
}

const db = require('./src/db');

// Twilio-approved WhatsApp sender number (E.164, no "whatsapp:" prefix —
// that prefix gets added at call time). For testing, this can be Twilio's
// WhatsApp sandbox number; for production it must be a number provisioned
// for WhatsApp Business through Twilio.
const TWILIO_WHATSAPP_FROM = process.env.TWILIO_WHATSAPP_FROM;
// Business owner's WhatsApp-reachable number (E.164, no prefix).
const BUSINESS_OWNER_WHATSAPP_NUMBER = process.env.BUSINESS_OWNER_WHATSAPP_NUMBER;

const geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

function twilioBasicAuthHeader() {
  const token = Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
  ).toString('base64');
  return `Basic ${token}`;
}

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded
app.use(express.json());

function validateTwilioWebhook(req, res, next) {
  if (process.env.TWILIO_VALIDATE_WEBHOOKS === 'false') {
    return next();
  }

  const signature = req.header('X-Twilio-Signature');
  const webhookUrl = `${PUBLIC_BASE_URL}${req.originalUrl}`;
  const isValid = signature && twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    webhookUrl,
    req.body
  );

  if (!isValid) {
    console.warn(`Rejected invalid Twilio webhook signature for ${req.originalUrl}`);
    return res.sendStatus(403);
  }

  next();
}

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

// ---------------------------------------------------------------------------
// 1. Inbound call webhook — Twilio hits this the moment the forwarded call
//    reaches your number. Returns TwiML that:
//      (a) starts a background recording of the whole call
//      (b) connects the call to ConversationRelay, which streams transcribed
//          speech to our WebSocket and plays back whatever text we send.
// ---------------------------------------------------------------------------
app.post('/voice/incoming', validateTwilioWebhook, async (req, res) => {
  try {
    const { CallSid, From, To } = req.body;

    await db.upsertCall({ callSid: CallSid, fromNumber: From, toNumber: To, provider: 'twilio' });

    const wsUrl = `${PUBLIC_BASE_URL.replace(/^https/, 'wss')}/ws/relay`;
    const recordingCallback = `${PUBLIC_BASE_URL}/voice/recording-status`;

    const twiml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Start>
          <Recording recordingStatusCallback="${recordingCallback}" recordingStatusCallbackEvent="completed" />
        </Start>
        <Connect>
          <ConversationRelay
            url="${wsUrl}"
            welcomeGreeting="Hi! Sorry we missed your call. Can you tell me your name and the reason you're calling?"
            ttsProvider="Google"
            voice="en-US-Chirp3-HD-Aoede"
            language="en-US"
          />
        </Connect>
      </Response>
    `.trim();

    res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('[voice/incoming] Webhook handling failed:', err);
    res.sendStatus(500);
  }
});

// ---------------------------------------------------------------------------
// 2. Recording status callback — fires once Twilio finishes processing the
//    recording. Download → upload to Supabase Storage → attach URL to call.
// ---------------------------------------------------------------------------
app.post('/voice/recording-status', validateTwilioWebhook, async (req, res) => {
  try {
    const { CallSid, RecordingUrl, RecordingSid, RecordingStatus } = req.body;

    if (RecordingStatus === 'completed') {
      const twilioRecordingUrl = `${RecordingUrl}.mp3`;
      await db.attachRecording({
        callSid: CallSid,
        recordingSid: RecordingSid,
        sourceUrl: twilioRecordingUrl,
        recordingUrl: twilioRecordingUrl,
        authHeader: twilioBasicAuthHeader(),
      });
      // Recording may finish before or after the caller-info save happens —
      // check conditions again here in case this is the piece that completes them.
      await maybeSendWhatsAppNotification(CallSid);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('[voice/recording-status] Webhook handling failed:', err);
    res.sendStatus(500);
  }
});

// ---------------------------------------------------------------------------
// 3. ConversationRelay WebSocket — one connection per active call.
//    Message shapes (from Twilio docs):
//      inbound:  { type: "setup", callSid, from, to }
//                { type: "prompt", voicePrompt: "<transcribed caller speech>" }
//                { type: "interrupt", ... }
//      outbound: { type: "text", token: "<text to speak>", last: true }
//                { type: "end", handoffData: "..." }  // ends the call
// ---------------------------------------------------------------------------
const server = http.createServer(app);
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
  if (!TWILIO_WHATSAPP_FROM || !BUSINESS_OWNER_WHATSAPP_NUMBER) {
    console.warn(`[${callSid}] WhatsApp notification skipped: TWILIO_WHATSAPP_FROM or BUSINESS_OWNER_WHATSAPP_NUMBER not configured.`);
    return;
  }

  const call = await db.getCall(callSid);
  if (!call) return;

  const hasCallerInfo = Boolean(call.name && call.reason);
  const hasRecording = Boolean(call.recording_url);
  if (!hasCallerInfo || !hasRecording) return; // not ready yet — the other trigger will re-check later

  if (whatsappSendInProgress.has(callSid)) return;
  if (call.whatsapp_sent) return;
  whatsappSendInProgress.add(callSid);

  const body = [
    'New missed-call lead',
    `Name: ${call.name}`,
    `Phone: ${call.from_number}`,
    `Reason: ${call.reason}`,
    `Time: ${call.created_at}`,
    `Recording: ${call.recording_url}`,
  ].join('\n');

  try {
    await twilioClient.messages.create({
      from: `whatsapp:${TWILIO_WHATSAPP_FROM}`,
      to: `whatsapp:${BUSINESS_OWNER_WHATSAPP_NUMBER}`,
      body,
      // Prefer Supabase signed URL when Storage upload succeeded; otherwise
      // Twilio URL works when media stays on the same Twilio account.
      mediaUrl: [call.recording_url],
    });
    await db.markWhatsappSent(callSid);
  } catch (err) {
    console.error(`[${callSid}] WhatsApp notification failed:`, err);
    // Don't rethrow — a failed notification should never take down the server
    // or affect the call itself. The state remains unsent so a later trigger
    // can retry.
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
          provider: 'twilio',
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

    response = await geminiClient.models.generateContent({
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
  console.log(`📞 Voice webhook: ${PUBLIC_BASE_URL}/voice/incoming`);
  console.log(`📡 Relay WebSocket: ${PUBLIC_BASE_URL.replace(/^https/, 'wss')}/ws/relay`);
  console.log(`✓ Gemini SDK initialized`);
  console.log(`✓ Twilio SDK initialized`);
  console.log(`✓ Supabase database initialized`);
});
