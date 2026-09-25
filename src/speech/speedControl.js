// Caller-requested TTS speed control.
//
// Live finding (2026-09-14, call a2c0c86c): a caller kept saying "slower" /
// "polepole" and the model's only tool was typing "..." between words, which
// the net turns into staccato pauses while the word rate stays the same.
// The voice must actually slow down. This module detects the request in the
// caller turn and steps a per-call speed scale that every speak path applies.

const SLOW_EN =
  /\b(slower|slow down|speak (?:more )?slowly|talk (?:more )?slowly|too fast|too quick(?:ly)?|not so fast)\b/i;
const SLOW_SW = /\b(polepole|ongea\s+polepole|sema\s+polepole|punguza\s+mwendo)\b/i;
const FAST_EN =
  /\b(faster|speed up|speak (?:more )?quickly|talk faster|too slow|quicker|go faster|increase (?:the |your )?speed)\b/i;
// "haraka" alone is not enough: "kuja haraka" (come quickly) is not a speed ask.
const FAST_SW = /\b((?:ongea|sema|zungumza)\s+haraka|haraka\s+zaidi)\b/i;
const RESET_EN = /\b(normal speed|back to normal|as usual|usual speed)\b/i;
const RESET_SW = /\b(kama\s+kawaida|mwendo\s+wa\s+kawaida)\b/i;

const SPEED_STEP = 0.15;
const SPEED_MIN = 0.7; // matches clampSpeed floor
const SPEED_MAX = 1.3; // matches clampSpeed ceiling

/**
 * Classify a caller turn as a voice-speed request.
 * @param {string} text
 * @returns {{ action: 'slower'|'faster'|'reset' } | null}
 */
function detectSpeedRequest(text) {
  const t = String(text || '');
  if (!t.trim()) return null;
  if (RESET_EN.test(t) || RESET_SW.test(t)) return { action: 'reset' };
  if (SLOW_EN.test(t) || SLOW_SW.test(t)) return { action: 'slower' };
  if (FAST_EN.test(t) || FAST_SW.test(t)) return { action: 'faster' };
  return null;
}

/**
 * Step the per-call speed scale. Repeated "slower" requests keep stepping down
 * to the floor so each ask has an audible effect; "faster" steps back up.
 * @param {number} current
 * @param {'slower'|'faster'|'reset'} action
 */
function nextSpeedScale(current, action) {
  const scale = Number.isFinite(current) && current > 0 ? current : 1;
  if (action === 'reset') return 1;
  if (action === 'slower') return Math.max(SPEED_MIN, Math.round((scale - SPEED_STEP) * 100) / 100);
  if (action === 'faster') return Math.min(SPEED_MAX, Math.round((scale + SPEED_STEP) * 100) / 100);
  return scale;
}

module.exports = {
  detectSpeedRequest,
  nextSpeedScale,
  SPEED_STEP,
  SPEED_MIN,
  SPEED_MAX,
};
