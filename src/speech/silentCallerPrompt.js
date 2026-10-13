// VOICE_SILENT_CALLER_PROMPT: after the greeting, re-prompt once if the caller
// never speaks. Independent of heardCallerUtterance (idle nudge cannot fire
// before the first utterance). off (default) leaves main behaviour alone.
//
// Covers HD_31d827427104 / HD_1af0738130bc (audio flowed, caller silent, no prompt).

const ON = new Set(['on', '1', 'true', 'yes']);
const DEFAULT_DELAY_MS = 5000;
const MIN_DELAY_MS = 2000;
const MAX_DELAY_MS = 12000;
const MAX_PER_CALL = 1;

function silentCallerPromptEnabled(env = process.env) {
  return ON.has(String(env.VOICE_SILENT_CALLER_PROMPT || 'off').trim().toLowerCase());
}

function silentCallerPromptDelayMs(env = process.env) {
  const n = Number(env.VOICE_SILENT_CALLER_PROMPT_MS);
  if (Number.isFinite(n) && n >= MIN_DELAY_MS && n <= MAX_DELAY_MS) return n;
  return DEFAULT_DELAY_MS;
}

/**
 * Local line, not a Gemini turn. Matches call language when known.
 * @param {{ language?: string }} [opts]
 */
function pickSilentCallerPromptLine(opts = {}) {
  const lang = String(opts.language || 'en').toLowerCase();
  if (lang === 'sw' || lang === 'sheng' || lang === 'mixed') return 'Halo, unanisikia?';
  return 'Hello, can you hear me?';
}

/**
 * @param {{
 *   delayMs?: number,
 *   maxPerCall?: number,
 *   canFire?: () => boolean,
 *   speak?: () => (void|Promise<unknown>),
 *   setTimeout?: typeof setTimeout,
 *   clearTimeout?: typeof clearTimeout,
 * }} [opts]
 */
function createSilentCallerPrompt(opts = {}) {
  const delayMs = Number.isFinite(Number(opts.delayMs))
    ? Number(opts.delayMs)
    : silentCallerPromptDelayMs();
  const maxPerCall = Number.isFinite(Number(opts.maxPerCall))
    ? Number(opts.maxPerCall)
    : MAX_PER_CALL;
  const schedule = opts.setTimeout || setTimeout;
  const cancel = opts.clearTimeout || clearTimeout;

  let timer = null;
  let count = 0;
  let closed = false;

  function clear() {
    if (timer == null) return false;
    cancel(timer);
    timer = null;
    return true;
  }

  function fire() {
    timer = null;
    if (closed) return;
    if (count >= maxPerCall) return;
    if (typeof opts.canFire === 'function' && !opts.canFire()) return;
    count += 1;
    Promise.resolve()
      .then(() => (typeof opts.speak === 'function' ? opts.speak() : null))
      .catch(() => {});
  }

  function arm(next = {}) {
    clear();
    if (closed || next.skip) return false;
    if (count >= maxPerCall) return false;
    timer = schedule(fire, delayMs);
    return true;
  }

  function close() {
    closed = true;
    clear();
  }

  return {
    arm,
    clear,
    close,
    count: () => count,
    armed: () => timer != null,
    delayMs,
  };
}

module.exports = {
  DEFAULT_DELAY_MS,
  MAX_PER_CALL,
  silentCallerPromptEnabled,
  silentCallerPromptDelayMs,
  pickSilentCallerPromptLine,
  createSilentCallerPrompt,
};
