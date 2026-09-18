const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  looksLikeCallerName,
  callerNameFromUtterance,
} = require('../src/conversation/dynamicSpeech');
const { planLlmRecovery } = require('../src/conversation/llmRecovery');

describe('reasoning-down name capture', () => {
  it('treats intro names as a name, not a failed turn', () => {
    assert.equal(looksLikeCallerName('Alvin'), true);
    assert.equal(callerNameFromUtterance('My name is Alvin'), 'Alvin');
    assert.equal(callerNameFromUtterance('I am Amina'), 'Amina');
    assert.equal(callerNameFromUtterance('Jina langu ni Amina'), 'Amina');
    assert.equal(looksLikeCallerName('Carpet cleaning'), false);
  });

  it('saves the name on the first Gemini-down turn if they already said it', () => {
    const first = planLlmRecovery({
      userText: 'My name is Alvin',
      alreadyOffered: false,
      language: 'en',
    });
    assert.equal(first.saved, true);
    assert.equal(first.name, 'Alvin');
    assert.match(first.spoken, /I have your name/i);
    assert.doesNotMatch(first.spoken, /can't finish/i);

    const ask = planLlmRecovery({
      userText: 'I need carpet cleaning tomorrow',
      alreadyOffered: false,
      language: 'en',
    });
    assert.equal(ask.saved, false);
    assert.match(ask.spoken, /can't finish/i);
  });
});
