const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { scoreTurns, compareToBaseline, diagnoseCall, languagesMatch, cutoffIndicator } = require('../src/speech/voiceScore');
const { replayCall } = require('../src/speech/replayVoice');

function turn(caller, spoken, extra = {}) {
  return {
    turnIndex: 1,
    caller: { text: caller, language: extra.callerLang || null },
    stages: [
      { stage: 'turn_end', decision: extra.hold ? 'hold' : 'flush' },
      {
        stage: 'model',
        phase: 'output',
        outputText: extra.model == null ? spoken : extra.model,
      },
      ...(extra.stages || []),
      { stage: 'tts', text: spoken, language: extra.ttsLang || 'sw' },
      { stage: 'outcome', value: extra.outcome || 'replay' },
      { stage: 'latency', callerStopToFirstTtsPcmMs: extra.pcm ?? null },
    ],
  };
}

describe('voice score', () => {
  it('matches Kiswahili to Kiswahili and flags English against it', () => {
    assert.equal(languagesMatch('sw', 'sw'), true);
    assert.equal(languagesMatch('en', 'sw'), false);
    assert.equal(languagesMatch('mixed', 'sw'), true);
    assert.equal(languagesMatch('sheng', 'sw'), true);
    const bad = scoreTurns([
      turn(
        'What services do you offer?',
        'Sawa Alvin, nimeelewa. Kuna huduma yoyote ya usafi ungependa tukusaidie nayo leo?',
        { callerLang: 'en', ttsLang: 'sw' }
      ),
    ]);
    assert.equal(bad.checks.languageMismatch, 1);
    const good = scoreTurns([turn('Ni huduma gani?', 'Tuna usafi wa nyumba.', { callerLang: 'sw', ttsLang: 'sw' })]);
    assert.equal(good.checks.languageMismatch, 0);
    assert.equal(good.checks.incomplete, 0);
  });

  it('counts a dropped name answer and a services question with no service', () => {
    const dropped = scoreTurns([
      turn('Jina langu tena?', '', {
        model: 'Jina lako ni Alvin.',
        stages: [
          {
            stage: 'transform',
            name: 'polish',
            dropped: true,
            before: 'Jina lako ni Alvin.',
            after: '',
          },
        ],
      }),
    ]);
    assert.equal(dropped.checks.deletedAnswer, 1);
    assert.equal(dropped.checks.silence, 1);
    const services = scoreTurns([
      turn('Ni services gani mna offer?', 'Ungependa tukuhudumie na gani?', { callerLang: 'sw' }),
    ]);
    assert.equal(services.checks.incomplete, 1);
  });

  it('counts a second name ask and a slow first pcm', () => {
    const card = scoreTurns([
      turn('a', 'Je, naongea na Alvin?', { pcm: 400 }),
      turn('b', 'Niambie jina lako.', { pcm: 1500 }),
    ]);
    assert.ok(card.nameAsks >= 2);
    assert.ok(card.checks.repeatedQuestion >= 1);
    assert.equal(card.checks.slow, 1);
    assert.equal(card.score < 100, true);
  });

  it('flags a cut-off caller turn', () => {
    assert.equal(cutoffIndicator('Nataka—'), 'trailing_dash');
    assert.equal(cutoffIndicator('When you— when you'), 'internal_cutoff');
    assert.equal(cutoffIndicator('Je, we,'), 'trailing_comma');
    const card = scoreTurns([turn('Nataka—', 'Sawa.', { callerLang: 'sw' })]);
    assert.equal(card.checks.prematureTurn, 1);
  });

  it('fails a lower score and passes a higher one', () => {
    const baseline = {
      calls: {
        HD_a: { score: 40, checks: { silence: 1, languageMismatch: 0 } },
      },
    };
    const worse = compareToBaseline(
      { calls: [{ callId: 'HD_a', score: 20, checks: { silence: 2, languageMismatch: 0 } }] },
      baseline
    );
    assert.ok(worse.some((line) => line.includes('score')));
    assert.ok(worse.some((line) => line.includes('silence')));
    const better = compareToBaseline(
      { calls: [{ callId: 'HD_a', score: 80, checks: { silence: 0, languageMismatch: 0 } }] },
      baseline
    );
    assert.deepEqual(better, []);
  });

  it('names the worst check and its turns', () => {
    const turns = [4, 7, 9].map((turnIndex) => ({
      turnIndex,
      caller: { text: 'Hello', language: 'en' },
      stages: [
        { stage: 'turn_end', decision: 'flush' },
        { stage: 'tts', text: 'May I have your name?', language: 'en' },
        { stage: 'outcome', value: 'ok' },
      ],
    }));
    const card = scoreTurns(turns);
    assert.equal(diagnoseCall(card), 'Name asked 3 times (turns 4, 7, 9)');
    const clean = scoreTurns([
      {
        turnIndex: 1,
        caller: { text: 'Habari', language: 'sw' },
        stages: [
          { stage: 'tts', text: 'Karibu.', language: 'sw' },
          { stage: 'outcome', value: 'ok' },
        ],
      },
    ]);
    assert.equal(diagnoseCall(clean), 'No failed checks.');
  });

  it('shows a committed speak packet on the turn notes', () => {
    const card = scoreTurns([
      {
        turnIndex: 2,
        caller: { text: 'Habari', language: 'sw' },
        stages: [
          { stage: 'tts', text: 'Karibu.', language: 'sw' },
          { stage: 'speak_packet', tier: 'public', outcome: 'catalogue', committed: true, text: 'Usafi.' },
          { stage: 'speak_slots', action: 'drain', slots: [{ outcome: 'catalogue', line: 'Usafi.' }] },
          { stage: 'outcome', value: 'ok' },
        ],
      },
    ]);
    const notes = card.turns[0].notes.join(' ');
    assert.match(notes, /speak packet public catalogue committed/);
    assert.match(notes, /speak slots drain 1/);
    assert.equal(card.checks.silence, 0);
  });

  it('scores the whole reply, not the last sentence', () => {
    const card = scoreTurns([
      {
        turnIndex: 4,
        caller: { text: 'Could you tell me the sizes you offer?', language: 'en' },
        stages: [
          { stage: 'language', detected: 'en', sticky: 'en' },
          {
            stage: 'model',
            phase: 'output',
            outputText:
              "I don't have the exact details on carpet or mattress sizes, but I can note your request for the team. Would you like me to log that for you, Alvin?",
          },
          {
            stage: 'tts',
            text: "I don't have the exact details on carpet or mattress sizes but I can note your request for the team",
            before:
              "I don't have the exact details on carpet or mattress sizes, but I can note your request for the team.",
            language: 'en',
          },
          {
            stage: 'tts',
            text: 'Would you like me to log that for you Alvin',
            before: 'Would you like me to log that for you, Alvin?',
            language: 'en',
          },
          { stage: 'outcome', value: 'ok' },
        ],
      },
    ]);
    assert.equal(card.checks.deletedAnswer, 0);
    assert.equal(card.checks.incomplete, 0);
  });

  it('counts a model question that was removed from the spoken reply', () => {
    const card = scoreTurns([
      {
        turnIndex: 9,
        caller: { text: 'Eeh, mimi naishi Kilicho though.', detected: 'unknown', language: 'en' },
        stages: [
          { stage: 'language', detected: 'unknown', sticky: 'en' },
          {
            stage: 'model',
            phase: 'output',
            outputText:
              'Kilicho iko outside our standard Nairobi coverage area, so we cannot book a direct visit right now. Would you like me to log a callback for the team to check if we can reach you?',
          },
          {
            stage: 'transform',
            name: 'polish',
            dropped: true,
            before: 'Would you like me to log a callback for the team to check if we can reach you?',
            after: '',
          },
          {
            stage: 'tts',
            text: 'Kilicho iko outside our standard Nairobi coverage area so we cannot book a direct visit right now',
            before:
              'Kilicho iko outside our standard Nairobi coverage area, so we cannot book a direct visit right now.',
            language: 'en',
          },
          { stage: 'outcome', value: 'ok' },
        ],
      },
    ]);
    assert.equal(card.checks.deletedAnswer, 1);
    assert.equal(card.checks.languageMismatch, 0);
  });

  it('finds a repeated question in pre-TTS text after question marks are stripped', () => {
    const card = scoreTurns([
      {
        turnIndex: 2,
        caller: { text: 'Yes.', language: 'en' },
        stages: [
          {
            stage: 'model',
            phase: 'output',
            outputText: 'Which service do you need?',
          },
          { stage: 'tts', text: 'Which service do you need', before: 'Which service do you need?', language: 'en' },
          { stage: 'outcome', value: 'ok' },
        ],
      },
      {
        turnIndex: 6,
        caller: { text: 'The sizes.', language: 'en' },
        stages: [
          { stage: 'tts', text: 'Which service do you need', before: 'Which service do you need?', language: 'en' },
          { stage: 'outcome', value: 'ok' },
        ],
      },
    ]);
    assert.ok(card.checks.repeatedQuestion >= 1);
  });

  it('scores slowness on the reply, and does not call a barge over filler silence', () => {
    const slow = scoreTurns([
      {
        turnIndex: 2,
        caller: { text: 'Yes.', language: 'en' },
        stages: [
          { stage: 'filler', text: 'Mm-hmm', before: 'Mm-hmm.' },
          { stage: 'tts', text: 'Which service do you need', before: 'Which service do you need?', language: 'en' },
          { stage: 'outcome', value: 'ok' },
          { stage: 'latency', callerStopToFirstTtsPcmMs: 452, firstReplyPcmMs: 1355 },
        ],
      },
    ]);
    assert.equal(slow.checks.slow, 1);
    assert.equal(slow.checks.silence, 0);
    const barge = scoreTurns([
      {
        turnIndex: 3,
        caller: { text: 'Right.', language: 'en' },
        stages: [
          { stage: 'filler', text: 'Mm-hmm', before: 'Mm-hmm.' },
          { stage: 'outcome', value: 'barge_in' },
          { stage: 'latency', callerStopToFirstTtsPcmMs: 402, firstReplyPcmMs: null },
        ],
      },
    ]);
    assert.equal(barge.checks.silence, 0);
    assert.equal(barge.checks.slow, 0);
  });

  it('uses detected language, then the caller text, and ignores a sticky mismatch', () => {
    const card = scoreTurns([
      {
        turnIndex: 8,
        caller: {
          text: 'Wewe unafanya vitu za BNB?',
          language: 'en',
          sticky: 'en',
          detected: 'unknown',
        },
        stages: [
          { stage: 'language', detected: 'unknown', sticky: 'en' },
          {
            stage: 'tts',
            text: 'Ndiyo Alvin tunafanya general cleaning ya nyumba na AirBnB',
            before: 'Ndiyo, Alvin, tunafanya general cleaning ya nyumba na AirBnB.',
            language: 'sw',
          },
          {
            stage: 'tts',
            text: 'Ungetaka tukuwekee visit lini na sehemu gani',
            before: 'Ungetaka tukuwekee visit lini na sehemu gani?',
            language: 'en',
          },
          { stage: 'outcome', value: 'ok' },
        ],
      },
    ]);
    assert.equal(card.checks.languageMismatch, 0);
    assert.equal(card.checks.deletedAnswer, 0);
    assert.equal(card.checks.incomplete, 0);
  });

  it('scores Soniox language once and skips the keyword fallback when tags exist', () => {
    const card = scoreTurns([
      {
        turnIndex: 4,
        caller: {
          text: 'What do you offer?',
          language: 'en',
          sticky: 'en',
          detected: 'en',
          soniox: 'sw',
        },
        stages: [
          { stage: 'language', detected: 'en', sticky: 'en', soniox: 'sw' },
          {
            stage: 'stt',
            kind: 'final',
            text: 'What do you offer?',
            tokens: [
              { text: ' What', language: 'sw', final: true },
              { text: ' do', language: 'sw', final: true },
              { text: ' you', language: 'en', final: true },
            ],
          },
          {
            stage: 'tts',
            text: 'Tunafanya usafi wa nyumba',
            before: 'Tunafanya usafi wa nyumba.',
            language: 'sw',
          },
          { stage: 'outcome', value: 'ok' },
        ],
      },
    ]);
    assert.equal(card.checks.languageMismatch, 0);

    const miss = scoreTurns([
      {
        turnIndex: 5,
        caller: {
          text: 'What do you offer?',
          detected: 'en',
          soniox: 'sw',
        },
        stages: [
          { stage: 'language', detected: 'en', soniox: 'sw' },
          {
            stage: 'stt',
            tokens: [{ text: 'offer', language: 'sw', final: true }],
          },
          {
            stage: 'tts',
            text: 'We offer couch cleaning',
            before: 'We offer couch cleaning.',
            language: 'en',
          },
          { stage: 'outcome', value: 'ok' },
        ],
      },
    ]);
    assert.equal(miss.checks.languageMismatch, 1);

    const tokensOnly = scoreTurns([
      {
        turnIndex: 6,
        caller: { text: 'What do you offer?', detected: 'en' },
        stages: [
          { stage: 'language', detected: 'en', soniox: null },
          {
            stage: 'stt',
            tokens: [
              { text: ' What', language: 'swh', final: true },
              { text: ' offer', language: 'sw', final: true },
            ],
          },
          {
            stage: 'tts',
            text: 'Tunafanya usafi wa nyumba',
            before: 'Tunafanya usafi wa nyumba.',
            language: 'sw',
          },
          { stage: 'outcome', value: 'ok' },
        ],
      },
    ]);
    assert.equal(tokensOnly.checks.languageMismatch, 0);
  });

  it('does not call a Kiswahili reply English because it contains cleaning', () => {
    const card = scoreTurns([
      {
        turnIndex: 8,
        caller: { text: 'Oh. Na mnafika, mnafikana.', soniox: 'sw', detected: 'sw', language: 'sw' },
        stages: [
          { stage: 'language', detected: 'sw', soniox: 'sw', sticky: 'sw' },
          {
            stage: 'tts',
            text: 'Tuje lini kukufanyia cleaning',
            before: 'Tuje lini kukufanyia cleaning?',
            language: 'sw',
          },
          { stage: 'outcome', value: 'ok' },
        ],
      },
    ]);
    assert.equal(card.checks.languageMismatch, 0);
  });

  it('does not call an Okay backchannel silence', () => {
    const card = scoreTurns([
      {
        turnIndex: 5,
        caller: { text: 'Okay.' },
        stages: [
          { stage: 'turn_end', decision: 'skip', reason: 'non_substantive' },
          { stage: 'outcome', value: 'skip' },
        ],
      },
    ]);
    assert.equal(card.checks.silence, 0);
    assert.equal(card.turns[0].notes.some((note) => note.includes('silence')), false);
  });

  it('counts an unbound place or unsaid number drop as a deleted answer', () => {
    const card = scoreTurns([
      {
        turnIndex: 9,
        caller: { text: 'Like, mnafika na kuru?', soniox: 'sw', detected: 'sw' },
        stages: [
          { stage: 'language', detected: 'sw', soniox: 'sw' },
          {
            stage: 'model',
            phase: 'output',
            outputText:
              'Nakuru iko nje ya area yetu ya huduma kwani tunafanya Nairobi na maeneo ya karibu pekee. Naweza kukuachia ujumbe kwa timu yetu?',
          },
          {
            stage: 'transform',
            name: 'polish',
            reason: 'unbound_place',
            dropReasons: ['unbound_place'],
            before:
              'Nakuru iko nje ya area yetu ya huduma kwani tunafanya Nairobi na maeneo ya karibu pekee.',
            after: '',
            dropped: true,
          },
          {
            stage: 'tts',
            text: 'Naweza kukuachia ujumbe kwa timu yetu',
            before: 'Naweza kukuachia ujumbe kwa timu yetu?',
            language: 'sw',
          },
          { stage: 'outcome', value: 'ok' },
        ],
      },
    ]);
    assert.equal(card.checks.deletedAnswer, 1);
    assert.equal(card.turns[0].notes.some((note) => note.includes('deleted')), true);
  });

  it('flags a late token dropped or merged after the turn closed', () => {
    const dropped = scoreTurns([
      {
        turnIndex: 8,
        caller: { text: 'Oh. Na mnafika, mnafikana.', soniox: 'sw', detected: 'sw' },
        stages: [
          { stage: 'turn_end', decision: 'flush', reason: 'caller_turn_processed' },
          { stage: 'stt', kind: 'final', text: 'Kuru?' },
          { stage: 'turn_end', decision: 'ignore', reason: 'grace' },
          {
            stage: 'tts',
            text: 'Tuje lini kukufanyia cleaning',
            before: 'Tuje lini kukufanyia cleaning?',
            language: 'sw',
          },
          { stage: 'outcome', value: 'ok' },
        ],
      },
    ]);
    assert.equal(dropped.checks.prematureTurn, 1);
    assert.equal(dropped.checks.languageMismatch, 0);
    assert.match(dropped.turns[0].notes.join(' '), /Kuru/);

    const merged = scoreTurns([
      {
        turnIndex: 8,
        caller: { text: 'Oh. Na mnafika, mnafikana.' },
        stages: [
          { stage: 'turn_end', decision: 'flush', reason: 'recorded_flush' },
          { stage: 'turn_end', decision: 'hold', reason: 'late_final' },
          { stage: 'tts', text: 'Sawa', before: 'Sawa.', language: 'sw' },
          { stage: 'outcome', value: 'ok' },
        ],
      },
    ]);
    assert.equal(merged.checks.prematureTurn, 1);
  });

  it('replays a fixture into a scorecard shape', async () => {
    const replay = await replayCall({
      callId: 'HD_shape',
      tenantId: 'df4ad9d8-28ff-4810-b1e6-94f5495472b0',
      businessName: 'Done and Dusted',
      callerName: 'Alvin',
      nameOnFile: true,
      turns: [
        {
          caller: 'Habari',
          flushed: true,
          model: { outputText: 'Karibu.', provider: 'recorded', model: 'recorded', promptId: 'voice.system' },
        },
      ],
    });
    assert.equal(replay.turns.length, 1);
    assert.equal(replay.turns[0].schemaVersion, 1);
    assert.ok(replay.turns[0].stages.some((row) => row.stage === 'tts'));
  });
});

