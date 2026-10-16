'use strict';
// Regression-9 R6 (HD_30a3970034a4): the outage decision as a pure function.
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideSpeechOutage } = require('../src/speech/outageDebounce');
const { shouldDeclareSpeechOutage } = require('../src/speech/speechOutageNotify');
const fx = require('./fixtures/outage/HD_30a3970034a4.json');
const STALE = { code: 400, message: 'Stream abc123 not found' };

test('one stale "Stream not found" is not an outage', () => {
  assert.equal(shouldDeclareSpeechOutage([STALE]), false);
  assert.equal(decideSpeechOutage([STALE]).action, 'retry');
});
test('HD_30a3970034a4: errors after ws close are ignored', () => {
  const events = fx.events.filter((e) => /error|closed/.test(e.type) || e.tts === null)
    .map((e) => ({ at: e.t, message: e.message || 'tts unavailable', code: /^400/.test(e.message || '') ? 400 : undefined, closed: true }));
  const d = decideSpeechOutage(events);
  assert.equal(d.outage, false);
  assert.equal(d.action, fx.expectedWithFlag.decision);
});
test('two failures in the window, a failed probe, or billing are outages', () => {
  assert.equal(shouldDeclareSpeechOutage([{ ...STALE, at: 0 }, { message: 'tts unavailable', at: 3000 }]), true);
  assert.equal(shouldDeclareSpeechOutage([{ ...STALE, at: 0 }, { message: 'tts unavailable', at: 30000 }]), false);
  assert.equal(shouldDeclareSpeechOutage([{ message: 'x', probeFailed: true }]), true);
  assert.equal(shouldDeclareSpeechOutage([{ code: 402, message: 'balance exhausted' }]), true);
  assert.equal(shouldDeclareSpeechOutage([{ code: 401, message: 'unauthorized' }]), true);
  assert.equal(shouldDeclareSpeechOutage([STALE, { ok: true }, STALE]), false);
  assert.equal(shouldDeclareSpeechOutage([]), false);
});
