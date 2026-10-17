// VOICE_BUSINESS_PLACES (default off): the business's own address,
// landmarks and their curated aliases are trusted places in the speech guard.
//
// Aris HD_c427511e5773 t3/t4: the file says "Inside UON premises" and "Along
// State house road-ground floor Hall 7"; the model said "inside the University
// of Nairobi premises". "University" (a gazetteer locality in Kisii and Uasin
// Gishu) and "Nairobi" did not bind in the raw file text, so the guard dropped
// the correct address twice as unbound_place.
//
// A place becomes trusted only through the tenant's own location rows:
//   - an alias row (data/kenyaPlaceAliases.json) one of whose forms is in a
//     location row: every form of that row is masked in agent speech, and its
//     county is trusted;
//   - a place that binds in a location row (unmasked, exact binder): the
//     counties it sits in are trusted ("State house road" -> nairobi).
// The business name and coverage notes are not a place source ("Aris Kenya"
// binds "kenya", a Kisumu locality). Model output never adds a place.
//
// Unset or off (process.env.VOICE_BUSINESS_PLACES) keeps the 8ee9b161 guard.

const { normalizeLocations } = require('./businessLocations');
const { bindSpokenPlace, countiesForPlace } = require('./kenyaPlaces');
const ALIASES = require('./data/kenyaPlaceAliases.json').aliases;

const ON = /^(1|true|on|yes)$/i;

function businessPlacesEnabled(env = process.env) {
  return ON.test(String(env.VOICE_BUSINESS_PLACES || '').trim());
}

function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// "U.O.N" / "U. O. N." read as "UON".
function collapseDottedAcronyms(text) {
  return String(text || '').replace(/\b(?:[A-Z]\.\s?){2,}/g, (m) => m.replace(/[.\s]/g, '') + ' ');
}

function isAcronym(form) {
  return /^[A-Za-z]{2,6}$/.test(form) && /[A-Z].*[A-Z]/.test(form) && form.length <= 6 && !/\s/.test(form);
}

// An acronym ("KU", "TUM") matches case-sensitively, so Kiswahili "ku" or
// "tum" never counts; a multiword or proper form matches case-insensitively.
function formPattern(form) {
  const words = String(form).trim().split(/\s+/).map(escapeRe);
  const body = words.join('[\\s,-]+');
  return isAcronym(form) ? new RegExp(`\\b${body}\\b`, 'g') : new RegExp(`\\b${body}\\b`, 'gi');
}

const ALIAS_ROWS = ALIASES.map((row) => ({
  county: String(row.county || '').toLowerCase(),
  forms: (row.forms || []).map(String).filter(Boolean),
  patterns: (row.forms || []).map((form) => ({ form: String(form), re: formPattern(form) })),
}));

function locationTexts(profile = {}) {
  const out = [];
  for (const row of normalizeLocations(profile?.businessLocations)) {
    for (const key of ['label', 'address', 'landmark', 'directions']) {
      if (row[key]) out.push(row[key]);
    }
  }
  return out;
}

const cache = new WeakMap();

/**
 * Trusted business places for one profile.
 * @param {object} profile
 * @returns {{ phrases: string[], patterns: RegExp[], names: Set<string>, counties: Set<string>, sources: Map<string,string> }}
 */
