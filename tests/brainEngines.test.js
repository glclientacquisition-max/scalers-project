'use strict';
// BRAIN_ENGINES: understanding, plan, handoff, guard, invariants, E2E HD replay (EN + SW).
const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');
const U = require('../src/conversation/v2/understanding');
const { pickGoal, businessOpen } = require('../src/conversation/v2/enginePlan');
const H = require('../src/conversation/v2/handoff');
const { notifyHandoffOwner } = require('../src/conversation/v2/handoffNotify');
const { runBrainEnginesTurn } = require('../src/conversation/v2/brainEngines');
const { assertTurnInvariants, capSpokenLine } = require('../src/conversation/v2/engineInvariants');
const { brainEnginesOn } = require('../src/conversation/v2/flag');
const { createState } = require('../src/conversation/v2/machine');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { indexFieldMeta } = require('../src/conversation/provenance');
const FR = require('./fixtures/dndSimTenant.json');
const ML = require('../src/conversation/v2/modelLead');
const CP = require('../src/conversation/v2/callPlan');
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const { runTools } = require('../src/conversation/v2/engineTools');

const inner = FR.picks.picks;
const areaPicksRows = inner.picks.map((row) => ({ ...row, confirmed_at: FR.picks.confirmed_at, tree_version: inner.tree_version }));
const P = { ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta), areaPicksRows }), id: FR.row.id };
P.teamDirectory = [{ name: 'Owner', role: 'owner', phone: '+254711000001', receives_escalation: true }];

const CLOSED_EVENING = new Date('2026-10-25T19:50:00+03:00');

function machine(over = {}) {
  return createState({
    profile: P,
    callerPhone: '+254790381872',
    callId: 'HD_231f7bef3ba4',
    ...over,
  });
}

function invariants(line, lang, prior = [], allowReadback = false) {
  const issues = assertTurnInvariants({ line, lang, prior, allowReadback });
  assert.equal(issues.length, 0, issues.join('; '));
}

function stubStream(stubs) {
  let i = 0;
  return () => async ({ request }) => {
    const s = stubs[i] || stubs[stubs.length - 1];
    if (request.generationConfig?.responseSchema) {
      i += 1;
      return { text: JSON.stringify(s) };
    }
    return { text: JSON.stringify({ reply: '[PROMPT-PLACEHOLDER] Sim.' }) };
  };
}

async function enginesTurn(m, text, understanding, { applyTools, dispatch, now = CLOSED_EVENING } = {}) {
  const stubs = [understanding];
  return runBrainEnginesTurn({
    text,
    profile: P,
    machine: m,
    streamFor: stubStream(stubs),
    modelId: 'stub',
    langLock: understanding.language || 'sw',
    applyTools,
    opts: { now, dispatch, ctx: {} },
  });
}

test('BRAIN_ENGINES flag defaults off', () => {
  delete process.env.BRAIN_ENGINES;
  assert.equal(brainEnginesOn({ env: process.env }), false);
  process.env.BRAIN_ENGINES = '1';
  assert.equal(brainEnginesOn({ env: process.env }), true);
  delete process.env.BRAIN_ENGINES;
});

test('notifyHandoffOwner is idempotent per call', async () => {
  const m = machine();
  m.handoff = { phase: 'done', committed: true };
  const calls = [];
  const dispatch = async (args) => { calls.push(args); return [{ channel: 'sms', role: 'teammate' }]; };
  const a = await notifyHandoffOwner({ machine: m, profile: P, reason: 'closed', name: 'Jane', phone: m.callerPhone, dispatch });
  const b = await notifyHandoffOwner({ machine: m, profile: P, reason: 'closed', name: 'Jane', phone: m.callerPhone, dispatch });
  assert.equal(calls.length, 1);
  assert.equal(a.ok, true);
  assert.equal(b.duplicate, true);
});

