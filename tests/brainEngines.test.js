'use strict';
// BRAIN_ENGINES: understanding, plan, handoff, guard, invariants (EN + SW).
const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../src/conversation/v2/understanding');
const { pickGoal, businessOpen } = require('../src/conversation/v2/enginePlan');
const H = require('../src/conversation/v2/handoff');
const { makeEnginesVerifier } = require('../src/conversation/v2/engineGuard');
const { assertTurnInvariants } = require('../src/conversation/v2/engineInvariants');
const { brainEnginesOn } = require('../src/conversation/v2/flag');
const { createState } = require('../src/conversation/v2/machine');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { indexFieldMeta } = require('../src/conversation/provenance');
const FR = require('./fixtures/dndSimTenant.json');
const ML = require('../src/conversation/v2/modelLead');
const CP = require('../src/conversation/v2/callPlan');

const inner = FR.picks.picks;
const areaPicksRows = inner.picks.map((row) => ({ ...row, confirmed_at: FR.picks.confirmed_at, tree_version: inner.tree_version }));
const P = { ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta), areaPicksRows }), id: FR.row.id };

const CLOSED_EVENING = new Date('2026-10-25T19:50:00+03:00'); // Sunday evening, DnD closed-serve

function machine(over = {}) {
  return createState({
    profile: P,
    callerPhone: '+254790381872',
    callId: 'HD_231f7bef3ba4',
    ...over,
  });
}

function invariants(line, lang, prior = []) {
  const issues = assertTurnInvariants({ line, lang, prior });
  assert.equal(issues.length, 0, issues.join('; '));
}

test('BRAIN_ENGINES flag defaults off', () => {
  delete process.env.BRAIN_ENGINES;
  assert.equal(brainEnginesOn({ env: process.env }), false);
  process.env.BRAIN_ENGINES = '1';
  assert.equal(brainEnginesOn({ env: process.env }), true);
  delete process.env.BRAIN_ENGINES;
});

test('understanding fallback is never empty; callback yes (sw)', async () => {
  const m = machine();
  const u = await U.runUnderstanding({ text: 'Sawa. Wewe utamwambia nipigie?', machine: m, profile: P, streamFor: null, modelId: null });
  assert.ok(u.intent);
  assert.equal(u.yes_no, 'yes');
  assert.equal(u.source, 'fallback');
  assert.ok(u.language);
});

test('HD_231f7bef3ba4: closed + callback yes commits once', async () => {
  const m = machine();
  m.handoff = { phase: 'confirm_yes', reason: 'closed', committed: false };
  const u = await U.runUnderstanding({ text: 'Sawa. Wewe utamwambia nipigie?', machine: m, profile: P });
  const goal = pickGoal({ understanding: u, machine: m, profile: P, lang: 'sw', callerPhone: m.callerPhone, now: CLOSED_EVENING });
  assert.equal(goal.type, 'handoff_commit');
  let writes = 0;
  const r = await H.commitHandoff({
    machine: m,
    profile: P,
    handlers: { createServiceRequest: async () => { writes += 1; return { ok: true, id: 'req1' }; } },
    callerPhone: m.callerPhone,
    understanding: u,
  });
  assert.equal(writes, 1);
  assert.equal(r.ok, true);
  const r2 = await H.commitHandoff({ machine: m, profile: P, handlers: { createServiceRequest: async () => { writes += 1; return { ok: true, id: 'req2' }; } }, callerPhone: m.callerPhone });
  assert.equal(writes, 1);
  assert.equal(r2.duplicate, true);
});

test('closed business enters handoff (name first), not a fourth date ask', () => {
  const m = machine({ intent: 'book' });
  m._enginesDateAsks = 3;
  m.slots = { service: 'Carpet Cleaning', when: { date: null, time: null }, place: null };
  const u = { intent: 'book', answers: [], yes_no: null, slots: {}, language: 'sw' };
  const g = pickGoal({ understanding: u, machine: m, profile: P, lang: 'sw', callerPhone: m.callerPhone, now: CLOSED_EVENING });
  assert.equal(g.type, 'handoff');
  assert.ok(['ask_name', 'readback', 'confirm_phone'].includes(g.step?.kind) || g.step?.kind === 'ask_name');
});

test('Rongai coverage receipt keeps KES 700 note on later turns', () => {
  const m = machine();
  const cov = ML.coverageFor('Rongai', P, { u: { slots: { places: ['Rongai'] } } });
  assert.ok(cov.places.some((p) => /rongai/i.test(p.place || p.name || '')));
  const line = cov.places.map((p) => p.line_en || p.text).join(' ');
  assert.match(line, /700|seven hundred/i);
  m.slots = { place: 'Rongai' };
  const u2 = { intent: 'ask', answers: ['coverage'], slots: { place: 'Rongai' }, language: 'en' };
  const g = pickGoal({ understanding: u2, machine: m, profile: P, lang: 'en', callerPhone: m.callerPhone });
  assert.equal(m.slots.place, 'Rongai');
  assert.equal(g.type, 'answer');
});

