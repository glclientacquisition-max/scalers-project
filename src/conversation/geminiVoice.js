// Gemini voice-turn helpers. LLM interprets; this module keeps the
// request shape valid and bounds hang time so the caller is never left silent.

const { stripSpokenInstructionLeaks } = require('../speech/spokenInstructionLeak');

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

function sanitizePartText(part) {
  if (!part || typeof part.text !== 'string' || !part.text) return part;
  const text = stripSpokenInstructionLeaks(part.text, { final: true });
  if (text === part.text) return part;
  return { ...part, text };
}

function cloneGeminiPart(part) {
  if (!part || typeof part !== 'object') return null;
  const cloned = {};
  if (typeof part.text === 'string') cloned.text = part.text;
  if (part.thought === true) cloned.thought = true;
  const signature = part.thoughtSignature || part.thought_signature;
  if (signature) cloned.thoughtSignature = String(signature);
  if (!cloned.text && !cloned.thoughtSignature && !cloned.thought) return null;
  const cleaned = sanitizePartText(cloned);
  if (!cleaned.text && !cleaned.thoughtSignature && !cleaned.thought) return null;
  return cleaned;
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

// Google's documented signature for a model turn Gemini did not generate
// (a local line, or a reply the speech guard rewrote). Text parts are not
// strictly validated; this keeps the turn well formed either way.
const UNSIGNED_MODEL_TURN = 'skip_thought_signature_validator';
const TOOL_BLOCK = /###TOOL###[\s\S]*?###ENDTOOL###|###ENDCALL###/gi;

function lastPartSignature(parts) {
  if (!Array.isArray(parts)) return '';
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const sig = parts[i]?.thoughtSignature || parts[i]?.thought_signature;
    if (sig) return String(sig);
  }
  return '';
}

/**
 * History holds what the caller heard, not the raw model text. A town the
 * guard corrected or a word it dropped must not come back as "what I said".
 * Tool markers from the raw reply stay so the model knows what it asked for.
 */
function spokenModelParts(spokenText, { geminiParts, text, thoughtSignature } = {}) {
  const raw =
    Array.isArray(geminiParts) && geminiParts.length
      ? geminiParts
          .filter((part) => part && part.thought !== true && typeof part.text === 'string')
          .map((part) => part.text)
          .join('')
      : String(text || '');
  const tools = (raw.match(TOOL_BLOCK) || []).join('\n');
  const body = [String(spokenText || '').replace(/\s+/g, ' ').trim(), tools]
    .filter(Boolean)
    .join('\n');
  if (!body) return [];
  const signature =
    lastPartSignature(geminiParts) || String(thoughtSignature || '') || UNSIGNED_MODEL_TURN;
  return [{ text: body, thoughtSignature: signature }];
}

/**
 * @param {{ geminiParts?: object[], text?: string, thoughtSignature?: string, spokenText?: string }} opts
 *   spokenText: the guarded line the caller heard. When given, it replaces the raw text.
 */
function modelPartsForHistory({ geminiParts, text, thoughtSignature, spokenText } = {}) {
  if (typeof spokenText === 'string') {
    return spokenModelParts(spokenText, { geminiParts, text, thoughtSignature });
  }
  if (Array.isArray(geminiParts) && geminiParts.length) {
    return geminiParts.map(cloneGeminiPart).filter(Boolean);
  }
  const part = { text: String(text || '') };
  if (thoughtSignature) part.thoughtSignature = String(thoughtSignature);
  return part.text || part.thoughtSignature ? [part] : [];
}

/**
 * Before a caller turn joins history, the agent turn since the last caller
 * turn becomes exactly what was heard: the model reply as guarded, plus any
 * local line (catalogue, name ask, tool outcome, nudge). Lines before the
 * first caller turn (the greeting) stay local, so contents never open with
 * a model turn.
 * @param {object[]} messages  mutated in place
 * @param {string} heard  agent text spoken since the last caller turn
 */
