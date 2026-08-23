// Gemini voice-turn helpers. LLM interprets; this module keeps the
// request shape valid and bounds hang time so the caller is never left silent.

const CONTEXT_WINDOW = 16;
const DEFAULT_TURN_TIMEOUT_MS = 8000;

function geminiTurnTimeoutMs() {
  const n = Number(process.env.GEMINI_TURN_TIMEOUT_MS || DEFAULT_TURN_TIMEOUT_MS);
  if (!Number.isFinite(n) || n < 1500) return DEFAULT_TURN_TIMEOUT_MS;
  return n;
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

function extractThoughtSignature(response) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const sig = parts[i]?.thoughtSignature || parts[i]?.thought_signature;
    if (sig) return String(sig);
  }
  return '';
}

/**
 * Build Gemini contents from in-memory chat messages.
 * Instant/local greetings have no thought signature — sending them as model
 * turns makes Gemini 3 MINIMAL return 400 and the caller hears silence.
 */
function buildGeminiContents(messages, windowSize = CONTEXT_WINDOW) {
  const recentMessages = Array.isArray(messages) ? messages.slice(-windowSize) : [];
  return recentMessages
    .filter((message) => message && message.role !== 'system' && !message.local)
    .map((message) => {
      const part = { text: String(message.content || '') };
      if (message.role === 'assistant' && message.thoughtSignature) {
        part.thoughtSignature = message.thoughtSignature;
      }
      return {
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [part],
      };
    });
}

function withTimeout(promise, ms, label = 'operation') {
  const limit = Number(ms);
  if (!Number.isFinite(limit) || limit <= 0) return promise;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${limit}ms`));
    }, limit);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isTimeoutError(err) {
  return /timed out after/i.test(String(err?.message || err || ''));
}

/**
 * After a streamed Gemini turn, decide whether prefetch TTS already spoke
 * and what (if anything) still needs speakText. Empty successful model
 * output must not become a technical fallback — the turn guarantee can
 * ask the next slot instead. Timeout / LLM failure speaks fallback once.
 */
function resolvePrefetchedStreamSpeech({
  spokenChunks = '',
  spokenText = '',
  actionConfirmation = '',
  timedOut = false,
  llmFailed = false,
  fallbackLine = '',
} = {}) {
  const chunks = String(spokenChunks || '').trim();
  if (chunks) {
    return { alreadySpoken: true, reply: chunks, speakNow: false };
  }
  const spoken = String(spokenText || '').trim();
  if (spoken) {
    return { alreadySpoken: false, reply: spoken, speakNow: true };
  }
  if (String(actionConfirmation || '').trim()) {
    return { alreadySpoken: false, reply: '', speakNow: false };
  }
  if (timedOut || llmFailed) {
    const fallback = String(fallbackLine || '').trim();
    return { alreadySpoken: false, reply: fallback, speakNow: Boolean(fallback) };
  }
  return { alreadySpoken: false, reply: '', speakNow: false };
}

module.exports = {
  CONTEXT_WINDOW,
  DEFAULT_TURN_TIMEOUT_MS,
  geminiTurnTimeoutMs,
  extractGeminiText,
  extractThoughtSignature,
  buildGeminiContents,
  withTimeout,
  isTimeoutError,
  resolvePrefetchedStreamSpeech,
};
