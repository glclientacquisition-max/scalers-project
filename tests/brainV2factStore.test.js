'use strict';
// C2 one fact store (BRAIN_V2_FACT_STORE, default off): typed store compiled at owner Save inside the
// spoken-catalogue rebuild; variant binding (A7), whole-token item matcher (brain-gaps 2026-10-21 §2),
// area fee, confirmed FAQs only, grounded typed prices.
const test = require('node:test');
const assert = require('node:assert/strict');
const V2 = require('../src/conversation/v2');
const N = require('../src/conversation/v2/nlu');
const FS = require('../src/knowledge/factStore');
const { findProductMatch } = require('../src/conversation/productCatalog');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const S = require('../src/knowledge/spokenCatalogueOnSave');

const JROW = require('./fixtures/tenants/jirani-staging.json').tenant;
const jirani = () => tenantProfileFromRow(JSON.parse(JSON.stringify(JROW)));
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const ARIS = require('./fixtures/fact-store/aris-items.json').catalog;
const PROTRACTORS = ['360 Degrees Protractor', '180\u00c2\u00b0 transparent protractor'];
const NOW = new Date('2026-10-14T05:00:00Z');

function withFlag(fn, v = '1') {
  return async () => {
    const prev = process.env.BRAIN_V2_FACT_STORE;
    if (v == null) delete process.env.BRAIN_V2_FACT_STORE; else process.env.BRAIN_V2_FACT_STORE = v;
    try { await fn(); } finally { if (prev === undefined) delete process.env.BRAIN_V2_FACT_STORE; else process.env.BRAIN_V2_FACT_STORE = prev; }
  };
}
async function talk(lines, profile) {
  const log = { appts: [], srs: [] };
  const handlers = {
    createAppointment: async (a) => { log.appts.push(a); return { id: 'a1', ok: true }; },
    createServiceRequest: async (r) => { log.srs.push(r); return { id: 's1', ok: true }; },
    escalate: async () => ({ ok: true, id: 'e1' }), saveCallerInfo: async () => ({ ok: true }), updateAppointment: async (u) => ({ id: u.appointmentId, ok: true }),
  };
  const st = V2.createState({ profile, callerPhone: '+254700000001', openRows: [], callId: 'HD_c2_unit' });
  const out = [];
  for (const text of lines) out.push((await V2.runTurn(st, { text, profile, now: NOW, handlers })).line);
  return { out, log, st };
}

// ---------- A7: size words pick the variant (EN + SW) ----------
test('A7 flag off (unchanged today): "two bedroom" deep clean is priced as the 1-bedroom row', withFlag(async () => {
  const { out } = await talk(['How much is a deep clean for two bedroom?'], jirani());
  assert.match(out[0], /one bedroom is six thousand five hundred/);
}, null));

test('A7 EN: "deep clean for two bedroom" is 9,500, never the 1-bedroom 6,500', withFlag(async () => {
  const { out } = await talk(['How much is a deep clean for two bedroom?'], jirani());
  assert.match(out[0], /two bedroom is nine thousand five hundred shillings/);
  assert.doesNotMatch(out[0], /six thousand five hundred/);
  for (const t of ['How much is a 2BR deep clean?', 'Deep clean two-bedroom price?', 'how much for deep cleaning a 2 bedroomed house']) {
    const r = await talk([t], jirani());
    assert.match(r.out[0], /nine thousand five hundred/, t);
  }
}));

test('A7 SW: "vyumba viwili" is 9,500; "chumba kimoja" is 6,500', withFlag(async () => {
  let r = await talk(['Bei ya deep clean ya vyumba viwili ni ngapi?'], jirani());
  assert.match(r.out[0], /vyumba viwili ni shilingi elfu tisa na mia tano/);
  r = await talk(['Bei ya deep clean ya chumba kimoja ni ngapi?'], jirani());
  assert.match(r.out[0], /elfu sita na mia tano/);
  r = await talk(['Deep clean bedroom tatu ni pesa ngapi?'], jirani());
  assert.match(r.out[0], /elfu kumi na tatu na mia tano/);
}));

