'use strict';
// One coverage answer for a place the caller names (call HD_b4afd63a69c3).
// SOURCE: the owner's picks in public.tenant_area_picks (profile.areaPicks) on Desk's Kenya area tree
// (docs/reference/platform/AREA_PICKS.md, Desk #930). Matching, nearest-pick-wins, fee/note and the caller
// line come from ./areaPicks (the CommonJS port of Desk's areaPicks.ts; parity-tested). Landmarks and
// aliases are Desk's (tree nodes). FALLBACK, only when the tenant has no picks (or the tree/table is
// absent): the legacy lists (service_areas / serviceAreas / areaTerms / business_policies.coverage_areas)
// on the place->county index (data/kenyaPlaceCounties.json). BRAIN_AREA_PICKS=off forces the fallback.
const K = require('../kenyaPlaces');
const INDEX = require('../data/kenyaPlaceCounties.json');
const { coverageAreaNames } = require('../coverageAreas');
const AP = require('./areaPicks');

const cap = (s) => String(s || '').replace(/\b[a-z]/g, (c) => c.toUpperCase());
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

// ---- tree phrase matching (Desk rule 1: exact name/alias, then landmark, then loose spelling) ----
const STOP = new Set(['the', 'a', 'an', 'my', 'your', 'our', 'you', 'we', 'i', 'do', 'does', 'is', 'are', 'in', 'at', 'to', 'near', 'from', 'for', 'and', 'or', 'it', 'that', 'this', 'there', 'yes', 'yeah', 'no', 'ok', 'okay', 'sawa', 'ndio', 'hapana', 'niko', 'nipo', 'naishi', 'nakaa', 'mnafika', 'mnakuja', 'mtafika', 'karibu', 'na', 'hadi', 'la', 'eneo', 'cover', 'coverage', 'area', 'areas', 'place', 'where', 'wapi', 'under', 'put', 'can', 'book', 'booking', 'please', 'tomorrow', 'today', 'kesho', 'leo', 'morning', 'evening', 'afternoon', 'cleaning', 'window', 'house', 'office', 'name', 'jina', 'stay', 'live', 'come', 'serve', 'reach', 'go', 'also', 'but', 'so', 'am', 'im', 'were', 'me', 'us', 'job', 'kazi']);
let PHRASES = null; // normalised name/alias/landmark -> node
function phraseIndex() {
  if (PHRASES) return PHRASES;
  PHRASES = { exact: new Map(), landmark: new Map() };
  for (const n of AP.NODES) {
    if (n.kind === 'country') continue;
    for (const k of [n.name, ...(n.aliases || [])]) { const q = AP.normAreaText(k); if (q && !PHRASES.exact.has(q)) PHRASES.exact.set(q, n); }
    for (const l of n.landmarks || []) { const q = AP.normAreaText(l); if (q && !PHRASES.landmark.has(q)) PHRASES.landmark.set(q, n); }
  }
  // a name that is both a county and a town: Desk's matchAreaText picks the county
  for (const [q, n] of PHRASES.exact) { if (n.kind !== 'county') { const c = AP.NODES.find((x) => x.kind === 'county' && AP.normAreaText(x.name) === q); if (c) PHRASES.exact.set(q, c); } }
  return PHRASES;
}
/** The tree node the caller named, or null. Exact > landmark > close spelling (≤1 for 4 letters, ≤2 for 5+). */
function treeMatch(text, { fuzzy = true } = {}) {
  if (!AP.available()) return null;
  const words = AP.normAreaText(text).split(' ').filter(Boolean);
  const ix = phraseIndex(); let best = null;
  for (let len = Math.min(3, words.length); len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const g = words.slice(i, i + len);
      if (STOP.has(g[0]) || STOP.has(g[g.length - 1])) continue;
      const q = g.join(' ');
      const locative = /^[a-z]{5,}ni$/.test(q) ? q.slice(0, -2) : null; // sw "Kileleshwani" = "at Kileleshwa"
      let n = ix.exact.get(q) || (locative && ix.exact.get(locative)); let via = 'name';
      if (!n) { n = ix.landmark.get(q); via = 'landmark'; }
      if (!n && fuzzy && len <= 2 && q.replace(/ /g, '').length >= 4) {
        const tol = q.length >= 5 ? 2 : 1; let d0 = tol + 1;
        for (const [k, node] of ix.exact) { if (Math.abs(k.length - q.length) > tol) continue; const d = AP.editDistance(q, k); if (d < d0) { d0 = d; n = node; } }
        if (locative && !n) for (const [k, node] of ix.exact) { if (AP.editDistance(locative, k) <= 1) { n = node; break; } }
        via = 'fuzzy';
      }
      if (n) { const rank = (via === 'fuzzy' ? 0 : 10) + len; if (!best || rank > best.rank) best = { node: n, via, rank, said: q, fuzzy: via === 'fuzzy' }; }
    }
  }
  return best;
}

