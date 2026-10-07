const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveLocalReply, planCallerModelTurn } = require('../src/conversation/turnPolicy');
const {
  createBrainState,
  observeCallerTurn,
  setNextBestAction,
} = require('../src/conversation/brainState');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');
const { drainSpokenSpeakSlots } = require('../src/conversation/speakSlots');

function profile(extra = {}) {
  return {
    vertical: 'home_services',
    servicesCatalog: extra.servicesCatalog || [
      { name: 'Carpet cleaning', price_range: 'Ksh 1500-2000' },
      { name: 'Sofa cleaning' },
    ],
    callerMemory: {
      name: 'Alvin',
      fileOwnerName: 'Alvin',
      sharedLine: false,
    },
  };
}

function turn(state, text, extra = {}) {
  const profile = extra.profile;
  return observeCallerTurn(state, {
    text,
    detectedLanguage: extra.language || 'en',
    resolvedLanguage: extra.language || 'en',
    profile,
    lastAgentText: extra.lastAgentText,
    entities: extractConversationEntities(text, { profile, state }),
  });
}

function confirm(state, text = 'Yes.', profile) {
  return turn(state, text, {
    profile,
    language: 'sw',
    lastAgentText: 'Je, naongea na Alvin?',
  });
}

describe('speak slots across name yes', () => {
  it('holds a file price through the name ask and speaks it after Yes', () => {
    const file = profile();
    let state = createBrainState(file);
    state = turn(state, 'Bei ya carpet cleaning', { profile: file, language: 'sw' });
    const price = resolveLocalReply({
      text: 'Bei ya carpet cleaning',
      state,
      profile: file,
      language: 'sw',
    });
    assert.equal(price.outcome, 'price');
    assert.equal(price.line, 'Carpet cleaning ni Ksh 1500-2000.');
    assert.deepEqual(state.conversation.speakSlots, [
      {
        outcome: 'price',
        line: 'Carpet cleaning ni Ksh 1500-2000.',
        language: 'sw',
      },
    ]);
    const gate = planCallerModelTurn(state);
    assert.equal(gate.runModel, false);
    assert.match(gate.line, /Alvin/);

    drainSpokenSpeakSlots(state, ['Je, naongea na Alvin?']);
    assert.equal(state.conversation.speakSlots.length, 1);

    state = confirm(state, 'eh, naongea na Alvin?', file);
    assert.equal(state.caller.nameJustConfirmed, true);
    assert.equal(state.conversation.speakSlots[0].outcome, 'price');
    const decision = determineNextBestAction({ state });
    assert.equal(decision.action, 'ANSWER');
    assert.notEqual(decision.action, 'END');
    assert.match(decision.reason, /file answer is still waiting/i);
    assert.match(decision.reason, /Do not end the call/);

    const resumed = resolveLocalReply({
      text: 'eh, naongea na Alvin?',
      state,
      profile: file,
      language: 'sw',
    });
    assert.equal(resumed.outcome, 'price');
    assert.equal(resumed.line, 'Carpet cleaning ni Ksh 1500-2000.');
    assert.deepEqual(state.conversation.speakSlots, []);
    const again = resolveLocalReply({
      text: 'eh, naongea na Alvin?',
      state,
      profile: file,
      language: 'sw',
    });
    assert.notEqual(again && again.outcome, 'price');
  });

  it('does not repeat a price Voice already drained', () => {
    const file = profile();
    let state = createBrainState(file);
    state = turn(state, 'How much is carpet cleaning?', { profile: file });
    const price = resolveLocalReply({
      text: 'How much is carpet cleaning?',
      state,
      profile: file,
      language: 'en',
    });
    drainSpokenSpeakSlots(state, [price.line, 'Am I speaking with Alvin?']);
    assert.deepEqual(state.conversation.speakSlots, []);
    state = confirm(state, 'Yes.', file);
    const resumed = resolveLocalReply({
      text: 'Yes.',
      state,
      profile: file,
      language: 'en',
    });
    assert.notEqual(resumed && resumed.outcome, 'price');
    const decision = determineNextBestAction({ state });
    assert.notEqual(decision.action, 'END');
  });

  it('keeps the catalogue slot and does not re-list after the list was answered', () => {
    const file = profile({
      servicesCatalog: [
        { name: 'Couch cleaning' },
        { name: 'Mattress cleaning' },
        { name: 'Carpet cleaning' },
        { name: 'General cleaning (houses & air bnbs)' },
      ],
    });
    let state = createBrainState(file);
    state = turn(state, 'Which services do you offer?', { profile: file });
    state = setNextBestAction(state, determineNextBestAction({ state }));
    assert.equal(state.conversation.catalogueAnswered, true);
    const listed = resolveLocalReply({
      text: 'Which services do you offer?',
      state,
      profile: file,
      language: 'en',
    });
    assert.equal(listed.outcome, 'catalogue');
    assert.equal(state.conversation.speakSlots[0].outcome, 'catalogue');
    assert.equal(state.conversation.speakSlots[0].language, 'en');
    assert.match(state.conversation.speakSlots[0].line, /Couch cleaning/);
    drainSpokenSpeakSlots(state, [listed.line]);
    assert.deepEqual(state.conversation.speakSlots, []);

    state = confirm(state, 'Yes.', file);
    const decision = determineNextBestAction({ state });
    assert.notEqual(decision.action, 'END');
    const resumed = resolveLocalReply({
      text: 'Yes.',
      state,
      profile: file,
      language: 'en',
    });
    assert.notEqual(resumed && resumed.outcome, 'catalogue');
  });

  it('stores hours, coverage, and service facts as speak slots', () => {
    const file = profile();
    let state = createBrainState(file);
    state = turn(state, 'Are you open?', { profile: file });
    const hours = resolveLocalReply({
      text: 'Are you open?',
      state,
      profile: file,
      language: 'en',
    });
    assert.equal(hours.outcome, 'hours_ask');
    assert.equal(state.conversation.speakSlots[0].outcome, 'hours_ask');
    assert.equal(state.conversation.speakSlots[0].language, 'en');
    assert.ok(state.conversation.speakSlots[0].line);

    state = turn(state, 'Do you cover Rongai?', { profile: file });
    const coverage = resolveLocalReply({
      text: 'Do you cover Rongai?',
      state,
      profile: file,
      language: 'en',
    });
    assert.equal(coverage.outcome, 'coverage');
    assert.equal(state.conversation.speakSlots.at(-1).outcome, 'coverage');
    assert.equal(state.conversation.speakSlots.at(-1).language, 'en');

    state = turn(state, 'Tell me more about carpet cleaning', { profile: file });
    const facts = resolveLocalReply({
      text: 'Tell me more about carpet cleaning',
      state,
      profile: file,
      language: 'en',
    });
    assert.equal(facts.outcome, 'service_facts');
    assert.equal(facts.line, 'Carpet cleaning is Ksh 1500-2000.');
    assert.equal(state.conversation.speakSlots.at(-1).outcome, 'service_facts');

    const empty = resolveLocalReply({
      text: 'Tell me more about sofa cleaning',
      state,
      profile: file,
      language: 'en',
    });
    assert.match(empty.line, /don't have more detail on file/i);
    assert.equal(
      state.conversation.speakSlots.some((slot) => /more detail/i.test(slot.line)),
      false
    );
  });
});
