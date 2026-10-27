'use strict';
// C2 "one fact store" (BRAIN_V2_FACT_STORE, default off). One typed store of the owner's facts,
// compiled at owner Save inside the existing spoken-catalogue rebuild (#702) and kept in the same
// tenants.spoken_catalogue JSON as doc.facts (no new column). Services with variants (size, rooms,
// type), typed price (mode/min/max/amount/unit), products with normalized tokens, areas with fees,
// policies and CONFIRMED FAQs only. v2 binding, answers, receipts, the old-path item matcher and
// the A4 item seam all read it; nothing else keeps its own copy of these facts.
const crypto = require('crypto');
const { parseSize, mouthName } = require('../conversation/spokenCatalogue');

const FACTS_VERSION = 1;

function factStoreEnabled(env = process.env) {
  return /^(1|true|on|yes)$/i.test(String((env || {}).BRAIN_V2_FACT_STORE || ''));
}
// literal reference so the env reference generator lists the flag
const FLAG_NAME = 'BRAIN_V2_FACT_STORE'; void process.env.BRAIN_V2_FACT_STORE;

function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// ---------- normalization (case, punctuation, hyphens, plurals, mojibake) ----------
function cleanName(name) {
  return String(name || '')
    .replace(/Ã‚Â°|Â°/g, '°') // UTF-8 read as Latin-1 ("180Â° transparent protractor")
    .replace(/Â(?=\s)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function singular(w) {
  if (w.length > 4 && /ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(ches|shes|xes|sses|zes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && /s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}
const ITEM_STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'for', 'with', 'in', 'on', 'to', 'by', 'na', 'ya', 'wa', 'za', 'la', 'kwa', 'cha', 'vya', 'my', 'your', 'some', 'any', 'please']);
function normTokens(s) {
  return cleanName(s)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/°/g, ' degree ')
    .replace(/(\d)(?=[a-z])/g, '$1 ') // 35cm -> 35 cm (a4 stays a4)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(singular);
}
const itemTokens = (s) => normTokens(s).filter((w) => !ITEM_STOP.has(w));
const distinctive = (w) => w.length >= 3 && !/^\d+$/.test(w);

// ---------- variants ----------
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, single: 1, double: 2, moja: 1, mbili: 2, tatu: 3, nne: 4, tano: 5, kimoja: 1, viwili: 2, vitatu: 3, vinne: 4, vitano: 5 };
const toN = (w) => (/^\d+$/.test(w) ? Number(w) : NUM[String(w).toLowerCase()] ?? null);
// The caller's size words: EN/SW bedroom counts, 1BR/2BR, studio/bedsitter, seaters, small/medium/large.
function callerVariant(text) {
  const t = ` ${String(text || '').toLowerCase().replace(/[–—]/g, '-')} `;
  let m;
  if (/\b(studio|bed-?sitt?er|bedsit|single room)\b/.test(t)) return { kind: 'bedroom', value: 0 };
  if ((m = t.match(/\b(\d{1,2}|one|two|three|four|five|six|single|double)\s*-?\s*(?:bed(?:room)?s?(?:ed)?|br|bdr|bhk)\b/))) return { kind: 'bedroom', value: toN(m[1]) };
  if ((m = t.match(/\bbedrooms?\s+(\d|moja|mbili|tatu|nne|tano|one|two|three|four|five)\b/))) return { kind: 'bedroom', value: toN(m[1]) };
  if ((m = t.match(/\bvyumba\s+(?:vya\s+kulala\s+)?(viwili|vitatu|vinne|vitano|mbili|tatu|nne|tano|\d)\b/))) return { kind: 'bedroom', value: toN(m[1]) };
  if ((m = t.match(/\bchumba\s+(?:cha\s+kulala\s+)?(kimoja|moja|1)\b/))) return { kind: 'bedroom', value: 1 };
  if ((m = t.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight)\s*-?\s*seaters?\b/))) return { kind: 'seater', value: toN(m[1]) };
  if ((m = t.match(/\bviti\s+(vitatu|vinne|vitano|vita|sita|saba|\d)\b/))) return { kind: 'seater', value: toN(m[1]) || ({ vitatu: 3, vinne: 4, vitano: 5, sita: 6, saba: 7 })[m[1]] || null };
  if ((m = t.match(/\b(small|medium|large|ndogo|kubwa|wastani)\b/))) return { kind: 'pack', value: ({ ndogo: 'small', kubwa: 'large', wastani: 'medium' })[m[1]] || m[1] };
  return null;
}
// a bare size answer to "one, two or three bedroom?" ("two", "viwili", "the 2")
function bareSize(text) {
  const m = String(text || '').toLowerCase().match(/^\W*(?:the\s+|ya\s+|nataka\s+|ni\s+)?(\d{1,2}|one|two|three|four|five|six|kimoja|viwili|vitatu|vinne|vitano|moja|mbili|tatu|nne|tano)\b(?:\s+(?:one|please|tafadhali))?\W*$/);
  return m ? toN(m[1]) : null;
}
function rowVariant(name) {
  const n = mouthName(cleanName(name));
  if (/\b(studio|bed-?sitt?er|bedsit)\b/i.test(n)) return { kind: 'bedroom', value: 0, head: n.replace(/\b(studio|bed-?sitt?er|bedsit)\b/ig, ' ').replace(/[,\s]+$/, '').replace(/\s+/g, ' ').trim() || n };
  const p = parseSize(n);
  return p.kind ? { kind: p.kind, value: p.value, head: p.head } : null;
}