// ---- placeMentions: the ONE "which places did the CALLER name" (AI-first; rogue calls HD_7a9915837b00, HD_ef5ee3a15a0a) ----
// Primary signal: the model's understanding (slots.places). Word matching only (a) confirms or rejects a place the
// model named, against the caller's own words, or (b) finds an exact/alias/landmark name INSIDE an explicit place slot
// ("in/at/near/kwa/niko/nipo/mnafika X", "Xni", the answer to "which area?", or a bare place answer). It never invents
// a place from free text: fuzzy spelling is used only to confirm a model-named place. Never run on the model's own words.
const SLOT_CUE = new Set(['in', 'have', 'at', 'near', 'around', 'to', 'from', 'kwa', 'huko', 'kule', 'niko', 'nipo', 'tuko', 'tupo', 'naishi', 'nakaa', 'tunaishi', 'mnafika', 'mnakuja', 'mtafika', 'mnafikia', 'mnaenda', 'mnafanya', 'hadi', 'mpaka', 'cover', 'covers', 'serve', 'reach', 'eneo', 'karibu']);
const CONJ = new Set(['or', 'and', 'au', 'na', 'ama', 'wala', 'also', 'pia', 'maybe', 'labda']);
// function/question words of either language that must never start, end or fill a place window
const PLACE_STOP = new Set([...STOP, 'saa', 'ngapi', 'kuhusu', 'sasa', 'gani', 'nini', 'kujua', 'nataka', 'nilikuwa', 'ningependa', 'venye', 'vile', 'jinsi', 'nyinyi', 'wewe', 'mimi', 'yenu', 'yako', 'yangu', 'ya', 'wa', 'za', 'cha', 'kwa', 'huko', 'kule', 'hapa', 'pale', 'ni', 'si', 'je', 'tu', 'pia', 'labda', 'baada', 'kabla', 'asubuhi', 'jioni', 'mchana', 'usiku', 'wiki', 'siku', 'leo', 'kesho', 'jana', 'deep', 'clean', 'usafi', 'nyumba', 'ofisi', 'huduma', 'bei', 'what', 'time', 'when', 'how', 'much', 'which', 'hours', 'open', 'many', 'about', 'want', 'know', 'mna', 'mnafanyanga', 'mnafanya', 'mnafungua', 'mnafunga', 'kazi', 'salamu', 'sawa', 'asante', 'tafadhali', 'shh', 'ah', 'eh', 'um', 'uh', 'hello', 'hi', 'habari', 'jambo', 'please', 'thanks', 'thank', 'guys', 'there', 'here', 'have', 'got', 'does']);
const BARE_MAX = 4; // "Kileleshwa." / "Kilimani Westlands?" / "Ongata Rongai or Kileleshwa" are an answer, not chatter
function slotWindows(words, expecting) {
  const content = words.filter((w) => !CONJ.has(w) && !PLACE_STOP.has(w));
  if (['place', 'landmark', 'area', 'which_area'].includes(expecting)) return [{ from: 0, to: words.length, bare: true }];
  if (content.length && content.length <= 2 && words.length <= 3) return [{ from: 0, to: words.length, bare: true }]; // a one/two-word answer: "Kilelesha." / "Kamakis"
  // a bare place answer: every content word is part of an exact place name ("Kileleshwa.", "Ongata Rongai or Kileleshwa? Do you go there?")
  if (content.length && content.length <= BARE_MAX && words.length <= 12) {
    if (!AP.available()) { if (content.every((w) => K.bindSpokenPlace(w).length) || K.bindSpokenPlace(content.join(' ')).length === content.length) return [{ from: 0, to: words.length }]; } // legacy index (no tree)
    const hit = strictScan(content).reduce((n, m) => n + m.said.split(' ').length, 0); if (hit === content.length) return [{ from: 0, to: words.length }]; }
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (SLOT_CUE.has(w)) {
      let j = i + 1; let taken = 0;
      while (j < words.length && taken < 6) { if (CONJ.has(words[j]) || SLOT_CUE.has(words[j])) { j++; continue; } if (PLACE_STOP.has(words[j])) break; j++; taken++; }
      if (j > i + 1) out.push({ from: i + 1, to: j });
    } else if (/^[a-z]{5,}ni$/.test(w)) out.push({ from: i, to: i + 1, locative: true }); // sw "Kileleshwani"
  }
  return out;
}
function strictScan(words, { bare = false } = {}) {
  const out = []; let i = 0;
  while (i < words.length) {
    let hit = null;
    for (let n = Math.min(3, words.length - i); n >= 1 && !hit; n--) {
      const g = words.slice(i, i + n);
      if (PLACE_STOP.has(g[0]) || PLACE_STOP.has(g[g.length - 1]) || CONJ.has(g[0]) || CONJ.has(g[g.length - 1])) continue;
      const m = treeMatch(g.join(' '), { fuzzy: false });
      if (m && m.node && m.said === g.join(' ')) hit = { m, n };
      else if (!m && n === 1 && /^[a-z]{5,}ni$/.test(g[0])) { const m2 = treeMatch(g[0], { fuzzy: false }); if (m2 && m2.node) hit = { m: m2, n }; }
    }
    if (!hit && bare && !PLACE_STOP.has(words[i]) && words[i].length >= 5) { // a one-word place answer may be misheard: close spelling, same first letter
      const m = treeMatch(words[i]); if (m && m.node && m.fuzzy && AP.normAreaText(m.node.name)[0] === words[i][0]) hit = { m, n: 1 };
    }
    if (hit) { out.push(hit.m); i += hit.n; } else i++;
  }
  return out;
}
/** A place the model named is real only if the caller said it (whole words, or a close spelling of a non-stop word). */
function confirmInCaller(place, words) {
  const q = AP.normAreaText(place); if (!q || NOT_PLACE.has(q)) return null;
  const node = (treeMatch(q, { fuzzy: false }) || {}).node || null;
  const cands = new Set([q, ...(node ? [AP.normAreaText(node.name), ...(node.aliases || []).map(AP.normAreaText)] : [])]);
  const text = ` ${words.join(' ')} `;
  for (const c of cands) if (c && text.includes(` ${c} `)) return { node, said: c, via: 'model', fuzzy: false };
  for (const c of cands) { // STT spelling: a caller span of the same width, not a stop word, within the treeMatch tolerance
    const k = c.split(' ').length;
    for (let i = 0; i + k <= words.length; i++) {
      const g = words.slice(i, i + k); if (g.some((x) => PLACE_STOP.has(x))) continue;
      const s = g.join(' '); if (s.replace(/ /g, '').length < 4 || s[0] !== c[0]) continue;
      if (AP.editDistance(s, c) <= (c.length >= 6 ? 2 : 1)) return { node: node || (treeMatch(s) || {}).node || null, said: s, via: 'model', fuzzy: true };
    }
  }
  return null;
}
/**
 * The places the CALLER named this turn: [{ name, node, said, via: 'model'|'slot'|'landmark', fuzzy }] (max 5).
 * u: the model's understanding (null when the model has not answered / failed); expecting: machine.expecting.
 * rejected (out param): model places the caller never said, for the trace. profile: enables bare own-pick names.
 */
