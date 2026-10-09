// After a wait/stop barge ("Wait.", "Subiri") the agent stops and listens.
// If the caller then says nothing, the line must not stay silent
// (HD_04cf5d5cb1aa: "Wait." cut the greeting, then 14 s of dead air).
// Speak one short go-ahead once per call, then hand over to the idle nudge.

const { normalizeSpeech, isInterruptOnlyUtterance } = require('./turnTaking');

const DEFAULT_DELAY_MS = 4500;
const MIN_DELAY_MS = 1500;
const MAX_DELAY_MS = 15000;
/** A lone wait word this early in greeting audio is ignored. */
const DEFAULT_EARLY_GREETING_MS = 1500;

function waitRepromptDelayMs(env = process.env) {
  const n = Number(env.VOICE_WAIT_REPROMPT_MS);
  if (Number.isFinite(n) && n >= MIN_DELAY_MS && n <= MAX_DELAY_MS) return n;
  return DEFAULT_DELAY_MS;
}

function earlyGreetingWaitMs(env = process.env) {
  const n = Number(env.VOICE_EARLY_GREETING_WAIT_MS);
  if (Number.isFinite(n) && n >= 0 && n <= 5000) return n;
  return DEFAULT_EARLY_GREETING_MS;
}

/**
 * @param {string} [language] sticky call language
 * @returns {{ text: string, language: 'en'|'sw' }}
 */
function pickWaitRepromptLine(language) {
  if (String(language || '').toLowerCase() === 'sw') {
    return { text: 'Sawa, endelea.', language: 'sw' };
  }
  return { text: 'Sure, go ahead.', language: 'en' };
}

/**
 * True for a final that is one wait/stop word and nothing else
 * ("Wait.", "Stop!", "Subiri"). "Wait a second" or "wait, I need a cleaner"
 * are not lone.
 * @param {string} text
 */
function isLoneWaitWord(text) {
  const t = normalizeSpeech(text).replace(/[?'-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || /\s/.test(t)) return false;
  return isInterruptOnlyUtterance(t);
}

/**
 * Keep the greeting playing when a lone wait word lands in its first
 * moments: too early to be a real "stop talking".
 * @param {{
 *   text: string,
 *   greetingPlaying: boolean,
 *   greetingAudioAt?: number|null, first greeting PCM time (ms epoch)
 *   now?: number,
 *   windowMs?: number,
 * }} opts
 */
function shouldIgnoreEarlyGreetingWait(opts = {}) {
  if (!opts.greetingPlaying) return false;
  if (!isLoneWaitWord(opts.text)) return false;
  const windowMs = Number.isFinite(Number(opts.windowMs))
    ? Number(opts.windowMs)
    : earlyGreetingWaitMs();
  if (windowMs <= 0) return false;
  // No greeting audio yet: the caller cannot be stopping it.
  if (!opts.greetingAudioAt) return true;
  const now = opts.now != null ? Number(opts.now) : Date.now();
  return now - Number(opts.greetingAudioAt) < windowMs;
}

/**
 * One-shot re-prompt after a wait/stop barge.
 * arm() works even before the caller has had a processed turn.
 * cancel() on a caller final, a new turn, call end or socket close.
 * @param {{
 *   delayMs?: number,
 *   canFire?: () => boolean,
 *   speak?: () => (void|Promise<unknown>),
 *   setTimeout?: typeof setTimeout,
 *   clearTimeout?: typeof clearTimeout,
 * }} [opts]
 */
function createWaitBargeReprompt(opts = {}) {
  const delayMs = Number.isFinite(Number(opts.delayMs))
    ? Number(opts.delayMs)
    : waitRepromptDelayMs();
  const schedule = opts.setTimeout || setTimeout;
  const unschedule = opts.clearTimeout || clearTimeout;

  let timer = null;
  let fired = false;
  let closed = false;

  function cancel() {
    if (timer == null) return false;
    unschedule(timer);
    timer = null;
    return true;
  }

  function fire() {
    timer = null;
    if (closed || fired) return;
    if (typeof opts.canFire === 'function' && !opts.canFire()) return;
    fired = true;
    Promise.resolve()
      .then(() => (typeof opts.speak === 'function' ? opts.speak() : null))
      .catch(() => {});
  }

  function arm() {
    cancel();
    if (closed || fired) return false;
    timer = schedule(fire, delayMs);
    return true;
  }

  function close() {
    closed = true;
    cancel();
  }

  return {
    arm,
    cancel,
    close,
    armed: () => timer != null,
    fired: () => fired,
    delayMs,
  };
}

module.exports = {
  DEFAULT_DELAY_MS,
  DEFAULT_EARLY_GREETING_MS,
  waitRepromptDelayMs,
  earlyGreetingWaitMs,
  pickWaitRepromptLine,
  isLoneWaitWord,
  shouldIgnoreEarlyGreetingWait,
  createWaitBargeReprompt,
};