test('A7 booking: the read-back and the write carry the 2-bedroom row', withFlag(async () => {
  const { out, log } = await talk(['Book a deep clean two bedroom Friday 10am in Kilimani, I am Alvin.', 'Yes'], jirani());
  assert.match(out[0], /two bedroom/i);
  assert.equal(log.appts.length, 1);
  assert.equal(log.appts[0].serviceName || log.appts[0].service, 'Deep clean, 2 bedroom');
}));

test('unclear size: one which-size question, never a silent default; the answer settles it (EN + SW)', withFlag(async () => {
  let r = await talk(['How much is deep cleaning?', 'Two'], jirani());
  assert.match(r.out[0], /One bedroom, two bedroom, or three bedroom\?/);
  assert.doesNotMatch(r.out[0], /shillings/);
  assert.match(r.out[1], /nine thousand five hundred/);
  r = await talk(['Bei ya deep clean ni ngapi?', 'viwili'], jirani());
  assert.match(r.out[0], /Chumba kimoja, vyumba viwili, au vyumba vitatu\?/);
  assert.match(r.out[1], /elfu tisa na mia tano/);
  r = await talk(['I want a deep clean on Friday at 10am in Karen', '3 bedroom', 'Alvin', 'Yes'], jirani());
  assert.match(r.out[0], /three bedroom\?$/);
  assert.equal(r.log.appts[0].serviceName || r.log.appts[0].service, 'Deep clean, 3 bedroom');
  // a size the tenant has not listed (studio) is asked, not guessed
  r = await talk(['How much for a studio deep clean?'], jirani());
  assert.match(r.out[0], /which|One bedroom, two bedroom, or three bedroom\?/i);
  assert.doesNotMatch(r.out[0], /shillings/);
}));

test('a size shared by two families ("2BR clean") asks which one', withFlag(async () => {
  const { out } = await talk(['How much is a 2BR clean?'], jirani());
  assert.match(out[0], /Deep clean, two bedroom or Standard clean, two bedroom\?/);
}));

test('studio / bedsitter / 1BR words bind their own variant', withFlag(async () => {
  const p = { vertical: 'home_services', servicesCatalog: [
    { id: 's0', name: 'Studio apartment clean', price_range: 'KSh 2,000', pricing: { mode: 'fixed', amount_ksh: 2000, confirmed: true } },
    { id: 's1', name: '1-Bedroom apartment clean', price_range: 'KSh 3,000', pricing: { mode: 'fixed', amount_ksh: 3000, confirmed: true } },
    { id: 's2', name: '2-Bedroom apartment clean', price_range: 'KSh 4,500', pricing: { mode: 'fixed', amount_ksh: 4500, confirmed: true } },
  ] };
  const f = FS.compileFacts(p);
  const b = (t) => N.bindService(t, f).service?.name || null;
  assert.equal(b('clean my bedsitter'), 'Studio apartment clean');
  assert.equal(b('a studio apartment clean'), 'Studio apartment clean');
  assert.equal(b('1BR apartment clean'), '1-Bedroom apartment clean');
  assert.equal(b('nyumba ya vyumba viwili, apartment clean'), '2-Bedroom apartment clean');
  assert.equal(b('chumba kimoja apartment clean'), '1-Bedroom apartment clean');
  assert.equal(N.bindService('apartment clean please', f).service, null); // only generic words: nothing bound, nothing guessed
}));

