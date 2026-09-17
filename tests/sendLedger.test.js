// Run: node --test tests/sendLedger.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  audience,
  billedTo,
  buildLedgerRow,
  idempotencyKey,
  smsAllowanceDecision,
  smsSegments,
} = require('../src/notifications/sendLedger');
const {
  shouldSendOwnerLead,
  staffInboxAlreadyNotified,
} = require('../src/notifications/events');

describe('notify send ledger', () => {
  it('bills staff and caller SMS to the tenant, wallet and outage to Scalers', () => {
    assert.equal(billedTo('lead'), 'tenant');
    assert.equal(billedTo('escalation'), 'tenant');
    assert.equal(billedTo('service_request'), 'tenant');
    assert.equal(billedTo('appointment'), 'tenant');
    assert.equal(billedTo('caller_hold'), 'tenant');
    assert.equal(billedTo('caller_appointment_confirmed'), 'tenant');
    assert.equal(billedTo('missed_textback'), 'tenant');
    assert.equal(billedTo('caller_note'), 'tenant');
    assert.equal(billedTo('wallet_low'), 'platform');
    assert.equal(billedTo('wallet_empty'), 'platform');
    assert.equal(billedTo('outage_speech'), 'platform');
    assert.equal(billedTo('outage_llm'), 'platform');
    assert.equal(audience('caller_hold'), 'caller');
    assert.equal(audience('missed_textback'), 'caller');
    assert.equal(audience('lead'), 'staff');
    assert.equal(audience('wallet_low'), 'staff');
  });

  it('counts GSM segments at 160, concatenated at 153', () => {
    assert.equal(smsSegments('Hi'), 1);
    assert.equal(smsSegments('a'.repeat(160)), 1);
    assert.equal(smsSegments('a'.repeat(161)), 2);
    assert.equal(smsSegments('a'.repeat(306)), 2);
    assert.equal(smsSegments('a'.repeat(307)), 3);
  });

  it('counts UCS-2 segments when the body has non-ASCII', () => {
    assert.equal(smsSegments('Habari'), 1);
    assert.equal(smsSegments('Asante sana\u{1F44B}'), 1);
    assert.equal(smsSegments(`${'é'.repeat(70)}`), 1);
    assert.equal(smsSegments(`${'é'.repeat(71)}`), 2);
  });

  it('builds a tenant SMS row with an idempotency key per call dest', () => {
    const row = buildLedgerRow({
      tenantId: 't1',
      callSid: 'HD_abc',
      kind: 'lead',
      channel: 'sms',
      to: '+254711000000',
      body: 'New missed-call lead. Aris Kenya\nName: James',
      providerMessageId: 'm1',
    });
    assert.equal(row.billed_to, 'tenant');
    assert.equal(row.audience, 'staff');
    assert.equal(row.units, 1);
    assert.equal(row.idempotency_key, idempotencyKey({
      tenantId: 't1',
      callSid: 'HD_abc',
      kind: 'lead',
      channel: 'sms',
      to: '+254711000000',
    }));
    assert.equal(
      row.idempotency_key,
      idempotencyKey({
        tenantId: 't1',
        callSid: 'HD_abc',
        kind: 'lead',
        channel: 'sms',
        to: '254711000000',
      })
    );
  });

  it('skips a second lead when a visit or hold staff SMS already went', () => {
    assert.equal(staffInboxAlreadyNotified({}), false);
    assert.equal(staffInboxAlreadyNotified({ whatsapp_sent: true }), true);
    assert.equal(
      staffInboxAlreadyNotified({ owner_notify_kind: 'appointment' }),
      true
    );
    assert.equal(
      staffInboxAlreadyNotified({ owner_notify_kind: 'service_request' }),
      true
    );
    assert.equal(shouldSendOwnerLead({
      name: 'Jane',
      reason: 'Book carpet cleaning',
    }), true);
  });

  it('stops tenant SMS at included unless on-demand; beta never blocks', () => {
    assert.deepEqual(
      smsAllowanceDecision({
        enforcement: 'off',
        included: 200,
        used: 500,
        units: 2,
        onDemand: false,
      }),
      { allowed: true, reason: 'beta', overage: false, remaining: -302 }
    );
    assert.deepEqual(
      smsAllowanceDecision({
        enforcement: 'soft',
        included: 200,
        used: 199,
        units: 1,
        onDemand: false,
      }),
      { allowed: true, reason: 'included', overage: false, remaining: 0 }
    );
    assert.deepEqual(
      smsAllowanceDecision({
        enforcement: 'hard',
        included: 200,
        used: 200,
        units: 1,
        onDemand: false,
      }),
      { allowed: false, reason: 'sms_allowance_exhausted', overage: false, remaining: 0 }
    );
    assert.deepEqual(
      smsAllowanceDecision({
        enforcement: 'soft',
        included: 200,
        used: 200,
        units: 1,
        onDemand: true,
      }),
      { allowed: true, reason: 'on_demand', overage: true, remaining: -1 }
    );
    assert.deepEqual(
      smsAllowanceDecision({
        enforcement: 'soft',
        included: 0,
        used: 0,
        units: 1,
        onDemand: false,
      }),
      { allowed: false, reason: 'sms_allowance_exhausted', overage: false, remaining: 0 }
    );
    assert.equal(
      smsAllowanceDecision({
        enforcement: 'soft',
        included: null,
        used: 0,
        units: 1,
        onDemand: false,
      }).reason,
      'unlimited'
    );
  });

  it('marks overage on the ledger row', () => {
    const row = buildLedgerRow({
      tenantId: 't1',
      kind: 'lead',
      channel: 'sms',
      to: '254711000000',
      body: 'Hi',
      overage: true,
    });
    assert.equal(row.overage, true);
    assert.equal(billedTo('wallet_low'), 'platform');
  });
});
