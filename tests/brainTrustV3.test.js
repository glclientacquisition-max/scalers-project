'use strict';
// BRAIN_TRUST_P1 v3 (Alvin, 13 Oct 23:22): one history policy, one name
// controller, one save readback. Built on staging row shapes and the three
// round-2 calls HD_bc1d27d6287f, HD_ebef585b989a, HD_c19044667595.
const test = require('node:test');
const assert = require('node:assert/strict');
const shape = require('./fixtures/staging-caller-card-shape.json');

process.env.BRAIN_TRUST_P1 = 'on';
process.env.BRAIN_CALL_FIXES_D199 = 'on';
process.env.CALLER_MEMORY_V2 = 'on';

const { buildCallerMemoryCard, bindCallerMemoryCard, returningFileFromCard, formatReturningCallerForPrompt } = require('../src/conversation/callerMemory');
const policy = require('../src/conversation/callerHistoryPolicy');
const trust = require('../src/conversation/trustP1');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');

const NOW = Date.parse('2026-10-13T20:00:00Z');
const d = (days) => new Date(NOW - days * 86400000).toISOString();

// Staging service_requests / appointments shapes (columns as on sgcdncjxauhsbunobmob).
const requests = [
  { id: 'r-open', item: '3-Bedroom House (Standard)', request_type: 'enquiry', status: 'open', when_text: 'this Friday morning', created_at: d(0), updated_at: d(0) },
  { id: 'r-done', item: 'Carpet cleaning quotation', request_type: 'callback', status: 'fulfilled', created_at: d(30), updated_at: d(30) },
  { id: 'r-old', item: 'Sofa cleaning', request_type: 'enquiry', status: 'open', created_at: d(90), updated_at: d(90) },
];
const appts = [
  { id: 'a-cxl', service_name: 'Carpet cleaning', status: 'cancelled', when_text: 'kesho at 10:00 AM', address_landmark: 'Westlands', created_at: d(14), window_start: d(13) },
];

function card(metadata = {}) {
  const c = buildCallerMemoryCard({
    contact: { ...shape.contact, metadata },
    openRequests: requests,
    recentAppointments: appts,
    now: new Date(NOW),
  });
  c.openTasks = shape.tasks;
  c.contactId = 'c-1';
  return c;
}
const ALVIN_SHARED = () => card(shape.contact.metadata); // 4 alternate names → shared line
const SINGLE = () => card({});

function state(extra = {}) {
  const s = createBrainState({});
  s.conversation = { ...(s.conversation || {}), turnCount: 3 };
  return Object.assign(s, extra);
}

