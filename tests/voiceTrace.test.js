const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  voiceTraceEnabled,
  redactText,
  createMemorySink,
  createVoiceTrace,
  readJsonl,
} = require('../src/speech/voiceTrace');

describe('voice trace flag', () => {
  it('stays on for staging and off for production names', () => {
    assert.equal(voiceTraceEnabled({ VOICE_TRACE: 'auto', RAILWAY_ENVIRONMENT_NAME: 'staging' }), true);
    assert.equal(voiceTraceEnabled({ VOICE_TRACE: 'auto', RAILWAY_ENVIRONMENT_NAME: 'production' }), false);
    assert.equal(voiceTraceEnabled({ VOICE_TRACE: 'on', RAILWAY_ENVIRONMENT_NAME: 'production' }), true);
    assert.equal(voiceTraceEnabled({ VOICE_TRACE: 'off' }), false);
    assert.equal(voiceTraceEnabled({ VOICE_TRACE: 'auto', NODE_ENV: 'production' }), false);
    assert.equal(voiceTraceEnabled({}), true);
  });
});

describe('voice trace redact', () => {
  it('redacts email and long phone numbers and keeps prices', () => {
    const text = redactText('Call +254712345678 or a@b.co about elfu tano and 5000.');
    assert.match(text, /\[phone:5678\]/);
    assert.match(text, /\[email\]/);
    assert.match(text, /elfu tano/);
    assert.match(text, /5000/);
  });
});

describe('voice trace session', () => {
  it('writes one turn record and one call record', async () => {
    const sink = createMemorySink();
    const trace = createVoiceTrace({
      enabled: true,
      sink,
      callId: () => 'HD_test',
      tenantId: () => 'df4ad9d8-28ff-4810-b1e6-94f5495472b0',
      voiceId: () => 'voice-1',
    });
    trace.noteStt({
      text: 'habari',
      isFinal: true,
      tokens: [{ text: 'habari', final: true, language: 'sw', startMs: 0, endMs: 400 }],
    });
    trace.beginTurn({ callerText: 'habari', language: { current: 'sw', confidence: 0.9 } });
    trace.noteTurnEnd({ decision: 'flush', reason: 'endpoint' });
    trace.noteModelRequest({
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      promptId: 'voice.system',
      promptVersion: '2026-10-06',
      language: 'sw',
    });
    trace.noteModelOutput({ outputText: 'Karibu.', chars: 7, spokenEmitted: 7, firstTokenAt: 1500 });
    trace.noteTts({ text: 'Karibu.', language: 'sw', voiceId: 'voice-1' });
    const turn = trace.commitTurn({ outcome: 'ok', turnStartedAt: 1000, latency: { first_pcm_ms: 800 } });
    assert.equal(turn.schema, 'scalers.voice.turn');
    assert.equal(turn.pii, 'transcript');
    assert.equal(turn.caller.language, 'sw');
    assert.ok(turn.stages.some((row) => row.stage === 'stt' && row.tokens[0].language === 'sw'));
    assert.ok(turn.stages.some((row) => row.stage === 'model' && row.phase === 'request' && row.promptId === 'voice.system'));
    const latency = turn.stages.find((row) => row.stage === 'latency');
    assert.equal(latency.callerStopToModelFirstTokenMs, 500);
    assert.equal(latency.callerStopToFirstTtsPcmMs, 800);
    const call = await trace.finishCall();
    assert.equal(call.recordKind, 'call');
    assert.equal(call.turnCount, 1);
    assert.equal(sink.records.length, 2);
  });

  it('appends jsonl that can be read back', async () => {
    const file = path.join(os.tmpdir(), `voice-trace-${Date.now()}.jsonl`);
    const trace = createVoiceTrace({
      enabled: true,
      env: { VOICE_TRACE_SINK: 'jsonl', VOICE_TRACE_JSONL: file },
      callId: 'HD_jsonl',
      tenantId: 'not-a-uuid',
    });
    trace.beginTurn({ callerText: 'ping' });
    trace.commitTurn({ outcome: 'ok' });
    await trace.finishCall();
    const rows = readJsonl(file);
    assert.equal(rows.filter((row) => row.recordKind === 'turn').length, 1);
    fs.unlinkSync(file);
  });

  it('does nothing when disabled', () => {
    const trace = createVoiceTrace({ enabled: false });
    assert.equal(trace.beginTurn({ callerText: 'x' }), null);
    assert.equal(trace.commitTurn({ outcome: 'ok' }), null);
  });
});
