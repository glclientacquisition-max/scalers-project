'use strict';
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const inserted = [];
let smsCalls = 0;
let smsImpl = async () => ({ messageId: 'm1' });

before(() => {
  const smsPath = require.resolve('../src/notifications/sms');
  const realSms = require('../src/notifications/sms');
  require.cache[smsPath].exports = {
    ...realSms,
    isSmsConfigured: () => true,
    sendSms: async (...a) => { smsCalls += 1; return smsImpl(...a); },
  };
  const dbPath = require.resolve('../src/db');
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: {
      findNotifySend: async () => null,
      consumeSmsUnits: async () => ({ allowed: true, reason: 'beta', overage: false }),
      insertNotifySend: async (row) => { inserted.push(row); return { ok: true, id: `n${inserted.length}` }; },
    },
  };
});

function textSms402() {
  const err = new Error('TextSMS send failed: http=402 code=1008 Transaction Declined: Insufficient credits. Required: 1 units.');
  err.status = 402; err.code = 1008;
  return err;
}

let dispatchCallerSms, resetSmsBackoff, isCreditExhausted, buildLedgerRow, idempotencyKey;
before(() => {
  ({ dispatchCallerSms } = require('../src/notifications/callerSms'));
  ({ resetSmsBackoff, isCreditExhausted } = require('../src/notifications/smsBackoff'));
  ({ buildLedgerRow, idempotencyKey } = require('../src/notifications/sendLedger'));
});

beforeEach(() => {
  inserted.length = 0; smsCalls = 0; smsImpl = async () => ({ messageId: 'm1' });
  resetSmsBackoff();
});

const ev = { kind: 'caller_callback', caller: { phone: '+254707222419' }, businessName: 'D&D' };
const channels = { caller_sms: true };
const ledger = (sid) => ({ tenantId: 't1', callSid: sid, callId: 'c1' });

describe('SMS 402/1008 (HD_4ec204aafa93)', () => {
  it('classifies TextSMS insufficient credits', () => {
    assert.equal(isCreditExhausted(textSms402()), true);
    assert.equal(isCreditExhausted({ status: 500, code: 1006 }), false);
  });

  it('writes a failed sms row, backs off the tenant and logs the ops notice once', async () => {
    smsImpl = async () => { throw textSms402(); };
    const errs = []; const orig = console.error; console.error = (...a) => errs.push(a.join(' '));
    try {
      const a = await dispatchCallerSms({ to: '+254707222419', event: ev, channels, ledger: ledger('HD_a') });
      assert.equal(a.channel, null);
      assert.equal(a.reason, 'sms_credits_exhausted');
      const b = await dispatchCallerSms({ to: '+254707222419', event: { ...ev, kind: 'caller_appointment' }, channels, ledger: ledger('HD_a') });
      assert.equal(b.reason, 'sms_credit_backoff');
    } finally { console.error = orig; }
    assert.equal(smsCalls, 1, 'second event never hits the provider');
    assert.equal(inserted.length, 2);
    assert.equal(inserted[0].channel, 'sms');
    assert.equal(inserted[0].status, 'failed');
    assert.match(inserted[0].error, /402/);
    assert.match(inserted[0].idempotency_key, /:failed:/);
    assert.equal(inserted[1].error, 'sms_credit_backoff');
    assert.equal(errs.filter((e) => e.includes('credits exhausted')).length, 1);
  });

  it('other tenants are not backed off', async () => {
    smsImpl = async () => { throw textSms402(); };
    const orig = console.error; console.error = () => {};
    try { await dispatchCallerSms({ to: '+254707222419', event: ev, channels, ledger: ledger('HD_b') }); } finally { console.error = orig; }
    smsImpl = async () => ({ messageId: 'ok' });
    const out = await dispatchCallerSms({ to: '+254707222419', event: ev, channels, ledger: { tenantId: 't2', callSid: 'HD_c', callId: 'c2' } });
    assert.equal(out.channel, 'sms');
    assert.equal(inserted[inserted.length - 1].status, 'sent');
  });

  it('non-billing errors are recorded and still thrown', async () => {
    smsImpl = async () => { const e = new Error('TextSMS send failed: http=500'); e.status = 500; throw e; };
    await assert.rejects(dispatchCallerSms({ to: '+254707222419', event: ev, channels, ledger: ledger('HD_d') }));
    assert.equal(inserted[0].status, 'failed');
  });

  it('a failed row key never equals the delivered key', () => {
    const row = buildLedgerRow({ tenantId: 't', callSid: 'HD_x', kind: 'caller_callback', channel: 'sms', to: '+254700000000', status: 'failed', error: 'x' });
    const plain = idempotencyKey({ tenantId: 't', callSid: 'HD_x', kind: 'caller_callback', channel: 'sms', to: '+254700000000' });
    assert.notEqual(row.idempotency_key, plain);
    assert.ok(row.idempotency_key.startsWith(plain));
  });
});