function businessPlacesFor(profile) {
  if (!profile || typeof profile !== 'object') return emptyPlaces();
  const hit = cache.get(profile);
  const key = JSON.stringify(profile.businessLocations || null);
  if (hit && hit.key === key) return hit.value;
  const texts = locationTexts(profile).map(collapseDottedAcronyms);
  const value = emptyPlaces();
  if (texts.length) {
    const blob = texts.join(' \n ');
    for (const row of ALIAS_ROWS) {
      const present = row.patterns.some(({ re }) => {
        re.lastIndex = 0;
        return re.test(blob);
      });
      if (!present) continue;
      for (const { form, re } of row.patterns) {
        value.phrases.push(form);
        value.patterns.push(re);
      }
      if (row.county) {
        value.counties.add(row.county);
        for (const name of bindSpokenPlace(row.county)) {
          value.names.add(name);
          value.sources.set(name, 'business_alias');
        }
      }
    }
    for (const text of texts) {
      for (const place of bindSpokenPlace(text)) {
        if (!value.sources.has(place)) value.sources.set(place, 'business_file');
        value.names.add(place);
        for (const county of countiesForPlace(place)) {
          value.counties.add(county);
          for (const name of bindSpokenPlace(county)) {
            value.names.add(name);
            if (!value.sources.has(name)) value.sources.set(name, 'business_county');
          }
        }
      }
    }
    // Longest form first so "Jomo Kenyatta University of Agriculture and
    // Technology" masks before "Jomo Kenyatta University".
    const order = value.phrases.map((p, i) => [p, value.patterns[i]]).sort((a, b) => b[0].length - a[0].length);
    value.phrases = order.map((x) => x[0]);
    value.patterns = order.map((x) => x[1]);
  }
  cache.set(profile, { key, value });
  return value;
}

function emptyPlaces() {
  return { phrases: [], patterns: [], names: new Set(), counties: new Set(), sources: new Map() };
}

/**
 * The sentence with the business's own alias phrases removed, for the place
 * check only. Returns which phrases were masked.
 */
function maskBusinessPlaces(sentence, places) {
  let text = collapseDottedAcronyms(sentence);
  const masked = [];
  for (const re of places?.patterns || []) {
    re.lastIndex = 0;
    if (re.test(text)) {
      re.lastIndex = 0;
      masked.push(re.source);
      text = text.replace(re, ' ');
    }
  }
  return { text: text.replace(/\s+/g, ' ').trim(), masked: masked.length > 0 };
}

// "Where are you located?", "Mko wapi?", "where can I find you", "location yenu".
const LOCATION_ASK =
  /\b(where\s+(?:are|r)\s+(?:you|u|y'?all)(?:\s+(?:guys|located|based|at))?|where\s+(?:is|'s)\s+(?:your|the)\s+(?:shop|store|office|outlet|location|place|business)|where\s+(?:can|do|could|should)\s+i\s+(?:find|get\s+to|reach|visit|come\s+to|pick\s+up)\s*(?:you)?|(?:your|the)\s+(?:location|address|physical\s+(?:shop|location|address))|located|directions?\s+to|m(?:ko|po|nako|napatikana)\s+wapi|uko\s+wapi|mpo\s+wapi|location\s+(?:yenu|yako)|duka\s+(?:lenu|liko)\s+wapi|ofisi\s+(?:yenu|iko)\s+wapi|mnapatikana)\b/i;

function callerAsksLocation(text) {
  return LOCATION_ASK.test(String(text || ''));
}

const LEAD_PREPOSITION = /^(?:Inside|Along|Opposite|Next|Near|Behind|At|On|Off|Within|Ndani|Karibu|Mkabala|Nyuma)\b/;

/**
 * The file's own landmark and directions, verbatim, as one line.
 * '' when the file has neither.
 */
function locationFactLine(profile = {}, language = 'en') {
  const rows = normalizeLocations(profile?.businessLocations);
  const row = rows.find((r) => r.landmark || r.directions) || null;
  if (!row) return '';
  const parts = [row.landmark, row.directions]
    .map((p) => String(p || '').replace(/\s+/g, ' ').replace(/[.;,\s]+$/, '').trim())
    .filter(Boolean)
    .map((p) => p.replace(LEAD_PREPOSITION, (w) => w.toLowerCase()));
  if (!parts.length) return '';
  const lang = String(language || 'en').toLowerCase();
  const body = parts.join(', ');
  if (lang.startsWith('sw') || lang === 'sheng') return `Tunapatikana hapa: ${body}.`;
  return `You can find us here: ${body}.`;
}

module.exports = {
  businessPlacesEnabled,
  businessPlacesFor,
  maskBusinessPlaces,
  callerAsksLocation,
  locationFactLine,
  collapseDottedAcronyms,
};
