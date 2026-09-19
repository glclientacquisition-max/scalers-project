// Run: node --test tests/sendLedger.test.js
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  audience,
  billedTo,
  buildLedgerRow,
  beginInstanceSend,
  claimInstanceFlight,
  idempotencyKey,
  instanceFlightKey,
  allowanceDecision,
  releaseInstanceFlight,
  resetInstanceFlights,
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
    assert.equal(billedTo('caller_hold_ready'), 'tenant');
    assert.equal(billedTo('caller_hold_cancelled'), 'tenant');
    assert.equal(billedTo('caller_appointment_confirmed'), 'tenant');
    assert.equal(billedTo('missed_textback'), 'tenant');
    assert.equal(billedTo('caller_note'), 'tenant');
    assert.equal(billedTo('wallet_low'), 'platform');
    assert.equal(billedTo('wallet_empty'), 'platform');
    assert.equal(billedTo('outage_speech'), 'platform');
    assert.equal(billedTo('outage_llm'), 'platform');
    assert.equal(audience('caller_hold'), 'caller');
    assert.equal(audience('caller_hold_ready'), 'caller');
    assert.equal(audience('caller_hold_cancelled'), 'caller');
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

  it('reuses the same cap math for email overage and seat hard caps', () => {
    assert.deepEqual(
      allowanceDecision({
        enforcement: 'soft',
        included: 100,
        used: 100,
        units: 1,
        onDemand: true,
        overageAllowed: true,
        exhaustedReason: 'email_allowance_exhausted',
      }),
      { allowed: true, reason: 'on_demand', overage: true, remaining: -1 }
    );
    assert.deepEqual(
      allowanceDecision({
        enforcement: 'soft',
        included: 5,
        used: 5,
        units: 1,
        onDemand: true,
        overageAllowed: false,
        exhaustedReason: 'seat_allowance_exhausted',
      }),
      { allowed: false, reason: 'seat_allowance_exhausted', overage: false, remaining: 0 }
    );
  });
});

function stubDb(exports) {
  const dbPath = require.resolve('../src/db');
  const prev = require.cache[dbPath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports,
  };
  return () => {
    if (prev) require.cache[dbPath] = prev;
    else delete require.cache[dbPath];
  };
}

describe('per-instance send limits', () => {
  const ledger = {
    tenantId: 't1',
    callSid: 'HD_abc',
    callId: 'call-1',
    kind: 'lead',
  };

  beforeEach(() => {
    resetInstanceFlights();
  });

  afterEach(() => {
    resetInstanceFlights();
  });

  it('is a no-op without a tenant or dest', async () => {
    const none = await beginInstanceSend({}, '254711000000');
    assert.equal(none.ok, true);
    assert.equal(none.key, null);
    const noDest = await beginInstanceSend(ledger, '');
    assert.equal(noDest.ok, true);
  });

  it('blocks a second in-flight send to the same dest on the same call', async () => {
    const restore = stubDb({
      findNotifySend: async () => null,
    });
    try {
      const first = await beginInstanceSend(ledger, '254711000000');
      assert.equal(first.ok, true);
      const again = await beginInstanceSend(ledger, '+254711000000');
      assert.equal(again.ok, false);
      assert.equal(again.reason, 'instance_in_flight');
      releaseInstanceFlight(first.key);
      const after = await beginInstanceSend(ledger, '254711000000');
      assert.equal(after.ok, true);
      releaseInstanceFlight(after.key);
    } finally {
      restore();
    }
  });

  it('lets inbox fan-out to two dests on the same call', async () => {
    const restore = stubDb({
      findNotifySend: async () => null,
    });
    try {
      const a = await beginInstanceSend(ledger, '254711000000');
      const b = await beginInstanceSend(ledger, '254722000000');
      assert.equal(a.ok, true);
      assert.equal(b.ok, true);
      assert.notEqual(a.key, b.key);
      releaseInstanceFlight(a.key);
      releaseInstanceFlight(b.key);
    } finally {
      restore();
    }
  });

  it('skips a second hold ready SMS on the same call dest without consuming SMS', async () => {
    let consumed = 0;
    const restore = stubDb({
      findNotifySend: async () => ({ id: 'ready-1' }),
      consumeSmsUnits: async () => {
        consumed += 1;
        return { allowed: true, reason: 'included', overage: false };
      },
    });
    try {
      const gate = await beginInstanceSend(
        { tenantId: 't1', callId: 'c1', kind: 'caller_hold_ready' },
        '254711000000'
      );
      assert.equal(gate.ok, false);
      assert.equal(gate.reason, 'instance_already_sent');
      assert.equal(consumed, 0);
    } finally {
      restore();
    }
  });

  it('skips when any channel already delivered, without consuming SMS', async () => {
    let consumed = 0;
    const restore = stubDb({
      findNotifySend: async () => ({ id: 'row-1' }),
      consumeSmsUnits: async () => {
        consumed += 1;
        return { allowed: true, reason: 'included', overage: false };
      },
    });
    try {
      const gate = await beginInstanceSend(ledger, '254711000000');
      assert.equal(gate.ok, false);
      assert.equal(gate.reason, 'instance_already_sent');
      assert.equal(consumed, 0);
      assert.equal(claimInstanceFlight(ledger, '254711000000').ok, true);
    } finally {
      restore();
    }
  });

  it('treats phone and email as one instance so a ladder retry cannot add a channel', async () => {
    const restore = stubDb({
      findNotifySend: async ({ idempotencyKey: key }) =>
        String(key).includes('email:owner@example.com') ? { id: 'mail-1' } : null,
    });
    try {
      const gate = await beginInstanceSend(ledger, [
        '254711000000',
        'owner@example.com',
      ]);
      assert.equal(gate.ok, false);
      assert.equal(gate.reason, 'instance_already_sent');
    } finally {
      restore();
    }
  });

  it('keys the same dest with or without plus', () => {
    assert.equal(
      instanceFlightKey(ledger, '+254711000000'),
      instanceFlightKey(ledger, '254711000000')
    );
  });

  it('dispatchAlert returns instance_in_flight and does not send', async () => {
    const restore = stubDb({
      findNotifySend: async () => null,
    });
    try {
      const { dispatchAlert } = require('../src/notifications/dispatch');
      const first = await beginInstanceSend(ledger, '254711000000');
      assert.equal(first.ok, true);
      const result = await dispatchAlert({
        to: '254711000000',
        body: 'New lead',
        ledger,
      });
      assert.equal(result.channel, null);
      assert.equal(result.reason, 'instance_in_flight');
      releaseInstanceFlight(first.key);
    } finally {
      restore();
    }
  });
});
