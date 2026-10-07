// Voice half of the caller-file lock (HD_c05cdda9684d).
// Unfinished flush label, speak-gate, rotating tool hold.
// Run: node --test tests/callerFileVoice.test.js

const assert = require('assert');
const { describe, it } = require('node:test');
const { nothingStillOpenLine } = require('../src/conversation/fileRead');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const {
  labelFlushedCallerTurn,
  observeCallerInput,
} = require('../src/speech/callerTurnLabel');
const { gateCallerFileSpeech, speakerBound } = require('../src/speech/callerFileSpeech');
const {
  TOOL_HOLD_PACKS,
  pickToolHoldLine,
  planToolHold,
  createToolHoldSession,
  turnRequestsTool,
  fileReadFollowUp,
} = require('../src/speech/toolHold');

function wordCount(line) {
  return String(line || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

describe('unfinished flush label', () => {
  it('forwards a turn-end unfinished flag into the observe input', () => {
    const labeled = labelFlushedCallerTurn({
      text: 'Nilikuwa nauliza',
      turnEnd: { action: 'flush', reason: 'unfinished_cap', unfinished: true },
    });
    assert.equal(labeled.text, 'Nilikuwa nauliza');
    assert.equal(labeled.unfinished, true);

    const input = observeCallerInput(
      {
        text: 'Nilikuwa nauliza',
        languageState: { current: 'sw' },
        lastAgentText: 'Je, naongea na Alvin?',
      },
      { turnEnd: { unfinished: true, reason: 'unfinished_cap' } }
    );
    assert.equal(input.unfinished, true);
    assert.equal(input.weak, false);
    assert.equal(input.weakStt, false);
    assert.equal(input.text, 'Nilikuwa nauliza');
    assert.equal(input.languageState.current, 'sw');
    assert.equal(input.lastAgentText, 'Je, naongea na Alvin?');
    assert.equal(Object.hasOwn(input, 'goal'), false);

    const observed = observeCallerTurn(createBrainState({}), input);
    assert.equal(observed.goal.description, null);
  });

  it('forwards weak and weakStt and does not invent them', () => {
    const weak = observeCallerInput(
      { text: 'I need a plumber.' },
      { turnEnd: { weak: true, weakStt: true, reason: 'low_confidence' } }
    );
    assert.equal(weak.unfinished, false);
    assert.equal(weak.weak, true);
    assert.equal(weak.weakStt, true);
    assert.equal(Object.hasOwn(weak, 'goal'), false);
    const rejected = observeCallerTurn(createBrainState({}), weak);
    assert.equal(rejected.goal.description, null);

    const finished = observeCallerInput(
      { text: 'I need a plumber.' },
      { turnEnd: { unfinished: false, reason: 'endpoint' } }
    );
    assert.equal(finished.unfinished, false);
    assert.equal(finished.weak, false);
    assert.equal(finished.weakStt, false);
    const kept = observeCallerTurn(createBrainState({}), finished);
    assert.match(String(kept.goal.description), /plumber/i);
  });

  it('labels an incomplete English tail and leaves a finished sentence', () => {
    assert.equal(labelFlushedCallerTurn({ text: 'I need help with' }).unfinished, true);
    assert.equal(
      labelFlushedCallerTurn({
        text: 'I need a plumber.',
        turnEnd: { unfinished: false, reason: 'endpoint' },
      }).unfinished,
      false
    );
  });
});

describe('caller file speak gate', () => {
  const unbound = {
    caller: { nameConfirmed: false, fileNameAsked: 'Alvin' },
    returning: { fileOwnerName: 'Alvin', name: 'Alvin' },
  };

  it('blocks file name and open rows until the speaker is bound', () => {
    assert.equal(speakerBound(unbound), false);
    const gated = gateCallerFileSpeech(
      'Yes, Alvin. You have two open carpet cleaning requests. We are open Saturday.',
      unbound
    );
    assert.equal(gated.line, 'We are open Saturday.');
    assert.equal(gated.speak, true);
    assert.doesNotMatch(gated.line, /Alvin/);
    assert.doesNotMatch(gated.line, /carpet/);

    const onlyFile = gateCallerFileSpeech(
      'Yes, Alvin. You have two open carpet cleaning requests.',
      unbound
    );
    assert.equal(onlyFile.speak, false);
    assert.equal(onlyFile.line, '');
    assert.equal(onlyFile.reason, 'unbound');
  });

  it('keeps the identity ask and speaks file rows after bind', () => {
    const ask = gateCallerFileSpeech('Je, naongea na Alvin?', unbound);
    assert.equal(ask.speak, true);
    assert.match(ask.line, /Alvin/);

    const englishAsk = gateCallerFileSpeech('Am I speaking with Alvin?', unbound);
    assert.equal(englishAsk.speak, true);

    const boundState = {
      caller: { nameConfirmed: true, fileNameAsked: 'Alvin' },
    };
    assert.equal(speakerBound(boundState), true);
    const bound = gateCallerFileSpeech(
      'Yes, Alvin. You have two open carpet cleaning requests.',
      boundState
    );
    assert.equal(bound.speak, true);
    assert.match(bound.line, /Alvin/);
    assert.match(bound.line, /carpet/);
  });

  it('uses caller.nameConfirmed and ignores a parallel speaker flag', () => {
    const confirmed = {
      speaker: { bound: false, nameConfirmed: false, pendingName: 'Alvin' },
      caller: { nameConfirmed: true, name: 'Alvin', fileNameAsked: 'Alvin' },
    };
    assert.equal(speakerBound(confirmed), true);
    const spoken = gateCallerFileSpeech('Yes, Alvin.', confirmed);
    assert.equal(spoken.speak, true);
    assert.equal(spoken.line, 'Yes, Alvin.');

    const ahead = {
      speaker: { bound: true, nameConfirmed: true, pendingName: 'Alvin', name: 'Alvin' },
      caller: { nameConfirmed: false, fileNameAsked: 'Alvin' },
    };
    assert.equal(speakerBound(ahead), false);
    const blocked = gateCallerFileSpeech('Yes, Alvin.', ahead);
    assert.equal(blocked.speak, false);
    assert.equal(blocked.line, '');
    assert.equal(blocked.reason, 'unbound');
  });
});

describe('tool hold', () => {
  it('speaks a hold only while a tool is in flight', () => {
    assert.equal(planToolHold({ toolInFlight: false, language: 'en', seed: 'HD_c05' }).speak, false);
    assert.equal(
      planToolHold({ toolInFlight: true, barge: true, language: 'en', seed: 'HD_c05' }).speak,
      false
    );
    const hold = planToolHold({ toolInFlight: true, language: 'sw', seed: 'HD_c05cdda9684d' });
    assert.equal(hold.speak, true);
    assert.ok(hold.line);
    assert.ok(wordCount(hold.line) <= 5);

    const session = createToolHoldSession({ language: 'en', seed: 'HD_c05cdda9684d' });
    const skipped = session.finish({
      resultLine: 'Okay, I have saved your visit request.',
      bound: true,
    });
    assert.equal(skipped.speak, false);
    assert.equal(skipped.reason, 'no_tool');

    assert.equal(turnRequestsTool({ name: 'Alvin' }), false);
    assert.equal(turnRequestsTool({ appointment: { whenText: 'tomorrow' } }), true);
    assert.equal(turnRequestsTool({ openItems: [{ id: 'carpet-12' }] }), true);
    assert.equal(fileReadFollowUp([{ action: 'create_appointment', status: 'succeeded' }]), null);
    assert.deepEqual(fileReadFollowUp([{ action: 'open_items', spoken: '' }]), {
      fileFacts: true,
      resultLine: '',
    });
  });

  it('rotates at least three English and three Kiswahili lines from the call seed', () => {
    for (const language of ['en', 'sw']) {
      const pack = TOOL_HOLD_PACKS[language];
      assert.ok(pack.length >= 3, language);
      for (const line of pack) {
        assert.ok(wordCount(line) <= 5, line);
        assert.doesNotMatch(line, /carpet|Alvin|open request/i);
      }
      const seed = 'HD_c05cdda9684d';
      const spun = [0, 1, 2].map((index) => pickToolHoldLine({ language, seed, index }));
      assert.equal(new Set(spun).size, 3);
      assert.equal(pickToolHoldLine({ language, seed, index: 1 }), spun[1]);
    }
    const sheng = pickToolHoldLine({ language: 'sheng', seed: 'HD_c05', index: 0 });
    assert.ok(TOOL_HOLD_PACKS.sw.includes(sheng));
  });

  it('speaks the tool result after the hold, and nothing from the card before bind', () => {
    const session = createToolHoldSession({ language: 'en', seed: 'call-1' });
    const begun = session.begin();
    assert.equal(begun.speak, true);
    assert.equal(begun.kind, 'hold');

    const saved = session.finish({
      resultLine: 'Okay, I have saved your visit request.',
      bound: false,
      fileFacts: false,
    });
    assert.equal(saved.speak, true);
    assert.equal(saved.line, 'Okay, I have saved your visit request.');
    assert.equal(saved.kind, 'result');

    const read = createToolHoldSession({ language: 'en', seed: 'call-2' });
    read.begin();
    const unbound = read.finish({
      resultLine: 'Alvin, two open carpet cleaning requests.',
      bound: false,
      fileFacts: true,
    });
    assert.equal(unbound.speak, false);
    assert.equal(unbound.line, '');
    assert.equal(unbound.reason, 'unbound');

    const empty = createToolHoldSession({ language: 'sw', seed: 'call-3' });
    empty.begin();
    const none = empty.finish({ resultLine: '', bound: true, fileFacts: true });
    assert.equal(none.speak, true);
    assert.equal(none.line, 'Hakuna kilicho wazi.');
    assert.equal(none.line, nothingStillOpenLine({}, 'sw'));
  });

  it('drops the hold follow-up when the caller barges in', () => {
    const session = createToolHoldSession({ language: 'en', seed: 'call-4' });
    session.begin();
    session.cancel();
    const follow = session.finish({
      resultLine: 'Okay, I have saved your visit request.',
      bound: true,
      fileFacts: false,
    });
    assert.equal(follow.speak, false);
    assert.equal(follow.line, '');
    assert.equal(follow.reason, 'barge');

    const late = createToolHoldSession({ language: 'en', seed: 'call-5' });
    late.cancel();
    assert.equal(late.begin().speak, false);
  });
});
