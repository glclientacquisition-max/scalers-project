'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runFixtures } = require('../evals/replay/run');

test('replay fixtures for bugs A to F, Ask, quote, and the hours turn', () => {
  const res = runFixtures();
  assert.deepEqual(res.failures, [], res.failures.join('\n'));
  assert.equal(res.totals.inventedFacts, 0);
  assert.equal(res.totals.falseNotOnFile, 0);
  assert.equal(res.totals.callbacksOnly, 0);
  assert.equal(res.totals.languageMismatch, 0);
  assert.equal(res.totals.falseDeletions, 0);
  assert.ok(res.p95 <= 50, `p95 ${res.p95}`);
});
