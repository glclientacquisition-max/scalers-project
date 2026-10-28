'use strict';
// B2 follow-up (#1010): an owner never loses a caller because the brain errored. A model, tool or turn error
// speaks the v2 repair line AND saves one service_requests row through the callback commit path (live handlers ->
// applyTools serviceRequest, type callback) with the caller's number and what is known; finishCall reports the typed
// outcome brain_error (saved) or write_failed (the save failed), and call.summary.ready carries it for Ops' alert.
// Once per call. EN + SW. Stand-in models only: GEMINI keys unset, no network, synthetic numbers.
const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.GEMINI_API_KEY; delete process.env.GOOGLE_API_KEY; delete process.env.BRAIN_SAFE_MODE;
process.env.CALL_SUMMARY_EVENT = 'on'; // summary receipts on the finish (the A4 event builder input)
const BE = require('../src/conversation/v2/brainEngines');
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const { runOwnedTurn, repairLine, createOwnedCalls } = require('../src/conversation/v2/ownsCall');
const { finishCall } = require('../src/conversation/v2/machine');
const CSE = require('../src/conversation/callSummaryEvent');
const { renderOwnerSummary } = require('../src/notifications/ownerSummaryText');
const FR = require('./fixtures/dndSimTenant.json');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { indexFieldMeta } = require('../src/conversation/provenance');
const DD0 = require('../evals/v2/fixtures/tenants/done_and_dusted.json');

const inner = FR.picks.picks;
const DND = { ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta), areaPicksRows: inner.picks.map((row) => ({ ...row, confirmed_at: FR.picks.confirmed_at, tree_version: inner.tree_version })) }), id: FR.row.id };
const DD = { ...DD0, id: DD0.tenantId };
const PHONE = '+254700000009'; // synthetic
const ACTION = { appointment: 'create_appointment', serviceRequest: 'create_service_request', escalate: 'escalate', saveCallerInfo: 'save_caller_info' };
const BOOKED = /\b(booked|nimeweka|imewekwa)\b/i;

function standIn(us) {
  let i = 0;
  return () => async ({ request }) => {
    if (request.generationConfig?.responseSchema?.properties?.intent) {
      const u = us[Math.min(i++, us.length - 1)];
      if (u) return { text: JSON.stringify({ answers: [], slots: {}, yes_no: null, wants_human: false, closing: false, ...u }) };
    }
    throw Object.assign(new Error('gemini http 503'), { code: 'http_503' });
  };
}

/** Fault injection: the engines turn throws on the listed turn numbers (1-based), like a model client blowing up mid-turn. */
function throwOnTurns(turns, err) {
  const real = BE.runBrainEnginesTurn;
  let n = 0;
  BE.runBrainEnginesTurn = async (...a) => { n += 1; if (turns.includes(n)) throw err(); return real(...a); };
  return () => { BE.runBrainEnginesTurn = real; };
}

function rig({ throwTool = null, failSave = false, us = [] } = {}) {
  const writes = []; const logs = []; const traced = [];
  const live = createBrainV2Live({
    env: {}, prewarm: false, log: (m) => logs.push(m), now: () => new Date('2026-10-14T05:00:00Z'),
    callSid: `HD_b2err_${Math.random().toString(36).slice(2)}`,
    callerFile: { callerPhone: PHONE, openRows: [] },
    modelLeadStreamFor: standIn(us),
    onBrainError: (rec) => traced.push(rec),
    applyTools: async (a) => {
      const k = Object.keys(a)[0];
      writes.push(a);
      if (throwTool === k) throw new Error(`${k} tool exploded`);
      if (failSave && k === 'serviceRequest') throw new Error('supabase insert failed');
      return { results: [{ action: ACTION[k] || k, status: 'succeeded', id: `row_${writes.length}` }] };
    },
  });
  const said = [];
  return {
    live, writes, logs, traced, said,
    async turn(text, profile, langLock = 'en') {
      const r = await runOwnedTurn(live, { text, profile, langLock }, { log: (m) => logs.push(m) });
      said.push(r.line);
      return r;
    },
    requests: () => writes.filter((w) => w.serviceRequest).map((w) => w.serviceRequest),
    fin: (profile = DD) => finishCall(live.getState(), { businessName: "Test", callerPhone: PHONE, profile }),
  };
}
function eventFor(fin, lang, tenantId) {
  const built = CSE.buildCallSummaryEvent({ path: 'v2', callLanguage: lang, callId: 'call_b2err', tenantId, answered: true, caller: { phone: PHONE }, receipts: fin.summaryReceipts, failure: fin.outcome });
  assert.ok(built.ok, built.errors.join('; '));
  return built.event;
}

