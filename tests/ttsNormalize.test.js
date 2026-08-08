// Unit tests for TTS pronunciation prep (Slice 1+2).
// Run: node tests/ttsNormalize.test.js

const assert = require('assert');
const {
  prepareForTts,
  resolveTtsLanguage,
  detectUtteranceTtsLang,
  normalizeForTts,
} = require('../src/speech/ttsNormalize');
const { applyLexicon, listLexiconEntries } = require('../src/speech/pronunciationLexicon');

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

console.log('pronunciationLexicon');
test('seeds Kenya brands/places/services', () => {
  const entries = listLexiconEntries();
  assert.ok(entries.length >= 30, `expected >=30 entries, got ${entries.length}`);
  const matches = entries.map((e) => e.match).join(' ');
  assert.ok(matches.includes('m-?pesa'));
  assert.ok(matches.includes('ruiru'));
  assert.ok(matches.includes('whatsapp'));
  assert.ok(matches.includes('geyser'));
});

test('applies brand + place rewrites', () => {
  const out = applyLexicon('Pay via mpesa near Ruiru CBD', 'en');
  assert.match(out, /M-Pesa/);
  assert.match(out, /Roo-ee-roo/);
  assert.match(out, /C B D/);
});

test('multi-word place beats shorter tokens', () => {
  const out = applyLexicon('We cover Ongata Rongai and Athi River', 'en');
  assert.match(out, /Ongata Rongai/);
  assert.match(out, /Athi River/);
});

console.log('resolveTtsLanguage / prepareForTts');
test('per-utterance SW detection', () => {
  assert.strictEqual(detectUtteranceTtsLang('Sawa asante sana'), 'sw');
  assert.strictEqual(resolveTtsLanguage('Sawa asante.', 'en'), 'sw');
});

test('sticky SW used when utterance inconclusive', () => {
  assert.strictEqual(resolveTtsLanguage('Karibu.', 'sw'), 'sw');
  assert.strictEqual(resolveTtsLanguage('One moment.', 'sheng'), 'en');
});

test('sheng and mixed ride English TTS', () => {
  assert.strictEqual(resolveTtsLanguage('Niaje, niko poa', 'sheng'), 'en');
  assert.strictEqual(resolveTtsLanguage('Okay sure', 'mixed'), 'en');
});

test('forced language wins', () => {
  assert.strictEqual(resolveTtsLanguage('Sawa asante', 'en', 'en'), 'en');
  assert.strictEqual(resolveTtsLanguage('Hello', 'en', 'sw'), 'sw');
});

test('prepareForTts pipeline: lexicon + phones + punctuation', () => {
  const prepared = prepareForTts('Call +254712345678 about mpesa in Thika…', {
    callLanguage: 'en',
  });
  assert.strictEqual(prepared.language, 'en');
  assert.match(prepared.text, /M-Pesa/);
  assert.match(prepared.text, /Thee-kah/);
  assert.match(prepared.text, /2 5 4 7 1 2 3 4 5 6 7 8/);
  assert.ok(!prepared.text.includes('…'));
  assert.ok(!prepared.text.includes('...'));
});

test('prepareForTts strips markdown and picks SW', () => {
  const prepared = prepareForTts('**Sawa**, asante. Tutakupigia.', { callLanguage: 'en' });
  assert.strictEqual(prepared.language, 'sw');
  assert.ok(!prepared.text.includes('*'));
});

test('normalizeForTts legacy helper returns spoken text', () => {
  const spoken = normalizeForTts('WhatsApp me near Westlands');
  assert.match(spoken, /WhatsApp/);
  assert.match(spoken, /West-lands/);
});

test('empty input is safe', () => {
  const prepared = prepareForTts('   ');
  assert.deepStrictEqual(prepared, { original: '', text: '', language: 'en' });
});

if (process.exitCode) {
  console.error(`\nFAILED (${passed} passed before failure path)`);
} else {
  console.log(`\nAll ${passed} tests passed.`);
}
