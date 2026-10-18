// Run: node --test tests/billingNoticeSender.test.js
// Sends billing_notices rows (#775, billed_to platform) on the normal notify
// path: claim_billing_notices -> dispatchAlert -> settle_billing_notice.
// Off unless BILLING_NOTICES_SEND is on. Never asks tenant_escalation_allowed.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  billingNoticeConfig,
  channelsForNotice,
  createBillingNoticeSender,
  startBillingNoticeSender,
} = require('../src/notifications/billingNoticeSender');
const { beginInstanceSend, resetInstanceFlights } = require('../src/notifications/sendLedger');

function row(over = {}) {
  return {
    id: 'n1',
    tenant_id: 't1',
    kind: 'platform_billing_trial_ended',
    title: 'Trial ended',
    body: 'Your trial has ended. SECRET-BODY',
    channel: 'sms',
    recipient: '+254711000999',
    fallback: { order: ['sms', 'whatsapp', 'email'], sms: '+254711000999', whatsapp: '+254711000999', email: 'owner@example.com' },
    audience: 'staff',
    billed_to: 'platform',
    delivery_status: 'sending',
    idempotency_key: 'trial_ended:t1:2026-10-18',
    ...over,
  };
}

function fakeRpc({ claimed = [], claimError = null, settleError = null } = {}) {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === 'claim_billing_notices') {
      if (claimError) return { data: null, error: claimError };
      return { data: claimed, error: null };
    }
    if (name === 'settle_billing_notice') {
      if (settleError) return { data: null, error: settleError };
      return { data: { id: args.p_id, delivery_status: args.p_status }, error: null };
    }
    return { data: null, error: { message: `unexpected rpc ${name}` } };
  };
  rpc.calls = calls;
  return rpc;
}

describe('billingNoticeConfig', () => {
  it('off unless BILLING_NOTICES_SEND is on', () => {
    assert.equal(billingNoticeConfig({}), null);
    assert.equal(billingNoticeConfig({ BILLING_NOTICES_SEND: 'off' }), null);
    assert.equal(billingNoticeConfig({ BILLING_NOTICES_SEND: 'on', NODE_ENV: 'test' }), null);
    for (const v of ['on', '1', 'true', 'yes']) {
      assert.deepEqual(billingNoticeConfig({ BILLING_NOTICES_SEND: v }), { intervalMs: 120_000, limit: 20 });
    }
  });
  it('interval clamps to at least 30 s; batch 1..100', () => {
    assert.equal(billingNoticeConfig({ BILLING_NOTICES_SEND: 'on', BILLING_NOTICES_INTERVAL_MS: '1000' }).intervalMs, 30_000);
    assert.equal(billingNoticeConfig({ BILLING_NOTICES_SEND: 'on', BILLING_NOTICES_INTERVAL_MS: '300000' }).intervalMs, 300_000);
    assert.equal(billingNoticeConfig({ BILLING_NOTICES_SEND: 'on', BILLING_NOTICES_INTERVAL_MS: 'x' }).intervalMs, 120_000);
    assert.equal(billingNoticeConfig({ BILLING_NOTICES_SEND: 'on', BILLING_NOTICES_BATCH: '500' }).limit, 100);
    assert.equal(billingNoticeConfig({ BILLING_NOTICES_SEND: 'on', BILLING_NOTICES_BATCH: '5' }).limit, 5);
  });
});

describe('channelsForNotice: start at the channel the SQL chose, then fall back', () => {
  it('sms -> all; whatsapp -> whatsapp+email; email -> email only', () => {
    assert.deepEqual(channelsForNotice(row({ channel: 'sms' })), { sms: true, whatsapp: true, email: true });
    assert.deepEqual(channelsForNotice(row({ channel: 'whatsapp' })), { sms: false, whatsapp: true, email: true });
    assert.deepEqual(channelsForNotice(row({ channel: 'email' })), { sms: false, whatsapp: false, email: true });
  });
});

