// Unit tests for TTS pronunciation prep (Slices 1–6).
// Run: node tests/ttsNormalize.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  prepareForTts,
  resolveTtsLanguage,
  detectUtteranceTtsLang,
  normalizeForTts,
} = require('../src/speech/ttsNormalize');
const {
  applyLexicon,
  listLexiconEntries,
  parseLexiconOverrides,
} = require('../src/speech/pronunciationLexicon');
const {
  expandMoney,
  expandTimes,
  expandDayRanges,
  numberToSw,
} = require('../src/speech/spokenForms');
const { rewriteShengForTts, shouldRewriteSheng } = require('../src/speech/shengRewrite');
const { speedForLanguage } = require('../src/speech/sonioxTts');

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

test('tenant overrides win over defaults', () => {
  const out = applyLexicon('Meet Wanjiku in Ruiru', 'en', [
    { match: 'wanjiku', say: 'Wan-jee-koo', priority: 200 },
  ]);
  assert.match(out, /Wan-jee-koo/);
  assert.match(out, /Roo-ee-roo/);
});

test('parseLexiconOverrides validates JSON', () => {
  const parsed = parseLexiconOverrides(
    '[{"match":"kamau","say":"Kah-mau"},{"match":"","say":"x"}]'
  );
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].say, 'Kah-mau');
});

console.log('spokenForms');
test('expandMoney EN/SW', () => {
  assert.match(expandMoney('KES 5000', 'en'), /five thousand shillings/);
  assert.match(expandMoney('2000 bob', 'en'), /two thousand shillings/);
  assert.match(expandMoney('Ksh 1500', 'sw'), /shilingi elfu moja mia tano/);
  assert.ok(numberToSw(2000).includes('elfu'));
});

test('expandTimes + day ranges', () => {
  assert.match(expandTimes('Open 8am close 6:30pm', 'en'), /8 A M/);
  assert.match(expandTimes('Open 8am close 6:30pm', 'en'), /6 30 P M/);
  assert.match(expandTimes('Fungua 8am', 'sw'), /saa 8 asubuhi/);
  assert.match(expandDayRanges('Mon-Sat', 'en'), /Monday to Saturday/);
  assert.match(expandDayRanges('Mon-Sat', 'sw'), /Jumatatu hadi Jumamosi/);
});

console.log('shengRewrite');
test('rewrites common Sheng for English TTS', () => {
  assert.ok(shouldRewriteSheng('Niaje', 'en'));
  const out = rewriteShengForTts('Niaje msee, niko poa');
  assert.match(out, /nee-ah-jay/i);
  assert.match(out, /mseh/i);
  assert.match(out, /poh-ah/i);
});

console.log('resolveTtsLanguage / prepareForTts');
test('per-utterance SW detection', () => {
  assert.strictEqual(detectUtteranceTtsLang('Sawa asante sana'), 'sw');
  assert.strictEqual(resolveTtsLanguage('Sawa asante.', 'en'), 'sw');
});

test('sticky SW + sheng ride rules', () => {
  assert.strictEqual(resolveTtsLanguage('Karibu.', 'sw'), 'sw');
  assert.strictEqual(resolveTtsLanguage('Niaje, niko poa', 'sheng'), 'en');
  assert.strictEqual(resolveTtsLanguage('Okay sure', 'mixed'), 'en');
});

test('forced language wins', () => {
  assert.strictEqual(resolveTtsLanguage('Sawa asante', 'en', 'en'), 'en');
  assert.strictEqual(resolveTtsLanguage('Hello', 'en', 'sw'), 'sw');
});

test('prepareForTts full pipeline', () => {
  const prepared = prepareForTts('Call +254712345678 about mpesa in Thika…', {
    callLanguage: 'en',
  });
  assert.strictEqual(prepared.language, 'en');
  assert.match(prepared.text, /M-Pesa/);
  assert.match(prepared.text, /Thee-kah/);
  assert.match(prepared.text, /2 5 4 7 1 2 3 4 5 6 7 8/);
  assert.ok(!prepared.text.includes('…'));
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

console.log('speedForLanguage');
test('SW speed env override', () => {
  const prev = process.env.SONIOX_TTS_SPEED_SW;
  process.env.SONIOX_TTS_SPEED_SW = '0.9';
  assert.strictEqual(speedForLanguage('sw'), 0.9);
  if (prev == null) delete process.env.SONIOX_TTS_SPEED_SW;
  else process.env.SONIOX_TTS_SPEED_SW = prev;
});

test('default speaking tempo is 1.02 when SONIOX_TTS_SPEED unset', () => {
  const { spawnSync } = require('child_process');
  const script = `
    delete process.env.SONIOX_TTS_SPEED;
    delete process.env.SONIOX_TTS_SPEED_EN;
    delete process.env.SONIOX_TTS_SPEED_SW;
    const { speedForLanguage } = require('./src/speech/sonioxTts');
    if (speedForLanguage('en') !== 1.02) process.exit(2);
    if (speedForLanguage('sw') !== 1.02) process.exit(3);
  `;
  const r = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env },
    encoding: 'utf8',
  });
  assert.strictEqual(
    r.status,
    0,
    `default TTS speed should be 1.02 (status=${r.status} stderr=${r.stderr})`
  );
});

console.log('golden fixtures');
const goldenPath = path.join(__dirname, 'fixtures', 'pronunciation.json');
const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
for (const c of golden.cases) {
  test(`golden:${c.id}`, () => {
    const prepared = prepareForTts(c.text, {
      callLanguage: c.callLanguage,
      extraLexicon: c.extraLexicon,
    });
    assert.strictEqual(
      prepared.language,
      c.expectLanguage,
      `lang for ${c.id}: got ${prepared.language}, spoken=${prepared.text}`
    );
    for (const needle of c.expectIncludes || []) {
      assert.ok(
        prepared.text.toLowerCase().includes(String(needle).toLowerCase()),
        `${c.id} missing "${needle}" in "${prepared.text}"`
      );
    }
  });
}

if (process.exitCode) {
  console.error(`\nFAILED (${passed} passed before failure path)`);
} else {
  console.log(`\nAll ${passed} tests passed.`);
}
