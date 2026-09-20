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
    assert.match(summary.reason, /Brian left a hold/i);
    assert.match(summary.reason, /Smart Money Tribe/i);
    assert.doesNotMatch(summary.reason, /[\u2014\u2013]/);
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
    assert.match(summary.reason, /needs you to return the call/i);
  });

  it('keeps visit intent in the summary after a last-turn hours ask', () => {
    let state = observeCallerTurn(createBrainState(), {
      text: 'Are you open Saturday?',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    state.intent = 'hours';
    state = recordActionResults(state, [
      {
        action: 'create_appointment',
        status: 'succeeded',
        fingerprint: 'v1',
        value: {
          serviceName: 'Carpet cleaning',
          whenText: 'Saturday 9 to 11',
          name: 'Amina',
        },
        record: { service_name: 'Carpet cleaning' },
      },
    ]);
    const summary = deriveCallSummary({ brainState: state });
    assert.equal(summary.primaryIntent, 'book_visit');
    assert.equal(summary.reason, 'Visit request saved — confirm on desk.');
    assert.doesNotMatch(summary.reason, /booked a visit|book that for you/i);
    assert.doesNotMatch(summary.reason, /Carpet cleaning|Saturday/);
  });

  it('keeps confirmed visit language after Confirm', () => {
    const state = recordActionResults(createBrainState(), [
      {
        action: 'update_appointment',
        status: 'succeeded',
        appointmentStatus: 'confirmed',
        value: { serviceName: 'Carpet cleaning', whenText: 'Tuesday 10 AM' },
      },
    ]);
    const summary = deriveCallSummary({ brainState: state });
    assert.match(summary.reason, /updated a visit/i);
    assert.doesNotMatch(summary.reason, /Visit request saved/);
  });
});

describe('K1 exact hangup string source scan', () => {
  const fs = require('fs');
  const path = require('path');
  const exact = 'Visit request saved — confirm on desk.';
  const hangupFiles = [
    'src/conversation/callSummary.js',
    'src/conversation/callResolution.js',
    'src/conversation/callTranscriptReview.js',
  ];

  it('keeps the exact Product line and no booked-visit hangup copy', () => {
    for (const rel of hangupFiles) {
      const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
      assert.match(src, /VISIT_REQUESTED_NOTE|Visit request saved — confirm on desk\./);
      assert.doesNotMatch(src, /booked a visit/);
      assert.doesNotMatch(src, /book that for you/);
      const truncated = src.match(/Visit request saved(?![^`"]*— confirm on desk)/g) || [];
      assert.equal(
        truncated.length,
        0,
        `${rel} has truncated Visit request saved without confirm on desk`
      );
    }
  });

  it('exports the exact Product constant', () => {
    assert.equal(require('../src/conversation/callResolution').VISIT_REQUESTED_NOTE, exact);
  });
});
