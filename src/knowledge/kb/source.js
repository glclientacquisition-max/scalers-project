'use strict';
// The one door to "what we sell" for every caller-facing reader (KB v2 reader plan, 28 Oct).
// mode 'kb': this call has a live, ready KB snapshot attached (kb/live.attach, BRAIN_KB_GATE + readiness), so
//   lists, the greeting, matchers, the prompt and the guard read ONLY the snapshot's offered (active) items.
//   Paused / not_offered items are never offered; they are answered only when a caller names one (findForCaller).
// mode 'legacy': no snapshot on this call (gate off, not ready, no kb rows, load error). Every accessor returns
//   exactly what the old readers read (same fields, same objects), so legacy calls are byte-for-byte unchanged.
// The mode is fixed for the call: the profile object (and its kb handle) is pinned at call start.
const LIVE = require('./live');
const { tokens } = require('./keys');
const { GENERIC } = require('./reader');
const { joinList } = require('./spoken');

const isSw = (lang) => /^sw/i.test(String(lang || ''));
const MEMO = new WeakMap();

// ---- surface (spoken-form) normalisation for the name lock: lowercase words, no synonyms, light English stem
function surface(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/ng'/g, 'ng')
    .split(/[^a-z0-9]+/).filter(Boolean);
}
const sstem = (w) => (w.length > 5 ? w.replace(/ing$/, '') : w).replace(/(?<=[a-z]{3})s$/, '');
const sameSurface = (a, b) => a.length === b.length && a.every((w, i) => sstem(w) === sstem(b[i]));
const keyOf = (ws) => [...new Set(ws)].sort().join(' ');

/** Name an item is spoken by in this call language: the approved Swahili name, else the English name verbatim. */
function nameFor(it, lang) { return (isSw(lang) && it && it.say_sw) || (it && (it.say_en || it.name)) || null; }

