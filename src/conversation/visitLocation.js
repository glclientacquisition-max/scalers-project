// Home-visit place quality. Speech says location. Storage stays the landmark field.
// A saved Coverage directory is the service area. A county covers its localities.
// Delivery text is timing and other instructions. Until a directory is saved,
// Delivery and Coverage notes still apply. The office address does not. No geocoder.

const { normalizePolicies } = require('./businessPolicies');
const { normalizeLocations } = require('./businessLocations');
const {
  bindSpokenPlace,
  canonicalPlaceName,
  countiesMentioned,
  countiesForPlace,
  nearestAllowedPlace,
  placesInCounties,
} = require('./kenyaPlaces');
const { coveredByAreas, readCoverageAreas } = require('./coverageAreas');

const CONFIRM_ACCESS_NOTE = 'confirm access';
const AREA_UNCONFIRMED_NOTE = 'area not confirmed, check coverage';

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
  // Outside means the place is known and sits elsewhere. A landmark nobody
  // can place ("near Naivas") is unknown; the ladder confirms, never refuses.
  if (selected) {
    if (!mentioned.length || !selected.length) return 'unknown';
    if (coveredByAreas(text, selected)) return 'inside';
    return countiesForPlace(text).length ? 'outside' : 'unknown';
  }
  const covered = coverageCorpus(profile);
  if (!covered.size) return 'unknown';
  if (!mentioned.length) return 'unknown';
  if (mentioned.some((token) => covered.has(token))) return 'inside';
  const allowed = countiesMentioned(settingsCountyText(profile));
  const placeCounties = countiesForPlace(text);
  if (!placeCounties.length) return 'unknown';
  if (placeCounties.some((county) => allowed.has(county))) return 'inside';
  return 'outside';
}

/**
 * Wave 1 ladder. Assumption A5: after one detail follow-up, area-only saves
 * only when coverage text matches. Outside never saves. Two refusals do not save.
 */
function hasCoverageText(profile = {}) {
  const selected = readCoverageAreas(profile.businessPolicies);
  if (selected) return selected.length > 0;
  return coverageCorpus(profile).size > 0;
}

function decideVisitPlace(
  text,
  { profile = {}, detailAsked = false, areaAsked = false, refusals = 0 } = {}
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

  // A landmark with no area ("near the big church") when coverage is on file:
  // ask which area once. Never refuse it, never book it blind.
  if (
    coverage === 'unknown' &&
    (quality === 'findable' || quality === 'pin_promised') &&
    !areaAsked &&
    hasCoverageText(profile)
  ) {
    return {
      quality,
      coverage,
      ask: true,
      askArea: true,
      bookable: false,
      blocked: '',
      confirmAccess: false,
      pinNote,
    };
  }

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
      areaUnconfirmed: coverage === 'unknown' && hasCoverageText(profile),
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
function displayPlaceName(key) {
  return String(key || '').replace(/(^|[\s-])[a-z]/g, (letter) => letter.toUpperCase());
}

function areaKey(place) {
  const parts = String(place || '')
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const name = canonicalPlaceName(parts[i]);
    if (name) return name;
  }
  return '';
}

function dropPlaceClause(part) {
  if (/^(?:shy|yeah|yep|uh|um|ok|okay|great)$/i.test(part)) return true;
  if (/\bis (?:okay|ok|fine)\b/i.test(part)) return true;
  if (/^\d{1,2}(?::\d{2})?(?:\s*(?:a\.?m\.?|p\.?m\.?))?$/i.test(part)) return true;
  return false;
}

/**
 * Counties and places this tenant actually serves, plus the other places in
 * those counties, so a misheard neighbour can bind without searching Kenya.
 */
function coverageNeighbourNames(profile = {}) {
  const selected = readCoverageAreas(profile.businessPolicies);
  const counties = new Set();
  const names = new Set();
  if (selected && selected.length) {
    for (const id of selected) {
      const split = id.indexOf(':');
      const kind = id.slice(0, split);
      const name = id.slice(split + 1);
      if (kind === 'county') counties.add(name);
      if (kind === 'place') names.add(name);
    }
  } else if (selected == null) {
    for (const token of coverageCorpus(profile)) {
      if (countiesForPlace(token).length && !token.includes(' ')) {
        const exact = canonicalPlaceName(token);
        if (exact) names.add(exact);
      }
    }
  }
  for (const name of names) {
    for (const county of countiesForPlace(name)) counties.add(county);
  }
  for (const name of placesInCounties(counties)) names.add(name);
  return names;
}

/**
 * A clipped token ("Ronga") becomes the Kenya name ("Rongai") before coverage.
 * A misheard neighbour ("Rwangai") binds only inside this tenant's coverage
 * counties. A building does not drop that area. A clock clause is not a place.
 */
