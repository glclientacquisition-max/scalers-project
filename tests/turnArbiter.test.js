'use strict';
// VOICE_TURN_ARBITER: one SpeakPacket per caller turn.
// Fixtures: HD_f9b67efaf590 T2 (double catalogue), T3 ("Karibu." barge -> English re-list),
// HD_73fa119a7435 T2 (name Yes deleted the list -> two which-service closers).
// The turn glue below mirrors server.js runCallerTurn in the same order:
// resolveLocalReply -> planCatalogueMouth -> planV2CatalogueMouth -> buildTurnProposals -> speak.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/speech/turnArbiter');
const { buildTurnProposals } = require('../src/conversation/turnProposals');
const SC = require('../src/knowledge/spokenCatalogue');
const { resolveLocalReply } = require('../src/conversation/turnPolicy');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');
const { planCatalogueMouth } = require('../src/speech/catalogueMouth');
const { planV2CatalogueMouth } = require('../src/conversation/v2CatalogueTurn');
const { senseCheck } = require('../src/conversation/v2/senseCheck');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');

const ON = { VOICE_V2_CATALOGUE: '1', VOICE_V2_CATALOGUE_MODEL: 'off' };
function ddProfile({ drift = false } = {}) {
  const p = JSON.parse(JSON.stringify(DD));
  const stored = SC.compileSync(p); stored.version = 1; // the live doc in tenants.spoken_catalogue
  p.spokenCatalogue = stored;
  if (drift) p.servicesCatalog[0].notes = 'edited after save'; // hash no longer matches
  return p;
}
function callSetup(profile) {
  const traces = [];
  const arb = A.createTurnArbiter({ enabled: true, state: {}, trace: (e) => traces.push(e) });
  SC.pinSpokenCatalogue(profile);
  return { arb, traces, state: createBrainState(profile), profile };
}
async function turn(call, text, lang, { nameJustConfirmed = false } = {}) {
  const { arb, profile } = call;
  arb.beginTurn(text);
  call.state = observeCallerTurn(call.state, { text, detectedLanguage: lang, resolvedLanguage: lang, profile, entities: extractConversationEntities(text, { profile, state: call.state }) });
  if (nameJustConfirmed) { call.state.caller.nameJustConfirmed = true; call.state.caller.nameConfirmed = true; call.state.caller.name = 'Alvin'; }
  const state = call.state;
  const localReply = resolveLocalReply({ text, state, profile, language: lang });
  const legacy = planCatalogueMouth({ localReply, text, profile, language: lang, state, callerTurns: state?.conversation?.answersReceived, catalogueListed: state?.conversation?.catalogueListed === true, reasoningDown: false, geminiCatalogue: false });
  const v2 = await planV2CatalogueMouth(legacy, { text, profile, language: lang, state, env: ON, model: null, topicLocked: arb.lock()?.topic === 'catalogue' });
  const proposals = buildTurnProposals({ text, lang, doc: profile.spokenCataloguePin.doc, docVersion: profile.spokenCataloguePin.version, localReply, legacyMouth: legacy, v2Mouth: v2, nameJustConfirmed, callerName: state.caller?.name, callerNameConfirmed: state.caller?.nameConfirmed === true, catalogueListed: state?.conversation?.catalogueListed === true, lock: arb.lock() });
  const packet = proposals.length ? arb.speak(proposals) : null;
  if (packet?.topic === 'catalogue') { state.conversation = state.conversation || {}; state.conversation.catalogueListed = true; }
  return { packet, proposals, localReply, legacy, v2 };
}

test('arbiter: one sealed packet, rejected proposals traced, TTS outside it refused', () => {
  const traces = [];
  const arb = A.createTurnArbiter({ enabled: true, state: {}, trace: (e) => traces.push(e) });
  arb.beginTurn('services?');
  const p = arb.speak([{ source: 'legacy_catalogue', line: 'Tuna Apartment na House Cleaning.' }, { source: 'v2_catalogue', topic: 'catalogue', line: 'Tunafanya usafi wa magodoro. Ungependa ipi?', lock: { topic: 'catalogue', openQuestion: 'Ungependa ipi?' } }, { source: 'local_catalogue', line: 'x' }]);
  assert.equal(p.source, 'v2_catalogue');
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.lines));
  assert.throws(() => { 'use strict'; p.lines.push('more'); });
  assert.equal(traces.filter((t) => t.kind === 'proposal_rejected').length, 2);
  assert.equal(arb.admit('Tunafanya usafi wa magodoro. Ungependa ipi?').ok, true);
  assert.equal(arb.admit('Tuna Apartment na House Cleaning.').ok, false);
  assert.equal(arb.admit('Mm.', { isFiller: true }).ok, true);
  assert.equal(arb.geminiAllowed(), false);
  assert.equal(arb.admit('Good evening, Done and Dusted.', { isReplay: true }).ok, false, 'greeting replay inside a locked topic');
  arb.release();
  assert.equal(arb.admit('anything').ok, true);
});

