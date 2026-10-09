// Lock the reply language before the Gemini request. The lock goes into the
// response schema as a single-value enum, so the model cannot pick another.
//
// Order: the Soniox token tags for this turn, then the turn's own words, then
// the sticky call language. A turn made only of English job words
// ("cleaning", "services") never flips a Kiswahili call.
// Salvaged from #583 languageLock.js onto main's language helpers.

const {
  analyzeCallerLanguage,
  dominantSonioxLanguage,
  ENGLISH_JOB_LOANWORDS,
} = require('../../conversation/language');
const { LOCKABLE } = require('./languages');

const FILLERS = new Set(['ah', 'eh', 'eeh', 'yeah', 'yep', 'ok', 'okay', 'um', 'uh', 'like', 'just', 'please', 'man', 'bwana']);
const LOANWORDS = new Set(
  [...ENGLISH_JOB_LOANWORDS, 'service', 'services', 'price', 'cost', 'booking', 'visit', 'offer', 'ofa']
    .map((word) => String(word).toLowerCase())
);

function wordsOf(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function isLoanwordOnly(text) {
  const words = wordsOf(text).filter((word) => !FILLERS.has(word));
  if (!words.length) return false;
  return words.every((word) => LOANWORDS.has(word) || word.length <= 2);
}

function lockable(lang) {
  return LOCKABLE.includes(lang) ? lang : null;
}

/**
 * @param {{ text?: string, tokenLanguages?: string[], state?: { current?: string } }} input
 * @returns {{ lang: 'en'|'sw'|'sheng', source: string }}
 */
function lockReplyLanguage({ text = '', tokenLanguages = [], state = null } = {}) {
  const sticky = lockable(state?.current);
  if (isLoanwordOnly(text)) {
    return { lang: sticky || 'en', source: sticky ? 'sticky_loanword_turn' : 'default' };
  }
  const soniox = lockable(dominantSonioxLanguage(tokenLanguages));
  if (soniox) return { lang: soniox, source: 'soniox' };
  const evidence = analyzeCallerLanguage(text, { tokenLanguages });
  const words = lockable(evidence.language);
  // One clear marker word scores ~0.58. With no evidence for any other
  // language that is still the caller's language for this turn.
  const scores = evidence.scores || {};
  const rival = Object.entries(scores).some(([lang, score]) => lang !== evidence.language && Number(score) > 0);
  if (words && (evidence.confidence >= 0.6 || (evidence.confidence >= 0.5 && !rival))) {
    return { lang: words, source: 'words' };
  }
  if (sticky) return { lang: sticky, source: 'sticky' };
  if (evidence.language === 'mixed') {
    const sw = Number(evidence.scores?.sw || 0);
    const en = Number(evidence.scores?.en || 0);
    return { lang: sw >= en ? 'sw' : 'en', source: 'mixed' };
  }
  if (words) return { lang: words, source: 'words_weak' };
  return { lang: 'en', source: 'default' };
}

module.exports = { lockReplyLanguage, isLoanwordOnly };
