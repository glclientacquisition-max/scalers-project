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
const TUESDAY_Q = 'Would Tuesday at 10 AM work for you?';
const now = () => Date.now();

function speakingQuestion(extra = {}) {
  const t = extra.now || Date.now();
  return {
    speaking: true,
    turnBusy: true,
    speakStartedAt: t - 400,
    lastAgentText: extra.lastAgentText || BOOK_Q,
    lastAgentAskedQuestion: extra.lastAgentAskedQuestion !== false,
    replayText: extra.replayText || '',
    now: t,
  };
}

console.log('A–C queue during TTS');
test('A: yes during TTS is queued, not barged', () => {
  const d = decideCallerEvent({ text: 'yes', ...speakingQuestion() });
  assert.strictEqual(d.action, 'queue');
  assert.strictEqual(d.stopTts, false);
  assert.strictEqual(d.runGemini, true);
  const hold = createOverlapHold();
  hold.enqueue('yes', 1);
  assert.strictEqual(hold.drain(1).text, 'yes');
  assert.strictEqual(hold.drain(1).duplicate, true);
});

test('B: no during TTS after a yes/no question is queued once', () => {
  const d = decideCallerEvent({ text: 'no', ...speakingQuestion() });
  assert.strictEqual(d.action, 'queue');
  assert.strictEqual(d.stopTts, false);
  const hold = createOverlapHold();
  hold.enqueue('no', 2);
  assert.strictEqual(hold.drain(2).text, 'no');
  assert.strictEqual(hold.drain(2).duplicate, true);
});

test('C: sawa during TTS after a question is queued as an answer', () => {
  const d = decideCallerEvent({
    text: 'sawa',
    ...speakingQuestion({ lastAgentAskedQuestion: true }),
  });
  assert.strictEqual(d.action, 'queue');
  assert.strictEqual(d.reason, 'answer_yes');
  assert.strictEqual(d.stopTts, false);
  const hold = createOverlapHold();
  hold.enqueue('sawa', 3);
  assert.strictEqual(hold.drain(3).text, 'sawa');
});

console.log('D–E endpoint vs playback');
test('D: endpoint while TTS is playing retains the queued yes', () => {
  const hold = createOverlapHold();
  hold.enqueue('yes', 4);
  assert.strictEqual(hold.hasPending(4), true);
  assert.deepStrictEqual(hold.pendingFor(4), ['yes']);
  assert.strictEqual(hold.drain(4).text, 'yes');
});

test('E: playback end before endpoint keeps interim and does not Gemini it', () => {
  const hold = createOverlapHold();
  hold.noteInterim('Yes', 5);
  const drained = hold.drain(5);
  assert.strictEqual(drained.text, '');
  assert.strictEqual(drained.duplicate, false);
  assert.strictEqual(hold.hasPending(5), true);
  const leftover = hold.takeAllInterims();
  assert.strictEqual(leftover, 'Yes');
  hold.markReleased(leftover);
  assert.strictEqual(hold.alreadyReleased('yes'), true);
});

test('E: later final matching the interim is not a second turn', () => {
  const hold = createOverlapHold();
  hold.noteInterim('Yes', 6);
  hold.drain(6);
  const leftover = hold.takeAllInterims();
  hold.markReleased(leftover);
  assert.strictEqual(hold.alreadyReleased('Yes'), true);
  assert.strictEqual(hold.enqueue('Yes', 6), null);
});

console.log('F genuine barge');
test('F: no actually barges and is not queued as a silent overlap', () => {
  const d = decideCallerEvent({
    text: 'No, actually Tuesday',
    ...speakingQuestion(),
  });
  assert.strictEqual(d.action, 'barge_gemini');
  assert.strictEqual(d.stopTts, true);
  assert.strictEqual(d.runGemini, true);
  assert.strictEqual(d.queue, false);
});

console.log('G–J replay');
test('G: Sorry replays the committed question, not Gemini', () => {
  const memory = createAgentReplayMemory();
  memory.beginSpeech(TUESDAY_Q);
  memory.commitPlayback();
  const d = decideCallerEvent({
    text: 'Sorry?',
    ...speakingQuestion({
      lastAgentText: 'Can I book you for',
      replayText: memory.pickReplay(),
    }),
  });
  assert.strictEqual(d.reason, 'hear_again');
  assert.strictEqual(d.replay, true);
  assert.strictEqual(d.runGemini, false);
  assert.strictEqual(memory.pickReplay(), TUESDAY_Q);
});

test('H: Sorry with no committed question does not replay a fragment', () => {
  const memory = createAgentReplayMemory();
  memory.beginSpeech('Would tomorrow work?');
  assert.strictEqual(memory.pickReplay(), '');
  const d = decideCallerEvent({
    text: 'sorry',
    ...speakingQuestion({ lastAgentText: 'Would tomorrow', replayText: memory.pickReplay() }),
  });
  assert.strictEqual(d.reason, 'hear_again');
  assert.strictEqual(d.runGemini, false);
  assert.strictEqual(d.stopTts, true);
});

test('I: interrupted new question keeps the previous safe question', () => {
  const memory = createAgentReplayMemory();
  memory.beginSpeech('Would Tuesday work?');
  memory.commitPlayback();
  memory.beginSpeech('Can I book you for Wednesday at noon?');
  memory.abandonPlayback();
  assert.strictEqual(memory.pickReplay(), 'Would Tuesday work?');
});

test('J: replaying a question does not replace the replay target', () => {
  const memory = createAgentReplayMemory();
  memory.beginSpeech(TUESDAY_Q);
  memory.commitPlayback();
  memory.beginSpeech(TUESDAY_Q, { isReplay: true });
  memory.commitPlayback();
  assert.strictEqual(memory.pickReplay(), TUESDAY_Q);
  memory.beginSpeech(TUESDAY_Q, { isReplay: true });
  memory.abandonPlayback();
  assert.strictEqual(memory.pickReplay(), TUESDAY_Q);
});

