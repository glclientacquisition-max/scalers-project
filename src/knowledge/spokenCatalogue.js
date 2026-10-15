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
// regenerates when the catalogue changes; per-field hashes (text vs price) keep owner edits
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
  const svc = (profile.servicesCatalog || []).map((s) => ({ kind: 'service', sid: s.id || null, name: s.name || '', category: s.category || '', notes: s.notes || s.description || '', price: s.price_range || s.price || '', unit: s.pricing?.unit || '', priceConfirmed: s.pricing ? s.pricing.confirmed !== false : true }));
  const prd = (profile.productCatalog || []).map((p) => ({ kind: 'product', sid: p.id || null, name: p.name || '', category: p.category || '', notes: p.notes || p.description || '', price: p.price != null ? String(p.price) : '' }));
  return [...svc, ...prd].filter((r) => r.name);
}
function rawAreas(profile = {}) {
  const ids = (profile.serviceAreas?.areas || []).map((a) => a.name || String(a.id || '').split(':').pop());
  const locs = (profile.businessLocations || []).map((l) => l.area || l.name || '').filter(Boolean);
  return [...new Set([...ids, ...locs].map((x) => String(x || '').trim().toLowerCase()).filter(Boolean))].sort();
}
function sourceHash(profile = {}) { return sha(stableJson({ v: SCHEMA_VERSION, rows: rawRows(profile), areas: rawAreas(profile) })); }
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
  // Whole-phrase forms a Kenyan caller says (checked before word-by-word).
  if (/housekeeping/.test(n)) return { text: `kazi za nyumbani${/hourly/.test(n) ? ' kwa saa' : ''}`, review: null };
  if (/commercial/.test(n)) return { text: `usafi wa maofisi makubwa${/contract/.test(n) ? ' kwa mkataba' : ''}`, review: null };
  if (/move-?in|move-?out/.test(n)) return { text: 'usafi wa nyumba unapohamia au kuhama', review: null };
  if (/post-?construction/.test(n)) return { text: 'usafi baada ya ujenzi', review: null };
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
// Category cut agreed with Brain (HD_89aa48bf657f): items (mattresses/sofas/carpets),
// house cleaning by size, deep cleaning, offices. Labels are built from the members.
const CATS = [
  ['items', /mattress|sofa|carpet|rug|curtain|window|refrigerator|fridge|oven|couch/i],
  ['house', /bedroom|house|apartment|housekeeping|studio|home/i],
  ['deep', /deep|move-?in|move-?out|post-?construction|fumigat/i],
  ['office', /office|commercial|contract/i],
];
const ITEM_WORDS = { mattress: ['mattresses', 'magodoro'], sofa: ['sofas', 'sofa'], carpet: ['carpets', 'mazulia'], rug: ['rugs', 'mazulia'], curtain: ['curtains', 'mapazia'], window: ['windows', 'madirisha'], refrigerator: ['fridges', 'friji'], fridge: ['fridges', 'friji'], oven: ['ovens', 'oveni'] };
const andList = (xs, w) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${w} ${xs[xs.length - 1]}`);
function categoryKey(row) { const c = CATS.find(([, re]) => re.test(row.name)); return c ? c[0] : `raw_${slug(row.name)}`; }
function categoryLabel(key, rawNames) {
  if (key === 'items') {
    const ws = [...new Set(Object.entries(ITEM_WORDS).filter(([k]) => rawNames.some((n) => new RegExp(`\\b${k}`, 'i').test(n))).map(([, v]) => v.join('|')))].map((v) => v.split('|')).slice(0, 4);
    return { en: ws.map((w) => w[0]).join(', '), sw: `usafi wa ${ws.map((w) => w[1]).join(', ')}` };
  }
  if (key === 'house') return { en: 'house cleaning by size', sw: 'usafi wa nyumba kulingana na ukubwa' };
  if (key === 'deep') return { en: 'deep cleaning, like move-in or after building work', sw: 'usafi wa kina, kama wa kuhamia au baada ya ujenzi' };
  if (key === 'office') return { en: 'offices', sw: 'usafi wa maofisi' };
  return { en: null, sw: null };
}
const money = (s) => s.replace(/,/g, '').match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
const fmt = (n) => n.toLocaleString('en-US');
function priceRules(raw, { name = '', unit: unitHint = '', ownerApproved = false } = {}) {
  let s = String(raw || '').trim();
  // Unit kept: from the price text, else the structured unit, else the name '(per seat)'.
  if (s && !/per\s|\/\s*hr|hourly|m²/i.test(s)) { const u = unitHint === 'sqm' ? 'per m²' : unitHint ? `per ${unitHint}` : (String(name).match(/\((per\s+[a-z ]+?)\)/i) || [])[1] || (/\bhourly\b/i.test(name) ? 'per hour' : null); if (u) s = `${s} ${u}`; }
  if (!s) return { en: null, sw: null, numbers: [] };
  if (/custom\s+quote|on\s+request|quote/i.test(s)) return { en: 'a custom quote after the team checks the job', sw: 'bei maalum baada ya timu kukagua kazi', numbers: [], quote: true };
  const nums = money(s);
  const unit = /per\s+hour|\/\s*hr|hourly/i.test(s) ? ['an hour', 'kwa saa'] : /per\s+sq\.?\s*ft|per\s+square\s+f(oo|ee)t/i.test(s) ? ['per square foot', 'kwa futi mraba'] : /per\s+(sq\.?\s*m\b|m²|m2|sqm|square\s+met(er|re))/i.test(s) ? ['per square metre', 'kwa mita mraba'] : /per\s+visit/i.test(s) ? ['per visit', 'kwa kila ziara'] : /per\s+seat/i.test(s) ? ['per seat', 'kwa kiti'] : /per\s+room/i.test(s) ? ['per room', 'kwa chumba'] : /per\s+window/i.test(s) ? ['per window', 'kwa dirisha'] : /per\s+unit/i.test(s) ? ['each', 'kila moja'] : null;
  const min = s.match(/min(?:imum)?\.?\s*(\d+)\s*hours?/i);
  const base = /^base\s*\+/i.test(s);
  const from = /^from\b/i.test(s);
  const amt = nums.filter((n) => !(min && n === Number(min[1])) && !(/\(\s*\d-?bed/i.test(s) && n < 10));
  if (!amt.length) return { en: null, sw: null, numbers: [] };
  // An amount under KSh 100 is not spoken (e.g. 'KSh 40' for a whole job): owner confirms first.
  // An owner-approved price (priceStatus 'approved', same price hash) is spoken as written.
  if (!ownerApproved && amt.some((n) => n < 100)) return { en: null, sw: null, numbers: amt, review: 'odd_price' };
  const [a, b] = amt;
  let en; let sw;
  if (base) { en = `the base price plus ${fmt(a)}${b ? ` to ${fmt(b)}` : ''} shillings`; sw = `bei ya msingi ukiongeza shilingi ${fmt(a)}${b ? ` hadi ${fmt(b)}` : ''}`; }
  else if (b && /-|to/i.test(s)) { en = `${fmt(a)} to ${fmt(b)} shillings`; sw = `shilingi ${fmt(a)} hadi ${fmt(b)}`; }
  else { en = `${from ? 'from ' : ''}${fmt(a)} shillings`; sw = `${from ? 'kuanzia ' : ''}shilingi ${fmt(a)}`; }
  if (unit) { en += ` ${unit[0]}`; sw += ` ${unit[1]}`; }
  if (min) { en += `, minimum ${min[1]} hours`; sw += `, angalau saa ${min[1]}`; }
  return { en, sw, numbers: amt };
}
const NUM_SW_KULALA = { 1: 'cha kulala kimoja', 2: 'vya kulala viwili', 3: 'vya kulala vitatu', 4: 'vya kulala vinne' };
function explainRules(row) {
  const n = String(row.name || '');
  const bed = n.match(/(\d)\s*-?\s*bed(room)?/i);
  if (bed) return { en: `It means cleaning a ${NUM_EN[bed[1]] || bed[1]}-bedroom home: dusting, mopping, the bathroom and the kitchen.`, sw: `Ni usafi wa nyumba yenye chumba ${NUM_SW_KULALA[bed[1]] || bed[1]}: kufagia, kupiga deki, bafu na jikoni.`.replace('chumba vya', 'vyumba vya') };
  if (/move-?in|move-?out/i.test(n)) return { en: 'It means a full clean of a home when you move in or move out.', sw: 'Ni usafi kamili wa nyumba unapohamia au kuhama.' };
  if (/post-?construction/i.test(n)) return { en: 'It means cleaning up after building or renovation work: dust and debris.', sw: 'Ni usafi baada ya ujenzi au ukarabati, kuondoa vumbi na uchafu.' };
  const item = n.match(/\b(refrigerator|fridge|oven)\b/i);
  if (item) { const w = /oven/i.test(item[1]) ? ['oven', 'oveni'] : ['fridge', 'friji']; return { en: `It means cleaning the inside of your ${w[0]}.`, sw: `Ni usafi wa ndani wa ${w[1]}.` }; }
  if (/hourly/i.test(n)) return { en: 'It means a cleaner who comes and is paid by the hour.', sw: 'Ni msaidizi wa usafi anayelipwa kwa saa.' };
  if (/deep/i.test(n)) return { en: 'It means a more thorough clean than a standard one.', sw: 'Ni usafi wa kina zaidi ya usafi wa kawaida.' };
  const notes = String(row.notes || '').replace(/\s+/g, ' ').trim();
  const sw = swNameRules(n).text;
  const nm = enNameRules(n);
  if (!notes || /\d/.test(notes) || notes.split(/\s+/).length < 2) return { en: null, sw: sw ? `Ni ${sw}.` : null };
  const parts = notes.split(/[,;]/).map((x) => x.trim().replace(/\//g, ' and ').toLowerCase()).filter(Boolean).slice(0, 3);
  return { en: `${nm.charAt(0).toUpperCase()}${nm.slice(1)} covers ${andList(parts, 'and')}.`, sw: sw ? `Ni ${sw}.` : null };
}

// ---------- coverage ----------
const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());
function coverageRules(profile) {
  const { ambiguityFor, gazetteer } = require('../conversation/placeAmbiguity');
  const counties = new Set((profile.serviceAreas?.areas || []).map((a) => String(a.id || '')).filter((id) => id.startsWith('county:')).map((id) => id.slice(7).trim().toLowerCase()));
  const places = rawAreas(profile).map((a) => {
    const isCounty = counties.has(a);
    const g = isCounty ? null : ambiguityFor(a);
    const full = g ? g.options.filter((o) => o.toLowerCase() !== a) : [];
    return { key: a, kind: isCounty ? 'county' : 'place', canonical: titleCase(a.includes(' ') ? a : full.length === 1 ? full[0] : a), aliases: [...new Set([a, ...full.map((x) => x.toLowerCase())])] };
  });
  const G = gazetteer();
  const own = places.map((p) => (p.kind === 'place' ? ambiguityFor(p.key) : null)).filter(Boolean);
  // Groups inside a served county ("Rongai" for a Kajiado tenant) are listed too; all others stay in the shared gazetteer.
  const inCounty = G.groups.filter((g) => g.options.length > 1 && g.counties.some((c) => counties.has(c)));
  const ambiguityGroups = [...new Map([...own, ...inCounty].map((g) => [g.heard, g])).values()];
  return { places, ambiguityGroups, gazetteerVersion: G.version };
}

// ---------- AI pass (checked against the source) ----------
const AI_FIELDS = ['name_en', 'name_sw', 'explain_en', 'explain_sw'];
const AI_SCHEMA = {
  type: 'object', required: ['entries'],
  properties: { entries: { type: 'array', items: { type: 'object', required: ['id'], properties: Object.fromEntries([['id', { type: 'string' }], ...AI_FIELDS.map((k) => [k, { type: 'string' }])]) } } },
};
function aiPrompt(rows) {
  return [
    'You turn a business catalogue into words a phone receptionist can say aloud in Kenya.',
    'For each entry return name_en, name_sw (natural everyday Kiswahili a Kenyan caller understands; English only where it is the everyday Kenyan word, e.g. sofa), explain_en and explain_sw (one short sentence on what the service is, using ONLY what the name and notes say).',
    'Do NOT write prices, numbers in digits, promises, availability, or anything not in the notes. Keep every id exactly as given. Return JSON matching the schema.',
    JSON.stringify(rows.map((r) => ({ id: r.id, name: r.name, notes: r.notes }))),
  ].join('\n');
}
const DIGIT = /\d/;
const BANNED = /\b(guarantee\w*|free|discount\w*|available|today|tomorrow|always|best|book|shillings?|shilingi|ksh|bei|price)\b/i;
// Everyday words an explanation may add without inventing a service detail.
const EXPLAIN_OK = new Set('it means means cleaning clean cleaned covers covering includes including your their about service services home house homes room rooms when after before more than standard thorough full whole team cleaner cleaners where which with from into like such also other that this those these there here then them they while make makes made done doing using used ones each every'.split(' '));
const words = (t) => String(t || '').toLowerCase().match(/[a-z]{4,}/g) || [];
function stem(w) { return w.replace(/(ing|ed|es|s)$/, ''); }
function checkField(key, v, row) {
  if (typeof v !== 'string') return 'missing';
  const t = v.trim();
  if (!t) return 'empty';
  const max = key.startsWith('explain') ? 160 : 60;
  if (t.length > max) return 'too_long';
  if (DIGIT.test(t) && !(key.startsWith('name') && DIGIT.test(row.name))) return 'digits';
  if (BANNED.test(t)) return 'claim_word';
  if (key === 'name_sw' && cleanName(row.name).toLowerCase() === t.toLowerCase() && /[a-z]{4,}/i.test(t) && !/^sofa$/i.test(t)) return 'raw_english_in_sw';
  if (key.startsWith('explain') && !/[.!?]$/.test(t)) return 'not_sentence';
  if (key === 'explain_en') {
    const src = new Set(words(`${row.name} ${row.notes} ${row.category}`).map(stem));
    const extra = words(t).filter((w) => !EXPLAIN_OK.has(w) && !src.has(stem(w)));
    if (extra.length) return `invented_inclusion:${extra.slice(0, 3).join('/')}`;
  }
  return null;
}

// ---------- compile ----------
const textHash = (r) => sha(stableJson({ name: r.name, category: r.category, notes: r.notes })).slice(0, 16);
const priceHash = (r) => sha(stableJson({ price: r.price, unit: r.unit, ok: r.priceConfirmed })).slice(0, 16);
function prepRows(profile) {
  return rawRows(profile).map((r) => ({ ...r, id: r.sid || `${r.kind === 'product' ? 'prd' : 'svc'}_${slug(r.name)}`, hash: { text: textHash(r), price: priceHash(r) } }));
}
function buildDoc(profile, rows, { ai = null, aiError = null, previous = null, now = new Date() } = {}) {
  const issues = [];
  const aiById = new Map((Array.isArray(ai?.entries) ? ai.entries : []).filter((e) => e && typeof e.id === 'string').map((e) => [e.id, e]));
  for (const id of aiById.keys()) if (!rows.some((r) => r.id === id)) issues.push({ id, field: 'id', code: 'unknown_id_dropped' });
  const prevById = new Map((previous?.entries || []).map((e) => [e.id, e]));
  let changed = !previous;
  const entries = rows.map((r) => {
    const prev = prevById.get(r.id);
    // Price approval survives regeneration only while the price itself is unchanged.
    const priceStatus = prev && prev.hash?.price === r.hash.price && (prev.priceStatus === 'approved' || prev.status === 'approved') ? 'approved' : 'draft';
    const price = priceRules(r.price, { name: r.name, unit: r.unit, ownerApproved: priceStatus === 'approved' });
    if (r.price && r.priceConfirmed === false && priceStatus !== 'approved') issues.push({ id: r.id, field: 'price', code: 'price_unconfirmed', raw: r.price });
    if (price.review) issues.push({ id: r.id, field: 'price', code: price.review, raw: r.price });
    const keepText = prev && prev.hash?.text === r.hash.text && (prev.edited || prev.status === 'approved');
    const priceSame = prev && prev.hash?.price === r.hash.price;
    if (!prev || !keepText || !priceSame) changed = true;
    const ck = categoryKey(r);
    let text;
    if (keepText) text = { spoken: prev.spoken, explain: prev.explain, source: prev.source, edited: prev.edited, status: priceSame ? prev.status : 'draft' };
    else {
      const sw = swNameRules(r.name); const ex = explainRules(r);
      const base = { name_en: enNameRules(r.name), name_sw: sw.text, explain_en: ex.en, explain_sw: ex.sw };
      const got = aiById.get(r.id) || {}; const out = {}; const src = {};
      for (const k of AI_FIELDS) {
        const bad = got[k] == null ? 'missing' : checkField(k, got[k], r);
        if (!bad) { out[k] = got[k].trim(); src[k] = 'ai'; } else { out[k] = base[k]; src[k] = 'rules'; if (ai && got[k] != null) issues.push({ id: r.id, field: k, code: bad }); }
        if (out[k] == null) issues.push({ id: r.id, field: k, code: k === 'name_sw' && sw.review ? sw.review : 'needs_owner_text' });
      }
      text = { spoken: { en: out.name_en, sw: out.name_sw }, explain: { en: out.explain_en, sw: out.explain_sw }, source: src, edited: false, status: 'draft' };
    }
    return { id: r.id, kind: r.kind, hash: r.hash, raw: { name: r.name, price: r.price, unit: r.unit || null }, category: { id: ck }, ...text, priceStatus, price: { en: price.en, sw: price.sw, numbers: price.numbers, review: price.review || null } };
  });
  const categories = [];
  for (const e of entries) {
    let c = categories.find((x) => x.id === e.category.id);
    if (!c) { c = { id: e.category.id, entryIds: [] }; categories.push(c); }
    c.entryIds.push(e.id);
  }
  for (const c of categories) {
    const members = c.entryIds.map((id) => entries.find((e) => e.id === id));
    const lbl = c.id.startsWith('raw_') ? { en: members[0].spoken.en, sw: members[0].spoken.sw } : categoryLabel(c.id, members.map((m) => m.raw.name));
    Object.assign(c, lbl);
    if (!c.sw) issues.push({ id: c.id, field: 'category_sw', code: 'needs_owner_text' });
    for (const m of members) Object.assign(m.category, { en: c.en, sw: c.sw });
  }
  const order = ['items', 'house', 'deep', 'office'];
  categories.sort((a, b) => (order.indexOf(a.id) + 1 || 99) - (order.indexOf(b.id) + 1 || 99));
  const h = sourceHash(profile);
  return {
    schemaVersion: SCHEMA_VERSION, tenantId: profile.tenantId || null,
    version: (previous?.version || 0) + (changed || previous?.sourceHash !== h ? 1 : 0),
    sourceHash: h, generatedAt: now.toISOString(), generator: ai ? 'ai+rules' : 'rules', aiError,
    status: entries.every((e) => e.status === 'approved') && entries.length ? 'approved' : 'draft',
    entries, categories, coverage: coverageRules(profile), issues,
  };
}
async function compileSpokenCatalogue(profile = {}, { generate = null, previous = null, now = new Date() } = {}) {
  const rows = prepRows(profile);
  let ai = null; let aiError = null;
  const need = rows.filter((r) => { const p = (previous?.entries || []).find((e) => e.id === r.id); return !(p && p.hash?.text === r.hash.text && (p.edited || p.status === 'approved')); });
  if (typeof generate === 'function' && need.length) {
    try { ai = await generate({ prompt: aiPrompt(need), schema: AI_SCHEMA }); } catch (e) { aiError = String(e?.message || e).slice(0, 120); }
  }
  return buildDoc(profile, rows, { ai, aiError, previous, now });
}
function compileSync(profile = {}) { const d = buildDoc(profile, prepRows(profile), { now: new Date(0) }); d.version = 0; return d; }
const needsRegeneration = (stored, profile) => !stored || stored.schemaVersion !== SCHEMA_VERSION || stored.sourceHash !== sourceHash(profile);
// Owner edit: one field of one entry. Edited text survives regeneration while name/notes are unchanged (price may change).
function applyOwnerEdit(sc, { id, field, lang, value }) {
  const e = sc.entries.find((x) => x.id === id);
  if (!e || !['spoken', 'explain'].includes(field) || !LANGS.includes(lang)) throw new Error('spoken catalogue: bad edit');
  e[field][lang] = String(value || '').trim() || null; e.edited = true; e.status = 'draft'; sc.status = 'draft';
  return sc;
}
// Owner approves prices as written (all entries, or ids). A flagged price (odd_price) becomes speakable.
function approvePrices(sc, { ids = null, by = null, at = new Date() } = {}) {
  const done = [];
  for (const e of sc.entries) {
    if (ids && !ids.includes(e.id)) continue;
    e.priceStatus = 'approved';
    const p = priceRules(e.raw.price, { name: e.raw.name, unit: e.raw.unit, ownerApproved: true });
    e.price = { en: p.en, sw: p.sw, numbers: p.numbers, review: p.review || null };
    done.push(e.id);
  }
  sc.issues = (sc.issues || []).filter((i) => !(done.includes(i.id) && i.field === 'price' && ['odd_price', 'price_unconfirmed'].includes(i.code)));
  return Object.assign(sc, { pricesApprovedBy: by, pricesApprovedAt: at.toISOString() });
}
function approve(sc, { by = null, at = new Date() } = {}) {
  approvePrices(sc, { by, at });
  for (const e of sc.entries) e.status = 'approved';
  return Object.assign(sc, { status: 'approved', approvedBy: by, approvedAt: at.toISOString() });
}
// ---------- read side (used by v2 receipts / machine) ----------
function spokenName(e, lang) { return e?.spoken?.[lang === 'sw' ? 'sw' : 'en'] || null; }
function entryForRaw(sc, rawName) { const k = String(rawName || '').trim().toLowerCase(); return sc.entries.find((e) => e.raw.name.trim().toLowerCase() === k) || null; }
// Name to say for a catalogue row in a language; Swahili never falls back to the raw English name.
function sayName(sc, rawName, lang) {
  const e = entryForRaw(sc, rawName);
  const L = lang === 'sw' ? 'sw' : 'en';
  if (e?.spoken?.[L]) return e.spoken[L];
  if (L === 'sw') return e?.category?.sw || null;
  return cleanName(rawName).toLowerCase();
}
// Token match, longest (most tokens) wins; '1-Bedroom' never hits carpet '(per room)'.
const TOK_STOP = new Set(['cleaning', 'clean', 'usafi', 'wa', 'ya', 'the', 'and', 'na', 'per', 'service', 'standard', 'package', 'add', 'on', 'internal', 'interior', 'up', 'to', 'sq', 'ft']);
const TOK_SYN = { fridge: 'refrigerator', friji: 'refrigerator', couch: 'sofa', rug: 'carpet', zulia: 'carpet', mazulia: 'carpet', godoro: 'mattress', magodoro: 'mattress', mattresses: 'mattress', sofas: 'sofa', carpets: 'carpet', oveni: 'oven', ofisi: 'office', maofisi: 'office', madirisha: 'window', windows: 'window' };
const toks = (t) => String(t || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/(\d)\s*-\s*(bed)/g, '$1$2').split(/[^a-z0-9]+/).map((w) => TOK_SYN[w] || w).filter((w) => w && !TOK_STOP.has(w));
function findEntry(text, sc) {
  const said = new Set(toks(text));
  let best = null; let bestScore = 0;
  for (const e of sc.entries) {
    for (const name of [e.raw.name, e.spoken.en, e.spoken.sw]) {
      const t = toks(name); if (!t.length) continue;
      const hit = t.filter((w) => said.has(w)).length;
      if (!hit) continue;
      const score = hit * 10 + (hit === t.length ? 5 : 0) - t.length * 0.1;
      if (score > bestScore) { best = e; bestScore = score; }
    }
  }
  return best;
}
const MEMO = new Map();
// SPOKEN_CATALOGUE_STORED_FIRST (default off). On: the call path speaks the
// stored live doc whenever one exists (freshness is a write-time concern);
// a hash mismatch is only traced as stale. compileSync runs only with no doc.
const storedFirst = (env = process.env) => /^(1|true|on|yes)$/i.test(String(env.SPOKEN_CATALOGUE_STORED_FIRST || '').trim());
function compileMemo(profile, h = sourceHash(profile)) {
  if (MEMO.has(h)) return MEMO.get(h);
  const out = compileSync(profile);
  if (MEMO.size > 200) MEMO.clear();
  MEMO.set(h, out);
  return out;
}
/** { doc, stale, degraded } for the call path. */
function resolveSpokenCatalogueMeta(profile = {}, { env = process.env } = {}) {
  const stored = profile.spokenCatalogue;
  if (storedFirst(env)) {
    if (stored && Array.isArray(stored.entries)) return { doc: stored, stale: needsRegeneration(stored, profile), degraded: false };
    return { doc: compileMemo(profile), stale: false, degraded: true };
  }
  if (stored && !needsRegeneration(stored, profile)) return { doc: stored, stale: false, degraded: false };
  return { doc: compileMemo(profile), stale: false, degraded: false };
}
function resolveSpokenCatalogue(profile = {}, opts = {}) { return resolveSpokenCatalogueMeta(profile, opts).doc; }

// One row -> catalogue profile mapping and column list for every writer and
// reader (backfill, on-save compile, Voice call path), so sourceHash agrees.
const CATALOGUE_COLS = ['id', 'services_catalog', 'product_catalog', 'service_areas', 'business_locations', 'spoken_catalogue'];
function catalogueProfileFromRow(r = {}) {
  return { tenantId: r.id, servicesCatalog: r.services_catalog || [], productCatalog: r.product_catalog || [], serviceAreas: r.service_areas || null, businessLocations: r.business_locations || [] };
}

module.exports = { CATALOGUE_COLS, catalogueProfileFromRow, storedFirst, resolveSpokenCatalogueMeta, SCHEMA_VERSION, AI_SCHEMA, sourceHash, compileSpokenCatalogue, compileSync, needsRegeneration, applyOwnerEdit, approve, approvePrices, spokenName, sayName, entryForRaw, findEntry, resolveSpokenCatalogue, priceRules, swNameRules, explainRules, coverageRules, checkField, categoryLabel, slug };