describe('createBillingNoticeSender.runOnce', () => {
  let logs;
  const log = (m) => logs.push(String(m));
  beforeEach(() => { logs = []; });

  it('claims, sends on the notify path with a per-notice key, settles sent', async () => {
    const rpc = fakeRpc({ claimed: [row()] });
    const sends = [];
    const send = async (opts) => { sends.push(opts); return { channel: 'sms', to: opts.to }; };
    const sender = createBillingNoticeSender({ rpc, send, log, limit: 7 });
    const out = await sender.runOnce();
    assert.deepEqual(out, { claimed: 1, sent: 1, failed: 0, skipped: 0 });
    assert.deepEqual(rpc.calls[0], { name: 'claim_billing_notices', args: { p_limit: 7 } });
    assert.equal(sends.length, 1);
    const s = sends[0];
    assert.equal(s.to, '+254711000999');
    assert.equal(s.email, 'owner@example.com');
    assert.equal(s.subject, 'Trial ended');
    assert.match(s.body, /Your trial has ended/);
    assert.deepEqual(s.channels, { sms: true, whatsapp: true, email: true });
    assert.equal(s.kind, 'platform_billing_trial_ended');
    assert.deepEqual(s.ledger, {
      tenantId: 't1',
      kind: 'platform_billing_trial_ended',
      keyBase: 'billing_notice:t1:trial_ended:t1:2026-10-18',
      billingNotice: true,
    });
    assert.deepEqual(rpc.calls[1], {
      name: 'settle_billing_notice',
      args: { p_id: 'n1', p_status: 'sent', p_notify_send_id: null, p_error: null },
    });
  });

  it('never asks tenant_escalation_allowed', async () => {
    const rpc = fakeRpc({ claimed: [row(), row({ id: 'n2', kind: 'platform_billing_suspended' })] });
    await createBillingNoticeSender({ rpc, send: async () => ({ channel: 'sms' }), log }).runOnce();
    assert.ok(rpc.calls.every((c) => c.name !== 'tenant_escalation_allowed'));
  });

  it('a failed send settles failed (no retry); no destination settles skipped; replay settles sent', async () => {
    const rpc = fakeRpc({
      claimed: [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' }), row({ id: 'd' })],
    });
    const answers = {
      a: { channel: null, reason: 'send_failed', errors: ['sms:boom'] },
      b: { channel: null, reason: 'no_destination_number' },
      c: { channel: null, reason: 'instance_already_sent' },
    };
    let n = 0;
    const send = async () => {
      const id = ['a', 'b', 'c', 'd'][n++];
      if (id === 'd') throw new Error('provider exploded');
      return answers[id];
    };
    const out = await createBillingNoticeSender({ rpc, send, log }).runOnce();
    assert.deepEqual(out, { claimed: 4, sent: 1, failed: 2, skipped: 1 });
    const settles = rpc.calls.filter((c) => c.name === 'settle_billing_notice').map((c) => [c.args.p_id, c.args.p_status, c.args.p_error]);
    assert.deepEqual(settles, [
      ['a', 'failed', 'send_failed'],
      ['b', 'skipped', 'no_destination_number'],
      ['c', 'sent', null],
      ['d', 'failed', 'send_error'],
    ]);
    assert.equal(n, 4, 'one send per notice, no retry');
  });

  it('missing RPC (#775 not applied): logs once, backs off, sends nothing', async () => {
    let t = 1_000;
    const rpc = fakeRpc({ claimError: { code: 'PGRST202', message: 'Could not find the function public.claim_billing_notices' } });
    const send = async () => { throw new Error('should not send'); };
    const sender = createBillingNoticeSender({ rpc, send, log, now: () => t, missingBackoffMs: 600_000 });
    assert.deepEqual(await sender.runOnce(), { skipped: 'rpc_missing' });
    assert.deepEqual(await sender.runOnce(), { skipped: 'rpc_missing' });
    assert.equal(rpc.calls.length, 1);
    assert.equal(logs.filter((l) => /missing/.test(l)).length, 1);
    t += 600_001;
    await sender.runOnce();
    assert.equal(rpc.calls.length, 2);
  });

  it('a claim error is logged and the tick ends (next tick tries again)', async () => {
    const rpc = fakeRpc({ claimError: { code: '57014', message: 'timeout' } });
    const out = await createBillingNoticeSender({ rpc, send: async () => ({}), log }).runOnce();
    assert.deepEqual(out, { skipped: 'claim_failed' });
    assert.ok(logs.some((l) => /claim failed/.test(l)));
  });

  it('a settle error is logged, never thrown, and the batch continues', async () => {
    const rpc = fakeRpc({ claimed: [row({ id: 'a' }), row({ id: 'b' })], settleError: { message: 'settle down' } });
    let sent = 0;
    const out = await createBillingNoticeSender({ rpc, send: async () => { sent += 1; return { channel: 'sms' }; }, log }).runOnce();
    assert.equal(sent, 2);
    assert.equal(out.claimed, 2);
    assert.ok(logs.some((l) => /settle failed/.test(l)));
  });

  it('no overlapping runs', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const rpc = fakeRpc({ claimed: [row()] });
    const sender = createBillingNoticeSender({ rpc, send: async () => { await gate; return { channel: 'sms' }; }, log });
    const first = sender.runOnce();
    assert.deepEqual(await sender.runOnce(), { skipped: 'in_flight' });
    release();
    assert.equal((await first).sent, 1);
  });

  it('logs ids, kinds and counts only: no recipient, body or email', async () => {
    const rpc = fakeRpc({ claimed: [row(), row({ id: 'n2' })] });
    let n = 0;
    await createBillingNoticeSender({ rpc, send: async () => (n++ ? { channel: null, reason: 'send_failed', errors: ['sms:+254711000999 bad'] } : { channel: 'sms', to: '+254711000999' }), log }).runOnce();
    const all = logs.join('\n');
    assert.ok(all.length > 0);
    assert.doesNotMatch(all, /254711000999|owner@example\.com|SECRET-BODY|Your trial/);
  });
});