test('statements are not replay targets', () => {
  const memory = createAgentReplayMemory();
  memory.beginSpeech('Our delivery hours are 9 AM to 5 PM.');
  memory.commitPlayback();
  assert.strictEqual(memory.pickReplay(), '');
});

test('filler does not commit or replace a question', () => {
  const memory = createAgentReplayMemory();
  memory.beginSpeech(BOOK_Q);
  memory.commitPlayback();
  memory.beginSpeech('One moment…', { isFiller: true });
  memory.commitPlayback();
  assert.strictEqual(memory.pickReplay(), BOOK_Q);
});

test('session isolation', () => {
  const a = createAgentReplayMemory();
  const b = createAgentReplayMemory();
  a.beginSpeech(BOOK_Q);
  a.commitPlayback();
  b.beginSpeech('Was that John?');
  b.commitPlayback();
  assert.strictEqual(a.pickReplay(), BOOK_Q);
  assert.strictEqual(b.pickReplay(), 'Was that John?');
});

console.log('K rapid yes');
test('K: yes then yes please is one held answer', () => {
  const hold = createOverlapHold();
  hold.enqueue('yes', 7);
  hold.enqueue('yes please', 7);
  assert.deepStrictEqual(hold.pendingFor(7), ['yes please']);
  assert.strictEqual(hold.drain(7).text, 'yes please');
  assert.strictEqual(hold.drain(7).duplicate, true);
});

console.log('L–M echo and backchannel');
test('L: echo of agent line does not queue', () => {
  const d = decideCallerEvent({
    text: 'call you back',
    ...speakingQuestion({
      lastAgentText: 'Someone will call you back shortly.',
      lastAgentAskedQuestion: false,
    }),
  });
  assert.strictEqual(d.reason, 'echo');
  assert.strictEqual(d.stopTts, false);
});

test('M: poa and mm stay backchannel; sawa without a question stays backchannel', () => {
  const poa = decideCallerEvent({
    text: 'poa',
    ...speakingQuestion({ lastAgentAskedQuestion: false, lastAgentText: 'We can help tomorrow.' }),
  });
  const mm = decideCallerEvent({
    text: 'mm',
    ...speakingQuestion({ lastAgentAskedQuestion: false, lastAgentText: 'We can help tomorrow.' }),
  });
  const sawa = decideCallerEvent({
    text: 'sawa',
    ...speakingQuestion({ lastAgentAskedQuestion: false, lastAgentText: 'We can help tomorrow.' }),
  });
  assert.strictEqual(poa.reason, 'backchannel');
  assert.strictEqual(mm.reason, 'backchannel');
  assert.strictEqual(sawa.reason, 'backchannel');
  assert.strictEqual(poa.stopTts, false);
});

console.log('PR #200 decision table stays authoritative');
const TABLE = [
  ['wait', { action: 'barge_listen', stopTts: true, runGemini: false, reason: 'interrupt_wait' }],
  ['hold on', { action: 'barge_listen', stopTts: true, runGemini: false, reason: 'interrupt_wait' }],
  ['stop', { action: 'barge_listen', stopTts: true, runGemini: false, reason: 'interrupt_wait' }],
  ['let me think', { action: 'ignore', stopTts: false, runGemini: false, reason: 'incomplete' }],
  ['actually', { action: 'barge_listen', stopTts: true, runGemini: false, reason: 'incomplete_correction' }],
  ['I said', { action: 'barge_listen', stopTts: true, runGemini: false, reason: 'incomplete_correction' }],
  ['pardon', { action: 'barge_listen', stopTts: true, runGemini: false, reason: 'hear_again' }],
];
test('table: wait / hold / stop / think / actually / I said / pardon', () => {
  for (const [text, expected] of TABLE) {
    const d = decideCallerEvent({ text, ...speakingQuestion({ lastAgentAskedQuestion: false, lastAgentText: 'We can help tomorrow.', replayText: TUESDAY_Q }) });
    assert.strictEqual(d.action, expected.action, `${text} action`);
    assert.strictEqual(d.stopTts, expected.stopTts, `${text} stopTts`);
    assert.strictEqual(d.runGemini, expected.runGemini, `${text} runGemini`);
    assert.strictEqual(d.reason, expected.reason, `${text} reason`);
  }
});

test('stale generation does not release a newer queue', () => {
  const hold = createOverlapHold();
  hold.enqueue('yes', 10);
  assert.strictEqual(hold.drain(9).text, '');
  assert.strictEqual(hold.drain(10).text, 'yes');
});

test('new caller turn does not inherit previous queue', () => {
  const hold = createOverlapHold();
  hold.enqueue('yes', 1);
  hold.discardExcept(0);
  assert.strictEqual(hold.pending().length, 0);
  hold.enqueue('no', 2);
  assert.strictEqual(hold.drain(2).text, 'no');
});

test('playback-end + endpoint cannot duplicate one yes', () => {
  const hold = createOverlapHold();
  hold.enqueue('yes', 11);
  const first = hold.drain(11);
  hold.markReleased(first.text);
  const second = hold.drain(11);
  assert.strictEqual(first.duplicate, false);
  assert.strictEqual(second.duplicate, true);
  assert.strictEqual(hold.alreadyReleased('yes'), true);
  assert.strictEqual(hold.takeAllInterims(), '');
});

if (process.exitCode) {
  console.error(`\nFAILED (${passed} passed)`);
} else {
  console.log(`\nAll ${passed} tests passed.`);
}
