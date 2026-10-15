'use strict';
// Speech-ready knowledge base ("spoken catalogue"), one per tenant.
//
// Built at knowledge compile / onboarding from the tenant's raw catalogue:
//   1. a deterministic baseline (always available, no network),
//   2. an optional AI pass (injected `generate`) whose output is schema-checked
//      field by field; any field that fails falls back to the baseline and is
//      flagged for owner review.
// Prices are never authored by the model: they are parsed from the raw
// catalogue and only re-worded. Stored as tenant data with a sourceHash so it
// regenerates when the catalogue changes; per-entry rowHash keeps owner edits
// on rows that did not change. Status: draft -> approved (owner, Desk UI later).
//
// Same code path for every tenant. No tenant ids, no per-tenant tables of words.
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const LANGS = ['en', 'sw'];

// ---------- hashing ----------
function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
function rawRows(profile = {}) {
  const svc = (profile.servicesCatalog || []).map((s) => ({ kind: 'service', name: s.name || '', category: s.category || '', notes: s.notes || s.description || '', price: s.price_range || s.price || '' }));
  const prd = (profile.productCatalog || []).map((p) => ({ kind: 'product', name: p.name || '', category: p.category || '', notes: p.notes || p.description || '', price: p.price != null ? String(p.price) : '' }));
  return [...svc, ...prd].filter((r) => r.name);
}
function rawAreas(profile = {}) {
  const ids = (profile.serviceAreas?.areas || []).map((a) => a.name || String(a.id || '').split(':').pop());
  const locs = (profile.businessLocations || []).map((l) => l.area || l.name || '').filter(Boolean);
  return [...new Set([...ids, ...locs].map((x) => String(x || '').trim().toLowerCase()).filter(Boolean))].sort();
}
function sourceHash(profile = {}) { return sha(stableJson({ v: SCHEMA_VERSION, rows: rawRows(profile), areas: rawAreas(profile) })); }
const rowHash = (row) => sha(stableJson(row)).slice(0, 16);
const slug = (s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 48) || 'item';

