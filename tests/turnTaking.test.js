// Turn-taking unit tests.
// Run: node tests/turnTaking.test.js

const assert = require('assert');
const {
  looksLikeEcho,
  utteranceLooksIncomplete,
  isInterruptOnlyUtterance,
  adaptiveFlushMs,
  evaluateBargeIn,
  hasBargeContent,
  agentAwaitingReply,
  classifyFinalDuringAgentSpeech,
  decideCallerEvent,
} = require('../src/speech/turnTaking');
const { isBackchannel } = require('../src/conversation/language');
const { shouldSkipCallerTurn } = require('../src/conversation/dynamicSpeech');

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

console.log('looksLikeEcho');
test('detects substring echo', () => {
  assert.strictEqual(
    looksLikeEcho('how can I help', 'Hello, how can I help you today?'),
    true
  );
});
test('detects high word-overlap echo', () => {
  assert.strictEqual(
    looksLikeEcho('can help you today', 'How can I help you today?'),
    true
  );
});
test('rejects unrelated caller speech', () => {
  assert.strictEqual(looksLikeEcho('I need a plumber', 'How can I help you today?'), false);
});

console.log('utteranceLooksIncomplete');
test('flags trailing conjunctions', () => {
  assert.strictEqual(utteranceLooksIncomplete('I need help with'), true);
  assert.strictEqual(utteranceLooksIncomplete('Nina shida na'), true);
});
test('flags STT period stuck on trailing and', () => {
  assert.strictEqual(
    utteranceLooksIncomplete('I\'d like to make a booking of an executive room,and.'),
    true
  );
  assert.strictEqual(utteranceLooksIncomplete('I need a room, and.'), true);
});
test('flags let-me-think and trailing correction stems', () => {
  assert.strictEqual(utteranceLooksIncomplete('let me think'), true);
  assert.strictEqual(utteranceLooksIncomplete('let me think about it'), true);
  assert.strictEqual(utteranceLooksIncomplete('actually'), true);
  assert.strictEqual(utteranceLooksIncomplete('I said'), true);
});
test('complete sentences are complete', () => {
  assert.strictEqual(utteranceLooksIncomplete('I need a plumber.'), false);
  assert.strictEqual(utteranceLooksIncomplete('My name is John'), false);
});

console.log('isInterruptOnlyUtterance');
test('detects wait/stop only turns', () => {
  assert.strictEqual(isInterruptOnlyUtterance('Wait.'), true);
  assert.strictEqual(isInterruptOnlyUtterance('Stop, stop, stop.'), true);
  assert.strictEqual(isInterruptOnlyUtterance('No wait'), true);
  assert.strictEqual(isInterruptOnlyUtterance('Wait.Wait.'), true);
  assert.strictEqual(isInterruptOnlyUtterance('hold on'), true);
  assert.strictEqual(isInterruptOnlyUtterance('hold on please'), true);
  assert.strictEqual(isInterruptOnlyUtterance('wait a second'), true);
});
test('does not treat real requests as interrupt-only', () => {
  assert.strictEqual(isInterruptOnlyUtterance('Wait, my name is Ann'), false);
  assert.strictEqual(isInterruptOnlyUtterance('I need an executive room'), false);
});

console.log('adaptiveFlushMs');
test('short confirm after question is fast', () => {
  const ms = adaptiveFlushMs({
    text: 'Yes',
    lastAgentText: 'Was that John?',
    baseMs: 900,
    minMs: 350,
    maxMs: 1500,
  });
  assert.ok(ms <= 450, `expected <=450, got ${ms}`);
});
test('incomplete thought waits longer', () => {
  const ms = adaptiveFlushMs({
    text: 'I need help with',
    lastAgentText: 'How can I help?',
    baseMs: 900,
    minMs: 350,
    maxMs: 1500,
  });
  assert.ok(ms >= 1200, `expected >=1200, got ${ms}`);
});
test('punctuated line flushes sooner', () => {
  const ms = adaptiveFlushMs({
    text: 'I need a plumber.',
    lastAgentText: 'How can I help?',
    baseMs: 900,
    minMs: 350,
    maxMs: 1500,
  });
  assert.ok(ms <= 480, `expected <=480, got ${ms}`);
});

