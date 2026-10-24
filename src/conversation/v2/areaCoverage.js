'use strict';
// One coverage answer for a place the caller names (call HD_b4afd63a69c3, voice-qa/2026-10-24_flow-and-call.md).
// Shared Kenya area tree (data/kenyaPlaceCounties.json via kenyaPlaces.js, the same tree Desk's
// Locations picker uses) + the owner's list: include rows (county:x covers every place in x, place:y
// covers y) and exclude rows (beat any include). Fuzzy STT spellings come from bindSpokenPlace(fuzzy),
// landmarks from a small seed list. Desk contract (proposed, not changed here):
//   service_areas.areas[] = { id: 'county:nairobi' | 'place:kibera', rule?: 'include' | 'exclude', ... }
//   rule defaults to 'include'; service_areas.exclude: string[] is read too (same ids).
const K = require('../kenyaPlaces');
const INDEX = require('../data/kenyaPlaceCounties.json');
const { coverageAreaNames } = require('../coverageAreas');

const cap = (s) => String(s || '').replace(/\b[a-z]/g, (c) => c.toUpperCase());
// [seed] landmark -> place in the tree. Desk may own this later (spec §Desk contract).
const LANDMARKS = {
  sarit: 'westlands', 'sarit centre': 'westlands', westgate: 'westlands', yaya: 'kilimani', 'yaya centre': 'kilimani',
  'village market': 'gigiri', jkia: 'embakasi', 'thika road mall': 'roysambu', trm: 'roysambu', 'garden city': 'roysambu',
  'junction mall': 'kilimani', galleria: 'langata', 'the hub': 'karen', 'kenyatta university': 'kahawa',
};
// words that ask "where" without a place ("where's your coverage") must never become a place
const NOT_PLACE = new Set(['coverage', 'cover', 'area', 'areas', 'where', 'place', 'town', 'eneo', 'maeneo', 'wapi']);
const ASKED_PLACE = /\b(?:[Dd]o you (?:do|cover|come to|serve|reach|go to)|you (?:cover|come to|reach)|are you in|i'?m (?:in|at|near)|i am (?:in|at|near)|we'?re (?:in|at)|i (?:stay|live) (?:in|at|near)|near|in|at|mnafika|mnakuja|mtafika|niko|nipo|naishi|nakaa|karibu na|hadi|eneo la)\s+([A-Z][A-Za-z'-]{1,}(?:\s+[A-Z][A-Za-z'-]+){0,2})/;

function slug(id) { const t = String(id || '').trim().toLowerCase(); return t.includes(':') ? t.slice(t.indexOf(':') + 1).trim() : t; }
function kind(id) { const t = String(id || '').trim().toLowerCase(); if (t.startsWith('county:')) return 'county'; if (t.startsWith('place:')) return 'place'; return INDEX.counties.includes(t) ? 'county' : 'place'; }

/** Owner rules from every bag Desk writes (listedAreas.js reads the same four). */
function ownerRules(profile = {}) {
  const inc = { counties: new Set(), places: new Set() }; const exc = { counties: new Set(), places: new Set() }; const say = new Map();
  const put = (bag, id) => {
    let s = slug(id); if (!s) return;
    const k = kind(id);
    if (k === 'place' && !INDEX.places[s]) { const b = K.bindSpokenPlace(s, { fuzzy: true })[0]; if (b) { say.set(b, cap(s)); s = b; } } // "kibera" -> tree "kibra", spoken as the owner wrote it
    (k === 'county' ? bag.counties : bag.places).add(s);
  };
  for (const b of [profile.serviceAreas, profile.areaTerms, profile.service_areas]) {
    if (!b) continue;
    for (const a of Array.isArray(b) ? b : (b.areas || [])) {
      const id = typeof a === 'string' ? a : (a && (a.id || a.name));
      put(a && a.rule === 'exclude' ? exc : inc, id);
    }
    for (const id of (b && !Array.isArray(b) && b.exclude) || []) put(exc, id);
  }
  for (const n of coverageAreaNames(profile.businessPolicies || {})) put(inc, n);
  return { inc, exc, say };
}

function landmark(text) {
  const low = ` ${K.normalizePlaceKey(text)} `;
  const hit = Object.keys(LANDMARKS).sort((a, b) => b.length - a.length).find((k) => low.includes(` ${k} `));
  return hit ? { place: LANDMARKS[hit], landmark: hit } : null;
}

/**
 * @returns {null | { status: 'covered'|'excluded'|'outside'|'unknown', name, place, counties, via, landmark? }}
 * covered: on the owner's list directly or through its county. excluded: an owner exclude row.
 * outside: a real Kenyan place not on the list. unknown: the caller named a place we cannot place.
 */
function resolve(text, profile = {}) {
  const t = String(text || '');
  if (!t.trim()) return null;
  const lm = landmark(t);
  const found = lm ? [lm.place] : K.bindSpokenPlace(t, { fuzzy: true }).filter((p) => !NOT_PLACE.has(p));
  const { inc, exc, say } = ownerRules(profile);
  if (!found.length) {
    const m = t.match(ASKED_PLACE);
    const w = m && m[1] && m[1].trim();
    if (w && !NOT_PLACE.has(w.toLowerCase()) && /^[A-Z]/.test(w) && !/^(the|my|your|our|a|an|it|that|this|alvin)$/i.test(w)) return { status: 'unknown', name: cap(w.toLowerCase()), place: null, counties: [], via: 'asked' };
    return null;
  }
  // prefer an owner-listed place, then the longest name
  const place = found.find((p) => inc.places.has(p) || exc.places.has(p)) || found.sort((a, b) => b.length - a.length)[0];
  const counties = INDEX.counties.includes(place) ? [place] : (INDEX.places[place] || []);
  const name = place === 'rongai' && inc.places.has('ongata rongai') ? 'Ongata Rongai' : (say.get(place) || cap(place));
  const base = { name, place, counties, ...(lm ? { landmark: lm.landmark } : {}) };
  if (exc.places.has(place)) return { ...base, status: 'excluded', via: `place:${place}` };
  if (inc.places.has(place) || (place === 'rongai' && inc.places.has('ongata rongai'))) return { ...base, status: 'covered', via: `place:${place}` };
  const ec = counties.find((c) => exc.counties.has(c)); if (ec) return { ...base, status: 'excluded', via: `county:${ec}` };
  const ic = counties.find((c) => inc.counties.has(c) || inc.places.has(c)); if (ic) return { ...base, status: 'covered', via: `county:${ic}`, county: cap(ic) };
  return { ...base, status: 'outside', via: 'tree' };
}

// [PROMPT-PLACEHOLDER] caller-facing coverage lines.
function line(r, lang = 'en') {
  if (!r) return null;
  const sw = /^sw/.test(String(lang || ''));
  if (r.status === 'covered') return sw ? `Ndio, tunafika ${r.name}.` : `Yes, we cover ${r.name}.`;
  if (r.status === 'excluded' || r.status === 'outside') return sw ? `Samahani, hatufiki ${r.name}.` : `Sorry, we don't cover ${r.name}.`;
  return sw ? 'Hiyo iko karibu na eneo gani?' : 'Which area is that near?';
}
module.exports = { resolve, line, ownerRules, LANDMARKS };
