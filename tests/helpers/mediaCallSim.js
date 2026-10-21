// Offline /ws/media call simulator: preload for a forked `node server.js`.
//
// Loaded with `node -r ./tests/helpers/mediaCallSim.js server.js` (see
// tests/bareHelloE2e.test.js). It keeps the real server.js media loop,
// turnTaking, overlapHold/agentReplay and bareGreetingReply code, and swaps
// only the network edges:
//   - Soniox STT: a fake session. The parent test pushes STT events over IPC
//     ({ cmd: 'stt', evt }), exactly the shapes src/speech/sonioxStt.js emits
//     (transcript finals with tokens, then { type: 'endpoint' }), keyed by callSid.
//   - Soniox TTS: a fake session. Every line that reaches beginSpeak →
//     pushText → end() is reported to the parent as { ev: 'speak', text }.
//     That is the speak sink: if nothing arrives there, the caller heard silence.
//   - Greeting PCM cache: the real cache, pre-seeded for whatever greeting the
//     call builds, so the greeting plays via playCachedFillerPcm (the path
//     that never calls agentReplay.beginSpeech).
// No Supabase, Gemini or Soniox network calls: the parent clears those env vars.
'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const send = (msg) => {
  try {
    if (process.send) process.send(msg);
  } catch {
    /* parent gone */
  }
};

// 0.3 s of 16 kHz S16LE silence: a short cached greeting clip.
const GREETING_PCM = Buffer.alloc(16000 * 2 * 0.3);

// --- Soniox STT -----------------------------------------------------------
const stt = require(path.join(ROOT, 'src/speech/sonioxStt'));
/** callSid → onEvent of that call's STT session. */
const sttByCall = new Map();
stt.isSonioxConfigured = () => true;
stt.createSonioxSttSession = ({ callSid, onEvent }) => {
  sttByCall.set(String(callSid), onEvent);
  send({ ev: 'stt_open', callSid });
  return {
    ready: Promise.resolve(),
    sendAudio() {},
    close() {},
  };
};

// --- Soniox TTS -----------------------------------------------------------
const tts = require(path.join(ROOT, 'src/speech/sonioxTts'));
let streamSeq = 0;
tts.isSonioxTtsConfigured = () => true;
tts.createSonioxTtsSession = ({ callSid, onAudio } = {}) => {
  const session = {
    ready: Promise.resolve(),
    async beginSpeak(opts = {}) {
      const streamId = `sim-${++streamSeq}`;
      const pieces = [];
      let cancelled = false;
      return {
        streamId,
        pushText(text) {
          const t = String(text || '');
          if (!t.trim()) return { pushed: false };
          pieces.push(t);
          return { pushed: true };
        },
        async end() {
          const text = pieces.join(' ').trim();
          if (!cancelled && text && opts.silent) {
            // Off-call render for a PCM cache (filler / greeting warm): never heard.
            send({ ev: 'warm', text, callSid, streamId });
          } else if (!cancelled && text) {
            send({ ev: 'speak', text, callSid, streamId, language: opts.language || null, at: Date.now() });
            const pcm = Buffer.alloc(640);
            if (typeof onAudio === 'function') onAudio(pcm, { streamId });
          }
          await new Promise((r) => setTimeout(r, 20));
          return { ok: true, cancelled, pcm: null };
        },
        cancel() {
          cancelled = true;
        },
      };
    },
    // One-shot render (outage clips use it); same contract as sonioxTts.speak.
    async speak(text, opts = {}) {
      const one = await session.beginSpeak({ ...opts, silent: true });
      const pushed = one.pushText(text);
      if (!pushed.pushed) return { cancelled: false, empty: true };
      return one.end();
    },
    cancel() {},
    close() {},
  };
  return session;
};

// --- Greeting PCM cache: seed the real cache for the line this call builds --
const greetingCache = require(path.join(ROOT, 'src/speech/greetingPcmCache'));
const realLookup = greetingCache.lookupGreetingPcm;
greetingCache.lookupGreetingPcm = (args) => {
  const found = realLookup(args);
  if (!found.pcm && found.key) {
    greetingCache.putGreetingPcm(found.key, GREETING_PCM, { tenantId: null });
    send({ ev: 'greeting_seeded', text: args?.text || '' });
    return realLookup(args);
  }
  return found;
};

// --- Parent → server: STT events -------------------------------------------
process.on('message', (msg) => {
  if (!msg || msg.cmd !== 'stt') return;
  const onEvent = sttByCall.get(String(msg.callSid));
  if (!onEvent) {
    send({ ev: 'stt_drop', callSid: msg.callSid, reason: 'no session' });
    return;
  }
  onEvent(msg.evt);
});

// Forward the server's own log lines so the parent can read decisions.
for (const level of ['log', 'warn', 'error']) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    const line = args
      .map((a) => {
        if (typeof a === 'string') return a;
        if (a && a.message) return a.message;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(' ');
    send({ ev: 'log', level, line });
    if (process.env.MEDIA_SIM_VERBOSE) orig(...args);
  };
}
