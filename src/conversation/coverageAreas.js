// Picked service areas. A county id covers localities in that county.
// A place id covers that name only. Plain Delivery text is not this list.

const INDEX = require('./data/kenyaPlaceCounties.json');
const { countiesForPlace, normalizePlaceKey } = require('./kenyaPlaces');

const MAX_AREAS = 40;
const COUNTY_SET = new Set(INDEX.counties);

function titleName(name) {
  if (name === 'muranga') return "Murang'a";
  return String(name || '').replace(/\b[a-z]+/g, (word) =>
    word === 'cbd' ? 'CBD' : word.charAt(0).toUpperCase() + word.slice(1)
  );
}

function parseCoverageAreas(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const id = String(item || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
    const split = id.indexOf(':');
    if (split < 1) continue;
    const kind = id.slice(0, split);
    const name = id.slice(split + 1);
    if (kind === 'county' && !COUNTY_SET.has(name)) continue;
    if (kind === 'place' && (!INDEX.places[name] || COUNTY_SET.has(name))) continue;
    if (kind !== 'county' && kind !== 'place') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_AREAS) break;
  }
  return out;
}

/**
 * null: the owner has not saved a directory yet (plain text still applies).
 * array: the directory is the service area, including an empty list.
 * @param {unknown} policies
 * @returns {string[] | null}
 */
function readCoverageAreas(policies) {
  let obj = policies;
  if (typeof policies === 'string') {
    try {
      obj = JSON.parse(policies);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  if (!Object.prototype.hasOwnProperty.call(obj, 'coverage_areas')) return null;
  if (!Array.isArray(obj.coverage_areas)) return null;
  return parseCoverageAreas(obj.coverage_areas);
}

/** Spoken town names of the configured coverage, e.g. ["Kitengela", "Nairobi"]. */
function coverageAreaNames(policies) {
  return (readCoverageAreas(policies) || []).map((id) => titleName(id.slice(id.indexOf(':') + 1)));
}

function formatCoverageList(areas) {
  return parseCoverageAreas(areas)
    .map((id) => titleName(id.slice(id.indexOf(':') + 1)))
    .join(', ');
}

/**
 * @param {string} text
 * @param {string[]} areas parsed ids
 */
function coveredByAreas(text, areas) {
  const selected = parseCoverageAreas(areas);
  const counties = new Set();
  const places = new Set();
  for (const id of selected) {
    const split = id.indexOf(':');
    const kind = id.slice(0, split);
    const name = id.slice(split + 1);
    if (kind === 'county') counties.add(name);
    else places.add(name);
  }
  const phrase = normalizePlaceKey(text);
  if (!phrase) return false;
  if (places.has(phrase)) return true;
  const tokens = phrase.split(' ').filter((word) => word.length >= 4);
  for (let i = 0; i < tokens.length; i += 1) {
    if (places.has(tokens[i])) return true;
    if (i + 1 < tokens.length && places.has(`${tokens[i]} ${tokens[i + 1]}`)) return true;
  }
  if (!counties.size) return false;
  return countiesForPlace(text).some((county) => counties.has(county));
}

module.exports = {
  parseCoverageAreas,
  readCoverageAreas,
  coverageAreaNames,
  formatCoverageList,
  coveredByAreas,
};
