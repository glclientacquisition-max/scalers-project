'use strict';
// KB v2 Brain reader (plan 28 Oct): one catalogue door (src/knowledge/kb/source.js) for every caller-facing reader.
// Root causes: 1 off items never offered, 2 named off items get a grounded answer, 4 no second frozen catalogue,
// 5 a price is bound to its own item, 6 names are locked to the KB. EN + SW. No Gemini: stand-in models, keys unset.
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY;
const C = require('../src/knowledge/kb/compile');
const L = require('../src/knowledge/kb/live');
const S = require('../src/knowledge/kb/source');
const RU = require('../src/knowledge/kb/rules');
const I = require('../src/knowledge/kb/items');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { createState } = require('../src/conversation/v2/machine');
const T = require('../src/conversation/v2/engineTools');
const EG = require('../src/conversation/v2/engineGuard');
const ER = require('../src/conversation/v2/engineReply');
const { runBrainEnginesTurn } = require('../src/conversation/v2/brainEngines');
const LK = require('../src/conversation/liveKnowledge');
const GW = require('../src/speech/greetingWarm');
const SC = require('../src/knowledge/spokenCatalogue');
const NLU = require('../src/conversation/v2/nlu');
const STT = require('../src/speech/sttContext');
const PV = require('../src/conversation/provenance');
const { legacySurface } = require('./helpers/kbLegacySurface');

const PHONE = '+254700000001'; // synthetic
const NOW = new Date('2026-10-28T10:00:00+03:00');
const CATS = [{ id: 'home', name_en: 'Home cleaning' }, { id: 'fabric', name_en: 'Fabric cleaning' }, { id: 'office', name_en: 'Office cleaning' }, { id: 'shop', name_en: 'Cleaning supplies' }];
const it_ = (o) => ({ kind: 'service', status: 'active', price_mode: 'fixed', price_amount: 3000, category_id: 'home', aliases: [], ...o });
const ITEMS = [
  it_({ id: 'dc', name_en: 'Deep clean', price_amount: 6000, sort: 0 }),
  it_({ id: 'pc', name_en: 'Post-construction clean', price_amount: 6000, sort: 1 }),
  it_({ id: 'mould', name_en: 'Mould treatment', price_mode: 'site_visit', price_amount: null, sort: 2 }),
  it_({ id: 'uph', name_en: 'Upholstery repair', category_id: 'fabric', price_mode: 'quote', price_amount: null, sort: 3 }),
  it_({ id: 'mat', name_en: 'Mattress cleaning', category_id: 'fabric', price_amount: 2500, name_sw: 'Usafi wa godoro', name_sw_state: 'approved', sort: 4, excludes_en: 'Stain removal, drying' }),
  it_({ id: 'sofa', name_en: 'Sofa cleaning', category_id: 'fabric', status: 'paused', status_note: 'Back next week', sort: 5 }),
  it_({ id: 'rug', name_en: 'Rug shampoo', category_id: 'fabric', status: 'paused', status_note: 'Tutarudi wiki ijayo', sort: 6 }),
  it_({ id: 'carpet', name_en: 'Carpet cleaning', category_id: 'fabric', status: 'not_offered', sort: 7 }),
  it_({ id: 'pw', name_en: 'Pressure washing', status: 'hidden', sort: 8 }),
  it_({ id: 'off', name_en: 'Office deep clean', category_id: 'office', price_mode: 'range', price_amount: null, price_min: 4000, price_max: 9000, sort: 9 }),
  it_({ id: 'bags', kind: 'product', name_en: 'Vacuum bags', category_id: 'shop', price_amount: 500, holdable: true, sort: 10 }),
  it_({ id: 'mop', kind: 'product', name_en: 'Spin mop', category_id: 'shop', price_amount: 800, holdable: false, sort: 11 }),
];
const OFF_NAMES = /sofa cleaning|rug shampoo|carpet cleaning|pressure washing/i;
const compiled = C.compileKb({ items: ITEMS, categories: CATS, business: 'kb-source-test', now: NOW });