test('HD_231f7bef3ba4 full callback path: name, confirm, one write, notify, plain line', async () => {
  const m = machine();
  const writes = [];
  const notifies = [];
  const applyTools = async (payload) => {
    if (payload.serviceRequest) writes.push(payload.serviceRequest);
    return { results: [{ action: 'create_service_request', ok: true, status: 'succeeded', id: 'req-hd231' }] };
  };
  const dispatch = async (args) => {
    notifies.push(args);
    return [{ channel: 'sms', role: 'teammate' }];
  };

  const r1 = await enginesTurn(m, 'when are you free, you guys? I am flexible.', {
    intent: 'ask', answers: ['hours'], yes_no: null, slots: {}, language: 'en', wants_human: false, closing: false,
  }, { applyTools, dispatch });
  assert.match(r1.line, /Today we are open|Leo tuko wazi/i);
  invariants(r1.line, r1.lang, []);
  assert.equal(m.eng.offered, 'callback');

  const r2 = await enginesTurn(m, 'Please call me back.', {
    intent: 'callback', answers: [], yes_no: null, slots: {}, language: 'en', wants_human: false, closing: false,
  }, { applyTools, dispatch });
  assert.match(r2.line, /May I have your name|Naomba jina/i);
  invariants(r2.line, r2.lang, [r1.line]);

  const r3 = await enginesTurn(m, 'Alvin.', {
    intent: 'give_info', answers: [], yes_no: null, slots: { name: 'Alvin' }, language: 'en', wants_human: false, closing: false,
  }, { applyTools, dispatch });
  assert.match(r3.line, /Shall I ask the owner|Nimwombe mwenye/i);
  invariants(r3.line, r3.lang, [r1.line, r2.line], true);
  assert.equal(m.slots.nameCandidate, 'Alvin');
  assert.notEqual(m.slots.nameConfirmed, true, 'the name is confirmed by the read-back yes, not by hearing it');

  const r4 = await enginesTurn(m, 'Sawa. Wewe utamwambia nipigie?', {
    intent: 'confirm', answers: [], yes_no: 'yes', slots: {}, language: 'sw', wants_human: false, closing: false,
  }, { applyTools, dispatch });
  assert.match(r4.line, /nimemwomba mwenye biashara akupigie|asked the owner to call you/i);
  assert.equal(writes.length, 1);
  assert.equal(notifies.length, 1);
  assert.equal(notifies[0].channels, P.notifyChannels);
  assert.equal(m.handoff.committed, true);
  assert.equal(m.slots.name, 'Alvin');
  assert.equal(m.slots.nameConfirmed, true);
  assert.equal(m.handoff.notifySent, true);
});

test('coverage defers price until asked (one sentence)', () => {
  const m = machine();
  const u = { intent: 'ask', answers: ['coverage', 'price'], slots: { place: 'Rongai' }, language: 'en' };
  const { receipts } = runTools({ understanding: u, machine: m, profile: P, lang: 'en', text: 'Rongai?' });
  const cov = receipts.filter((r) => r.tool === 'coverage');
  const prices = receipts.filter((r) => r.tool === 'prices');
  assert.equal(cov.length, 1);
  assert.equal(prices.length, 0);
  assert.ok(cov[0].text);
  invariants(cov[0].text, 'en', []);
});

test('capSpokenLine trims to two sentences', () => {
  const long = 'One. Two. Three.';
  assert.equal(capSpokenLine(long), 'One. Two.');
});

test('closed business (message-only after hours) turns a booking into the callback flow', () => {
  const m = machine({ intent: 'book' });
  m.slots = { service: 'Carpet Cleaning', when: { date: null, time: null }, place: null };
  const u = { intent: 'book', answers: [], yes_no: null, slots: {}, language: 'sw' };
  const g = pickGoal({ understanding: u, machine: m, profile: { ...P, afterHoursMode: 'message' }, lang: 'sw', callerPhone: m.callerPhone, now: CLOSED_EVENING });
  assert.equal(g.type, 'ask');
  assert.equal(g.slot, 'name');
  assert.equal(g.why, 'callback');
});

test('split race uses fallback understanding (not null)', () => {
  const fb = U.fromNlu('when are you free?', P, machine(), CLOSED_EVENING);
  const lead = ML.normUnderstanding(U.toLeadShape(fb));
  assert.ok(lead);
  assert.ok(lead.questions.some((q) => q.type === 'hours') || lead.intents.includes('ask'));
});

