'use strict';
// v2 KB reader: one in-process index per (business, snapshot version). No network on a lookup.
// Tier 1 (<= 10,000 active items): the whole snapshot is loaded at call start and indexed here.
// Tier 2 (> 10,000): the snapshot carries the index only; find() falls back to the kb_search_items RPC (db.searchKbItems).
const { tokens } = require('./keys');

const TIER1_MAX_ITEMS = 10000;
const CACHE_MAX_BYTES = Number(process.env.KB_CACHE_MAX_MB || 256) * 1024 * 1024;
// words that describe a whole trade, never one item: they must not pick an item on their own
const GENERIC = new Set(['clean', 'seedling', 'service', 'vegetable', 'fruit', 'herb', 'tree', 'house', 'f1', 'variety', 'varieties', 'aina']);

function lev1(a, b) { // edit distance <= 1
  if (a === b) return true; if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let e = 0;
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++e > 1) return false; if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } }
  return e + (a.length - i) + (b.length - j) <= 1;
}
const near = (q, k) => q === k || (q.length >= 5 && k.length >= 5 && lev1(q, k));

/**
 * The spoken form of a group (category) name. kb_categories has no spoken/display column (name_en, name_sw,
 * name_sw_state only), so the owner's label is cleaned the same way every time it is spoken: bracketed asides
 * and a spaced dash suffix go ("Capsicum (Hoho) - Green" -> "capsicum"), a slash or & becomes a word
 * ("Kales / Collards" -> "kales or collards"), and words are lower-cased mid-sentence except acronyms.
 * Pure (Desk bundles this file); applied on read, so snapshots compiled before this fix speak clean names too.
 */
