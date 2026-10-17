'use strict';

// HD_cd0c01f28b05 (staging Jirani, 17 Oct 2026 20:00 EAT, pin 1510b2b0).
// Alvin asked "What time is it?". The stored-name gate took the turn with
// "Am I speaking with Alwyn?". Three turns of spelling followed. The model's
// "Right now in Kenya, it is 8:00 PM." was then dropped as unbound_place
// ("Kenya" is not a service place), the call was still saved as
// "Answered: What time is it.", and the lead email said
// "Reason: correct name spelling".
//
// (1) A sentence that states the trusted time or date is checked by the
//     trusted-facts path first. Its country, capital and zone words are the
//     time zone, never a service place.
// (2) A caller question owns its turn. The file-name ask waits for a later turn.
// (3) "Answered" comes from what was spoken after the guard.
// (4) The lead reason is the caller's need, not the name detour.

const test = require('node:test');
const assert = require('node:assert/strict');

const FX = require('./fixtures/voice-calls/HD_cd0c01f28b05.call.json');
const TENANT = require('./fixtures/tenants/jirani-staging.json');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const { buildCallerMemoryCard } = require('../src/conversation/callerMemory');
const { createBrainState, observeCallerTurn, formatBrainStateForPrompt } = require('../src/conversation/brainState');
const { planCallerModelTurn } = require('../src/conversation/turnPolicy');
const { guardSpokenReply, splitSentences } = require('../src/conversation/speechGuard');
const { polishSpokenDetail } = require('../src/conversation/dynamicSpeech');
const facts = require('../src/conversation/trustedFacts');
const qf = require('../src/conversation/questionFirst');
const spoken = require('../src/conversation/spokenAnswers');
const { deriveCallResolution } = require('../src/conversation/callResolution');
const { deriveCallSummary } = require('../src/conversation/callSummary');
const { validateCallerInfo } = require('../src/conversation/toolExecution');
const { isNameDetourReason, usableLeadReason } = require('../src/conversation/leadReason');
const { ownerLeadEvent } = require('../src/notifications/events');

const AT_TIME_ANSWER = Date.parse('2026-10-17T17:00:55.000Z'); // 20:00:55 EAT
const PROMPT_CLOCK = Date.parse('2026-10-17T17:00:54.140Z');
const NOW = new Date(FX.startedAt);

