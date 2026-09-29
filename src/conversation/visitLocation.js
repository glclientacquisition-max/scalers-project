// Home-visit place quality. Speech says location. Storage stays the landmark field.
// A saved Coverage directory is the service area. A county covers its localities.
// Delivery text is timing and other instructions. Until a directory is saved,
// Delivery and Coverage notes still apply. The office address does not. No geocoder.

const { normalizePolicies } = require('./businessPolicies');
const { normalizeLocations } = require('./businessLocations');
const { countiesMentioned, countiesForPlace } = require('./kenyaPlaces');
const { coveredByAreas, readCoverageAreas } = require('./coverageAreas');

const CONFIRM_ACCESS_NOTE = 'confirm access';

const FINDABLE_CUE =
  /\b(gate|gates|building|buildings|apt|apartment|apartments|flat|flats|house|nyumba|junction|road|street|floor|plot|court|mall|stage|block|door|wing|near|opposite|next to|karibu)\b/i;

const LOCATION_REFUSAL =
  /\b(you(?:'|’)ll find it|you will find it|just come|utapata|njoo tu)\b/i;

const PIN_MENTION = /\b(whatsapp|pin)\b/i;

const PLACE_NOISE = new Set([
  'the',
  'and',
  'for',
  'near',
  'next',
  'opposite',
  'karibu',
  'ill',
  'will',
  'send',
  'share',
  'whatsapp',
  'pin',
  'later',
  'please',
  'just',
  'come',
  'area',
  'location',
  'landmark',
  'address',
  'gate',
  'building',
  'house',
  'apartment',
  'apartments',
  'flat',
  'road',
  'street',
  'junction',
]);

const COVERAGE_STOP = new Set([
  'cover',
  'covers',
  'covered',
  'coverage',
  'service',
  'services',
  'area',
  'areas',
  'only',
  'within',
  'from',
  'come',
  'comes',
  'your',
  'our',
  'the',
  'and',
  'for',
  'you',
  'home',
  'visit',
  'visits',
  'that',
  'this',
  'with',
  'into',
  'over',
  'also',
  'plus',
  'both',
  'just',
  'here',
  'there',
  'where',
  'when',
  'what',
  'they',
  'them',
  'their',
  'will',
  'does',
  'done',
  'work',
  'works',
  'call',
  'note',
  'notes',
  'near',
  'opposite',
  'next',
  'karibu',
  'gate',
  'gates',
  'road',
  'street',
  'house',
  'building',
  'apartment',
  'apartments',
  'flat',
  'flats',
  'junction',
  'floor',
  'plot',
  'block',
  'door',
  'wing',
]);

function cleanPlace(value, max = 240) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function readVisitPlace(raw) {
  if (!raw || typeof raw !== 'object') return '';
  return cleanPlace(
    raw.location || raw.landmark || raw.address_landmark || raw.address
  );
}

function isLocationRefusal(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  return LOCATION_REFUSAL.test(value);
}

function mentionsPin(text) {
  return PIN_MENTION.test(String(text || ''));
}

function placeWords(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !PLACE_NOISE.has(word));
}

/**
 * empty | refused | area_only | findable | pin_promised
 * pin_promised: an area token plus a WhatsApp pin, no gate/building yet.
 */
function classifyVisitLocation(text) {
  const value = cleanPlace(text, 240);
  if (!value) return 'empty';
  if (isLocationRefusal(value)) return 'refused';
  const words = placeWords(value);
  const pin = mentionsPin(value);
  if (FINDABLE_CUE.test(value) && (words.length || /\d/.test(value) || value.split(/\s+/).length >= 2)) {
    return 'findable';
  }
  if (/\d/.test(value) && words.length) return 'findable';
  if (!words.length) return 'empty';
  if (words.length >= 2) return 'findable';
  if (pin) return 'pin_promised';
  return 'area_only';
}

function coverageTokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !COVERAGE_STOP.has(word));
}

function coverageCorpus(profile = {}) {
  const policies = normalizePolicies(profile.businessPolicies);
  const blobs = [];
  if (policies.delivery) blobs.push(policies.delivery);
  for (const loc of normalizeLocations(profile.businessLocations)) {
    if (loc.coverage_notes) blobs.push(loc.coverage_notes);
    if (loc.label) blobs.push(loc.label);
    if (loc.address) blobs.push(loc.address);
  }
  return new Set(blobs.flatMap(coverageTokens));
}