// ---------- typed price ----------
const fmt = (n) => Number(n).toLocaleString('en-US');
const UNIT_TXT = { sqm: 'per m²', m2: 'per m²', seat: 'per seat', room: 'per room', hour: 'per hour', hr: 'per hour', visit: 'per visit', window: 'per window', unit: 'per unit', sqft: 'per sq ft' };
// numbers as a reader would group them: '2,000,3,000' is one number (20003000), never two
function numsOf(s) { return (String(s || '').match(/\d{1,3}(?:,\d{3})+(?!\d)|\d+(?:\.\d+)?/g) || []).map((x) => Number(x.replace(/,/g, ''))); }
// Typed price for one owner row. `say` is the price text a receipt words (priceTxt): the owner's own
// price text when its numbers agree with the typed values, else rebuilt from the typed values only.
function typedPrice(row = {}) {
  const p = row.pricing && typeof row.pricing === 'object' ? row.pricing : null;
  const rawTxt = String(row.price_range || (row.price != null && row.price !== '' ? `KSh ${row.price}` : '') || '').trim();
  let mode = p?.mode || row.pricing_mode || null;
  let min = p?.min_ksh ?? null; let max = p?.max_ksh ?? null; let amount = p?.amount_ksh ?? null;
  const unit = p?.unit || null;
  const confirmed = p ? p.confirmed !== false : (row.priceConfirmed !== false);
  if ((!p || (p.mode == null && min == null && max == null && amount == null)) && rawTxt) { // untyped row: read the owner's text once
    const n = numsOf(rawTxt);
    if (/custom\s+quote|on\s+request|\bquote\b/i.test(rawTxt)) mode = 'ask';
    else if (n.length >= 2 && /-|\bto\b/.test(rawTxt)) { mode = 'range'; min = n[0]; max = n[1]; amount = n[0]; }
    else if (n.length && /^from\b/i.test(rawTxt)) { mode = 'from'; min = n[0]; amount = n[0]; }
    else if (n.length) { mode = 'fixed'; amount = n[0]; }
  }
  if (!mode) mode = amount != null ? 'fixed' : 'ask';
  let typedTxt = null;
  if (mode === 'fixed' && amount != null) typedTxt = `KSh ${fmt(amount)}`;
  else if (mode === 'from' && (min ?? amount) != null) typedTxt = `From KSh ${fmt(min ?? amount)}`;
  else if (mode === 'range' && min != null && max != null) typedTxt = `KSh ${fmt(min)}-${fmt(max)}`;
  if (typedTxt && unit) typedTxt = `${typedTxt} ${UNIT_TXT[String(unit).toLowerCase()] || `per ${unit}`}`;
  const typedNums = [min, max, amount].filter((x) => x != null).map(Number);
  // the owner's text is spoken only when it reads as the typed numbers ('2,000,3,000' would read as millions)
  const irregular = /\d,(?!\d{3}(?!\d))/.test(rawTxt);
  const agrees = rawTxt && !irregular && numsOf(rawTxt).length && numsOf(rawTxt).every((x) => typedNums.includes(x));
  const say = !confirmed || mode === 'ask' ? null : (agrees ? rawTxt : typedTxt);
  return { mode, min, max, amount, unit, confirmed, say };
}