function withEnv(vars, fn) {
  const before = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    if (v == null) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

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

function jirani() {
  const profile = profileFromSnapshot(JSON.parse(JSON.stringify(TENANT)));
  profile.callerMemory = buildCallerMemoryCard({
    contact: FX.callerFile.contact,
    openRequests: [],
    openAppointments: [],
    now: NOW,
  });
  return profile;
}

function guardCtx(callerTurns, { now = AT_TIME_ANSWER, language = 'en', profile = jirani(), turnCount = 5 } = {}) {
  return {
    callerTurns,
    profile,
    toolResults: [],
    capabilities: {},
    state: { caller: {}, conversation: { answersReceived: [], turnCount, promptClockMs: PROMPT_CLOCK } },
    language,
    allowEmpty: true,
    now,
    dropReasons: [],
  };
}

const CALLER_TURNS = FX.turns.map((t) => t.caller);
const TURN5 = FX.turns.find((t) => t.turn === 5);

// ------------------------------------------------------------------ (1)

test('(1) replay t5: flag off reproduces the live drop; on keeps the trusted time sentence', () => {
  const offCtx = guardCtx(CALLER_TURNS);
  const off = withEnv({ VOICE_GUARD_TRUSTED_FACTS: 'off' }, () => quiet(() => guardSpokenReply(TURN5.live.modelText, offCtx)));
  assert.doesNotMatch(off, /8:00 PM/, 'live: the time was removed');
  assert.ok(offCtx.dropReasons.includes('unbound_place'), 'live reason was unbound_place');

  const onCtx = guardCtx(CALLER_TURNS);
  const on = quiet(() => guardSpokenReply(TURN5.live.modelText, onCtx));
  assert.match(on, /Right now in Kenya, it is 8:00 PM\./);
  assert.match(on, /Thank you for clarifying, Alvin\./);
  assert.ok(!onCtx.dropReasons.includes('unbound_place'), `no place drop: ${onCtx.dropReasons}`);
});

test('(1) streamed per sentence (as prod speaks): the time chunk survives polish', () => {
  for (const chunk of splitSentences(TURN5.live.modelText)) {
    const out = quiet(() => polishSpokenDetail(chunk, guardCtx(CALLER_TURNS)).text);
    if (/8:00 PM/.test(chunk)) assert.match(out, /8:00 PM/, `chunk kept: ${chunk}`);
  }
});

test('(1) zone words in EN, SW and Sheng time and date sentences are never service places', () => {
  const cases = [
    ['What time is it?', 'Right now in Kenya, it is 8:00 PM.', 'en'],
    ['What time is it?', "It's 8:00 PM in Nairobi.", 'en'],
    ['What time is it?', 'It is 8:00 PM Kenya time.', 'en'],
    ['What time is it?', 'The time here in Kenya is 8:00 PM.', 'en'],
    ['What time is it?', 'It is 8:00 PM, East Africa Time.', 'en'],
    ['Saa ngapi?', 'Sasa hivi huku Kenya ni saa mbili usiku.', 'sw'],
    ['Saa ngapi?', 'Saa hii ni saa mbili usiku, saa za Afrika Mashariki.', 'sw'],
    ['Ni saa ngapi?', 'Hapa Nairobi ni saa mbili kamili usiku.', 'sw'],
    ['Ngapi time sai?', 'Sai ni saa mbili usiku Kenya, yaani 8:00 PM.', 'sheng'],
  ];
  for (const [ask, line, lang] of cases) {
    const ctx = guardCtx([ask], { language: lang });
    const out = quiet(() => guardSpokenReply(line, ctx));
    assert.equal(out, line, `${lang} "${line}" kept (drops: ${ctx.dropReasons})`);
  }
  // The date, too, and the Kiswahili date word ("tarehe" is not Starehe).
  const dateCtx = guardCtx(['What is the date today?']);
  const dateLine = 'Today in Kenya is Saturday, 17 October 2026.';
  assert.equal(quiet(() => guardSpokenReply(dateLine, dateCtx)), dateLine);
  const swDate = guardCtx(['Leo ni tarehe ngapi?'], { language: 'sw' });
  const swDateLine = 'Leo huku Kenya ni tarehe 17 Oktoba.';
  assert.equal(quiet(() => guardSpokenReply(swDateLine, swDate)), swDateLine, `drops: ${swDate.dropReasons}`);
});

test('(1) the code fact line re-guarded passes in every language', () => {
  const trusted = facts.trustedFactsFor({ now: AT_TIME_ANSWER });
  for (const [lang, ask] of [['en', 'What time is it?'], ['sw', 'Saa ngapi?'], ['sheng', 'Ngapi time sai?']]) {
    const line = facts.timeFactLine(trusted, lang);
    assert.equal(quiet(() => guardSpokenReply(line, guardCtx([ask], { language: lang }))), line, `${lang}: ${line}`);
  }
});

test('(1) only zone words are freed: a real unbound place and a wrong clock still drop', () => {
  const rongai = guardCtx(['What time is it?']);
  const out = quiet(() => guardSpokenReply('It is 8:00 PM here in Rongai.', rongai));
  assert.ok(rongai.dropReasons.includes('unbound_place'));
  assert.equal(out, "It's 8:00 PM in Kenya now.", 'the code line answers instead');

  const wrong = guardCtx(['What time is it?']);
  const wrongOut = quiet(() => guardSpokenReply('Right now in Kenya, it is 3:00 PM.', wrong));
  assert.ok(wrong.dropReasons.includes('unsaid_number'), `wrong clock judged as a number: ${wrong.dropReasons}`);
  assert.ok(!wrong.dropReasons.includes('unbound_place'), 'not mislabelled as a place');
  assert.equal(wrongOut, "It's 8:00 PM in Kenya now.");

  const sw = guardCtx(['Saa ngapi?'], { language: 'sw' });
  assert.equal(quiet(() => guardSpokenReply('Saa hii huku Kenya ni saa tisa.', sw)), 'Saa hii ni saa mbili usiku.');

  // A non-clock sentence: unchanged behaviour.
  const coverage = guardCtx(['Where are you?']);
  quiet(() => guardSpokenReply('We are in Mombasa.', coverage));
  assert.ok(coverage.dropReasons.includes('unbound_place'), 'a plain place claim still drops');
});

test('(1) maskTimeZonePlaces removes only zone words', () => {
  assert.equal(facts.maskTimeZonePlaces('Right now in Kenya, it is 8:00 PM.'), 'Right now , it is 8:00 PM.');
  assert.equal(facts.maskTimeZonePlaces('Sasa hivi huku Kenya ni saa mbili usiku.'), 'Sasa hivi ni saa mbili usiku.');
  assert.match(facts.maskTimeZonePlaces('It is 8 PM in Kenya, we come to Rongai.'), /Rongai/);
});

// ------------------------------------------------------------------ (2)

/** Observe each caller turn, then the name gate, as server.js does. */
function nameGateReplay(turns, { lastAgent = 'Good evening, Jirani Cleaning Services, this is Wanjiru.' } = {}) {
  const profile = jirani();
  let state = createBrainState(profile);
  let last = lastAgent;
  const rows = [];
  for (const text of turns) {
    state = observeCallerTurn(state, { text, lastAgentText: last, resolvedLanguage: 'en', profile, now: NOW });
    const gate = planCallerModelTurn(state, { unfinishedDecided: true, profile });
    rows.push({ text, gate, caller: { ...state.caller }, prompt: formatBrainStateForPrompt(state) });
    if (!gate.runModel && gate.line) {
      state.caller.fileNameAskSpoken = true;
      last = gate.line;
    } else {
      last = "It's 8:00 PM in Kenya now. How can I help?";
    }
  }
  return rows;
}

test('(2) live order with the flag off: "What time is it?" gets only the name ask (as on staging)', () =>
  withEnv({ BRAIN_CALL_FIXES_D199: 'on', VOICE_QUESTION_BEFORE_NAME: 'off' }, () => {
    const [hello, time] = nameGateReplay(['Hello.', 'What time is it?']);
    assert.equal(hello.gate.runModel, true);
    assert.equal(time.gate.runModel, false);
    assert.equal(time.gate.line, 'Am I speaking with Alwyn?');
  }));

test('(2) EN: the time question owns the turn; the name ask follows on the next turn', () =>
  withEnv({ BRAIN_CALL_FIXES_D199: 'on', VOICE_QUESTION_BEFORE_NAME: null }, () => {
    const [, time, next] = nameGateReplay(['Hello.', 'What time is it?', 'Okay.']);
    assert.equal(time.gate.runModel, true, 'the model answers the time');
    assert.equal(time.gate.line, '');
    assert.equal(time.gate.deferredFor, 'time');
    assert.match(time.prompt, /They just asked a question\. Answer it first/);
    assert.doesNotMatch(time.prompt, /Ask once, in these words: Am I speaking with/);
    // "Okay." to the time answer is not a yes to a name ask nobody spoke.
    assert.equal(next.caller.nameConfirmed, false);
    assert.equal(next.gate.runModel, false);
    assert.equal(next.gate.line, 'Am I speaking with Alwyn?');
  }));

test('(2) SW: "Saa ngapi?" owns the turn too; works with D199 off (prod today)', () => {
  for (const d199 of ['on', 'off']) {
    withEnv({ BRAIN_CALL_FIXES_D199: d199 }, () => {
      const rows = nameGateReplay(['Saa ngapi?', 'Sawa.']);
      assert.equal(rows[0].gate.runModel, true, `D199=${d199}: model answers`);
      assert.equal(rows[0].gate.deferredFor, 'time');
      assert.equal(rows[1].caller.nameConfirmed, false, `D199=${d199}: "Sawa." does not confirm`);
      assert.equal(rows[1].gate.line, 'Am I speaking with Alwyn?');
    });
  }
});

test('(2) a yes to a spoken ask still binds the file name', () =>
  withEnv({ BRAIN_CALL_FIXES_D199: 'on' }, () => {
    const rows = nameGateReplay(['What time is it?', 'Okay.', 'Yes.']);
    assert.equal(rows[1].gate.line, 'Am I speaking with Alwyn?');
    assert.equal(rows[2].caller.nameConfirmed, true);
  }));

test('(2) not deferred: the caller\'s own file, a booking, a knowledge ask with a local line', () =>
  withEnv({ BRAIN_CALL_FIXES_D199: 'on' }, () => {
    assert.equal(qf.questionOwnsTurn('When is my booking?'), '');
    assert.equal(qf.questionOwnsTurn('Where is my order?'), '');
    assert.equal(qf.questionOwnsTurn('Can you come tomorrow?'), '');
    assert.equal(qf.questionOwnsTurn('Which services do you offer?'), '');
    assert.equal(qf.questionOwnsTurn('What are your hours?'), '');
    assert.equal(qf.questionOwnsTurn('How much is a deep clean?'), '');
    assert.equal(qf.questionOwnsTurn('About my booking.'), '');
    assert.equal(qf.questionOwnsTurn('A-L-V-I-N, Alwyn.'), '');
    assert.equal(qf.questionOwnsTurn('Hello.'), '');
    assert.equal(qf.questionOwnsTurn('What time is it?'), 'time');
    assert.equal(qf.questionOwnsTurn('Saa ngapi?'), 'time');
    assert.equal(qf.questionOwnsTurn('Leo ni tarehe ngapi?'), 'date');
    assert.equal(qf.questionOwnsTurn('Do you do carpets?'), 'question');
    const [file] = nameGateReplay(['When is my booking?']);
    assert.equal(file.gate.line, 'Am I speaking with Alwyn?');
    // A committed local fact line already answers first: unchanged.
    const profile = jirani();
    let state = createBrainState(profile);
    state = observeCallerTurn(state, { text: 'What time is it?', resolvedLanguage: 'en', profile, now: NOW });
    const gate = planCallerModelTurn(state, { unfinishedDecided: true, profile, publicAnswerCommitted: true });
    assert.equal(gate.line, 'Am I speaking with Alwyn?');
  }));

// ------------------------------------------------------------------ (3)

function liveBrain() {
  return withEnv({ BRAIN_CALL_FIXES_D199: 'on' }, () => {
    const profile = jirani();
    let state = createBrainState(profile);
    for (const t of FX.turns) {
      state = observeCallerTurn(state, { text: t.caller, resolvedLanguage: 'en', profile, now: NOW });
    }
    state.resolution = { ...(state.resolution || {}), status: 'resolved', nextBestAction: 'ANSWER' };
    state.goal = { ...(state.goal || {}), description: 'What time is it', status: 'active', missingSlots: [] };
    return state;
  });
}

test('(3) the live transcript: the time was never spoken, so it is not "Answered"', () =>
  withEnv({ BRAIN_CALL_FIXES_D199: 'on' }, () => {
    const brainState = liveBrain();
    const old = deriveCallResolution({ brainState });
    assert.equal(old.resolution, 'resolved', 'goal-text path (what staging saved)');
    const derived = deriveCallResolution({ brainState, spokenTurns: FX.transcript });
    assert.equal(derived.resolution, 'unresolved');
    assert.equal(derived.resolutionNote, 'Not answered: the time.');
    assert.deepEqual(derived.answeredQuestions, []);
    assert.deepEqual(derived.unansweredQuestions, ['the time']);
  }));

test('(3) a spoken time line (EN or SW) counts as answered; flag off keeps the goal note', () =>
  withEnv({ BRAIN_CALL_FIXES_D199: 'on' }, () => {
    const brainState = liveBrain();
    for (const line of ["It's 8:00 PM in Kenya now.", 'Saa hii ni saa mbili usiku.']) {
      const turns = [...FX.transcript];
      turns.splice(3, 0, { speaker: 'agent', text: line });
      const derived = deriveCallResolution({ brainState, spokenTurns: turns });
      assert.equal(derived.resolution, 'resolved', line);
      assert.equal(derived.resolutionNote, 'Answered: the time.');
    }
    const off = withEnv({ VOICE_SPOKEN_OUTCOME: 'off' }, () =>
      deriveCallResolution({ brainState, spokenTurns: FX.transcript })
    );
    assert.equal(off.resolution, 'resolved');
    assert.equal(off.answeredQuestions, undefined);
  }));

test('(3) non-answers never count: name ask, re-ask, help offer, fillers, not on file', () => {
  for (const line of [
    'Am I speaking with Alwyn?',
    'Sorry, say that again?',
    'Thank you for clarifying, Alvin. How can I help you today?',
    'Mm-hmm.',
    "I don't have that on file.",
    'Je, naongea na Alwyn?',
  ]) {
    assert.equal(spoken.lineAnswers('time', line), false, line);
    assert.equal(spoken.lineAnswers('question', line), false, line);
  }
  assert.equal(spoken.lineAnswers('question', 'Yes, we clean carpets.'), true);
  assert.equal(spoken.lineAnswers('price', 'A deep clean is KSh 4,500.'), true);
  assert.equal(spoken.lineAnswers('hours', 'We open at 7:30 AM tomorrow.'), true);
});

// ------------------------------------------------------------------ (4)

test('(4) the name detour is never saved as the call reason', () => {
  const saved = validateCallerInfo({ name: 'Alvin', reason: 'correct name spelling' });
  assert.equal(saved.valid, true, 'the name still saves');
  assert.equal(saved.value.name, 'Alvin');
  assert.equal(saved.value.reason, '');
  for (const r of ['correct name spelling', 'Name correction', 'Confirming caller name', 'Caller spelled name A-L-V-I-N', 'Kurekebisha jina']) {
    assert.equal(isNameDetourReason(r), true, r);
  }
  for (const r of ['Wants a deep clean, gave name', 'Asked what time it is', 'Name change on booking', 'Who is the owner?', 'Live line could not complete. Team to follow up.']) {
    assert.equal(isNameDetourReason(r), false, r);
  }
});

test('(4) the lead reason falls back to the caller need Brain recorded', () =>
  // Legacy wording; VOICE_TIME_ANSWER_ENFORCE=on says "the current time"
  // instead (tests/timeAnswerEnforce.test.js).
  withEnv({ BRAIN_CALL_FIXES_D199: 'on', VOICE_TIME_ANSWER_ENFORCE: null }, () => {
    const brain = liveBrain();
    brain.caller = { ...brain.caller, name: 'Alvin', nameConfirmed: true };
    const need = usableLeadReason(deriveCallSummary({ brainState: brain }).reason);
    assert.match(need, /asked about what time (?:it is|is it)/i);
    // The server builds the lead from the call row with that need when the
    // saved reason is missing or the detour.
    const call = { name: 'Alvin', from_number: '+254700000000', reason: FX.after.leadReason };
    const leadCall = { ...call, reason: usableLeadReason(call.reason) || need };
    const event = ownerLeadEvent(leadCall, FX.businessName);
    assert.match(event.caller.reason, /what time (?:it is|is it)/i);
    assert.doesNotMatch(event.caller.reason, /spelling/i);
  }));
