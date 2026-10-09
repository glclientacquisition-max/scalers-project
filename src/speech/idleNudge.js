// After a committed agent line, speak one canned check-in if the caller
// stays silent. Not a Gemini turn. Not an auto hangup.
//
// Questions wait DEFAULT_DELAY_MS. Since HD_ceba9d9b3f37 any other turn that
// ends without the caller speaking arms it too, on the shorter statement
// delay: a read-out that ends on a statement, or a caller "Okay." skipped
// as noise, left 20+ s of dead air because only questions armed it.

const DEFAULT_DELAY_MS = 10000;
const MIN_DELAY_MS = 1500;
const MAX_DELAY_MS = 15000;
const MAX_PER_CALL = 2;
const DEFAULT_STATEMENT_DELAY_MS = 7000;

function idleNudgeDelayMs(env = process.env) {
  const n = Number(env.VOICE_IDLE_NUDGE_MS);
  if (Number.isFinite(n) && n >= MIN_DELAY_MS && n <= MAX_DELAY_MS) return n;
  return DEFAULT_DELAY_MS;
}

function idleStatementDelayMs(env = process.env) {
  const question = idleNudgeDelayMs(env);
  const n = Number(env.VOICE_IDLE_STATEMENT_MS);
  if (Number.isFinite(n) && n >= MIN_DELAY_MS && n <= MAX_DELAY_MS) return Math.min(n, question);
  return Math.min(DEFAULT_STATEMENT_DELAY_MS, question);
}

/**
 * Should the "still there?" check be armed now, and after how long?
 * @param {{
 *   event: 'line_committed'|'turn_end',
 *   pendingIsQuestion?: boolean,
 *   isIdleNudge?: boolean,
 *   heardCaller?: boolean,
 *   callEnding?: boolean,
 *   callerPending?: boolean,
 *   armed?: boolean,
 *   questionDelayMs?: number,
 *   statementDelayMs?: number,
 * }} opts
 * @returns {{ arm: boolean, skip?: boolean, delayMs?: number, reason: string }}
 */
function idleNudgeArmPlan(opts = {}) {
  const questionDelayMs = Number(opts.questionDelayMs) || DEFAULT_DELAY_MS;
  const statementDelayMs = Number(opts.statementDelayMs) || DEFAULT_STATEMENT_DELAY_MS;
  if (opts.callEnding) return { arm: false, reason: 'call_ending' };
  // The nudge itself never re-arms the nudge (no "still there?" loop).
  if (opts.isIdleNudge) return { arm: false, skip: true, reason: 'nudge_spoken' };
  // After the greeting, wait until the caller has spoken.
  if (!opts.heardCaller) return { arm: false, skip: true, reason: 'before_caller' };
  if (opts.callerPending) return { arm: false, reason: 'caller_pending' };
  if (opts.event === 'line_committed') {
    return opts.pendingIsQuestion
      ? { arm: true, delayMs: questionDelayMs, reason: 'question' }
      : { arm: true, delayMs: statementDelayMs, reason: 'statement' };
  }
  // Turn end: a line already armed it (keep that delay); otherwise the turn
  // ended without a committed line (skipped ack, hold, quiet answer).
  if (opts.armed) return { arm: false, reason: 'already_armed' };
  return { arm: true, delayMs: statementDelayMs, reason: 'turn_end' };
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
    const wait = Number.isFinite(Number(next.delayMs)) && Number(next.delayMs) > 0
      ? Number(next.delayMs)
      : delayMs;
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
  MAX_PER_CALL,
  idleNudgeDelayMs,
  idleStatementDelayMs,
  idleNudgeArmPlan,
  createIdleNudgeController,
};
