'use strict';
// v2 Knowledge Base item states (2026-10-28.2): honest quote mapping, site visit, paused, not offered, paste a list.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const I = require('../src/knowledge/kb/items');
const C = require('../src/knowledge/kb/compile');
const R = require('../src/knowledge/kb/reader');
const RU = require('../src/knowledge/kb/rules');
const RD = require('../src/knowledge/kb/readiness');
const L = require('../src/knowledge/kb/live');
const { tenantProfileFromRow } = require('../src/tenantProfile');

const item = (o) => ({ kind: 'service', status: 'active', price_mode: 'fixed', price_amount: 3000, category_id: 'home', sort: 0, aliases: [], ...o });
const CATS = [{ id: 'home', name_en: 'Home cleaning' }];
const open = (items) => { const out = C.compileKb({ items, categories: CATS }); return { out, kb: R.openKb(out.doc) }; };
const sentences = (t) => String(t || '').split(/(?<=[.?!])\s+/).filter(Boolean);

describe('kb item states: legacy price mapping (Desk review bug 1)', () => {
  it('a deliberate old-Desk Quote (pricing.mode ask, owner, confirmed) backfills as quote, not "No price yet"', () => {
    const p = I.legacyPrice({ name: 'Carpet', price: '', pricing: { mode: 'ask', source: 'owner', confirmed: true } });
    assert.equal(p.price_mode, 'quote');
  });
  it('pricing_mode quote wins over pricing.mode ask', () => {
    assert.equal(I.legacyPrice({ name: 'Sofa', pricing_mode: 'quote', pricing: { mode: 'ask' } }).price_mode, 'quote');
  });
  it('an untouched ask (parsed, unconfirmed) stays none so readiness still asks for a price', () => {
    assert.equal(I.legacyPrice({ name: 'X', pricing: { mode: 'ask', source: 'parsed', confirmed: false } }).price_mode, 'none');
  });
  it('a quote row that needs a site visit becomes site_visit; flags carried', () => {
    const { items } = I.fromLegacy({ services_catalog: [{ id: 'svc_pc', name: 'Post-construction clean', pricing_mode: 'quote', site_visit_required: true, out_of_scope: 'Outside windows' }], product_catalog: [{ id: 'prd_1', name: 'Gloria F1', price: '3', holdable: true }] });
    const pc = items.find((x) => x.id === 'svc_pc');
    assert.equal(pc.price_mode, 'site_visit');
    assert.equal(pc.needs_visit, true);
    assert.equal(pc.excludes_en, 'Outside windows');
    assert.equal(items.find((x) => x.id === 'prd_1').holdable, true);
  });
  it('fixed prices are unchanged', () => {
    assert.deepEqual(I.legacyPrice({ name: 'Deep', price: '6000' }), { price_mode: 'fixed', price_amount: 6000, price_min: null, price_max: null });
  });
});

describe('kb item states: readiness counts quote and site visit as priced', () => {
  it('a business of quotes and site visits passes the catalogue check', () => {
    const { out } = open([item({ id: 'a', name_en: 'Deep clean', price_mode: 'quote', price_amount: null }), item({ id: 'b', name_en: 'Post-construction clean', price_mode: 'site_visit', price_amount: null }), item({ id: 'c', name_en: 'Sofa clean' })]);
    assert.ok(!out.issues.some((i) => i.code === 'no_price'));
    const p = tenantProfileFromRow({ id: 'states-ready-1', business_name: 'T' }, { areaPicksRows: [] });
    L.attach(p, { version: 1, readyVersion: null, brainTarget: 'v2', doc: out.doc }, { force: true });
    const r = RD.runReadiness(p, { latest: { status: 'live', issues: out.issues, source_hash: out.sourceHash }, currentHash: out.sourceHash });
    assert.equal(r.checks.find((c) => c.id === 'catalogue').ok, true);
  });
  it('a none price still fails it', () => {
    const { out } = open([item({ id: 'a', name_en: 'Deep clean', price_mode: 'none', price_amount: null })]);
    const p = tenantProfileFromRow({ id: 'states-ready-2', business_name: 'T' }, { areaPicksRows: [] });
    L.attach(p, { version: 1, readyVersion: null, brainTarget: 'v2', doc: out.doc }, { force: true });
    assert.equal(RD.runReadiness(p, { latest: { status: 'live', issues: out.issues, source_hash: out.sourceHash }, currentHash: out.sourceHash }).checks.find((c) => c.id === 'catalogue').ok, false);
  });
});

