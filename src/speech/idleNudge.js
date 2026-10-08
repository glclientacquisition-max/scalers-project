// After a committed agent question, speak one canned check-in if the
// caller stays silent. Not a Gemini turn. Not an auto hangup.
// After an agent statement with no question (HD_48e5ce069c12: a corrected
// coverage line, then 7.2 s of silence) the check-in is armed too, sooner,
// and it offers the next step instead of "How can I help?".

const DEFAULT_DELAY_MS = 10000;
const MIN_DELAY_MS = 1500;
const MAX_DELAY_MS = 15000;
const MAX_PER_CALL = 2;
const DEFAULT_STATEMENT_DELAY_MS = 4000;
const MIN_STATEMENT_DELAY_MS = 2500;
const MAX_STATEMENT_DELAY_MS = 8000;

const FAREWELL =
  /\b(?:good ?bye|bye|kwaheri|take care|have a (?:good|great|nice|lovely) (?:day|evening|afternoon|one)|thank you for calling|asante kwa kupiga|siku njema)\b/i;

function idleNudgeDelayMs(env = process.env) {
  const n = Number(env.VOICE_IDLE_NUDGE_MS);
  if (Number.isFinite(n) && n >= MIN_DELAY_MS && n <= MAX_DELAY_MS) return n;
  return DEFAULT_DELAY_MS;
}

function idleStatementDelayMs(env = process.env) {
  const n = Number(env.VOICE_IDLE_STATEMENT_MS);
  if (Number.isFinite(n) && n >= MIN_STATEMENT_DELAY_MS && n <= MAX_STATEMENT_DELAY_MS) return n;
  return DEFAULT_STATEMENT_DELAY_MS;
}

/**
 * How to arm after an agent line finished playing.
 * A question waits the normal delay. A statement waits the shorter one,
 * unless it said goodbye. Nothing is armed for an empty line.
 * @param {{ text?: string, isQuestion?: boolean }} line
 * @returns {{ arm: boolean, afterStatement: boolean, delayMs?: number }}
 */
function idleArmAfterAgentLine({ text = '', isQuestion = false } = {}, env = process.env) {
  const spoken = String(text || '').trim();
  if (isQuestion) return { arm: true, afterStatement: false };
  if (!spoken || FAREWELL.test(spoken)) return { arm: false, afterStatement: false };
  return { arm: true, afterStatement: true, delayMs: idleStatementDelayMs(env) };
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
function createIdleNudgeController(opts = {}) {
  const delayMs = Number.isFinite(Number(opts.delayMs))
    ? Number(opts.delayMs)
    : idleNudgeDelayMs();
  const maxPerCall = Number.isFinite(Number(opts.maxPerCall))
    ? Number(opts.maxPerCall)
    : MAX_PER_CALL;
  const schedule = opts.setTimeout || setTimeout;
  const cancel = opts.clearTimeout || clearTimeout;

  let timer = null;
  let count = 0;
  let closed = false;
  let armedFor = {};

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
    const context = { afterStatement: armedFor.afterStatement === true };
    Promise.resolve()
      .then(() => (typeof opts.speak === 'function' ? opts.speak(context) : null))
      .catch(() => {});
  }

  function arm(next = {}) {
    clear();
    if (closed || next.skip) return false;
    if (count >= maxPerCall) return false;
    armedFor = { afterStatement: next.afterStatement === true };
    const wait = Number.isFinite(Number(next.delayMs)) ? Number(next.delayMs) : delayMs;
    timer = schedule(fire, wait);
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
  };
}

module.exports = {
  DEFAULT_DELAY_MS,
  DEFAULT_STATEMENT_DELAY_MS,
  idleStatementDelayMs,
  idleArmAfterAgentLine,
  MAX_PER_CALL,
  idleNudgeDelayMs,
  createIdleNudgeController,
};
