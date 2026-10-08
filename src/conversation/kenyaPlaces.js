// Locality and area names to county. Built from kenya-locations (MIT, David Amunga, 2025).
// https://github.com/davidamunga/kenya-locations
// Used to read "Nairobi" in Train as the estates inside that county. No live map.

const INDEX = require('./data/kenyaPlaceCounties.json');

const PLACE_KEYS = Object.keys(INDEX.places);
const COUNTIES = INDEX.counties.slice().sort((a, b) => b.length - a.length);

// "OngataRongai" is the spaced place with the gap removed. Two places that
// compact to the same token stay unbound.
const JOINED_PLACES = new Map();
for (const name of PLACE_KEYS) {
  if (!name.includes(' ')) continue;
  const compact = name.replace(/\s+/g, '');
  if (!compact || INDEX.places[compact]) continue;
  JOINED_PLACES.set(compact, JOINED_PLACES.has(compact) ? '' : name);
}

function joinedPlaceName(word) {
  if (!word || word.length < 6) return '';
  return JOINED_PLACES.get(word) || '';
}

// "Nairobini" / "Nakuruni" are the place plus the locative -ni.
// A 4-letter stem stays out, so "mara" is not read out of "marani".
function locativePlaceName(word) {
  if (!word || !word.endsWith('ni') || word.length < 7 || INDEX.places[word]) return '';
  const stem = word.slice(0, -2);
  if (stem.length >= 5 && INDEX.places[stem]) return stem;
  return joinedPlaceName(stem);
}

function exactSpokenPlace(word) {
  if (!word) return '';
  if (word.length >= 5 && INDEX.places[word]) return word;
  return joinedPlaceName(word) || locativePlaceName(word);
}

function normalizePlaceKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let diffs = 0;
    for (let i = 0; i < la; i += 1) {
      if (a[i] !== b[i] && ++diffs > 1) return false;
    }
    return diffs === 1;
  }
  const shorter = la < lb ? a : b;
  const longer = la < lb ? b : a;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
      j += 1;
    }
  }
  return true;
}

function countiesForToken(token) {
  const key = normalizePlaceKey(token);
  if (!key || key.length < 4 || key.includes(' ')) return [];
  return INDEX.places[key] || [];
}

function oneEditNames(key) {
  const names = [];
  for (const name of PLACE_KEYS) {
    if (name.includes(' ') || Math.abs(name.length - key.length) > 1) continue;
    if (!withinOneEdit(key, name)) continue;
    names.push(name);
  }
  return names;
}

// Everyday words. A one-edit guess from these is not a place
// ("huduma" is not Huruma, "nyumba" is not Ngumba, "hello" is not Hells,
// "ndani" is not Ndanai, "kwako" is not Kako, "ukubwa" is not Kubwa).
// scripts/data/kenyanWordlists.js is personal names and places, not this list.
// Clipped place names stay fuzzy ("Ronga" -> Rongai, "rwaka" -> Ruaka).
const SPOKEN_EVERYDAY = new Set([
  'about',
  'asante',
  'clean',
  'close',
  'couch',
  'could',
  'elfu',
  'habari',
  'hapana',
  'hello',
  'house',
  'huduma',
  'kesho',
  'kwako',
  'kwangu',
  'kwani',
  'kusafisha',
  'kwaheri',
  'leo',
  'money',
  'msaada',
  'naomba',
  'nataka',
  'naweza',
  'ndani',
  'ndiyo',
  'ninaomba',
  'nisaidie',
  'nyumba',
  'ofisi',
  'offer',
  'phone',
  'please',
  'price',
  'reach',
  'right',
  'samahani',
  'shida',
  'should',
  'start',
  'still',
  'tafadhali',
  'tano',
  'thanks',
  'there',
  'these',
  'those',
  'today',
  'tuna',
  'ukubwa',
  'usafi',
  'water',
  'which',
  'would',
  'zetu',
]);

/**
 * One-edit place, or nothing.
 * Common Kiswahili and other short everyday words are never a fuzzy place.
 * @param {string} key
 * @returns {string}
 */
function oneEditPlaceName(key) {
  if (SPOKEN_EVERYDAY.has(key)) return '';
  const names = oneEditNames(key);
  if (names.length === 1) return names[0];
  const prefixed = names.filter((name) => name.startsWith(key) && name.length === key.length + 1);
  return prefixed.length === 1 ? prefixed[0] : '';
}

/**
 * Exact place, or the one Kenya name a clipped token points at.
 * "Ronga" is a prefix of Rongai only, so the cut-off letter still binds.
 * Two substitutions (rongae → rongai and ronge) stay unknown.
 * @returns {string}
 */
function canonicalPlaceName(token) {
  const key = normalizePlaceKey(token);
  if (!key || key.includes(' ') || key.length < 5) return '';
  if (INDEX.places[key]) return key;
  return oneEditPlaceName(key);
}

function editDistance(a, b) {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 2) return 3;
  let prev = new Array(lb + 1);
  let cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j += 1) prev[j] = j;
  for (let i = 1; i <= la; i += 1) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > 2) return 3;
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[lb];
}

/** Place names whose county is in the set. Used to hear a misheard neighbour. */
function placesInCounties(counties) {
  const wanted = counties instanceof Set ? counties : new Set(counties || []);
  const names = [];
  if (!wanted.size) return names;
  for (const name of PLACE_KEYS) {
    const list = INDEX.places[name];
    if (!list) continue;
    for (const county of list) {
      if (wanted.has(county)) {
        names.push(name);
        break;
      }
    }
  }
  return names;
}

