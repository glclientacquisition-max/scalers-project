const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { deriveCallSummary } = require('../src/conversation/callSummary');
const {
  createBrainState,
  observeCallerTurn,
  recordActionResults,
} = require('../src/conversation/brainState');

describe('deriveCallSummary', () => {
  it('builds desk summary from intent, products, and hold actions', () => {
    let state = observeCallerTurn(createBrainState(), {
      text: 'Hold The Smart Money Tribe for tomorrow at 5',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      entities: {
        product: {
          value: 'The Smart Money Tribe',
          source: 'tenant_product_catalog',
          confidence: 1,
          confirmed: true,
        },
        name: {
          value: 'Brian',
          source: 'caller_explicit',
          confidence: 0.95,
          confirmed: true,
        },
        when: {
          value: 'tomorrow at 5',
          source: 'caller_explicit',
          confidence: 0.9,
          confirmed: false,
        },
      },
    });
    state = recordActionResults(state, [
      {
        action: 'create_service_request',
        status: 'succeeded',
        requestType: 'hold',
        fingerprint: 'x',
        value: {
          type: 'hold',
          item: 'The Smart Money Tribe',
          whenText: 'Tomorrow at 5:00 PM',
          name: 'Brian',
        },
      },
    ]);

    const summary = deriveCallSummary({ brainState: state });
    assert.equal(summary.primaryIntent, 'hold_or_pickup');
    assert.match(summary.text, /hold_or_pickup|Hold/i);
    assert.ok(summary.products.includes('The Smart Money Tribe'));
    assert.ok(summary.actions.some((a) => /hold/i.test(a)));
    assert.ok(summary.instructions.some((i) => /5:00 PM/i.test(i)));
    assert.equal(summary.callerName, 'Brian');
  });

  it('ignores STT name/goal fragments and prefers human when handoff was requested', () => {
    let state = observeCallerTurn(createBrainState(), {
      text: 'I want to speak to the manager',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    state.intent = 'general_enquiry';
    state.handoff.requested = true;
    state.caller.name = "I'd like to discuss—";
    state.goal.description = 'uh-huh';

    const summary = deriveCallSummary({ brainState: state });
    assert.equal(summary.primaryIntent, 'human');
    assert.equal(summary.callerName, null);
    assert.doesNotMatch(summary.text, /uh-huh/i);
    assert.doesNotMatch(summary.text, /I'd like to discuss/i);
  });
});
