// Run: node tests/voiceTiming.test.js

const assert = require('assert');
const {
  createVoiceTurnTiming,
  persistableLatencyMs,
  createCallTranscript,
} = require('../src/speech/voiceTiming');

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

assert.strictEqual(persistableLatencyMs({ first_pcm_ms: 812, first_chunk_ms: 400 }), 812);
assert.strictEqual(persistableLatencyMs({ first_pcm_ms: null, first_chunk_ms: 401.6 }), 402);
assert.strictEqual(persistableLatencyMs({ first_pcm_ms: null, first_chunk_ms: null }), null);
assert.strictEqual(persistableLatencyMs({}), null);
console.log('persistableLatencyMs prefers PCM then chunk.');

const log = createCallTranscript();
log.pushAgent('Karibu. How can I help?');
log.pushCaller('I need a quote');
log.pushAgent('Sure, what service?');
log.pushAgent('Anything else?');
log.stampFromSummary({ first_pcm_ms: 940, first_chunk_ms: 500 });
log.pushCaller('Yes');
const turns = log.turns();
assert.strictEqual(turns.length, 5);
assert.deepStrictEqual(
  turns.map((row) => ({ speaker: row.speaker, latencyMs: row.latencyMs })),
  [
    { speaker: 'agent', latencyMs: null },
    { speaker: 'caller', latencyMs: null },
    { speaker: 'agent', latencyMs: 940 },
    { speaker: 'agent', latencyMs: null },
    { speaker: 'caller', latencyMs: null },
  ]
);
assert.strictEqual(turns[0].text, 'Karibu. How can I help?');
assert.strictEqual(turns[2].text, 'Sure, what service?');
log.stampFromSummary({ first_pcm_ms: 210 });
assert.strictEqual(log.turns()[2].latencyMs, 940);
assert.strictEqual(log.turns()[3].latencyMs, null);
console.log('createCallTranscript stamps first agent after last caller.');
