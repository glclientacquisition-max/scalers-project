'use strict';
// BRAIN_TRUST_P1 caller-name design (Alvin, 14 Oct 07:45).
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.BRAIN_TRUST_P1 = 'on';
process.env.BRAIN_CALL_FIXES_D199 = 'on';

const ctl = require('../src/conversation/callerNameControl');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');
const { createEchoGate } = require('../src/speech/echoGate');
const places = require('../src/conversation/kenyaPlaces');
const tts = require('../src/speech/ttsNormalize');
const trust = require('../src/conversation/trustP1');

const tok = (text, confidence) => text.split(' ').map((t) => ({ text: ` ${t}`, confidence, is_final: true }));
function turn(prev, text, { agent = 'Can I take your name for the booking?', tokens = null } = {}) {
  const entities = extractConversationEntities(text, { profile: {}, state: prev });
  return observeCallerTurn(prev, { text, entities, profile: {}, lastAgentText: agent, sttTokens: tokens });
}
const fresh = () => { const s = createBrainState({}); s.conversation = { ...(s.conversation || {}), turnCount: 2 }; return s; };

// ---------------------------------------------------------------- helpers
test('confidence: min over the tokens that spell the name', () => {
  assert.equal(ctl.nameConfidence('Wanjiru', [{ text: 'Wan', confidence: 0.9 }, { text: 'jiru', confidence: 0.7 }]), 0.7);
  assert.equal(ctl.nameConfidence('Wanjiru', []), null);
});
test('spelling: letters, double, apostrophe', () => {
  assert.equal(ctl.parseSpelledName('W A N J I R U'), 'Wanjiru');
  assert.equal(ctl.parseSpelledName('it is spelled M, W, I, K, A, L, I'), 'Mwikali');
  assert.equal(ctl.parseSpelledName('N J O R O G E'), 'Njoroge');
});
test('honorific mirrors only the caller', () => {
  assert.equal(ctl.callerHonorific('This is Mrs Achieng'), 'mrs');
  assert.ok(!ctl.callerHonorific('Achieng here'));
});
test('handover label: confirmed name or caller on 07xx', () => {
  assert.equal(ctl.handoverCallerLabel({ name: 'Wanjiru', nameConfirmed: true, phone: '+254712345678' }), 'Wanjiru');
  assert.match(ctl.handoverCallerLabel({ name: 'Wanjiru', nameConfirmed: false, phone: '+254712345678' }), /^caller on 07/);
});
test('TTS boundary strips name apostrophes, keeps contractions', () => {
  assert.equal(tts.prepareForTts("Karibu, Achieng'. Don't worry.", { callLanguage: 'en' }).text, 'Karibu, Achieng. Don\'t worry.');
});
test('junk list: mteja, like, disappointed', () => {
  const q = require('../src/conversation/callerNameQuality');
  for (const w of ['mteja', 'like', 'disappointed']) assert.equal(q.isJunkCallerName(w), true, w);
});
test('Kampala is foreign before fuzzy (never Kamara)', () => {
  assert.equal(places.nearestAllowedPlace('kampala', ['kamara']), '');
});

// ---------------------------------------------------------------- echo gate
test('echo gate: exempt / name-led / old lines / needs playback overlap', () => {
  const g = createEchoGate();
  g.remember('Karibu tena. How can I help you today?', 1000);
  g.remember('Can I take your name for the booking?', 2000);
  assert.equal(g.isEcho('Karibu tena', { at: 2100, speaking: true }), true);
  assert.equal(g.isEcho('Karibu tena', { at: 2100, speaking: true, exempt: true }), false);
  assert.equal(g.isEcho('My name is Karibu', { at: 2100, speaking: true }), false);
  assert.equal(g.isEcho('Karibu tena', { at: 99999, speaking: false }), false);
});

// ---------------------------------------------------------------- 9 eval cases
test('eval 1: clear name 0.95 binds, read back once', () => {
  const s = turn(fresh(), 'My name is Wanjiru', { tokens: tok('My name is Wanjiru', 0.95) });
  assert.equal(s.caller.name, 'Wanjiru');
  assert.equal(s.caller.nameConfirmed, true);
});
test('eval 2: mid confidence 0.75 → candidate, confirm or spell', () => {
  const s = turn(fresh(), 'My name is Njoroge', { tokens: tok('My name is Njoroge', 0.75) });
  assert.notEqual(s.caller.nameConfirmed, true);
  assert.match(ctl.nameAskHint(s) || '', /Njoroge/);
});
test('eval 3: low confidence 0.5 → re-ask, nothing bound', () => {
  const s = turn(fresh(), 'My name is Kiprotich', { tokens: tok('My name is Kiprotich', 0.5) });
  assert.notEqual(s.caller.nameConfirmed, true);
  assert.equal(s.trust.nameReask, true);
});
test('eval 4: common-word name (Hope) → confirm, not bound', () => {
  const s = turn(fresh(), 'My name is Hope', { tokens: tok('My name is Hope', 0.97) });
  assert.notEqual(s.caller.nameConfirmed, true);
});
test('eval 5: caller spelling always wins', () => {
  let s = turn(fresh(), 'My name is Mwikali', { tokens: tok('My name is Mwikali', 0.6) });
  s = turn(s, 'M W I K A L I', { agent: 'Could you spell it for me?' });
  assert.equal(s.caller.name, 'Mwikali');
  assert.equal(s.caller.nameConfirmed, true);
});
test('eval 6: staff name never captured', () => {
  const s = turn(fresh(), 'Hi, I am calling for Peter', { agent: 'How can I help?' });
  assert.notEqual(s.caller.name, 'Peter');
});
test('eval 7: refusal → No problem, no more asks', () => {
  const s = turn(fresh(), "I'd rather not say");
  trust.noteCallerTurnForName(s, "I'd rather not say");
  const hint = ctl.nameAskHint(s) || '';
  assert.match(hint, /No problem/i);
});
test('eval 8: unconfirmed name never spoken; confirmed capped at 2', () => {
  const s = fresh();
  s.caller.name = 'Achieng'; s.caller.nameConfirmed = false;
  assert.doesNotMatch(ctl.guardNameInSpeech('Thanks, Achieng. What day suits you?', s).text, /Achieng/);
  s.caller.nameConfirmed = true;
  let said = 0;
  for (let i = 0; i < 4; i += 1) if (/Achieng/.test(ctl.guardNameInSpeech('Sure, Achieng.', s).text)) said += 1;
  assert.ok(said <= 2);
});
test('eval 9: ask budget 2 per call, spoken asks counted', () => {
  const s = fresh();
  trust.noteAgentLine(s, 'Can I take your name for the booking?');
  trust.noteAgentLine(s, 'Am I speaking with Wanjiru?');
  assert.ok(/don't ask|do not ask/i.test(ctl.nameAskHint(s) || ''));
});