describe('startBillingNoticeSender', () => {
  it('null when off', () => {
    assert.equal(startBillingNoticeSender({ env: {}, rpc: fakeRpc(), send: async () => ({}), log: () => {} }), null);
  });
  it('on: unref\'d timers, stop() clears them', () => {
    const made = [];
    const cleared = [];
    const timer = (kind, ms) => {
      const t = { kind, ms, unrefd: false, unref() { this.unrefd = true; return this; } };
      made.push(t);
      return t;
    };
    const timers = {
      setTimeout: (fn, ms) => timer('timeout', ms),
      setInterval: (fn, ms) => timer('interval', ms),
      clearTimeout: (t) => cleared.push(t),
      clearInterval: (t) => cleared.push(t),
    };
    const handle = startBillingNoticeSender({
      env: { BILLING_NOTICES_SEND: 'on' }, rpc: fakeRpc(), send: async () => ({}), log: () => {}, timers,
    });
    assert.ok(handle);
    assert.equal(made.length, 2);
    assert.ok(made.every((t) => t.unrefd));
    assert.equal(made.find((t) => t.kind === 'interval').ms, 120_000);
    handle.stop();
    assert.equal(cleared.length, 2);
  });
});

describe('closed-line send gate lets billing notices through', () => {
  let restore;
  beforeEach(() => {
    const dbPath = require.resolve('../src/db');
    const prev = require.cache[dbPath];
    require.cache[dbPath] = {
      id: dbPath, filename: dbPath, loaded: true,
      exports: {
        tenantLineClosed: async (id) => ({ closed: true, reason: 'suspended', tenantId: id }),
        findNotifySend: async () => null,
      },
    };
    restore = () => { if (prev) require.cache[dbPath] = prev; else delete require.cache[dbPath]; };
  });
  afterEach(() => { restore(); resetInstanceFlights(); });

  it('a suspended business still gets its platform_billing_* notice', async () => {
    const out = await beginInstanceSend(
      { tenantId: 't1', kind: 'platform_billing_suspended', keyBase: 'billing_notice:t1:k', billingNotice: true },
      '254711000000'
    );
    assert.equal(out.ok, true);
  });

  it('the exemption needs both the flag and a platform_billing_* kind', async () => {
    const realWarn = console.warn;
    console.warn = () => {};
    try {
      const a = await beginInstanceSend({ tenantId: 't1', kind: 'lead', billingNotice: true }, '254711000000');
      assert.equal(a.reason, 'tenant_line_closed');
      const b = await beginInstanceSend({ tenantId: 't1', kind: 'platform_billing_suspended' }, '254711000000');
      assert.equal(b.reason, 'tenant_line_closed');
    } finally {
      console.warn = realWarn;
    }
  });
});