// ---------- deterministic baseline ----------
const cleanName = (s) => String(s || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s*[-–]\s*$/, '').replace(/\s+/g, ' ').trim();
// General Kenyan service vocabulary (not tenant data). Longest phrase first.
const SW_WORDS = [
  ['post-construction', 'baada ya ujenzi'], ['move-in / move-out', 'kuhamia au kuhama'], ['move-in', 'kuhamia'], ['move-out', 'kuhama'],
  ['deep cleaning', 'usafi wa kina'], ['deep clean', 'usafi wa kina'], ['housekeeping', 'kazi za nyumbani'], ['fumigation', 'kunyunyizia dawa'], ['pest control', 'kuua wadudu'],
  ['refrigerator', 'friji'], ['fridge', 'friji'], ['oven', 'oveni'], ['mattress', 'godoro'], ['carpet', 'zulia'], ['rug', 'zulia'], ['sofa', 'sofa'], ['couch', 'sofa'], ['curtain', 'mapazia'], ['window', 'madirisha'], ['car', 'gari'],
  ['bedroom', 'vyumba'], ['apartment', 'nyumba'], ['house', 'nyumba'], ['home', 'nyumba'], ['office', 'ofisi'], ['commercial', 'biashara'], ['kitchen', 'jikoni'], ['laundry', 'kufua nguo'],
  ['hourly', 'kwa saa'], ['small', 'ndogo'], ['medium', 'ya kati'], ['large', 'kubwa'], ['contract', 'mkataba'], ['seat', 'kiti'], ['clean', 'usafi'], ['cleaning', 'usafi'], ['wash', 'kuosha'],
];
const NUM_EN = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
function enNameRules(name) {
  let n = cleanName(name).replace(/\s+na\s+/gi, ' and ').replace(/\s*\/\s*/g, ' and ').replace(/\b(standard|package|add-on)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  n = n.replace(/\b(\d)\s*-\s*(bed(room)?)/gi, (_, d, b) => `${NUM_EN[Number(d)] || d}-${b.toLowerCase()}`);
  n = n.replace(/\bclean$/i, 'cleaning');
  if (!/clean|wash|housekeep|fumigat|pest|laundry|contract/i.test(n)) n += ' cleaning';
  return n.split(/\s+/).map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ').trim();
}
const NUM_SW = { 1: 'cha', 2: 'viwili', 3: 'vitatu', 4: 'vinne', 5: 'vitano' };
function swNameRules(name) {
  const n = cleanName(name).toLowerCase();
  const bed = n.match(/(\d)\s*-?\s*bed(room)?/);
  if (bed) { const k = Number(bed[1]); return { text: k === 1 ? 'usafi wa nyumba ya chumba kimoja' : `usafi wa nyumba ya vyumba ${NUM_SW[k] || bed[1]}`, review: null }; }
  const hits = [];
  let rest = n;
  for (const [en, sw] of SW_WORDS) {
    const re = new RegExp(`\\b${en.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}s?\\b`, 'i');
    if (re.test(rest)) { hits.push(sw); rest = rest.replace(re, ' '); }
  }
  const leftover = rest.replace(/\b(standard|package|service|services|the|and|of|for|per|unit|up|to|add-on|sq|ft|interior|internal|\d[\d,]*)\b/g, ' ').replace(/[^a-z]+/g, ' ').trim();
  const nouns = [...new Set(hits)].filter((h) => !/^(usafi|kuosha|kwa saa|ndogo|ya kati|kubwa)$/.test(h));
  const size = hits.find((h) => /^(ndogo|ya kati|kubwa)$/.test(h));
  rest = rest.replace(/\b(na|and)\b/g, ' ');
  const leftover2 = rest.replace(/\b(standard|package|service|services|the|and|of|for|per|unit|up|to|add-on|sq|ft|interior|internal|na|\d[\d,]*)\b/g, ' ').replace(/[^a-z]+/g, ' ').trim();
  if (!nouns.length || leftover2) return { text: null, review: leftover2 ? `untranslated:${leftover2}` : 'no_noun' };
  const verb = hits.includes('kuosha') ? 'kuosha' : 'usafi wa';
  const deep = nouns.includes('usafi wa kina');
  const objs = nouns.filter((x) => x !== 'usafi wa kina' && x !== 'mkataba');
  const head = verb === 'kuosha' ? `kuosha ${objs.join(' na ')}` : deep ? (objs.length ? `usafi wa kina wa ${objs.join(' na ')}` : 'usafi wa kina') : `usafi wa ${objs.join(' ')}`;
  return { text: `${head}${size ? ` ${size}` : ''}${hits.includes('kwa saa') ? ' kwa saa' : ''}`.replace(/\s+/g, ' ').trim(), review: null };
}
const CATS = [
  [/office|commercial|contract/i, { en: 'office cleaning', sw: 'usafi wa ofisi' }],
  [/mattress|sofa|couch|carpet|rug|curtain|seat/i, { en: 'sofa and carpet cleaning', sw: 'usafi wa sofa na zulia' }],
  [/construction|move-?in|move-?out|deep|fridge|refrigerator|oven/i, { en: 'deep cleaning', sw: 'usafi wa kina' }],
  [/bed|apartment|house|home|housekeep|laundry|window/i, { en: 'home cleaning', sw: 'usafi wa nyumba' }],
  [/fumigat|pest/i, { en: 'pest control', sw: 'kuua wadudu' }],
  [/car\b|vehicle/i, { en: 'car wash', sw: 'kuosha magari' }],
];
function categoryRules(row) {
  for (const [re, c] of CATS) if (re.test(row.name)) return { id: slug(c.en), ...c };
  const raw = cleanName(row.category || 'other');
  return { id: slug(raw), en: raw.toLowerCase(), sw: null };
}
const money = (s) => s.replace(/,/g, '').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
const fmt = (n) => n.toLocaleString('en-US');
function priceRules(raw) {
  const s = String(raw || '').trim();
  if (!s) return { en: null, sw: null, numbers: [] };
  if (/custom\s+quote|on\s+request|quote/i.test(s)) return { en: 'a custom quote after the team checks the job', sw: 'bei maalum baada ya timu kukagua kazi', numbers: [], quote: true };
  const nums = money(s);
  const unit = /per\s+hour|\/\s*hr|hourly/i.test(s) ? ['an hour', 'kwa saa'] : /per\s+sq\.?\s*ft/i.test(s) ? ['per square foot', 'kwa futi mraba'] : /per\s+visit/i.test(s) ? ['per visit', 'kwa kila ziara'] : /per\s+seat/i.test(s) ? ['per seat', 'kwa kiti'] : /per\s+room/i.test(s) ? ['per room', 'kwa chumba'] : /per\s+window/i.test(s) ? ['per window', 'kwa dirisha'] : /per\s+unit/i.test(s) ? ['each', 'kila moja'] : null;
  const min = s.match(/min(?:imum)?\.?\s*(\d+)\s*hours?/i);
  const base = /^base\s*\+/i.test(s);
  const from = /^from\b/i.test(s);
  const amt = nums.filter((n) => !(min && n === Number(min[1])) && !(/\(\s*\d-?bed/i.test(s) && n < 10));
  if (!amt.length) return { en: null, sw: null, numbers: [] };
  const [a, b] = amt;
  let en; let sw;
  if (base) { en = `the base price plus ${fmt(a)}${b ? ` to ${fmt(b)}` : ''} shillings`; sw = `bei ya msingi ukiongeza shilingi ${fmt(a)}${b ? ` hadi ${fmt(b)}` : ''}`; }
  else if (b && /-|to/i.test(s)) { en = `${fmt(a)} to ${fmt(b)} shillings`; sw = `shilingi ${fmt(a)} hadi ${fmt(b)}`; }
  else { en = `${from ? 'from ' : ''}${fmt(a)} shillings`; sw = `${from ? 'kuanzia ' : ''}shilingi ${fmt(a)}`; }
  if (unit) { en += ` ${unit[0]}`; sw += ` ${unit[1]}`; }
  if (min) { en += `, minimum ${min[1]} hours`; sw += `, angalau saa ${min[1]}`; }
  return { en, sw, numbers: amt };
}
function explainRules(row) {
  const n = String(row.notes || '').replace(/\s+/g, ' ').trim();
  if (!n || /\d/.test(n) || n.split(/\s+/).length < 2) return { en: null, sw: null };
  const parts = n.split(/[,;]/).map((x) => x.trim().replace(/\//g, ' and ').toLowerCase()).filter(Boolean).slice(0, 3);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  const nm = enNameRules(row.name);
  return { en: `${nm.charAt(0).toUpperCase()}${nm.slice(1)} covers ${list}.`, sw: null };
}

// ---------- coverage + ambiguity ----------
let PLACES = null;
function placeIndex() {
  if (!PLACES) { try { PLACES = require('../conversation/data/kenyaPlaceCounties.json'); } catch { PLACES = { places: {} }; } }
  return PLACES;
}
const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
function coverageRules(profile) {
  const idx = placeIndex();
  const keys = Object.keys(idx.places || {});
  const places = rawAreas(profile).map((a) => {
    const longer = keys.filter((k) => k !== a && new RegExp(`(^|\\s)${a.replace(/[^a-z ]/g, '')}$`).test(k));
    const counties = [].concat(idx.places?.[a] || []).map(String);
    const canonical = longer.length === 1 ? longer[0] : a;
    return { key: a, canonical: titleCase(canonical), aliases: [...new Set([a, canonical])], counties };
  });
  const groups = [];
  for (const p of places) {
    const members = [...new Set([p.key, ...p.aliases])];
    const multiCounty = p.counties.length > 1;
    if (members.length > 1 || multiCounty) groups.push({ id: slug(p.key), heard: p.key, options: members.map(titleCase), counties: p.counties, reason: multiCounty ? 'same_name_many_counties' : 'short_and_full_name' });
  }
  return { places, ambiguityGroups: groups };
}

// ---------- AI pass (validated) ----------
const AI_SCHEMA = {
  type: 'object', required: ['entries'],
  properties: { entries: { type: 'array', items: { type: 'object', required: ['id'], properties: {
    id: { type: 'string' }, name_en: { type: 'string' }, name_sw: { type: 'string' }, category_en: { type: 'string' }, category_sw: { type: 'string' }, explain_en: { type: 'string' }, explain_sw: { type: 'string' },
  } } } },
};
function aiPrompt(rows) {
  return [
    'You turn a business catalogue into words a phone receptionist can say aloud in Kenya.',
    'For each entry return: name_en, name_sw (natural Kiswahili, no English words unless they are the everyday Kenyan word, e.g. sofa), category_en and category_sw (plain, 1-4 words, shared across similar entries), explain_en and explain_sw (one short sentence on what is done).',
    'Do NOT write prices, numbers, sizes in digits, promises or availability. Keep every id exactly as given. Return JSON matching the schema.',
    JSON.stringify(rows.map((r) => ({ id: r.id, name: r.name, category: r.category, notes: r.notes }))),
  ].join('\n');
}
const DIGIT = /\d/;
const BANNED = /\b(guarantee|free|discount|available|today|tomorrow|always|best)\b/i;
function checkField(key, v, row) {
  if (typeof v !== 'string') return 'missing';
  const t = v.trim();
  if (!t) return 'empty';
  const max = key.startsWith('explain') ? 160 : 60;
  if (t.length > max) return 'too_long';
  if (DIGIT.test(t) && !(key.startsWith('name') && DIGIT.test(row.name))) return 'digits';
  if (BANNED.test(t)) return 'claim_word';
  if (key.endsWith('_sw') && key.startsWith('name') && cleanName(row.name).toLowerCase() === t.toLowerCase() && /[a-z]{4,}/i.test(t) && !/sofa/i.test(t)) return 'raw_english_in_sw';
  if (key.startsWith('explain') && !/[.!?]$/.test(t)) return 'not_sentence';
  return null;
}

// ---------- compile ----------
async function compileSpokenCatalogue(profile = {}, { generate = null, previous = null, now = new Date() } = {}) {
  const rows = rawRows(profile).map((r) => ({ ...r, id: `${r.kind === 'product' ? 'prd' : 'svc'}_${slug(r.name)}`, rowHash: rowHash(r) }));
  const issues = [];
  let ai = null; let aiError = null;
  if (typeof generate === 'function' && rows.length) {
    try { ai = await generate({ prompt: aiPrompt(rows), schema: AI_SCHEMA }); } catch (e) { aiError = String(e?.message || e).slice(0, 120); }
  }
  const aiById = new Map((Array.isArray(ai?.entries) ? ai.entries : []).filter((e) => e && typeof e.id === 'string').map((e) => [e.id, e]));
  for (const id of aiById.keys()) if (!rows.some((r) => r.id === id)) issues.push({ id, field: 'id', code: 'unknown_id_dropped' });
  const prevById = new Map((previous?.entries || []).map((e) => [e.id, e]));
  const entries = rows.map((r) => {
    const prev = prevById.get(r.id);
    if (prev && prev.rowHash === r.rowHash && (prev.edited || prev.status === 'approved')) return { ...prev, carried: true };
    const cat = categoryRules(r); const sw = swNameRules(r.name); const ex = explainRules(r); const price = priceRules(r.price);
    const base = { name_en: enNameRules(r.name), name_sw: sw.text, category_en: cat.en, category_sw: cat.sw, explain_en: ex.en, explain_sw: ex.sw };
    const got = aiById.get(r.id) || {};
    const out = {}; const src = {};
    for (const k of Object.keys(base)) {
      const bad = got[k] == null ? 'missing' : checkField(k, got[k], r);
      if (!bad) { out[k] = got[k].trim(); src[k] = 'ai'; } else { out[k] = base[k]; src[k] = 'rules'; if (ai && got[k] != null) issues.push({ id: r.id, field: k, code: bad }); }
      if (out[k] == null) issues.push({ id: r.id, field: k, code: k === 'name_sw' && sw.review ? sw.review : 'needs_owner_text' });
    }
    return {
      id: r.id, kind: r.kind, rowHash: r.rowHash, raw: { name: r.name, price: r.price },
      spoken: { en: out.name_en, sw: out.name_sw }, category: { id: slug(out.category_en || cat.en), en: out.category_en, sw: out.category_sw },
      explain: { en: out.explain_en, sw: out.explain_sw }, price: { en: price.en, sw: price.sw, numbers: price.numbers },
      source: src, status: 'draft', edited: false,
    };
  });
  const categories = [];
  for (const e of entries) {
    let c = categories.find((x) => x.id === e.category.id);
    if (!c) { c = { id: e.category.id, en: e.category.en, sw: e.category.sw, entryIds: [] }; categories.push(c); }
    c.entryIds.push(e.id);
  }
  const anyChanged = entries.some((e) => !e.carried);
  return {
    schemaVersion: SCHEMA_VERSION, tenantId: profile.tenantId || null,
    version: (previous?.version || 0) + (previous && !anyChanged && previous.sourceHash === sourceHash(profile) ? 0 : 1),
    sourceHash: sourceHash(profile), generatedAt: now.toISOString(), generator: ai ? 'ai+rules' : 'rules', aiError,
    status: previous && !anyChanged && previous.status === 'approved' ? 'approved' : 'draft',
    entries: entries.map(({ carried, ...e }) => e), categories, coverage: coverageRules(profile), issues,
  };
}
const needsRegeneration = (stored, profile) => !stored || stored.schemaVersion !== SCHEMA_VERSION || stored.sourceHash !== sourceHash(profile);
// Owner edit: one field of one entry. Edited rows survive regeneration while their raw row is unchanged.
function applyOwnerEdit(sc, { id, field, lang, value }) {
  const e = sc.entries.find((x) => x.id === id);
  if (!e || !['spoken', 'category', 'explain'].includes(field) || !LANGS.includes(lang)) throw new Error('spoken catalogue: bad edit');
  e[field][lang] = String(value || '').trim() || null; e.edited = true; e.status = 'draft'; sc.status = 'draft';
  return sc;
}
function approve(sc, { by = null, at = new Date() } = {}) {
  for (const e of sc.entries) e.status = 'approved';
  return Object.assign(sc, { status: 'approved', approvedBy: by, approvedAt: at.toISOString() });
}
// Read side. A field is speakable only if it exists in that language; callers never fall back to the raw name in sw.
function spokenName(e, lang) { return e?.spoken?.[lang === 'sw' ? 'sw' : 'en'] || null; }

// Runtime: stored row if it matches the current catalogue, else the rules baseline (memoised by hash, sync).
const MEMO = new Map();
function compileRulesSync(profile) {
  const h = sourceHash(profile);
  if (MEMO.has(h)) return MEMO.get(h);
  const out = compileSync(profile);
  if (MEMO.size > 200) MEMO.clear();
  MEMO.set(h, out);
  return out;
}
function compileSync(profile) {
  // Same as compileSpokenCatalogue without AI, written sync for the call path.
  const rows = rawRows(profile).map((r) => ({ ...r, id: `${r.kind === 'product' ? 'prd' : 'svc'}_${slug(r.name)}`, rowHash: rowHash(r) }));
  const entries = rows.map((r) => {
    const cat = categoryRules(r); const sw = swNameRules(r.name); const ex = explainRules(r); const price = priceRules(r.price);
    return { id: r.id, kind: r.kind, rowHash: r.rowHash, raw: { name: r.name, price: r.price }, spoken: { en: enNameRules(r.name), sw: sw.text }, category: { id: cat.id, en: cat.en, sw: cat.sw }, explain: ex, price, source: {}, status: 'draft', edited: false };
  });
  const categories = [];
  for (const e of entries) { let c = categories.find((x) => x.id === e.category.id); if (!c) { c = { id: e.category.id, en: e.category.en, sw: e.category.sw, entryIds: [] }; categories.push(c); } c.entryIds.push(e.id); }
  return { schemaVersion: SCHEMA_VERSION, tenantId: profile.tenantId || null, version: 0, sourceHash: sourceHash(profile), generator: 'rules', status: 'draft', entries, categories, coverage: coverageRules(profile), issues: [] };
}
function resolveSpokenCatalogue(profile = {}) {
  const stored = profile.spokenCatalogue;
  if (stored && !needsRegeneration(stored, profile)) return stored;
  return compileRulesSync(profile);
}

module.exports = { SCHEMA_VERSION, AI_SCHEMA, sourceHash, compileSpokenCatalogue, compileSync, needsRegeneration, applyOwnerEdit, approve, spokenName, resolveSpokenCatalogue, priceRules, swNameRules, coverageRules, checkField, slug };