describe('kb item states: what callers hear', () => {
  const { kb, out } = open([
    item({ id: 'dc', name_en: 'Deep clean', price_mode: 'quote', price_amount: null }),
    item({ id: 'pc', name_en: 'Post-construction clean', price_mode: 'site_visit', price_amount: null }),
    item({ id: 'sofa', name_en: 'Sofa cleaning', status: 'paused', status_note: 'Back next week' }),
    item({ id: 'carpet', name_en: 'Carpet cleaning', status: 'not_offered' }),
    item({ id: 'office', name_en: 'Office cleaning', price_amount: 4500 }),
  ]);
  it('quote: says the team will give a quote, offers capture, two sentences max', () => {
    const a = RU.answer(kb, 'how much is a deep clean', { asksPrice: true });
    assert.match(a.text, /custom quote; the team will give you a price/);
    assert.equal(a.capture, 'quote');
    assert.ok(sentences(a.text).length <= 2);
    const sw = RU.answer(kb, 'bei ya deep clean ni ngapi', { asksPrice: true, lang: 'sw' });
    assert.match(sw.text, /bei maalum/);
    assert.equal(sw.capture, 'quote');
  });
  it('site visit: priced after a visit, offers capture', () => {
    const a = RU.answer(kb, 'how much is post-construction clean', { asksPrice: true });
    assert.match(a.text, /priced after a site visit/);
    assert.equal(a.capture, 'site_visit');
  });
  it('not offered: a plain no, never "not sure"', () => {
    const a = RU.answer(kb, 'do you do carpet cleaning?', { asksPrice: false });
    assert.equal(a.itemState, 'not_offered');
    assert.match(a.text, /^Sorry, we don't offer carpet cleaning\./i);
    assert.match(RU.answer(kb, 'mnafanya carpet cleaning?', { lang: 'sw' }).text, /hatufanyi/);
  });
  it('paused: not available right now, with the owner note', () => {
    const a = RU.answer(kb, 'how much is sofa cleaning', { asksPrice: true });
    assert.equal(a.itemState, 'paused');
    assert.match(a.text, /isn't available right now \(Back next week\)/);
  });
  it('paused and not offered items are never listed, counted or priced in a group', () => {
    assert.equal(out.doc.counts.items, 3);
    assert.equal(out.doc.counts.paused, 1);
    assert.equal(out.doc.counts.not_offered, 1);
    const g = RU.answer(kb, 'how much is home cleaning', { asksPrice: true });
    assert.ok(!/sofa|carpet/i.test(g.text), g.text);
    assert.ok(!(g.ids || []).includes('sofa'));
  });
  it('an active item still wins when it is named', () => {
    assert.match(RU.answer(kb, 'how much is office cleaning', { asksPrice: true }).text, /4,500|four thousand/i);
  });
  it('legacy projection: not offered and paused both leave the old catalogue (KB reader root cause 1), site visit is Quote + site_visit_required', () => {
    const leg = I.docToLegacy(out.doc);
    const names = leg.servicesCatalog.map((s) => s.name);
    assert.ok(!names.includes('Carpet cleaning'));
    assert.ok(!names.includes('Sofa cleaning'));
    const pc = leg.servicesCatalog.find((s) => s.name === 'Post-construction clean');
    assert.equal(pc.pricing_mode, 'quote');
    assert.equal(pc.site_visit_required, true);
  });
});

describe('kb item states: engine capture after a quote', () => {
  it('the quote receipt carries capture + service so a yes becomes a callback', () => {
    const { out } = open([item({ id: 'dc', name_en: 'Deep clean', price_mode: 'quote', price_amount: null })]);
    const p = tenantProfileFromRow({ id: 'states-engine-1', business_name: 'T' }, { areaPicksRows: [] });
    L.attach(p, { version: 1, readyVersion: 1, brainTarget: 'v2', doc: out.doc }, { force: true });
    const T = require('../src/conversation/v2/engineTools');
    const machine = { slots: {} };
    const r = T.catalogueReceipt({ u: { answers: ['price'], intent: 'ask', slots: {} }, machine, profile: p, kbh: p.kb.handle, lang: 'en', text: 'how much is a deep clean', wantsPrice: true, wantsCoverage: false });
    assert.equal(r.capture, 'quote');
    assert.equal(r.service, 'Deep clean');
  });
});

describe('kb item states: SQL', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'docs', 'supabase', 'kb_v2_item_states.sql'), 'utf8');
  it('adds the new modes, states and columns additively', () => {
    assert.match(sql, /'site_visit'/);
    assert.match(sql, /status in \('active', 'paused', 'not_offered', 'hidden'\)/);
    for (const c of ['holdable', 'excludes_en', 'status_note']) assert.match(sql, new RegExp(`add column if not exists ${c}`));
    assert.ok(!/drop table|drop column/i.test(sql));
    assert.match(sql, /set search_path = ''/);
    assert.match(sql, /grant execute on function public\.kb_upsert_items\(uuid, jsonb, jsonb, boolean, text\) to service_role/);
  });
});