test('EN model throws mid-call: repair line, one callback row with number + known slots, outcome brain_error, never booked', async () => {
  const R = rig();
  const restore = throwOnTurns([2], () => Object.assign(new Error('gemini stream reset mid-turn'), { brainErrorKind: 'model' }));
  try {
    const rb = await R.turn('Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.', DD);
    assert.match(rb.line, /Shall I book it\?$/);
    const r = await R.turn('Yes', DD);
    assert.equal(r.line, repairLine('en'));
    assert.equal(r.repaired, 'throw');
    assert.equal(r.brainError.ok, true);
    assert.equal(r.brainError.kind, 'model');
  } finally { restore(); }
  assert.ok(!R.said.some((l) => BOOKED.test(l)), 'never says booked');
  assert.equal(R.writes.filter((w) => w.appointment).length, 0, 'no booking row');
  const reqs = R.requests();
  assert.equal(reqs.length, 1, 'one follow-up row');
  assert.equal(reqs[0].type, 'callback');
  assert.equal(reqs[0].phone, PHONE);
  assert.match(reqs[0].notes, /Live line could not complete \(brain_error:model\)/);
  assert.match(reqs[0].notes, /Sofa Cleaning/i);
  assert.match(reqs[0].idempotencyKey, /:brain_error$/);
  const st = R.live.getState();
  const phases = st.writeReceipts.filter((w) => /brain_error/.test(w.idempotencyKey)).map((w) => w.phase);
  assert.deepEqual(phases, ['confirmed', 'committed']);
  const fin = finishCall(st, { businessName: 'DD', callerPhone: PHONE, profile: DD });
  assert.equal(fin.outcome, 'brain_error');
  assert.match(fin.ownerText, /line had a problem/);
  const ev = eventFor(fin, 'en', DD.id);
  assert.equal(ev.outcome, 'brain_error');
  const cb = ev.receipts.find((x) => x.brainError);
  assert.equal(cb.type, 'callback');
  assert.ok(cb.writtenRowId);
  assert.match(cb.slots.service.value, /^Sofa Cleaning/);
  assert.match(renderOwnerSummary(ev, { businessName: 'DD' }).text, /^Call back needed: the line had a problem/);
  assert.equal(R.traced.length, 1);
  assert.equal(R.traced[0].ok, true);
});

test('SW model throws on the first turn: Swahili repair line, one row, outcome brain_error; a second error the same call adds no row', async () => {
  const R = rig();
  const restore = throwOnTurns([1, 2], () => new Error('gemini model client exploded'));
  try {
    const a = await R.turn('Nataka kusafisha sofa Ijumaa', DD, 'sw');
    assert.equal(a.line, repairLine('sw'));
    const b = await R.turn('Ijumaa saa nne asubuhi', DD, 'sw');
    assert.equal(b.line, repairLine('sw'));
    assert.equal(b.brainError.ok, true);
  } finally { restore(); }
  assert.equal(R.requests().length, 1, 'idempotent per call');
  const fin = R.fin();
  assert.equal(fin.outcome, 'brain_error');
  const ev = eventFor(fin, 'sw', DD.id);
  assert.equal(ev.outcome, 'brain_error');
  assert.match(renderOwnerSummary(ev, { businessName: 'DD' }).text, /^Mpigie tena: laini ilikuwa na hitilafu/);
});

