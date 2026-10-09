// A coverage answer written by Gemini ("We cover Nairobi, Kitengela, ...")
// ended on a bare list, and the caller had to fill the silence
// (HD_ee813bcf6248 t6, t8). The local coverage line already ends on a next
// step (#612). This adds the same question after a model-written coverage
// answer that does not ask anything.

const visitLocation = require('./visitLocation');

const OUTSIDE_ANSWER =
  /\b(?:outside\s+(?:our|the)\s+(?:coverage|service\s+area|area)|(?:do\s+not|don'?t)\s+(?:cover|serve)|hatufiki|hatuhudumii)\b/i;

const COVERAGE_ANSWER =
  /\b(?:we\s+(?:currently\s+|also\s+|only\s+)?(?:cover|serve)|our\s+coverage|coverage\s+areas?|outside\s+our\s+(?:coverage|area)|tunafika|tunahudumia|hatufiki)\b/i;

function isSwahili(language) {
  const lang = String(language || 'en').toLowerCase();
  return lang === 'sw' || lang === 'sheng' || lang.startsWith('swahili');
}

function serviceOnFile(state) {
  const raw = state?.entities?.service;
  const value = raw && typeof raw === 'object' ? raw.value : raw;
  return String(value || '').trim() !== '';
}

/** Same wording as #612 coverageNextStepQuestion, used until that lands on main. */
function fallbackNextStep(language, state) {
  const sw = isSwahili(language);
  if (!serviceOnFile(state)) return sw ? 'Ungependa huduma gani?' : 'Which service would you like?';
  const missing = Array.isArray(state?.goal?.missingSlots) ? state.goal.missingSlots : [];
  const needsWhen = missing.some((slot) => /^(?:when|when_text|time)$/.test(slot));
  const needsPlace = missing.some((slot) => /^(?:location|landmark|area)$/.test(slot));
  if (needsPlace && !needsWhen) return sw ? 'Tuje wapi?' : 'Where should we come?';
  return sw ? 'Ungependa tuje lini?' : 'When would you like us to come?';
}

function coverageNextStep(language = 'en', state = null) {
  if (typeof visitLocation.coverageNextStepQuestion === 'function') {
    return visitLocation.coverageNextStepQuestion(language, state);
  }
  return fallbackNextStep(language, state);
}

/** True for a spoken coverage answer that ends without a question. */
function coverageAnswerWithoutNextStep(text) {
  const spoken = String(text || '').trim();
  if (!spoken || /\?\s*$/.test(spoken)) return false;
  return COVERAGE_ANSWER.test(spoken);
}

/**
 * The next-step question owed after this spoken reply, or ''.
 * Home services only: a shop answer about delivery areas is not a visit.
 */
function coverageNextStepFor(text, { profile = {}, language = 'en', state = null } = {}) {
  if (String(profile?.vertical || '').toLowerCase() !== 'home_services') return '';
  if (!coverageAnswerWithoutNextStep(text)) return '';
  if (OUTSIDE_ANSWER.test(String(text || ''))) {
    return isSwahili(language) ? 'Naweza kukuachia ujumbe kwa timu yetu?' : 'Should I note it for the team?';
  }
  return coverageNextStep(language, state);
}

module.exports = {
  coverageAnswerWithoutNextStep,
  coverageNextStepFor,
};
