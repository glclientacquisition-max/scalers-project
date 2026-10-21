// Second preload for tests/endCallHonourE2e.test.js, loaded AFTER
// tests/helpers/mediaCallSim.js (kept byte-identical to #836).
// Each spoken (non-silent) line also plays MEDIA_SIM_LINE_MS of PCM through the
// session's onAudio, so "after the final audio" is measurable: the line takes
// that long to play at the far end. Nothing else changes.
'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LINE_MS = Math.max(0, Number(process.env.MEDIA_SIM_LINE_MS) || 0);
const tts = require(path.join(ROOT, 'src/speech/sonioxTts'));
const base = tts.createSonioxTtsSession;

tts.createSonioxTtsSession = (opts = {}) => {
  const session = base(opts);
  const beginSpeak = session.beginSpeak.bind(session);
  session.beginSpeak = async (speakOpts = {}) => {
    const one = await beginSpeak(speakOpts);
    const end = one.end.bind(one);
    one.end = async () => {
      const out = await end();
      if (LINE_MS && !speakOpts.silent && !out.cancelled && typeof opts.onAudio === 'function') {
        opts.onAudio(Buffer.alloc(LINE_MS * 32), { streamId: one.streamId });
      }
      return out;
    };
    return one;
  };
  return session;
};

// --- Fake Gemini (only when MEDIA_SIM_GEMINI is set) ------------------------
// MEDIA_SIM_GEMINI = JSON list of { match, delayMs, text }. Each model call
// answers with the first row whose `match` occurs in the latest user turn
// (rows without `match` are the fallback), streamed as one chunk after
// `delayMs`. Lets a test emit the v1 end marker (###ENDCALL###) or land a reply
// after the caller hung up (HD_2ccfbf6e1fa4). No network.
if (process.env.MEDIA_SIM_GEMINI) {
  const script = JSON.parse(process.env.MEDIA_SIM_GEMINI);
  const lastUserText = (contents) => {
    const rows = Array.isArray(contents) ? contents.filter((c) => c && c.role === 'user') : [];
    const last = rows[rows.length - 1];
    const parts = Array.isArray(last?.parts) ? last.parts : [];
    return parts.map((p) => String(p?.text || '')).join(' ');
  };
  const reply = async (args = {}) => {
    const said = lastUserText(args.contents);
    const step =
      script.find((row) => row.match && said.includes(row.match)) ||
      script.find((row) => !row.match) || { delayMs: 0, text: '' };
    await new Promise((r) => setTimeout(r, Number(step.delayMs) || 0));
    const text = String(step.text || '');
    return { text, candidates: [{ content: { role: 'model', parts: [{ text }] } }] };
  };
  const genai = require('@google/genai');
  class FakeGoogleGenAI {
    constructor() {
      this.models = {
        async generateContent(args) {
          return reply(args);
        },
        async generateContentStream(args) {
          const chunk = await reply(args);
          return (async function* gen() {
            yield chunk;
          })();
        },
      };
    }
  }
  try {
    genai.GoogleGenAI = FakeGoogleGenAI;
  } catch {
    Object.defineProperty(genai, 'GoogleGenAI', { value: FakeGoogleGenAI });
  }
}