console.log('evaluateBargeIn');
test('ignores backchannels during TTS', () => {
  const d = evaluateBargeIn({
    text: 'Sawa',
    speaking: true,
    turnBusy: true,
    speakStartedAt: Date.now() - 500,
    lastAgentText: 'We can help tomorrow.',
    isBackchannel,
  });
  assert.strictEqual(d.barge, false);
  assert.strictEqual(d.reason, 'backchannel');
});
test('grace window blocks early barge', () => {
  const d = evaluateBargeIn({
    text: 'I need plumbing',
    speaking: true,
    turnBusy: true,
    speakStartedAt: Date.now() - 50,
    lastAgentText: 'Hello there.',
    isBackchannel,
    now: Date.now(),
  });
  assert.strictEqual(d.barge, false);
  assert.strictEqual(d.reason, 'grace');
});
test('strong interrupt cancels TTS after grace', () => {
  const now = Date.now();
  const d = evaluateBargeIn({
    text: 'Wait, my name is Ann',
    speaking: true,
    turnBusy: true,
    speakStartedAt: now - 300,
    lastAgentText: 'Someone will call you back.',
    isBackchannel,
    now,
  });
  assert.strictEqual(d.barge, true);
  assert.strictEqual(d.reason, 'interrupt_tts');
});
test('echo of agent line does not barge', () => {
  const now = Date.now();
  const d = evaluateBargeIn({
    text: 'call you back',
    speaking: true,
    turnBusy: true,
    speakStartedAt: now - 400,
    lastAgentText: 'Someone will call you back shortly.',
    isBackchannel,
    now,
  });
  assert.strictEqual(d.barge, false);
  assert.strictEqual(d.reason, 'echo');
});
test('explicit interrupt barge while LLM thinking', () => {
  const d = evaluateBargeIn({
    text: 'Actually wait',
    speaking: false,
    turnBusy: true,
    speakStartedAt: 0,
    lastAgentText: 'One moment.',
    isBackchannel,
  });
  assert.strictEqual(d.barge, true);
  assert.strictEqual(d.reason, 'interrupt_wait');
});
test('continuation during LLM thinking does not barge (prevents silence)', () => {
  const d = evaluateBargeIn({
    text: 'I want to talk to him',
    speaking: false,
    turnBusy: true,
    speakStartedAt: 0,
    lastAgentText: 'How can I help?',
    isBackchannel,
  });
  assert.strictEqual(d.barge, false);
  assert.strictEqual(d.reason, 'thinking_continuation');
});
test('mid-thought floor-manager ask is incomplete', () => {
  assert.strictEqual(
    utteranceLooksIncomplete('you can tell him that I\'m'),
    true
  );
  assert.strictEqual(utteranceLooksIncomplete('Ningetaka kuongea na Floor Manager'), false);
});

console.log('helpers');
test('hasBargeContent / agentAwaitingReply', () => {
  assert.strictEqual(hasBargeContent('no wait'), true);
  assert.strictEqual(hasBargeContent('mm'), false);
  assert.strictEqual(agentAwaitingReply('Was that John?'), true);
  assert.strictEqual(agentAwaitingReply('We are open today.'), false);
});

console.log('classifyFinalDuringAgentSpeech');
test('drops echo finals during agent speech', () => {
  assert.strictEqual(
    classifyFinalDuringAgentSpeech(
      'call you back shortly',
      'Someone will call you back shortly.'
    ),
    'drop_echo'
  );
});
test('queues real overlap finals during agent speech', () => {
  assert.strictEqual(
    classifyFinalDuringAgentSpeech('My name is Ann', 'How can I help you today?'),
    'queue'
  );
  assert.strictEqual(
    classifyFinalDuringAgentSpeech('yes', 'Was that John?'),
    'queue'
  );
});

