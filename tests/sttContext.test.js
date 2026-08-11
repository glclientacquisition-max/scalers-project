// Unit tests for Soniox STT context builder (hearing-path vocabulary).
// Run: node tests/sttContext.test.js

const assert = require('assert');
const {
  buildSttContext,
  curateTerms,
  isSttContextEnabled,
} = require('../src/speech/sttContext');

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

console.log('sttContext');

test('buildSttContext uses Soniox structured general + curated terms', () => {
  const ctx = buildSttContext({
    businessName: 'Ngong Hills Hotel',
    agentName: 'Zara',
    vertical: 'hospitality',
    servicesCatalog: [
      { name: 'Executive Suite' },
      { name: 'Art n Soul Lounge' },
      { name: 'Esquire Restaurant' },
    ],
    businessLocations: [
      { label: 'Main Lodge', landmark: 'Ngong Road' },
    ],
    teamDirectory: [{ name: 'Wanjiku' }],
    ttsLexicon: [{ match: 'Art n Soul', say: 'Art and Soul' }],
  });

  assert.ok(ctx);
  assert.ok(Array.isArray(ctx.general));
  assert.ok(ctx.general.some((g) => g.key === 'organization' && g.value === 'Ngong Hills Hotel'));
  assert.ok(ctx.general.some((g) => g.key === 'agent' && g.value === 'Zara'));
  assert.ok(ctx.general.some((g) => g.key === 'languages'));
  assert.ok(ctx.terms.includes('Ngong Hills Hotel'));
  assert.ok(ctx.terms.includes('Art n Soul Lounge'));
  assert.ok(ctx.terms.includes('Esquire Restaurant'));
  assert.ok(ctx.terms.includes('Executive Suite'));
  assert.ok(ctx.terms.includes('Wanjiku'));
  assert.ok(ctx.terms.includes('Ngong Road'));
});

test('curateTerms caps and dedupes case-insensitively', () => {
  const terms = curateTerms(
    ['Ngong Hills Hotel', 'ngong hills hotel', 'Hotel', 'Executive Suite', 'A'],
    10
  );
  assert.strictEqual(terms.filter((t) => /ngong hills hotel/i.test(t)).length, 1);
  assert.ok(!terms.includes('A'));
});

test('skips regex-y lexicon matches', () => {
  const ctx = buildSttContext({
    businessName: 'Demo Co',
    agentName: 'Ada',
    ttsLexicon: [{ match: 'm-?pesa', say: 'M-Pesa' }],
  });
  assert.ok(ctx.terms.includes('Demo Co'));
  assert.ok(!ctx.terms.some((t) => t.includes('?')));
});

test('null tenant → null context', () => {
  assert.strictEqual(buildSttContext(null), null);
  assert.strictEqual(buildSttContext({}), null);
});

test('isSttContextEnabled respects SONIOX_STT_CONTEXT=off', () => {
  const prev = process.env.SONIOX_STT_CONTEXT;
  process.env.SONIOX_STT_CONTEXT = 'off';
  assert.strictEqual(isSttContextEnabled(), false);
  process.env.SONIOX_STT_CONTEXT = 'on';
  assert.strictEqual(isSttContextEnabled(), true);
  if (prev == null) delete process.env.SONIOX_STT_CONTEXT;
  else process.env.SONIOX_STT_CONTEXT = prev;
});

console.log(`\nsttContext: ${passed} passed`);
