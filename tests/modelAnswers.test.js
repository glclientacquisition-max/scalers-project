const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const { resolveLocalReply } = require('../src/conversation/turnPolicy');
const { planEmptyGeminiSpeech } = require('../src/conversation/dynamicSpeech');

const shared = {
  name: 'Amina',
  sharedLine: true,
  greetByName: false,
  alternateNames: ['Brian'],
  lastReason: 'carpet Thursday',
  nextAppointment: 'carpet, Thursday 10 AM',
  recentBookings: ['couch cleaning, 3 March'],
};

function turn(text, card = shared) {
  return observeCallerTurn(createBrainState({ callerMemory: card }), {
    text,
    detectedLanguage: 'en',
    resolvedLanguage: 'en',
    profile: { callerMemory: card },
  });
}

describe('the model answers human turns', () => {
  it('does not speak a local line for how are you or okay', () => {
    const how = resolveLocalReply({
      text: 'How are you doing?',
      state: turn('How are you doing?'),
      profile: { callerMemory: shared },
      language: 'en',
    });
    assert.equal(how, null);

    const okay = resolveLocalReply({
      text: 'Okay.',
      state: turn('Okay.'),
      language: 'en',
    });
    assert.equal(okay, null);
  });

  it('still speaks a fixed identity line', () => {
    const who = resolveLocalReply({
      text: 'Who are you?',
      state: createBrainState(),
      language: 'en',
      agentName: 'Shy',
      businessName: 'Done and Dusted',
    });
    assert.equal(who.outcome, 'identity');
    assert.match(who.line, /Shy/);
    assert.match(who.line, /Done and Dusted/);
  });

  it('answers how are you on a shared line without a who-is-speaking order', () => {
    const state = turn('How are you doing?');
    const decision = determineNextBestAction({
      state,
      capabilities: { saveCallerInfo: true },
    });
    assert.equal(decision.action, 'ANSWER');
    assert.notEqual(decision.slot, 'name');
    assert.match(decision.reason, /Do not ask who is speaking/i);
    assert.match(decision.reason, /Do not list services/i);
  });

  it('answers which bookings without reading an unbound file', () => {
    const state = turn('Which bookings do you have?');
    const decision = determineNextBestAction({
      state,
      capabilities: { saveCallerInfo: true, createAppointment: true },
    });
    assert.equal(state.caller.name, null);
    assert.equal(decision.action, 'ANSWER');
    assert.notEqual(decision.slot, 'name');
    assert.match(decision.reason, /Do not use the file name/i);
    assert.match(decision.reason, /Do not list services/i);
    assert.doesNotMatch(decision.reason, /Ask who is speaking/i);
  });

  it('asks them to repeat once when Gemini speaks nothing, and keeps the outage line', () => {
    const first = planEmptyGeminiSpeech({
      nextBestAction: { action: 'ANSWER' },
      brainState: { caller: { name: 'Alvin' } },
      language: 'en',
      userText: "Yeah, I'm Alvin.",
      llmDown: false,
      alreadyOffered: false,
    });
    assert.equal(first.speak, true);
    assert.equal(first.kind, 'hear_again');
    assert.equal(first.line, 'Sorry, say that again?');
    assert.doesNotMatch(first.line, /can't finish|reach them|who is speaking/i);

    const second = planEmptyGeminiSpeech({
      language: 'en',
      llmDown: false,
      alreadyOffered: true,
    });
    assert.equal(second.speak, false);
    assert.equal(second.line, '');

    const outage = planEmptyGeminiSpeech({
      language: 'en',
      userText: 'Can you tell me whether the shop is open tomorrow morning?',
      llmDown: true,
      alreadyOffered: false,
    });
    assert.equal(
      outage.line,
      "Okay, I can't finish that just now. May I have your name so I can reach them?"
    );
  });
});
