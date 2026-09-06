// Overlap-hold + last-complete-question unit tests.
// Run: node tests/overlapHold.test.js

const assert = require('assert');
const {
  createOverlapHold,
  createAgentReplayMemory,
} = require('../src/speech/overlapHold');
const { decideCallerEvent } = require('../src/speech/turnTaking');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

const BOOK_Q = 'Would you like us to book that for you?';

console.log('overlapHold queue');
test('yes after a question is held until that playback generation drains', () => {
  const hold = createOverlapHold();
  hold.enqueue('yes', 7);
  assert.deepStrictEqual(hold.pendingFor(7), ['yes']);
  assert.strictEqual(hold.drain(7).text, 'yes');
  assert.deepStrictEqual(hold.pendingFor(7), []);
});

test('no after a yes/no question is held and released after playback ends', () => {
  const hold = createOverlapHold();
  hold.enqueue('no', 3);
  const released = hold.drain(3);
  assert.strictEqual(released.duplicate, false);
  assert.strictEqual(released.text, 'no');
});

test('queue releases exactly once', () => {
  const hold = createOverlapHold();
  hold.enqueue('yes', 4);
  const first = hold.drain(4);
  const second = hold.drain(4);
  assert.strictEqual(first.text, 'yes');
  assert.strictEqual(first.duplicate, false);
  assert.strictEqual(second.text, '');
  assert.strictEqual(second.duplicate, true);
});

test('queued final is not lost across a matching drain', () => {
  const hold = createOverlapHold();
  hold.enqueue('yes please', 9);
  assert.strictEqual(hold.pending().length, 1);
  assert.strictEqual(hold.drain(9).text, 'yes please');
});

test('identical yes for the same generation is not duplicated', () => {
  const hold = createOverlapHold();
  hold.enqueue('yes', 2);
  hold.enqueue('yes', 2);
  assert.strictEqual(hold.pendingFor(2).length, 1);
  assert.strictEqual(hold.drain(2).text, 'yes');
});

test('stale generation does not release a newer queue', () => {
  const hold = createOverlapHold();
  hold.enqueue('yes', 10);
  const stale = hold.drain(9);
  assert.strictEqual(stale.text, '');
  assert.strictEqual(hold.drain(10).text, 'yes');
});

test('new caller turn does not inherit previous queue', () => {
  const hold = createOverlapHold();
  hold.enqueue('yes', 1);
  hold.discardExcept(0);
  assert.strictEqual(hold.pending().length, 0);
  assert.strictEqual(hold.drain(1).duplicate, true);
  hold.enqueue('no', 2);
  assert.strictEqual(hold.drain(2).text, 'no');
});

console.log('overlapHold playback termination');
test('normal completion drains the matching generation', () => {
  const hold = createOverlapHold();
  hold.enqueue('yes', 5);
  assert.strictEqual(hold.drain(5).text, 'yes');
});

test('barge cancellation drains the ending generation', () => {
  const hold = createOverlapHold();
  hold.enqueue('yes', 6);
  const endingGen = 6;
  const bumped = 7;
  assert.strictEqual(hold.drain(endingGen).text, 'yes');
  assert.strictEqual(hold.drain(bumped).text, '');
});

test('stale generation finally is a no-op after discard', () => {
  const hold = createOverlapHold();
  hold.enqueue('yes', 1);
  hold.discardGeneration(1);
  const late = hold.drain(1);
  assert.strictEqual(late.text, '');
  assert.strictEqual(late.duplicate, true);
});

test('filler playback can reassign overlap onto the reply generation', () => {
  const hold = createOverlapHold();
  hold.enqueue('yes', 1);
  assert.strictEqual(hold.reassignPending(1, 3), 1);
  assert.deepStrictEqual(hold.pendingFor(1), []);
  assert.strictEqual(hold.drain(3).text, 'yes');
  const leftover = hold.drain(1);
  assert.strictEqual(leftover.text, '');
  assert.strictEqual(leftover.duplicate, false);
});

test('fallback completion still drains once', () => {
  const hold = createOverlapHold();
  hold.enqueue('no', 8);
  assert.strictEqual(hold.drain(8).text, 'no');
  assert.strictEqual(hold.drain(8).duplicate, true);
});

console.log('agentReplayMemory');
test('Sorry replays the complete last question', () => {
  const memory = createAgentReplayMemory();
  memory.rememberSelectedSpeech(BOOK_Q);
  assert.strictEqual(memory.pickReplay('Would you like'), BOOK_Q);
});

test('Pardon replays the complete last question', () => {
  const memory = createAgentReplayMemory();
  memory.rememberSelectedSpeech(BOOK_Q);
  assert.strictEqual(memory.pickReplay(), BOOK_Q);
});

test('cancellation does not overwrite the complete question with a fragment', () => {
  const memory = createAgentReplayMemory();
  memory.rememberSelectedSpeech(BOOK_Q);
  // Streamed lastAgentText fragment is only a fallback, never written into memory.
  assert.strictEqual(memory.pickReplay('Would you like us to'), BOOK_Q);
  assert.strictEqual(memory.snapshot().lastCompleteAgentQuestion, BOOK_Q);
});

test('no last question falls back to the last complete utterance then lastAgentText', () => {
  const memory = createAgentReplayMemory();
  memory.rememberSelectedSpeech('Someone will call you back shortly.');
  assert.strictEqual(memory.pickReplay('fragment'), 'Someone will call you back shortly.');
  const empty = createAgentReplayMemory();
  assert.strictEqual(empty.pickReplay('safe fallback'), 'safe fallback');
  assert.strictEqual(empty.pickReplay(''), '');
});

test('filler speech does not replace the last complete question', () => {
  const memory = createAgentReplayMemory();
  memory.rememberSelectedSpeech(BOOK_Q);
  memory.rememberSelectedSpeech('One moment…', { isFiller: true });
  assert.strictEqual(memory.snapshot().lastCompleteAgentQuestion, BOOK_Q);
});

test('session isolation: two memories do not share state', () => {
  const a = createAgentReplayMemory();
  const b = createAgentReplayMemory();
  a.rememberSelectedSpeech(BOOK_Q);
  b.rememberSelectedSpeech('Was that John?');
  assert.strictEqual(a.pickReplay(), BOOK_Q);
  assert.strictEqual(b.pickReplay(), 'Was that John?');
});

console.log('decideCallerEvent wiring');
test('hear-again uses replayText when lastAgentText is a cancelled fragment', () => {
  const now = Date.now();
  const d = decideCallerEvent({
    text: 'sorry',
    speaking: true,
    turnBusy: true,
    speakStartedAt: now - 400,
    lastAgentText: 'Would you like',
    replayText: BOOK_Q,
    now,
  });
  assert.strictEqual(d.reason, 'hear_again');
  assert.strictEqual(d.replay, true);
  assert.strictEqual(d.runGemini, false);
  assert.strictEqual(d.stopTts, true);
});

test('queued yes during TTS still does not barge', () => {
  const now = Date.now();
  const d = decideCallerEvent({
    text: 'yes',
    speaking: true,
    turnBusy: true,
    speakStartedAt: now - 400,
    lastAgentText: BOOK_Q,
    lastAgentAskedQuestion: true,
    now,
  });
  assert.strictEqual(d.action, 'queue');
  assert.strictEqual(d.stopTts, false);
  assert.strictEqual(d.runGemini, true);
  assert.strictEqual(d.queue, true);
  assert.strictEqual(d.skip, false);
});

if (process.exitCode) {
  console.error(`\nFAILED (${passed} passed)`);
} else {
  console.log(`\nAll ${passed} tests passed.`);
}
