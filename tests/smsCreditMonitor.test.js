// Run: node --test tests/smsCreditMonitor.test.js
// Never hits TextSMS: every fetch is mocked and send transports are stubbed.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const ENV_KEYS = [
  'TEXTSMS_API_KEY', 'TEXTSMS_PARTNER_ID', 'TEXTSMS_SHORTCODE', 'TEXTSMS_SEND_DISABLED',
  'SMS_CREDIT_WARN_BELOW', 'SMS_CREDIT_CRITICAL_AT', 'SMS_CREDIT_PROBE_MS',
  'VOICE_PLATFORM_OPS_DRY_RUN', 'SCALERS_OPS_ALERT_EMAILS',
];
const saved = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

const mon = require('../src/notifications/smsCreditMonitor');
const { sendSms } = require('../src/notifications/sms');

function balanceFetch(balance, calls) {
  return async (url, init) => {
    calls?.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ 'response-code': 200, credit: balance }),
    };
  };
}

describe('smsCreditMonitor', () => {
  let tg;
  let mail;
  beforeEach(() => {
    mon.resetSmsCreditMonitor();
    process.env.TEXTSMS_API_KEY = 'test-key';
    process.env.TEXTSMS_PARTNER_ID = '1';
    process.env.TEXTSMS_SHORTCODE = 'TEST';
    process.env.SCALERS_OPS_ALERT_EMAILS = 'ops@scalers.co.ke';
    delete process.env.VOICE_PLATFORM_OPS_DRY_RUN;
    delete process.env.SMS_CREDIT_WARN_BELOW;
    delete process.env.SMS_CREDIT_CRITICAL_AT;
    delete process.env.SMS_CREDIT_PROBE_MS;
    tg = [];
    mail = [];
    mon.setSmsCreditAlertTransports({
      telegram: async (text) => { tg.push(text); return { ok: true }; },
      dispatch: async (args) => { mail.push(args); return { sent: [{ channel: 'email' }], errors: [] }; },
    });
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('classifies thresholds (warn <100, critical <=20, exhausted <=0)', () => {
    assert.equal(mon.classifySmsCredit(500), 'ok');
    assert.equal(mon.classifySmsCredit(100), 'ok');
    assert.equal(mon.classifySmsCredit(99), 'warn');
    assert.equal(mon.classifySmsCredit(20), 'critical');
    assert.equal(mon.classifySmsCredit(1), 'critical');
    assert.equal(mon.classifySmsCredit(0), 'exhausted');
    assert.equal(mon.classifySmsCredit(null), 'unknown');
  });

  it('thresholds are configurable via env', () => {
    process.env.SMS_CREDIT_WARN_BELOW = '500';
    process.env.SMS_CREDIT_CRITICAL_AT = '50';
    assert.equal(mon.classifySmsCredit(400), 'warn');
    assert.equal(mon.classifySmsCredit(50), 'critical');
  });

  it('probe interval defaults to 45 min and clamps to 30–60 min', () => {
    assert.equal(mon.smsCreditProbeIntervalMs(), 45 * 60_000);
    process.env.SMS_CREDIT_PROBE_MS = String(60_000);
    assert.equal(mon.smsCreditProbeIntervalMs(), 30 * 60_000);
    process.env.SMS_CREDIT_PROBE_MS = String(5 * 3_600_000);
    assert.equal(mon.smsCreditProbeIntervalMs(), 60 * 60_000);
  });

  it('estimates runway from burn and resets window on top-up', () => {
    const d = 86_400_000;
    assert.equal(mon.estimateRunwayDays([{ at: 0, balance: 100 }, { at: d, balance: 60 }], 60), 1.5);
    const topped = [{ at: 0, balance: 10 }, { at: d, balance: 0 }, { at: 2 * d, balance: 1000 }];
    assert.equal(mon.estimateRunwayDays(topped, 1000), null);
    assert.equal(mon.estimateRunwayDays([], 0), 0);
  });

  it('probe only calls getbalance, never sendsms', async () => {
    const calls = [];
    const r = await mon.runSmsCreditCheck({ fetchImpl: balanceFetch(500, calls) });
    assert.equal(r.level, 'ok');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /getbalance/);
    assert.equal(calls[0].body.mobile, undefined);
    assert.equal(tg.length + mail.length, 0);
  });

  it('alerts once per level via Telegram + email and escalates', async () => {
    await mon.runSmsCreditCheck({ fetchImpl: balanceFetch(80) });
    await mon.runSmsCreditCheck({ fetchImpl: balanceFetch(70) });
    assert.equal(tg.length, 1);
    assert.equal(mail.length, 1);
    assert.deepEqual(mail[0].channels, { sms: false, whatsapp: false, email: true });
    await mon.runSmsCreditCheck({ fetchImpl: balanceFetch(10) });
    assert.equal(tg.length, 2);
    assert.match(tg[1], /critical/);
    // Recovery clears the latch; next drop alerts again.
    await mon.runSmsCreditCheck({ fetchImpl: balanceFetch(2000) });
    await mon.runSmsCreditCheck({ fetchImpl: balanceFetch(50) });
    assert.equal(tg.length, 3);
  });

  it('healthz block has no secrets', async () => {
    await mon.runSmsCreditCheck({ fetchImpl: balanceFetch(42) });
    const h = mon.getSmsCreditHealth();
    assert.equal(h.balance, 42);
    assert.equal(h.state, 'warn');
    for (const k of ['configured', 'verified', 'balance', 'checkedAt', 'state', 'runwayDays']) {
      assert.ok(k in h, k);
    }
    assert.ok(!JSON.stringify(h).includes('test-key'));
  });

  it('DRY_RUN logs but sends nothing', async () => {
    process.env.VOICE_PLATFORM_OPS_DRY_RUN = 'true';
    const r = await mon.runSmsCreditCheck({ fetchImpl: balanceFetch(0) });
    assert.equal(r.alert.channel, 'dry_run');
    assert.equal(tg.length + mail.length, 0);
  });

  it('402 code 1008 marks exhausted and alerts', async () => {
    await mon.noteSmsCreditExhausted({ status: 402, code: 1008, description: 'Insufficient credits' });
    assert.equal(mon.getSmsCreditHealth().state, 'exhausted');
    assert.equal(tg.length, 1);
    assert.match(tg[0], /exhausted/);
  });

  it('TEXTSMS_SEND_DISABLED blocks real sends before any fetch', async () => {
    process.env.TEXTSMS_SEND_DISABLED = 'true';
    const realFetch = global.fetch;
    let fetched = 0;
    global.fetch = async () => { fetched += 1; throw new Error('no'); };
    try {
      await assert.rejects(sendSms({ to: '0740442943', body: 'hi' }), /disabled/);
      assert.equal(fetched, 0);
    } finally {
      global.fetch = realFetch;
    }
  });
});