function settingsCountyText(profile = {}) {
  const policies = normalizePolicies(profile.businessPolicies);
  const blobs = [];
  if (policies.delivery) blobs.push(policies.delivery);
  for (const loc of normalizeLocations(profile.businessLocations)) {
    if (loc.coverage_notes) blobs.push(loc.coverage_notes);
  }
  return blobs.join(' ');
}

/**
 * unknown: no Train coverage text, or the place has no area token.
 * inside: a place token is in the coverage text, or its county is named
 * in Delivery or Coverage notes.
 * outside: coverage text exists and neither the place nor its county matches.
 * The office address can match a written name. It does not expand a county.
 */
function assessCoverage(text, profile = {}) {
  const selected = readCoverageAreas(profile.businessPolicies);
  const mentioned = coverageTokens(text);
  if (selected) {
    if (!mentioned.length || !selected.length) return 'unknown';
    return coveredByAreas(text, selected) ? 'inside' : 'outside';
  }
  const covered = coverageCorpus(profile);
  if (!covered.size) return 'unknown';
  if (!mentioned.length) return 'unknown';
  if (mentioned.some((token) => covered.has(token))) return 'inside';
  const allowed = countiesMentioned(settingsCountyText(profile));
  const placeCounties = countiesForPlace(text);
  if (placeCounties.some((county) => allowed.has(county))) return 'inside';
  return 'outside';
}

/**
 * Wave 1 ladder. Assumption A5: after one detail follow-up, area-only saves
 * only when coverage text matches. Outside never saves. Two refusals do not save.
 */
