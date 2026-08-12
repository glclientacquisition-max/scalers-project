const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  deriveCallResolution,
  parseResolution,
} = require('../src/conversation/callResolution');
const { createBrainState, recordActionResults } = require('../src/conversation/brainState');

describe('deriveCallResolution', () => {
  it('marks succeeded holds as resolved', () => {
    let state = createBrainState();
    state.intent = 'hold_or_pickup';
    state = recordActionResults(state, [
      {
        action: 'create_service_request',
        status: 'succeeded',
        requestType: 'hold',
        fingerprint: 'x',
      },
    ]);
    const out = deriveCallResolution({ brainState: state });
    assert.equal(out.resolution, 'resolved');
    assert.equal(out.primaryIntent, 'hold_or_pickup');
    assert.match(out.resolutionNote || '', /hold/i);
  });

  it('marks escalation as needs_human', () => {
    const out = deriveCallResolution({
      brainState: createBrainState(),
      toolResults: [{ action: 'escalate', status: 'succeeded' }],
    });
    assert.equal(out.resolution, 'needs_human');
  });

  it('marks very short calls as abandoned', () => {
    const out = deriveCallResolution({
      brainState: createBrainState(),
      turnCount: 1,
    });
    assert.equal(out.resolution, 'abandoned');
  });

  it('parseResolution accepts known values only', () => {
    assert.equal(parseResolution('resolved'), 'resolved');
    assert.equal(parseResolution('nope'), null);
  });
});
