const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  looksLikeIdentityQuestion,
  looksLikeRobotQuestion,
  pickIdentityReply,
} = require('../src/conversation/dynamicSpeech');

describe('who-are-you local reply', () => {
  it('answers name and shop only', () => {
    assert.equal(looksLikeIdentityQuestion('Who are you?'), true);
    assert.equal(looksLikeIdentityQuestion('Who is this'), true);
    assert.equal(looksLikeIdentityQuestion('Wewe ni nani?'), true);
    assert.equal(looksLikeIdentityQuestion('Are you a robot?'), false);

    const line = pickIdentityReply({
      agentName: 'Shy',
      businessName: 'Done and Dusted',
    });
    assert.equal(line, 'I am Shy from Done and Dusted.');
    assert.doesNotMatch(line, /ai|robot|virtual assistant|intelligent agent/i);
    assert.doesNotMatch(line, /how can i help/i);
  });

  it('discloses AI only on a direct robot ask', () => {
    assert.equal(looksLikeRobotQuestion('Are you a robot?'), true);
    assert.equal(looksLikeRobotQuestion('Ni robot?'), true);
    assert.equal(looksLikeRobotQuestion('Who are you?'), false);

    const line = pickIdentityReply({
      agentName: 'Shy',
      businessName: 'Done and Dusted',
      discloseAi: true,
    });
    assert.equal(line, 'Yes. I am Shy from Done and Dusted. How can I help?');
    assert.doesNotMatch(line, /gemini|soniox|model|virtual assistant|intelligent agent/i);
    assert.match(line, /^Yes\./);
  });
});