/**
 * Exact or one-edit name, or the one allowed name within two edits.
 * "Rwangai" binds to Rongai only when Rongai is in the allowed set.
 * Two allowed names at that distance stay unbound.
 * @param {string} token
 * @param {Set<string> | string[] | null} allowedNames
 */
function nearestAllowedPlace(token, allowedNames) {
  const key = normalizePlaceKey(token);
  if (!key || key.includes(' ') || key.length < 5) return '';
  if (SPOKEN_EVERYDAY.has(key) && !INDEX.places[key]) return '';
  const allowed = allowedNames instanceof Set ? allowedNames : new Set(allowedNames || []);
  const edits = oneEditNames(key);
  if (edits.length > 1) {
    const prefixed = edits.filter(
      (name) => name.startsWith(key) && name.length === key.length + 1
    );
    return prefixed.length === 1 ? prefixed[0] : '';
  }
  const exact = canonicalPlaceName(key);
  if (exact) {
    const prefix = exact.startsWith(key) && exact.length === key.length + 1;
    const listed = Boolean(INDEX.places[key]);
    if (listed || prefix) return exact;
    return !allowed.size || allowed.has(exact) ? exact : '';
  }
  if (!allowed.size) return '';
  let hit = '';
  for (const name of allowed) {
    if (name.includes(' ') || Math.abs(name.length - key.length) > 2) continue;
    if (editDistance(key, name) > 2) continue;
    if (hit) return '';
    hit = name;
  }
  return hit;
}

function fuzzyCounties(token) {
  const key = normalizePlaceKey(token);
  if (!key || key.length < 5 || key.includes(' ') || INDEX.places[key]) return [];
  const name = canonicalPlaceName(key);
  return name ? INDEX.places[name] || [] : [];
}

/**
 * Counties named in Delivery or Coverage text. Office address is not a county.
 * @returns {Set<string>}
 */
function countiesMentioned(text) {
  const blob = ` ${normalizePlaceKey(text)} `;
  const hits = new Set();
  for (const county of COUNTIES) {
    if (blob.includes(` ${county} `)) hits.add(county);
  }
  return hits;
}

/**
 * Place names in speech. A Kiswahili split ("na kuru" is Nakuru), a joined
 * token ("OngataRongai" is Ongata Rongai), and a locative -ni ("Nairobini")
 * bind to the place. Everyday words stay out. This does not fuzzy-match them.
 * @param {string} text
 * @param {{ fuzzy?: boolean }} [opts] fuzzy is the speech-guard word pass.
 * Coverage uses the exact join only, so "stage" does not become State.
 * A 4-letter county ("mara", and the tenant place Juja) stays off this pass.
 * @returns {string[]}
 */
function bindSpokenPlace(text, opts = {}) {
  const fuzzy = Boolean(opts.fuzzy);
  const words = normalizePlaceKey(text).split(' ').filter(Boolean);
  const found = [];
  let i = 0;
  while (i < words.length) {
    let hit = '';
    let span = 1;
    const max = Math.min(3, words.length - i);
    for (let len = max; len >= 2; len -= 1) {
      const slice = words.slice(i, i + len);
      const spaced = slice.join(' ');
      const joined = slice.join('');
      if (INDEX.places[spaced]) {
        hit = spaced;
        span = len;
        break;
      }
      const compact = exactSpokenPlace(joined);
      if (compact) {
        hit = compact;
        span = len;
        break;
      }
    }
    if (!hit) {
      const exact = exactSpokenPlace(words[i]);
      if (exact) {
        hit = exact;
        span = 1;
      } else if (fuzzy) {
        const one = canonicalPlaceName(words[i]);
        if (one) {
          hit = one;
          span = 1;
        }
      }
    }
    if (hit) found.push(hit);
    i += span;
  }
  return found;
}

/**
 * Counties for a caller place. Exact names always. A one-letter miss only when
 * the whole place is a single word and that word is not already in the list.
 * Two names within one edit means no guess. A split name ("na kuru") binds
 * to the joined Kenya place before the county check.
 * @returns {string[]}
 */
function countiesForPlace(text) {
  const phrase = normalizePlaceKey(text);
  if (!phrase) return [];
  const found = new Set(INDEX.places[phrase] || []);
  for (const name of bindSpokenPlace(phrase)) {
    for (const county of INDEX.places[name] || []) found.add(county);
  }
  const tokens = phrase.split(' ').filter((word) => word.length >= 4);
  for (let i = 0; i < tokens.length; i += 1) {
    for (const county of countiesForToken(tokens[i])) found.add(county);
    if (i + 1 < tokens.length) {
      const pair = `${tokens[i]} ${tokens[i + 1]}`;
      for (const county of INDEX.places[pair] || []) found.add(county);
    }
  }
  if (!found.size && !phrase.includes(' ')) {
    for (const county of fuzzyCounties(phrase)) found.add(county);
  }
  return [...found];
}

module.exports = {
  normalizePlaceKey,
  canonicalPlaceName,
  bindSpokenPlace,
  placesInCounties,
  nearestAllowedPlace,
  countiesMentioned,
  countiesForPlace,
};
