'use strict';

// VOICE_TIME_ANSWER_ENFORCE (default off). HD_60e56c6acc88 (prod Aris,
// 17 Oct 2026 21:52:29 EAT): "Ni saa ngapi" got opening hours, the owner
// review overwrote unresolved to resolved, and the Goal quoted raw words.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const enforce = require('../src/conversation/timeAnswerEnforce');
const { deriveCallSummary, structuredGoalText } = require('../src/conversation/callSummary');
const { mergeTranscriptReview } = require('../src/conversation/callTranscriptReview');
const { spokenQuestionLedger } = require('../src/conversation/spokenAnswers');

const FIX = require(path.join(__dirname, 'fixtures', 'time-answer', 'HD_60e56c6acc88.json'));
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const NOW = Date.parse(FIX.callerAt);
const SPOKEN = FIX.spoken.join(' ');
const clone = (v) => JSON.parse(JSON.stringify(v));

function withFlag(value, fn) {
  const before = process.env.VOICE_TIME_ANSWER_ENFORCE;
  if (value == null) delete process.env.VOICE_TIME_ANSWER_ENFORCE;
  else process.env.VOICE_TIME_ANSWER_ENFORCE = value;
  try {
    return fn();
  } finally {
    if (before == null) delete process.env.VOICE_TIME_ANSWER_ENFORCE;
    else process.env.VOICE_TIME_ANSWER_ENFORCE = before;
  }
}

function plan(overrides = {}) {
  return enforce.planTimeAnswer({
    callerText: FIX.caller,
    spokenText: SPOKEN,
    state: clone(FIX.brainState),
    language: FIX.callLanguage,
    now: NOW,
    ...overrides,
  });
}

function merge() {
  return mergeTranscriptReview({
    derived: clone(FIX.derived),
    summary: clone(FIX.summary),
    toolFlags: {},
    review: clone(FIX.review),
    vertical: 'retail',
    callerTurns: [FIX.caller],
  });
}

test('flag is off unless on/1/true/yes', () => {
  assert.equal(enforce.timeAnswerEnforceEnabled({}), false);
  assert.equal(enforce.timeAnswerEnforceEnabled({ VOICE_TIME_ANSWER_ENFORCE: 'off' }), false);
  for (const v of ['on', '1', 'true', 'YES']) assert.equal(enforce.timeAnswerEnforceEnabled({ VOICE_TIME_ANSWER_ENFORCE: v }), true);
});

for (const flag of [null, 'off']) {
  const label = flag == null ? 'unset' : 'off';
  test(`parity (${label}): HD_60e56c6acc88 reproduces prod (no time line, resolved, raw Goal)`, () => {
    withFlag(flag, () => {
      const p = plan();
      assert.equal(p.speak, false);
      assert.equal(p.reason, 'disabled');
      const m = merge();
      assert.equal(m.resolution, 'resolved');
      assert.deepEqual(m.applied, FIX.prodApplied);
      const summary = deriveCallSummary({ brainState: clone(FIX.brainState) });
      assert.equal(summary.text, FIX.prodSummaryText);
      const ledger = spokenQuestionLedger([
        { speaker: 'caller', text: 'Do you guys sell fountain pens or not?' },
        { speaker: 'agent', text: 'Sawa.' },
      ]);
      assert.deepEqual(ledger.unanswered, ['Do you guys sell fountain pens or not?']);
    });
  });
}

test('flag on: HD_60e56c6acc88 speaks the trusted time line in the caller\'s language (Sheng mix)', () => {
  withFlag('on', () => {
    const p = plan();
    assert.equal(p.speak, true);
    assert.equal(p.ask, 'time');
    assert.equal(p.language, 'sheng');
    assert.equal(p.line, 'Saa hii ni saa tatu na dakika hamsini na mbili usiku, yaani 9:52 PM.');
  });
});

test('flag on: pure Kiswahili and English asks get sw and en lines', () => {
  withFlag('on', () => {
    assert.equal(plan({ callerText: 'Ni saa ngapi sasa?' }).line, 'Saa hii ni saa tatu na dakika hamsini na mbili usiku.');
    assert.equal(plan({ callerText: 'What time is it?', language: 'en' }).line, "It's 9:52 PM in Kenya now.");
  });
});

test('flag on: never twice in a turn', () => {
  withFlag('on', () => {
    const state = clone(FIX.brainState);
    assert.equal(plan({ state }).speak, true);
    const again = plan({ state });
    assert.equal(again.speak, false);
    assert.equal(again.reason, 'already_spoken');
    state.conversation.turnCount = 2;
    assert.equal(plan({ state }).speak, true);
  });
});

test('flag on: skipped when the reply (or the guard\'s fact line) already said the time', () => {
  withFlag('on', () => {
    for (const said of [
      "It's 9:52 PM in Kenya now.",
      'Saa hii ni saa tatu na dakika hamsini na mbili usiku.',
      'Tuko closed kwa sasa. Saa hii ni saa tatu na dakika hamsini na mbili usiku, yaani 9:52 PM.',
    ]) {
      const p = plan({ spokenText: said });
      assert.equal(p.speak, false, said);
      assert.equal(p.reason, 'answered', said);
    }
  });
});