console.log('isBackchannel context');
test('wait/sorry are not generic backchannels', () => {
  assert.strictEqual(isBackchannel('wait'), false);
  assert.strictEqual(isBackchannel('sorry'), false);
  assert.strictEqual(isBackchannel('stop'), false);
});
test('yes is a backchannel unless the agent asked a question', () => {
  assert.strictEqual(isBackchannel('yes'), true);
  assert.strictEqual(
    isBackchannel('yes', { lastAgentText: 'Would you like us to book that for you?' }),
    false
  );
  assert.strictEqual(isBackchannel('sawa'), true);
  assert.strictEqual(isBackchannel('poa'), true);
});

console.log('evaluateBargeIn cue-aware early window');
test('wait barges after grace despite being shorter than min chars', () => {
  const now = Date.now();
  const d = evaluateBargeIn({
    text: 'wait',
    speaking: true,
    turnBusy: true,
    speakStartedAt: now - 300,
    lastAgentText: 'We can help tomorrow.',
    now,
  });
  assert.strictEqual(d.barge, true);
  assert.strictEqual(d.reason, 'interrupt_wait');
});
test('let me think does not barge during TTS', () => {
  const now = Date.now();
  const d = evaluateBargeIn({
    text: 'let me think',
    speaking: true,
    turnBusy: true,
    speakStartedAt: now - 400,
    lastAgentText: 'We can help tomorrow.',
    now,
  });
  assert.strictEqual(d.barge, false);
  assert.strictEqual(hasBargeContent('let me think'), false);
});

console.log('decideCallerEvent matrix');

const BOOK_Q = 'Would you like us to book that for you?';
const AGENT_LINE = 'We can help tomorrow.';

function matrixCtx(kind, now) {
  if (kind === 'A') {
    return {
      speaking: false,
      turnBusy: false,
      lastAgentText: AGENT_LINE,
      lastAgentAskedQuestion: false,
      now,
    };
  }
  if (kind === 'B') {
    return {
      speaking: true,
      turnBusy: true,
      speakStartedAt: now - 300,
      lastAgentText: AGENT_LINE,
      lastAgentAskedQuestion: false,
      now,
    };
  }
  if (kind === 'C') {
    return {
      speaking: true,
      turnBusy: true,
      speakStartedAt: now - 1200,
      lastAgentText: AGENT_LINE,
      lastAgentAskedQuestion: false,
      now,
    };
  }
  if (kind === 'D') {
    return {
      speaking: false,
      turnBusy: true,
      speakStartedAt: 0,
      lastAgentText: 'One moment.',
      lastAgentAskedQuestion: false,
      now,
    };
  }
  return {
    speaking: false,
    turnBusy: false,
    lastAgentText: BOOK_Q,
    lastAgentAskedQuestion: true,
    now,
  };
}

function expectFlags({ action, stopTts, runGemini, queue, skip, reason, replay }) {
  return { action, stopTts, runGemini, queue, skip, reason, replay };
}

const LISTEN_TTS = (reason) =>
  expectFlags({
    action: 'barge_listen',
    stopTts: true,
    runGemini: false,
    queue: false,
    skip: true,
    reason,
    replay: false,
  });
const LISTEN_THINK = (reason) =>
  expectFlags({
    action: 'barge_listen',
    stopTts: false,
    runGemini: false,
    queue: false,
    skip: true,
    reason,
    replay: false,
  });
const SKIP = (reason, extra = {}) =>
  expectFlags({
    action: extra.action || 'skip',
    stopTts: false,
    runGemini: false,
    queue: extra.queue || false,
    skip: true,
    reason,
    replay: extra.replay || false,
  });
const IGNORE = (reason, extra = {}) =>
  expectFlags({
    action: 'ignore',
    stopTts: false,
    runGemini: false,
    queue: false,
    skip: extra.skip !== false,
    reason,
    replay: false,
  });
const PROCESS = (reason) =>
  expectFlags({
    action: 'process_turn',
    stopTts: false,
    runGemini: true,
    queue: false,
    skip: false,
    reason,
    replay: false,
  });
