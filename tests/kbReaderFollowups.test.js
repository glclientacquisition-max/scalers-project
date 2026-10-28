'use strict';
// KB v2 reader follow-ups (#1000 smoke, 28 Oct). No Gemini: stand-in models, keys unset. Synthetic phone numbers.
//  1. A catalogue enquiry ("what do you offer") and an item not in the catalogue ("do you sell pianos") are typed by
//     the understanding engine (u.catalogue), answered by a catalogue receipt (overview / not_in_catalogue), and
//     written by the response engine; with no model the receipt line is spoken. EN + SW.
//  2. Group names are spoken in a clean form: no bracketed aside, no dash suffix, approved Swahili only.
//  3. A callback for when a paused item is back names that item in the request row and the owner alert.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY;
const C = require('../src/knowledge/kb/compile');
const L = require('../src/knowledge/kb/live');
const S = require('../src/knowledge/kb/source');
const RD = require('../src/knowledge/kb/reader');
const RU = require('../src/knowledge/kb/rules');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { createState } = require('../src/conversation/v2/machine');
const U = require('../src/conversation/v2/understanding');
const CA = require('../src/conversation/v2/catalogueAsk');
const T = require('../src/conversation/v2/engineTools');
const ER = require('../src/conversation/v2/engineReply');
const ML = require('../src/conversation/v2/modelLead');
const GW = require('../src/speech/greetingWarm');
const { runBrainEnginesTurn } = require('../src/conversation/v2/brainEngines');

const PHONE = '+254700000001'; // synthetic
const OWNER = '+254700000002'; // synthetic
const NOW = new Date('2026-10-28T10:00:00+03:00');
const sentences = (t) => String(t || '').split(/(?<=[.?!])\s+/).filter(Boolean);

// cleaning business (D&D shape)
const DND_CATS = [{ id: 'home', name_en: 'Home cleaning' }, { id: 'fabric', name_en: 'Fabric cleaning' }, { id: 'office', name_en: 'Office cleaning' }];
const svc = (o) => ({ kind: 'service', status: 'active', price_mode: 'fixed', price_amount: 3000, category_id: 'home', aliases: [], ...o });
const DND = [
  svc({ id: 'dc', name_en: 'Deep clean', price_amount: 6000, sort: 0 }), svc({ id: 'pc', name_en: 'Post-construction clean', sort: 1 }), svc({ id: 'mo', name_en: 'Move-out clean', sort: 2 }),
  svc({ id: 'mat', name_en: 'Mattress cleaning', category_id: 'fabric', sort: 3 }), svc({ id: 'cur', name_en: 'Curtain cleaning', category_id: 'fabric', sort: 4 }),
  svc({ id: 'sofa', name_en: 'Sofa cleaning', category_id: 'fabric', status: 'paused', status_note: 'Back next week', sort: 5 }),
  svc({ id: 'carpet', name_en: 'Carpet cleaning', category_id: 'fabric', status: 'not_offered', sort: 6 }),
  svc({ id: 'off', name_en: 'Office deep clean', category_id: 'office', sort: 7 }),
];
// nursery (Grow Tech shape: the staging category labels, sampled 28 Oct; no call data)
const GT_CATS = [
  { id: 'cabbage', name_en: 'Cabbage', sort: 0 }, { id: 'tomatoes', name_en: 'Tomatoes', sort: 1 },
  { id: 'capsicum_hoho_green', name_en: 'Capsicum (Hoho) - Green', sort: 2 }, { id: 'capsicum_hoho_coloured', name_en: 'Capsicum (Hoho) - Coloured', sort: 3 },
  { id: 'kales_collards', name_en: 'Kales / Collards', sort: 4 }, { id: 'fruits', name_en: 'Fruits', sort: 5 }, { id: 'fruits_tc_bananas', name_en: 'Fruits - TC Bananas', sort: 6 },
];
const prod = (o) => ({ kind: 'product', status: 'active', price_mode: 'per_unit', price_amount: 5, unit: 'seedling', aliases: [], ...o });
const GT = [
  prod({ id: 'g1', name_en: 'Gloria F1', category_id: 'cabbage', sort: 0 }), prod({ id: 'g2', name_en: 'Copenhagen', category_id: 'cabbage', sort: 1 }),
  prod({ id: 't1', name_en: 'Anna F1', category_id: 'tomatoes', sort: 2 }), prod({ id: 't2', name_en: 'Rio Grande', category_id: 'tomatoes', sort: 3 }), prod({ id: 't3', name_en: 'Kilele F1', category_id: 'tomatoes', sort: 4 }),
  prod({ id: 'c1', name_en: 'California Wonder', category_id: 'capsicum_hoho_green', sort: 5 }), prod({ id: 'c2', name_en: 'Yolo Wonder', category_id: 'capsicum_hoho_green', sort: 6 }),
  prod({ id: 'c3', name_en: 'Red Bell', category_id: 'capsicum_hoho_coloured', sort: 7 }),
  prod({ id: 'k1', name_en: 'Southern Georgia', category_id: 'kales_collards', sort: 8 }),
  prod({ id: 'f1', name_en: 'Hass avocado', category_id: 'fruits', sort: 9 }), prod({ id: 'f2', name_en: 'Grafted mango', category_id: 'fruits', sort: 10 }),
  prod({ id: 'b1', name_en: 'Williams banana', category_id: 'fruits_tc_bananas', sort: 11 }),
];
let seq = 0;
function profileFor(items, categories, { kb = true } = {}) {
  const p = tenantProfileFromRow({ id: `kbfu-${++seq}`, business_name: 'Followup Test Co', vertical: 'home_services', services_offered: 'Legacy text' }, { areaPicksRows: [] });
  if (kb) L.attach(p, { version: 4, readyVersion: 4, brainTarget: 'v2', doc: C.compileKb({ items, categories, business: 'kbfu', now: NOW }).doc, bytes: null, loadMs: 1 }, { env: { BRAIN_KB_GATE: 'on' } });
  return p;
}
const RAW = /[()[\]]|\s-\s|\//;

