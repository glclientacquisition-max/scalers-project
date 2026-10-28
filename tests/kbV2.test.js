'use strict';
// v2 Knowledge Base: mapping, compile, the 12 call rules, gate, receipts, readiness, lookup latency.
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const I = require('../src/knowledge/kb/items');
const C = require('../src/knowledge/kb/compile');
const R = require('../src/knowledge/kb/reader');
const RU = require('../src/knowledge/kb/rules');
const S = require('../src/knowledge/kb/spoken');
const L = require('../src/knowledge/kb/live');
const RD = require('../src/knowledge/kb/readiness');
const TT = require('../src/knowledge/kb/textTest');
const { tenantProfileFromRow } = require('../src/tenantProfile');

const fx = (n) => require(path.join(__dirname, 'fixtures', 'kb', `${n}.staging.json`));
const HOURS = { days: { mon: { open: '08:00', close: '17:00' }, tue: { open: '08:00', close: '17:00' }, wed: { open: '08:00', close: '17:00' }, thu: { open: '08:00', close: '17:00' }, fri: { open: '08:00', close: '17:00' }, sat: { open: '09:00', close: '13:00' }, sun: { closed: true } } };
const PICKS = {
  dnd: [{ node: 'county:nairobi', serve: true, confirmed_at: '2026-10-25' }, { node: 'estate:nairobi:karen', serve: true, fee_kes: 500, confirmed_at: '2026-10-25' }, { node: 'estate:nairobi:kibera', serve: false, confirmed_at: '2026-10-25' }],
  growtech: [{ node: 'town:kiambu:thika', serve: true, confirmed_at: '2026-10-25' }],
};
const NOW = new Date('2026-10-28T09:00:00+03:00');
const compiled = (n) => { const row = fx(n); return { row, out: C.compileKb({ ...I.fromLegacy(row), business: row.business_name }) }; };
function profileFor(n, { ready = true } = {}) {
  const { row, out } = compiled(n);
  const p = tenantProfileFromRow({ ...row, hours_schedule: HOURS, whatsapp_notification_number: '+254700000000', notify_channels: { sms: true } }, { areaPicksRows: PICKS[n] });
  L.attach(p, { version: 1, readyVersion: ready ? 1 : null, brainTarget: 'v2', doc: out.doc });
  return { p, out };
}
const sentences = (t) => String(t || '').split(/(?<=[.?!])\s+/).filter(Boolean);

describe('kb v2: legacy mapping', () => {
  it('keeps ids and decimal prices from parsed_from; normalises units', () => {
    const { items } = I.fromLegacy(fx('growtech'));
    assert.equal(items.length, 69);
    const gloria = items.find((x) => /gloria/i.test(x.name_en));
    assert.equal(gloria.price_amount, 2.2);
    assert.equal(gloria.unit, 'seedling');
    assert.ok(gloria.id && gloria.legacy_ref);
  });
  it('round-trips to today\'s catalogue shapes', () => {
    const m = I.fromLegacy(fx('dnd'));
    const back = I.toLegacy(m.items, m.categories);
    assert.equal(back.servicesCatalog.length, 11);
    assert.ok(back.servicesCatalog.every((r) => r.id && r.name));
  });
});

describe('kb v2: compile', () => {
  it('Grow Tech compiles live with a compact prompt index under the cap', () => {
    const { out } = compiled('growtech');
    assert.equal(out.status, 'live');
    assert.equal(out.doc.schema, 2);
    assert.ok(out.doc.categories.length >= 10);
    assert.ok(JSON.stringify(out.doc.index).length / 4 < 1500);
    assert.ok(!JSON.stringify(out.doc.index).match(/\d+\.\d{2}|shilling/), 'index carries names, never prices');
  });
  it('a business with nothing speakable does not replace live (blocking)', () => {
    const out = C.compileKb({ items: [{ id: 'x', kind: 'service', name_en: '()', status: 'active', price_mode: 'none' }], categories: [], business: 'Empty' });
    assert.equal(out.blocking, true);
    assert.equal(out.status, 'failed');
  });
  it('writes "what callers hear" preview lines with the same rules as the call', () => {
    const { out } = compiled('dnd');
    assert.ok(out.doc.preview.length >= 2);
    assert.match(out.doc.preview[0].en, /We offer 11 services/);
  });
  it('same source -> same hash (a re-run publishes nothing new)', () => {
    assert.equal(compiled('dnd').out.sourceHash, compiled('dnd').out.sourceHash);
  });
});

