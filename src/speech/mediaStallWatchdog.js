// Inbound-frame-gap watchdog. When the media socket is open but no binary
// frame arrives for over VOICE_MEDIA_STALL_LOG_MS (default 2000), log media_stall.
// off (default) via VOICE_MEDIA_STALL_WATCHDOG. Covers HD_226f814d7ab0 /
// HD_9ed756701096 (carrier audio stalled after the greeting).

const ON = new Set(['on', '1', 'true', 'yes']);
const DEFAULT_GAP_MS = 2000;
const MIN_GAP_MS = 1000;
const MAX_GAP_MS = 10000;
const DEFAULT_POLL_MS = 500;

function mediaStallWatchdogEnabled(env = process.env) {
  return ON.has(String(env.VOICE_MEDIA_STALL_WATCHDOG || 'off').trim().toLowerCase());
}

function mediaStallGapMs(env = process.env) {
  const n = Number(env.VOICE_MEDIA_STALL_LOG_MS);
  if (Number.isFinite(n) && n >= MIN_GAP_MS && n <= MAX_GAP_MS) return n;
  return DEFAULT_GAP_MS;
}

/**
 * @param {{
 *   gapMs?: number,
 *   pollMs?: number,
 *   isOpen?: () => boolean,
 *   onStall?: (info: { gapMs: number, frames: number }) => void,
 *   setInterval?: typeof setInterval,
 *   clearInterval?: typeof clearInterval,
 *   now?: () => number,
 * }} [opts]
 */
function createMediaStallWatchdog(opts = {}) {
  const gapMs = Number.isFinite(Number(opts.gapMs)) ? Number(opts.gapMs) : mediaStallGapMs();
  const pollMs = Number.isFinite(Number(opts.pollMs)) ? Number(opts.pollMs) : DEFAULT_POLL_MS;
  const schedule = opts.setInterval || setInterval;
  const cancel = opts.clearInterval || clearInterval;
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();

  let timer = null;
  let lastBinaryAt = null;
  let binaryFrames = 0;
  let armed = false;
  let stalled = false;
  let closed = false;

  function noteBinaryFrame() {
    lastBinaryAt = now();
    binaryFrames += 1;
    stalled = false;
  }

  function tick() {
    if (closed || !armed) return;
    if (typeof opts.isOpen === 'function' && !opts.isOpen()) return;
    if (lastBinaryAt == null) return;
    const gap = now() - lastBinaryAt;
    if (gap < gapMs) return;
    if (stalled) return;
    stalled = true;
    if (typeof opts.onStall === 'function') {
      try {
        opts.onStall({ gapMs: gap, frames: binaryFrames });
      } catch {
        /* ignore */
      }
    }
  }

  function arm() {
    if (closed) return false;
    armed = true;
    if (timer == null) {
      timer = schedule(tick, pollMs);
      if (typeof timer?.unref === 'function') timer.unref();
    }
    return true;
  }

  function clear() {
    armed = false;
    if (timer != null) {
      cancel(timer);
      timer = null;
    }
  }

  function close() {
    closed = true;
    clear();
  }

  return {
    noteBinaryFrame,
    arm,
    clear,
    close,
    stalled: () => stalled,
    frames: () => binaryFrames,
    gapMs,
  };
}

module.exports = {
  DEFAULT_GAP_MS,
  mediaStallWatchdogEnabled,
  mediaStallGapMs,
  createMediaStallWatchdog,
};
