// Run: node tests/interimBarge.test.js

const assert = require('assert');
const { mergeInterimHypothesis } = require('../src/speech/interimBarge');

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

console.log('mergeInterimHypothesis');
test('grows cumulative hypothesis', () => {
  assert.strictEqual(mergeInterimHypothesis('wait', 'wait my'), 'wait my');
  assert.strictEqual(
    mergeInterimHypothesis('wait my', 'wait my name'),
    'wait my name'
  );
});
test('keeps longer previous on transient shrink', () => {
  assert.strictEqual(mergeInterimHypothesis('wait stop', 'wait'), 'wait stop');
});
test('appends non-cumulative fragments', () => {
  assert.strictEqual(mergeInterimHypothesis('hold', 'on please'), 'hold on please');
});
test('empty next keeps previous', () => {
  assert.strictEqual(mergeInterimHypothesis('sawa', ''), 'sawa');
});

if (process.exitCode) {
  console.error(`\nFAILED (${passed} passed)`);
} else {
  console.log(`\nAll ${passed} tests passed.`);
}
