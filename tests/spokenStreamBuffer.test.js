// Tests for LLM→TTS spoken chunk buffering.
// Run: node tests/spokenStreamBuffer.test.js

const assert = require('assert');
const {
  stripMarkersForSpeech,
  splitSpeakableChunks,
  createSpokenStreamBuffer,
} = require('../src/speech/spokenStreamBuffer');

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

console.log('stripMarkersForSpeech');
test('removes complete tool blocks', () => {
  const raw =
    'Thanks, John. ###TOOL###{"save_caller_info":{"name":"John","reason":"plumbing"}}###ENDTOOL###';
  assert.strictEqual(stripMarkersForSpeech(raw, { final: true }), 'Thanks, John.');
});

test('holds incomplete tool marker while streaming', () => {
  const raw = 'Sawa. ###TOOL###{"save_caller_info":';
  assert.strictEqual(stripMarkersForSpeech(raw, { final: false }), 'Sawa.');
});

test('strips ENDCALL when final', () => {
  assert.strictEqual(
    stripMarkersForSpeech('Goodbye! ###ENDCALL###', { final: true }),
    'Goodbye!'
  );
});

console.log('splitSpeakableChunks');
test('flushes on sentence end', () => {
  const { chunks, rest } = splitSpeakableChunks('Hello there. How are', { final: false });
  assert.deepStrictEqual(chunks, ['Hello there.']);
  assert.strictEqual(rest, 'How are');
});

test('final flush drains remainder', () => {
  const { chunks, rest } = splitSpeakableChunks('One moment please', { final: true });
  assert.deepStrictEqual(chunks, ['One moment please']);
  assert.strictEqual(rest, '');
});

test('early comma flush for first audio', () => {
  const { chunks } = splitSpeakableChunks(
    'Sure, I can help with plumbing today',
    { final: false, earlyFlushChars: 20 }
  );
  assert.ok(chunks.length >= 1);
  assert.match(chunks[0], /Sure,/);
});

test('early word-window flush for first audio', () => {
  const { chunks, rest } = splitSpeakableChunks(
    'We can send someone this afternoon if that works',
    { final: false, earlyFlushChars: 18, earlyFlushWords: 5 }
  );
  assert.deepStrictEqual(chunks, ['We can send someone this']);
  assert.strictEqual(rest, 'afternoon if that works');
});

console.log('createSpokenStreamBuffer');
test('streams sentence then tools without speaking markers', () => {
  const buf = createSpokenStreamBuffer({ earlyFlushChars: 80 });
  assert.deepStrictEqual(buf.push('Thanks, '), []);
  assert.deepStrictEqual(buf.push('Jane.'), ['Thanks, Jane.']);
  assert.deepStrictEqual(buf.push(' ###TOOL###{"save_caller_info":{"name":"Jane"}}'), []);
  assert.deepStrictEqual(buf.push('###ENDTOOL###'), []);
  assert.deepStrictEqual(buf.finish(), []);
  assert.strictEqual(buf.getSpokenEmitted(), 'Thanks, Jane.');
});

test('flushes remainder on finish', () => {
  const buf = createSpokenStreamBuffer();
  assert.deepStrictEqual(buf.push('We can help tomorrow'), []);
  assert.deepStrictEqual(buf.finish(), ['We can help tomorrow']);
});

if (process.exitCode) {
  console.error(`\nFAILED (${passed} passed)`);
} else {
  console.log(`\nAll ${passed} tests passed.`);
}