test('arbiter off: no decision, every TTS admitted (byte-identical legacy path)', () => {
  const arb = A.createTurnArbiter({ enabled: false });
  assert.equal(arb.speak([{ source: 'v2_catalogue', line: 'a' }]), null);
  assert.equal(arb.admit('b').ok, true);
  assert.equal(arb.geminiAllowed(), true);
  assert.equal(A.turnArbiterEnabled({}), false);
});

test('polish touches prosody only on a sealed line', () => {
  const line = 'Tunafanya usafi wa magodoro, sofa. Ungependa ipi?';
  assert.equal(A.polishPacketLine(line, (t) => t.replace(', ', ' — ')), 'Tunafanya usafi wa magodoro — sofa. Ungependa ipi?');
  assert.equal(A.polishPacketLine(line, (t) => t.replace('sofa', 'Sofa Cleaning')), line);
  assert.equal(A.polishPacketLine(line, () => ''), line);
});

test('topic lock survives barge-in fragments and backchannels, ages on other turns', () => {
  const st = {};
  const arb = A.createTurnArbiter({ enabled: true, state: st });
  arb.beginTurn('services');
  arb.speak([{ source: 'v2_catalogue', topic: 'catalogue', line: 'We do x. Which would you like?', lock: { topic: 'catalogue', step: 'list', docVersion: 1, openQuestion: 'Which would you like?' } }]);
  for (const t of ['Karibu.', 'Yeah', 'Sawa', 'mm']) arb.beginTurn(t);
  assert.equal(st.turnLock.topic, 'catalogue');
  assert.equal(st.turnLock.docVersion, 1);
  for (let i = 0; i < A.LOCK_TTL; i++) arb.beginTurn('I want to book for Saturday morning please');
  assert.equal(st.turnLock, null);
});

test('doc pinned at call start: drifted hash keeps the stored doc, no compile on the hot path', () => {
  const prev = process.env.SPOKEN_CATALOGUE_STORED_FIRST; process.env.SPOKEN_CATALOGUE_STORED_FIRST = '1';
  try {
    const p = ddProfile({ drift: true });
    const pin = SC.pinSpokenCatalogue(p);
    assert.equal(pin.version, 1); assert.equal(pin.stale, true); assert.equal(pin.doc, p.spokenCatalogue);
    const real = SC.compileSync; let compiled = 0;
    // resolve on every turn returns the pin, even with the flag flipped mid-call
    process.env.SPOKEN_CATALOGUE_STORED_FIRST = '';
    p.servicesCatalog.push({ name: 'New thing', price_range: 'KSh 900' });
    for (let i = 0; i < 3; i++) { const d = SC.resolveSpokenCatalogue(p); if (d !== pin.doc) compiled++; }
    assert.equal(compiled, 0); assert.equal(SC.compileSync, real);
    assert.equal(SC.resolveSpokenCatalogueMeta(p).pinned, true);
  } finally { if (prev === undefined) delete process.env.SPOKEN_CATALOGUE_STORED_FIRST; else process.env.SPOKEN_CATALOGUE_STORED_FIRST = prev; }
});