function placeMentions(text, { u = null, expecting = null, rejected = null, profile = null } = {}) {
  const words = AP.normAreaText(text).split(' ').filter(Boolean);
  const out = []; const seen = new Set();
  const add = (name, rest) => { const k = String(name).toLowerCase(); if (!name || seen.has(k) || out.length >= 5) return; seen.add(k); out.push({ name, ...rest }); };
  const mp = u && u.slots && Array.isArray(u.slots.places) ? u.slots.places : [];
  for (const p of mp) {
    const c = confirmInCaller(String(p || ''), words);
    if (c) add(c.node ? c.node.name : cap(String(p).trim().toLowerCase()), { node: c.node, said: c.said, via: 'model', fuzzy: c.fuzzy });
    else if (Array.isArray(rejected)) rejected.push(String(p));
  }
  if (AP.available()) for (const w of slotWindows(words, expecting)) for (const m of strictScan(words.slice(w.from, w.to), { bare: !!w.bare })) add(m.node.name, { node: m.node, said: m.said, via: m.via === 'landmark' ? 'landmark' : 'slot', fuzzy: false });
  for (const m of ownPickBare(words, profile)) add(m.node.name, { node: m.node, said: m.said, via: 'own_pick', fuzzy: false });
  return out;
}
/**
 * Bare place names with no cue word (Alvin 2026-10-25 13:48): a whole-word EXACT match of the name or an alias of a
 * place in THIS tenant's own CONFIRMED picks counts. Multi-letter, never a stop word. No fuzzy, no landmarks, no tree
 * places outside the tenant's picks (those still need the model's understanding or a place slot, else "which area?").
 */
