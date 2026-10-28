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

test('B2: the engines are the only turn runner: no flag module, no BRAIN_ENGINES switch', async () => {
  assert.throws(() => require('../src/conversation/v2/flag'), /Cannot find module/);
  assert.equal(require('../src/conversation/v2/brainEngines').on, undefined);
  // with every brain env unset (and BRAIN_ENGINES=off, ignored) a live turn still runs the engines
  const live = createBrainV2Live({ env: { BRAIN_ENGINES: 'off' }, prewarm: false, now: () => CLOSED_EVENING, log: () => {}, callerFile: { callerPhone: '+254790381872' } });
  const r = await live.run({ text: 'What time do you open?', profile: P, langLock: 'en' });
  assert.ok(r && String(r.line || '').trim(), 'never a null / empty turn');
  assert.equal(live.getState().engines, true);
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

// B2 rewrite of the model-lead split-race test (runModelLead is deleted): the engines' understanding is capped
// (BRAIN_ENGINES_UNDERSTAND_MS); a slow model past the cap never blocks the turn, rules understanding answers.
test('engines: understanding slower than its cap -> rules understanding answers, the turn is never empty', async () => {
  const slowStream = () => async ({ request, signal }) => {
    if (request.generationConfig?.responseSchema) {
      await new Promise((r, rej) => { const t = setTimeout(r, 500); signal?.addEventListener?.('abort', () => { clearTimeout(t); rej(new Error('aborted')); }); });
      return { text: JSON.stringify({ intent: 'ask', answers: ['hours'], yes_no: null, slots: {}, language: 'en', wants_human: false, closing: false }) };
    }
    return { text: JSON.stringify({ reply: '[PROMPT-PLACEHOLDER] Today we are open.' }) };
  };
  const traces = [];
  const live = createBrainV2Live({
    env: { BRAIN_ENGINES_UNDERSTAND_MS: '40' },
    applyTools: async () => ({ results: [] }),
    modelLeadStreamFor: slowStream,
    prewarm: false,
    now: () => CLOSED_EVENING,
    log: () => {},
    onModelStage: (st) => traces.push(st),
  });
  const r = await live.run({ text: 'when are you free?', profile: P, langLock: 'en' });
  assert.ok(r && String(r.line || '').trim());
  assert.match(String(r.path || ''), /^brain_engines/);
  const t = traces.find((x) => x.kind === 'brain_engines');
  assert.ok(t, 'one engines trace per turn');
  assert.notEqual(t.understanding?.source, 'model', 'the late model understanding is not used past the cap');
  assert.equal(live.getState().leadFallbackU, undefined);
});

test('invariant fails above two sentences', () => {
  const issues = assertTurnInvariants({ line: 'A. B. C.', lang: 'en', prior: [] });
  assert.ok(issues.some((x) => x.startsWith('more_than_two_sentences')));
});
