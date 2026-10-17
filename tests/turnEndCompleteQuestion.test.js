const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  utteranceLooksIncomplete,
  isStrandedPrepositionQuestion,
  looksLikeCompleteQuestion,
  adaptiveFlushMs,
  decideTurnEnd,
  COMPLETE_QUESTION_FLUSH_MS,
} = require('../src/speech/turnTaking');
const { callerTurnStillOpen } = require('../src/conversation/entityExtraction');

describe('stranded-preposition questions are complete', () => {
  for (const text of [
    'Uh, what do you guys deal with?',
    'Who am I speaking to?',
    'Where are you from?',
    "What's this for?",
    'Which branch should I go to?',
    'What kind of pens do you deal in?',
  ]) {
    it(text, () => {
      assert.equal(isStrandedPrepositionQuestion(text), true);
      assert.equal(utteranceLooksIncomplete(text), false);
      assert.equal(callerTurnStillOpen(text), false);
      assert.notEqual(decideTurnEnd({ text, waitedMs: 0 }).reason, 'unfinished');
    });
  }
});

describe('fragments still wait (no mid-sentence cut)', () => {
  for (const text of [
    'Uh, how much for',
    'How much for?',
    'Can I pay with?',
    'what do you deal with',
    'I want to book and',
    'Nataka kuongea na',
    'Mnauza kwa',
    'my name is',
  ]) {
    it(text, () => {
      assert.equal(looksLikeCompleteQuestion(text), false);
    });
  }
  it('trailing conjunction keeps the unfinished wait', () => {
    assert.equal(decideTurnEnd({ text: 'I need pens and', waitedMs: 0 }).reason, 'unfinished');
  });
});

describe('complete questions and requests shorten the wait (en/sw)', () => {
  for (const text of [
    'Do you sell pens?',
    'Can you deliver to Westlands?',
    'Mnauza vitabu gani?',
    'Bei gani?',
    'Duka lenu liko wapi',
    'Mnafunga saa ngapi',
  ]) {
    it(text, () => {
      assert.equal(looksLikeCompleteQuestion(text), true);
      assert.ok(adaptiveFlushMs({ text }) <= COMPLETE_QUESTION_FLUSH_MS);
    });
  }
  it('a plain statement keeps the old cap', () => {
    assert.equal(looksLikeCompleteQuestion('I was there yesterday.'), false);
    assert.ok(adaptiveFlushMs({ text: 'I was there yesterday.' }) > COMPLETE_QUESTION_FLUSH_MS);
  });
});