// ---------- compile ----------
function areaRows(profile = {}) {
  const sa = profile.serviceAreas || profile.service_areas || null;
  const list = Array.isArray(sa) ? sa : (sa && Array.isArray(sa.areas) ? sa.areas : []);
  return list.filter((a) => a && (a.id || a.name)).map((a) => {
    const id = String(a.id || `place:${a.name}`);
    const nm = a.name || id.split(':').pop().replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
    return { id, name: nm, kind: id.split(':')[0], fee: { mode: a.fee_mode || (a.fee_ksh != null ? 'fixed' : 'ask'), ksh: a.fee_ksh ?? null }, eta: a.eta || null, confirmed: a.confirmed === true || a.source === 'owner' };
  });
}
function confirmedFaqs(profile = {}) {
  const { factFaqs } = require('../conversation/provenance');
  const raw = Array.isArray(profile.faqs) ? profile.faqs : [];
  const strict = raw.filter((f) => f && (f.confirmed === true || String(f.status || '').toLowerCase() === 'confirmed'));
  const facts = new Set(factFaqs(strict, profile.fieldMeta || null).map((f) => f.question));
  return strict.filter((f) => facts.has(String(f.question || '').trim()));
}
function factsSource(profile = {}) {
  return {
    v: FACTS_VERSION,
    services: (profile.servicesCatalog || []).map((r) => (typeof r === 'string' ? { name: r } : r)),
    products: profile.productCatalog || [],
    areas: profile.serviceAreas || profile.service_areas || null,
    policies: profile.businessPolicies || {},
    faqs: (profile.faqs || []).map((f) => ({ q: f?.question, a: f?.answer, s: f?.status, c: f?.confirmed })),
  };
}
function factsHash(profile = {}) { return sha(stableJson(factsSource(profile))); }

function pickRow(row, keys) { const o = {}; for (const k of keys) if (row[k] !== undefined) o[k] = row[k]; return o; }

// Train spoken labels / family tags (R7b-thin): owner aliases/spoken_labels on the row,
// plus category phrasing already spoken in the catalogue ("after building work", baada ya ujenzi).
// No serviceAliases.js — bindService scores these tokens/phrases.
function spokenLabelsForService(name, row = {}) {
  const fromRow = [
    ...(Array.isArray(row.spoken_labels) ? row.spoken_labels : []),
    ...(Array.isArray(row.aliases) ? row.aliases : []),
  ].map((x) => String(x || '').trim()).filter(Boolean);
  const n = String(name || '');
  const compiled = [];
  if (/post[\s-]?construction/i.test(n)) {
    compiled.push(
      'after construction',
      'after building',
      'after building work',
      'after construction cleaning',
      'post construction',
      'baada ya ujenzi',
      'baada ujenzi',
      'ukarabati',
    );
  }
  if (/move[\s-]?(?:in|out)/i.test(n)) {
    compiled.push('move-in', 'move-out', 'move in', 'move out', 'kuhamia', 'kuhama');
  }
  return [...new Set([...fromRow, ...compiled])];
}

const SVC_KEYS = ['id', 'name', 'category', 'notes', 'description', 'price_range', 'pricing', 'pricing_mode', 'duration', 'duration_min', 'site_visit_required', 'out_of_scope', 'source', 'aliases', 'spoken_labels'];
const PRD_KEYS = ['id', 'name', 'sku', 'aliases', 'price', 'in_stock', 'category', 'unit', 'notes'];

