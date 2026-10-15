'use strict';
// Shared caller-side gazetteer of place names a caller can say that point at
// more than one place. Same for every tenant (built from kenyaPlaceCounties.json).
//   short/full:  "rongai" -> Rongai | Ongata Rongai
//   many counties: one name listed in two or more counties
// Feeds the future clarify step. No tenant data here.
const crypto = require('crypto');
const INDEX = require('./data/kenyaPlaceCounties.json');

const GENERIC = new Set(['township', 'town', 'central', 'east', 'west', 'north', 'south', 'market', 'estate', 'village', 'location', 'ward', 'cbd', 'centre', 'center', 'avenue', 'hospital', 'corner', 'course', 'complex', 'drive', 'junction', 'section', 'arcade', 'industrial', 'road', 'street', 'hill', 'stage', 'school', 'mall', 'park', 'gardens', 'phase', 'area', 'lower', 'upper', 'old', 'new', 'city', 'golf', 'refugee', 'kwa', 'st']);
const title = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
let BUILT = null;
function build() {
  if (BUILT) return BUILT;
  const keys = Object.keys(INDEX.places || {});
  const set = new Set(keys);
  const byHeard = new Map();
  const add = (heard, option, reason) => {
    const g = byHeard.get(heard) || { heard, options: new Set([heard]), reasons: new Set(), counties: new Set() };
    g.options.add(option); g.reasons.add(reason);
    for (const c of [].concat(INDEX.places[option] || [], INDEX.places[heard] || [])) g.counties.add(String(c));
    byHeard.set(heard, g);
  };
  for (const k of keys) {
    const w = k.split(' ');
    if (w.length < 2 || new Set(w).size < w.length) continue; // "kiambu kiambu" is not a second place
    const last = w[w.length - 1];
    if (last.length < 4 || w.some((x) => GENERIC.has(x)) || !set.has(last)) continue;
    add(last, k, 'short_and_full_name');
  }
  for (const k of keys) {
    const cs = [].concat(INDEX.places[k] || []);
    if (cs.length > 1 && k.length >= 4 && !k.split(' ').some((x) => GENERIC.has(x))) add(k, k, 'same_name_many_counties');
  }
  const groups = [...byHeard.values()].map((g) => ({ heard: g.heard, options: [...g.options].map(title), reasons: [...g.reasons].sort(), counties: [...g.counties].sort() }))
    .sort((a, b) => a.heard.localeCompare(b.heard));
  const version = crypto.createHash('sha256').update(JSON.stringify(groups)).digest('hex').slice(0, 12);
  BUILT = { version, groups, byHeard: new Map(groups.map((g) => [g.heard, g])) };
  return BUILT;
}
function ambiguityFor(heard) {
  const k = String(heard || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const B = build();
  if (B.byHeard.has(k)) return B.byHeard.get(k);
  return B.groups.find((g) => g.options.some((o) => o.toLowerCase() === k)) || null;
}
function gazetteer() { const B = build(); return { version: B.version, groups: B.groups }; }
module.exports = { ambiguityFor, gazetteer };
