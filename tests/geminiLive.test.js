const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { modelStageProvider } = require('../src/speech/geminiLive');
const { createVoiceTrace, createMemorySink, SCHEMA_VERSION } = require('../src/speech/voiceTrace');
const { traceModelRequest } = require('../src/speech/turnTrace');

describe('gemini live trace seam', () => {
  const prev = process.env.VOICE_GEMINI_LIVE;
  afterEach(() => {
    if (prev == null) delete process.env.VOICE_GEMINI_LIVE;
    else process.env.VOICE_GEMINI_LIVE = prev;
  });

  it('stays off and keeps the current provider', () => {
    delete process.env.VOICE_GEMINI_LIVE;
    assert.equal(modelStageProvider('structured'), 'structured');
    assert.equal(modelStageProvider('gemini'), 'gemini');
  });

  it('records provider gemini-live on the model stage without a new column', () => {
    process.env.VOICE_GEMINI_LIVE = 'on';
    const sink = createMemorySink();
    const trace = createVoiceTrace({ enabled: true, sink, callId: 'live', tenantId: 't1' });
    trace.beginTurn({ callerText: 'hello', language: { current: 'en', confidence: 1 } });
    traceModelRequest(trace, {
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      promptId: 'voice.structured',
      promptVersion: '2026-10-06.1',
      language: 'en',
    });
    const record = trace.commitTurn({ outcome: 'ok' });
    const model = record.stages.find((row) => row.stage === 'model' && row.phase === 'request');
    assert.equal(model.provider, 'gemini-live');
    assert.equal(record.schemaVersion, SCHEMA_VERSION);
    assert.equal(Object.hasOwn(record, 'geminiLive'), false);
    assert.deepEqual(Object.keys(model).sort(), [
      'language',
      'model',
      'phase',
      'promptId',
      'promptVersion',
      'provider',
      'stage',
    ]);
  });
});