test('HD_f9b67efaf590 T2/T3: one Swahili catalogue packet; "Karibu." keeps the topic, no English re-list', async () => {
  const call = callSetup(ddProfile());
  const t2 = await turn(call, 'Niulize, ni services gani mna- mna offer?', 'sw');
  assert.ok(t2.packet, 'turn claimed');
  assert.equal(t2.packet.lines.length, 1, t2.packet.lines.join(' | '));
  const line = t2.packet.lines[0];
  assert.match(line, /^Tunafanya usafi wa magodoro/);
  assert.doesNotMatch(line, /Apartment|House Cleaning|Office Cleaning|Mattress cleaning/);
  assert.ok(senseCheck({ line, lang: 'sw', intent: 'services', sc: call.profile.spokenCataloguePin.doc, caller: 'Niulize, ni services gani mna- mna offer?' }).ok, line);
  const rejected = call.traces.filter((t) => t.kind === 'proposal_rejected' && t.turn === t2.packet.turn).map((t) => t.source);
  assert.ok(rejected.length >= 1, `legacy/local proposals traced: ${JSON.stringify(rejected)}`);
  assert.equal(call.arb.admit('Tuna Apartment na House Cleaning, Deep Cleaning, Office Cleaning, na Mattress cleaning, na zingine. Unahitaji gani?').ok, false);
  assert.equal(call.arb.admit('Good evening, Done and Dusted, this is Shy. You can speak in English or Kiswahili. We\'re closed now. Tukusaidie vipi.', { isReplay: true }).ok, false);
  call.arb.release();
  const t3 = await turn(call, 'Karibu.', 'sw');
  assert.ok(t3.packet, 'backchannel inside the catalogue topic is claimed');
  assert.equal(t3.packet.source, 'topic_hold');
  assert.deepEqual(t3.packet.lines, ['Ungependa ipi?']);
  assert.equal(call.arb.geminiAllowed(), false, 'live Gemini suppressed while the catalogue packet is locked');
  call.arb.release();
  // T4 is Brain's explain_service (#707); Voice no longer proposes it. Unclaimed -> Gemini, item names post-checked.
  const t4 = await turn(call, 'Hebu niambie kuhusu hiyo usafi wa apartment', 'sw');
  assert.ok(!t4.proposals.some((p) => p.facts?.renderedFrom === 'locked_followup'), 'stopgap explain proposer removed');
});

test('HD_73fa119a7435 T2: name Yes after the list = one closer back to the open question', async () => {
  const call = callSetup(ddProfile());
  const t1 = await turn(call, "Alvin, how are you? I'm calling to contact for joining services. Gani mnapenda?", 'en');
  assert.ok(t1.packet && t1.packet.topic === 'catalogue', 'T1 catalogue owned by the arbiter, not legacy flag_off');
  assert.doesNotMatch(t1.packet.lines[0], /Apartment and House Cleaning/);
  call.arb.release();
  const t2 = await turn(call, "Yes, you're speaking with Alvin.", 'en', { nameJustConfirmed: true });
  assert.ok(t2.packet);
  assert.equal(t2.packet.source, 'name_yes_closer');
  assert.equal(t2.packet.lines.length, 1);
  const closer = t2.packet.lines[0];
  assert.equal((closer.match(/\?/g) || []).length, 1, closer);
  assert.doesNotMatch(closer, /Which service do you need/);
  assert.equal(closer, 'Thanks, Alvin. Which of those would you like?');
  assert.equal(call.state.conversation.catalogueListed, true, 'grounded list not cleared on name Yes');
});

test('flag-off sanity: the same turn glue with the arbiter off claims nothing', async () => {
  const p = ddProfile();
  const arb = A.createTurnArbiter({ enabled: false });
  assert.equal(arb.speak(buildTurnProposals({ text: 'services?', lang: 'en', doc: SC.compileSync(p), v2Mouth: { reason: 'v2_catalogue', line: 'We do x. Which would you like?' } })), null);
});

