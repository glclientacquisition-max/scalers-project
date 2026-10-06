const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const prev = process.env.VOICE_STRUCTURED_REPLY;
before(() => {
  process.env.VOICE_STRUCTURED_REPLY = 'on';
});
after(() => {
  if (prev == null) delete process.env.VOICE_STRUCTURED_REPLY;
  else process.env.VOICE_STRUCTURED_REPLY = prev;
});

const { applyNameGate, isNameAsk } = require('../src/speech/turnMachine');
const { replayCall } = require('../src/speech/replayVoice');

describe('name state machine', () => {
  it('does not ask again when the name is already confirmed', () => {
    const state = { caller: { name: 'Alvin', nameConfirmed: true, nameAskCount: 0 } };
    const gated = applyNameGate(
      ['May I have your name?', 'We offer couch cleaning.'],
      state,
      'en'
    );
    assert.match(gated.sentences.join(' '), /couch cleaning/);
    assert.equal(gated.sentences.some((line) => isNameAsk(line)), false);
    assert.equal(gated.stages.some((row) => row.dropped), false);
  });

  it('asks for an unknown name at most once', () => {
    const state = { caller: { name: '', nameConfirmed: false } };
    const first = applyNameGate(['May I have your name?'], state, 'en');
    const second = applyNameGate(['May I have your name?', 'We offer couch cleaning.'], state, 'en');
    assert.equal(first.sentences.length, 1);
    assert.equal(isNameAsk(first.sentences[0]), true);
    assert.match(second.sentences.join(' '), /couch cleaning/);
    assert.equal(second.sentences.some((line) => isNameAsk(line)), false);
    assert.equal(state.caller.nameAskCount, 1);
  });

  it('keeps the service answer and drops the name ask in the same sentence', () => {
    const state = { caller: { name: 'Alvin', nameConfirmed: true } };
    const gated = applyNameGate(['We offer couch cleaning, may I have your name?'], state, 'en');
    assert.match(gated.sentences[0], /couch cleaning/);
    assert.equal(isNameAsk(gated.sentences[0]), false);
  });

  it('speaks a short ack when the only sentence was a repeat name ask', () => {
    const state = { caller: { name: '', nameConfirmed: false, nameAskCount: 1 } };
    const gated = applyNameGate(['Niambie jina lako?'], state, 'sw');
    assert.equal(gated.sentences.length, 1);
    assert.equal(isNameAsk(gated.sentences[0]), false);
    assert.doesNotMatch(gated.sentences[0], /\?/);
    assert.match(gated.sentences[0], /Sawa/);
  });

  it('rewrites a stored name so it is not scored as another ask', () => {
    const state = { caller: { name: 'Alvin', nameConfirmed: true } };
    const gated = applyNameGate(['Jina lako ni Alvin.'], state, 'sw');
    assert.match(gated.sentences[0], /Ndiyo, ni Alvin/);
    assert.equal(isNameAsk(gated.sentences[0]), false);
  });
});

describe('replay respond hook', () => {
  it('live mode speaks the brain text, then the name gate', async () => {
    const fixture = {
      callId: 'machine',
      businessName: 'Done and Dusted',
      callerName: '',
      nameOnFile: false,
      turns: [
        { caller: 'Hello', model: { outputText: 'ignored' } },
        { caller: 'What services do you offer?', model: { outputText: 'ignored' } },
      ],
    };
    let calls = 0;
    const replay = await replayCall(fixture, {
      mode: 'live',
      respond: async ({ caller, state }) => {
        calls += 1;
        assert.ok(state);
        if (calls === 1) return { outputText: 'May I have your name?' };
        return { outputText: 'May I have your name? We offer couch cleaning.' };
      },
    });
    const spoken = replay.turns.map((turn) => {
      const tts = (turn.stages || []).find((row) => row.stage === 'tts');
      return tts?.text || '';
    });
    assert.equal(calls, 2);
    assert.match(spoken[0], /name/i);
    assert.match(spoken[1], /couch cleaning/);
    assert.doesNotMatch(spoken[1], /may i have your name/i);
  });
});
