// First services catalogue.
//
// VOICE_GEMINI_CATALOGUE=on is a staging listen only. Gemini speaks the list
// when reasoning is up. Tear it down after the score: unset the flag.
// Default off keeps main on the local Phase-0 line (na/and, one breath).
//
// Outage (credits, denied project, or no Gemini key) always uses that local
// line. Never period-per-item. Never invent a service.
//
// Brain items[] and no-relist land in a later PR. When localReply.items is
// present, the Gemini mouth reads those names and does not fill gaps from
// anywhere else. Until then Voice reads catalogueFileNames / the prepared line.

const { catalogueFileNames } = require('../conversation/knownFacts');

function geminiCatalogueEnabled(env = process.env) {
  return String(env.VOICE_GEMINI_CATALOGUE || '').trim().toLowerCase() === 'on';
}

function geminiReasoningDown(health) {
  return Boolean(health?.billingExhausted || health?.denied);
}

/**
 * Brain items[] hook. Null when Brain has not sent a list yet.
 * @param {{ items?: string[], more?: boolean } | null} [localReply]
 * @returns {{ names: string[], more: boolean } | null}
 */
function brainCatalogueItems(localReply) {
  if (!Array.isArray(localReply?.items)) return null;
  const names = [];
  for (const raw of localReply.items) {
    const name = String(raw || '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (name) names.push(name);
  }
  if (!names.length) return null;
  return { names, more: localReply.more === true };
}

/**
 * Who speaks this catalogue turn.
 * @param {{
 *   localReply?: { outcome?: string, line?: string, items?: string[] } | null,
 *   reasoningDown?: boolean,
 *   geminiCatalogue?: boolean,
 * }} [opts]
 * @returns {{
 *   speakLocal: boolean,
 *   letGemini: boolean,
 *   line: string,
 *   reason: '' | 'gemini' | 'outage' | 'flag_off',
 * }}
 */
function planCatalogueMouth(opts = {}) {
  const localReply = opts.localReply;
  const line =
    localReply?.outcome === 'catalogue'
      ? String(localReply.line || '').replace(/\s+/g, ' ').trim()
      : '';
  if (!line) {
    return { speakLocal: false, letGemini: false, line: '', reason: '' };
  }
  if (opts.geminiCatalogue === true && !opts.reasoningDown) {
    return { speakLocal: false, letGemini: true, line, reason: 'gemini' };
  }
  return {
    speakLocal: true,
    letGemini: false,
    line,
    reason: opts.reasoningDown ? 'outage' : 'flag_off',
  };
}

/**
 * Exact file names for the Gemini listen. Brain items[] win when present.
 * Does not add a service that is not in that list.
 * @param {{ profile?: object, localReply?: { items?: string[], more?: boolean } | null }} [opts]
 * @returns {string}
 */
function catalogueGeminiDirective(opts = {}) {
  const fromBrain = brainCatalogueItems(opts.localReply);
  const file = catalogueFileNames(opts.profile || {});
  const names = fromBrain ? fromBrain.names : file.names;
  const more = fromBrain ? fromBrain.more : file.more;
  if (!names.length) {
    return 'CATALOGUE MOUTH: No services are on file. Do not invent a service. Ask what they need done.';
  }
  const lines = [
    'CATALOGUE MOUTH (this turn only):',
    'Speak only these services, in this order, in one breath. Do not add, rename, or drop one.',
    names.join('; '),
  ];
  if (more) lines.push('More are on file. Say there are more. Do not name them.');
  lines.push('Do not put a period or a question mark after each service.');
  return lines.join('\n');
}

/**
 * Periods and question marks are not catalogue beats. Soft commas keep one
 * utterance so Soniox does not read "period" and paceSpokenLists can join.
 * @param {string} text
 * @returns {string}
 */
function softenCataloguePunctuation(text) {
  return String(text || '')
    .replace(/[.]+(?=\s|$)/g, ',')
    .replace(/\?(?=\s|$)/g, ',')
    .replace(/,\s*,+/g, ', ')
    .replace(/\s+,/g, ',')
    .replace(/,(\S)/g, ', $1')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  geminiCatalogueEnabled,
  geminiReasoningDown,
  brainCatalogueItems,
  planCatalogueMouth,
  catalogueGeminiDirective,
  softenCataloguePunctuation,
};
