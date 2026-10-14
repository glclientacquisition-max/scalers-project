const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  decideCallerEvent,
  finalCarriesContent,
  keepDroppedFinal,
  finalDisposition,
} = require('../src/speech/turnTaking');
const { scoreTurns, lostCallerFinals } = require('../src/speech/voiceScore');
const { replayCall } = require('../src/speech/replayVoice');

const fixture = require('./fixtures/voice-calls/HD_054e4f7ff253.json');
const fixture72ab = require('./fixtures/voice-calls/HD_72ab69cbab2b.json');
const baseline = require('./fixtures/voice-eval-baseline.json');

const LAST_AGENT = 'Nifanyie nini leo?';

function thinking(text, isFinal) {
  return decideCallerEvent({
    text,
    isFinal,
    speaking: false,
    turnBusy: true,
    lastAgentText: LAST_AGENT,
    lastAgentAskedQuestion: true,
    now: 10_000,
  });
}

// HD_054e4f7ff253 t3 as recorded live (voice_turn_traces): the question is
// ignored as thinking_continuation and the caller hears the question again.
function liveT3(disposition = { decision: 'ignore', reason: 'thinking_continuation' }) {
  return {
    turnIndex: 3,
    caller: { text: 'Mm-hm.', language: 'en' },
    stages: [
      { stage: 'stt', kind: 'final', text: 'Mm-hm.' },
      { stage: 'turn_end', decision: 'flush', reason: 'endpoint' },
      { stage: 'filler', text: 'Mm-hmm.' },
      { stage: 'stt', kind: 'final', text: 'Unawashangaa apartment?' },
      { stage: 'turn_end', ...disposition },
      { stage: 'stt', kind: 'final', text: 'Hello?' },
      { stage: 'turn_end', decision: 'barge_in', reason: 'hear_again' },
      {
        stage: 'model',
        phase: 'output',
        outputText: 'Ungetaka tukufanyie usafi gani, au unahitaji usaidizi gani leo?',
      },
      {
        stage: 'tts',
        text: 'Ungetaka tukufanyie usafi gani, au unahitaji usaidizi gani leo?',
        language: 'sw',
      },
      { stage: 'outcome', value: 'ok' },
      { stage: 'latency', callerStopToFirstTtsPcmMs: 404, firstReplyPcmMs: 7406 },
    ],
  };
}