function compileFacts(profile = {}) {
  const SF = require('../conversation/spokenFacts');
  const services = (profile.servicesCatalog || []).map((r, i) => {
    const row = typeof r === 'string' ? { name: r } : (r || {});
    const name = cleanName(row.name);
    const variant = rowVariant(name);
    const labels = spokenLabelsForService(name, row);
    return { id: row.id || `svc_${i}`, name, family: (variant ? variant.head : mouthName(name)).toLowerCase(), variant: variant ? { kind: variant.kind, value: variant.value } : null, price: typedPrice(row), spoken_labels: labels, row: pickRow({ ...row, name: row.name }, SVC_KEYS) };
  }).filter((s) => s.name);
  const products = (profile.productCatalog || []).map((p, i) => {
    const row = p || {};
    const name = cleanName(row.name);
    const st = row.in_stock;
    const inStock = st === true || /^(yes|true|1|in)/i.test(String(st ?? '')) ? true : (st === false || /^(no|false|0|out)/i.test(String(st ?? '')) ? false : null);
    return { id: row.id || `prd_${i}`, index: i, name, tokens: itemTokens(name), alt: [row.sku, ...(Array.isArray(row.aliases) ? row.aliases : [])].filter(Boolean).map(itemTokens), price: typedPrice(row), inStock, row: pickRow({ ...row, name: row.name }, PRD_KEYS) };
  }).filter((p) => p.name);
  const areas = areaRows(profile).map((a) => ({ ...a, say: a.confirmed ? { en: SF.compileSpokenAreaFee(profile, a.name, 'en') || null, sw: SF.compileSpokenAreaFee(profile, a.name, 'sw') || null } : null }));
  const pol = SF.compileSpokenPolicies(profile);
  const policies = (pol.rows || []).map((r) => ({ key: r.key, en: r.en, sw: r.sw }));
  const faqs = confirmedFaqs(profile).map((f) => {
    const sp = SF.speakFileLine ? { en: SF.speakFileLine(String(f.answer).trim(), 'en'), sw: SF.speakFileLine(String(f.answer).trim(), 'sw') } : { en: f.answer, sw: f.answer };
    return { question: String(f.question).trim(), answer: String(f.answer).trim(), en: sp.en, sw: sp.sw, tokens: [...new Set(normTokens(f.question))] };
  });
  return { version: FACTS_VERSION, sourceHash: factsHash(profile), services, products, areas, policies, faqs };
}

// Call path: the pinned doc's facts, else the stored doc's facts when fresh, else compiled (memo).
const memo = new WeakMap();
function factsFor(profile = {}) {
  if (!profile || typeof profile !== 'object') return compileFacts({});
  const h = factsHash(profile);
  for (const doc of [profile.spokenCataloguePin, profile.spokenCatalogue]) {
    const f = doc && (doc.doc || doc).facts;
    if (f && f.version === FACTS_VERSION && f.sourceHash === h) return f;
  }
  const m = memo.get(profile);
  if (m && m.sourceHash === h) return m;
  const f = compileFacts(profile);
  memo.set(profile, f);
  return f;
}
// Save rebuild: a doc is stale when its facts are missing or were compiled from other owner data.
function factsStale(stored, profile) {
  const f = stored && stored.facts;
  return !f || f.version !== FACTS_VERSION || f.sourceHash !== factsHash(profile);
}

