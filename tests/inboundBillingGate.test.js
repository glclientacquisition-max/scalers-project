const { describe, it, beforeEach } = require('node:test');
const assert = require('assert');
const { classifyWalletResponse } = require('../src/sautikit/walletProbe');
const {
  snapshot,
  resetTelephonyProviderHealth,
  telephonyBillingRejectXml,
} = require('../src/sautikit/telephonyProviderHealth');

const REJECT_XML =
  '<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>';

describe('inbound telephony billing gate', () => {
  beforeEach(() => {
    resetTelephonyProviderHealth();
  });

  it('returns SautiKit Reject XML when the wallet probe marked billing exhausted', () => {
    snapshot({
      billingExhausted: true,
      balanceMinor: 0,
      currency: 'KES',
      message: 'telephony wallet empty',
    });
    assert.equal(telephonyBillingRejectXml(), REJECT_XML);
  });

  it('returns null when billing is healthy so incoming can still Stream', () => {
    snapshot({
      billingExhausted: false,
      balanceMinor: 50000,
      currency: 'KES',
      message: 'ok',
    });
    assert.equal(telephonyBillingRejectXml(), null);
  });

  it('does not reject after a probe HTTP 403', () => {
    const row = classifyWalletResponse(403, { message: 'forbidden' }, '');
    snapshot(row);
    assert.equal(row.billingExhausted, false);
    assert.equal(telephonyBillingRejectXml(), null);
  });

  it('rejects after an empty prepaid balance', () => {
    const row = classifyWalletResponse(
      200,
      { data: { currency: 'KES', balance_minor: 0 } },
      ''
    );
    snapshot(row);
    assert.equal(telephonyBillingRejectXml(), REJECT_XML);
  });

  it('rejects after a wallet 402', () => {
    const row = classifyWalletResponse(402, { message: 'payment required' }, '');
    snapshot(row);
    assert.equal(telephonyBillingRejectXml(), REJECT_XML);
  });
});