describe('kb v2: spoken prices', () => {
  it('says cents in words-safe form; never "3.50" (a sentence splitter cuts at the dot)', () => {
    assert.equal(S.sayPrice({ price_mode: 'fixed', price_amount: 2.2, unit: 'seedling' }).en, '2 shillings 20 cents a seedling');
    const r = S.sayRange(3.5, 6.2, 'seedling');
    assert.doesNotMatch(r.en, /\d\.\d/);
    assert.match(r.en, /3 shillings 50 cents to 6 shillings 20 cents/);
    assert.match(S.sayPrice({ price_mode: 'fixed', price_amount: 2.2, unit: 'seedling' }).sw, /shilingi mbili na senti ishirini kwa mche/);
  });
});

describe('kb v2: the 12 call rules', () => {
  const { out: g } = compiled('growtech');
  const kb = R.openKb(g.doc);
  it('a group: count first, at most 3 names, a narrowing question, no item price', () => {
    const a = RU.answer(kb, 'what tomato seedlings do you have', { asksPrice: false, lang: 'en' });
    assert.equal(a.kind, 'group');
    assert.match(a.text, /^We have 12 kinds of tomatoes/);
    assert.ok(a.shown.length <= 3);
    assert.ok(sentences(a.text).length <= 2);
    assert.equal((a.text.match(/\?/g) || []).length, 1);
    assert.doesNotMatch(a.text, /shilling/);
  });
  it('a group price question gets the range inside the count sentence', () => {
    const a = RU.answer(kb, 'how much is cabbage', { asksPrice: true, lang: 'en' });
    assert.match(a.text, /8 kinds of cabbage, from 2 to 3 shillings a seedling/);
    assert.ok(sentences(a.text).length <= 2);
  });
  it('price only on a pick; "more" gives the next three; picks by position', () => {
    const a = RU.answer(kb, 'what cabbage do you have', { lang: 'en' });
    const more = RU.answer(kb, 'any others?', { lang: 'en', state: a.state });
    assert.ok(more.shown.length <= 3);
    assert.ok(!more.shown.some((id) => a.shown.includes(id)));
    const pick = RU.answer(kb, 'the second one', { asksPrice: true, lang: 'en', state: a.state });
    assert.equal(pick.kind, 'item');
    assert.match(pick.text, /shillings/);
  });
  it('Swahili: kabichi / nyanya resolve; numbers in words', () => {
    const a = RU.answer(kb, 'bei ya kabichi ni ngapi', { asksPrice: true, lang: 'sw' });
    assert.match(a.text, /^Tuna aina nane/);
    assert.match(a.text, /shilingi mbili hadi tatu kwa mche/);
    assert.match(RU.answer(kb, 'mna miche gani ya nyanya?', { lang: 'sw' }).text, /aina kumi na mbili/);
  });
  it('D&D: a named item wins inside a longer phrase (3-bedroom deep clean)', () => {
    const kd = R.openKb(compiled('dnd').out.doc);
    const a = RU.answer(kd, 'how much is a 3-bedroom deep clean', { asksPrice: true, lang: 'en' });
    assert.equal(a.text, 'Deep Clean is 6,000 to 12,000 shillings.');
    const sw = RU.answer(kd, 'bei ya usafi wa kina wa nyumba ya vyumba vitatu ni ngapi', { asksPrice: true, lang: 'sw' });
    assert.match(sw.text, /Deep Clean ni shilingi elfu sita hadi elfu kumi na mbili/);
    assert.equal(RU.answer(kd, 'what home cleaning do you have', { lang: 'en' }).kind, 'group');
  });
});