describe('kb follow-up 2: group names are spoken clean (greeting, overview, prompt)', () => {
  it('spokenGroupName strips bracketed asides and the dash suffix, words a slash, keeps acronyms', () => {
    assert.equal(RD.spokenGroupName('Capsicum (Hoho) - Green'), 'capsicum');
    assert.equal(RD.spokenGroupName('Kales / Collards'), 'kales or collards');
    assert.equal(RD.spokenGroupName('Fruits - TC Bananas'), 'fruits');
    assert.equal(RD.spokenGroupName('Onions and Leeks'), 'onions and leeks');
    assert.equal(RD.spokenGroupName('Home cleaning'), 'home cleaning');
    assert.equal(RD.spokenGroupName('Post-construction'), 'post-construction');
    assert.equal(RD.spokenGroupName('TV & Radio [repairs]'), 'TV and radio');
    assert.equal(RD.spokenGroupName('(Misc)'), 'misc');
    assert.equal(RD.spokenGroupName(''), null);
  });
  it('Grow Tech labels: the greeting names clean groups, each spoken name once (EN + SW)', () => {
    const p = profileFor(GT, GT_CATS);
    const s = S.catalogueSource(p);
    assert.deepEqual(s.openerNames('en'), ['cabbage', 'tomatoes', 'capsicum']);
    assert.equal(s.openerLine('en'), 'We help with cabbage, tomatoes and capsicum.');
    assert.equal(s.openerLine('sw'), 'Tunasaidia na cabbage, tomatoes na capsicum.');
    const gi = GW.greetingInputs(p, { now: NOW });
    assert.ok(!RAW.test(gi.offeringLine), gi.offeringLine);
    assert.ok(!s.groups().some((g) => RAW.test(g.say_en)), JSON.stringify(s.groups()));
  });
  it('the overview and the prompt index read the same clean names', () => {
    const p = profileFor(GT, GT_CATS);
    const o = RU.overview(p.kb.handle, 'en');
    assert.ok(!RAW.test(o), o);
    assert.equal(new Set(o.match(/capsicum/g)).size, 1);
    assert.ok(!RAW.test(String(S.catalogueSource(p).promptBlock('en'))));
    const groups = ML.kb(p).services.map((g) => g.group).filter(Boolean);
    assert.ok(groups.length && !groups.some((g) => RAW.test(g)), groups.join('|'));
  });
  it('a snapshot compiled before this fix (raw say_en) is cleaned on read, no re-publish needed', () => {
    const doc = C.compileKb({ items: GT, categories: GT_CATS, business: 'kbfu', now: NOW }).doc;
    for (const c of doc.categories) c.say_en = String(c.name).toLowerCase(); // the old compile output
    const p = tenantProfileFromRow({ id: `kbfu-old-${++seq}`, business_name: 'Old Snap' }, { areaPicksRows: [] });
    L.attach(p, { version: 2, readyVersion: 2, brainTarget: 'v2', doc }, { env: { BRAIN_KB_GATE: 'on' } });
    assert.equal(S.catalogueSource(p).openerLine('en'), 'We help with cabbage, tomatoes and capsicum.');
  });
  it('Swahili group names: approved / edited only, cleaned the same way; a suggested one is never spoken', () => {
    const cats = [{ id: 'home', name_en: 'Home cleaning', name_sw: 'Usafi wa nyumba (ndani)', name_sw_state: 'approved' }, { id: 'fabric', name_en: 'Fabric cleaning', name_sw: 'Usafi wa vitambaa', name_sw_state: 'suggested' }, { id: 'office', name_en: 'Office cleaning' }];
    const s = S.catalogueSource(profileFor(DND, cats));
    assert.deepEqual(s.openerNames('sw'), ['Usafi wa nyumba', 'fabric cleaning', 'office cleaning']);
  });
});