test('runBrainEnginesTurn does not call legacy mouth, weigher, shadow, owed, or callPlan replace', async () => {
  const OW = require('../src/conversation/v2/owed');
  const HW = require('../src/conversation/v2/hybridWeigher');
  const CP = require('../src/conversation/v2/callPlan');
  const AM = require('../src/conversation/v2/audibleMouth');
  const MS = require('../src/conversation/v2/modelShadow');
  let ow = 0; let hw = 0; let actReplace = 0; let mouth = 0; let shadow = 0;
  const owRestore = mock.method(OW, 'render', () => { ow += 1; return 'owed'; });
  const hwRestore = mock.method(HW, 'weighHybridTurn', () => { hw += 1; return { escalate: false }; });
  const mouthRestore = mock.method(AM, 'speakSafeLine', () => { mouth += 1; return null; });
  const shadowRestore = mock.method(MS, 'createModelShadow', () => { shadow += 1; return null; });
  const acRestore = mock.method(CP, 'actCheck', (...args) => {
    const r = acRestore.mock.original(...args);
    if (r.verdict === 'replace') actReplace += 1;
    return r;
  });

  const m = machine();
  const r = await runBrainEnginesTurn({
    text: 'What are your hours?',
    profile: P,
    machine: m,
    streamFor: stubStream([{ intent: 'ask', answers: ['hours'], yes_no: null, slots: {}, language: 'en', wants_human: false, closing: false }]),
    modelId: 'stub',
    opts: { now: () => CLOSED_EVENING },
  });
  assert.equal(r.path, 'brain_engines');
  assert.equal(ow, 0);
  assert.equal(hw, 0);
  assert.equal(mouth, 0);
  assert.equal(shadow, 0);
  assert.equal(actReplace, 0);
  owRestore.mock.restore();
  hwRestore.mock.restore();
  mouthRestore.mock.restore();
  shadowRestore.mock.restore();
  acRestore.mock.restore();
});

test('liveTurn routes to brain_engines when flag on', async () => {
  const ENV = {
    BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on',
    BRAIN_MODEL_LEAD: 'on', BRAIN_ENGINES: '1',
  };
  const stream = stubStream([{ intent: 'ask', answers: ['hours'], yes_no: null, slots: {}, language: 'en', wants_human: false, closing: false }]);
  const live = createBrainV2Live({
    env: ENV,
    applyTools: async () => ({ results: [] }),
    modelLeadStreamFor: stream,
    v1DraftStreamFor: stream,
    prewarm: false,
    now: () => CLOSED_EVENING,
    log: () => {},
  });
  const r = await live.run({ text: 'What are your hours?', profile: P, langLock: 'en' });
  assert.equal(r.path, 'brain_engines');
});

test('split race logs when understanding missing after cap (flag off, no NLU inject)', async () => {
  const ML = require('../src/conversation/v2/modelLead');
  const logs = [];
  const slowStream = () => async ({ request }) => {
    if (request.generationConfig?.responseSchema) {
      await new Promise((r) => setTimeout(r, 500));
      return { text: JSON.stringify({ intent: 'ask', answers: ['hours'], yes_no: null, slots: {}, language: 'en', wants_human: false, closing: false }) };
    }
    return { text: JSON.stringify({ reply: '[PROMPT-PLACEHOLDER] Today we are open.' }) };
  };
  const ENV = {
    BRAIN_V2: '1', BRAIN_V2_MODE: 'live', BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on',
    BRAIN_MODEL_LEAD: 'on', BRAIN_MODEL_LEAD_SPLIT: 'on', BRAIN_ENGINES: 'off',
  };
  const live = createBrainV2Live({
    env: ENV,
    applyTools: async () => ({ results: [] }),
    modelLeadStreamFor: slowStream,
    v1DraftStreamFor: slowStream,
    modelLeadDeadlines: { ...ML.SPLIT_DEADLINES, understandCapMs: 40 },
    prewarm: false,
    now: () => CLOSED_EVENING,
    log: (m) => logs.push(String(m)),
  });
  const r = await live.run({ text: 'when are you free?', profile: P, langLock: 'en' });
  assert.ok(r && r.path);
  assert.ok(logs.some((l) => l.includes('understanding null after race')));
  assert.equal(live.getState().leadFallbackU, undefined);
});

test('invariant fails above two sentences', () => {
  const issues = assertTurnInvariants({ line: 'A. B. C.', lang: 'en', prior: [] });
  assert.ok(issues.some((x) => x.startsWith('more_than_two_sentences')));
});
