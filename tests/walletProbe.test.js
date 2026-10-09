const { describe, it, beforeEach } = require('node:test');
const assert = require('assert');
const {
  classifyWalletResponse,
  probeSautikitWallet,
} = require('../src/sautikit/walletProbe');
const { resetTelephonyProviderHealth } = require('../src/sautikit/telephonyProviderHealth');
const { resetWalletLowBalance } = require('../src/sautikit/walletLowBalance');
const {
  resetPlatformOpsAlert,
  setPlatformOpsDispatch,
} = require('../src/notifications/platformOpsAlert');

describe('walletProbe', () => {
  beforeEach(() => {
    resetTelephonyProviderHealth();
    resetPlatformOpsAlert();
    resetWalletLowBalance();
  });

  it('classifies empty wallet as telephony billing exhausted', () => {
    const row = classifyWalletResponse(200, { data: { currency: 'KES', balance_minor: 0 } }, '');
    assert.equal(row.billingExhausted, true);
  });

  it('classifies 402 as billing exhausted', () => {
    const row = classifyWalletResponse(402, { message: 'payment required' }, '');
    assert.equal(row.billingExhausted, true);
  });

  it('probes wallet and alerts ops on first empty balance', async () => {
    let alerted = 0;
    let walletLow = 0;
    setPlatformOpsDispatch(async ({ ledger }) => {
      if (ledger.kind === 'platform_ops_wallet') walletLow += 1;
      else alerted += 1;
      return { sent: [{ channel: 'email' }], errors: [] };
    });
    process.env.SCALERS_OPS_ALERT_EMAILS = 'ops@scalers.co.ke';
    const fetchImpl = async () => ({
      status: 200,
      text: async () => JSON.stringify({ data: { currency: 'KES', balance_minor: 0 } }),
    });
    const result = await probeSautikitWallet({
      apiKey: 'test-key',
      fetchImpl,
    });
    assert.equal(result.billingExhausted, true);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(alerted, 1);
    // Empty is also under the lowest low-balance threshold: one wallet notice.
    assert.equal(walletLow, 1);
    assert.equal(result.lowBalance.alerted, true);
  });
});
