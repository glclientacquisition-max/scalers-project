// Fallback timer for an unfinished caller turn.
//
// Brain holds the reply when the caller stopped on a fragment ("Let's say",
// "Nilikuwa nataka"). Voice keeps the held words here. New caller speech merges
// with them and cancels the timer. If the caller stays quiet for the hold
// window, the held words are answered anyway (holdTimedOut), so a hold is
// never dead air. One hold per call. Cleared on hangup and socket close.

const { joinCallerFragments } = require('./lateFinal');

const DEFAULT_HOLD_MS = 1600;
const MIN_HOLD_MS = 1200;
const MAX_HOLD_MS = 2500;

/** VOICE_UNFINISHED_HOLD_MS, clamped to 1200-2500. Default 1600. */
function unfinishedHoldMs(env = process.env) {
  const raw = env?.VOICE_UNFINISHED_HOLD_MS;
  if (raw == null || String(raw).trim() === '') return DEFAULT_HOLD_MS;
  const ms = Number(raw);
  if (!Number.isFinite(ms)) return DEFAULT_HOLD_MS;
  return Math.min(MAX_HOLD_MS, Math.max(MIN_HOLD_MS, Math.round(ms)));
}

/**
 * @param {{
 *   delayMs?: number,
 *   onTimeout: (text: string, signals: object) => void,
 *   canFire?: () => boolean,
 *   setTimeout?: Function,
 *   clearTimeout?: Function,
 * }} opts
 */
function createUnfinishedHold({
  delayMs = DEFAULT_HOLD_MS,
  onTimeout,
  canFire = () => true,
  setTimeout: setTimer = setTimeout,
  clearTimeout: clearTimer = clearTimeout,
} = {}) {
  let held = null;
  let timer = null;
  let closed = false;

  function disarm() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  function arm() {
    disarm();
    if (closed || !held) return;
    timer = setTimer(fire, delayMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function fire() {
    timer = null;
    if (closed || !held) return;
    // Agent speaking or a turn in flight: try again after one more window.
    if (!canFire()) {
      arm();
      return;
    }
    const { text, signals } = held;
    held = null;
    if (typeof onTimeout === 'function') onTimeout(text, signals);
  }

  return {
    delayMs,
    /** Hold these words and start the fallback timer. */
    hold(text, signals = {}) {
      if (closed) return;
      const words = String(text || '').trim();
      if (!words) return;
      held = { text: words, signals: { ...signals } };
      arm();
    },
    /** New final caller words: merge with the held words and stop the timer. */
    take(text) {
      const next = String(text || '').trim();
      if (!held) return next;
      const merged = joinCallerFragments([held.text, next]).replace(/\s+/g, ' ').trim();
      held = null;
      disarm();
      return merged;
    },
    /** The caller is talking again (interim). Wait for their final. */
    postpone() {
      if (held) arm();
    },
    cancel() {
      held = null;
      disarm();
    },
    close() {
      closed = true;
      held = null;
      disarm();
    },
    heldText() {
      return held ? held.text : '';
    },
    pending() {
      return Boolean(held);
    },
  };
}

module.exports = {
  DEFAULT_HOLD_MS,
  MIN_HOLD_MS,
  MAX_HOLD_MS,
  unfinishedHoldMs,
  createUnfinishedHold,
};