// ------------------------------------------------------------ 1 policy
test('policy: shared phone (Alvin) never gets history, even after the name binds', () => {
  const raw = ALVIN_SHARED();
  assert.equal(raw.sharedLine, true);
  const bound = bindCallerMemoryCard(raw, 'Alvin');
  const view = policy.filterCard(bound, { now: NOW });
  assert.deepEqual(view.openRequests, []);
  assert.deepEqual(view.recentBookings, []);
  assert.equal(view.lastReason, null);
  assert.deepEqual(view.openTasks, []);
  const prompt = formatReturningCallerForPrompt(bound);
  assert.doesNotMatch(prompt, /quotation|Westlands|cancel|fulfil|House \(|Mattress/i);
  const ret = returningFileFromCard(bound);
  assert.deepEqual(ret.openRows || [], []);
  assert.deepEqual(policy.allowedTasks(bound, { caller: { nameConfirmed: true } }, NOW), []);
});

test('policy: single-person returning caller, mixed rows → only the open recent one, after the name only', () => {
  const raw = SINGLE();
  const before = policy.filterCard(raw, { now: NOW });
  assert.deepEqual(before.openRequests, []);
  assert.equal(before.hasOpenRows, true, 'masked, not empty');
  const boundCard = bindCallerMemoryCard(raw, 'Alvin');
  assert.equal(boundCard.fileRole, 'primary');
  const after = policy.filterCard(boundCard, { now: NOW });
  const jobs = (after.openRows || []).map((r) => r.job);
  assert.ok(jobs.includes('3-Bedroom House (Standard)'));
  assert.ok(!jobs.some((j) => /quotation|Sofa|Carpet/i.test(j)), jobs.join(','));
  assert.deepEqual(after.recentBookings, []);
  const prompt = formatReturningCallerForPrompt(boundCard);
  assert.match(prompt, /3-Bedroom House/);
  assert.doesNotMatch(prompt, /History:|quotation|Westlands|Sofa/);
  const tasks = policy.allowedTasks({ ...raw, sharedLine: false }, { caller: { nameConfirmed: true } }, Date.parse('2026-10-13T20:00:00Z'));
  assert.ok(tasks.every((t) => !['fulfilled', 'cancelled'].includes(t.status)));
});

test('policy: flag off is the identity (D199/main unchanged)', () => {
  process.env.BRAIN_TRUST_P1 = 'off';
  try {
    const raw = SINGLE();
    assert.equal(policy.filterCard(raw), raw);
  } finally { process.env.BRAIN_TRUST_P1 = 'on'; }
});

// ---------------------------------------------- HD_bc1d27d6287f mouth guard
test('HD_bc1d27d6287f: the closed-row read is never spoken', () => {
  const raw = ALVIN_SHARED();
  const st = state({ caller: { name: 'Alvin', nameConfirmed: true } });
  const out = trust.shapeSpeech(
    'Your previous inquiry was a callback for a carpet cleaning quotation, which was fulfilled, and a past carpet cleaning request in Westlands that was cancelled. How can I help you today?',
    { state: st, profile: { callerMemory: raw }, blockedTerms: policy.blockedTerms(raw, st), language: 'en' }
  ).text;
  assert.doesNotMatch(out, /quotation|fulfilled|cancel|Westlands/i);
  assert.match(out, /How can I help you today\?$/);
  // a plain price answer that names the same service is untouched
  const price = trust.shapeSpeech('Carpet cleaning starts from KSh 2,200 per square meter.', { state: state(), blockedTerms: policy.blockedTerms(raw, st) }).text;
  assert.match(price, /KSh 2,200/);
});

// ---------------------------------------------- HD_c19044667595 name loop
test('HD_c19044667595: one controller — pending ask binds "Alvin.", no second ask, no repeated line', () => {
  const raw = ALVIN_SHARED();
  const profile = { callerMemory: raw };
  let st = createBrainState(profile);
  st = observeCallerTurn(st, { text: 'I wanted to let you discuss about my previous booking.', profile, lastAgentText: 'I am doing well, thank you. How can I help you today?' });
  // The model asks once (D199 file-name ask) — counted by the mouth.
  trust.shapeSpeech('Before we check on that, am I speaking with Alvin?', { state: st, language: 'en' });
  assert.ok(trust.pendingNameAsk(st));
  // "I don't have to discuss about my previous booking." → remember-ask must NOT ask again.
  st = observeCallerTurn(st, { text: "I just speak with you like a minute ago.", profile, lastAgentText: 'Before we check on that, am I speaking with Alvin?' });
  const plan = trust.planTrustTurn({ text: "I don't have to discuss about my previous booking.", state: st, card: raw, tasks: [] });
  assert.ok(!plan || !/name/i.test(plan.line || ''), JSON.stringify(plan));
  // A second model ask is the 2nd (cap); a third is dropped.
  st.conversation.turnCount += 1;
  trust.shapeSpeech('May I have your name?', { state: st });
  st.conversation.turnCount += 1;
  assert.equal(trust.shapeSpeech('May I have your name?', { state: st }).text, '');
  // "Alvin." binds through the pending ask.
  st = observeCallerTurn(st, { text: 'Alvin.', profile, lastAgentText: 'May I have your name?' });
  assert.equal(st.caller.nameConfirmed, true);
  assert.equal(st.caller.name, 'Alvin');
  assert.equal(trust.pendingNameAsk(st), null);
  // Repeated replacement line within one turn is said once.
  const dup = trust.shapeSpeech('I need to confirm who I am speaking with. I need to confirm who I am speaking with.', { state: st }).text;
  assert.equal(dup, 'I need to confirm who I am speaking with.');
  // Shared line: still no history after the bind.
  assert.deepEqual(policy.allowedTasks(raw, st, NOW), []);
});

test('name controller: refusal stops asks; Swahili answer binds', () => {
  const profile = { callerMemory: null };
  let st = createBrainState(profile);
  trust.shapeSpeech('Naomba jina lako?', { state: st, language: 'sw' });
  st = observeCallerTurn(st, { text: 'Jina langu ni Wanjiru.', profile, lastAgentText: 'Naomba jina lako?' });
  assert.equal(st.caller.name, 'Wanjiru');
  const st2 = createBrainState(profile);
  trust.shapeSpeech('May I have your name?', { state: st2 });
  trust.planTrustTurn({ text: "I'd rather not give my name", state: st2 });
  st2.conversation.turnCount = (st2.conversation.turnCount || 0) + 1;
  assert.equal(trust.shapeSpeech('May I have your name?', { state: st2 }).text, '');
});

// -------------------------------------------- HD_ebef585b989a save pipeline
test('HD_ebef585b989a: booking waits for its time; unclear place is repaired; duplicate reads "already saved"', () => {
  const st = state({ goal: { primary: 'make_booking_request', missingSlots: [] } });
  assert.equal(trust.saveMissingSlot({ type: 'enquiry', item: '3-Bedroom House (Standard)', notes: 'Kitengela' }, st), 'when_text');
  assert.equal(trust.saveMissingSlot({ type: 'enquiry', item: '3-Bedroom House (Standard)', whenText: 'this Friday morning' }, st), '');
  assert.equal(trust.saveMissingSlot({ type: 'callback', item: 'x' }, st), '');
  const p = trust.planTrustTurn({ text: 'Hamil. Tone.', state: st, lastAgentText: 'Where should we come in Kitengela?' });
  assert.equal(p.kind, 'place_repair');
  assert.equal(trust.planTrustTurn({ text: 'Hamil. Tone.', state: st, lastAgentText: 'Where should we come in Kitengela?' }), null, 'once only');
  assert.equal(trust.unclearPlaceAnswer('Hamilton Apartment. Hamilton Apartment is the name.', 'Where should we come in Kitengela?'), false);
  const r = { action: 'create_service_request', status: 'succeeded', id: 'x', value: { item: '3-Bedroom House (Standard)' } };
  const r2 = { ...r, id: 'y' };
  assert.equal(trust.receiptKey(r), trust.receiptKey(r2));
  assert.equal(trust.alreadySavedLine('en'), "That's already saved.");
  assert.equal(trust.alreadySavedLine('sw'), 'Hiyo tayari imehifadhiwa.');
});

test('guard-emptied reply is not a false "say that again"', () => {
  const { planEmptyGeminiSpeech } = require('../src/conversation/dynamicSpeech');
  const st = { conversation: { turnCount: 4 }, caller: { name: 'Alvin', nameConfirmed: true } };
  trust.shapeSpeech('Am I speaking with Alvin?', { state: st });
  const p = planEmptyGeminiSpeech({ brainState: st, language: 'en', userText: 'my booking' });
  assert.equal(p.kind, 'guard_continue');
  st.conversation.turnCount = 5;
  assert.equal(planEmptyGeminiSpeech({ brainState: st, language: 'en', userText: 'hmm' }).kind, 'hear_again');
});

test('HD_9904b41a8ba9: fillers and non-names never bind (EN + SW)', () => {
  const q = require('../src/conversation/callerNameQuality');
  for (const x of ['Mmh.', 'Eeh.', 'h.', 'Sawa.', 'Ndio.', 'Ndiyo', 'Yes.', 'Pardon?', 'Hello.', 'Hmm', 'Mhm', 'Aah', 'Uhm', 'Asante', 'Habari', 'Okay okay']) {
    assert.equal(trust.nameFromAnswer(x), '', x);
    assert.equal(q.isJunkCallerName(x.replace(/[.?]$/, '')), true, x);
  }
  for (const [x, want] of [['Alvin.', 'Alvin'], ['Jina langu ni Wanjiru', 'Wanjiru'], ['Ian', 'Ian'], ['Eve', 'Eve'], ['Mwangi Kamau', 'Mwangi Kamau']]) {
    assert.equal(trust.nameFromAnswer(x), want, x);
  }
  // The real turn: "kwa jina gani?" then "Mmh." leaves the name unbound.
  const st = createBrainState({});
  trust.noteNameAsk(st, { kind: 'open' });
  const next = observeCallerTurn(st, { text: 'Mmh.', language: 'sw' });
  assert.notEqual(String(next?.caller?.name || st.caller?.name || '').toLowerCase(), 'mmh');
  assert.notEqual((next || st).caller?.nameConfirmed, true);
});

test('HD_9904b41a8ba9: an empty handover reply is not replaced by "Which service do you need?"', () => {
  const { shapeCatalogueMouth } = require('../src/conversation/catalogueMouth');
  const out = shapeCatalogueMouth('', { state: { caller: { nameJustConfirmed: true }, conversation: {} }, callerText: 'Connect, like, talk to your boss?', profile: {}, language: 'en' });
  assert.equal(out, '');
});

test('HD_9904b41a8ba9: "Mnafika wapi Juja?" is answered as Juja, not "wapi Juja"', () => {
  const { coverageAskSpeech } = require('../src/conversation/visitLocation');
  const fx = require('./fixtures/voice-calls/HD_9904b41a8ba9.json');
  const line = coverageAskSpeech('Mnafika wapi Juja?', { vertical: 'home_services', servicesCatalog: fx.servicesCatalog, businessPolicies: fx.businessPolicies }, 'en');
  assert.match(line, /cover Juja\./);
  assert.doesNotMatch(line, /wapi/i);
});

// ---- Round 3b (HD_35b75499d483 + scalability audit) ----
const placeAsk = require('../src/conversation/placeAsk');
const fxDD = require('./fixtures/voice-calls/HD_9904b41a8ba9.json');
const ddProfile = { vertical: 'home_services', servicesCatalog: fxDD.servicesCatalog, businessPolicies: fxDD.businessPolicies };
const otherProfile = { vertical: 'home_services', servicesCatalog: fxDD.servicesCatalog, businessPolicies: { coverage_areas: ['county:mombasa', 'place:nyali', 'place:bamburi'] } };
const { coverageAskSpeech } = require('../src/conversation/visitLocation');

test('place: possessive lead-ins are stripped (any place)', () => {
  assert.equal(placeAsk.coverageAskPlaceGeneric('Can you come to my place in Ruaka?'), 'Ruaka');
  assert.equal(placeAsk.coverageAskPlaceGeneric('Do you serve my office at Westlands?'), 'Westlands');
  assert.equal(placeAsk.coverageAskPlaceGeneric('Mnaweza kuja nyumbani kwangu Syokimau?'), 'Syokimau');
  assert.match(coverageAskSpeech('Can you come to my place in Ruaka?', ddProfile, 'en', {}), /cover Ruaka\./);
});

test('place: Swahili verb forms, leading "Je," and multi-word places', () => {
  assert.equal(placeAsk.coverageAskPlaceGeneric('Je, mnafika Juja?'), 'Juja');
  assert.equal(placeAsk.coverageAskPlaceGeneric('Mtafika Kitengela?'), 'Kitengela');
  assert.equal(placeAsk.coverageAskPlaceGeneric('Mnaja hadi Ongata Rongai?'), 'Ongata Rongai');
  assert.equal(placeAsk.coverageAskPlaceGeneric('Do you guys come to South B?'), 'South B');
});

test('place: "where do you work" gives the tenant\'s own area list', () => {
  assert.match(coverageAskSpeech('Mnafanyia kazi wapi?', ddProfile, 'en', {}), /^We cover Nairobi, .*Syokimau\./);
  assert.match(coverageAskSpeech('Where do you work?', otherProfile, 'en', {}), /^We cover Mombasa, Nyali and Bamburi\./);
  assert.equal(placeAsk.asksAreaList('Mko wapi?'), false, 'where are you located is the business location, not coverage');
});

test('place: coverage follows each tenant (no hardcoded areas)', () => {
  assert.match(coverageAskSpeech('Mnafika Syokimau?', ddProfile, 'en', {}), /cover Syokimau/);
  assert.match(coverageAskSpeech('Mnafika Syokimau?', otherProfile, 'en', {}), /outside/);
  assert.match(coverageAskSpeech('Do you serve Nyali?', otherProfile, 'en', {}), /cover Nyali/);
});

test('place: a misheard place is confirmed once, then answered on yes', () => {
  const st = {};
  assert.equal(coverageAskSpeech('Do you come to Syokimao?', ddProfile, 'en', st), 'Did you mean Syokimau?');
  assert.match(coverageAskSpeech('Yes.', ddProfile, 'en', st), /cover Syokimau/);
  assert.equal(coverageAskSpeech('Mnafika Syokimao?', ddProfile, 'sw', {}), 'Ulisema Syokimau?');
  assert.match(coverageAskSpeech('What about Kampala?', ddProfile, 'en', {}), /only cover Kenya/);
});

test('name: trusted after "my name is"/"naitwa"; courtesy word rejected only as a bare answer', () => {
  assert.equal(trust.nameFromAnswer('My name is Welcome'), 'Welcome');
  assert.equal(trust.nameFromAnswer('Naitwa Mimi'), 'Mimi');
  assert.equal(trust.nameFromAnswer('Welcome.'), '');
  assert.equal(trust.nameFromAnswer('Sure.'), '');
  assert.equal(trust.nameFromAnswer('My name is Mmh'), '');
  assert.equal(trust.nameFromAnswer('Neema.'), 'Neema');
});

test('echo: greeting echo is not caller speech; greeting phrase is never a location', () => {
  const { createEchoGate } = require('../src/speech/echoGate');
  const g = createEchoGate();
  g.remember("Good morning, Done and Dusted, this is Shy. We're closed now. Karibu tena. Tukusaidie vipi.", 1000);
  g.remember('Hello, can you hear me?', 5000);
  assert.equal(g.isEcho('Karibu tena.', { at: 6000, speaking: true }), true);
  g.remember('Would you like tomorrow or Friday morning?', 6500);
  assert.equal(g.isEcho('Friday morning.', { at: 7000, speaking: true }), false, 'an answer to the latest line is real speech');
  assert.equal(g.isEcho('Tomorrow.', { at: 7000, speaking: true }), false);
  assert.equal(g.isEcho('Karibu tena.', { at: 20000 }), false, 'outside the window');
  assert.equal(g.isEcho('I need a carpet clean in Juja tomorrow', { at: 6000, speaking: true }), false);
  assert.equal(placeAsk.isGreetingPhrase('Karibu tena'), true);
  assert.equal(placeAsk.coverageAskPlaceGeneric('Do you cover Karibu tena?'), '');
  let s = createBrainState({});
  s.entities.location = { value: 'Karibu tena', source: 'caller_explicit' };
  s = observeCallerTurn(s, { text: 'Yeah.', lastAgentText: 'Hello, can you hear me?' });
  assert.equal(s.entities.location, undefined);
});

test('HD_35b75499d483: "Yeah, yeah." confirms the file name; a guard-emptied reply is not "say that again"', () => {
  const { buildCallerMemoryCard } = require('../src/conversation/callerMemory');
  const card = buildCallerMemoryCard({ contact: { phone: '+254700000009', name: 'Chris', metadata: {} }, openRequests: [{ request_type: 'request', item: 'carpet cleaning', when_text: 'tomorrow' }] });
  let s = createBrainState({ callerMemory: card });
  s.caller.fileNameAsked = 'Chris';
  s = observeCallerTurn(s, { text: 'Yeah, yeah.', lastAgentText: 'Am I speaking with Chris?' });
  assert.equal(s.caller.nameConfirmed, true);
  const { polishSpokenDetail, planEmptyGeminiSpeech } = require('../src/conversation/dynamicSpeech');
  const st = createBrainState({});
  st.conversation.turnCount = 2;
  st.caller.fileNameAsked = 'Chris';
  st.caller.fileNameAskSpoken = true;
  const out = polishSpokenDetail('Am I speaking with Chris?', { state: st, profile: {}, callerText: 'Yeah, yeah.' });
  assert.equal(out.text, '');
  assert.equal(planEmptyGeminiSpeech({ brainState: st, language: 'en', userText: 'Yeah, yeah.' }).kind, 'guard_continue');
});
