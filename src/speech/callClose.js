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
 * Close the idle nudge first, then speak, then hang up.
 * A nudge armed before END must not speak during the farewell.
 * @param {{
 *   action?: string,
 *   language?: string,
 *   idle?: { close?: () => void },
 *   speak?: (line: string) => unknown,
 *   hangup?: (reason: string) => void,
 * }} [opts]
 */
async function runBrainEndClose(opts = {}) {
  const plan = planBrainEndClose(opts);
  if (!plan.close) return plan;
  if (opts.idle && typeof opts.idle.close === 'function') opts.idle.close();
  if (typeof opts.speak === 'function') await opts.speak(plan.line);
  if (typeof opts.hangup === 'function') opts.hangup('end_call');
  return plan;
}

module.exports = {
  planBrainEndClose,
  runBrainEndClose,
};
