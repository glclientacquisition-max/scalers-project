'use strict';
// v2 KB compile: kb_items (+ variants, categories) -> one versioned, spoken-ready snapshot (schema 2).
// Rules pass always; AI only ever suggests Swahili names into kb_items (owner approves), never into a snapshot.
// A blocking issue means status 'failed': the snapshot is stored for Desk but the live pointer never moves.
const crypto = require('crypto');
const S = require('./spoken');
const { tokens } = require('./keys');
const { displayPrice, fmtNum } = require('./items');

const SCHEMA = 2;
const COMPILER = 'kb-rules-2026-10-28.2';
const MAX_DOC_BYTES = 8 * 1024 * 1024;
const INDEX_TOKEN_CAP = 1500; // prompt index cap (Decisions, 28 Oct)

function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const SOURCE_FIELDS = ['id', 'kind', 'name_en', 'name_sw', 'name_sw_state', 'spoken_en', 'aliases', 'category_id', 'description_en', 'description_sw', 'unit', 'price_mode', 'price_amount', 'price_min', 'price_max', 'needs_visit', 'bookable', 'in_stock', 'popular', 'facets', 'delivery_fee_kes', 'status', 'sort', 'holdable', 'excludes_en', 'status_note'];
const pick = (o, ks) => Object.fromEntries(ks.map((k) => [k, o[k] === undefined ? null : (typeof o[k] === 'string' && /^\d+(\.\d+)?$/.test(o[k]) && /price|fee/.test(k) ? Number(o[k]) : o[k])]));
function sourceHash({ items = [], variants = [], categories = [], completeAt = null } = {}) {
  const it = items.map((x) => pick(x, SOURCE_FIELDS)).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const va = variants.map((x) => pick(x, ['item_id', 'id', 'label_en', 'label_sw', 'price_mode', 'price_amount', 'price_min', 'price_max', 'unit', 'in_stock', 'sort'])).sort((a, b) => `${a.item_id}/${a.id}`.localeCompare(`${b.item_id}/${b.id}`));
  const ca = categories.map((x) => pick(x, ['id', 'name_en', 'name_sw', 'name_sw_state', 'sort'])).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  // the owner's catalogue-complete mark is part of the source (set / clear = a new snapshot); absent = old hashes unchanged
  const cp = completeAt ? { cp: new Date(completeAt).toISOString() } : {};
  return sha(stableJson({ v: SCHEMA, c: COMPILER, it, va, ca, ...cp }));
}
const n = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
function lev(a, b) {
  if (a === b) return 0; const m = a.length; const k = b.length; if (!m || !k) return m || k;
  let prev = Array.from({ length: k + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= k; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[k];
}
const estTokens = (s) => Math.ceil(String(s).length / 4);

/**
 * @param {{ items: object[], variants?: object[], categories?: object[], business?: string }} src
 * @returns {{ doc, issues, blocking: boolean, sourceHash: string, status: 'live'|'failed' }}
 */
function compileKb(src = {}) {
  const issues = [];
  const allItems = Array.isArray(src.items) ? src.items : [];
  const shown = allItems.filter((x) => x && x.status !== 'hidden' && String(x.name_en || '').trim());
  // paused (owner hold) and not_offered (an explicit "we don't do X") are spoken only when a caller names them:
  // they sit in doc.off, never in counts, groups, prices or the prompt index
  const OFF = new Set(['paused', 'not_offered']);
  const active = shown.filter((x) => !OFF.has(x.status));
  const off = shown.filter((x) => OFF.has(x.status)).map((it) => ({
    id: it.id, kind: it.kind || 'service', name: it.name_en, say_en: S.sayNameEn(it), say_sw: S.sayNameSw(it), state: it.status,
    note: it.status === 'paused' ? String(it.status_note || '').trim().slice(0, 120) || null : null,
    keys: [...new Set([...tokens(it.name_en), ...tokens(it.spoken_en), ...tokens(it.name_sw), ...(it.aliases || []).flatMap(tokens)])],
    name_keys: tokens(it.spoken_en || it.name_en), cat: it.category_id || null,
  })).filter((x) => x.say_en);
  const variants = Array.isArray(src.variants) ? src.variants : [];
  const cats = new Map((src.categories || []).map((c) => [c.id, c]));
  const vByItem = new Map();
  for (const v of variants) { if (!vByItem.has(v.item_id)) vByItem.set(v.item_id, []); vByItem.get(v.item_id).push(v); }
  const items = [];
  const nameSeen = new Map();
  for (const it of active.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.id).localeCompare(String(b.id)))) {
    const sayEn = S.sayNameEn(it);
    const saySw = S.sayNameSw(it);
    const priceIn = { price_mode: it.price_mode, price_amount: n(it.price_amount), price_min: n(it.price_min), price_max: n(it.price_max), unit: it.unit };
    const sp = S.sayPrice(priceIn);
    if (!sayEn) { issues.push({ code: 'no_spoken_name', severity: 'warn', item_id: it.id }); continue; }
    if ((it.price_mode || 'none') === 'none' || (!sp.en && !sp.quote)) issues.push({ code: 'no_price', severity: 'warn', item_id: it.id, detail: 'Callers hear that the team will confirm the price.' });
    // a whole job under KSh 100 is almost always a typo (per-unit prices are fine): spoken only after the owner fixes or keeps it
    let priceSay = sp;
    if (it.kind !== 'product' && (!it.unit || it.unit === 'job') && sp.numbers.some((x) => x > 0 && x < 100) && !(it.facets && it.facets.price_checked)) {
      issues.push({ code: 'odd_price', severity: 'warn', item_id: it.id, detail: `${displayPrice(it)} for a whole job` });
      priceSay = { en: null, sw: null, numbers: sp.numbers, review: 'odd_price' };
    }
    if (!saySw) issues.push({ code: it.name_sw_state === 'suggested' ? 'sw_name_waiting' : 'no_sw_name', severity: 'info', item_id: it.id });
    const key = sayEn.toLowerCase();
    if (nameSeen.has(key)) issues.push({ code: 'duplicate_name', severity: 'warn', item_id: it.id, detail: `Same name as ${nameSeen.get(key)}` });
    else nameSeen.set(key, it.id);
    const cat = it.category_id ? cats.get(it.category_id) : null;
    const catName = cat ? cat.name_en : it.category_name || null;
    const vs = (vByItem.get(it.id) || []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map((v) => {
      const vp = S.sayPrice({ price_mode: v.price_mode || 'fixed', price_amount: n(v.price_amount), price_min: n(v.price_min), price_max: n(v.price_max), unit: v.unit || it.unit });
      return { id: v.id, label: v.label_en, say_en: v.label_en, say_sw: v.label_sw || null, in_stock: v.in_stock ?? null, keys: tokens(v.label_en), price: { display: displayPrice({ ...v, price_mode: v.price_mode || 'fixed' }), say_en: vp.en, say_sw: vp.sw, numbers: vp.numbers } };
    });
    items.push({
      id: it.id, kind: it.kind || 'service', name: it.name_en, say_en: sayEn, say_sw: saySw, sw_state: it.name_sw_state || 'none',
      cat: it.category_id || null, cat_name: catName,
      keys: [...new Set([...tokens(it.name_en), ...tokens(it.spoken_en), ...tokens(it.name_sw), ...tokens(it.name_sw_suggested), ...(it.aliases || []).flatMap(tokens)])],
      cat_keys: [...new Set([...tokens(catName), ...tokens(cat && cat.name_sw)])],
      aliases: it.aliases || [], unit: it.unit || null,
      price: { mode: it.price_mode || 'none', amount: n(it.price_amount), min: n(it.price_min), max: n(it.price_max), display: displayPrice(it), say_en: priceSay.en, say_sw: priceSay.sw, numbers: sp.numbers, quote: !!sp.quote, visit: !!sp.visit, review: priceSay.review || null },
      variants: vs, in_stock: it.in_stock ?? null, popular: !!it.popular, needs_visit: !!it.needs_visit || it.price_mode === 'site_visit', bookable: it.bookable !== false,
      state: 'active', holdable: !!it.holdable, excludes: it.excludes_en || null,
      facets: it.facets || {}, delivery_fee_kes: it.delivery_fee_kes ?? null, desc: it.description_en || null, desc_sw: it.description_sw || null,
      sound_alike: [],
    });
  }
  // Hick rule 11: names that sound alike are flagged so the spoken name carries the word that tells them apart
  // compared inside a group only (callers narrow by group first), groups up to 300 items, so a 10k catalogue compiles fast
  const byGroup = new Map();
  for (let i = 0; i < items.length; i++) { const k = items[i].cat || '_other'; if (!byGroup.has(k)) byGroup.set(k, []); byGroup.get(k).push(i); }
  for (const idx of byGroup.values()) {
    if (idx.length > 300) continue;
    for (let x = 0; x < idx.length; x++) for (let y = x + 1; y < idx.length; y++) {
      const i = idx[x]; const j = idx[y];
      const a = items[i].say_en.toLowerCase(); const b = items[j].say_en.toLowerCase();
      const lim = Math.max(1, Math.floor(Math.min(a.length, b.length) * 0.2));
      if (a.length > 3 && b.length > 3 && Math.abs(a.length - b.length) <= lim && lev(a, b) <= lim) {
        items[i].sound_alike.push(items[j].id); items[j].sound_alike.push(items[i].id);
        issues.push({ code: 'sound_alike', severity: 'info', item_id: items[i].id, detail: `${items[i].name} / ${items[j].name}` });
      }
    }
  }
  // aliases that hit two items are dropped from both (a caller word must lead to one item)
  const aliasOwner = new Map();
  for (const it of items) for (const a of it.aliases) { const k = String(a).toLowerCase(); aliasOwner.set(k, aliasOwner.has(k) && aliasOwner.get(k) !== it.id ? '*' : it.id); }
  for (const [a, owner] of aliasOwner) if (owner === '*') issues.push({ code: 'alias_two_items', severity: 'warn', detail: a });

  // categories in owner order, with counts and the group price span (Hick rule 6: a group gets a range)
  const catOrder = [...new Set(items.map((x) => x.cat || '_other'))];
  const categories = catOrder.map((cid) => {
    const members = items.filter((x) => (x.cat || '_other') === cid);
    const c = cats.get(cid);
    const nums = members.flatMap((x) => (x.price.review ? [] : x.price.numbers)).filter((v) => Number.isFinite(v) && v > 0);
    const units = [...new Set(members.map((x) => x.unit || ''))];
    const span = nums.length ? S.sayRange(Math.min(...nums), Math.max(...nums), units.length === 1 ? units[0] || null : null) : { en: null, sw: null, numbers: [] };
    const nameEn = c ? c.name_en : members[0].cat_name || (cid === '_other' ? null : cid);
    const nameSw = c && (c.name_sw_state === 'approved' || c.name_sw_state === 'edited') ? c.name_sw : null;
    return { id: cid, name: nameEn, say_en: nameEn ? nameEn.toLowerCase() : null, say_sw: nameSw, count: members.length, item_ids: members.map((x) => x.id), popular: members.filter((x) => x.popular).map((x) => x.id), span: { en: span.en, sw: span.sw, numbers: span.numbers }, keys: [...new Set([...tokens(nameEn), ...tokens(nameSw)])] };
  });
  if (items.length && categories.length === items.length && items.length > 8) issues.push({ code: 'one_item_categories', severity: 'warn', detail: 'Every item sits in its own category; group them so callers can narrow.' });

  // prompt index: item names when they fit the cap, else categories + popular picks (Decisions: ~1,500 tokens)
  const byCat = categories.map((c) => ({ cat: c.name || null, names: c.item_ids.map((id) => items.find((x) => x.id === id).say_en) }));
  let index = { mode: 'items', groups: byCat };
  if (estTokens(JSON.stringify(byCat)) > INDEX_TOKEN_CAP) {
    const pop = items.filter((x) => x.popular).slice(0, 20).map((x) => x.say_en);
    index = { mode: 'categories', groups: categories.map((c) => ({ cat: c.name, count: c.count })).slice(0, 60), popular: pop };
  }
  const doc = {
    schema: SCHEMA, compiler: COMPILER, business: src.business || null, built_at: (src.now || new Date()).toISOString(),
    counts: { items: items.length, services: items.filter((x) => x.kind === 'service').length, products: items.filter((x) => x.kind === 'product').length, hidden: allItems.length - shown.length,
      paused: off.filter((x) => x.state === 'paused').length, not_offered: off.filter((x) => x.state === 'not_offered').length },
    index, categories, items, off,
    // owner-marked "this is my whole catalogue" (tenants.kb_catalogue_complete_at via set_kb_catalogue_complete);
    // versioned with the snapshot. No mark = false: Brain B1 treats the catalogue as sparse.
    complete: !!src.completeAt, complete_at: src.completeAt ? new Date(src.completeAt).toISOString() : null,
  };
  doc.preview = previewLines(doc);
  const bytes = Buffer.byteLength(JSON.stringify(doc));
  if (bytes > MAX_DOC_BYTES) issues.push({ code: 'doc_too_large', severity: 'block', detail: `${bytes} bytes` });
  if (active.length && !items.length) issues.push({ code: 'no_speakable_items', severity: 'block' });
  const blocking = issues.some((i) => i.severity === 'block');
  return { doc, issues, blocking, status: blocking ? 'failed' : 'live', sourceHash: sourceHash(src), bytes };
}


/** "What callers hear": the same rules the call uses, run on the new snapshot (Desk shows these; no second copy of the rules). */
function previewLines(doc) {
  try {
    if (!doc.items.length) return [];
    const kb = require('./reader').openKb(doc);
    const rules = require('./rules');
    const big = [...doc.categories].filter((c) => c.name && c.count > 1).sort((a, b) => b.count - a.count)[0];
    const one = doc.items.find((x) => x.price && x.price.say_en && !x.price.quote) || doc.items[0];
    const asks = [
      { asked: doc.counts.products > doc.counts.services ? 'What do you sell?' : 'What services do you offer?', fn: (lang) => rules.overview(kb, lang) },
      big ? { asked: `How much is ${big.say_en}?`, fn: (lang) => rules.answer(kb, `how much is ${big.say_en}`, { asksPrice: true, lang }) } : null,
      one ? { asked: `How much is ${one.say_en}?`, fn: (lang) => rules.answer(kb, `how much is ${one.say_en}`, { asksPrice: true, lang }) } : null,
    ].filter(Boolean);
    return asks.map((a) => { const en = a.fn('en'); const sw = a.fn('sw'); return { asked: a.asked, en: (en && en.text) || en || null, sw: (sw && sw.text) || sw || null }; });
  } catch { return []; }
}

module.exports = { compileKb, sourceHash, SCHEMA, COMPILER, INDEX_TOKEN_CAP, stableJson, fmtNum };