describe('kb follow-up 1: the understanding engine types a catalogue ask', () => {
  it('rules reading: overview vs item (the caller\'s own words), and non-catalogue asks stay untyped', () => {
    for (const t of ['what do you offer', 'What do you sell?', 'what services do you offer', 'mnauza nini?', 'mna huduma gani', 'huduma zenu ni gani']) assert.equal(CA.catalogueAsk(t)?.kind, 'overview', t);
    assert.deepEqual(CA.catalogueAsk('do you sell pianos?'), { kind: 'item', item: 'pianos' });
    assert.deepEqual(CA.catalogueAsk('Mnauza piano?'), { kind: 'item', item: 'piano' });
    assert.deepEqual(CA.catalogueAsk('do you have any tomato seedlings please'), { kind: 'item', item: 'tomato seedlings' });
    for (const t of ['do you have time tomorrow', 'Una nafasi kesho?', 'do you have mpesa', 'is there parking', 'do you deliver to Kitengela', 'what do you have for me tomorrow', 'do you have a branch in Westlands', 'how can you help', 'do you do weekends?', 'do you work on Sundays', 'mnafanya jumamosi?']) assert.equal(CA.catalogueAsk(t), null, t);
  });
  it('model off: "what do you offer" is a services question (not the open line), KB businesses only', async () => {
    const p = profileFor(DND, DND_CATS);
    const u = await U.runUnderstanding({ text: 'what do you offer', machine: createState({ profile: p, callerPhone: PHONE, callId: 'KBFU_U1' }), profile: p, now: NOW });
    assert.ok(u.answers.includes('services'));
    assert.deepEqual(u.catalogue, { kind: 'overview', item: null });
    const legacy = profileFor(DND, DND_CATS, { kb: false });
    const ul = await U.runUnderstanding({ text: 'do you sell pianos', machine: createState({ profile: legacy, callerPhone: PHONE, callId: 'KBFU_U2' }), profile: legacy, now: NOW });
    assert.equal(ul.catalogue, undefined, 'legacy understanding unchanged');
  });
  it('model on: the typed asked_item is in the KB request only (legacy request unchanged)', () => {
    const p = profileFor(DND, DND_CATS); const legacy = profileFor(DND, DND_CATS, { kb: false });
    const m = createState({ profile: p, callerPhone: PHONE, callId: 'KBFU_U3' });
    const rk = U.understandRequest({ text: 'do you sell pianos', machine: m, profile: p });
    const rl = U.understandRequest({ text: 'do you sell pianos', machine: m, profile: legacy });
    assert.ok(rk.generationConfig.responseSchema.properties.asked_item);
    assert.ok(!rl.generationConfig.responseSchema.properties.asked_item);
    assert.equal(rl.generationConfig.responseSchema, U.SCHEMA);
    assert.match(rk.systemInstruction.parts[0].text, /asked_item/);
    assert.ok(!/asked_item/.test(rl.systemInstruction.parts[0].text));
  });
  it('model on: a typed asked_item wins; the rules fill in when the model leaves it out', async () => {
    const p = profileFor(DND, DND_CATS);
    const m = createState({ profile: p, callerPhone: PHONE, callId: 'KBFU_U4' });
    const stub = (o) => () => async () => ({ text: JSON.stringify({ intent: 'ask', answers: [], ...o }) });
    const a = await U.runUnderstanding({ text: 'do you guys sell a piano', machine: m, profile: p, streamFor: stub({ asked_item: 'piano' }), modelId: 'stub', now: NOW });
    assert.deepEqual(a.catalogue, { kind: 'item', item: 'piano' });
    assert.ok(a.answers.includes('services'));
    const b = await U.runUnderstanding({ text: 'do you sell pianos', machine: m, profile: p, streamFor: stub({}), modelId: 'stub', now: NOW });
    assert.deepEqual(b.catalogue, { kind: 'item', item: 'pianos' });
    const c = await U.runUnderstanding({ text: 'can you do Saturday at 10', machine: m, profile: p, streamFor: stub({ intent: 'book' }), modelId: 'stub', now: NOW });
    assert.equal(c.catalogue, undefined, 'a booking turn is never a catalogue ask');
  });
});

