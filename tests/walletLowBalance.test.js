const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const express = require('express');

const {
  parseThresholdsKes,
  observeWalletBalance,
  handleWalletWebhookEvent,
  isWalletEventKind,
  createMemoryStore,
  createSupabaseStore,
  resetWalletLowBalance,
  setWalletLowBalanceStore,
  setWalletLowBalanceDbClient,
} = require('../src/sautikit/walletLowBalance');
const { probeSautikitWallet } = require('../src/sautikit/walletProbe');
const { resetTelephonyProviderHealth } = require('../src/sautikit/telephonyProviderHealth');
const {
  resetPlatformOpsAlert,
  setPlatformOpsDispatch,
} = require('../src/notifications/platformOpsAlert');
const { setPlatformOpsRecipientsLoader } = require('../src/notifications/platformOpsRecipients');
const { sautikitWebhookGuard } = require('../src/sautikit/webhook');
const { platformOpsWalletLowBody } = require('../src/notifications/templates');

const ENV_KEYS = [
  'VOICE_PLATFORM_OPS_DRY_RUN',
  'VOICE_WALLET_ALERT_THRESHOLDS_KES',
  'VOICE_WALLET_LOW_ALERT',
  'SAUTIKIT_VALIDATE_WEBHOOKS',
  'SAUTIKIT_WEBHOOK_SECRET',
  'SCALERS_OPS_ALERT_EMAILS',
  'VOICE_WALLET_WEBHOOK',
];

function adminSettings(kinds = {}) {
  setPlatformOpsRecipientsLoader(async () => ({
    data: { people: [{ email: 'ops@scalers.co.ke' }], emails: [], kinds },
    error: null,
  }));
}

function captureDispatch() {
  const sent = [];
  setPlatformOpsDispatch(async (msg) => {
    sent.push(msg);
    return { sent: [{ channel: 'email', email: 'ops@scalers.co.ke' }], errors: [] };
  });
  return sent;
}

function walletEvent(eventId, balanceMinor, occurredAt = new Date().toISOString()) {
  return {
    kind: 'wallet.low_balance',
    event_id: eventId,
    workspace_id: 'ws_test',
    occurred_at: occurredAt,
    data: { balance_minor: balanceMinor, currency: 'KES', threshold_minor: 50000 },
  };
}

