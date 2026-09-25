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

test('default is sentence-only so TTS does not articulate a fragment', () => {
  const { chunks, rest } = splitSpeakableChunks(
    'We can send someone this afternoon if that works',
    { final: false, earlyFlushChars: 0, earlyFlushWords: 0 }
  );
  assert.deepStrictEqual(chunks, []);
  assert.match(rest, /We can send someone this afternoon/);
});

test('holds Sure. so it is not its own TTS utterance', () => {
  const { chunks, rest } = splitSpeakableChunks('Sure.', { final: false });
  assert.deepStrictEqual(chunks, []);
  assert.strictEqual(rest, 'Sure.');
});

test('joins Sure. onto the following question', () => {
  const { chunks } = splitSpeakableChunks(
    'Sure. Are you looking to clean a couch?',
    { final: false }
  );
  assert.deepStrictEqual(chunks, ['Sure. Are you looking to clean a couch?']);
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

test('never duplicates already emitted speech when tokens shift format mid-stream', () => {
  const buf = createSpokenStreamBuffer();
  const text =
    'Carpet cleaning ranges from 1,500 to 2,000 shillings depending on size. What time works for you?';
  const emitted = [];
  for (let i = 0; i < text.length; i += 10) {
    emitted.push(...buf.push(text.slice(i, i + 10)));
  }
  emitted.push(
    ...buf.push(' ###TOOL###{"create_appointment":{"when_text":"tomorrow at 10:00 AM"}}###ENDTOOL###')
  );
  emitted.push(...buf.finish());

  const joined = emitted.join(' ');
  const matchCount = (joined.match(/Carpet cleaning ranges/g) || []).length;
  assert.strictEqual(matchCount, 1, `Expected 1 occurrence of price line, got ${matchCount}`);
});

test('does not speak outcome claims or leftover prose after a tool block', () => {
  const buf = createSpokenStreamBuffer();
  const emitted = [];
  emitted.push(
    ...buf.push(
      'We are closed right now, but I can set up that booking attempt for tomorrow at 10 AM.'
    )
  );
  emitted.push(...buf.push(' Let me book that for you now.'));
  emitted.push(
    ...buf.push(
      ' ###TOOL###{"create_appointment":{"when_text":"tomorrow at 10:00 AM"}}###ENDTOOL###'
    )
  );
  emitted.push(...buf.finish());
  const joined = emitted.join(' ');
  assert.strictEqual((joined.match(/Let me book/g) || []).length, 0);
  assert.strictEqual((joined.match(/booking attempt/g) || []).length, 0);
  assert.strictEqual((joined.match(/We are closed right now/g) || []).length, 0);
});

test('does not speak ASR_CORRECTION_PROMPT / RETOTI / NP_FALSE from HD_ff24acf5207d', () => {
  const buf = createSpokenStreamBuffer();
  const leaked =
    'NP_FALSE ASR_CORRECTION_PROMPT: The user\'s input seems truncated or quiet. Ask for missing details or to repeat gently. RETOTI: Sawa, Alvin! Tunashukuru sana.';
  const emitted = [...buf.push(leaked), ...buf.finish()];
  const joined = emitted.join(' ');
  assert.doesNotMatch(joined, /ASR_CORRECTION_PROMPT|RETOTI|NP_FALSE|truncated or quiet|repeat gently/i);
  assert.match(joined, /Sawa, Alvin/);
  assert.match(joined, /Tunashukuru sana/);
});

test('does not speak Speak this spelling / VISIT COMMIT / Alvin said', () => {
  const buf = createSpokenStreamBuffer();
  const leaked =
    'Speak this spelling once in the next line. VISIT COMMIT (think this; never say it as a script): Alvin said they want carpet cleaning.';
  const emitted = [...buf.push(leaked), ...buf.finish()];
  const joined = emitted.join(' ');
  assert.doesNotMatch(
    joined,
    /Speak this spelling|VISIT COMMIT|think this|never say it as a script|Alvin said/i
  );
  assert.match(joined, /they want carpet cleaning/i);
});

test('keeps You said and I said confirmations', () => {
  const buf = createSpokenStreamBuffer();
  const emitted = [
    ...buf.push('You said Thursday. I said ten.'),
    ...buf.finish(),
  ];
  const joined = emitted.join(' ');
  assert.match(joined, /You said Thursday/);
  assert.match(joined, /I said ten/);
});

test('holds an incomplete Speak this suffix while streaming', () => {
  const buf = createSpokenStreamBuffer();
  assert.deepStrictEqual(buf.push('Sawa. Speak this spell'), []);
  const emitted = [...buf.push('ing once. Thursday works.'), ...buf.finish()];
  const joined = emitted.join(' ');
  assert.doesNotMatch(joined, /Speak this spelling/i);
  assert.match(joined, /Thursday works/);
});

test('holds an incomplete ASR_ label until the token finishes', () => {
  const buf = createSpokenStreamBuffer();
  assert.deepStrictEqual(buf.push('ASR_CORREC'), []);
  const emitted = [
    ...buf.push(
      'TION_PROMPT: The user\'s input seems truncated or quiet. RETOTI: Sawa.'
    ),
    ...buf.finish(),
  ];
  const joined = emitted.join(' ');
  assert.doesNotMatch(joined, /ASR_CORRECTION_PROMPT|RETOTI|truncated or quiet/i);
  assert.match(joined, /Sawa/);
});

test('does not speak a premature that-time-works claim', () => {
  const buf = createSpokenStreamBuffer();
  const emitted = [
    ...buf.push('Tuesday at 10 is fine. '),
    ...buf.push('That time works.'),
    ...buf.push(
      ' ###TOOL###{"create_appointment":{"when_text":"Tuesday 10 AM"}}###ENDTOOL###'
    ),
    ...buf.finish(),
  ];
  const joined = emitted.join(' ');
  assert.strictEqual((joined.match(/is fine/g) || []).length, 0);
  assert.strictEqual((joined.match(/That time works/g) || []).length, 0);
});

if (process.exitCode) {
  console.error(`\nFAILED (${passed} passed)`);
} else {
  console.log(`\nAll ${passed} tests passed.`);
}
