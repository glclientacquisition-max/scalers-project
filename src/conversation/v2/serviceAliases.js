'use strict';
// Catalogue follow-up aliases (Brain S1). The spoken category line says
// "deep cleaning, like move-in or after building work" — callers echo those
// colloquialisms, which do not share tokens with the row name
// ("Post-Construction Clean"). Map phrase → name pattern so matchService /
// bindService / spokenCatalogue.findEntry can bind u.service and reach explain.
// General Kenyan home-services vocabulary, not one tenant's ids.

const SERVICE_ALIASES = [
  {
    // after building / post-construction / baada ya ujenzi
    re: /\b(?:after[\s-]?build(?:ing)?(?:\s+work)?|post[\s-]?construction|baada\s+(?:ya\s+)?ujenzi|ukarabati)\b/i,
    nameRe: /post[\s-]?construction/i,
    phrases: ['after building', 'after building work', 'baada ya ujenzi', 'baada ujenzi'],
  },
  {
    // move-in / move-out / kuhamia / kuhama
    re: /\b(?:move[\s-]?in(?:\s*\/\s*move[\s-]?out)?|move[\s-]?out|kuhamia|kuhama)\b/i,
    nameRe: /move[\s-]?(?:in|out)/i,
    phrases: ['move-in', 'move out', 'move-in or after building', 'kuhamia', 'kuhama'],
  },
  {
    // deep clean / usafi wa kina — prefer the package row over fridge/oven deep cleans.
    // Skip when the caller named a specific appliance (oven/fridge) so those rows still bind.
    re: /\b(?:deep[\s-]?clean(?:ing)?|usafi\s+wa\s+kina)\b/i,
    nameRe: /deep\s*clean/i,
    prefer: /package|add-?on/i,
    reject: /fridge|refrigerator|oven/i,
    skipIf: /\b(oven|fridge|refrigerator|friji|oveni)\b/i,
    phrases: ['deep cleaning', 'deep clean', 'usafi wa kina'],
  },
];

/** Extra spoken phrases scored by findEntry for a catalogue row name. */
function aliasPhrasesForName(name) {
  const n = String(name || '');
  const out = [];
  for (const a of SERVICE_ALIASES) {
    if (!a.nameRe.test(n)) continue;
    if (a.reject && a.reject.test(n)) continue;
    if (a.prefer && !a.prefer.test(n)) continue;
    out.push(...(a.phrases || []));
  }
  return out;
}

/**
 * Pick one catalogue row from a caller phrase alias, or null.
 * @param {string} text
 * @param {{ name?: string }[]} catalog
 */
function aliasService(text, catalog = []) {
  const t = String(text || '');
  if (!t || !catalog.length) return null;
  for (const a of SERVICE_ALIASES) {
    if (!a.re.test(t)) continue;
    if (a.skipIf && a.skipIf.test(t)) continue;
    let hits = catalog.filter((s) => a.nameRe.test(String(s.name || '')));
    if (!hits.length) continue;
    if (a.reject) {
      const filtered = hits.filter((s) => !a.reject.test(String(s.name || '')));
      if (filtered.length) hits = filtered;
    }
    if (a.prefer) {
      const preferred = hits.filter((s) => a.prefer.test(String(s.name || '')));
      if (preferred.length) hits = preferred;
    }
    if (hits.length >= 1) return hits[0];
  }
  return null;
}

module.exports = { SERVICE_ALIASES, aliasService, aliasPhrasesForName };
