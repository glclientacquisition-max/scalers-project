const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { deriveInboxPurpose } = require('../src/conversation/inboxPurpose');
const { deriveCallResolution } = require('../src/conversation/callResolution');
const {
  createBrainState,
  inferIntent,
  recordActionResults,
} = require('../src/conversation/brainState');

describe('inbox purpose intelligence', () => {
  it('stamps a visit tool as job even when the caller first asked hours', () => {
    let state = createBrainState({ vertical: 'home_services' });
    state.intent = 'hours';
    state = recordActionResults(state, [
      {
        action: 'create_appointment',
        status: 'succeeded',
        value: { serviceName: 'Plumbing', whenText: 'Tue 10', landmark: 'Sarit' },
      },
    ]);
    const out = deriveCallResolution({ brainState: state });
    assert.equal(out.primaryIntent, 'book_visit');
    assert.equal(out.inboxPurpose, 'job');
    assert.equal(out.resolution, 'resolved');
  });

  it('stamps a hold tool as hold', () => {
    const purpose = deriveInboxPurpose({
      toolResults: [
        { action: 'create_service_request', status: 'succeeded', requestType: 'hold' },
      ],
    });
    assert.equal(purpose, 'hold');
  });

  it('stamps escalate as human', () => {
    assert.equal(
      deriveInboxPurpose({
        toolResults: [{ action: 'escalate', status: 'succeeded' }],
      }),
      'human'
    );
  });

  it('stamps hours as answered when resolved', () => {
    const state = createBrainState();
    state.intent = 'hours';
    state.resolution.status = 'resolved';
    assert.equal(deriveInboxPurpose({ brainState: state, resolution: 'resolved' }), 'answered');
  });

  it('stamps abandoned as missed', () => {
    assert.equal(deriveInboxPurpose({ resolution: 'abandoned' }), 'missed');
  });
});

describe('vertical live intent', () => {
  it('classifies a home visit ask as booking', () => {
    assert.equal(
      inferIntent('Can you come tomorrow to fix my sink?', { vertical: 'home_services' }),
      'booking'
    );
  });

  it('classifies a retail hold ask as hold', () => {
    assert.equal(
      inferIntent('Hold two bags I will pick up at 5', { vertical: 'retail' }),
      'hold'
    );
  });

  it('keeps bookstore book as product inquiry', () => {
    assert.equal(
      inferIntent('I recommend a book for me', { vertical: 'retail' }),
      'product_inquiry'
    );
  });
});
