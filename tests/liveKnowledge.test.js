const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildLiveGroundTruth } = require('../src/conversation/liveKnowledge');

describe('buildLiveGroundTruth business operating model', () => {
  it('injects vertical, handoff, locations, and policies', () => {
    const text = buildLiveGroundTruth({
      vertical: 'retail',
      handoffMode: 'callback',
      businessLocations: [
        {
          label: 'Main shop',
          address: 'Westlands',
          landmark: 'Opposite Naivas',
          directions: 'From Waiyaki Way turn at Shell',
          coverage_notes: '',
        },
      ],
      businessPolicies: {
        payment: 'M-Pesa and cash',
        returns: '7 days with receipt',
        delivery: '',
        deposit: '',
        cancellation: '',
        warranty: '',
        other: '',
      },
      servicesCatalog: [{ name: 'Phone charger', price_range: 'from 500' }],
      faqs: [],
      teamDirectory: [],
      agentTools: { escalate: true, end_call: true },
    });

    assert.match(text, /BUSINESS VERTICAL: retail/);
    assert.match(text, /HANDOFF MODE: callback/);
    assert.match(text, /Opposite Naivas/);
    assert.match(text, /From Waiyaki Way turn at Shell/);
    assert.match(text, /Payment: M-Pesa and cash/);
    assert.match(text, /Returns \/ exchanges: 7 days with receipt/);
    assert.match(text, /Phone charger/);
    assert.match(text, /Resolve the caller's request/);
  });

  it('mentions live_transfer fallback guidance', () => {
    const text = buildLiveGroundTruth({
      vertical: 'home_services',
      handoffMode: 'live_transfer',
      businessLocations: [{ label: 'Depot', address: 'Industrial Area' }],
      servicesCatalog: [{ name: 'Plumbing' }],
      agentTools: { escalate: false, end_call: true },
    });
    assert.match(text, /HANDOFF MODE: live_transfer/);
    assert.match(text, /transfer is unavailable/);
  });
});