describe('kb follow-up 1: tools -> receipts (overview / not in catalogue), never a miss when the catalogue knows a word', () => {
  const recv = (p, text, lang = 'en') => {
    const m = createState({ profile: p, callerPhone: PHONE, callId: 'KBFU_T' });
    const u = U.typeCatalogueAsk(U.fromNlu(text, p, m, NOW), text, p);
    return T.catalogueReceipt({ u, machine: m, profile: p, kbh: p.kb.handle, lang, text, wantsPrice: u.answers.includes('price'), wantsCoverage: false });
  };
  it('not in the catalogue, EN + SW: grounded no + the groups we do offer + one question', () => {
    const p = profileFor(DND, DND_CATS);
    const r = recv(p, 'do you sell pianos?');
    assert.equal(r.kind, 'not_in_catalogue');
    assert.equal(r.asked, 'pianos');
    assert.deepEqual(r.groups, ['home cleaning', 'fabric cleaning', 'office cleaning']);
    assert.equal(r.text, "Sorry, we don't offer pianos; we do home cleaning, fabric cleaning and office cleaning. Would one of those help?");
    const sw = recv(p, 'mnauza piano?', 'sw');
    assert.equal(sw.kind, 'not_in_catalogue');
    assert.equal(sw.text, 'Samahani, hatuna piano; tuna home cleaning, fabric cleaning na office cleaning. Ipi ingekusaidia?');
    for (const t of [r.text, sw.text]) { assert.ok(sentences(t).length <= 2); assert.equal((t.match(/\?/g) || []).length, 1); }
  });
  it('a products-only business says "sell" and lists clean group names', () => {
    const r = recv(profileFor(GT, GT_CATS), 'do you sell pianos');
    assert.equal(r.text, "Sorry, we don't sell pianos; we have tomatoes, cabbage and capsicum. Would one of those help?");
  });
  it('never a miss: a word the catalogue shares, an offered item, a paused / not-offered item', () => {
    const p = profileFor(DND, DND_CATS);
    assert.notEqual(recv(p, 'do you do house cleaning?').kind, 'not_in_catalogue');
    assert.equal(recv(p, 'do you do curtain cleaning?').kind, 'item');
    assert.equal(recv(p, 'do you do sofa cleaning?').itemState, 'paused');
    assert.equal(recv(p, 'do you do carpet cleaning?').itemState, 'not_offered');
    assert.notEqual(recv(profileFor(GT, GT_CATS), 'do you have hoho seedlings?').kind, 'not_in_catalogue');
  });
  it('"what do you offer": the overview receipt (count, clean groups, one narrowing question), EN + SW', () => {
    const p = profileFor(GT, GT_CATS);
    const r = recv(p, 'what do you offer');
    assert.equal(r.kind, 'overview');
    assert.match(r.text, /^We have 12 products, in groups like tomatoes, cabbage and capsicum\. What are you looking for\?$/);
    const sw = recv(p, 'mnauza nini?', 'sw');
    assert.match(sw.text, /^Tuna aina kumi na mbili za bidhaa, kama tomatoes, cabbage na capsicum\. Unatafuta nini\?$/);
  });
});