test('EN tool throws on the booking write: honest "couldn\'t save", the one owner row is saved, outcome write_failed; a later brain error reuses that row', async () => {
  const R = rig({ throwTool: 'appointment' });
  await R.turn('Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.', DD);
  const r = await R.turn('Yes', DD);
  assert.doesNotMatch(r.line, BOOKED);
  assert.match(r.line, /didn't save|couldn't save/i);
  assert.match(r.line, /note to call you/);
  assert.equal(R.requests().length, 1, 'the not-saved owner request');
  assert.equal(R.fin().outcome, 'write_failed');
  const restore = throwOnTurns([1], () => new Error('turn exploded'));
  try {
    const t = await R.turn('Hello?', DD);
    assert.equal(t.line, repairLine('en'));
    assert.equal(t.brainError.reused, true);
  } finally { restore(); }
  assert.equal(R.requests().length, 1, 'never a second owner row on the same call');
  assert.equal(R.fin().outcome, 'brain_error');
});

test('SW tool throws on the callback write: no promise, nothing claimed, outcome write_failed', async () => {
  const us = [{ intent: 'callback', language: 'sw' }, { intent: 'ask', slots: { name: 'Wanjiru' }, language: 'sw' }, { intent: 'confirm', yes_no: 'yes', language: 'sw' }];
  const R = rig({ throwTool: 'serviceRequest', us });
  await R.turn('Naomba mtu anipigie', DND, 'sw');
  await R.turn('Jina langu ni Wanjiru', DND, 'sw');
  const r = await R.turn('Ndio', DND, 'sw');
  assert.doesNotMatch(r.line, /atakupigia|watakupigia|nimemwomba/i);
  assert.equal(R.fin().outcome, 'write_failed');
});

test('the save itself fails (EN + SW): repair line, logged + traced as failed, outcome write_failed, never booked', async () => {
  for (const lang of ['en', 'sw']) {
    const R = rig({ failSave: true });
    const restore = throwOnTurns([2], () => new Error('gemini stream reset'));
    try {
      await R.turn(lang === 'en' ? 'Book sofa cleaning Friday at 10am in Kitengela, I am Alvin.' : 'Nataka kusafisha sofa', DD, lang);
      const r = await R.turn(lang === 'en' ? 'Yes' : 'Ndio', DD, lang);
      assert.equal(r.line, repairLine(lang));
      assert.equal(r.brainError.ok, false);
      assert.match(r.brainError.error, /supabase insert failed/);
    } finally { restore(); }
    assert.ok(!R.said.some((l) => BOOKED.test(l)), `${lang}: never says booked`);
    assert.ok(R.logs.some((l) => /brain_error kind=model save FAILED/.test(l)), `${lang}: logged`);
    assert.equal(R.traced.length, 1);
    assert.equal(R.traced[0].ok, false, `${lang}: traced as failed`);
    const st = R.live.getState();
    assert.deepEqual(st.writeReceipts.filter((w) => /brain_error/.test(w.idempotencyKey)).map((w) => w.phase), ['confirmed', 'failed']);
    const fin = R.fin();
    assert.equal(fin.outcome, 'write_failed');
    const ev = eventFor(fin, lang, DD.id);
    assert.equal(ev.outcome, 'write_failed');
    const cb = ev.receipts.find((x) => x.brainError);
    assert.equal(cb.writtenRowId, undefined);
    assert.match(cb.slots.reason.value, /NOT saved/);
  }
});

test('a throw outside the engines (live.run itself) and concurrent errors still save exactly one row per call', async () => {
  const R = rig();
  await R.turn('Hello', DD);
  const run = R.live.run;
  R.live.run = async () => { throw new Error('runner exploded'); };
  const [a, b] = await Promise.all([R.turn('Hello?', DD), R.live.recordError(new Error('voice speak failed'), { profile: DD })]);
  R.live.run = run;
  assert.equal(a.line, repairLine('en'));
  assert.equal(a.brainError.ok, true);
  assert.equal(b.id, a.brainError.id);
  assert.equal(R.requests().length, 1);
  // the per-call registry: finishCall once; the cached result keeps the typed outcome
  const owned = createOwnedCalls();
  owned.live('HD_b2err_reg', () => R.live);
  const f1 = owned.finish('HD_b2err_reg', { profile: DD });
  const f2 = owned.finish('HD_b2err_reg', { profile: DD });
  assert.equal(f1.outcome, 'brain_error');
  assert.equal(f2.once, false);
  assert.equal(f2.outcome, 'brain_error');
});
