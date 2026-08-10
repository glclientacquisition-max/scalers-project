// Turn-taking unit tests.
// Run: node tests/turnTaking.test.js

const assert = require('assert');
const {
  looksLikeEcho,
  utteranceLooksIncomplete,
  adaptiveFlushMs,
  evaluateBargeIn,
  hasBargeContent,
  agentAwaitingReply,
  classifyFinalDuringAgentSpeech,
} = require('../src/speech/turnTaking');

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

const isBackchannel = (t) =>
  ['ok', 'okay', 'sawa', 'yeah', 'mm', 'hello'].includes(
    String(t || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .trim()
  );

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
test('complete sentences are complete', () => {
  assert.strictEqual(utteranceLooksIncomplete('I need a plumber.'), false);
  assert.strictEqual(utteranceLooksIncomplete('My name is John'), false);
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
test('content barge while LLM thinking', () => {
  const d = evaluateBargeIn({
    text: 'Actually wait',
    speaking: false,
    turnBusy: true,
    speakStartedAt: 0,
    lastAgentText: 'One moment.',
    isBackchannel,
  });
  assert.strictEqual(d.barge, true);
  assert.strictEqual(d.reason, 'interrupt_llm');
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

if (process.exitCode) {
  console.error(`\nFAILED (${passed} passed)`);
} else {
  console.log(`\nAll ${passed} tests passed.`);
}
