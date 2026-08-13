// Run: node tests/actionProgress.test.js
const assert = require('assert');
const {
  pickActionProgress,
  pickClarifyProgress,
  pickContextualAck,
} = require('../src/conversation/dynamicSpeech');

assert.strictEqual(pickActionProgress('CREATE_REQUEST', 'en'), 'Okay, let me save that.');
assert.strictEqual(pickActionProgress('CAPTURE', 'en'), 'Okay.');
assert.strictEqual(pickActionProgress('ESCALATE', 'en'), 'Okay, let me get the team on that.');
assert.strictEqual(pickActionProgress('TRANSFER', 'en'), 'Okay, let me connect you.');
assert.match(pickActionProgress('CREATE_REQUEST', 'sw'), /Sawa/i);
assert.match(pickActionProgress('CAPTURE', 'sw'), /^Sawa\.?$/i);
assert.ok(pickContextualAck('I want to order a book', 'en'));
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

console.log('actionProgress tests passed.');