function ownPickBare(words, profile) {
  if (!profile || !AP.available()) return [];
  const p = picksOf(profile); if (!p) return [];
  const text = ` ${words.join(' ')} `; const out = [];
  for (const pick of p.picks) {
    const n = AP.areaNode(pick.node); if (!n || n.kind === 'country') continue;
    for (const k of [n.name, ...(n.aliases || [])]) {
      const q = AP.normAreaText(k);
      if (!q || q.replace(/ /g, '').length < 2 || q.split(' ').some((x) => PLACE_STOP.has(x)) || NOT_PLACE.has(q)) continue;
      if (text.includes(` ${q} `)) { out.push({ node: n, said: q }); break; }
    }
  }
  return out;
}

/** Owner picks (normalised), or null when this tenant has none / picks are off / the tree is missing. */
function rawPicks(profile = {}) {
  if (String(process.env.BRAIN_AREA_PICKS || 'on').toLowerCase() === 'off' || !AP.available()) return null;
  const raw = profile.areaPicks; if (!raw) return null;
  const p = AP.normalizeAreaPicks(raw);
  return p.picks.length ? p : null;
}
/** B2 (audit 2026-10-25): the owner tapped "Looks right" (tenant_area_picks.confirmed_at). Fail closed. */
function picksConfirmed(profile = {}) {
  return Boolean(profile.areaPicksConfirmedAt || (profile.areaPicks && profile.areaPicks.confirmed_at));
}
/** Owner picks (normalised), or null when this tenant has none / unconfirmed / picks are off / the tree is missing. */
function picksOf(profile = {}) {
  const p = rawPicks(profile);
  return p && picksConfirmed(profile) ? p : null;
}
/** Picks exist but the owner has not confirmed them: no area is spoken; the team confirms (no legacy fallback). */
function picksPending(profile = {}) {
  return Boolean(rawPicks(profile)) && !picksConfirmed(profile);
}

function landmark(text) {
  const m = treeMatch(text);
  return m && m.via === 'landmark' ? { place: K.normalizePlaceKey(m.node.name), landmark: m.said } : null;
}

/**
 * @returns {null | { status: 'covered'|'excluded'|'outside'|'unknown', name, place, counties, via, landmark? }}
 * covered: on the owner's list directly or through its county. excluded: an owner exclude row.
 * outside: a real Kenyan place not on the list. unknown: the caller named a place we cannot place.
 */
