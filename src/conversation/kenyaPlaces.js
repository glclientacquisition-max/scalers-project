// Locality and area names to county. Built from kenya-locations (MIT, David Amunga, 2025).
// https://github.com/davidamunga/kenya-locations
// Used to read "Nairobi" in Train as the estates inside that county. No live map.

const INDEX = require('./data/kenyaPlaceCounties.json');

const PLACE_KEYS = Object.keys(INDEX.places);
const COUNTIES = INDEX.counties.slice().sort((a, b) => b.length - a.length);

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
  const names = oneEditNames(key);
  if (names.length === 1) return names[0];
  const prefixed = names.filter((name) => name.startsWith(key) && name.length === key.length + 1);
  return prefixed.length === 1 ? prefixed[0] : '';
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
 * Counties for a caller place. Exact names always. A one-letter miss only when
 * the whole place is a single word and that word is not already in the list.
 * Two names within one edit means no guess.
 * @returns {string[]}
 */
function countiesForPlace(text) {
  const phrase = normalizePlaceKey(text);
  if (!phrase) return [];
  const found = new Set(INDEX.places[phrase] || []);
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
  countiesMentioned,
  countiesForPlace,
};
