// Run: node --test tests/escalationGate.test.js
// Voicemails and call updates check tenant_escalation_allowed (#775) before any
// SMS / WhatsApp / email. allowed=false -> Inbox only. Missing RPC or an error
// keeps today's behaviour (send) and logs. Billing notices are never gated.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  isCallUpdate,
  createEscalationGate,
  escalationGateEnabled,
  setDefaultEscalationGate,
} = require('../src/notifications/escalationGate');
const { resetInstanceFlights } = require('../src/notifications/sendLedger');

function stubDb(exports) {
  const dbPath = require.resolve('../src/db');
  const prev = require.cache[dbPath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports };
  return () => {
    if (prev) require.cache[dbPath] = prev;
    else delete require.cache[dbPath];
  };
}

function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

function rpcReturning(answers) {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    const next = typeof answers === 'function' ? answers(calls.length, args) : answers;
    if (next instanceof Error) throw next;
    return next;
  };
  rpc.calls = calls;
  return rpc;
}

describe('isCallUpdate: which sends are voicemails and call updates', () => {
  it('owner call alerts are call updates', () => {
    for (const kind of ['lead', 'escalation', 'service_request', 'appointment', 'voicemail', 'callback']) {
      assert.equal(isCallUpdate({ tenantId: 't1', kind }), true, kind);
    }
  });
  it('any tenant staff send tied to a call is a call update', () => {
    assert.equal(isCallUpdate({ tenantId: 't1', kind: 'owner_summary', callSid: 'HD_1' }), true);
    assert.equal(isCallUpdate({ tenantId: 't1', kind: 'something', callId: 'c1' }), true);
  });
  it('billing notices, platform alerts, caller texts and tenant-less sends are not', () => {
    for (const kind of [
      'platform_billing_suspended', 'platform_billing_trial_ended', 'platform_billing_invoice_due',
      'wallet_low', 'wallet_empty', 'platform_ops_package',
    ]) {
      assert.equal(isCallUpdate({ tenantId: 't1', kind, callSid: 'HD_1' }), false, kind);
    }
    assert.equal(isCallUpdate({ tenantId: 't1', kind: 'missed_textback', callSid: 'HD_1' }), false);
    assert.equal(isCallUpdate({ tenantId: 't1', kind: 'caller_callback', callSid: 'HD_1' }), false);
    assert.equal(isCallUpdate({ kind: 'lead', callSid: 'HD_1' }), false);
    assert.equal(isCallUpdate(null), false);
  });
  it('kill switch ESCALATION_GATE=off', () => {
    assert.equal(escalationGateEnabled({}), true);
    for (const v of ['off', '0', 'false', 'no', 'OFF']) assert.equal(escalationGateEnabled({ ESCALATION_GATE: v }), false);
  });
});

describe('createEscalationGate', () => {
  let logs;
  const log = (m) => logs.push(String(m));
  beforeEach(() => { logs = []; });

  it('allowed=false holds with the reason; answers are cached per tenant', async () => {
    const clock = fakeClock();
    const rpc = rpcReturning({ data: [{ allowed: false, reason: 'trial_ended' }], error: null });
    const gate = createEscalationGate({ rpc, log, now: clock.now, ttlMs: 30_000 });
    assert.deepEqual(await gate.check('t1'), { allowed: false, reason: 'trial_ended', source: 'rpc' });
    assert.equal((await gate.check('t1')).allowed, false);
    assert.equal(rpc.calls.length, 1);
    assert.deepEqual(rpc.calls[0], { name: 'tenant_escalation_allowed', args: { p_tenant_id: 't1' } });
    clock.advance(30_001);
    await gate.check('t1');
    assert.equal(rpc.calls.length, 2);
  });

  it('concurrent checks for one tenant share one RPC', async () => {
    const rpc = rpcReturning({ data: { allowed: false, reason: 'minutes_cap' }, error: null });
    const gate = createEscalationGate({ rpc, log });
    const [a, b] = await Promise.all([gate.check('t1'), gate.check('t1')]);
    assert.equal(a.reason, 'minutes_cap');
    assert.equal(b.reason, 'minutes_cap');
    assert.equal(rpc.calls.length, 1);
  });

  it('allowed=true sends as today', async () => {
    const gate = createEscalationGate({ rpc: rpcReturning({ data: [{ allowed: true, reason: 'ok' }], error: null }), log });
    assert.equal((await gate.check('t1')).allowed, true);
  });

  it('missing RPC (#775 not applied) fails open, logs once, backs off', async () => {
    const clock = fakeClock();
    const rpc = rpcReturning({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.tenant_escalation_allowed(p_tenant_id) in the schema cache' },
    });
    const gate = createEscalationGate({ rpc, log, now: clock.now, missingBackoffMs: 600_000 });
    assert.deepEqual(await gate.check('t1'), { allowed: true, reason: 'rpc_missing', source: 'missing' });
    assert.equal((await gate.check('t2')).allowed, true);
    assert.equal(rpc.calls.length, 1);
    assert.equal(logs.filter((l) => /missing/.test(l)).length, 1);
    clock.advance(600_001);
    await gate.check('t3');
    assert.equal(rpc.calls.length, 2);
  });

  it('an RPC error or throw fails open, is not cached, and logs (rate limited)', async () => {
    const clock = fakeClock();
    const rpc = rpcReturning((n) => (n === 1 ? { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } } : new Error('fetch failed')));
    const gate = createEscalationGate({ rpc, log, now: clock.now });
    assert.deepEqual(await gate.check('t1'), { allowed: true, reason: 'check_failed', source: 'error' });
    assert.deepEqual(await gate.check('t1'), { allowed: true, reason: 'check_failed', source: 'error' });
    assert.equal(rpc.calls.length, 2);
    assert.equal(logs.filter((l) => /check failed/.test(l)).length, 1);
  });

  it('a malformed answer fails open', async () => {
    const gate = createEscalationGate({ rpc: rpcReturning({ data: [], error: null }), log });
    assert.equal((await gate.check('t1')).allowed, true);
  });

  it('kill switch: never asks', async () => {
    const rpc = rpcReturning({ data: [{ allowed: false, reason: 'trial_ended' }], error: null });
    const gate = createEscalationGate({ rpc, log, env: { ESCALATION_GATE: 'off' } });
    assert.equal((await gate.check('t1')).allowed, true);
    assert.equal(rpc.calls.length, 0);
  });
});

