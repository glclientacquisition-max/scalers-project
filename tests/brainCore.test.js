const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createBrainState,
  observeCallerTurn,
  setNextBestAction,
  recordRepairFailure,
  formatBrainStateForPrompt,
} = require('../src/conversation/brainState');
const {
  buildBrainCapabilities,
  authorizeAction,
  formatAuthorityPolicy,
} = require('../src/conversation/brainPolicy');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');

describe('Brain state and next-best-action', () => {
  it('resolves a simple hours goal without lead capture', () => {
    const capabilities = buildBrainCapabilities({
      agentTools: { escalate: true, end_call: true },
    });
    const state = observeCallerTurn(createBrainState(), {
      text: 'Are you open tomorrow?',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    const decision = determineNextBestAction({ state, capabilities });

    assert.equal(state.intent, 'hours');
    assert.equal(state.goal.primary, 'learn_business_hours');
    assert.equal(decision.action, 'ANSWER');
    assert.match(decision.reason, /direct resolution/i);
    assert.match(decision.reason, /before any capture or handoff/i);
  });

  it('collects the required name before routing an explicit human request', () => {
    const capabilities = buildBrainCapabilities(
      { agentTools: { escalate: true, end_call: true } },
      { liveTransfer: false }
    );
    let state = observeCallerTurn(createBrainState(), {
      text: 'I want to speak to the manager',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    let decision = determineNextBestAction({ state, capabilities });

    assert.equal(state.handoff.requested, true);
    assert.equal(decision.action, 'ASK_CLARIFICATION');
    assert.equal(decision.slot, 'name');

    state = observeCallerTurn(state, {
      text: 'My name is Kim',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      entities: {
        name: {
          value: 'Kim',
          source: 'caller_explicit',
          confidence: 0.95,
          confirmed: true,
        },
      },
    });
    decision = determineNextBestAction({ state, capabilities });
    assert.equal(decision.action, 'ESCALATE');
    assert.match(decision.reason, /live transfer is unavailable/i);
  });

  it('does not authorize a live transfer that has no executor', () => {
    const capabilities = buildBrainCapabilities(
      { agentTools: { escalate: true, end_call: true }, handoffMode: 'live_transfer' },
      { liveTransfer: false }
    );
    assert.equal(authorizeAction('TRANSFER', capabilities).allowed, false);
    assert.match(formatAuthorityPolicy(capabilities), /Live transfer: NOT AVAILABLE/);
  });

  it('escalates only after the repair threshold', () => {
    let state = observeCallerTurn(createBrainState(), {
      text: 'That is not what I mean',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    state = recordRepairFailure(recordRepairFailure(recordRepairFailure(state)));
    const decision = determineNextBestAction({
      state,
      capabilities: buildBrainCapabilities({
        agentTools: { escalate: true, end_call: true },
      }),
    });
    assert.equal(decision.action, 'ESCALATE');
    assert.match(decision.reason, /three repair attempts/i);
  });

  it('formats compact state for the per-turn prompt', () => {
    let state = observeCallerTurn(createBrainState({ vertical: 'retail' }), {
      text: 'How much is the HP printer?',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      entities: { product: 'HP printer' },
    });
    state = setNextBestAction(
      state,
      determineNextBestAction({
        state,
        capabilities: buildBrainCapabilities(),
      })
    );
    const block = formatBrainStateForPrompt(state);
    assert.match(block, /Intent: price/);
    assert.match(block, /product=HP printer/);
    assert.match(block, /NEXT BEST ACTION: ANSWER/);
  });

  it('does not treat the noun book as an appointment booking', () => {
    const recommend = observeCallerTurn(createBrainState(), {
      text: 'I recommend a book for me',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    assert.equal(recommend.intent, 'product_inquiry');

    const orderKids = observeCallerTurn(createBrainState(), {
      text: "I'd like to order children books",
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    assert.equal(orderKids.intent, 'order');

    const opening = observeCallerTurn(createBrainState(), {
      text: 'At what time are you opening tomorrow?',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    assert.equal(opening.intent, 'hours');
  });

  it('keeps meaningful intent across backchannels and ignores name fragments', () => {
    const {
      extractConversationEntities,
    } = require('../src/conversation/entityExtraction');
    let state = observeCallerTurn(createBrainState(), {
      text: 'Can you recommend a philosophy book?',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    assert.equal(state.intent, 'product_inquiry');
    assert.match(state.goal.description || '', /philosophy/i);

    state = observeCallerTurn(state, {
      text: 'uh-huh',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    assert.equal(state.intent, 'product_inquiry');

    let human = observeCallerTurn(createBrainState(), {
      text: 'I want to speak to the manager',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    human = observeCallerTurn(human, {
      text: "I'd like to discuss—",
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      entities: extractConversationEntities("I'd like to discuss—", {
        intent: 'human',
        state: human,
      }),
    });
    assert.equal(human.intent, 'human');
    assert.equal(human.caller.name, null);
  });
});