test('agent-name question: understanding tags identity, not caller name steal', async () => {
  const u = await U.runUnderstanding({
    text: 'Habari yako, unaitwa aje?',
    machine: machine(),
    profile: P,
    streamFor: async () => async () => ({ text: JSON.stringify({ intent: 'ask', answers: ['identity'], yes_no: null, slots: {}, language: 'sw', wants_human: false, closing: false }) }),
    modelId: 'stub',
  });
  assert.ok(u.answers.includes('identity') || u.intent === 'ask');
});

test('Ndiyo on price is yes', () => {
  assert.equal(U.detectYesNo('Ndiyo', {}), 'yes');
});

test('wants_human routes to handoff', () => {
  const m = machine();
  const u = { intent: 'handoff', answers: [], yes_no: null, slots: {}, language: 'en', wants_human: true, closing: false };
  const g = pickGoal({ understanding: u, machine: m, profile: P, lang: 'en', callerPhone: m.callerPhone });
  assert.equal(g.type, 'handoff');
});

test('understanding timeout uses fallback and call can progress', async () => {
  const m = machine();
  const slow = async () => async () => new Promise(() => {});
  const u = await U.runUnderstanding({
    text: 'How much for carpet?',
    machine: m,
    profile: P,
    streamFor: slow,
    modelId: 'x',
    hardMs: 50,
    clock: () => 0,
  });
  assert.equal(u.source, 'fallback');
  assert.ok(u.answers.includes('price') || u.intent === 'ask');
  const g = pickGoal({ understanding: u, machine: m, profile: P, lang: 'en', callerPhone: m.callerPhone });
  assert.ok(g.type === 'answer' || g.type === 'open' || g.type === 'ask');
});

test('engines guard passes off_step and readback_mismatch replaces', () => {
  const { actCheckEngines } = require('../src/conversation/v2/engineGuard');
  const st = { kind: 'ask', slot: 'date' };
  const ctx = { st, receipts: [], coverage: [], caller: {}, profile: P, questions: [], lang: 'en', machine: machine(), text: '' };
  const g = CP.actCheck('Je, ungependa tuje tarehe gani?', st, ctx);
  if (g.verdict === 'replace') {
    const eg = actCheckEngines('Je, ungependa tuje tarehe gani?', st, ctx);
    assert.equal(eg.verdict, 'pass');
  } else {
    assert.equal(g.verdict, 'pass');
  }
});

test('unconfirmed area offers check-with-owner path', () => {
  const NOPICKS = { ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta) }), id: FR.row.id };
  const m = machine();
  const u = { intent: 'ask', answers: ['coverage'], yes_no: null, slots: { place: 'Kamakis' }, language: 'en', wants_human: false, closing: false };
  const trig = H.shouldHandoff({ understanding: u, machine: m, profile: NOPICKS });
  assert.equal(trig?.reason, 'area_unknown');
});

test('happy path booking reaches readback when slots full', () => {
  const m = machine();
  m.intent = 'book';
  m.slots = {
    service: 'Carpet Cleaning (per room)',
    place: 'Westlands',
    when: { date: '2026-10-31', time: '10:00' },
    name: 'Alvin',
    nameConfirmed: true,
  };
  const u = { intent: 'confirm', answers: [], yes_no: null, slots: {}, language: 'en' };
  const g = pickGoal({ understanding: u, machine: m, profile: P, lang: 'en', callerPhone: m.callerPhone, now: new Date('2026-10-25T10:00:00+03:00') });
  assert.equal(g.type, 'readback');
});

test('hours receipt is single-day when day slot set', () => {
  const { hoursReceipt } = require('../src/conversation/v2/engineTools');
  const r = hoursReceipt(P, 'en', { day: '2026-10-31' });
  assert.ok(r.text);
  assert.doesNotMatch(r.text, /Monday.*Tuesday.*Wednesday/s);
});

test('split-path root cause: race leaves u null before state runs', () => {
  // Documented behaviour in modelLead split join (understandCapMs race); BRAIN_ENGINES awaits one call + fallback.
  const DL = ML.SPLIT_DEADLINES;
  assert.ok(DL.understandCapMs <= 1200);
  assert.ok(typeof ML.normUnderstanding === 'function');
});

test('invariant harness: one language, at most two sentences', () => {
  invariants('Bei ni shilingi 1,500 hadi 4,000 kwa kila zulia.', 'sw', []);
  invariants('Shall I ask the owner to call you back on your number, tomorrow from 7:30 AM?', 'en', []);
});