describe('kb follow-up 1: the turn end to end (no model = receipt line; stand-in model = model-written)', () => {
  const run = (p, text, extra = {}) => runBrainEnginesTurn({ text, profile: p, machine: createState({ profile: p, callerPhone: PHONE, callId: `KBFU_E${++seq}` }), env: {}, opts: { now: NOW }, ...extra });
  for (const [text, lang, re] of [
    ['what do you offer', 'en', /^We offer 6 services, like home cleaning, fabric cleaning and office cleaning\. Which one do you need\?$/],
    ['mnauza nini?', 'sw', /^Tuna huduma sita, kama home cleaning, fabric cleaning na office cleaning\. Unahitaji ipi\?$/],
    ['do you sell pianos', 'en', /^Sorry, we don't offer pianos; we do home cleaning, fabric cleaning and office cleaning\. Would one of those help\?$/],
    ['Mnauza piano?', 'sw', /^Samahani, hatuna piano; tuna home cleaning/],
  ]) {
    it(`model off, ${lang}: "${text}" is answered from the catalogue, never "How can I help you today?"`, async () => {
      const r = await run(profileFor(DND, DND_CATS), text, { langLock: lang === 'sw' ? 'sw' : null });
      assert.equal(r.goal.type, 'answer');
      assert.match(r.line, re);
      assert.ok(!/how can i help|tukusaidie vipi/i.test(r.line), r.line);
    });
  }
  it('stand-in model: the reply engine gets the typed miss facts and writes the reply (guard passes it)', async () => {
    const p = profileFor(DND, DND_CATS);
    let pack = null;
    const streamFor = () => async ({ request }) => {
      const sys = JSON.stringify(request.systemInstruction || '');
      if (/Read ONE caller turn/.test(sys)) return { text: JSON.stringify({ intent: 'ask', answers: ['services'], asked_item: 'pianos', language: 'en' }) };
      pack = JSON.stringify(request.contents);
      return { text: JSON.stringify({ reply: "We don't offer pianos, but we do home cleaning. Would that help?" }) };
    };
    const r = await run(p, 'do you sell pianos?', { streamFor, modelId: 'stub' });
    assert.equal(r.line, "We don't offer pianos, but we do home cleaning. Would that help?");
    assert.equal(r.answeredBy, 'model');
    assert.equal(r.timings.kbKind, 'not_in_catalogue');
    assert.match(pack, /OFFERED_GROUPS/);
    assert.match(pack, /not_offered/);
    assert.match(pack, /NOT in the catalogue/);
  });
  it('replyPack for a legacy business has no catalogue-miss keys', () => {
    const p = profileFor(DND, DND_CATS, { kb: false });
    const m = createState({ profile: p, callerPhone: PHONE, callId: 'KBFU_RP' });
    const pk = ER.replyPack({ goal: { type: 'answer', answers: ['services'] }, text: 'do you sell pianos', receipts: [], machine: m, lang: 'en', caller: {}, profile: p });
    assert.ok(!('OFFERED_GROUPS' in pk));
    assert.ok(!/NOT in the catalogue/.test(pk.TASK));
  });
});

describe('kb follow-up 3: a callback for when a paused item is back names the item for the owner', () => {
  const setup = () => {
    const p = profileFor(DND, DND_CATS);
    p.teamDirectory = [{ name: 'Owner', role: 'owner', phone: OWNER, receives_escalation: true }];
    const m = createState({ profile: p, callerPhone: PHONE, callId: 'KBFU_WB' });
    const writes = []; const alerts = [];
    const applyTools = async (payload) => { if (payload.serviceRequest) writes.push(payload.serviceRequest); return { results: [{ action: 'create_service_request', ok: true, status: 'succeeded', id: `req-${writes.length}` }] }; };
    const dispatch = async (a) => { alerts.push(a); return [{ channel: 'sms' }]; };
    const stub = (u) => () => async ({ request }) => (/FACTS:/.test(JSON.stringify(request.systemInstruction || '')) ? { text: JSON.stringify({ reply: '' }) } : { text: JSON.stringify({ yes_no: null, slots: {}, language: 'en', answers: [], ...u }) });
    const turn = (text, u) => runBrainEnginesTurn({ text, profile: p, machine: m, streamFor: stub(u), modelId: 'stub', langLock: 'en', applyTools, opts: { now: NOW, dispatch, ctx: {} } });
    return { p, m, writes, alerts, turn };
  };
  it('the read-back, the request row (item + notes) and the owner alert all say which item', async () => {
    const { m, writes, alerts, turn } = setup();
    await turn('do you do sofa cleaning?', { intent: 'ask' });
    assert.deepEqual(m.kbWhenBack, { item: 'Sofa cleaning', turn: m.turn });
    await turn('yes please', { intent: 'unknown', yes_no: 'yes' });
    assert.deepEqual(m.eng.flow.about, { kind: 'when_back', item: 'Sofa cleaning' });
    assert.equal(m.kbWhenBack, null, 'the offer marker is spent once the flow carries it');
    const r3 = await turn('Jane Wanjiku', { intent: 'unknown', slots: { name: 'Jane Wanjiku' } });
    assert.match(r3.line, /about the sofa cleaning/);
    assert.equal(writes.length, 0, 'no save before the read-back yes');
    const r4 = await turn('yes', { intent: 'unknown', yes_no: 'yes' });
    assert.equal(r4.write.status, 'committed');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].item, 'Sofa cleaning');
    assert.match(writes[0].notes, /Sofa cleaning is back/);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0].body, /Reason: Call back when Sofa cleaning is back \(paused item\)/);
  });
  it('a later, unrelated callback offer never carries the paused item', async () => {
    const { m, writes, turn } = setup();
    await turn('do you do sofa cleaning?', { intent: 'ask' });
    await turn('what are your hours?', { intent: 'ask', answers: ['hours'] });
    await turn('ok call me back', { intent: 'callback' });
    assert.ok(!m.eng.flow || !m.eng.flow.about, JSON.stringify(m.eng.flow));
    assert.equal(writes.length, 0);
  });
  it('a plain callback (no paused item) keeps its old request text', () => {
    const H = require('../src/conversation/v2/handoff');
    const m = createState({ profile: {}, callerPhone: PHONE, callId: 'KBFU_PLAIN' });
    const p = H.handoffProposal({ machine: m, profile: {}, callerPhone: PHONE, reason: 'caller_callback', now: NOW });
    assert.equal(p.notes, undefined); assert.equal(p.topic, undefined); assert.equal(p.alertReason, undefined);
  });
});
