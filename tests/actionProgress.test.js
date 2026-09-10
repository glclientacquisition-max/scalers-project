// Run: node tests/actionProgress.test.js
const assert = require('assert');
const {
  pickActionProgress,
  pickClarifyProgress,
  pickContextualAck,
  pickLlmRecoveryLine,
  pickLlmRecoverySaved,
  looksLikeCallerName,
  looksLikePhaticCallerTurn,
  shouldSpeakThinkingAck,
} = require('../src/conversation/dynamicSpeech');

assert.strictEqual(pickActionProgress('CREATE_REQUEST', 'en'), 'Okay, let me save that.');
assert.strictEqual(pickActionProgress('CAPTURE', 'en'), 'Okay.');
assert.strictEqual(pickActionProgress('ESCALATE', 'en'), 'Okay, let me get the team on that.');
assert.strictEqual(pickActionProgress('TRANSFER', 'en'), 'Okay, let me connect you.');
assert.match(pickActionProgress('CREATE_REQUEST', 'sw'), /Sawa/i);
assert.match(pickActionProgress('CAPTURE', 'sw'), /^Sawa\.?$/i);
assert.ok(pickContextualAck('I want to order a book', 'en'));
assert.equal(looksLikePhaticCallerTurn('How are you doing?'), true);
assert.equal(looksLikePhaticCallerTurn('hello'), true);
assert.equal(looksLikePhaticCallerTurn('how much for a couch?'), false);
assert.equal(shouldSpeakThinkingAck('How are you doing?'), false);
assert.equal(shouldSpeakThinkingAck('How much for a couch?'), true);
assert.match(
  pickClarifyProgress({
    action: 'ASK_CLARIFICATION',
    slot: 'name',
    intent: 'human',
    language: 'en',
  }),
  /name/i
);
assert.match(
  pickClarifyProgress({
    action: 'ASK_CLARIFICATION',
    slot: 'name',
    intent: 'human',
    language: 'sw',
  }),
  /jina/i
);
assert.doesNotMatch(
  pickClarifyProgress({
    action: 'ASK_CLARIFICATION',
    slot: 'name',
    intent: 'human',
    language: 'en',
  }),
  /[—–]/
);
const recoveryEn = pickLlmRecoveryLine({ language: 'en' });
const recoveryEnAgain = pickLlmRecoveryLine({ language: 'en', alreadyOffered: true });
const recoverySavedEn = pickLlmRecoverySaved({ language: 'en' });
const handoffNameEn = pickClarifyProgress({
  action: 'ASK_CLARIFICATION',
  slot: 'name',
  intent: 'human',
  language: 'en',
});
assert.strictEqual(
  recoveryEn,
  "Okay, I can't finish that just now. May I have your name so I can reach them?"
);
assert.strictEqual(
  recoveryEnAgain,
  "Okay, I still can't finish that. May I have your name so I can reach them?"
);
assert.ok(
  recoveryEn.includes(handoffNameEn.replace(/^Okay\.\s*/, '')),
  'recovery must reuse the handoff name ask'
);
assert.doesNotMatch(recoveryEn, /cannot|on this line|technical issue/i);
assert.doesNotMatch(recoveryEnAgain, /cannot|on this line|we will call you back/i);
assert.doesNotMatch(recoveryEn, /[—–]/);
assert.ok(recoveryEn.split(/\s+/).length <= 25);
assert.ok(recoveryEnAgain.split(/\s+/).length <= 25);
assert.strictEqual(
  recoverySavedEn,
  "Okay, I have your name. I'll have the team reach you."
);
assert.match(pickLlmRecoveryLine({ language: 'sw' }), /jina/i);
assert.doesNotMatch(pickLlmRecoveryLine({ language: 'sw' }), /simu hii/i);
assert.equal(looksLikeCallerName('Ann Wanjiku'), true);
assert.equal(looksLikeCallerName('Carpet cleaning'), false);
assert.equal(looksLikeCallerName('Pardon?'), false);
assert.equal(looksLikeCallerName('sema tena'), false);

console.log('actionProgress tests passed.');