describe('dispatch path: held call updates stay in the Inbox', () => {
  let restoreDb;
  let meta;
  let realFetch;
  let fetched;
  let asked;
  beforeEach(() => {
    meta = [];
    asked = [];
    fetched = 0;
    realFetch = global.fetch;
    global.fetch = async () => { fetched += 1; throw new Error('no network in tests'); };
    restoreDb = stubDb({
      tenantLineClosed: async (id) => ({ closed: false, reason: 'live', tenantId: id }),
      mergeCallSummaryMeta: async (args) => { meta.push(args); return true; },
      findNotifySend: async () => null,
    });
    setDefaultEscalationGate({
      check: async (id) => { asked.push(id); return { allowed: false, reason: 'minutes_cap', source: 'rpc' }; },
    });
  });
  afterEach(() => {
    global.fetch = realFetch;
    restoreDb();
    setDefaultEscalationGate(null);
    resetInstanceFlights();
  });

  it('dispatchAlert (lead) sends nothing and notes the hold on the call', async () => {
    const { dispatchAlert } = require('../src/notifications/dispatch');
    const out = await dispatchAlert({
      to: '+254711000000',
      email: 'owner@example.com',
      body: 'New lead',
      ledger: { tenantId: 't1', callSid: 'HD_x', kind: 'lead' },
    });
    assert.deepEqual(out, { channel: null, reason: 'escalation_held', held: 'minutes_cap' });
    assert.equal(fetched, 0);
    assert.deepEqual(meta, [
      { callSid: 'HD_x', patch: { owner_notify_held: 'minutes_cap', owner_notify_kind: 'lead' } },
    ]);
  });

  it('dispatchEscalationAlert is held the same way', async () => {
    const { dispatchEscalationAlert } = require('../src/notifications/dispatch');
    const out = await dispatchEscalationAlert({
      teammatePhone: '+254711000000',
      body: 'Caller wants a person',
      ledger: { tenantId: 't1', callSid: 'HD_e', kind: 'escalation' },
    });
    assert.equal(out.length, 0);
    assert.equal(out.reason, 'escalation_held');
    assert.equal(fetched, 0);
  });

  it('dispatchToStaff: every person held, no sends', async () => {
    const { dispatchToStaff } = require('../src/notifications/recipients');
    const out = await dispatchToStaff({
      recipients: [
        { id: 'a', name: 'A', phone: '+254711000001' },
        { id: 'b', name: 'B', phone: '+254711000002' },
      ],
      body: 'Booked',
      ledger: { tenantId: 't1', callSid: 'HD_s', kind: 'appointment' },
    });
    assert.equal(out.sent.length, 0);
    assert.equal(fetched, 0);
    assert.ok(out.errors.every((e) => /escalation_held/.test(e)));
  });

  it('billing notices and wallet alerts never ask the gate', async () => {
    const { dispatchAlert } = require('../src/notifications/dispatch');
    for (const kind of ['platform_billing_suspended', 'wallet_low']) {
      await dispatchAlert({ to: '+254711000000', body: 'x', ledger: { tenantId: 't1', kind } });
    }
    assert.deepEqual(asked, []);
  });

  it('gate allowed=true leaves the send path as it was', async () => {
    setDefaultEscalationGate({ check: async () => ({ allowed: true, reason: 'ok', source: 'rpc' }) });
    const { dispatchAlert } = require('../src/notifications/dispatch');
    const out = await dispatchAlert({ to: '+254711000000', body: 'x', ledger: { tenantId: 't1', callSid: 'HD_y', kind: 'lead' } });
    assert.notEqual(out.reason, 'escalation_held');
    assert.deepEqual(meta, []);
  });
});