// Desk paste parser (pure TS), run with Node's type stripping
const CAN_TS = spawnSync(process.execPath, ['--experimental-strip-types', '-e', '1'], { encoding: 'utf8' }).status === 0;
describe('kb item states: Desk paste a list', { skip: CAN_TS ? false : 'no --experimental-strip-types' }, () => {
  it('parses one item per line with optional prices, matches existing names, flags bad lines', () => {
    const core = path.join(__dirname, '..', 'dashboard', 'src', 'lib', 'kbCore.ts');
    const script = `
      const K = await import(${JSON.stringify(core)});
      const rows = K.parsePasteList(${JSON.stringify('name,price\nDeep clean - 6,000-12,000\nGloria F1, 3 per seedling\nCarpet cleaning: quote\nAnsal F1\t2.50\nOffice clean from KSh 4,500\nPost-construction clean - site visit\n- Sofa cleaning 1500 each\nWindow cleaning\nDeep clean - 7000\n123')}, [{ id: 'svc_w', name_en: 'Window cleaning' }]);
      const items = K.itemsFromPaste(rows, 'service', [{ id: 'svc_w', name_en: 'Window cleaning', kind: 'service', status: 'hidden', price_mode: 'none', price_amount: null, price_min: null, price_max: null, unit: null, sort: 4, needs_visit: false }], null);
      const mirror = K.mirrorLegacy([{ id: 'a', kind: 'service', name_en: 'PC', price_mode: 'site_visit', price_amount: null, price_min: null, price_max: null, unit: null, status: 'active', sort: 0, aliases: [], in_stock: null, needs_visit: true, excludes_en: 'Windows', legacy_ref: null }, { id: 'b', kind: 'service', name_en: 'Carpet', price_mode: 'fixed', price_amount: 1, status: 'not_offered', sort: 1, aliases: [] }], [], { services_catalog: [], product_catalog: [] });
      console.log(JSON.stringify({ rows: rows.map((r) => [r.name_en, r.price_mode, r.price_amount, r.price_min, r.price_max, r.unit, r.match_id, r.error]), items: items.map((i) => [i.id === 'svc_w' ? 'svc_w' : 'new', i.status, i.source]), mirror, site: K.displayPrice({ price_mode: 'site_visit', price_amount: null, price_min: null, price_max: null }) }));`;
    const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepEqual(o.rows, [
      ['Deep clean', 'range', null, 6000, 12000, null, null, null],
      ['Gloria F1', 'fixed', 3, null, null, 'seedling', null, null],
      ['Carpet cleaning', 'quote', null, null, null, null, null, null],
      ['Ansal F1', 'fixed', 2.5, null, null, null, null, null],
      ['Office clean', 'from', 4500, null, null, null, null, null],
      ['Post-construction clean', 'site_visit', null, null, null, null, null, null],
      ['Sofa cleaning', 'fixed', 1500, null, null, 'piece', null, null],
      ['Window cleaning', 'none', null, null, null, null, 'svc_w', null],
      ['Deep clean', 'fixed', 7000, null, null, null, null, 'Same name as a line above.'],
      ['123', 'none', null, null, null, null, null, 'No name on this line.'],
    ]);
    assert.equal(o.items.length, 8);
    assert.deepEqual(o.items.find((x) => x[0] === 'svc_w'), ['svc_w', 'active', null]);
    assert.ok(o.items.filter((x) => x[0] === 'new').every((x) => x[2] === 'import'));
    assert.equal(o.mirror.services_catalog.length, 1);
    assert.equal(o.mirror.services_catalog[0].pricing_mode, 'quote');
    assert.equal(o.mirror.services_catalog[0].site_visit_required, true);
    assert.equal(o.mirror.services_catalog[0].out_of_scope, 'Windows');
    assert.equal(o.site, 'After a site visit');
  });
});
