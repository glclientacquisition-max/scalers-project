// Run: node tests/voiceTiming.test.js

const assert = require('assert');
const { createVoiceTurnTiming } = require('../src/speech/voiceTiming');

const t0 = Date.now() - 50;
const timing = createVoiceTurnTiming('sid-1', { turnStartedAt: t0 });
timing.markLlmStart();
timing.markFirstSpokenChunk();
timing.markFirstPcm();
timing.markFiller();

const summary = timing.summary({ outcome: 'ok' });
assert.strictEqual(summary.callSid, 'sid-1');
assert.strictEqual(summary.filler, 1);
assert.ok(summary.turn_ms >= 50);
assert.ok(summary.first_chunk_ms != null);
assert.ok(summary.first_pcm_ms != null);
assert.strictEqual(summary.outcome, 'ok');

console.log('voiceTiming markers ok.');