describe('walletLowBalance', () => {
  const saved = {};
  let store;
  let sent;

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    resetPlatformOpsAlert();
    resetTelephonyProviderHealth();
    resetWalletLowBalance();
    process.env.VOICE_WALLET_WEBHOOK = 'on'; // webhook tests; default-off has its own test
    store = createMemoryStore(); // stands in for the DB table: survives "restarts"
    setWalletLowBalanceStore(store);
    adminSettings();
    sent = captureDispatch();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    setPlatformOpsRecipientsLoader(null);
    resetPlatformOpsAlert();
    resetWalletLowBalance();
  });

  it('parses thresholds: default 500,100, env override, bad entries ignored', () => {
    assert.deepEqual(parseThresholdsKes(undefined), [50000, 10000]);
    assert.deepEqual(parseThresholdsKes(''), [50000, 10000]);
    assert.deepEqual(parseThresholdsKes('100, 1000;250'), [100000, 25000, 10000]);
    assert.deepEqual(parseThresholdsKes('abc,-5,0'), [50000, 10000]);
    assert.deepEqual(parseThresholdsKes('7.5'), [750]);
  });

  it('alerts once crossing 500, then once crossing 100, no repeats', async () => {
    let r = await observeWalletBalance({ balanceMinor: 80000, currency: 'KES', source: 'poll' });
    assert.equal(r.alerted, false);
    r = await observeWalletBalance({ balanceMinor: 45000, currency: 'KES', source: 'poll' });
    assert.equal(r.alerted, true);
    assert.deepEqual(r.crossed, [50000]);
    r = await observeWalletBalance({ balanceMinor: 30000, currency: 'KES', source: 'poll' });
    assert.equal(r.alerted, false);
    r = await observeWalletBalance({ balanceMinor: 9000, currency: 'KES', source: 'poll' });
    assert.equal(r.alerted, true);
    assert.deepEqual(r.crossed, [10000]);
    r = await observeWalletBalance({ balanceMinor: 5000, currency: 'KES', source: 'poll' });
    assert.equal(r.alerted, false);

    assert.equal(sent.length, 2);
    assert.equal(sent[0].subject, 'Scalers platform phone wallet low');
    assert.equal(sent[0].ledger.kind, 'platform_ops_wallet');
    assert.deepEqual(sent[0].channels, { sms: false, whatsapp: false, email: true });
    assert.match(sent[0].body, /Balance: KES 450\.00 \(under KES 500\.00\)/);
    assert.match(sent[1].body, /Balance: KES 90\.00 \(under KES 100\.00\)/);
    assert.equal(sent[0].recipients[0].email, 'ops@scalers.co.ke');
  });

  it('one drop past both thresholds sends a single alert naming the lowest', async () => {
    const r = await observeWalletBalance({ balanceMinor: 710, currency: 'KES', source: 'poll' });
    assert.equal(r.alerted, true);
    assert.deepEqual(r.crossed.sort((a, b) => b - a), [50000, 10000]);
    assert.equal(r.lowest, 10000);
    assert.equal(sent.length, 1);
    assert.match(sent[0].body, /KES 7\.10 \(under KES 100\.00\)/);
  });

  it('re-arms when the balance rises above a threshold, then alerts again', async () => {
    await observeWalletBalance({ balanceMinor: 45000, source: 'poll' });
    const up = await observeWalletBalance({ balanceMinor: 60000, source: 'poll' });
    assert.deepEqual(up.rearmed, [50000]);
    assert.equal(up.alerted, false);
    const again = await observeWalletBalance({ balanceMinor: 49000, source: 'poll' });
    assert.equal(again.alerted, true);
    assert.equal(sent.length, 2);
  });

  it('at exactly the threshold counts as crossed; re-arm needs strictly above', async () => {
    assert.equal((await observeWalletBalance({ balanceMinor: 50000, source: 'poll' })).alerted, true);
    const same = await observeWalletBalance({ balanceMinor: 50000, source: 'poll' });
    assert.deepEqual(same.rearmed, []);
    assert.equal(sent.length, 1);
  });

  it('empty wallet: one line-down alert naming the cause, no wallet-low, thresholds marked crossed', async () => {
    const balances = [80000, 0];
    let i = 0;
    const fetchImpl = async () => ({
      status: 200,
      text: async () => JSON.stringify({ data: { currency: 'KES', balance_minor: balances[i++] } }),
    });
    await probeSautikitWallet({ apiKey: 'test-key', fetchImpl });
    assert.equal(sent.length, 0);
    const empty = await probeSautikitWallet({ apiKey: 'test-key', fetchImpl });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(empty.billingExhausted, true);
    assert.equal(empty.lowBalance.suppressed, 'empty_wallet');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].ledger.kind, 'platform_ops_telephony');
    assert.equal(sent[0].subject, 'Scalers platform phone line down');
    assert.match(sent[0].body, /Cause: Phone wallet is empty, top up to restore calls\./);
    assert.doesNotMatch(sent[0].body, /sautikit/i);
    assert.equal(store._rows.get(50000).crossed, true);
    assert.equal(store._rows.get(10000).crossed, true);

    // Still empty: nothing more.
    assert.equal((await observeWalletBalance({ balanceMinor: 0, source: 'poll' })).alerted, false);
    // Partial top-up to KES 300: re-arms 100 only; still under 500 on the same drop, no alert.
    const partial = await observeWalletBalance({ balanceMinor: 30000, source: 'poll' });
    assert.deepEqual(partial.rearmed, [10000]);
    assert.equal(partial.alerted, false);
    // Falls under 100 again (above zero): thresholds fire normally.
    const low = await observeWalletBalance({ balanceMinor: 5000, source: 'poll' });
    assert.equal(low.alerted, true);
    assert.deepEqual(low.crossed, [10000]);
    assert.equal(sent.filter((m) => m.ledger.kind === 'platform_ops_wallet').length, 1);
  });

  it('empty wallet after the 500 alert: only the line-down alert, 100 marked crossed', async () => {
    await observeWalletBalance({ balanceMinor: 45000, source: 'poll' });
    const zero = await observeWalletBalance({ balanceMinor: -50, source: 'poll' });
    assert.equal(zero.suppressed, 'empty_wallet');
    assert.deepEqual(zero.crossed, [10000]);
    assert.equal(sent.length, 1); // the earlier 500 alert only
  });

  it('a restart does not re-alert the same crossing (state persisted)', async () => {
    await observeWalletBalance({ balanceMinor: 45000, source: 'poll' });
    assert.equal(sent.length, 1);
    // Simulate a process restart: in-process memory and caches gone, DB kept.
    resetPlatformOpsAlert();
    resetWalletLowBalance({ keepStore: true });
    adminSettings();
    sent = captureDispatch();
    const r = await observeWalletBalance({ balanceMinor: 44000, source: 'poll' });
    assert.equal(r.alerted, false);
    assert.equal(sent.length, 0);
    // A new crossing after restart still alerts.
    const lower = await observeWalletBalance({ balanceMinor: 9000, source: 'poll' });
    assert.equal(lower.alerted, true);
  });

  it('webhook dedupes on event_id', async () => {
    const body = walletEvent('evt_1', 45000);
    const first = await handleWalletWebhookEvent({ headers: {}, body });
    assert.equal(first.alerted, true);
    const dup = await handleWalletWebhookEvent({ headers: {}, body });
    assert.equal(dup.reason, 'duplicate');
    assert.equal(sent.length, 1);
  });

  it('webhook is inert by default (VOICE_WALLET_WEBHOOK unset or off)', async () => {
    delete process.env.VOICE_WALLET_WEBHOOK;
    const r = await handleWalletWebhookEvent({ headers: {}, body: walletEvent('evt_off', 100) });
    assert.equal(r.reason, 'webhook_off');
    process.env.VOICE_WALLET_WEBHOOK = 'off';
    assert.equal((await handleWalletWebhookEvent({ headers: {}, body: walletEvent('evt_off2', 100) })).reason, 'webhook_off');
    assert.equal(sent.length, 0);
    assert.equal(store._rows.size, 0); // no state touched
  });

  it('webhook dedupes on X-Sautikit-Event-Id when the body has no event_id', async () => {
    const body = walletEvent(undefined, 45000);
    delete body.event_id;
    await handleWalletWebhookEvent({ headers: { 'x-sautikit-event-id': 'uuid-1', 'x-sautikit-idempotency-key': 'd1' }, body });
    const dup = await handleWalletWebhookEvent({ headers: { 'x-sautikit-event-id': 'uuid-1', 'x-sautikit-idempotency-key': 'd2' }, body });
    assert.equal(dup.reason, 'duplicate');
    assert.equal(sent.length, 1);
  });

  it('webhook falls back to X-Sautikit-Idempotency-Key for dedupe', async () => {
    const body = walletEvent(undefined, 45000);
    delete body.event_id;
    const headers = { 'x-sautikit-idempotency-key': 'idem-9' };
    await handleWalletWebhookEvent({ headers, body });
    const dup = await handleWalletWebhookEvent({ headers, body });
    assert.equal(dup.reason, 'duplicate');
    assert.equal(sent.length, 1);
  });

  it('webhook and poll do not double-alert the same crossing (either order)', async () => {
    await handleWalletWebhookEvent({ headers: {}, body: walletEvent('evt_a', 45000) });
    const poll = await observeWalletBalance({ balanceMinor: 44900, source: 'poll' });
    assert.equal(poll.alerted, false);
    assert.equal(sent.length, 1);

    // Other order, next threshold.
    const poll2 = await observeWalletBalance({ balanceMinor: 9500, source: 'poll' });
    assert.equal(poll2.alerted, true);
    const hook = await handleWalletWebhookEvent({ headers: {}, body: walletEvent('evt_b', 9400) });
    assert.equal(hook.alerted, false);
    assert.equal(sent.length, 2);
  });

  it('a late webhook older than a newer top-up reading does not re-alert', async () => {
    const t0 = Date.now() - 60_000;
    await observeWalletBalance({ balanceMinor: 45000, source: 'poll', observedAt: t0 });
    await observeWalletBalance({ balanceMinor: 200000, source: 'poll', observedAt: t0 + 30_000 });
    const late = await handleWalletWebhookEvent({
      headers: {},
      body: walletEvent('evt_late', 45000, new Date(t0 + 10_000).toISOString()),
    });
    assert.equal(late.alerted, false);
    assert.equal(sent.length, 1);
  });

  it('DRY_RUN logs only and sends nothing, and still latches the crossing', async () => {
    process.env.VOICE_PLATFORM_OPS_DRY_RUN = 'true';
    const logs = [];
    const orig = console.warn;
    console.warn = (...args) => logs.push(args.join(' '));
    try {
      const r = await observeWalletBalance({ balanceMinor: 45000, currency: 'KES', source: 'poll' });
      assert.equal(r.alerted, true);
      assert.equal(r.channel, 'dry_run');
      const again = await observeWalletBalance({ balanceMinor: 44000, source: 'poll' });
      assert.equal(again.alerted, false);
    } finally {
      console.warn = orig;
    }
    assert.equal(sent.length, 0);
    const dry = logs.filter((l) => l.includes('[platform-ops] DRY_RUN kind=wallet'));
    assert.equal(dry.length, 1);
    assert.match(dry[0], /recipients=1/);
  });

  it('balance unknown never alerts or re-arms (probe HTTP error, 402, fetch failure)', async () => {
    await observeWalletBalance({ balanceMinor: 45000, source: 'poll' });
    assert.equal(sent.length, 1);

    const errors = [
      async () => ({ status: 503, text: async () => 'unavailable' }),
      async () => ({ status: 403, text: async () => '{"error":"scope"}' }),
      async () => ({ status: 402, text: async () => '{"message":"payment required"}' }),
      async () => ({ status: 200, text: async () => '{}' }),
      async () => {
        throw new Error('ETIMEDOUT');
      },
    ];
    for (const fetchImpl of errors) {
      const res = await probeSautikitWallet({ apiKey: 'test-key', fetchImpl });
      if (res.lowBalance) assert.equal(res.lowBalance.reason, 'balance_unknown');
    }
    assert.equal((await observeWalletBalance({ balanceMinor: null, source: 'poll' })).reason, 'balance_unknown');
    const noBalance = await handleWalletWebhookEvent({
      headers: {},
      body: { kind: 'wallet.low_balance', event_id: 'evt_nobal', data: {} },
    });
    assert.equal(noBalance.reason, 'balance_unknown');

    // Still latched (not re-armed by the unknown readings): no repeat alert.
    const r = await observeWalletBalance({ balanceMinor: 44000, source: 'poll' });
    assert.equal(r.alerted, false);
    // Only the original wallet notice; the 402 telephony alert is a different kind.
    assert.equal(sent.filter((m) => m.ledger.kind === 'platform_ops_wallet').length, 1);
  });

  it('the wallet poll feeds the thresholds', async () => {
    const fetchImpl = async () => ({
      status: 200,
      text: async () => JSON.stringify({ data: { currency: 'KES', balance_minor: 42000 } }),
    });
    const res = await probeSautikitWallet({ apiKey: 'test-key', fetchImpl });
    assert.equal(res.billingExhausted, false);
    assert.equal(res.lowBalance.alerted, true);
    assert.match(sent[0].body, /Seen by: wallet check/);
    const res2 = await probeSautikitWallet({ apiKey: 'test-key', fetchImpl });
    assert.equal(res2.lowBalance.alerted, false);
    assert.equal(sent.length, 1);
  });

  it('respects the Admin "sautikit_low" toggle and VOICE_WALLET_LOW_ALERT=off', async () => {
    adminSettings({ sautikit_low: false });
    assert.equal((await observeWalletBalance({ balanceMinor: 100, source: 'poll' })).reason, 'disabled_in_admin');
    adminSettings({ sautikit_low: true });
    process.env.VOICE_WALLET_LOW_ALERT = 'off';
    assert.equal((await observeWalletBalance({ balanceMinor: 100, source: 'poll' })).reason, 'off');
    assert.equal(sent.length, 0);
  });

  it('a failed send releases the crossing so the next reading retries', async () => {
    setPlatformOpsDispatch(async () => ({ sent: [], errors: ['smtp down'] }));
    const r = await observeWalletBalance({ balanceMinor: 45000, source: 'poll' });
    assert.equal(r.ok, false);
    sent = captureDispatch();
    const retry = await observeWalletBalance({ balanceMinor: 45000, source: 'poll' });
    assert.equal(retry.alerted, true);
    assert.equal(sent.length, 1);
  });

  it('no ops recipients: nothing sent, crossing released', async () => {
    setPlatformOpsRecipientsLoader(async () => ({ data: { people: [], emails: [] }, error: null }));
    const r = await observeWalletBalance({ balanceMinor: 45000, source: 'poll' });
    assert.equal(r.reason, 'no_ops_recipients');
    assert.equal(sent.length, 0);
    assert.equal(store._rows.get(50000).crossed, false);
  });

  it('a transient state error skips the reading instead of guessing', async () => {
    setWalletLowBalanceStore({
      observe: async () => {
        throw new Error('connection reset');
      },
      release: async () => {},
      claimEvent: async () => true,
    });
    const r = await observeWalletBalance({ balanceMinor: 100, source: 'poll' });
    assert.equal(r.reason, 'state_unavailable');
    assert.equal(sent.length, 0);
  });

  it('supabase store maps RPC rows and falls back to memory when the SQL is missing', async () => {
    const backing = createMemoryStore();
    const calls = [];
    const client = {
      async rpc(name, args) {
        calls.push({ name, args });
        if (name === 'voice_wallet_alert_observe') {
          const out = await backing.observe({
            thresholds: args.p_thresholds,
            balanceMinor: args.p_balance_minor,
            observedAt: args.p_observed_at,
          });
          return {
            data: [
              ...out.rearmed.map((t) => ({ threshold_minor: String(t), action: 'rearmed' })),
              ...out.crossed.map((t) => ({ threshold_minor: String(t), action: 'crossed' })),
            ],
            error: null,
          };
        }
        if (name === 'voice_webhook_event_claim') {
          return { data: await backing.claimEvent(args.p_event_id), error: null };
        }
        return { data: null, error: null };
      },
    };
    const db = createSupabaseStore(client);
    const out = await db.observe({ thresholds: [50000, 10000], balanceMinor: 45000.4, source: 'poll' });
    assert.deepEqual(out, { crossed: [50000], rearmed: [] });
    assert.equal(calls[0].args.p_balance_minor, 45000);
    assert.equal(typeof calls[0].args.p_observed_at, 'string');
    assert.equal(await db.claimEvent('e1', 'wallet.low_balance'), true);
    assert.equal(await db.claimEvent('e1', 'wallet.low_balance'), false);

    // Missing function: production default path falls back to memory with a warning.
    const missing = createSupabaseStore({
      rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
    });
    await assert.rejects(
      missing.observe({ thresholds: [50000], balanceMinor: 1, source: 'poll' }),
      /Could not find the function/
    );
  });

  it('missing SQL objects: warns once and falls back to in-process state', async () => {
    setWalletLowBalanceStore(null);
    let rpcCalls = 0;
    setWalletLowBalanceDbClient({
      rpc: async () => {
        rpcCalls += 1;
        return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
      },
    });
    const logs = [];
    const orig = console.warn;
    console.warn = (...args) => logs.push(args.join(' '));
    try {
      const a = await observeWalletBalance({ balanceMinor: 45000, source: 'poll' });
      const b = await observeWalletBalance({ balanceMinor: 44000, source: 'poll' });
      assert.equal(a.alerted, true);
      assert.equal(b.alerted, false);
    } finally {
      console.warn = orig;
    }
    assert.equal(rpcCalls, 1);
    assert.equal(logs.filter((l) => l.includes('crossing state table missing')).length, 1);
    assert.equal(sent.length, 1);
  });

  it('setup script plans subscribe + threshold and never sends without --apply', () => {
    const { parseArgs, planRequests, redact } = require('../scripts/setup-wallet-low-balance-webhook');
    const opts = parseArgs(['--url', 'https://voice.example/voice/events']);
    assert.equal(opts.apply, false);
    const reqs = planRequests(opts, {});
    assert.deepEqual(
      reqs.map((r) => [r.method, r.url, r.body]),
      [
        ['POST', 'https://api.sautikit.com/v1/webhooks', { url: 'https://voice.example/voice/events', events: ['wallet.low_balance'] }],
        ['PATCH', 'https://api.sautikit.com/v1/wallet/threshold', { threshold_minor: 50000 }],
      ]
    );
    assert.throws(() => planRequests(parseArgs(['--url', 'http://insecure']), {}), /https/);
    assert.deepEqual(redact({ id: 'wh_1', signing_secret: 'x', nested: { api_key: 'y' } }), {
      id: 'wh_1',
      signing_secret: '[redacted]',
      nested: { api_key: '[redacted]' },
    });
  });

  it('isWalletEventKind matches wallet.* only', () => {
    assert.equal(isWalletEventKind('wallet.low_balance'), true);
    assert.equal(isWalletEventKind('Wallet.Top_Up'), true);
    assert.equal(isWalletEventKind('call.completed'), false);
    assert.equal(isWalletEventKind(''), false);
  });

  it('staff body has no vendor name', () => {
    const body = platformOpsWalletLowBody({ balanceMinor: 710, currency: 'KES', thresholdMinor: 10000 });
    assert.doesNotMatch(body, /sautikit/i);
    assert.match(body, /phone wallet is low/);
  });

  describe('signature guard on the wallet route', () => {
    let server;
    let base;
    beforeEach(async () => {
      const app = express();
      app.use(
        express.json({
          verify: (req, _res, buf) => {
            req.rawBody = buf.toString('utf8');
          },
        })
      );
      app.post('/voice/events', sautikitWebhookGuard, async (req, res) => {
        res.sendStatus(200);
        await handleWalletWebhookEvent({ headers: req.headers, body: req.body || {} });
      });
      server = http.createServer(app);
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${server.address().port}`;
    });
    afterEach(async () => {
      await new Promise((r) => server.close(r));
    });

    function sign(secret, raw, t = Math.floor(Date.now() / 1000)) {
      const v1 = crypto.createHmac('sha256', secret).update(`${raw}.${t}`).digest('hex');
      return `t=${t},v1=${v1}`;
    }

    it('rejects a bad signature and alerts on a good one', async () => {
      process.env.SAUTIKIT_VALIDATE_WEBHOOKS = 'true';
      process.env.SAUTIKIT_WEBHOOK_SECRET = 'whsec_test_only';
      const raw = JSON.stringify(walletEvent('evt_sig', 45000));
      const bad = await fetch(`${base}/voice/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sautikit-signature': sign('wrong', raw) },
        body: raw,
      });
      assert.equal(bad.status, 401);
      assert.equal(sent.length, 0);

      const good = await fetch(`${base}/voice/events`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sautikit-signature': sign('whsec_test_only', raw),
          'x-sautikit-event': 'wallet.low_balance',
        },
        body: raw,
      });
      assert.equal(good.status, 200);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(sent.length, 1);
    });
  });
});