let seq = 0;
function kbProfile({ ready = true, gate = true, brainTarget = 'v2', doc = compiled.doc } = {}) {
  const p = tenantProfileFromRow({ id: `kbsrc-${++seq}`, business_name: 'Sparkle Test Cleaners', services_offered: 'Services:\nDeep clean, sofa cleaning, carpet cleaning (legacy text)', vertical: 'home_services' }, { areaPicksRows: [] });
  const env = { BRAIN_KB_GATE: gate ? 'on' : 'off' };
  L.attach(p, { version: 3, readyVersion: ready ? 3 : 2, brainTarget, doc, bytes: null, loadMs: 1 }, { env });
  return p;
}
const sentences = (t) => String(t || '').split(/(?<=[.?!])\s+/).filter(Boolean);

describe('kb source: mode selection (gate on = KB brain for every business; P1 retire the old brain)', () => {
  it('P2: BRAIN_KB_GATE off no longer matters = kb mode', () => { assert.equal(S.catalogueSource(kbProfile({ gate: false })).mode, 'kb'); });
  it('gate on + ready snapshot = kb mode', () => { assert.equal(S.catalogueSource(kbProfile()).mode, 'kb'); });
  // P1: readiness is a quality reason only and brain_target is not read, so neither falls back to the old fields.
  it('gate on + snapshot not ready = kb mode', () => { assert.equal(S.catalogueSource(kbProfile({ ready: false })).mode, 'kb'); });
  it('gate on + load error (no doc) = kb mode on an EMPTY snapshot (never the old fields)', () => {
    const warn = console.warn; console.warn = () => {};
    try { const p = kbProfile({ doc: null }); const s = S.catalogueSource(p); assert.equal(s.mode, 'kb'); assert.equal(s.offered().length, 0); assert.equal(p.servicesOffered, null); } finally { console.warn = warn; }
  });
  it('gate on + brain_target v1 (ignored) = kb mode', () => { assert.equal(S.catalogueSource(kbProfile({ brainTarget: 'v1' })).mode, 'kb'); });
  for (const [label, o] of []) {
    it(`${label} = legacy mode, old fields untouched`, () => {
      const p = kbProfile(o);
      const s = S.catalogueSource(p);
      assert.equal(s.mode, 'legacy');
      assert.equal(s.services(), p.servicesCatalog);
      assert.match(String(p.servicesOffered), /legacy text/);
      assert.deepEqual(s.greetingFields(), { servicesCatalog: p.servicesCatalog, servicesOffered: p.servicesOffered });
    });
  }
  it('no profile = legacy, never throws', () => { assert.equal(S.catalogueSource(null).mode, 'legacy'); });
});