describe('kb v2: gate (BRAIN_KB_GATE) replaces the env allowlists; off is the kill switch', () => {
  before(() => { process.env.BRAIN_KB_GATE = 'on'; });
  it('ready business: decision true, profile reads the snapshot (projected catalogue)', () => {
    const { p } = profileFor('dnd');
    assert.equal(L.decision({ tenantId: p.id }), true);
    assert.ok(p.kb && p.kb.handle);
    assert.equal(p.kbProjected, true);
    const flag = require('../src/conversation/v2/flag');
    assert.equal(flag.tenantAllowed({ tenantId: p.id, env: { ...process.env, BRAIN_V2_TENANTS: '' } }), true);
  });
  it('not ready: decision false, no snapshot attached (old brain)', () => {
    const { p } = profileFor('growtech', { ready: false });
    assert.equal(L.decision({ tenantId: p.id }), false);
    assert.equal(p.kb, undefined);
  });
  it('gate off: decision null (env lists decide as before)', () => {
    assert.equal(L.decision({ env: { BRAIN_KB_GATE: 'off' }, tenantId: 'x' }), null);
  });
});

describe('kb v2: readiness and text tests', () => {
  before(() => { process.env.BRAIN_KB_GATE = 'on'; });
  for (const n of ['growtech', 'dnd']) {
    it(`${n}: readiness passes on the staging catalogue`, () => {
      const { p, out } = profileFor(n);
      const r = RD.runReadiness(p, { latest: { status: 'live', source_hash: out.sourceHash, issues: out.issues, version: 1 }, currentHash: out.sourceHash });
      assert.equal(r.passed, true, JSON.stringify(r.checks.filter((c) => !c.ok)) + JSON.stringify(r.tests.filter((t) => !t.ok)));
    });
  }
  it('fails without confirmed areas or with a stale hash', () => {
    const { p, out } = profileFor('dnd');
    p.areaPicks = [];
    const r = RD.runReadiness(p, { latest: { status: 'live', source_hash: 'old', issues: out.issues, version: 1 }, currentHash: out.sourceHash });
    assert.equal(r.passed, false);
    assert.ok(r.checks.find((c) => c.id === 'kb_compiled' && !c.ok));
  });
  it('scripted turns follow the rules through the live brain (no model)', async () => {
    const { p } = profileFor('growtech');
    const tt = await TT.runTextTests({ profile: p, extras: ['how much is cabbage', 'what tomato seedlings do you have', 'bei ya kabichi ni ngapi', 'mna miche gani ya nyanya?'], now: NOW });
    for (const t of tt.filter((x) => x.kb_kind)) {
      assert.ok(t.ok, `${t.text} -> ${t.line} (${t.problems})`);
      assert.ok(t.lookup_ms < 20);
    }
    const tom = tt.find((t) => t.text === 'what tomato seedlings do you have');
    assert.match(tom.line, /12 kinds of tomatoes/);
  });
});

describe('kb v2: lookup latency', () => {
  it('10,000 items: index builds once; p99 lookup under 5 ms', () => {
    const items = []; const words = ['tomato', 'cabbage', 'kale', 'onion', 'pepper', 'spinach', 'carrot', 'herb', 'mango', 'avocado'];
    for (let i = 0; i < 10000; i++) items.push({ id: `p${i}`, kind: 'product', name_en: `${words[i % 10]} variety ${i} ${['alpha', 'bravo', 'delta', 'gamma'][i % 4]}`, category_id: words[i % 10], category_name: words[i % 10], price_mode: 'fixed', price_amount: 10 + (i % 90), unit: 'seedling', status: 'active', aliases: [] });
    const out = C.compileKb({ items, categories: words.map((w, i) => ({ id: w, name_en: w, sort: i })), business: 'Big' });
    assert.equal(out.status, 'live');
    assert.equal(out.doc.index.mode, 'categories');
    const kb = R.openKb(out.doc);
    const qs = ['how much is tomato variety 512 alpha', 'what cabbage do you have', 'mango gamma', 'avocdo', 'bei ya kabichi'];
    for (let i = 0; i < 30; i++) kb.find(qs[i % qs.length]); // warm the JIT, as a running server is
    const t = [];
    for (let i = 0; i < 300; i++) { const s = process.hrtime.bigint(); kb.find(qs[i % qs.length]); t.push(Number(process.hrtime.bigint() - s) / 1e6); }
    t.sort((a, b) => a - b);
    assert.ok(t[Math.floor(t.length * 0.99)] < 5, `p99 ${t[Math.floor(t.length * 0.99)]}ms`);
  });
});