function foldCanonicalPlace(place, profile) {
  const raw = cleanPlace(place, 240);
  if (!raw) return raw;
  const allowed = profile ? coverageNeighbourNames(profile) : null;
  const folded = raw
    .split(/\s*,\s*/)
    .map((part) => part.trim())
    .filter((part) => part && !dropPlaceClause(part))
    .map((token) => {
      const names = bindSpokenPlace(token);
      const words = token
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
      const joined = words.join('');
      const spaced = words.join(' ');
      if (
        names.length === 1 &&
        (names[0] === joined || names[0] === spaced)
      ) {
        return { text: displayPlaceName(names[0]), bound: true };
      }
      if (/\s/.test(token)) return { text: token, bound: false };
      const name =
        allowed && allowed.size
          ? nearestAllowedPlace(token, allowed)
          : canonicalPlaceName(token);
      return name
        ? { text: displayPlaceName(name), bound: true }
        : { text: token, bound: false };
    });
  const anyBound = folded.some((row) => row.bound);
  return folded
    .filter((row) => row.bound || !anyBound || /\s/.test(row.text))
    .map((row) => row.text)
    .join(', ');
}

function preferVisitPlace(previous, incoming, text = '') {
  const prev = cleanPlace(previous, 240);
  const next = cleanPlace(incoming, 240);
  if (!next) return prev;
  if (!prev) return next;
  if (prev.toLowerCase() === next.toLowerCase()) return prev;
  const prevArea = areaKey(prev);
  const nextArea = areaKey(next);
  if (prevArea && !nextArea && classifyVisitLocation(next) === 'findable') {
    return `${next}, ${displayPlaceName(prevArea)}`;
  }
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
  value = value.replace(/^(?:(?:like|eh|eeh|oh|ah|uh|um)\s*,?\s*)+/i, '');
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
  if (isNoisePlace(place)) return '';
  return place;
}

/** Trailing STT such as "over" is not a visit place. */
function isNoisePlace(place) {
  const words = String(place || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return false;
  return words.every((word) => word.length < 3 || COVERAGE_STOP.has(word));
}

/**
 * Home-services "do you cover X" / "what about X".
 * Settings text only. No model, no map.
 */
function coverageAskSpeech(text, profile = {}, language = 'en') {
  if (String(profile?.vertical || '').toLowerCase() !== 'home_services') return '';
  const rawPlace = coverageAskPlace(text);
  if (!rawPlace) return '';
  const place = foldCanonicalPlace(rawPlace, profile) || rawPlace;
  const coverage = assessCoverage(place, profile);
  const lang = String(language || 'en').toLowerCase();
  const sw = lang === 'sw' || lang.startsWith('swahili');
  const sheng = lang === 'sheng';
  if (coverage === 'inside') {
    if (sw) return `Ndiyo, tunafika ${place}.`;
    if (sheng) return `Ndio, tunafika ${place}.`;
    return `Yes, we cover ${place}.`;
  }
  if (coverage === 'outside') return outsideCoverageSpeech(language);
  if (hasCoverageText(profile)) return unsureCoverageSpeech(language);
  return visitBlockSpeech('unknown_coverage', language);
}

function coverageNoteQuestion(language = 'en') {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sheng') return 'Naweza andika hii kwa team?';
  if (lang === 'sw' || lang.startsWith('swahili')) {
    return 'Naweza kukuachia ujumbe kwa timu yetu?';
  }
  return 'Should I note it for the team?';
}

/** Out of area, then the note question in the caller's language. */
function outsideCoverageSpeech(language = 'en') {
  const fact = visitBlockSpeech('outside', language).replace(/[.?!]\s*$/, '');
  return `${fact}. ${coverageNoteQuestion(language)}`;
}

/** The list is on file. The place is not on it, and we do not say the list is missing. */
function unsureCoverageSpeech(language = 'en') {
  const lang = String(language || 'en').toLowerCase();
  const ask = coverageNoteQuestion(language);
  if (lang === 'sheng') return `Sina uhakika kama tunafika hiyo area. ${ask}`;
  if (lang === 'sw' || lang.startsWith('swahili')) {
    return `Sina uhakika kama tunafika hapo. ${ask}`;
  }
  return `I'm not sure we cover that area. ${ask}`;
}

function visitBlockSpeech(blocked, language = 'en') {
  const lang = String(language || 'en').toLowerCase();
  const sw = lang === 'sw' || lang.startsWith('swahili');
  const sheng = lang === 'sheng';
  if (blocked === 'outside') {
    if (sw) return 'Eneo hilo liko nje.';
    if (sheng) return 'Hiyo area iko nje.';
    return 'That area is outside our coverage.';
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
  if (decision.areaUnconfirmed && !/area not confirmed/i.test(next)) {
    next = next ? `${next}. ${AREA_UNCONFIRMED_NOTE}` : AREA_UNCONFIRMED_NOTE;
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
  hasCoverageText,
  decideVisitPlace,
  preferVisitPlace,
  foldCanonicalPlace,
  visitBlockSpeech,
  outsideCoverageSpeech,
  unsureCoverageSpeech,
  coverageAskPlace,
  coverageAskSpeech,
  isNoisePlace,
  appendVisitNotes,
};