test('flag on: a wrong time or an hours range does not count as the answer', () => {
  withFlag('on', () => {
    assert.equal(plan({ spokenText: "It's 4:10 PM now." }).speak, true);
    // A range that happens to contain the current hour is still hours.
    assert.equal(plan({ spokenText: 'We are open from 9:52 PM to 11 PM.' }).speak, true);
    assert.equal(enforce.spokenAnswersClock(SPOKEN, require('../src/conversation/trustedFacts').trustedFactsFor({ now: NOW }), 'time'), false);
  });
});

test('flag on: not a clock ask -> nothing (hours, visit, closing questions)', () => {
  withFlag('on', () => {
    for (const ask of ['Saa ngapi mnafungua?', 'What time do you open?', 'Mtakuja saa ngapi kesho?', 'Do you have T-squares?']) {
      const p = plan({ callerText: ask });
      assert.equal(p.speak, false, ask);
      assert.equal(p.reason, 'no_clock_ask', ask);
    }
  });
});

test('flag on: a date question gets the date line', () => {
  withFlag('on', () => {
    assert.equal(plan({ callerText: "What's the date today?", language: 'en', spokenText: 'We are closed now.' }).line, 'Today is Saturday, 17 October 2026.');
    assert.match(plan({ callerText: 'Leo ni tarehe ngapi?', spokenText: 'Sawa.' }).line, /^Leo ni /);
  });
});

test('flag on: the owner review keeps an unresolved call with open questions unresolved', () => {
  withFlag('on', () => {
    const m = merge();
    assert.equal(m.resolution, 'unresolved');
    assert.equal(m.applied.resolution, false);
    // Reason and card still apply (English, from the review).
    assert.equal(m.applied.reason, true);
  });
});

test('flag on: with no open questions the FAQ upgrade to resolved still happens', () => {
  withFlag('on', () => {
    const m = mergeTranscriptReview({
      derived: { resolution: 'unresolved', primaryIntent: 'general_enquiry', unansweredQuestions: [] },
      summary: { reason: 'x', unanswered_questions: [] },
      toolFlags: {},
      review: clone(FIX.review),
      vertical: 'retail',
      callerTurns: [FIX.caller],
    });
    assert.equal(m.resolution, 'resolved');
    // The sweep path has only the summary JSON (no derived ledger).
    const sweep = mergeTranscriptReview({
      derived: { resolution: 'unresolved', primaryIntent: 'general_enquiry' },
      summary: clone(FIX.summary),
      toolFlags: {},
      review: clone(FIX.review),
      vertical: 'retail',
      callerTurns: [FIX.caller],
    });
    assert.equal(sweep.resolution, 'unresolved');
  });
});

test('flag on: summary Goal and reason come from the structured need, in English', () => {
  withFlag('on', () => {
    const summary = deriveCallSummary({ brainState: clone(FIX.brainState) });
    assert.equal(summary.text, 'Intent: general_enquiry. Goal: the current time');
    assert.equal(summary.reason, 'Caller asked about the current time.');
    assert.doesNotMatch(summary.text + summary.reason, /saa ngapi|Shai|Are you doing/i);
    assert.equal(structuredGoalText({ goal: { primary: 'learn_price', description: 'bei ya T-square ni ngapi' } }), 'a price');
    assert.equal(structuredGoalText({ goal: { primary: 'something_new', description: 'nataka kitu' } }), '');
    assert.equal(structuredGoalText({ conversation: { answersReceived: ['Leo ni tarehe ngapi?'] }, goal: {} }), "today's date");
  });
});

test('flag on: the spoken-question ledger labels never quote raw caller words', () => {
  withFlag('on', () => {
    const ledger = spokenQuestionLedger([
      { speaker: 'caller', text: 'Do you guys sell fountain pens or not?' },
      { speaker: 'agent', text: 'Sawa.' },
    ]);
    assert.deepEqual(ledger.unanswered, ['a question']);
    const time = spokenQuestionLedger([
      { speaker: 'caller', text: FIX.caller },
      { speaker: 'agent', text: SPOKEN },
      { speaker: 'agent', text: 'Saa hii ni saa tatu na dakika hamsini na mbili usiku, yaani 9:52 PM.' },
    ]);
    assert.deepEqual(time.answered, ['the time']);
    assert.deepEqual(time.unanswered, []);
  });
});

test('server wiring: the time line is flag-gated, once per turn, after the reply and before the empty-turn repair', () => {
  assert.match(SERVER, /require\('\.\/src\/conversation\/timeAnswerEnforce'\)/);
  assert.match(SERVER, /if \(!bargeInActive && tts && timeAnswerEnforceEnabled\(\)\) \{/);
  assert.match(SERVER, /planTimeAnswer\(\{\s*callerText: clean,/);
  const at = SERVER.indexOf('time answer enforced ask=');
  assert.ok(at > SERVER.indexOf('if (result?.actionConfirmation && !bargeInActive) {'));
  assert.ok(at < SERVER.indexOf('reason=empty_answer'));
});