const QUEUE_ANS = (reason) =>
  expectFlags({
    action: 'queue',
    stopTts: false,
    runGemini: true,
    queue: true,
    skip: false,
    reason,
    replay: false,
  });
const BARGE_GEMINI_TTS = (reason) =>
  expectFlags({
    action: 'barge_gemini',
    stopTts: true,
    runGemini: true,
    queue: false,
    skip: false,
    reason,
    replay: false,
  });
const BARGE_GEMINI_THINK = (reason) =>
  expectFlags({
    action: 'barge_gemini',
    stopTts: false,
    runGemini: true,
    queue: false,
    skip: false,
    reason,
    replay: false,
  });

const WAIT_HOLD = [
  'wait',
  'wait a second',
  'hold on',
  'hold on please',
  'stop',
];

const MATRIX = [];

for (const phrase of WAIT_HOLD) {
  MATRIX.push(['A', phrase, SKIP('interrupt_wait')]);
  MATRIX.push(['B', phrase, LISTEN_TTS('interrupt_wait')]);
  MATRIX.push(['C', phrase, LISTEN_TTS('interrupt_wait')]);
  MATRIX.push(['D', phrase, LISTEN_THINK('interrupt_wait')]);
  MATRIX.push(['E', phrase, SKIP('interrupt_wait')]);
}

for (const phrase of ['sorry', 'sorry, what did you say?', 'pardon']) {
  MATRIX.push([
    'A',
    phrase,
    SKIP('hear_again', { replay: true }),
  ]);
  MATRIX.push([
    'B',
    phrase,
    expectFlags({
      action: 'barge_listen',
      stopTts: true,
      runGemini: false,
      queue: false,
      skip: true,
      reason: 'hear_again',
      replay: true,
    }),
  ]);
  MATRIX.push([
    'C',
    phrase,
    expectFlags({
      action: 'barge_listen',
      stopTts: true,
      runGemini: false,
      queue: false,
      skip: true,
      reason: 'hear_again',
      replay: true,
    }),
  ]);
  MATRIX.push([
    'D',
    phrase,
    expectFlags({
      action: 'barge_listen',
      stopTts: false,
      runGemini: false,
      queue: false,
      skip: true,
      reason: 'hear_again',
      replay: true,
    }),
  ]);
  MATRIX.push([
    'E',
    phrase,
    SKIP('hear_again', { replay: true }),
  ]);
}

MATRIX.push(['A', 'yes', IGNORE('backchannel')]);
MATRIX.push(['B', 'yes', IGNORE('backchannel')]);
MATRIX.push(['C', 'yes', IGNORE('backchannel')]);
MATRIX.push(['D', 'yes', IGNORE('backchannel')]);
MATRIX.push(['E', 'yes', PROCESS('answer_yes')]);
MATRIX.push(['A', 'yes please', PROCESS('ordinary_speech')]);
MATRIX.push(['B', 'yes please', BARGE_GEMINI_TTS('interrupt_tts')]);
MATRIX.push(['C', 'yes please', BARGE_GEMINI_TTS('interrupt_tts')]);
MATRIX.push(['D', 'yes please', IGNORE('thinking_continuation')]);
MATRIX.push(['E', 'yes please', PROCESS('answer_yes')]);

MATRIX.push(['A', 'no', SKIP('backchannel', { action: 'skip' })]);
MATRIX.push(['B', 'no', IGNORE('backchannel')]);
MATRIX.push(['C', 'no', IGNORE('backchannel')]);
MATRIX.push(['D', 'no', IGNORE('thinking_continuation')]);
MATRIX.push(['E', 'no', PROCESS('answer_no')]);

MATRIX.push(['A', 'no, actually...', PROCESS('interrupt_correction')]);
MATRIX.push(['B', 'no, actually...', BARGE_GEMINI_TTS('interrupt_correction')]);
MATRIX.push(['C', 'no, actually...', BARGE_GEMINI_TTS('interrupt_correction')]);
MATRIX.push(['D', 'no, actually...', BARGE_GEMINI_THINK('interrupt_correction')]);
MATRIX.push(['E', 'no, actually...', PROCESS('interrupt_correction')]);

