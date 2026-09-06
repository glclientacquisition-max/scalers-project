const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  billableMinutesFromSeconds,
  canOriginateOutboundTransfer,
  planTransferLegCharges,
} = require('../src/billing/liveTransferLegs');

describe('live transfer billing legs', () => {
  it('meters inbound and outbound separately and skips unanswered outbound', () => {
    const plan = planTransferLegCharges({
      inboundDurationSeconds: 90,
      outboundDurationSeconds: 45,
      outboundStatus: 'complete',
    });
    assert.equal(plan.inbound.minutes, 1.5);
    assert.equal(plan.outbound.minutes, 0.8);
    assert.equal(plan.doNotFoldOutboundIntoInbound, true);

    const missed = planTransferLegCharges({
      inboundDurationSeconds: 40,
      outboundDurationSeconds: 25,
      outboundStatus: 'no_answer',
    });
    assert.equal(missed.inbound.minutes, 0.7);
    assert.equal(missed.outbound.minutes, 0);
  });

  it('does not originate outbound on beta unless the lab flag is on', () => {
    assert.equal(
      canOriginateOutboundTransfer({ billingEnforcement: 'off' }).reason,
      'beta_no_outbound'
    );
    const prev = process.env.VOICE_LIVE_TRANSFER_BETA_OUTBOUND;
    process.env.VOICE_LIVE_TRANSFER_BETA_OUTBOUND = 'on';
    try {
      assert.equal(
        canOriginateOutboundTransfer({ billingEnforcement: 'off' }).ok,
        true
      );
    } finally {
      if (prev == null) delete process.env.VOICE_LIVE_TRANSFER_BETA_OUTBOUND;
      else process.env.VOICE_LIVE_TRANSFER_BETA_OUTBOUND = prev;
    }
  });

  it('blocks hard-enforcement tenants who cannot cover one outbound minute', () => {
    const blocked = canOriginateOutboundTransfer({
      billingEnforcement: 'hard',
      walletBalanceKes: 0,
      rateKesPerMin: 15,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.reason, 'wallet_too_low');
    assert.equal(
      canOriginateOutboundTransfer({
        billingEnforcement: 'hard',
        walletBalanceKes: 40,
        rateKesPerMin: 15,
      }).ok,
      true
    );
    assert.equal(
      canOriginateOutboundTransfer({ billingEnforcement: 'soft', walletBalanceKes: 0 }).ok,
      true
    );
  });

  it('rounds duration to 0.1 minutes like inbound AI minutes', () => {
    assert.equal(billableMinutesFromSeconds(0), 0);
    assert.equal(billableMinutesFromSeconds(6), 0.1);
    assert.equal(billableMinutesFromSeconds(60), 1);
  });
});
