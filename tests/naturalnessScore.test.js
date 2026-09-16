// Roboticness scorecard unit tests.
// Run: node tests/naturalnessScore.test.js

const assert = require('assert');
const {
  isTinyLeadIn,
  scoreAgentTurn,
  scoreCall,
  parseSpokenLogLines,
} = require('../src/speech/naturalnessScore');

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

console.log('naturalnessScore');

test('Sure. alone is a tiny lead-in', () => {
  assert.strictEqual(isTinyLeadIn('Sure.'), true);
  assert.strictEqual(isTinyLeadIn("I'm listening!"), true);
  assert.strictEqual(isTinyLeadIn('Sure, I can write that down for you.'), false);
});

test('V2 flags a solo Sure. turn', () => {
  const flags = scoreAgentTurn('Sure.');
  assert.ok(flags.some((f) => f.id === 'V2' && f.lane === 'voice'));
});

test('V3 flags Al-vin say-form, keeps Air-tel', () => {
  const bad = scoreAgentTurn('Thank you for calling Done and Dusted Cleaning Services, Al-vin.');
  assert.ok(bad.some((f) => f.id === 'V3'));
  const ok = scoreAgentTurn('You can pay with Air-tel or M-Pesa.');
  assert.ok(!ok.some((f) => f.id === 'V3'));
});

test('V4 flags an em dash that reached TTS', () => {
  const flags = scoreAgentTurn('I do not have that exact detail — we specialize in house cleaning.');
  assert.ok(flags.some((f) => f.id === 'V4'));
});

test('V5 flags I am listening as its own turn', () => {
  const flags = scoreAgentTurn("I'm listening! What is your name?");
  assert.ok(flags.some((f) => f.id === 'V5'));
});

test('V6 flags idle poke', () => {
  const flags = scoreAgentTurn('Are you still there?');
  assert.ok(flags.some((f) => f.id === 'V6' && f.lane === 'voice'));
});

test('V8 flags a fake volume change', () => {
  const flags = scoreAgentTurn("I understand, I'll speak clearer and louder for you.");
  assert.ok(flags.some((f) => f.id === 'V8'));
});

test('B1 flags a service list after how-are-you', () => {
  const flags = scoreAgentTurn(
    'Sure! Are you looking to clean a couch, carpet, mattress, or perhaps general house cleaning?',
    { prevCaller: 'How are you doing, Shy?' }
  );
  assert.ok(flags.some((f) => f.id === 'B1' && f.lane === 'brain'));
});

test('a asked-for catalogue list is not B1', () => {
  const flags = scoreAgentTurn(
    'We offer couch, mattress, carpet, general house or Airbnb cleaning, and pet stain removal.',
    { prevCaller: 'Which service do you offer?' }
  );
  assert.ok(!flags.some((f) => f.id === 'B1'));
});

test('scoreCall fails HD_3f7ed2a5f526-shaped leaks and tags Brain separately', () => {
  const result = scoreCall({
    turns: [
      { speaker: 'agent', text: 'Thank you for calling Done and Dusted Cleaning Services, this is Shy speaking. How can I help?' },
      { speaker: 'caller', text: 'How are you doing, Shy?' },
      { speaker: 'agent', text: 'Sure!' },
      { speaker: 'agent', text: 'Sure! Are you looking to clean a couch, carpet, mattress, or perhaps general house cleaning?' },
      { speaker: 'agent', text: "I'm listening! What is your name and how can the team help with your roof?" },
      { speaker: 'agent', text: 'Thank you for calling Done and Dusted Cleaning Services, Al-vin.' },
    ],
    spokenLogs:
      '[soniox-tts][HD_x] chunk spoken="Thank you for calling Done and Dusted Cleaning Services, Al-vin."',
  });
  assert.strictEqual(result.pass, false);
  assert.ok(result.voiceFailIds.includes('V2'));
  assert.ok(result.voiceFailIds.includes('V3'));
  assert.ok(result.voiceFailIds.includes('V5'));
  assert.ok(result.brainNotes.some((f) => f.id === 'B1'));
});

test('clean phatic call passes Voice', () => {
  const result = scoreCall({
    turns: [
      { speaker: 'agent', text: 'Good morning, this is Shy at Done and Dusted Cleaning Services. How can I help you?' },
      { speaker: 'caller', text: 'How are you doing, Shy?' },
      { speaker: 'agent', text: "I'm well, thanks. How can I help?" },
      { speaker: 'caller', text: 'Carpet cleaning tomorrow in Rongai.' },
      { speaker: 'agent', text: 'Yes, Rongai is in our Nairobi area. What name should I put on the visit?' },
    ],
  });
  assert.strictEqual(result.pass, true);
  assert.deepStrictEqual(result.voiceFailIds, []);
});

test('V5 flags a closer Okay. that reopened how-are-you', () => {
  const flags = scoreAgentTurn("I'm well. Who is calling?", { prevCaller: 'Okay.' });
  assert.ok(flags.some((f) => f.id === 'V5' && f.lane === 'voice'));
});

test('thinking-ack Mm-hmm. in spoken= is not a hyphen name', () => {
  const result = scoreCall({
    turns: [{ speaker: 'agent', text: 'I can help add carpet cleaning to your visit, Alvin.' }],
    spokenLogs: '[soniox-tts] chunk spoken="Mm-hmm."',
  });
  assert.ok(!result.voiceFailIds.includes('V3'));
  assert.ok(!result.voiceFailIds.includes('V2'));
});

test('parseSpokenLogLines reads spoken= fields', () => {
  const lines = parseSpokenLogLines(
    '[soniox-tts] chunk spoken="Hello there."\n[ws/media] tts prep spoken="Sawa."'
  );
  assert.deepStrictEqual(lines, ['Hello there.', 'Sawa.']);
});

console.log(`\n${passed} tests passed`);
