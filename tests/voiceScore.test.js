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