function resolve(text, profile = {}, opts = {}) {
  const t = String(text || '');
  if (!t.trim()) return null;
  const picks = picksOf(profile);
  if (picks) return resolvePicks(t, picks, { ...opts, profile });
  if (picksPending(profile)) {
    const m = mentionMatch(t, opts);
    if (m) return { status: 'unknown', name: m.node.name, place: K.normalizePlaceKey(m.node.name), node: m.node.id, counties: [], via: 'unconfirmed', source: 'picks' };
    const u = unknownAsked(t); return u ? { ...u, via: 'unconfirmed' } : null;
  }
  const mm = mentionMatch(t, opts);
  const lm = mm && mm.via === 'landmark' ? { place: K.normalizePlaceKey(mm.node.name), landmark: mm.said } : null;
  const words = AP.normAreaText(t).split(' ').filter(Boolean);
  const slotText = slotWindows(words, opts.expecting).map((w) => words.slice(w.from, w.to).join(' ')).join(' , ');
  let found = lm ? [lm.place] : (slotText ? K.bindSpokenPlace(slotText, { fuzzy: true }) : []).filter((p) => !NOT_PLACE.has(p) && !PLACE_STOP.has(p));
  if (!found.length && mm) found = [K.normalizePlaceKey(mm.node.name)]; // Desk tree names/aliases (Juja, Ongata Rongai)
  const { inc, exc, say } = ownerRules(profile);
  if (!found.length) {
    const m = t.match(ASKED_PLACE);
    const w = m && m[1] && m[1].trim();
    if (w && !w.toLowerCase().split(/\s+/).every((x) => PLACE_STOP.has(x)) && !NOT_PLACE.has(w.toLowerCase()) && /^[A-Z]/.test(w) && !/^(the|my|your|our|a|an|it|that|this|alvin)$/i.test(w)) return { status: 'unknown', name: cap(w.toLowerCase()), place: null, counties: [], via: 'asked' };
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
  // a county is covered only when the owner listed the COUNTY (a same-named town row, e.g. place:kiambu, is not the county)
  const ic = counties.find((c) => inc.counties.has(c)); if (ic) return { ...base, status: 'covered', via: `county:${ic}`, county: cap(ic) };
  // a known place in a county where the owner lists nothing at all is an honest "no" (Kericho for a Nairobi-only tenant)
  const listedIn = (c) => inc.counties.has(c) || [...inc.places].some((p) => p === c || (INDEX.places[p] || []).includes(c));
  if (counties.length && !counties.some(listedIn)) return { ...base, status: 'outside', via: 'tree' };
  // otherwise the legacy fallback never confirms a place it does not know: the team confirms (never "yes", never a guessed "no")
  return { ...base, status: 'unknown', via: 'unconfirmed', source: 'legacy' };
}

function unknownAsked(t) {
  const m = t.match(ASKED_PLACE); const w = m && m[1] && m[1].trim();
  if (w && !w.toLowerCase().split(/\s+/).every((x) => PLACE_STOP.has(x)) && !NOT_PLACE.has(w.toLowerCase()) && /^[A-Z]/.test(w) && !/^(the|my|your|our|a|an|it|that|this|alvin)$/i.test(w)) return { status: 'unknown', name: cap(w.toLowerCase()), place: null, counties: [], via: 'asked', source: 'picks' };
  return null;
}
/** The first caller-named tree place as a treeMatch-shaped hit (placeMentions), or null. */
function mentionMatch(t, opts = {}) {
  const pm = placeMentions(t, opts).find((x) => x.node);
  return pm ? { node: pm.node, via: pm.via === 'landmark' ? 'landmark' : 'name', said: pm.said } : null;
}
function resolvePicks(t, picks, opts = {}) {
  const m = mentionMatch(t, opts);
  if (!m) return unknownAsked(t);
  const n = m.node; const res = AP.resolveArea(picks, n.id);
  const county = AP.countyOf(n.id);
  const status = res.covered ? 'covered' : res.via ? 'excluded' : 'outside';
  return { status, name: n.name, place: K.normalizePlaceKey(n.name), node: n.id, counties: county ? [K.normalizePlaceKey(county.name)] : [], via: res.via || 'tree', county: county && county.id !== n.id ? county.name : null, fee_kes: res.fee_kes, note: res.note, note_lang: AP.noteLang(res.note), source: 'picks', ...(m.via === 'landmark' ? { landmark: m.said } : {}), lines: { en: AP.linesFor(picks, n, 'en').reply, sw: AP.linesFor(picks, n, 'sw').reply } };
}
/** Serving / excluded pick names for "where do you cover" (picks mode), or null (legacy). */
function listed(profile = {}) {
  if (picksPending(profile)) return { serve: [], off: [], pending: true };
  const p = picksOf(profile); if (!p) return null;
  return { serve: p.picks.filter((x) => x.serve).map((x) => (AP.areaNode(x.node) || {}).name).filter(Boolean), off: p.picks.filter((x) => !x.serve).map((x) => (AP.areaNode(x.node) || {}).name).filter(Boolean) };
}

// [PROMPT-PLACEHOLDER] caller-facing coverage lines. Picks mode: Desk's "what callers will hear" (fee, note).
function line(r, lang = 'en') {
  if (!r) return null;
  if (r.lines) return /^sw/.test(String(lang || '')) ? r.lines.sw : r.lines.en;
  const sw = /^sw/.test(String(lang || ''));
  if (r.via === 'unconfirmed') return sw ? `Timu itathibitisha kama tunafika ${r.name}.` : `The team will confirm whether we cover ${r.name}.`;
  if (r.status === 'covered') return sw ? `Ndio, tunafika ${r.name}.` : `Yes, we cover ${r.name}.`;
  if (r.status === 'excluded' || r.status === 'outside') return sw ? `Samahani, hatufiki ${r.name}.` : `Sorry, we don't cover ${r.name}.`;
  return sw ? 'Hiyo iko karibu na eneo gani?' : 'Which area is that near?';
}
/** The ONE coverage answer for a caller phrase on every path: confirmed picks first, legacy rows only with no picks. */
function answer(text, profile = {}, lang = 'en') { const r = resolve(text, profile); return r ? { ...r, line: line(r, lang) } : null; }
module.exports = { answer, resolve, line, ownerRules, picksOf, picksPending, picksConfirmed, listed, treeMatch, placeMentions, PLACE_STOP };
