// When Brain's next action is END, speak one short farewell and hang up.
// Do not leave the line open for an idle nudge.

const { confirmationLanguage } = require('../conversation/language');

const FAREWELL = {
  en: 'Thank you. Goodbye.',
  sw: 'Asante. Kwaheri.',
  sheng: 'Asante. Kwaheri.',
};

function planBrainEndClose({ action, language } = {}) {
  if (String(action || '').toUpperCase() !== 'END') {
    return { close: false, line: '' };
  }
  const lang = confirmationLanguage(language);
  return { close: true, line: FAREWELL[lang] || FAREWELL.en };
}

/**
 * Hang up only after the farewell PCM still queued on the bridge has played.
 * Synthesis often finishes before the caller hears the last word. A fixed
 * 800ms after speak() returns clips that tail.
 * 16 kHz mono s16le is 32 bytes per millisecond.
 * @param {{ bytes?: number, startedAt?: number, now?: number, padMs?: number, maxMs?: number }} [opts]
 */
function farewellHangupDelayMs({ bytes = 0, startedAt = 0, now = 0, padMs = 400, maxMs = 8000 } = {}) {
  const durationMs = Math.ceil(Math.max(0, Number(bytes) || 0) / 32);
  const started = Number(startedAt) || 0;
  const at = Number(now) || Date.now();
  const elapsed = started > 0 ? Math.max(0, at - started) : 0;
  const remaining = Math.max(0, durationMs - elapsed);
  return Math.min(maxMs, remaining + padMs);
}

/**
 * Close the idle nudge first, then speak, then hang up.
 * A nudge armed before END must not speak during the farewell.
 * @param {{
 *   action?: string,
 *   language?: string,
 *   idle?: { close?: () => void },
 *   speak?: (line: string) => unknown,
 *   hangup?: (reason: string) => void,
 *   isOver?: () => boolean,
 * }} [opts]
 *
 * isOver: the caller already hung up (socket closed or carrier Completed).
 * Then there is no one to say goodbye to and nothing to hang up: the
 * goodbye is not spoken (HD_ceba9d9b3f37: speaking it into a closed socket
 * was read as a TTS outage and alerted the owner), and hangup is skipped.
 * Checked again after the goodbye, so a hangup during it is not re-closed.
 */
async function runBrainEndClose(opts = {}) {
  const plan = planBrainEndClose(opts);
  if (!plan.close) return plan;
  const over = () => typeof opts.isOver === 'function' && opts.isOver() === true;
  if (opts.idle && typeof opts.idle.close === 'function') opts.idle.close();
  if (over()) return { ...plan, callOver: true, spoken: false };
  if (typeof opts.speak === 'function') await opts.speak(plan.line);
  if (over()) return { ...plan, callOver: true, spoken: true };
  if (typeof opts.hangup === 'function') opts.hangup('end_call');
  return plan;
}

module.exports = {
  planBrainEndClose,
  runBrainEndClose,
  farewellHangupDelayMs,
};
