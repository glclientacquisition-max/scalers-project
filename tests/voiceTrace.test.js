const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  voiceTraceEnabled,
  voiceRelease,
  callTraceColumns,
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
    const range = redactText('Carpet cleaning is Ksh 1500-2000.');
    assert.match(range, /1500-2000/);
    assert.doesNotMatch(range, /\[phone:2000\]/);
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

  it('writes score, checks, diagnosis, and release on the call', async () => {
    const sink = createMemorySink();
    const trace = createVoiceTrace({
      enabled: true,
      sink,
      env: {
        RAILWAY_GIT_COMMIT_SHA: 'abc123',
        RAILWAY_GIT_BRANCH: 'main',
        VOICE_RELEASE_LABEL: 'staging-listen',
      },
      callId: () => 'HD_score',
    });
    for (const caller of ['Hello', 'Alvin', 'Yes']) {
      trace.beginTurn({ callerText: caller, language: { current: 'en' } });
      trace.noteTts({ text: 'May I have your name.', language: 'en' });
      trace.commitTurn({ outcome: 'ok' });
    }
    const call = await trace.finishCall();
    assert.equal(typeof call.score, 'number');
    assert.ok(call.score >= 0 && call.score <= 100);
    assert.equal(call.checks.repeatedQuestion, 2);
    assert.equal(call.diagnosis, 'Name asked 3 times (turns 1, 2, 3)');
    assert.deepEqual(call.release, {
      gitSha: 'abc123',
      branch: 'main',
      label: 'staging-listen',
    });
    assert.deepEqual(callTraceColumns(call), {
      score: call.score,
      checks: call.checks,
      diagnosis: call.diagnosis,
      release: call.release,
    });
    const turnRow = sink.records[0];
    assert.equal(turnRow.score, 100);
    assert.equal(turnRow.checks.repeatedQuestion, 0);
    assert.ok(Array.isArray(turnRow.notes));
    assert.equal(turnRow.caller.language, 'en');
    assert.equal(turnRow.caller.sticky, 'en');
    assert.deepEqual(callTraceColumns(turnRow), {
      score: 100,
      checks: turnRow.checks,
      diagnosis: null,
      release: null,
    });
    assert.deepEqual(voiceRelease({ GIT_SHA: 'from-git', RAILWAY_GIT_BRANCH: 'cursor/voice' }), {
      gitSha: 'from-git',
      branch: 'cursor/voice',
      label: null,
    });
  });

  it('records speak packet commit and slot drain on the turn', async () => {
    const sink = createMemorySink();
    const trace = createVoiceTrace({ enabled: true, sink, callId: 'HD_speak' });
    trace.beginTurn({ callerText: 'Huduma gani?', language: { current: 'sw' } });
    trace.noteLanguage({ detected: 'unknown', sticky: 'sw', soniox: 'sw', confidence: 0.4 });
    trace.noteFiller({ text: 'Mm-hmm', before: 'Mm-hmm.', language: 'sw' });
    trace.noteTool({
      name: 'save_caller_info',
      status: 'succeeded',
      args: 'name=Alvin reason=Service inquiry',
    });
    trace.noteSpeakSlots({
      action: 'enqueue',
      slots: [{ outcome: 'catalogue', line: 'Tuna usafi.', language: 'sw' }],
    });
    trace.noteSpeakPacket({
      tier: 'public',
      outcome: 'catalogue',
      text: 'Tuna usafi.',
      committed: true,
    });
    trace.noteSpeakSlots({
      action: 'drain',
      slots: [{ outcome: 'catalogue', line: 'Tuna usafi.', language: 'sw' }],
    });
    const turn = trace.commitTurn({ outcome: 'ok' });
    const packet = turn.stages.find((row) => row.stage === 'speak_packet');
    const slots = turn.stages.filter((row) => row.stage === 'speak_slots');
    assert.equal(packet.tier, 'public');
    assert.equal(packet.outcome, 'catalogue');
    assert.equal(packet.committed, true);
    assert.deepEqual(slots.map((row) => row.action), ['enqueue', 'drain']);
    assert.equal(turn.caller.detected, 'unknown');
    assert.equal(turn.caller.sticky, 'sw');
    assert.equal(turn.caller.soniox, 'sw');
    assert.equal(turn.stages.find((row) => row.stage === 'language').soniox, 'sw');
    assert.equal(turn.caller.language, 'sw');
    const filler = turn.stages.find((row) => row.stage === 'filler');
    const tool = turn.stages.find((row) => row.stage === 'tool');
    assert.equal(filler.text, 'Mm-hmm');
    assert.equal(tool.name, 'save_caller_info');
    assert.equal(tool.status, 'succeeded');
    assert.match(tool.args, /name=Alvin/);
    await trace.finishCall();
  });

  it('leaves score fields null when scoring throws, and warns once', async () => {
    const warns = [];
    const orig = console.warn;
    console.warn = (msg) => warns.push(String(msg));
    try {
      async function broken(callId) {
        const trace = createVoiceTrace({
          enabled: true,
          sink: createMemorySink(),
          env: {},
          scoreCall: () => {
            throw new Error('score broke');
          },
          callId,
        });
        trace.beginTurn({ callerText: 'hi' });
        trace.commitTurn({ outcome: 'ok' });
        return trace.finishCall();
      }
      const first = await broken('HD_bad');
      const second = await broken('HD_bad2');
      assert.equal(first.score, null);
      assert.equal(first.checks, null);
      assert.equal(first.diagnosis, null);
      assert.deepEqual(first.release, { gitSha: null, branch: null, label: null });
      assert.equal(second.score, null);
    } finally {
      console.warn = orig;
    }
    assert.equal(warns.filter((line) => line.includes('[voice-trace] score failed')).length, 1);
  });

  it('does nothing when disabled', () => {
    const trace = createVoiceTrace({ enabled: false });
    assert.equal(trace.beginTurn({ callerText: 'x' }), null);
    assert.equal(trace.commitTurn({ outcome: 'ok' }), null);
  });
});
