'use strict';

// BRAIN_TRUST_P1: generic coverage-question parsing. No tenant data and no
// place names live here: places come from the Kenya gazetteer
// (kenyaPlaces.js), the foreign-place matcher (outsideAreas.js) and each
// tenant's own coverage_areas.

function trustOn() {
  return String(process.env.BRAIN_TRUST_P1 || '').trim() === 'on';
}

// Greetings / courtesy phrases (EN + SW). Never a place, never caller content
// when they echo the agent's own greeting.
const GREETING_PHRASE = /^(?:karibu(?:\s+(?:tena|sana))?|habari(?:\s+(?:yako|zako|gani|za\s+\w+))?|hujambo|jambo|mambo|sasa|niaje|salama|asante(?:\s+sana)?|welcome(?:\s+back)?|hello|hi|hey|good\s+(?:morning|afternoon|evening|day)|thank\s+you|thanks|tukusaidie\s+vipi|nikusaidie(?:\s+aje)?)$/i;

function isGreetingPhrase(text) {
  const t = String(text || '').toLowerCase().replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return Boolean(t) && GREETING_PHRASE.test(t);
}

const LEAD = /^(?:(?:je|eh|eeh|ehe|sasa|basi|like|um|uh|oh|ah|ok|okay|so|hi|hello)\s*,?\s+)+/i;
// Swahili verb forms of "do you come / reach / work in".
const SW_VERB = '(?:mnafika|mnaja|mnakuja|mtafika|mtakuja|mnafikia|mnafanyia(?:\\s+kazi)?|mnafanya\\s+kazi|mnahudumia|mnaweza\\s+(?:kuja|kufika|kufanya\\s+kazi))';
const EN_VERB = '(?:do|cover|service|serve|come\\s+to|go\\s+to|reach|work\\s+in|operate\\s+in|deliver\\s+to)';
// Possessive lead-ins: "my place in", "our home at", "kwangu", "nyumbani kwangu".
const POSSESSIVE = /^(?:(?:to|at|in|hadi|mpaka)\s+)?(?:(?:my|our|his|her|their|the)\s+(?:place|home|house|office|area|plot|flat|apartment|estate|shop|business)|kwangu|kwetu|kwake|nyumbani(?:\s+kwangu|\s+kwetu)?)(?:\s+(?:in|at|on|near|around|huko|kule|pale|kwa|ya))?\s*/i;
const QUESTION_WORDS = /^(?:(?:wapi|where|kwa|huko|kule|hadi|mpaka|na|in|to|at|the|mtaa\s+wa|area\s+of|side\s+of|upande\s+wa)\s+)+/i;

/** "Where do you work?" / "Mnafanyia kazi wapi?" / "Which areas do you cover?" */
function asksAreaList(text) {
  const t = String(text || '').toLowerCase().replace(/[?!.,]+/g, ' ').replace(LEAD, '').replace(/\s+/g, ' ').trim();
  if (/\bwhere\s+(?:do|are|can)\s+you(?:\s+guys)?\s+(?:work|operate|cover|serve|go|come|reach|offer\s+services)\b/.test(t)) return true;
  if (/\b(?:which|what)\s+(?:areas?|places?|locations?|towns?|estates?)\s+(?:do\s+you|you)\s+(?:cover|serve|work\s+in|go\s+to|reach)\b/.test(t)) return true;
  if (new RegExp(`^${SW_VERB}\\s+(?:wapi|maeneo\\s+gani|sehemu\\s+gani|wapi\\s+wapi)$`).test(t)) return true;
  if (/^(?:mnafanyia\s+kazi|mnahudumia)\s+(?:wapi|maeneo\s+gani)$/.test(t)) return true;
  return false;
}

/** The place in a coverage question, or ''. Generic: verbs + lead-ins only. */
function coverageAskPlaceGeneric(text) {
  let value = String(text || '').replace(/[?!.]+/g, ' ').replace(/[—–]/g, ' ').replace(/\s+/g, ' ').trim();
  value = value.replace(LEAD, '');
  value = value.replace(/^(?:(?:do\s+you(?:\s+guys)?|can\s+you(?:\s+guys)?|will\s+you|would\s+you)\s+)+/i, 'do you ');
  const m =
    new RegExp(`\\bdo you\\s+${EN_VERB}\\s+(.+)$`, 'i').exec(value) ||
    /^(?:what|how)\s+about\s+(.+)$/i.exec(value) ||
    new RegExp(`^${SW_VERB}\\s+(.+)$`, 'i').exec(value);
  if (!m) return '';
  let place = m[1].trim();
  for (let i = 0; i < 3; i += 1) {
    const before = place;
    place = place.replace(POSSESSIVE, '').replace(QUESTION_WORDS, '').trim();
    if (place === before) break;
  }
  place = place.replace(/\s+(?:wapi|where|pia|too|also|please|tafadhali)$/i, '').trim();
  if (!place || isGreetingPhrase(place)) return '';
  return place;
}

/**
 * A heard place that is not an exact place but is one edit from one
 * (STT mishearing) → the real place to confirm once. '' when exact or unknown.
 */
function nearMissPlace(place) {
  const k = require('./kenyaPlaces');
  const key = k.normalizePlaceKey(place);
  if (!key || key.includes(' ')) return '';
  const canon = k.canonicalPlaceName(key);
  if (!canon || canon === key) return '';
  return canon.replace(/\b\w/g, (c) => c.toUpperCase());
}

function placeConfirmLine(place, language = 'en') {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sw' || lang === 'sheng' || lang.startsWith('swahili')) return `Ulisema ${place}?`;
  return `Did you mean ${place}?`;
}

module.exports = {
  trustOn,
  isGreetingPhrase,
  asksAreaList,
  coverageAskPlaceGeneric,
  nearMissPlace,
  placeConfirmLine,
};