function reconcileHeardHistory(messages, heard) {
  if (!Array.isArray(messages)) return messages;
  const spoken = String(heard || '').replace(/\s+/g, ' ').trim();
  if (!spoken) return messages;
  let lastUser = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) return messages;
  const agent = messages.slice(lastUser + 1).filter((m) => m && m.role === 'assistant');
  const modelTurn = [...agent].reverse().find((m) => !m.local);
  const merged = {
    role: 'assistant',
    content: spoken,
    geminiParts: modelPartsForHistory({
      geminiParts: modelTurn?.geminiParts,
      text: modelTurn?.content,
      thoughtSignature: modelTurn?.thoughtSignature,
      spokenText: spoken,
    }),
    heard: true,
  };
  const keep = messages.slice(lastUser + 1).filter((m) => m && m.role !== 'assistant');
  messages.splice(lastUser + 1, messages.length - lastUser - 1, ...keep, merged);
  return messages;
}

/**
 * Build Gemini contents from in-memory chat messages.
 * A local line before the first caller turn (the instant greeting) is left
 * out: contents must not open with a model turn. A local line after a caller
 * turn is sent as a model turn with the unsigned marker, so the model knows
 * what the caller already heard. Replay model parts as received.
 */
function buildGeminiContents(messages, windowSize = CONTEXT_WINDOW) {
  const recentMessages = Array.isArray(messages) ? messages.slice(-windowSize) : [];
  const contents = [];
  for (const message of recentMessages) {
    if (!message || message.role === 'system') continue;
    const role = message.role === 'assistant' ? 'model' : 'user';
    if (role === 'model' && !contents.length) continue;
    let parts;
    if (role === 'model' && message.local) {
      const text = String(message.content || '').trim();
      parts = text ? [{ text, thoughtSignature: UNSIGNED_MODEL_TURN }] : [];
    } else if (role === 'model' && Array.isArray(message.geminiParts) && message.geminiParts.length) {
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
    if (prev && prev.role === 'model' && role === 'model') {
      prev.parts.push(...parts);
      continue;
    }
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

/** Credits or a denied project. A 503 demand spike is not this. */
function isHardGeminiOutage(err) {
  if (!err) return false;
  const kind = classifyGeminiError(err).kind;
  return kind === 'billing' || kind === 'denied';
}

const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
const DEFAULT_GEMINI_BACKUP_MODEL = 'gemini-3.5-flash-lite';

function geminiPrimaryModel() {
  return String(process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
}

function geminiBackupModel() {
  return (
    String(process.env.GEMINI_BACKUP_MODEL || DEFAULT_GEMINI_BACKUP_MODEL).trim() ||
    DEFAULT_GEMINI_BACKUP_MODEL
  );
}

/**
 * What to do after a stream produced no audio.
 * One retry on the same model, then one backup only when the failure is
 * capacity (503 / rate limit). Credits and a denied project stop.
 * @returns {{ action: 'retry'|'backup'|'stop', model: string, waitMs: number }}
 */
function nextGeminiStreamAttempt({
  err,
  attempt = 0,
  spoke = false,
  primary = DEFAULT_GEMINI_MODEL,
  backup = DEFAULT_GEMINI_BACKUP_MODEL,
} = {}) {
  const stop = { action: 'stop', model: primary, waitMs: 0 };
  if (spoke || isHardGeminiOutage(err)) return stop;
  const kind = classifyGeminiError(err).kind;
  const busy = kind === 'unavailable' || kind === 'rate_limit';
  const cut = isTimeoutError(err) || kind === 'error' || kind === 'unavailable' || kind === 'rate_limit';
  if (attempt === 0 && cut) return { action: 'retry', model: primary, waitMs: 400 };
  if (attempt === 1 && busy) return { action: 'backup', model: backup, waitMs: 0 };
  return stop;
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
  const freshOutcome = (Array.isArray(toolResults) ? toolResults : []).some(
    (result) =>
      OUTCOME_TOOL_ACTIONS.has(result?.action) && result.status !== 'duplicate'
  );
  if (freshOutcome) return '';
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
  reconcileHeardHistory,
  UNSIGNED_MODEL_TURN,
  buildGeminiContents,
  withTimeout,
  isTimeoutError,
  classifyGeminiError,
  isRetryableGeminiError,
  isHardGeminiOutage,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_BACKUP_MODEL,
  geminiPrimaryModel,
  geminiBackupModel,
  nextGeminiStreamAttempt,
  resolvePrefetchedStreamSpeech,
  OUTCOME_TOOL_ACTIONS,
  spokenTextForToolTurn,
};
