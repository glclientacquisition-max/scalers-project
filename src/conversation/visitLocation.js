// Home-visit place quality. Speech says location. Storage stays the landmark field.
// Coverage is Train text only (POLICIES delivery + LOCATIONS label/address/coverage).
// No geocoder.

const { normalizePolicies } = require('./businessPolicies');
const { normalizeLocations } = require('./businessLocations');

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

/**
 * unknown: no Train coverage text, or the place has no area token.
 * inside: a place token appears in POLICIES/LOCATIONS coverage text.
 * outside: coverage text exists and none of the place tokens match.
 * Shop landmark/directions are not coverage.
 */
function assessCoverage(text, profile = {}) {
  const covered = coverageCorpus(profile);
  if (!covered.size) return 'unknown';
  const mentioned = coverageTokens(text);
  if (!mentioned.length) return 'unknown';
  if (mentioned.some((token) => covered.has(token))) return 'inside';
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
  appendVisitNotes,
};