// ---------- item matcher: normalized whole tokens, never substrings or prefixes ----------
// Score one row against the caller's tokens: the set of row tokens heard (best of name, sku, aliases).
function heardOf(rowToks, altToks, want) {
  let best = [];
  for (const toks of [rowToks, ...(altToks || [])]) {
    const hit = [...new Set(toks.filter((w) => want.has(w)))];
    const ok = hit.some(distinctive) || (hit.length && hit.length === new Set(toks).size);
    if (ok && hit.length > best.length) best = hit;
  }
  return best;
}
// Utterance matcher (v2 nlu): rows whose heard tokens are dominated by another row's are dropped;
// rows heard by exactly the same words are one ambiguous mention (ask which, never take the first).
function matchItems(text, facts) {
  const want = new Set(itemTokens(text));
  const rows = (facts?.products || []).map((p) => ({ p, heard: heardOf(p.tokens, p.alt, want) })).filter((x) => x.heard.length);
  const kept = rows.filter((x) => !rows.some((y) => y !== x && y.heard.length > x.heard.length && x.heard.every((w) => y.heard.includes(w))));
  const groups = new Map();
  for (const x of kept) { const k = [...x.heard].sort().join(' '); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  const found = []; const ambiguous = [];
  for (const [heard, g] of groups) {
    if (g.length === 1) found.push({ fact: g[0].p, heard });
    else {
      // an exact full-name hit inside the group still wins ("mg gel pen" vs "gel pen refill")
      const exact = g.filter((x) => new Set(x.p.tokens).size === x.heard.length);
      if (exact.length === 1) found.push({ fact: exact[0].p, heard }); else ambiguous.push({ heard, options: g.map((x) => x.p) });
    }
  }
  return { found, ambiguous };
}
// Name lookup (old-path findProductMatch, A4 items): every word of the asked name must be a whole
// token of the row (or its sku/alias). Several equal rows: best is the first, flagged ambiguous with
// the candidates so a caller-facing path asks which.
function findItem(item, facts) {
  const need = itemTokens(item);
  if (!need.length || !need.some((w) => w.length >= 2)) return null;
  const scored = [];
  for (const p of facts?.products || []) {
    let best = 0;
    for (const toks of [p.tokens, ...(p.alt || [])]) {
      const set = new Set(toks);
      if (!set.size || !need.every((w) => set.has(w))) continue;
      const s = need.length / set.size;
      if (s > best) best = s;
    }
    if (best > 0) scored.push({ p, score: best });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  const exact = scored.filter((x) => x.score === 1);
  // one row is the whole asked name: that row. Otherwise every row holding all the asked words is a
  // candidate, and more than one is ambiguous (best first, never a silent pick on a caller path).
  const pool = exact.length === 1 ? exact : scored;
  return { fact: pool[0].p, score: pool[0].score, ambiguous: pool.length > 1, candidates: pool.map((x) => x.p) };
}
// A4 seam (#838 summaryReceipts): one item resolved against the store, same shape as itemFromCatalogue.
function itemFromFacts(facts, { id = null, name = '', qty = null } = {}) {
  const byId = id ? (facts?.products || []).find((p) => p.id === id) : null;
  const hit = byId ? { fact: byId, ambiguous: false } : findItem(name, facts);
  if (!hit || hit.ambiguous) return { id: id || null, name: String(name || ''), qty: qty ?? null, price: null, matched: false, ambiguous: !!hit?.ambiguous };
  const f = hit.fact;
  return { id: f.id, name: f.name, qty: qty ?? null, price: f.price?.confirmed !== false ? (f.price.amount ?? null) : null, matched: true, ambiguous: false };
}

// ---------- FAQ: confirmed answers only ----------
const FAQ_STOP = new Set(['the', 'a', 'an', 'do', 'doe', 'does', 'you', 'your', 'i', 'is', 'are', 'what', 'how', 'can', 'to', 'of', 'for', 'in', 'on', 'my', 'we', 'it', 'be', 'need', 'any', 'there', 'ni', 'je', 'mna', 'mnaweza', 'kuna', 'ya', 'wa', 'na', 'kwa']);
function matchFaq(text, facts) {
  const want = new Set(normTokens(text).filter((w) => !FAQ_STOP.has(w)));
  if (want.size < 2) return null;
  let best = null;
  for (const f of facts?.faqs || []) {
    const q = f.tokens.filter((w) => !FAQ_STOP.has(w));
    if (q.length < 2) continue;
    const hit = q.filter((w) => want.has(w)).length;
    const cover = hit / q.length; const prec = hit / want.size;
    const s = cover * 0.7 + prec * 0.3;
    if (hit >= 2 && cover >= 0.6 && prec >= 0.5 && (!best || s > best.score)) best = { faq: f, score: s };
  }
  return best;
}
function areaFact(facts, name) {
  const n = String(name || '').toLowerCase().trim();
  return (facts?.areas || []).find((a) => a.name.toLowerCase() === n || a.id.toLowerCase().endsWith(`:${n}`)) || null;
}

module.exports = { FACTS_VERSION, FLAG_NAME, factStoreEnabled, compileFacts, factsFor, factsHash, factsStale, normTokens, itemTokens, cleanName, callerVariant, bareSize, rowVariant, typedPrice, matchItems, findItem, itemFromFacts, matchFaq, areaFact, confirmedFaqs, spokenLabelsForService };
