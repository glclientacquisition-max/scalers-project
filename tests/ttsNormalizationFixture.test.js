// Repeatable regression for tests/fixtures/tts-normalization.json (text pipeline only).
// Run: node tests/ttsNormalizationFixture.test.js
// Or: npm run test:tts-fixture

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { prepareForTts } = require('../src/speech/ttsNormalize');

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'tts-normalization.json');

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

const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

console.log('tts-normalization fixture');
test('fixture has universal + lexicon_control groups', () => {
  const groups = new Set(fixture.cases.map((c) => c.group));
  assert.ok(groups.has('universal'));
  assert.ok(groups.has('lexicon_control'));
  assert.strictEqual(fixture.cases.length, 20);
});

for (const c of fixture.cases) {
  test(`production pipeline:${c.id}`, () => {
    const prepared = prepareForTts(c.text, { callLanguage: c.callLanguage || 'en' });
    assert.strictEqual(
      prepared.language,
      c.expectLanguage,
      `language for ${c.id}: got ${prepared.language}`
    );
    if (c.expectProductionText != null) {
      assert.strictEqual(
        prepared.text,
        c.expectProductionText,
        `${c.id} production text mismatch`
      );
    }
  });
}

test('universal cases are tenant-agnostic (no ChapterOne in text)', () => {
  for (const c of fixture.cases.filter((row) => row.group === 'universal')) {
    assert.ok(
      !/chapterone|aisha|white paper/i.test(c.text),
      `${c.id} should not embed tenant-specific names in universal group`
    );
  }
});

if (process.exitCode) {
  console.error(`\nFAILED (${passed} passed before failure)`);
} else {
  console.log(`\nAll ${passed} tests passed.`);
}
