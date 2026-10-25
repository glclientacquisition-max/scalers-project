'use strict';
// Listed areas for prompts and NLU. Confirmed picks go through areaCoverage; else legacy bags.

const AC = require('./v2/areaCoverage');
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

function legacyListedRows(profile = {}) {
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

function listedAreaRows(profile = {}) {
  const lp = AC.listed(profile);
  if (lp && !lp.pending && (lp.serve.length || lp.off.length)) {
    const rows = [];
    for (const name of lp.serve) rows.push({ id: name, slug: slugOf(name), name, county: false });
    for (const name of lp.off) rows.push({ id: name, slug: slugOf(name), name, county: false });
    return rows;
  }
  return legacyListedRows(profile);
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
  const r = AC.resolve(String(place || ''), profile);
  if (r && r.source === 'picks' && r.fee_kes != null) {
    return {
      listed: r.status === 'covered',
      name: r.name || titleName(slug),
      trusted: true,
      feeMode: 'fixed',
      feeKsh: r.fee_kes,
    };
  }
  const listed = listedAreaRows(profile).some((row) => row.slug === slug);
  return {
    listed,
    name: titleName(slug),
    trusted: false,
    feeMode: 'ask',
    feeKsh: null,
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
