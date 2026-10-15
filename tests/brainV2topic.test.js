'use strict';
// BRAIN_V2_TOPIC_PROPOSALS: topic state, item-name post-check, name hand-back, doc fallback, proposals.
const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/conversation/v2/topic');
const P = require('../src/conversation/v2/proposals');
const SC = require('../src/knowledge/spokenCatalogue');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const doc = SC.compileSync(DD);
const pinned = { ...DD, spokenCatalogue: doc };
const ON = { BRAIN_V2_TOPIC_PROPOSALS: '1' };
const withFlag = async (fn, v = '1') => { const o = process.env.BRAIN_V2_TOPIC_PROPOSALS; if (v == null) delete process.env.BRAIN_V2_TOPIC_PROPOSALS; else process.env.BRAIN_V2_TOPIC_PROPOSALS = v; try { return await fn(); } finally { if (o === undefined) delete process.env.BRAIN_V2_TOPIC_PROPOSALS; else process.env.BRAIN_V2_TOPIC_PROPOSALS = o; } };

test('flag defaults off', () => { assert.equal(T.enabled({}), false); assert.equal(T.enabled(ON), true); });

test('topic TTL is 2 turns and filler / acks inherit it', () => {
  const s = {};
  T.setTopic(s, { kind: 'catalogue', itemIds: ['a'], turn: 1 });
  assert.ok(T.liveTopic(s, 3));
  assert.equal(T.liveTopic(s, 4), null);
  for (const t of ['Karibu.', 'Eeh', 'Sawa', 'mm', 'Nilikuwa nataka—']) assert.ok(T.inheritsTopic(t), t);
  assert.equal(T.inheritsTopic('Nataka kubook usafi wa sofa kesho saa nne'), false);
  assert.equal(T.inheritsTopic('Kitengela.'), false);
});

test('post-check drops legacy and invented item names, keeps grounded lines', () => {
  assert.equal(T.itemNamePostCheck('Tuna Apartment na House Cleaning, Deep Cleaning na Office Cleaning.', doc, { legacyNames: ['Apartment na House Cleaning'] }).ok, false);
  const gem = T.itemNamePostCheck('We also do Pool Cleaning and Car Interior Cleaning.', doc);
  assert.equal(gem.ok, false); assert.equal(gem.line, null); assert.ok(gem.offending.length);
  const fb = T.fallbackLine(doc, 'sw');
  assert.equal(T.itemNamePostCheck(fb, doc).ok, true);
  assert.equal(T.itemNamePostCheck('Yes, we do carpet cleaning, from KSh 2,200 per m².', doc).ok, true);
});

test('dedupe keeps one which-service per turn and none twice in a row', () => {
  const d = T.dedupeQuestions('Which service do you need? Which service would you like to request today?', {});
  assert.equal(T.countWhichService(d), 1);
  // across turns a repeat is fine (re-ask after a filler): only within one turn is it deduped
  assert.equal(T.dedupeQuestions('Ungependa ipi?', { lastLine: 'Tunafanya usafi wa sofa na mazulia. Ungependa ipi?' }), 'Ungependa ipi?');
  assert.equal(T.dedupeQuestions('Ni usafi wa kina. Ungependa ipi?', { lastLine: 'Ungependa ipi?' }), 'Ni usafi wa kina. Ungependa ipi?');
});

test('proposal shape', () => {
  const p = T.proposal({ kind: 'catalogue', text: 'x', lang: 'sw', topic: { kind: 'catalogue' }, claim: true });
  assert.deepStrictEqual(Object.keys(p).sort(), ['claim', 'kind', 'lang', 'priority', 'source', 'text', 'topic']);
  assert.equal(p.source, 'v2'); assert.equal(p.priority, T.PRIORITY.catalogue);
});

test('HD_f9b6 sequence: one catalogue line, Karibu inherits, apartment clarifies; doc pinned, no compileSync', async () => {
  const orig = SC.compileSync; let compiles = 0; SC.compileSync = (...a) => { compiles++; return orig(...a); };
  try {
    const state = {};
    const run = (text) => P.proposeTurn({ text, profile: pinned, language: 'sw', state, model: null });
    const a = await run('Niulize, ni services gani mna- mna offer?');
    assert.equal(a.proposals.length, 1); assert.equal(a.proposals[0].kind, 'catalogue'); assert.equal(a.proposals[0].claim, true);
    assert.doesNotMatch(a.proposals[0].text, /Apartment na House Cleaning/);
    const b = await run('Karibu.');
    assert.equal(b.proposals[0].kind, 'reprompt'); assert.doesNotMatch(b.proposals[0].text, /,.*,/);
    const c = await run('Hebu niambie kuhusu hiyo usafi wa apartment');
    assert.match(c.proposals[0].text, /^Ni ipi kati ya/);
    assert.equal(compiles, 0);
  } finally { SC.compileSync = orig; }
});

test('name yes: v2 yields to Voice name_yes_closer and passes name + current language', async () => {
  const state = { caller: { name: 'Alvin', nameConfirmed: true } };
  await P.proposeTurn({ text: 'What services do you offer?', profile: pinned, language: 'en', state, model: null });
  const r = await P.proposeTurn({ text: "Yes, you're speaking with Alvin.", profile: pinned, language: 'en', state, model: null, nameJustConfirmed: true });
  assert.equal(r.proposals.length, 0);
  assert.deepStrictEqual({ n: r.nameYes.confirmedName, l: r.nameYes.lang }, { n: 'Alvin', l: 'en' });
  assert.match(r.nameYes.openQuestion, /\?$/);
});