// ---------- item matcher: whole tokens only (brain-gaps §2) ----------
test('matcher: "Protractor" is the 2 protractor rows (ambiguous, ask which), never "not in catalogue"', withFlag(async () => {
  const m = findProductMatch('Protractor', ARIS);
  assert.ok(m && PROTRACTORS.includes(m.product.name));
  assert.equal(m.ambiguous, true);
  assert.deepEqual(m.candidates.map((c) => c.name).sort(), [...PROTRACTORS].sort());
  let r = await talk(['Do you have a protractor?'], { vertical: 'retail', productCatalog: ARIS });
  assert.match(r.out[0], /Which one do you mean: 360 Degrees Protractor or 180 degree transparent protractor\?/);
  assert.doesNotMatch(r.out[0], /in stock|isn't on our list|not on our list/);
  r = await talk(['How much is a protractor?', 'the transparent one'], { vertical: 'retail', productCatalog: ARIS });
  assert.match(r.out[0], /Which one do you mean/);
  assert.match(r.out[1], /180° transparent protractor is one hundred eighty shillings/);
}));

test('matcher: "PVC detachable T-square" is the stored "Pvc detachable t square" (case, hyphen)', withFlag(() => {
  for (const t of ['PVC detachable T-square', 'pvc detachable t-squares', 'PVC T square']) assert.equal(findProductMatch(t, ARIS)?.product.name, 'Pvc detachable t square', t);
  const u = N.understand('I need two PVC detachable T-squares', { profile: { vertical: 'retail', productCatalog: ARIS }, now: NOW });
  assert.deepEqual(u.products.map((p) => [p.name, p.qty]), [['Pvc detachable t square', 2]]);
}));

test('matcher: the mojibake 180° row matches by its proper name', withFlag(() => {
  assert.equal(findProductMatch('180° transparent protractor', ARIS)?.product.name, PROTRACTORS[1]);
  assert.equal(findProductMatch('180 degree transparent protractor', ARIS)?.ambiguous, false);
}));

test('matcher negatives: no substring or prefix hits', withFlag(() => {
  for (const t of ['pencil', 'protract', 'squar', 'open', 'T', 'gel pe', 'zip', 'bags of rice', 'carpet']) assert.equal(findProductMatch(t, ARIS), null, t);
  for (const t of ['Do you sell pencils?', 'I want an opener', 'protract']) {
    const u = N.understand(t, { profile: { vertical: 'retail', productCatalog: ARIS }, now: NOW });
    assert.deepEqual(u.products, [], t); assert.equal(u.choice, undefined, t);
  }
  // plurals and case are the same token; several rows on the same words are ambiguous
  assert.equal(findProductMatch('GEL PENS', ARIS)?.product.name, 'Mg gel pen');
  assert.equal(findProductMatch('set square', ARIS)?.ambiguous, true);
  assert.equal(findProductMatch('Adjustable set square', ARIS)?.ambiguous, false);
  const u = N.understand('Do you have zipper bags?', { profile: { vertical: 'retail', productCatalog: ARIS }, now: NOW });
  assert.deepEqual(u.choice.options.sort(), ['prd_17b88d6a4316a45d', 'prd_9d8a1452ff5af4e4']);
}));

test('#840 MATCHER pins flip with the flag on (and hold with it off)', withFlag(async () => {
  assert.equal(findProductMatch('Protractor', ARIS), null);
  assert.equal(findProductMatch('PVC detachable T-square', ARIS), null);
  process.env.BRAIN_V2_FACT_STORE = '1';
  assert.ok(PROTRACTORS.includes(findProductMatch('Protractor', ARIS).product.name));
  assert.equal(findProductMatch('PVC detachable T-square', ARIS).product.name, 'Pvc detachable t square');
}, null));

// ---------- area fee ----------
test('area fee is spoken when the area has one (EN + SW); free is said; unconfirmed fees are not', withFlag(async () => {
  let r = await talk(['Do you come to Karen?'], jirani());
  assert.match(r.out[0], /Karen is on our list of service areas\. The travel fee to Karen is eight hundred shillings\./);
  r = await talk(['Do you come to Kilimani?'], jirani());
  assert.match(r.out[0], /There is no travel fee to Kilimani/);
  r = await talk(['Mnafika Karen?'], jirani());
  assert.match(r.out[0], /Ada ya usafiri kwenda Karen ni shilingi mia nane/);
  r = await talk(['Do you come to Kitengela?'], DD);
  assert.doesNotMatch(r.out[0], /shillings|fee to Kitengela is/);
}));

test('area fee flag off: unchanged (no fee on a coverage answer)', withFlag(async () => {
  const r = await talk(['Do you come to Karen?'], jirani());
  assert.doesNotMatch(r.out[0], /eight hundred/);
}, null));

// ---------- FAQs ----------
test('confirmed FAQ answers the question; DD seed/suggested FAQs are never spoken', withFlag(async () => {
  let r = await talk(['Do you bring your own cleaning supplies?'], jirani());
  assert.match(r.out[0], /brings all supplies and equipment/);
  r = await talk(['How long does a deep clean take?'], jirani());
  assert.match(r.out[0], /About 4 hours for a 1 bedroom/);
  assert.equal(FS.compileFacts(DD).faqs.length, 0);
  r = await talk(['How much is couch cleaning?'], DD);
  assert.doesNotMatch(r.out[0], /\b600\b|six hundred/);
}));

test('an unconfirmed FAQ is not in the store and is never spoken', withFlag(async () => {
  const p = jirani();
  p.faqs = [...p.faqs, { question: 'Do you clean swimming pools?', answer: 'Yes, pools from KSh 50,000.', status: 'suggested', source: 'seed' }];
  assert.ok(!FS.compileFacts(p).faqs.some((f) => /pools/.test(f.question)));
  const r = await talk(['Do you clean swimming pools?'], p);
  assert.doesNotMatch(r.out[0], /50,000|fifty thousand|pools from/);
}));

// ---------- grounded typed price ----------
test('typed price: fixed, from, range and unit from typed values; ask / unconfirmed never spoken', () => {
  assert.equal(FS.typedPrice({ price_range: 'KSh 9,500', pricing: { mode: 'fixed', amount_ksh: 9500, confirmed: true } }).say, 'KSh 9,500');
  assert.equal(FS.typedPrice({ price_range: 'KSh 2000-3000', pricing: { mode: 'range', min_ksh: 2000, max_ksh: 3000, confirmed: true } }).say, 'KSh 2000-3000');
  assert.equal(FS.typedPrice({ price_range: 'KSh 2,000,3,000', pricing: { mode: 'range', min_ksh: 2000, max_ksh: 3000, confirmed: true } }).say, 'KSh 2,000-3,000');
  assert.equal(FS.typedPrice({ pricing: { mode: 'from', min_ksh: 2200, unit: 'sqm', confirmed: true } }).say, 'From KSh 2,200 per m²');
  assert.equal(FS.typedPrice({ price_range: 'KSh 9,500', pricing: { mode: 'fixed', amount_ksh: 9500, confirmed: false } }).say, null);
  assert.equal(FS.typedPrice({ pricing: { mode: 'ask', confirmed: true } }).say, null);
});

test('a service with an "ask" price is never given a number', withFlag(async () => {
  const r = await talk(['How much is carpet cleaning?'], jirani());
  assert.doesNotMatch(r.out[0], /shillings|\d/);
}));

// ---------- the store is compiled at Save and read on the call ----------
const TID = 'df4ad9d8-28ff-4810-b1e6-94f5495472b0';
function fakeDb(row) {
  const calls = { rpc: [], selects: [] };
  return {
    calls,
    rpc: async (name, args) => { calls.rpc.push({ name, args }); row.spoken_catalogue = args.p_doc; return { error: null }; },
    from() {
      const chain = { select(c) { calls.selects.push(c); return chain; }, eq() { return chain; }, limit: () => Promise.resolve({ error: null }), maybeSingle: async () => ({ data: JSON.parse(JSON.stringify(row)), error: null }) };
      return chain;
    },
  };
}
const saveRow = () => ({ ...JSON.parse(JSON.stringify(JROW)), id: TID, spoken_catalogue: null });
const ENV = { SPOKEN_CATALOGUE_ON_SAVE: '1' };
const quiet = { log: () => {} };

test('Save rebuild writes doc.facts (services, areas, policies, confirmed FAQs) and skips an unchanged save', withFlag(async () => {
  const row = saveRow(); const db = fakeDb(row);
  const r = await S.runSpokenCatalogueCompile(TID, { db, env: ENV, ...quiet });
  assert.equal(r.ok, true);
  assert.match(db.calls.selects[0], /faqs/); assert.match(db.calls.selects[0], /business_policies/);
  const f = row.spoken_catalogue.facts;
  assert.equal(f.version, FS.FACTS_VERSION);
  assert.equal(f.services.find((s) => s.name === 'Deep clean, 2 bedroom').variant.value, 2);
  assert.equal(f.services.find((s) => s.name === 'Deep clean, 2 bedroom').price.amount, 9500);
  assert.equal(f.areas.find((a) => a.name === 'Karen').fee.ksh, 800);
  assert.equal(f.faqs.length, 5); assert.ok(f.policies.length >= 1);
  const again = await S.runSpokenCatalogueCompile(TID, { db, env: ENV, ...quiet });
  assert.equal(again.skipped, 'unchanged');
}));

test('Save rebuild: an FAQ-only change regenerates the facts and bumps the version', withFlag(async () => {
  const row = saveRow(); const db = fakeDb(row);
  await S.runSpokenCatalogueCompile(TID, { db, env: ENV, ...quiet });
  const v1 = row.spoken_catalogue.version;
  row.faqs = [...row.faqs, { question: 'Do you work on Sundays?', answer: 'Yes, from 9am.', status: 'confirmed', confirmed: true, source: 'owner' }];
  const r = await S.runSpokenCatalogueCompile(TID, { db, env: ENV, ...quiet });
  assert.equal(r.ok, true); assert.ok(!r.skipped);
  assert.equal(row.spoken_catalogue.version, v1 + 1);
  assert.equal(row.spoken_catalogue.facts.faqs.length, 6);
}));

test('Save rebuild flag off: no facts in the doc, FAQ columns not selected, an FAQ change is a no-op', withFlag(async () => {
  const row = saveRow(); const db = fakeDb(row);
  await S.runSpokenCatalogueCompile(TID, { db, env: ENV, ...quiet });
  assert.equal(row.spoken_catalogue.facts, undefined);
  assert.doesNotMatch(db.calls.selects[0], /faqs/);
  row.faqs = [];
  assert.equal((await S.runSpokenCatalogueCompile(TID, { db, env: ENV, ...quiet })).skipped, 'unchanged');
}, null));

test('call path reads the stored facts when fresh and recompiles when stale', withFlag(() => {
  const p = jirani();
  const stored = FS.compileFacts(p); stored.services[1].price.say = 'KSh 9,500 (stored)';
  p.spokenCatalogue = { facts: stored };
  assert.equal(FS.factsFor(p).services[1].price.say, 'KSh 9,500 (stored)');
  const q = jirani(); q.spokenCatalogue = { facts: { ...stored, sourceHash: 'stale' } };
  assert.equal(FS.factsFor(q).services[1].price.say, 'KSh 9,500');
}));

test('A4 seam: itemFromFacts resolves by id or whole-token name; ambiguous is not matched', () => {
  const f = FS.compileFacts({ productCatalog: ARIS });
  assert.deepEqual(FS.itemFromFacts(f, { name: 'PVC detachable T-square', qty: 2 }), { id: 'prd_493fa696fb8662af', name: 'Pvc detachable t square', qty: 2, price: 400, matched: true, ambiguous: false });
  assert.equal(FS.itemFromFacts(f, { id: 'prd_24174b3b18d2b474' }).name, '180° transparent protractor');
  assert.deepEqual(FS.itemFromFacts(f, { name: 'Protractor' }), { id: null, name: 'Protractor', qty: null, price: null, matched: false, ambiguous: true });
});

test('flag off: nlu binding is the old matcher, no choice', withFlag(() => {
  const u = N.understand('How much is deep cleaning?', { profile: jirani(), now: NOW });
  assert.equal(u.choice, undefined);
  assert.equal(u.service?.name, 'Deep clean, 1 bedroom');
}, null));
