// After a committed agent question, speak one canned check-in if the
// caller stays silent. Not a Gemini turn. Not an auto hangup.

const DEFAULT_DELAY_MS = 5000;
const MIN_DELAY_MS = 1500;
const MAX_DELAY_MS = 15000;
const MAX_PER_CALL = 2;

function idleNudgeDelayMs(env = process.env) {
  const n = Number(env.VOICE_IDLE_NUDGE_MS);
  if (Number.isFinite(n) && n >= MIN_DELAY_MS && n <= MAX_DELAY_MS) return n;
  return DEFAULT_DELAY_MS;
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
  };
}

module.exports = {
  DEFAULT_DELAY_MS,
  MAX_PER_CALL,
  idleNudgeDelayMs,
  createIdleNudgeController,
};
