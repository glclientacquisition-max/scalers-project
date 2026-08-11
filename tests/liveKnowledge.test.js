// Unit tests for live ground truth / unknown-answer policy (Brain lane).
// Run: node tests/liveKnowledge.test.js

const assert = require('assert');
const {
  buildLiveGroundTruth,
  formatUnknownAnswerPolicy,
} = require('../src/conversation/liveKnowledge');
const { buildSystemPrompt, CONVERSATION_RULES } = require('../src/prompts');

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

console.log('liveKnowledge unknown-answer policy');

test('formatUnknownAnswerPolicy admits unknown without forcing a lead', () => {
  const text = formatUnknownAnswerPolicy('');
  assert.match(text, /UNKNOWN ANSWER POLICY/);
  assert.match(text, /Do NOT invent/i);
  assert.match(text, /Do not force name\/reason capture/i);
  assert.match(text, /I don't have that detail/i);
  assert.doesNotMatch(text, /will follow up|will call|atakupigia/i);
});

test('formatUnknownAnswerPolicy prefers owner custom line', () => {
  const text = formatUnknownAnswerPolicy('Boss atakupigia leo.');
  assert.match(text, /Owner preferred line/);
  assert.match(text, /Boss atakupigia leo\./);
  assert.match(text, /remove any callback time/i);
  assert.doesNotMatch(text, /Default line ideas/);
});

test('buildLiveGroundTruth injects unknown policy without custom line', () => {
  const truth = buildLiveGroundTruth({
    servicesCatalog: [{ name: 'Plumbing', price_range: 'quote after visit' }],
    faqs: [],
    teamDirectory: [],
  });
  assert.match(truth, /LIVE GROUND TRUTH/);
  assert.match(truth, /UNKNOWN ANSWER POLICY/);
  assert.match(truth, /Do NOT invent/i);
  assert.doesNotMatch(truth, /Owner preferred line/);
});

test('buildLiveGroundTruth includes custom unknown request line', () => {
  const truth = buildLiveGroundTruth({
    servicesCatalog: [{ name: 'Cleaning' }],
    unknownAnswerFallback: 'Let me note that — the boss will call you back today.',
  });
  assert.match(truth, /Owner preferred line/);
  assert.match(truth, /boss will call you back today/);
});

test('CONVERSATION_RULES require admit-unknown behavior', () => {
  assert.match(CONVERSATION_RULES, /UNKNOWN ANSWERS/);
  assert.match(CONVERSATION_RULES, /do not know/i);
});

test('buildSystemPrompt surfaces unknown policy via live ground truth', () => {
  const prompt = buildSystemPrompt({
    businessName: 'Test Biz',
    agentName: 'Amina',
    servicesCatalog: [{ name: 'Plumbing' }],
    unknownAnswerFallback: 'Tutakupigia baadaye.',
  });
  assert.match(prompt, /UNKNOWN ANSWER POLICY/);
  assert.match(prompt, /Tutakupigia baadaye/);
  assert.match(prompt, /UNKNOWN ANSWERS/);
});

console.log(`\n${passed} passed`);
if (process.exitCode) process.exit(process.exitCode);
