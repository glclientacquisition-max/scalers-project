// Fallback timer for an unfinished caller turn (ported from #609 60e3b0dc).
//
// Brain holds the reply when the caller stopped on a fragment ("Nilikuwa
// nauliza,", "Let's say"). Voice keeps the held words here. New caller words
// merge with them and stop the timer. If the caller stays quiet for the hold
// window, the held words are answered anyway (holdTimedOut), so a hold is
// never dead air. Cleared on hangup, speech outage and socket close.
//
// Any caller interim postpones the timer, even one short word the idle rules
// ignore (HD_015bae4a4af2 answered "For" mid-sentence). A postpone never
// pushes the reply past the cap: the same interim heard again does not count,
// and the whole hold never waits longer than delayMs + maxPostponeMs.

const { joinCallerFragments } = require('./lateFinal');

const DEFAULT_HOLD_MS = 1600;
const MIN_HOLD_MS = 1200;
const MAX_HOLD_MS = 2500;
const POSTPONE_CAP_FACTOR = 2;

/** VOICE_UNFINISHED_HOLD_MS, clamped to 1200-2500. Default 1600. */
function unfinishedHoldMs(env = process.env) {
  const raw = env?.VOICE_UNFINISHED_HOLD_MS;
  if (raw == null || String(raw).trim() === '') return DEFAULT_HOLD_MS;
  const ms = Number(raw);
  if (!Number.isFinite(ms)) return DEFAULT_HOLD_MS;
  return Math.min(MAX_HOLD_MS, Math.max(MIN_HOLD_MS, Math.round(ms)));
}

function interimKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {{
 *   delayMs?: number,
 *   maxPostponeMs?: number,
 *   onTimeout: (text: string, signals: object) => void,
 *   canFire?: () => boolean,
 *   now?: () => number,
 *   setTimeout?: Function,
 *   clearTimeout?: Function,
 * }} opts
 */
function createUnfinishedHold({
  delayMs = DEFAULT_HOLD_MS,
  maxPostponeMs,
  onTimeout,
  canFire = () => true,
  now = () => Date.now(),
  setTimeout: setTimer = setTimeout,
  clearTimeout: clearTimer = clearTimeout,
} = {}) {
  const postponeCap = Number.isFinite(maxPostponeMs)
    ? Math.max(0, maxPostponeMs)
    : delayMs * POSTPONE_CAP_FACTOR;
  let held = null;
  let timer = null;
  let closed = false;

  function disarm() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  function armFor(ms) {
    disarm();
    if (closed || !held) return;
    timer = setTimer(fire, Math.max(0, ms));
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function fire() {
    timer = null;
    if (closed || !held) return;
    // Agent speaking or a turn in flight: try again after one more window.
    if (!canFire()) {
      armFor(delayMs);
      return;
    }
    const { text, signals } = held;
    held = null;
    if (typeof onTimeout === 'function') onTimeout(text, signals);
  }

  return {
    delayMs,
    maxPostponeMs: postponeCap,
    /** Hold these words and start the fallback timer. */
    hold(text, signals = {}) {
      if (closed) return;
      const words = String(text || '').trim();
      if (!words) return;
      const at = now();
      held = { text: words, signals: { ...signals }, heldAt: at, deadline: at + delayMs + postponeCap, lastInterim: '' };
      armFor(delayMs);
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
    /**
     * The caller is talking again (interim). Wait one more window for their
     * final, never past the cap. The same interim again does not postpone.
     * @returns {boolean} true when the timer moved
     */
    postpone(interimText = '') {
      if (!held || closed) return false;
      const key = interimKey(interimText);
      if (key && key === held.lastInterim) return false;
      if (key) held.lastInterim = key;
      const left = held.deadline - now();
      if (left <= 0) return false;
      armFor(Math.min(delayMs, left));
      return true;
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
