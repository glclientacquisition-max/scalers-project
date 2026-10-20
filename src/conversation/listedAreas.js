'use strict';
// One listed-area list for every shop. Desk writes Locations to
// service_areas / areaTerms / serviceAreas / coverage_areas. The mouth
// must read all four. An empty camel bag used to mark Kileleshwa unlisted.

const { coverageAreaNames } = require('./coverageAreas');

function titleName(name) {
  if (name === 'muranga') return "Murang'a";
  return String(name || '').replace(/\b[a-z]+/g, (word) =>
    word === 'cbd' ? 'CBD' : word.charAt(0).toUpperCase() + word.slice(1)
  );
}

function asAreas(bag) {
  if (!bag) return [];
  if (Array.isArray(bag)) return bag;
  if (Array.isArray(bag.areas)) return bag.areas;
  return [];
}

function slugOf(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return '';
  const tail = text.includes(':') ? text.slice(text.indexOf(':') + 1) : text;
  return tail.replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function listedAreaRows(profile = {}) {
  const seen = new Set();
  const rows = [];
  const bags = [profile.serviceAreas, profile.areaTerms, profile.service_areas];
  for (const bag of bags) {
    for (const item of asAreas(bag)) {
      const raw = typeof item === 'string' ? item : String((item && (item.id || item.name)) || '').trim();
      const slug = slugOf(raw);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      rows.push({ id: raw, slug, name: titleName(slug), county: raw.toLowerCase().startsWith('county:') });
    }
  }
  for (const name of coverageAreaNames(profile.businessPolicies || {})) {
    const slug = slugOf(name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    rows.push({ id: name, slug, name: titleName(slug), county: false });
  }
  return rows;
}

function listedAreaIds(profile = {}) {
  return listedAreaRows(profile).map((row) => row.slug);
}

function listedAreaNames(profile = {}) {
  return listedAreaRows(profile).filter((row) => !row.county).map((row) => row.name);
}

function listedAreaKeys(profile = {}) {
  const names = new Set();
  const counties = new Set();
  for (const row of listedAreaRows(profile)) {
    if (row.county) counties.add(row.slug);
    else names.add(row.slug);
  }
  return { names, counties };
}

function listedAreaFee(profile = {}, place) {
  const slug = slugOf(place);
  if (!slug) return null;
  const listed = listedAreaRows(profile).some((row) => row.slug === slug);
  const bags = [profile.serviceAreas, profile.areaTerms, profile.service_areas];
  let terms = null;
  for (const bag of bags) {
    for (const item of asAreas(bag)) {
      if (!item || typeof item !== 'object') continue;
      if (slugOf(item.id || item.name) !== slug) continue;
      const trusted = item.source === 'owner' && item.confirmed === true;
      const feeMode = String(item.fee_mode || 'ask');
      const n = Number(item.fee_ksh);
      terms = {
        trusted,
        feeMode: trusted ? feeMode : 'ask',
        feeKsh: trusted && feeMode === 'fixed' && Number.isInteger(n) ? n : null,
      };
      break;
    }
    if (terms) break;
  }
  return {
    listed,
    name: titleName(slug),
    trusted: Boolean(terms?.trusted),
    feeMode: terms?.feeMode || 'ask',
    feeKsh: terms?.feeKsh ?? null,
  };
}

module.exports = {
  listedAreaRows,
  listedAreaIds,
  listedAreaNames,
  listedAreaKeys,
  listedAreaFee,
  titleName,
};
