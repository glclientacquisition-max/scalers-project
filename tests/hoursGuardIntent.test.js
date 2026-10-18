'use strict';

// HD_49d726c3dc9b (prod Aris, 18 Oct 2026 13:14 EAT, build ae8508ea).
// "Uh, Tuesday at what time will you be open?" missed looksLikeHoursAsk, so
// the speech guard never compared the model's sentence with the hours on file
// and three correct answers were replaced by "I don't have that on file."
// The exact caller lines and model sentences from turns 9, 10 and 12 follow.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { guardSpokenReply, hoursAskInPlay } = require('../src/conversation/speechGuard');
const { polishSpokenDetail } = require('../src/conversation/dynamicSpeech');
const { looksLikeHoursAsk, hoursAskLine } = require('../src/conversation/knownFacts');

const ARIS = require(path.join(__dirname, 'fixtures', 'guard-trusted-facts', 'HD_95e6745c0df1.json'));
const PROFILE = { businessName: ARIS.businessName, hoursSchedule: ARIS.hoursSchedule };
// Turn 9 caller final: 10:16:51 UTC = 13:16:51 EAT, Sunday.
const AT_T9 = Date.parse('2026-10-18T10:16:51Z');

const T8 = "But maybe I can pass by tomorrow. I'm, I'm, I'm a student in— I'm a student in UON.";
const T9 = 'Uh, Tuesday at what time will you be open?';
const T10 = 'Like at, at what time?';
const T12 = 'At what time are you—';
const SAID_T9 = 'OnTuesday, we will be open from 9:30 AM to 6:00 PM.';
const SAID_T10 = 'Weopen at 9:30 AM in the morning on Tuesday.';
const SAID_T12 = 'Weopenat 9:30 AM and close at 6:00 PM on Tuesday.';

function quiet(fn) {
  const warn = console.warn;
  const log = console.log;
  console.warn = () => {};
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
    console.log = log;
  }
}

function guard(text, callerTurns, { intent, profile = PROFILE, language = 'en' } = {}) {
  return quiet(() =>
    guardSpokenReply(text, {
      callerTurns,
      profile,
      toolResults: [],
      capabilities: {},
      state: { caller: {}, intent, conversation: { answersReceived: callerTurns, turnCount: 9 } },
      language,
      allowEmpty: true,
      now: AT_T9,
    })
  );
}

test('turn 9: the exact caller line is an hours ask', () => {
  assert.equal(looksLikeHoursAsk(T9), true);
  assert.match(hoursAskLine(T9, PROFILE, 'en', new Date(AT_T9)), /9:30 AM to 6 PM/);
});

test('turns 9, 10, 12: correct hours on file are kept', () => {
  assert.equal(guard(SAID_T9, [T8, T9]), SAID_T9);
  // Turn 10: a bare "at what time?" right after the hours ask.
  assert.equal(guard(SAID_T10, [T8, T9, T10]), SAID_T10);
  // Turn 12: Brain's intent is hours; the cut-off line alone says nothing.
  assert.equal(guard(SAID_T12, [T9, T10, T12], { intent: 'hours' }), SAID_T12);
  assert.equal(guard(SAID_T12, [T9, T10, T12]), SAID_T12);
});

test('Brain intent=hours alone lets the hours on file through', () => {
  assert.equal(guard(SAID_T12, ['Like, okay.', T12], { intent: 'hours' }), SAID_T12);
  assert.equal(hoursAskInPlay({ callerTurns: ['hmm'], intent: 'hours' }), 'context');
  assert.equal(hoursAskInPlay({ callerTurns: ['hmm'], state: { intent: 'hours' } }), 'context');
  assert.equal(hoursAskInPlay({ callerTurns: [T9] }), 'ask');
  assert.equal(hoursAskInPlay({ callerTurns: [T10] }), '');
  assert.equal(hoursAskInPlay({ callerTurns: ['ok'], state: { intent: 'booking' } }), '');
});

test('polishSpokenDetail passes the brain state intent to the guard', () => {
  const state = { caller: {}, intent: 'hours', conversation: { answersReceived: [T12], turnCount: 12 } };
  const out = quiet(() =>
    polishSpokenDetail(SAID_T12, { state, profile: PROFILE, callerTurns: [T12], language: 'en', now: AT_T9 })
  );
  assert.match(String(out.text ?? out), /9:30 AM/);
});

test('wider hours asks: English, Kiswahili, Sheng, day + time', () => {
  for (const text of [
    T9,
    'When will you be open?',
    'Will you be open on Tuesday?',
    'Are you open on Saturday?',
    'What time will the shop close?',
    'What time would you be closing tomorrow?',
    'Saa ngapi mtafungua Jumanne?',
    'Mnafungua saa ngapi kesho?',
    'Mko wazi saa ngapi?',
    'Kesho mtafungua lini?',
    'Mtakuwa wazi Jumamosi?',
    'Mnaopen saa ngapi?',
    'Jumanne mnaopen saa ngapi?',
    'Mnaclose saa ngapi?',
    'Mko open Jumapili?',
  ]) {
    assert.equal(looksLikeHoursAsk(text), true, text);
  }
});

test('visit, delivery and arrival times are not hours asks', () => {
  for (const text of [
    T10,
    T12,
    'Can you come until what time?',
    'What time can you come?',
    'What time will you come?',
    'What time will you deliver?',
    'When will the fundi come?',
    'Mtafika saa ngapi?',
    'Mtaleta saa ngapi?',
    'I work until what time?',
    'at 9.',
  ]) {
    assert.equal(looksLikeHoursAsk(text), false, text);
  }
});

test('the guard stays strict: numbers not on file are still dropped', () => {
  // A wrong opening clock on an hours ask: the file line replaces it.
  const wrong = guard('We open at 8:00 AM on Tuesday.', [T9]);
  assert.doesNotMatch(wrong, /8:00/);
  assert.match(wrong, /9:30 AM to 6 PM/);
  // Intent=hours does not authorize a clock that is not on file.
  assert.doesNotMatch(guard('We close at 7:00 PM on Tuesday.', [T12], { intent: 'hours' }), /7:00/);
  // Nor a count that happens to equal the minute of a 9:30 opening.
  assert.doesNotMatch(guard('We have 30 notebooks.', ['ok'], { intent: 'hours' }), /30/);
  assert.doesNotMatch(guard('A T-square is 930 shillings.', [T9]), /930/);
  // A bare "what time?" with no hours ask before it is not an hours turn.
  assert.doesNotMatch(guard('We open at 9:30 AM.', ['Do you deliver?', T10]), /9:30/);
  // A visit time on a booking turn is still a number nobody said.
  assert.doesNotMatch(guard('I can book you for 9:30 AM.', ['Can you come Tuesday?'], { intent: 'booking' }), /9:30/);
  // No hours on file: nothing to match, the clock still drops.
  assert.doesNotMatch(guard(SAID_T9, [T9], { profile: { businessName: 'X' } }), /9:30/);
});