function build(profile) {
  const h = LIVE.handle(profile);
  if (!h) {
    return {
      mode: 'legacy', handle: null, version: null,
      services: () => profile.servicesCatalog,
      products: () => profile.productCatalog,
      offered: () => null, groups: () => [], openerNames: () => [], openerLine: () => null,
      promptBlock: () => null, knownNumbers: () => new Set(), notesForPrompt: (legacy) => legacy,
      findForCaller: () => null, findOff: () => null, nameFor, nameLock: (s) => ({ ok: true, text: s, hits: [] }),
      lockedNames: () => [], greetingFields: (p = profile) => ({ servicesCatalog: p.servicesCatalog, servicesOffered: p.servicesOffered }),
    };
  }
  const doc = h.doc;
  const items = doc.items || [];
  const off = Array.isArray(doc.off) ? doc.off : [];
  const groups = () => (h.categories || []).filter((c) => c.count > 0 && c.name).map((c) => ({ id: c.id, say_en: c.say_en || c.name.toLowerCase(), say_sw: c.say_sw || null, name: c.name, count: c.count }));
  const groupName = (g, lang) => (isSw(lang) && g.say_sw) || g.say_en;
  // Hick rule 1 / Q3 default: the greeting may name groups (categories), never single items; one group = no names
  const openerNames = (lang = 'en', n = 3) => { const gs = groups(); return gs.length > 1 ? gs.slice(0, n).map((g) => groupName(g, lang)) : []; };
  const openerLine = (lang = 'en') => {
    const ns = openerNames(lang); if (!ns.length) return null;
    return isSw(lang) ? `Tunasaidia na ${joinList(ns, 'sw')}.` : `We help with ${joinList(ns, 'en')}.`;
  };
  // the prompt carries locked names only (per call language), grouped, never prices (price only on pick)
  // a big catalogue keeps the compile's cap (index mode 'categories', ~1,500 tokens): groups with counts + popular picks
  const promptBlock = (lang = 'en') => {
    if (doc.index && doc.index.mode === 'categories') {
      const pop = items.filter((x) => x.popular).slice(0, 20).map((x) => nameFor(x, lang));
      return [...groups().slice(0, 60).map((g) => `${groupName(g, lang)} (${g.count})`), ...(pop.length ? [`popular: ${pop.join('; ')}`] : [])].join('\n') || null;
    }
    const byCat = new Map();
    for (const x of items) { const k = x.cat || '_other'; if (!byCat.has(k)) byCat.set(k, []); byCat.get(k).push(nameFor(x, lang)); }
    const named = new Map(groups().map((g) => [g.id, groupName(g, lang)]));
    return [...byCat].map(([k, ns]) => (named.has(k) ? `${named.get(k)}: ${ns.join('; ')}` : ns.join('; '))).join('\n') || null;
  };
  const notesForPrompt = () => {
    const d = items.filter((x) => x.desc).slice(0, 20).map((x) => `${x.say_en}: ${x.desc}`);
    return d.length ? d.join('\n') : null;
  };
  /** One lookup for a caller's words: an offered item (active), else a paused / not-offered item named in full. */
  function findForCaller(text) {
    const f = h.find(text);
    const o = h.findOff ? h.findOff(text) : null;
    const namedLen = f.named ? tokens(f.named.name).filter((w) => !GENERIC.has(w)).length : 0;
    if (o && (!f.named || o.len > namedLen)) return { item: o.item, state: o.item.state, score: o.len, also: f.named || null };
    if (f.named) return { item: f.named, state: 'active', score: namedLen, also: o ? o.item : null };
    if (f.category) return { category: f.category, state: 'active', score: 0.5, item: null };
    return null;
  }
  // ---- name lock: every catalogue reference in a spoken sentence must be the locked name for the call language
  const ALL = [...items.map((x) => ({ x, active: true })), ...off.map((x) => ({ x, active: false }))];
  const byKey = new Map();
  for (const e of ALL) {
    const ks = tokens(e.x.name || e.x.say_en);
    if (!ks.length || !ks.some((k) => !GENERIC.has(k))) continue;
    const k = keyOf(ks); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(e.x);
  }
  // offered items only: a paused / not-offered name never reaches the prompt (it is spoken only from a receipt)
  const lockedNames = (lang = 'en') => items.map((x) => nameFor(x, lang)).filter(Boolean);
  /**
   * nameLock(sentence, lang) -> { ok, text, hits:[{said, locked}] , ambiguous }
   * Allowed: the locked name (approved SW name in a Swahili call, else the EN name verbatim; the EN name is also
   * accepted in a Swahili call). Any other phrase that names a catalogue item (same normalised name words, e.g. a
   * made-up "usafi wa kina" for "Deep clean") is an invented name: text has it swapped for the locked name.
   */
  // allowed spoken forms per language, indexed by their first word (a 10k catalogue stays a few lookups per word)
  const ALLOWED = new Map();
  const allowedFor = (lang) => {
    const k = isSw(lang) ? 'sw' : 'en';
    if (ALLOWED.has(k)) return ALLOWED.get(k);
    const idx = new Map();
    for (const e of ALL) for (const nm of new Set([nameFor(e.x, k), e.x.say_en, e.x.name].filter(Boolean))) {
      const a = surface(nm); if (!a.length) continue;
      const f = sstem(a[0]); if (!idx.has(f)) idx.set(f, []); idx.get(f).push(a);
    }
    for (const l of idx.values()) l.sort((x, y) => y.length - x.length);
    ALLOWED.set(k, idx); return idx;
  };
  function nameLock(sentence, lang = 'en') {
    const s = String(sentence || '');
    const raw = [...s.matchAll(/[A-Za-z0-9\u00C0-\u024F']+/g)].map((m) => ({ w: surface(m[0])[0] || '', i: m.index, end: m.index + m[0].length })).filter((t) => t.w);
    const words = raw.map((t) => t.w);
    const used = new Array(words.length).fill(false);
    const idx = allowedFor(lang);
    for (let i = 0; i < words.length; i++) {
      if (used[i]) continue;
      for (const a of idx.get(sstem(words[i])) || []) {
        if (i + a.length > words.length || used.slice(i, i + a.length).some(Boolean)) continue;
        if (sameSurface(words.slice(i, i + a.length), a)) { for (let j = i; j < i + a.length; j++) used[j] = true; break; }
      }
    }
    const hits = []; let ambiguous = false;
    const content = (w) => tokens(w).length > 0;
    for (let len = 7; len >= 1; len--) {
      for (let i = 0; i + len <= words.length; i++) {
        if (used.slice(i, i + len).some(Boolean)) continue;
        if (!content(words[i]) || !content(words[i + len - 1])) continue;
        const ks = tokens(words.slice(i, i + len).join(' '));
        if (!ks.length) continue;
        const cands = byKey.get(keyOf(ks));
        if (!cands) continue;
        if (cands.length > 1) ambiguous = true;
        hits.push({ from: raw[i].i, to: raw[i + len - 1].end, said: s.slice(raw[i].i, raw[i + len - 1].end), locked: nameFor(cands[0], lang) });
        for (let j = i; j < i + len; j++) used[j] = true;
      }
    }
    if (!hits.length) return { ok: true, text: s, hits: [] };
    let out = s;
    for (const hh of [...hits].sort((a, b) => b.from - a.from)) out = out.slice(0, hh.from) + hh.locked + out.slice(hh.to);
    return { ok: false, text: out, hits: hits.map(({ said, locked }) => ({ said, locked })), ambiguous };
  }
  const projection = { servicesCatalog: profile.servicesCatalog, productCatalog: profile.productCatalog };
  return {
    mode: 'kb', handle: h, version: profile.kb.version ?? null,
    services: () => profile.servicesCatalog, // the attach projection: offered (active) items only
    products: () => profile.productCatalog,
    offered: () => items.slice(),
    groups, openerNames, openerLine, promptBlock,
    knownNumbers: () => LIVE.knownNumbers(profile),
    notesForPrompt,
    findForCaller, findOff: (t) => (h.findOff ? h.findOff(t) : null),
    nameFor, nameLock, lockedNames,
    // greeting inputs: groups only (never items, never the old free text)
    greetingFields: () => ({ servicesCatalog: [], servicesOffered: '', offeringLine: openerLine('en') || '' }),
    _projection: projection,
  };
}

/** catalogueSource(profile): memoised per profile object (one call = one profile = one mode). */
function catalogueSource(profile) {
  if (!profile || typeof profile !== 'object') return build({});
  const h = LIVE.handle(profile);
  const m = MEMO.get(profile);
  if (m && m.handle === h) return m;
  const s = build(profile);
  MEMO.set(profile, s);
  return s;
}
const isKb = (profile) => catalogueSource(profile).mode === 'kb';

module.exports = { catalogueSource, isKb, nameFor, surface };