describe('kb source: root cause 1 (paused / not-offered / hidden never offered)', () => {
  const p = kbProfile();
  const s = S.catalogueSource(p);
  it('offered() and the projection hold active items only', () => {
    assert.ok(!s.offered().some((x) => OFF_NAMES.test(x.name)));
    const all = [...p.servicesCatalog, ...p.productCatalog].map((r) => r.name).join('|');
    assert.ok(!OFF_NAMES.test(all), all);
    assert.ok(!I.docToLegacy(compiled.doc).servicesCatalog.some((r) => /sofa/i.test(r.name)));
  });
  it('the old free text is not read on the KB path', () => { assert.equal(p.servicesOffered, null); });
  it('greeting: groups (categories) only, never items, never off items (EN + SW)', () => {
    assert.deepEqual(s.openerNames('en'), ['home cleaning', 'fabric cleaning', 'office cleaning']);
    const gi = GW.greetingInputs(p, { now: NOW });
    assert.equal(gi.offeringLine, 'We help with home cleaning, fabric cleaning and office cleaning.');
    assert.deepEqual(gi.servicesCatalog, []);
    assert.equal(gi.servicesOffered, '');
    assert.ok(!OFF_NAMES.test(JSON.stringify(gi)));
    assert.ok(!/deep clean|mattress/i.test(s.openerLine('en')));
    assert.match(s.openerLine('sw'), /^Tunasaidia na /);
    const one = kbProfile({ doc: C.compileKb({ items: [it_({ id: 'a', name_en: 'Deep clean' })], categories: CATS }).doc });
    assert.equal(S.catalogueSource(one).openerLine('en'), null);
  });
  it('liveKnowledge prompt: no off names, no old services text, names locked per language', () => {
    const g = LK.buildLiveGroundTruth(p);
    assert.ok(!OFF_NAMES.test(g), 'off item in prompt');
    assert.ok(!/legacy text/.test(g));
    assert.match(g, /SPOKEN CATALOGUE \(say item names exactly as written/);
    assert.match(g, /SW: .*Usafi wa godoro/);
    assert.ok(!/usafi wa kina/i.test(g));
  });
  it('fact sheet (provenance) and STT: off items out of the facts, but STT still hears them', () => {
    const f = PV.speechFactText(p);
    assert.ok(!/Sofa cleaning|Carpet cleaning/.test(f));
    assert.ok(!/legacy text/.test(f));
    const terms = STT.collectTenantTerms(p).join('|');
    assert.match(terms, /Sofa cleaning/);
    assert.match(terms, /Carpet cleaning/);
  });
  it('matchers: a paused item never binds as the caller service', () => {
    const u = NLU.understand('I want sofa cleaning tomorrow', { profile: kbProfile(), now: NOW });
    assert.ok(!u.service || !/sofa/i.test(u.service.name));
    const u2 = NLU.understand('how much is the deep clean', { profile: kbProfile(), now: NOW });
    assert.equal(u2.service && u2.service.name, 'Deep clean');
  });
  it('a group answer never names or prices an off item', () => {
    const g = RU.answer(s.handle, 'what fabric cleaning do you do', { asksPrice: false });
    assert.ok(!OFF_NAMES.test(g.text), g.text);
  });
});

describe('kb source: root cause 2 (named off item gets a grounded answer)', () => {
  const recv = (text, lang = 'en', u = { intent: 'ask', answers: [], slots: {} }) => {
    const p = kbProfile();
    const m = createState({ profile: p, callerPhone: PHONE, callId: 'KB_SRC_T' });
    return T.catalogueReceipt({ u, machine: m, profile: p, kbh: p.kb.handle, lang, text, wantsPrice: (u.answers || []).includes('price'), wantsCoverage: false });
  };
  it('not offered, EN + SW: the engines path carries the KB receipt (findForCaller)', () => {
    const r = recv('do you do carpet cleaning?');
    assert.equal(r.itemState, 'not_offered');
    assert.match(r.text, /^Sorry, we don't offer Carpet cleaning\./);
    const sw = recv('mnafanya carpet cleaning?', 'sw');
    assert.equal(sw.itemState, 'not_offered');
    assert.match(sw.text, /^Samahani, hatufanyi Carpet cleaning\./);
  });
  it('paused, EN note in an EN call: note said, then one callback offer for when it is back', () => {
    const r = recv('do you do sofa cleaning?');
    assert.equal(r.itemState, 'paused');
    assert.equal(r.text, "Sorry, Sofa cleaning isn't available right now (Back next week). Shall I have the team call you when it's back?");
    assert.equal(r.capture, 'when_back');
    assert.ok(sentences(r.text).length <= 2);
  });
  it('paused, EN note in a SW call: "the team will confirm" (never an English note in Swahili)', () => {
    const r = recv('mnafanya sofa cleaning?', 'sw');
    assert.equal(r.text, 'Samahani, Sofa cleaning haipatikani kwa sasa; timu itathibitisha lini itarudi. Ungependa timu ikupigie ikirudi?');
    assert.ok(!/back next week/i.test(r.text));
  });
  it('paused, SW note: said in a SW call, left out of an EN call', () => {
    assert.match(recv('mnafanya rug shampoo?', 'sw').text, /haipatikani kwa sasa; tutarudi wiki ijayo\./);
    const en = recv('do you do rug shampoo?');
    assert.ok(!/tutarudi/i.test(en.text));
    assert.match(en.text, /^Sorry, Rug shampoo isn't available right now\./);
  });
  it('an off item and an active one in one turn: one sentence each', () => {
    const p = kbProfile();
    const a = RU.answer(p.kb.handle, 'do you do mattress cleaning and carpet cleaning?', { lang: 'en' });
    assert.equal(a.text, "Yes, we have Mattress cleaning. Sorry, we don't offer Carpet cleaning.");
  });
  it('hidden items are unknown (no receipt claim about them)', () => {
    const p = kbProfile();
    assert.equal(S.catalogueSource(p).findForCaller('pressure washing'), null);
  });
  it('a paused "yes" opens the normal callback (name, read-back, yes, then the save) and never confirms before the save', async () => {
    const p = kbProfile();
    p.teamDirectory = [{ name: 'Owner', role: 'owner', phone: '+254700000002', receives_escalation: true }];
    const m = createState({ profile: p, callerPhone: PHONE, callId: 'KB_SRC_E2E' });
    const writes = [];
    let saveOk = false;
    const applyTools = async (payload) => { if (payload.serviceRequest) writes.push(payload.serviceRequest); return { results: [{ action: 'create_service_request', ok: saveOk, status: saveOk ? 'succeeded' : 'failed', id: saveOk ? 'req-kb-1' : null }] }; };
    const stub = (u, reply = '') => () => async ({ request }) => (/FACTS:/.test(JSON.stringify(request.systemInstruction || '')) ? { text: JSON.stringify({ reply }) } : { text: JSON.stringify(u) });
    const turn = (text, u) => runBrainEnginesTurn({ text, profile: p, machine: m, streamFor: stub({ yes_no: null, slots: {}, language: 'en', wants_human: false, closing: false, answers: [], ...u }), modelId: 'stub', langLock: 'en', applyTools, opts: { now: NOW, dispatch: async () => [{ channel: 'sms' }], ctx: {} } });
    const r1 = await turn('do you do sofa cleaning?', { intent: 'ask' });
    assert.match(r1.line, /isn't available right now/);
    assert.equal(m.eng.offered, 'callback');
    assert.ok(!m.slots.service, 'a paused item is never a booking slot');
    const r2 = await turn('yes please', { intent: 'unknown', yes_no: 'yes' });
    assert.match(r2.line, /May I have your name/);
    assert.equal(writes.length, 0, 'no save before the read-back yes');
    const r3 = await turn('Jane Wanjiku', { intent: 'unknown', slots: { name: 'Jane Wanjiku' } });
    assert.equal(m.eng.pending && m.eng.pending.p.tool, 'create_handoff', `read-back expected: ${r3.line}`);
    assert.match(r3.line, /Jane Wanjiku, shall I ask the owner to call you back/);
    assert.equal(writes.length, 0);
    // commit gate: the save fails, so nothing is confirmed
    const r4 = await turn('yes', { intent: 'unknown', yes_no: 'yes' });
    assert.ok(writes.length >= 1, 'the save was attempted (and its fallback)');
    assert.match(r4.line, /couldn't save that/);
    assert.ok(!/I've asked the owner/.test(r4.line));
  });
});

describe('kb source: root cause 3 (Platform #998/#999) verified from the Brain side', () => {
  it('an old-columns sync naming paused / not-offered items never re-activates or hides them (add-only)', async () => {
    const P2 = require('../src/knowledge/kb/publish');
    const have = [it_({ id: 'sofa', name_en: 'Sofa cleaning', status: 'paused' }), it_({ id: 'carpet', name_en: 'Carpet cleaning', status: 'not_offered' })];
    const calls = [];
    const db = { listKbSource: async () => ({ items: have, categories: [] }), upsertKbItems: async (_t, b) => { calls.push(b); return { upserted: b.items.length }; } };
    const r = await P2.syncFromLegacy(db, 'kbsrc-rc3', { services_catalog: [{ id: 'sofa', name: 'Sofa cleaning', price: '3000' }, { name: 'Carpet cleaning', price: '2000' }, { name: 'Window wash', price: '150' }] });
    assert.equal(r.hidden, 0);
    const sent = calls.flatMap((b) => b.items);
    assert.deepEqual(sent.map((x) => x.name_en), ['Window wash']);
    assert.ok(!sent.some((x) => /sofa|carpet/i.test(x.name_en)));
  });
});

describe('kb source: price types (all count as priced, no invented numbers), EN + SW', () => {
  const p = kbProfile(); const kb = p.kb.handle;
  const cases = [
    ['how much is a deep clean', 'en', /^Deep clean is 6,000 shillings\.$/, 'bei ya deep clean ni ngapi', /^Deep clean ni shilingi elfu sita\.$/],
    ['how much is office deep clean', 'en', /4,000 to 9,000 shillings/, 'bei ya office deep clean', /shilingi elfu nne hadi elfu tisa/],
    ['how much is upholstery repair', 'en', /custom quote; the team will give you a price/, 'bei ya upholstery repair', /bei maalum; timu itakupa bei/],
    ['how much is mould treatment', 'en', /priced after a site visit\. Shall I take your details/, 'bei ya mould treatment', /hutolewa baada ya kukagua eneo/],
  ];
  for (const [en, , reEn, sw, reSw] of cases) {
    it(en, () => {
      const a = RU.answer(kb, en, { asksPrice: true, lang: 'en' }); assert.match(a.text, reEn);
      const b = RU.answer(kb, sw, { asksPrice: true, lang: 'sw' }); assert.match(b.text, reSw);
      for (const t of [a.text, b.text]) assert.ok(sentences(t).length <= 2);
    });
  }
  it('quote / site visit capture the details (callback), never a number', () => {
    assert.equal(RU.answer(kb, 'how much is upholstery repair', { asksPrice: true }).capture, 'quote');
    assert.equal(RU.answer(kb, 'how much is mould treatment', { asksPrice: true }).capture, 'site_visit');
  });
  it('the verifier rejects a number the KB does not have (e.g. "about 3,000" for a quote item)', () => {
    const m = createState({ profile: p, callerPhone: PHONE, callId: 'KB_SRC_V' });
    const ver = EG.makeEnginesVerifier({ st: { kind: 'answer', items: [], lang: 'en' }, receipts: [], coverage: [], caller: {}, profile: p, questions: [{ type: 'price' }], lang: 'en', machine: m, text: 'how much is upholstery repair', u: {}, confirm: [] }, { allowed: new Set() });
    assert.notEqual(ver.check('Upholstery repair is about 3,000 shillings.').verdict, 'pass');
    assert.equal(ver.check('Deep clean is 6,000 shillings.').verdict, 'pass');
  });
});

describe('kb source: not_included (asked only) and can_be_held (products)', () => {
  const p = kbProfile(); const kb = p.kb.handle;
  it('excludes spoken only when the caller asks, EN + SW', () => {
    assert.equal(RU.answer(kb, 'does mattress cleaning include stain removal?', { lang: 'en' }).text, "Mattress cleaning doesn't include stain removal.");
    assert.equal(RU.answer(kb, 'mattress cleaning inahusisha stain removal?', { lang: 'sw' }).text, 'Usafi wa godoro haihusishi stain removal.');
    assert.ok(!/stain|drying/i.test(RU.answer(kb, 'how much is mattress cleaning', { asksPrice: true }).text));
    assert.ok(!/stain|drying/i.test(RU.answer(kb, 'what fabric cleaning do you do', {}).text));
  });
  it('holdable product: offer to hold (a commit: callback capture); not holdable: honest no; EN + SW', () => {
    const a = RU.answer(kb, 'can you keep one vacuum bags for me?', { lang: 'en' });
    assert.equal(a.text, 'We can hold Vacuum bags for you. Shall I take your name and number?');
    assert.equal(a.capture, 'hold');
    assert.equal(RU.answer(kb, 'niwekee vacuum bags', { lang: 'sw' }).text, 'Tunaweza kukuwekea Vacuum bags. Nichukue jina na nambari yako?');
    assert.equal(RU.answer(kb, 'can you hold one spin mop for me?', { lang: 'en' }).text, "We can't hold Spin mop, but you can come in or order.");
    assert.equal(RU.answer(kb, 'niwekee spin mop', { lang: 'sw' }).text, 'Hatuwezi kukuwekea Spin mop, lakini unaweza kuja au kuagiza.');
  });
  it('a follow-up hold ask about the item just answered gets the receipt', () => {
    const m = createState({ profile: p, callerPhone: PHONE, callId: 'KB_SRC_H' });
    T.catalogueReceipt({ u: { intent: 'ask', answers: ['price'], slots: {} }, machine: m, profile: p, kbh: kb, lang: 'en', text: 'how much are vacuum bags', wantsPrice: true, wantsCoverage: false });
    const r = T.catalogueReceipt({ u: { intent: 'ask', answers: [], slots: {} }, machine: m, profile: p, kbh: kb, lang: 'en', text: 'can you keep some for me?', wantsPrice: false, wantsCoverage: false });
    assert.equal(r && r.capture, 'hold');
  });
});

describe('kb source: root cause 5 (a price is bound to its own item)', () => {
  const p = kbProfile(); const kb = p.kb.handle;
  it('a short priced list is item + price pairs, never names followed by one price (EN + SW)', () => {
    const g = RU.answer(kb, 'how much is home cleaning', { asksPrice: true, lang: 'en' });
    assert.equal(g.text, 'Deep clean is 6,000 shillings, Post-construction clean is 6,000 shillings and Mould treatment is priced after a site visit. Which one would you like?');
    assert.ok(!/clean and Post-construction clean, 6,000/i.test(g.text));
    const sw = RU.answer(kb, 'bei ya home cleaning', { asksPrice: true, lang: 'sw' });
    assert.match(sw.text, /^Deep clean ni shilingi elfu sita, Post-construction clean ni shilingi elfu sita na Mould treatment hupangiwa bei baada ya kukagua eneo\./);
  });
  it('a bigger group keeps one true range on its count, and drops a single number', () => {
    const many = ['a', 'b', 'c', 'd'].map((x, i) => it_({ id: x, name_en: `Room ${x} wash`, price_amount: 2000, sort: i }));
    const k1 = require('../src/knowledge/kb/reader').openKb(C.compileKb({ items: many, categories: CATS }).doc);
    const g = RU.answer(k1, 'how much is home cleaning', { asksPrice: true });
    assert.ok(!/2,000/.test(g.text), g.text);
    const k2 = require('../src/knowledge/kb/reader').openKb(C.compileKb({ items: many.map((x, i) => ({ ...x, price_amount: 1000 * (i + 1) })), categories: CATS }).doc);
    assert.match(RU.answer(k2, 'how much is home cleaning', { asksPrice: true }).text, /4 home cleaning services, from 1,000 to 4,000 shillings, like/);
  });
  it('the guard drops a model sentence with several names and one price', () => {
    const m = createState({ profile: p, callerPhone: PHONE, callId: 'KB_SRC_G5' });
    const ver = EG.makeEnginesVerifier({ st: { kind: 'answer', items: [], lang: 'en' }, receipts: [], coverage: [], caller: {}, profile: p, questions: [{ type: 'price' }], lang: 'en', machine: m, text: 'how much', u: {}, confirm: [] }, { allowed: new Set() });
    const v = ver.check('We have Deep clean and Post-construction clean, 6,000 shillings.');
    assert.equal(v.verdict, 'drop'); assert.equal(v.reason, 'kb_price_unbound');
    assert.equal(ver.check('Deep clean is 6,000 shillings, and Post-construction clean is 6,000 shillings.').verdict, 'pass');
  });
});

describe('kb source: root cause 6 (name lock)', () => {
  const p = kbProfile();
  const s = S.catalogueSource(p);
  const verifier = (lang) => EG.makeEnginesVerifier({ st: { kind: 'answer', items: [], lang }, receipts: [], coverage: [], caller: {}, profile: p, questions: [{ type: 'price' }], lang, machine: createState({ profile: p, callerPhone: PHONE, callId: 'KB_SRC_G6' }), text: 'bei', u: {}, confirm: [] }, { allowed: new Set() });
  it('an invented Swahili name ("usafi wa kina") is found and repaired to the locked name (EN name, no approved SW)', () => {
    const nl = s.nameLock('Usafi wa kina ni shilingi elfu sita.', 'sw');
    assert.equal(nl.ok, false);
    assert.equal(nl.text, 'Deep clean ni shilingi elfu sita.');
    const v = verifier('sw').check('Usafi wa kina ni shilingi elfu sita.');
    assert.equal(v.verdict, 'repair'); assert.equal(v.text, 'Deep clean ni shilingi elfu sita.');
    assert.match(v.reason, /^kb_name_not_locked/);
  });
  it('the approved Swahili name passes in a SW call; the EN name verbatim passes too', () => {
    assert.equal(s.nameLock('Usafi wa godoro ni shilingi elfu mbili na mia tano.', 'sw').ok, true);
    assert.equal(s.nameLock('Deep clean ni shilingi elfu sita.', 'sw').ok, true);
    assert.equal(s.nameLock('Deep cleaning is 6,000 shillings.', 'en').ok, true);
  });
  it('an EN call with a reworded name is repaired ("cleaning of mattress" -> Mattress cleaning)', () => {
    const nl = s.nameLock('The cleaning of mattress is 2,500 shillings.', 'en');
    assert.equal(nl.ok, false); assert.equal(nl.text, 'The Mattress cleaning is 2,500 shillings.');
  });
  it('plain words that name no item are never touched (no over-blocking)', () => {
    for (const t of ['We do cleaning in Kilimani.', 'Tunafanya usafi kila siku.', 'Which one would you like?', 'Ungependa ipi?']) assert.equal(s.nameLock(t, 'sw').ok, true, t);
  });
  it('the reply pack carries the locked names for the call language (offered only); legacy has no key', () => {
    const m = createState({ profile: p, callerPhone: PHONE, callId: 'KB_SRC_RP' });
    const pk = ER.replyPack({ goal: { type: 'answer', answers: ['price'] }, text: 'bei', receipts: [], machine: m, lang: 'sw', caller: {}, profile: p });
    assert.ok(pk.ITEM_NAMES.names.includes('Usafi wa godoro'));
    assert.ok(pk.ITEM_NAMES.names.includes('Deep clean'));
    assert.ok(!pk.ITEM_NAMES.names.some((n) => OFF_NAMES.test(n)));
    const leg = kbProfile({ doc: null });
    assert.equal(ER.replyPack({ goal: { type: 'answer' }, text: 'x', receipts: [], machine: m, lang: 'sw', caller: {}, profile: leg }).ITEM_NAMES, undefined);
  });
});

describe('kb source: root cause 4 (no second frozen catalogue next to the KB)', () => {
  it('a KB business never pins the stored legacy spoken_catalogue; the pinned doc is KB-locked', () => {
    const p = kbProfile();
    p.spokenCatalogue = { schemaVersion: 99, version: 7, sourceHash: 'stale', entries: [{ id: 'old', raw: { name: 'Sofa cleaning' }, spoken: { en: 'sofa cleaning', sw: 'usafi wa sofa' } }], categories: [] };
    for (const env of [{}, { SPOKEN_CATALOGUE_STORED_FIRST: 'on' }]) {
      const meta = SC.resolveSpokenCatalogueMeta(p, { env });
      assert.notEqual(meta.doc.version, 7);
      assert.equal(meta.doc.kb, true);
      const blob = JSON.stringify(meta.doc.entries.map((e) => [e.raw.name, e.spoken]));
      assert.ok(!OFF_NAMES.test(blob), blob);
      assert.ok(!/usafi wa kina/i.test(blob), blob);
      const dc = meta.doc.entries.find((e) => e.raw.name === 'Deep clean');
      assert.deepEqual(dc.spoken, { en: 'Deep clean', sw: 'Deep clean' });
      assert.deepEqual(meta.doc.entries.find((e) => e.raw.name === 'Mattress cleaning').spoken, { en: 'Mattress cleaning', sw: 'Usafi wa godoro' });
    }
    const pin = SC.pinSpokenCatalogue(p);
    assert.equal(pin.doc.kb, true);
  });
  it('legacy mode (no attach at all) still pins the stored doc exactly as before', () => {
    const p = tenantProfileFromRow({ id: 'kbsrc-legacy', business_name: 'Sparkle Test Cleaners', vertical: 'home_services' }, { areaPicksRows: [] });
    const stored = { schemaVersion: 99, version: 7, sourceHash: 'x', entries: [], categories: [] };
    p.spokenCatalogue = stored;
    assert.equal(SC.resolveSpokenCatalogueMeta(p, { env: { SPOKEN_CATALOGUE_STORED_FIRST: 'on' } }).doc, stored);
  });
});

describe('kb source: legacy (no KB) mode is byte-for-byte unchanged', () => {
  it('every caller-facing catalogue read matches the pre-PR snapshot (staging 3a037cd9)', () => {
    const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'kbLegacyGolden.json'), 'utf8'));
    const now = legacySurface();
    for (const k of Object.keys(golden)) assert.deepEqual(now[k], golden[k], `legacy surface changed: ${k}`);
    assert.deepEqual(Object.keys(now).sort(), Object.keys(golden).sort());
  });
});