describe('HD_054e4f7ff253 t3: a question asked while the agent thinks', () => {
  it('tells content finals from fillers', () => {
    for (const text of ['Unawashangaa apartment?', 'Kuru?', 'You cover?', 'Mtafika?', 'Bei gani?']) {
      assert.equal(finalCarriesContent(text), true, text);
    }
    for (const text of ['Mm-hm.', 'Mm-hmm.', 'Okay.', 'Yeah, yeah.', 'Hello?', 'Sawa.', 'Do.', '', 'Uh, so']) {
      assert.equal(finalCarriesContent(text), false, text);
    }
  });

  it('queues a content final while thinking instead of dropping it', () => {
    const decision = thinking('Unawashangaa apartment?', true);
    assert.equal(decision.action, 'queue');
    assert.equal(decision.reason, 'thinking_queued');
    assert.equal(decision.queue, true);
    assert.equal(decision.interrupt, false);
  });

  it('keeps fillers and interims as thinking_continuation', () => {
    assert.equal(thinking('Mm-hm.', true).reason, 'thinking_continuation');
    for (const filler of ['Mm.', 'Mm-hmm.', 'Hmm.', 'Uh,']) {
      const decision = thinking(filler, true);
      assert.equal(decision.action, 'ignore', filler);
      assert.notEqual(decision.queue, true, filler);
    }
    // Interims are unchanged: only a final becomes a turn.
    const interim = thinking('Unawashangaa apartment?', false);
    assert.equal(interim.action, 'ignore');
    assert.equal(interim.reason, 'thinking_continuation');
  });

  it('keeps any other ignored content final, but never an echo or empty one', () => {
    assert.equal(keepDroppedFinal({ action: 'ignore', reason: 'grace' }, 'Kuru?'), true);
    assert.equal(keepDroppedFinal({ action: 'skip', reason: 'no_content' }, 'Mtafika Rongai?'), true);
    assert.equal(keepDroppedFinal({ action: 'ignore', reason: 'echo' }, 'Nifanyie nini leo?'), false);
    assert.equal(keepDroppedFinal({ action: 'ignore', reason: 'empty' }, 'Kuru?'), false);
    assert.equal(keepDroppedFinal({ action: 'ignore', reason: 'grace' }, 'Mm-hm.'), false);
    assert.equal(keepDroppedFinal({ action: 'ignore', reason: 'x', queue: true }, 'Kuru?'), false);
    assert.deepEqual(finalDisposition({ action: 'ignore', reason: 'grace' }, 'Kuru?'), {
      decision: 'queue',
      reason: 'kept_grace',
    });
    assert.deepEqual(finalDisposition({ action: 'ignore', reason: 'grace' }, 'Mm.'), {
      decision: 'ignore',
      reason: 'grace',
    });
  });

  it('scorer flags the live trace where the question was dropped', () => {
    const lost = lostCallerFinals(liveT3());
    assert.deepEqual(
      lost.map((row) => [row.text, row.reason]),
      [['Unawashangaa apartment?', 'thinking_continuation']]
    );
    const call = scoreTurns([liveT3()]);
    assert.equal(call.checks.lostCallerFinal, 1);
    const [scored] = call.turns;
    assert.equal(scored.checks.lostCallerFinal, 1);
    assert.match(scored.notes.join(' '), /caller final dropped \(thinking_continuation\): Unawashangaa apartment\?/);
  });

  it('scorer does not flag a queued question or one that reached a later turn', () => {
    const queued = scoreTurns([liveT3({ decision: 'queue', reason: 'thinking_queued' })]);
    assert.equal(queued.checks.lostCallerFinal, 0);
    const later = {
      turnIndex: 4,
      caller: { text: 'Unawashangaa apartment?', language: 'sw' },
      stages: [
        { stage: 'turn_end', decision: 'flush' },
        { stage: 'tts', text: 'Ndiyo, tunasafisha apartment.', language: 'sw' },
        { stage: 'outcome', value: 'ok' },
      ],
    };
    const both = scoreTurns([liveT3(), later]);
    assert.equal(both.checks.lostCallerFinal, 0);
  });

  it('replay of the HD_054e fixture queues the question and keeps the Hello? replay', async () => {
    const call = await replayCall(fixture);
    const t3 = call.turns[2];
    const ends = t3.stages
      .filter((row) => row.stage === 'turn_end')
      .map((row) => `${row.decision}/${row.reason}`);
    assert.deepEqual(ends, ['flush/recorded_flush', 'queue/thinking_queued', 'replay/hear_again', 'replay/hear_again']);
    assert.equal(scoreTurns(call.turns).checks.lostCallerFinal, 0);
  });

  it('the replay check fails on the old drop', async () => {
    const call = await replayCall(fixture);
    const t3 = call.turns[2];
    const old = {
      ...t3,
      stages: t3.stages.map((row) =>
        row.stage === 'turn_end' && row.reason === 'thinking_queued'
          ? { stage: 'turn_end', decision: 'ignore', reason: 'thinking_continuation' }
          : row
      ),
    };
    const scored = scoreTurns([call.turns[0], call.turns[1], old]);
    assert.equal(scored.checks.lostCallerFinal, 1);
    assert.ok(scored.score < scoreTurns(call.turns).score);
  });

  it('both new fixtures are in the replay baseline', () => {
    assert.equal(typeof baseline.calls[fixture.callId].score, 'number');
    assert.equal(typeof baseline.calls[fixture72ab.callId].score, 'number');
    assert.equal(baseline.calls[fixture.callId].checks.lostCallerFinal, 0);
    assert.equal(fixture72ab.turns.length, 6);
  });

  it('server keeps content finals and logs every drop', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(src, /isFinal: String\(source \|\| ''\)\.startsWith\('final'\),\n\s+speaking: phaseInputs\.speaking/);
    assert.match(src, /const keep = keepDroppedFinal\(decision, text\);/);
    assert.match(src, /reason: `kept_\$\{decision\.reason \|\| decision\.action\}`/);
    assert.match(src, /caller final kept \(was /);
    assert.match(src, /caller final dropped reason=/);
    assert.match(src, /caller final queued while thinking: /);
    const keep = src.indexOf('const keep = keepDroppedFinal(decision, text);');
    const late = src.indexOf("lateFinals.hold(text, { reason: decision.reason || '' })");
    assert.ok(late > 0 && keep > late, 'late-final merge still runs first');
  });
});