function decideVisitPlace(
  text,
  { profile = {}, detailAsked = false, refusals = 0 } = {}
) {
  const place = cleanPlace(text, 240);
  const quality = classifyVisitLocation(place);
  const coverage =
    quality === 'empty' || quality === 'refused'
      ? 'unknown'
      : assessCoverage(place, profile);
  const pinNote =
    Boolean(place) &&
    mentionsPin(place) &&
    quality !== 'empty' &&
    quality !== 'refused';

  if (quality === 'empty' || quality === 'refused') {
    if (Number(refusals) >= 2) {
      return {
        quality,
        coverage,
        ask: false,
        bookable: false,
        blocked: 'refused',
        confirmAccess: false,
        pinNote: false,
      };
    }
    return {
      quality,
      coverage,
      ask: true,
      bookable: false,
      blocked: '',
      confirmAccess: false,
      pinNote: false,
    };
  }

  if (coverage === 'outside') {
    return {
      quality,
      coverage,
      ask: false,
      bookable: false,
      blocked: 'outside',
      confirmAccess: false,
      pinNote,
    };
  }

  if (quality === 'findable') {
    return {
      quality,
      coverage,
      ask: false,
      bookable: true,
      blocked: '',
      confirmAccess: false,
      pinNote,
    };
  }

  if (!detailAsked) {
    return {
      quality,
      coverage,
      ask: true,
      bookable: false,
      blocked: '',
      confirmAccess: false,
      pinNote,
    };
  }

  if (coverage === 'inside') {
    return {
      quality,
      coverage,
      ask: false,
      bookable: true,
      blocked: '',
      confirmAccess: true,
      pinNote,
    };
  }

  return {
    quality,
    coverage,
    ask: false,
    bookable: false,
    blocked: 'unknown_coverage',
    confirmAccess: false,
    pinNote,
  };
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionsPlaceToken(text, place) {
  const token = placeWords(place).find((word) => word.length >= 4);
  if (!token) return false;
  return new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i').test(String(text || ''));
}

/**
 * A later "in Nairobi" must not replace a gate or building already heard.
 * An explicit correction ("not Runda, Karen gate") still replaces it.
 */
function preferVisitPlace(previous, incoming, text = '') {
  const prev = cleanPlace(previous, 240);
  const next = cleanPlace(incoming, 240);
  if (!next) return prev;
  if (!prev) return next;
  if (prev.toLowerCase() === next.toLowerCase()) return prev;
  if (
    /\b(?:not|instead|rather|badala|hapana|siyo|location is|landmark is|address is)\b/i.test(
      text
    )
  ) {
    return next;
  }
  const prevQuality = classifyVisitLocation(prev);
  const nextQuality = classifyVisitLocation(next);
  const specific =
    prevQuality === 'findable' || prevQuality === 'pin_promised';
  if (!specific || nextQuality !== 'area_only' || placeWords(next).length > 1) {
    return next;
  }
  const parentOfNext = new RegExp(
    `\\b(?:in|at|kwa)\\s+${escapeRegExp(next)}\\b`,
    'i'
  ).test(text);
  if (parentOfNext && mentionsPlaceToken(text, prev)) return prev;
  if (mentionsPlaceToken(prev, next)) return prev;
  return next;
}

function coverageAskPlace(text) {
  let value = String(text || '')
    .replace(/[?!.]+/g, ' ')
    .replace(/[—–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  value = value.replace(/^(?:(?:do you(?: guys)?|can you)\s+)+/i, 'do you ');
  const matched =
    /\bdo you\s+(?:do|cover|service|serve|come to|go to)\s+(.+)$/i.exec(value) ||
    /^(?:what|how) about\s+(.+)$/i.exec(value) ||
    /^(?:mnafika|mnaja|mnafanyia)\s+(.+)$/i.exec(value);
  if (!matched) return '';
  const place = matched[1].replace(/^(?:the|in|at|to)\s+/i, '').trim();
  if (!place || place.split(/\s+/).length > 4) return '';
  if (
    /\b(clean|cleaning|carpet|couch|sofa|mattress|fumigation|plumb|electric|team|price|hours|name)\b/i.test(
      place
    )
  ) {
    return '';
  }
  if (!placeWords(place).length) return '';
  return place;
}

/**
 * Home-services "do you cover X" / "what about X".
 * Settings text only. No model, no map.
 */
function coverageAskSpeech(text, profile = {}, language = 'en') {
  if (String(profile?.vertical || '').toLowerCase() !== 'home_services') return '';
  const place = coverageAskPlace(text);
  if (!place) return '';
  const coverage = assessCoverage(place, profile);
  const lang = String(language || 'en').toLowerCase();
  const sw = lang === 'sw' || lang.startsWith('swahili');
  const sheng = lang === 'sheng';
  if (coverage === 'inside') {
    if (sw) return `Ndiyo, tunafika ${place}.`;
    if (sheng) return `Ndio, tunafika ${place}.`;
    return `Yes, we cover ${place}.`;
  }
  if (coverage === 'outside') return visitBlockSpeech('outside', language);
  return visitBlockSpeech('unknown_coverage', language);
}

function visitBlockSpeech(blocked, language = 'en') {
  const lang = String(language || 'en').toLowerCase();
  const sw = lang === 'sw' || lang.startsWith('swahili');
  const sheng = lang === 'sheng';
  if (blocked === 'outside') {
    if (sw) return 'Eneo hilo liko nje. Ninaweza kuandika callback.';
    if (sheng) return 'Hiyo area iko nje. Naweza andika callback.';
    return 'That area is outside our coverage. I can note a callback.';
  }
  if (blocked === 'unknown_coverage') {
    if (sw) return 'Sina orodha ya maeneo. Ninaweza kuandika hii kwa timu.';
    if (sheng) return 'Sina list ya area. Naweza andika hii kwa team.';
    return "I don't have our coverage list on file. I can note this for the team.";
  }
  return '';
}

function appendVisitNotes(notes, decision = {}) {
  let next = cleanPlace(notes, 400);
  if (decision.confirmAccess && !/confirm access/i.test(next)) {
    next = next ? `${next}. ${CONFIRM_ACCESS_NOTE}` : CONFIRM_ACCESS_NOTE;
  }
  if (decision.pinNote && !/share pin/i.test(next)) {
    const pin = 'caller will share pin';
    next = next ? `${next}. ${pin}` : pin;
  }
  return next.slice(0, 400);
}

module.exports = {
  CONFIRM_ACCESS_NOTE,
  readVisitPlace,
  isLocationRefusal,
  mentionsPin,
  classifyVisitLocation,
  assessCoverage,
  decideVisitPlace,
  preferVisitPlace,
  visitBlockSpeech,
  coverageAskPlace,
  coverageAskSpeech,
  appendVisitNotes,
};