function spokenGroupName(name, { lower = true } = {}) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  let s = raw.replace(/\s*[([{][^)\]}]*[)\]}]/g, ' ').replace(/\s+[-\u2013\u2014]\s+.*$/, '');
  s = s.replace(/\s*\/\s*/g, ' or ').replace(/\s*&\s*/g, ' and ').replace(/[()[\]{}]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '').trim();
  if (!s) s = raw.replace(/[()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim();
  return lower ? s.split(' ').map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ') : s;
}

function openKb(doc) {
  if (!doc || !Array.isArray(doc.items)) return null;
  const t0 = process.hrtime.bigint();
  const byId = new Map(doc.items.map((x) => [x.id, x]));
  // small inverted index (no dependency: the Desk bundles this file too): term -> [[item id, weight]]
  const POST = new Map();
  const addTerm = (t, ix, w) => { if (!t) return; let l = POST.get(t); if (!l) POST.set(t, (l = [])); l.push(ix, w); }; // flat [ix, w, ix, w, …]
  doc.items.forEach((x, ix) => { for (const k of new Set(x.keys || [])) addTerm(k, ix, 2); for (const k of new Set(x.cat_keys || [])) addTerm(k, ix, 1); });
  const META = doc.items.map((x) => {
    const ks = [...new Set(x.keys || [])];
    const words = ks.filter((k) => !/^\d+$/.test(k));
    return { words, nums: ks.filter((k) => /^\d+$/.test(k)), specific: words.some((k) => !GENERIC.has(k)) };
  });
  const VOCAB = [...POST.keys()].filter((t) => !/^\d+$/.test(t)).sort(); // sorted: prefix range by binary search
  const BY_LEN = new Map(); for (const t of VOCAB) { if (!BY_LEN.has(t.length)) BY_LEN.set(t.length, []); BY_LEN.get(t.length).push(t); }
  const lowerBound = (w) => { let lo = 0; let hi = VOCAB.length; while (lo < hi) { const m = (lo + hi) >> 1; if (VOCAB[m] < w) lo = m + 1; else hi = m; } return lo; };
  const N = Math.max(1, doc.items.length);
  const idf = (t) => Math.log(1 + N / (POST.get(t).length / 2));
  const SCORE = new Float64Array(N); const CNT = new Uint16Array(N); // reused per lookup (single-threaded)
  // caller words -> index terms with a factor (exact 1, one edit 0.5, prefix 0.6); numbers match exactly only
  function termHits(q) {
    const hits = new Map();
    const put = (t, f) => { if ((hits.get(t) || 0) < f) hits.set(t, f); };
    for (const w of q) {
      if (POST.has(w)) put(w, 1);
      if (w.length < 4 || /^\d+$/.test(w)) continue;
      for (let k = lowerBound(w); k < VOCAB.length && VOCAB[k].startsWith(w); k++) if (VOCAB[k] !== w) put(VOCAB[k], 0.6);
      if (w.length >= 5) for (const L of [w.length - 1, w.length, w.length + 1]) for (const t of BY_LEN.get(L) || []) if (t.length >= 5 && t !== w && lev1(w, t)) put(t, 0.5);
    }
    return hits;
  }
  function rank(hits, limit) {
    const touched = [];
    for (const [t, f] of hits) {
      const i = idf(t); const l = POST.get(t);
      for (let k = 0; k < l.length; k += 2) { const ix = l[k]; if (SCORE[ix] === 0) touched.push(ix); SCORE[ix] += l[k + 1] * f * i; }
    }
    const top = []; // top-k in one pass (no full sort of a 10k score list)
    for (const ix of touched) {
      const sc = SCORE[ix]; SCORE[ix] = 0;
      if (top.length < limit) { top.push([ix, sc]); if (top.length === limit) top.sort((x, y) => y[1] - x[1]); continue; }
      if (sc > top[limit - 1][1]) { top[limit - 1] = [ix, sc]; top.sort((x, y) => y[1] - x[1]); }
    }
    if (top.length < limit) top.sort((x, y) => y[1] - x[1]);
    return top.map(([ix, sc]) => ({ item: doc.items[ix], score: sc }));
  }
  const buildMs = Number(process.hrtime.bigint() - t0) / 1e6;
  // groups are spoken by their clean spoken name (approved Swahili name only, cleaned the same way)
  const cats = (doc.categories || []).map((c) => (c && c.name ? { ...c, say_en: spokenGroupName(c.name), say_sw: c.say_sw ? spokenGroupName(c.say_sw, { lower: false }) : null } : c));

  /**
   * find(text) -> { q, named: item|null, items: [{item, score}], category: cat|null, ms }
   *   named: the one item whose own name words are all in the caller's words (longest wins)
   *   category: a category the caller named (by its words), when no single item was named
   */
  function find(text, { limit = 10 } = {}) {
    const s0 = process.hrtime.bigint();
    const q = tokens(text);
    const specific = q.filter((w) => !GENERIC.has(w));
    if (!q.length) return { q, named: null, items: [], category: null, ms: 0 };
    // 1) an item named in full ("deep clean" inside "a 3-bedroom deep clean"): every one of its own words heard
    //    (exact or one edit; a number only when the caller said it). Counted from the postings, not a scan of every item.
    const hits = termHits(q);
    const touched = [];
    for (const [t, f] of hits) { if (f === 0.6) continue; const l = POST.get(t); for (let k = 0; k < l.length; k += 2) if (l[k + 1] === 2) { const ix = l[k]; if (CNT[ix] === 0) touched.push(ix); CNT[ix]++; } }
    let named = null; let namedLen = 0;
    const qNums = q.filter((w) => /^\d+$/.test(w));
    for (const ix of touched) {
      const c = CNT[ix]; CNT[ix] = 0;
      const m = META[ix];
      if (c < m.words.length || !m.specific) continue;
      // a caller who said a number means that number: an item with a different number is not the one named
      if (qNums.length && m.nums.length && !m.nums.some((x) => qNums.includes(x))) continue;
      const len = m.words.length + m.nums.filter((x) => qNums.includes(x)).length;
      if (len <= namedLen) continue;
      if (m.words.every((k) => q.includes(k) || q.some((w) => near(w, k)))) { named = doc.items[ix]; namedLen = len; }
    }
    // 2) a category the caller named
    let category = null;
    if (!named) {
      let best = 0;
      for (const c of cats) {
        const keys = c.keys || [];
        let hit = keys.filter((k) => !GENERIC.has(k) && q.some((w) => near(w, k))).length;
        // a category named in full ("home cleaning") matches even when its words are generic on their own
        if (!hit && keys.length && keys.every((k) => q.some((w) => near(w, k)))) hit = 0.5 + keys.length / 100;
        if (hit > best) { best = hit; category = c; }
      }
    }
    // 3) ranked items (fuzzy + prefix); generic-only queries rank nothing
    const res = specific.length ? rank(hits, limit) : [];
    return { q, named, items: res, category, ms: Number(process.hrtime.bigint() - s0) / 1e6 };
  }
  // paused / not-offered items (small list): answered only when the caller names one in full
  const OFF = (Array.isArray(doc.off) ? doc.off : []).map((x) => ({ x, words: (x.name_keys || x.keys || []).filter((k) => !GENERIC.has(k)) })).filter((o) => o.words.length);
  function findOff(text) {
    if (!OFF.length) return null;
    const q = tokens(text);
    let best = null;
    for (const o of OFF) if (o.words.every((k) => q.includes(k) || q.some((w) => near(w, k))) && (!best || o.words.length > best.len)) best = { item: o.x, len: o.words.length };
    return best;
  }
  return { doc, byId, find, findOff, item: (id) => byId.get(id) || null, buildMs, categories: cats, tier: doc.items.length > TIER1_MAX_ITEMS ? 2 : 1 };
}

// ---- cache per business + version (bytes-capped LRU)
const CACHE = new Map(); let cacheBytes = 0;
function cached(tenantId, version, doc, bytes = null) {
  const key = `${tenantId}:${version}`;
  if (CACHE.has(key)) { const e = CACHE.get(key); CACHE.delete(key); CACHE.set(key, e); return e.handle; }
  if (!doc) return null;
  const handle = openKb(doc);
  if (!handle) return null;
  const size = (bytes || Buffer.byteLength(JSON.stringify(doc))) * 3; // parsed objects + index, measured ~3x the JSON
  // a new version of the same business replaces the old one at once
  for (const k of [...CACHE.keys()]) if (k.startsWith(`${tenantId}:`)) { cacheBytes -= CACHE.get(k).size; CACHE.delete(k); }
  CACHE.set(key, { handle, size }); cacheBytes += size;
  while (cacheBytes > CACHE_MAX_BYTES && CACHE.size > 1) { const [k, e] = CACHE.entries().next().value; CACHE.delete(k); cacheBytes -= e.size; }
  return handle;
}
function cacheStats() { return { entries: CACHE.size, bytes: cacheBytes }; }
function clearCache() { CACHE.clear(); cacheBytes = 0; }

module.exports = { openKb, cached, cacheStats, clearCache, TIER1_MAX_ITEMS, GENERIC, spokenGroupName };