MATRIX.push(['A', 'actually', SKIP('incomplete_correction', { queue: true })]);
MATRIX.push(['B', 'actually', LISTEN_TTS('incomplete_correction')]);
MATRIX.push(['C', 'actually', LISTEN_TTS('incomplete_correction')]);
MATRIX.push(['D', 'actually', LISTEN_THINK('incomplete_correction')]);
MATRIX.push(['E', 'actually', SKIP('incomplete_correction', { queue: true })]);

MATRIX.push(['A', 'actually, tomorrow', PROCESS('interrupt_correction')]);
MATRIX.push(['B', 'actually, tomorrow', BARGE_GEMINI_TTS('interrupt_correction')]);
MATRIX.push(['C', 'actually, tomorrow', BARGE_GEMINI_TTS('interrupt_correction')]);
MATRIX.push(['D', 'actually, tomorrow', BARGE_GEMINI_THINK('interrupt_correction')]);
MATRIX.push(['E', 'actually, tomorrow', PROCESS('interrupt_correction')]);

for (const phrase of ['let me think', 'let me think about it']) {
  MATRIX.push(['A', phrase, SKIP('incomplete', { queue: true })]);
  MATRIX.push(['B', phrase, IGNORE('incomplete')]);
  MATRIX.push(['C', phrase, IGNORE('incomplete')]);
  MATRIX.push(['D', phrase, IGNORE('thinking_continuation')]);
  MATRIX.push(['E', phrase, SKIP('incomplete', { queue: true })]);
}

MATRIX.push(['A', 'I said', SKIP('incomplete_correction', { queue: true })]);
MATRIX.push(['B', 'I said', LISTEN_TTS('incomplete_correction')]);
MATRIX.push(['C', 'I said', LISTEN_TTS('incomplete_correction')]);
MATRIX.push(['D', 'I said', LISTEN_THINK('incomplete_correction')]);
MATRIX.push(['E', 'I said', SKIP('incomplete_correction', { queue: true })]);

MATRIX.push(['A', 'I said Tuesday', PROCESS('interrupt_correction')]);
MATRIX.push(['B', 'I said Tuesday', BARGE_GEMINI_TTS('interrupt_correction')]);
MATRIX.push(['C', 'I said Tuesday', BARGE_GEMINI_TTS('interrupt_correction')]);
MATRIX.push(['D', 'I said Tuesday', BARGE_GEMINI_THINK('interrupt_correction')]);
MATRIX.push(['E', 'I said Tuesday', PROCESS('interrupt_correction')]);

MATRIX.push(['A', 'sawa', IGNORE('backchannel')]);
MATRIX.push(['B', 'sawa', IGNORE('backchannel')]);
MATRIX.push(['C', 'sawa', IGNORE('backchannel')]);
MATRIX.push(['D', 'sawa', IGNORE('backchannel')]);
MATRIX.push(['E', 'sawa', PROCESS('answer_yes')]);

MATRIX.push(['A', 'poa', IGNORE('backchannel')]);
MATRIX.push(['B', 'poa', IGNORE('backchannel')]);
MATRIX.push(['C', 'poa', IGNORE('backchannel')]);
MATRIX.push(['D', 'poa', IGNORE('backchannel')]);
MATRIX.push(['E', 'poa', IGNORE('backchannel')]);

MATRIX.push(['A', 'and', SKIP('incomplete', { queue: true })]);
MATRIX.push(['B', 'and', IGNORE('incomplete')]);
MATRIX.push(['C', 'and', IGNORE('incomplete')]);
MATRIX.push(['D', 'and', IGNORE('thinking_continuation')]);
MATRIX.push(['E', 'and', SKIP('incomplete', { queue: true })]);