describe('structured mouth: model prose is say[] (staging 5bbb0871)', () => {
  const { modelProse } = require('../src/speech/voiceScore');
  const FIXTURE = require('./fixtures/voice-score/5bbb0871.incomplete-turns.json');

  it('unwraps the JSON envelope to say[], tool and flags dropped', () => {
    assert.equal(
      modelProse('{"lang":"en","intent":"booking","facts_used":[],"say":["Okay.","When should we come?"],"tool":{"name":"x","args_json":"{}"}}'),
      'Okay. When should we come?'
    );
    assert.equal(modelProse('{\n  "lang": "sw",\n  "say": [\n    "Sawa."\n  ]\n}'), 'Sawa.');
    assert.equal(modelProse('{"lang":"en","say":[]}'), '');
  });

  it('a cut-off envelope keeps the say[] strings that arrived', () => {
    assert.equal(modelProse('{"lang":"en","say":["Sure, I can help.","When would'), 'Sure, I can help.');
    assert.equal(modelProse('{"lang":"en","say":["Say \\"hi\\" now."],"tool":{'), 'Say "hi" now.');
  });

  it('legacy prose and ###TOOL### blocks are unchanged', () => {
    assert.equal(modelProse('Sawa. ###TOOL###{"name":"x"}###ENDTOOL### Tuje lini?'), 'Sawa. Tuje lini?');
    assert.equal(modelProse('Goodbye. ###ENDCALL###'), 'Goodbye.');
    assert.equal(modelProse('{not json at all'), '{not json at all');
  });

  it('all 8 live "incomplete" flags on 5bbb0871 were false positives', () => {
    assert.equal(FIXTURE.turns.length, FIXTURE.liveIncomplete);
    const card = scoreTurns(FIXTURE.turns);
    const flagged = card.turns.filter((t) => t.checks.incomplete).map((t) => t.notes);
    assert.deepEqual(flagged, []);
    assert.equal(card.checks.incomplete, 0);
  });

  it('a structured turn that really dropped most of say[] is still incomplete', () => {
    const say = ['Carpet cleaning is 2,200 shillings per room, and sofa cleaning is 1,500 per seat.', 'When should we come?'];
    const card = scoreTurns([
      {
        caller: { text: 'How much?', language: 'en' },
        stages: [
          { stage: 'turn_end', decision: 'flush', reason: 'caller_turn_processed' },
          { stage: 'tts', text: 'Carpet cleaning', before: 'Carpet cleaning', language: 'en', structured: true },
          { stage: 'model', phase: 'output', language: 'en', outputText: JSON.stringify({ lang: 'en', say }) },
          { stage: 'outcome', value: 'ok' },
        ],
      },
    ]);
    assert.equal(card.checks.incomplete, 1);
  });
});
