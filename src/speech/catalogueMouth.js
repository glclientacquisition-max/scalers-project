// First services catalogue.
//
// Local Phase-0 (na/and, one breath) owns first audio on a services ask.
// speakText returns before Gemini, so the model cannot re-list that turn.
// VOICE_GEMINI_CATALOGUE=on is a staging listen of that blend, including when
// Brain withheld the local reply. Tear the flag down after the score.
// Default off is the same local line when Brain already returned it.
//
// Outage (credits, denied project, or no Gemini key) uses that local line.
// Never period-per-item. Never invent a service. Never let Gemini speak the list.
//
// catalogueGeminiDirective stays for a Brain items[] note. The live catalogue
// turn does not send it: Gemini is not the mouth.

const { catalogueFileNames, offerCatalogueLine } = require('../conversation/knownFacts');
const { catalogueAskInPlay } = require('../conversation/fileRead');

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
 *   text?: string,
 *   profile?: object,
 *   language?: string,
 *   state?: object,
 *   callerTurns?: string[],
 *   catalogueListed?: boolean,
 *   reasoningDown?: boolean,
 *   geminiCatalogue?: boolean,
 * }} [opts]
 * @returns {{
 *   speakLocal: boolean,
 *   letGemini: boolean,
 *   line: string,
 *   reason: '' | 'local_blend' | 'outage' | 'flag_off',
 * }}
 */
function phase0CatalogueLine(text, profile, language) {
  return String(offerCatalogueLine(text, profile, language) || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function planCatalogueMouth(opts = {}) {
  const localReply = opts.localReply;
  const fromReply =
    localReply?.outcome === 'catalogue'
      ? String(localReply.line || '').replace(/\s+/g, ' ').trim()
      : '';
  // Another local outcome (hours, detail, coverage) keeps its own mouth.
  // A missing reply is a Brain withhold, or a Yes after a services ask the
  // name gate took. Rebuild the Phase-0 line from that ask unless this call
  // already spoke the list.
  const withheld = !fromReply && (localReply == null || !localReply.outcome);
  let rebuilt = '';
  if (withheld && opts.catalogueListed !== true) {
    const pending = catalogueAskInPlay(opts.text, opts.state, opts.callerTurns);
    rebuilt = phase0CatalogueLine(pending || opts.text, opts.profile, opts.language);
  }
  const line = fromReply || rebuilt;
  if (!line) {
    return { speakLocal: false, letGemini: false, line: '', reason: '' };
  }
  let reason = 'flag_off';
  if (opts.reasoningDown) reason = 'outage';
  else if (rebuilt || opts.geminiCatalogue === true) reason = 'local_blend';
  return { speakLocal: true, letGemini: false, line, reason };
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