test('table: known phrases across idle / early / late / thinking / asked-question', () => {
  const now = Date.now();
  for (const [ctx, phrase, expected] of MATRIX) {
    const d = decideCallerEvent({ text: phrase, ...matrixCtx(ctx, now) });
    const label = `${ctx} ${JSON.stringify(phrase)}`;
    assert.strictEqual(d.action, expected.action, `${label} action=${d.action} reason=${d.reason}`);
    assert.strictEqual(d.stopTts, expected.stopTts, `${label} stopTts`);
    assert.strictEqual(d.runGemini, expected.runGemini, `${label} runGemini`);
    assert.strictEqual(d.queue, expected.queue, `${label} queue`);
    assert.strictEqual(d.skip, expected.skip, `${label} skip`);
    assert.strictEqual(d.reason, expected.reason, `${label} reason`);
    assert.strictEqual(Boolean(d.replay), Boolean(expected.replay), `${label} replay`);
  }
});

test('yes/no after a question queue during TTS rather than barge', () => {
  const now = Date.now();
  for (const ms of [300, 1200]) {
    const yes = decideCallerEvent({
      text: 'yes',
      speaking: true,
      turnBusy: true,
      speakStartedAt: now - ms,
      lastAgentText: BOOK_Q,
      lastAgentAskedQuestion: true,
      now,
    });
    assert.strictEqual(yes.action, 'queue', `yes @${ms} action`);
    assert.strictEqual(yes.stopTts, false, `yes @${ms} stopTts`);
    assert.strictEqual(yes.runGemini, true, `yes @${ms} runGemini`);
    assert.strictEqual(yes.reason, 'answer_yes');

    const no = decideCallerEvent({
      text: 'no',
      speaking: true,
      turnBusy: true,
      speakStartedAt: now - ms,
      lastAgentText: BOOK_Q,
      lastAgentAskedQuestion: true,
      now,
    });
    assert.strictEqual(no.action, 'queue');
    assert.strictEqual(no.stopTts, false);
    assert.strictEqual(no.reason, 'answer_no');
  }
});

test('echo / empty / short noise', () => {
  const now = Date.now();
  const echo = decideCallerEvent({
    text: 'call you back',
    speaking: true,
    turnBusy: true,
    speakStartedAt: now - 400,
    lastAgentText: 'Someone will call you back shortly.',
    now,
  });
  assert.strictEqual(echo.action, 'ignore');
  assert.strictEqual(echo.reason, 'echo');
  assert.strictEqual(echo.stopTts, false);

  const empty = decideCallerEvent({
    text: '   ',
    speaking: true,
    turnBusy: true,
    speakStartedAt: now - 400,
    lastAgentText: AGENT_LINE,
    now,
  });
  assert.strictEqual(empty.action, 'ignore');
  assert.strictEqual(empty.reason, 'empty');

  const noise = decideCallerEvent({
    text: 'mm',
    speaking: true,
    turnBusy: true,
    speakStartedAt: now - 400,
    lastAgentText: AGENT_LINE,
    now,
  });
  assert.strictEqual(noise.reason, 'backchannel');
  assert.strictEqual(noise.stopTts, false);
});

test('skip-turn does not undo barge_listen or answers', () => {
  assert.strictEqual(shouldSkipCallerTurn('wait', { lastAgentText: AGENT_LINE }), true);
  assert.strictEqual(shouldSkipCallerTurn('sorry', { lastAgentText: BOOK_Q }), true);
  assert.strictEqual(shouldSkipCallerTurn('hold on', { lastAgentText: AGENT_LINE }), true);
  assert.strictEqual(shouldSkipCallerTurn('yes', { lastAgentText: BOOK_Q }), false);
  assert.strictEqual(shouldSkipCallerTurn('no', { lastAgentText: BOOK_Q }), false);
  assert.strictEqual(shouldSkipCallerTurn('actually, tomorrow', { lastAgentText: AGENT_LINE }), false);
  assert.strictEqual(shouldSkipCallerTurn('sawa', { lastAgentText: AGENT_LINE }), true);
  assert.strictEqual(shouldSkipCallerTurn('sawa', { lastAgentText: BOOK_Q }), false);
});

if (process.exitCode) {
  console.error(`\nFAILED (${passed} passed)`);
} else {
  console.log(`\nAll ${passed} tests passed.`);
}