test('step failure falls back to the stored doc categories in the caller language', async () => {
  const step = require('../src/conversation/v2/catalogueStep');
  const orig = step.runCatalogueStep; step.runCatalogueStep = async () => { throw new Error('timeout'); };
  try {
    const r = await P.proposeTurn({ text: 'ni services gani mnafanya?', profile: pinned, language: 'sw', state: {}, model: null });
    assert.equal(r.proposals[0].kind, 'fallback');
    assert.equal(r.proposals[0].text, T.fallbackLine(doc, 'sw'));
  } finally { step.runCatalogueStep = orig; }
});

test('no pinned doc: v2 yields', async () => {
  const r = await P.proposeTurn({ text: 'ni services gani mnafanya?', profile: DD, language: 'sw', state: {}, model: null });
  assert.equal(r.proposals.length, 0);
});

test('flag off: planV2CatalogueMouth unchanged (no proposals), machine has no proposals', async () => {
  const { planV2CatalogueMouth } = require('../src/conversation/v2CatalogueTurn');
  const legacy = { line: 'legacy' };
  await withFlag(async () => {
  const r = await planV2CatalogueMouth(legacy, { text: 'ni services gani?', profile: pinned, language: 'sw', state: {}, env: {}, model: null });
  assert.equal(r.v2Proposals, undefined);
  const V2 = require('../src/conversation/v2');
  const st = V2.createState({ profile: DD, callerPhone: '+254700000001' });
  const t = await V2.runTurn(st, { text: 'ni services gani mnafanya?', profile: DD, now: new Date('2026-10-15T09:00:00Z'), handlers: V2.createDryRunHandlers() });
  assert.equal(t.proposals, undefined);
  }, null);
});

test('flag on: planV2CatalogueMouth keeps legacy and adds proposals; machine inherits topic on Karibu', async () => {
  const { planV2CatalogueMouth } = require('../src/conversation/v2CatalogueTurn');
  const legacy = { line: 'Tuna Apartment na House Cleaning, Deep Cleaning.' };
  const r = await planV2CatalogueMouth(legacy, { text: 'ni services gani mnafanya?', profile: pinned, language: 'sw', state: {}, env: ON, model: null });
  assert.equal(r.line, legacy.line); assert.equal(r.v2Proposals[0].source, 'v2_catalogue'); assert.ok(r.v2Proposals[0].lock);
  await withFlag(async () => {
    const V2 = require('../src/conversation/v2');
    const st = V2.createState({ profile: DD, callerPhone: '+254700000001' });
    const h = V2.createDryRunHandlers(); const now = new Date('2026-10-15T09:00:00Z');
    const a = await V2.runTurn(st, { text: 'Niulize, ni services gani mna offer?', profile: DD, now, handlers: h });
    assert.equal(a.proposals[0].kind, 'catalogue');
    const b = await V2.runTurn(st, { text: 'Karibu.', profile: DD, now, handlers: h });
    assert.equal(b.proposals[0].kind, 'reprompt'); assert.equal(b.line, 'Ungependa ipi?');
  });
});

test('nlu: "tell me about X" asks are explain (catalogueStep explain_service), not booking', () => {
  const N = require('../src/conversation/v2/nlu');
  const now = new Date('2026-10-15T09:00:00Z');
  for (const t of ['Hebu niambie kuhusu hiyo usafi wa apartment', 'tell me about the apartment cleaning', 'Niambie kuhusu carpet cleaning', 'What does deep cleaning include?']) {
    const u = N.understand(t, { profile: DD, now });
    assert.ok(u.intents.includes('explain'), t); assert.ok(!u.intents.includes('book'), t);
  }
  assert.ok(N.understand('Nataka kubook usafi kesho', { profile: DD, now }).intents.includes('book'));
});

test('v2 proposals are accepted by Voice TurnArbiter and outrank the legacy doc line', async () => {
  const { createTurnArbiter } = require('../src/speech/turnArbiter');
  const { planV2CatalogueMouth } = require('../src/conversation/v2CatalogueTurn');
  const prof = { ...DD, spokenCataloguePin: { doc, version: 1 } };
  const r = await planV2CatalogueMouth({ line: 'Tuna Apartment na House Cleaning, Deep Cleaning.' }, { text: 'ni services gani mnafanya?', profile: prof, language: 'sw', state: {}, env: ON, model: null });
  const arb = createTurnArbiter({ enabled: true });
  arb.beginTurn('ni services gani mnafanya?');
  const pkt = arb.speak([{ source: 'legacy_catalogue', topic: 'catalogue', line: 'Tuna Apartment na House Cleaning.' }, ...r.v2Proposals]);
  assert.equal(pkt.source, 'v2_catalogue'); assert.equal(pkt.lines.length, 1);
  assert.equal(pkt.facts.docVersion, 1);
  assert.equal(arb.lock().topic, 'catalogue'); assert.match(arb.lock().openQuestion, /\?$/);
});
