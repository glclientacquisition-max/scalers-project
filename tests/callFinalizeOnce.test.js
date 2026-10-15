'use strict';
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { finalizeDecision, finalizeOnceEnabled } = require('../src/callFinalizeOnce');

// Fake calls table honouring .not('status','in','(...)') like Postgres would.
const calls = [];
const updates = [];
function builder(table) {
  const st = { op: 'select', patch: null, eq: [], notIn: null };
  const run = () => {
    const rows = table === 'calls' ? calls : [];
    const match = (r) => st.eq.every(([k, v]) => r[k] === v) && (!st.notIn || !st.notIn.includes(r.status));
    const hit = rows.filter(match);
    if (st.op === 'update') { updates.push({ patch: st.patch, guarded: !!st.notIn }); hit.forEach((r) => Object.assign(r, st.patch)); }
    return { data: hit[0] ? { ...hit[0] } : null, error: null };
  };
  const b = {
    select() { return b; },
    update(p) { st.op = 'update'; st.patch = p; return b; },
    eq(k, v) { st.eq.push([k, v]); return b; },
    not(col, op, list) { st.notIn = String(list).replace(/[()]/g, '').split(','); return b; },
    in() { return b; }, order() { return b; }, limit() { return b; }, gte() { return b; },
    maybeSingle() { return Promise.resolve(run()); },
    single() { return Promise.resolve(run()); },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
  };
  return b;
}

let db;
before(() => {
  const clientPath = require.resolve('../src/lib/supabaseClient');
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { supabase: { from: builder, rpc: async () => ({ data: null, error: null }) } } };
  db = require('../src/db');
});
beforeEach(() => {
  calls.length = 0; updates.length = 0;
  calls.push({ id: 'c1', sautikit_call_sid: 'HD_4ec204aafa93', status: 'in_progress', duration_seconds: null, summary: '{}', tenant_id: 't' });
});

describe('finalizeDecision', () => {
  it('runs everything when the flag is off or the caller won', () => {
    assert.equal(finalizeDecision({ enabled: false, won: false }), 'run');
    assert.equal(finalizeDecision({ enabled: true, won: true }), 'run');
    assert.equal(finalizeDecision({ enabled: true, won: undefined }), 'run');
  });
  it('a loser only forwards live turns to review, else skips', () => {
    assert.equal(finalizeDecision({ enabled: true, won: false, hasTurns: true }), 'review_only');
    assert.equal(finalizeDecision({ enabled: true, won: false, hasTurns: false }), 'skip');
  });
  it('flag is off by default', () => {
    assert.equal(finalizeOnceEnabled({}), false);
    assert.equal(finalizeOnceEnabled({ CALL_FINALIZE_ONCE: '1' }), true);
  });
});

describe('updateCallStatus run-once (HD_4ec204aafa93: three webhooks)', () => {
  it('only the first terminal flip wins; later ones lose but keep the longer duration', async () => {
    const a = await db.updateCallStatus({ callSid: 'HD_4ec204aafa93', status: 'complete', durationSeconds: 109, finalizeOnce: true });
    const b = await db.updateCallStatus({ callSid: 'HD_4ec204aafa93', status: 'complete', durationSeconds: 110, finalizeOnce: true });
    assert.equal(a.finalizeWinner, true);
    // Second call sees the row already terminal: not a claim, no winner flag.
    assert.notEqual(b.finalizeWinner, true);
    assert.equal(calls[0].status, 'complete');
    assert.equal(calls[0].duration_seconds, 110);
    assert.equal(updates[0].guarded, true);
  });
  it('a racer that read a stale non-terminal row loses the guarded update', async () => {
    // Simulate: another instance flips status between our read and our write.
    const realThen = calls[0];
    const p = db.updateCallStatus({ callSid: 'HD_4ec204aafa93', status: 'complete', durationSeconds: 110, finalizeOnce: true });
    realThen.status = 'complete';
    const out = await p;
    assert.equal(out.finalizeWinner, false);
    assert.equal(calls[0].duration_seconds, 110);
  });
  it('flag off: unguarded update as before', async () => {
    const out = await db.updateCallStatus({ callSid: 'HD_4ec204aafa93', status: 'complete', durationSeconds: 5, finalizeOnce: false });
    assert.equal(out.finalizeWinner, undefined);
    assert.equal(updates[0].guarded, false);
  });
});
