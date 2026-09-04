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

function cloneGeminiPart(part) {
  if (!part || typeof part !== 'object') return null;
  const cloned = {};
  if (typeof part.text === 'string') cloned.text = part.text;
  if (part.thought === true) cloned.thought = true;
  const signature = part.thoughtSignature || part.thought_signature;
  if (signature) cloned.thoughtSignature = String(signature);
  if (!cloned.text && !cloned.thoughtSignature && !cloned.thought) return null;
  return cloned;
}

function extractGeminiParts(response) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return [];
  return parts.map(cloneGeminiPart).filter(Boolean);
}

/**
 * Stream chunks may split text and put the thought signature on a later
 * empty part. Keep signed / thought parts intact. Do not merge them.
 */
function appendGeminiStreamParts(acc, chunk) {
  const next = Array.isArray(acc) ? acc.slice() : [];
  for (const part of extractGeminiParts(chunk)) {
    const last = next[next.length - 1];
    const canMerge =
      last &&
      last.thought !== true &&
      part.thought !== true &&
      !last.thoughtSignature &&
      !part.thoughtSignature &&
      typeof last.text === 'string' &&
      typeof part.text === 'string';
    if (canMerge) last.text += part.text;
    else next.push(part);
  }
  return next;
}

function modelPartsForHistory({ geminiParts, text, thoughtSignature } = {}) {
  if (Array.isArray(geminiParts) && geminiParts.length) {
    return geminiParts.map(cloneGeminiPart).filter(Boolean);
  }
  const part = { text: String(text || '') };
  if (thoughtSignature) part.thoughtSignature = String(thoughtSignature);
  return part.text || part.thoughtSignature ? [part] : [];
}

/**
 * Build Gemini contents from in-memory chat messages.
 * Instant/local greetings have no thought signature — sending them as model
 * turns makes Gemini 3 MINIMAL return 400 and the caller hears silence.
 * Replay model parts as received. Do not glue a signature onto merged text.
 */
function buildGeminiContents(messages, windowSize = CONTEXT_WINDOW) {
  const recentMessages = Array.isArray(messages) ? messages.slice(-windowSize) : [];
  const contents = [];
  for (const message of recentMessages) {
    if (!message || message.role === 'system' || message.local) continue;
    const role = message.role === 'assistant' ? 'model' : 'user';
    let parts;
    if (role === 'model' && Array.isArray(message.geminiParts) && message.geminiParts.length) {
      parts = message.geminiParts.map(cloneGeminiPart).filter(Boolean);
    } else {
      const part = { text: String(message.content || '') };
      if (role === 'model' && message.thoughtSignature) {
        part.thoughtSignature = message.thoughtSignature;
      }
      parts = [part];
    }
    if (!parts.length) continue;
    const prev = contents[contents.length - 1];
    if (
      prev &&
      prev.role === 'user' &&
      role === 'user' &&
      prev.parts.length === 1 &&
      parts.length === 1 &&
      typeof prev.parts[0].text === 'string' &&
      typeof parts[0].text === 'string'
    ) {
      prev.parts[0].text = `${prev.parts[0].text} ${parts[0].text}`.trim();
      continue;
    }
    contents.push({ role, parts });
  }
  return contents;
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

function classifyGeminiError(err) {
  const status = Number(err?.status || err?.code || 0);
  const msg = String(err?.message || err || '').toLowerCase();
  if (
    status === 403 ||
    msg.includes('denied access') ||
    msg.includes('permission_denied')
  ) {
    return { retryable: false, kind: 'denied' };
  }
  if (
    msg.includes('credits are depleted') ||
    msg.includes('prepayment') ||
    msg.includes('prepay') ||
    (status === 429 && msg.includes('billing'))
  ) {
    return { retryable: false, kind: 'billing' };
  }
  if (
    status === 429 ||
    msg.includes('429') ||
    msg.includes('resource_exhausted') ||
    msg.includes('overloaded')
  ) {
    return { retryable: true, kind: 'rate_limit' };
  }
  if (
    status === 500 ||
    status === 503 ||
    msg.includes('503') ||
    msg.includes('unavailable')
  ) {
    return { retryable: true, kind: 'unavailable' };
  }
  return { retryable: false, kind: 'error' };
}

function isRetryableGeminiError(err) {
  return classifyGeminiError(err).retryable === true;
}

/**
 * After a streamed Gemini turn, decide whether prefetch TTS already spoke
 * and what (if anything) still needs speakText. Empty successful model
 * output must not become a technical fallback — the turn guarantee can
 * ask the next slot instead. Timeout / LLM failure speaks fallback once.
 */
const OUTCOME_TOOL_ACTIONS = new Set([
  'create_service_request',
  'create_appointment',
  'update_appointment',
  'escalate',
  'tool_request',
]);

/**
 * Action-capable turns use the deterministic backend confirmation.
 * Model prose must not claim success (or object) before execution finishes.
 */
function spokenTextForToolTurn({ spoken = '', toolResults = [] } = {}) {
  const hasOutcomeAction = (Array.isArray(toolResults) ? toolResults : []).some(
    (result) => OUTCOME_TOOL_ACTIONS.has(result?.action)
  );
  if (hasOutcomeAction) return '';
  return String(spoken || '').trim();
}

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
  extractGeminiParts,
  appendGeminiStreamParts,
  modelPartsForHistory,
  buildGeminiContents,
  withTimeout,
  isTimeoutError,
  classifyGeminiError,
  isRetryableGeminiError,
  resolvePrefetchedStreamSpeech,
  OUTCOME_TOOL_ACTIONS,
  spokenTextForToolTurn,
};