// V1: the arbiter is unwired from server.js. After B2 nothing called speak(), so admit() always passed (inert).
// The call-start catalogue pin it gated is kept unconditionally (the v2 machine/topic/fact store read it).
test('server.js (V1): no arbiter wiring; speakText has no admit gate; the call-start pin stays', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  const body = (name) => src.slice(src.indexOf(name), src.indexOf(name) + 600);
  assert.doesNotMatch(src, /turnArbiter|createTurnArbiter/);
  assert.doesNotMatch(body('async function speakText(text, opts = {}) {'), /admit\(/);
  // B2: playCachedReceipt and the Gemini reply session (onSpokenChunk) were the old turn's, deleted with it
  assert.doesNotMatch(src, /function playCachedReceipt\(|async function onSpokenChunk\(/);
  // beginSpeak only in the greeting and the speakText internals.
  assert.equal((src.match(/tts\.beginSpeak\(/g) || []).length, 2);
  assert.match(src, /pinSpokenCatalogue\(profile\)/);
});

test('Brain review: closer language/wording, confirmed name only', () => {
  const { closerAfterNameYes } = require('../src/conversation/turnProposals');
  assert.equal(closerAfterNameYes({ name: 'Alvin', nameConfirmed: true, lang: 'sw' }), 'Asante, Alvin. Kati ya huduma nilizotaja, ungependa ipi?');
  assert.equal(closerAfterNameYes({ name: 'Alvin', nameConfirmed: true, lang: 'en' }), 'Thanks, Alvin. Which of those would you like?');
  assert.equal(closerAfterNameYes({ name: 'Alvin how', nameConfirmed: false, lang: 'en' }), 'Thanks. Which of those would you like?');
  // the current turn's language wins over the lock's
  const p = buildTurnProposals({ text: 'Ndio, ni mimi Alvin', lang: 'sw', nameJustConfirmed: true, callerName: 'Alvin', callerNameConfirmed: true, catalogueListed: true, lock: { topic: 'catalogue', lang: 'en', openQuestion: 'Which would you like?' } });
  assert.equal(p.length, 1); assert.equal(p[0].line, 'Asante, Alvin. Kati ya huduma nilizotaja, ungependa ipi?');
});

test('Brain review: backchannel set, thank-you closes, yes only for non yes/no questions, hello replays', () => {
  for (const t of ['Karibu.', 'mm, sawa basi', 'ehe', 'Mhm.', 'm-hm', 'naam', 'haya haya', 'oh', 'ah, I see', 'nakusikia', 'nimekusikia', 'nisikize', 'ok okay']) assert.ok(A.isBackchannel(t), t);
  for (const t of ['asante', 'Thanks.', 'thank you', 'sawa asante', 'ok ok ok ok']) assert.ok(!A.isBackchannel(t), t);
  assert.ok(A.isBackchannel('Yes.', { openQuestion: 'Ungependa ipi?' }));
  assert.ok(A.isBackchannel('ndio', { openQuestion: 'Which would you like?' }));
  assert.ok(!A.isBackchannel('Yes.', { openQuestion: 'Is that for Saturday?' }));
  assert.ok(!A.isBackchannel('ndio', { openQuestion: 'Je, naongea na Alvin?' }));
  const lock = { topic: 'catalogue', lang: 'sw', openQuestion: 'Ungependa ipi?', lines: ['Tunafanya usafi wa magodoro. Ungependa ipi?'] };
  const hello = buildTurnProposals({ text: 'Hello?', lang: 'sw', lock, catalogueListed: true });
  assert.deepEqual(hello.map((p) => p.line), ['Tunafanya usafi wa magodoro. Ungependa ipi?']);
  assert.deepEqual(buildTurnProposals({ text: 'Asante.', lang: 'sw', lock, catalogueListed: true }), [], 'thank-you is not held in the topic');
  assert.deepEqual(buildTurnProposals({ text: 'Mhm', lang: 'en', lock, catalogueListed: true }).map((p) => p.line), ['Which would you like?'], 'reprompt in the current language');
});

test('Gemini line on an unclaimed turn is item-name post-checked against the pinned doc', () => {
  const traces = [];
  const arb = A.createTurnArbiter({ enabled: true, state: {}, trace: (e) => traces.push(e) });
  arb.beginTurn('x');
  const doc = SC.compileSync(ddProfile());
  let topic = null; try { topic = require('../src/conversation/v2/topic'); } catch { topic = null; }
  if (!topic?.itemNamePostCheck) { assert.equal(arb.geminiLineOk('Tuna-offer Gold Plan.', doc), true, 'no #707: no check'); return; }
  const bad = 'Tuna-offer 1-Bedroom, 2-Bedroom na 3-Bedroom apartment cleaning, Window Tinting na Gold Plan.';
  const expect = topic.itemNamePostCheck(bad, doc).ok;
  assert.equal(arb.geminiLineOk(bad, doc), expect);
  if (!expect) assert.ok(traces.some((t) => t.reason === 'item_name_post_check'));
});

test('v2 catalogue command uses responseJsonSchema (JSON Schema), not responseSchema', () => {
  const C = require('../src/conversation/v2/catalogueStep');
  const req = C.buildCommandRequest({ text: 'services?', sc: SC.compileSync(ddProfile()), lang: 'en' });
  assert.equal('responseSchema' in req.generationConfig, false);
  assert.equal(req.generationConfig.responseJsonSchema.type, 'object');
  assert.equal(req.generationConfig.responseMimeType, 'application/json');
});
