// HD_1b3a67ea7ee9 (staging, 2026-10-09 12:02 EAT, build c8fb514f): the file
// was masked before the name confirm and the agent said "There are no
// bookings saved under this number right now"; the name was asked twice; and
// on "Yeah" the visit facts lost to a price line. BRAIN_CALL_FIXES_D199=on
// fixes them (items 6, 7, 8); off keeps the old behaviour.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const FIXTURE = require('./fixtures/voice-calls/HD_1b3a67ea7ee9.call.json');
const TENANT = require('./fixtures/tenants/done-and-dusted-staging.json');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const { buildCallerMemoryCard, formatReturningFileForCallState } = require('../src/conversation/callerMemory');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');
const { planCallerModelTurn } = require('../src/conversation/turnPolicy');
const { planVisitReadTurn } = require('../src/conversation/openLineSpeech');
const { guardSpokenReply } = require('../src/conversation/speechGuard');
const { setVoiceRendererForTest, TEMPLATES } = require('../src/conversation/factLine');

before(() => setVoiceRendererForTest(null));
after(() => setVoiceRendererForTest(undefined));

const NOW = new Date(FIXTURE.startedAt);

function withFlag(value, fn) {
  const prev = process.env.BRAIN_CALL_FIXES_D199;
  if (value == null) delete process.env.BRAIN_CALL_FIXES_D199;
  else process.env.BRAIN_CALL_FIXES_D199 = value;
  try {
    return fn();
  } finally {
    if (prev == null) delete process.env.BRAIN_CALL_FIXES_D199;
    else process.env.BRAIN_CALL_FIXES_D199 = prev;
  }
}

function callProfile() {
  const card = buildCallerMemoryCard({
    contact: FIXTURE.callerFile.contact,
    openRequests: FIXTURE.callerFile.requests,
    openAppointments: FIXTURE.callerFile.openAppointments,
    now: NOW,
  });
  const profile = profileFromSnapshot(TENANT);
  profile.callerMemory = card;
  profile.openAppointments = FIXTURE.callerFile.openAppointments;
  return profile;
}

function guard(state, profile, text, callerTurn) {
  return guardSpokenReply(text, {
    language: 'en',
    state,
    profile,
    callerTurns: [...(state.conversation?.answersReceived || []), callerTurn].filter(Boolean),
    toolResults: [],
  });
}

/**
 * Replay answered caller turns 1..upto as the server does: observe, then the
 * name gate. A code ask marks the asked flag; the model's spoken line (from
 * the trace) goes through the speech guard, or is replaced by modelSay.
 */
function replay(upto, { onTurn } = {}) {
  const profile = callProfile();
  let state = createBrainState(profile);
  let lastAgent = 'Good morning, Done and Dusted, this is Shy. You can speak in English or Kiswahili. Tukusaidie vipi.';
  const asks = [];
  for (const turn of FIXTURE.turns.filter((t) => t.turn <= upto && !t.held)) {
    const entities = extractConversationEntities(turn.caller, {
      profile,
      intent: state.intent && state.intent !== 'unknown' ? state.intent : 'general_enquiry',
      state,
    });
    state = observeCallerTurn(state, {
      text: turn.caller,
      entities,
      lastAgentText: lastAgent,
      detectedLanguage: turn.language,
      resolvedLanguage: turn.language,
      profile,
      now: NOW,
    });
    const gate = planCallerModelTurn(state, {
      unfinishedDecided: true,
      holdTimedOut: turn.holdTimedOut === true,
      profile,
    });
    let spoken;
    if (!gate.runModel && gate.line) {
      state.caller.fileNameAskSpoken = true;
      asks.push({ turn: turn.turn, by: 'code' });
      spoken = gate.line;
    } else {
      const say = turn.modelSay ? turn.modelSay.join(' ') : turn.spoken || '';
      spoken = guard(state, profile, say, turn.caller);
      if (/\bam i speaking with\b/i.test(spoken)) asks.push({ turn: turn.turn, by: 'model' });
    }
    if (onTurn) onTurn(turn, { state, gate, spoken, profile });
    lastAgent = spoken || lastAgent;
  }
  return { state, asks, profile };
}

describe('HD_1b3a67ea7ee9 replay, BRAIN_CALL_FIXES_D199=on', () => {
  it('(7) greeting and fragments wait; the one name ask fires on t5 "About my book."; never twice', () =>
    withFlag('on', () => {
      const gates = {};
      const { asks, state } = replay(6, { onTurn: (t, r) => { gates[t.turn] = r; } });
      assert.equal(gates[2].gate.runModel, true);
      assert.equal(gates[2].gate.nameAskDeferred, true);
      assert.equal(gates[4].gate.runModel, true);
      assert.equal(gates[5].gate.runModel, false);
      assert.equal(gates[5].gate.line, 'Am I speaking with Alvin?');
      // t6 "About my booking.": the model's "Am I speaking with Alvin?" is a repeat.
      assert.doesNotMatch(gates[6].spoken, /am i speaking with/i);
      assert.deepEqual(asks, [{ turn: 5, by: 'code' }]);
      assert.equal(state.caller.fileNameAskSpoken, true);
      // A pure greeting that was not held also waits.
      const fresh = createBrainState(callProfile());
      fresh.conversation.answersReceived = ['Hello.'];
      assert.equal(planCallerModelTurn(fresh, { unfinishedDecided: true }).runModel, true);
    }));

  it('(7) a name ask the model already spoke counts as the one ask', () =>
    withFlag('on', () => {
      const profile = callProfile();
      let state = createBrainState(profile);
      state = observeCallerTurn(state, { text: 'About my booking.', lastAgentText: 'Am I speaking with Alvin?', resolvedLanguage: 'en', profile, now: NOW });
      assert.equal(state.caller.fileNameAskSpoken, true);
      assert.equal(planCallerModelTurn(state, { unfinishedDecided: true }).line, '');
    }));

  it('(6) no line may claim an empty file while it is masked: confirm_identity_first instead', () =>
    withFlag('on', () => {
      let t5;
      replay(5, { onTurn: (t, r) => { if (t.turn === 4) t5 = r; } });
      const { state, profile } = { state: t5.state, profile: t5.profile };
      state.conversation.answersReceived.push('About my book.');
      assert.equal(state.caller.nameConfirmed, false);
      assert.equal(state.returning.hasOpenRows, true);
      assert.deepEqual(state.returning.openRows, []);
      // The live t5 model reply.
      const live = guard(state, profile, FIXTURE.turns[4].modelSay.join(' '), 'About my book.');
      assert.doesNotMatch(live, /no bookings/i);
      assert.equal(live, "Let me just confirm who I'm speaking with first. Am I speaking with Alvin?");
      // A bare claim gets the template with the ask, and the ask is marked.
      const fresh = createBrainState(callProfile());
      fresh.conversation.answersReceived = ['About my book.'];
      fresh.caller.fileNameAsked = 'Alvin';
      const bare = guard(fresh, profile, 'There are no bookings saved under this number right now.', 'About my book.');
      assert.equal(bare, "Let me just confirm who I'm speaking with. Am I speaking with Alvin?");
      assert.equal(fresh.caller.fileNameAskSpoken, true);
      assert.equal(fresh.conversation.pendingBrainLines[0].template, 'confirm_identity_first');
      assert.equal(fresh.conversation.pendingBrainLines[0].slots.ask, true);
      for (const claim of ["I don't see any bookings on file.", 'Hakuna booking kwa namba hii.', 'You have no visits right now.']) {
        assert.doesNotMatch(guard(fresh, profile, claim, 'About my book.'), /don't see any|hakuna booking|no visits/i, claim);
      }
      // The model is told masked, never empty; the read result says masked.
      assert.match(formatReturningFileForCallState(state.returning, {}), /MASKED until the name is confirmed, not empty/);
      const read = planVisitReadTurn({ nameConfirmed: false, callerText: 'About my booking.', language: 'en', fileState: state, now: NOW });
      assert.equal(read.masked, true);
      assert.equal(read.fileStatus, 'masked');
      assert.ok(TEMPLATES.confirm_identity_first);
    }));

  it('(8) "Yeah" after "About my booking": visit_open first on that turn, from the pending ask', () =>
    withFlag('on', () => {
      let t7;
      const { state } = replay(7, { onTurn: (t, r) => { if (t.turn === 7) t7 = r; } });
      void state;
      assert.equal(t7.state.caller.nameJustConfirmed, true);
      const read = planVisitReadTurn({
        nameConfirmed: true,
        nameJustConfirmed: true,
        callerText: 'Yeah.',
        language: 'en',
        fileState: t7.state,
        now: NOW,
      });
      // replay() already ran this turn's gate only; the read is still pending here.
      assert.equal(read.runModel, false);
      assert.equal(read.kind, 'confirm_read');
      assert.equal(read.lines[0].template, 'visit_open');
      // The two current Carpet visits, then the newest four open requests.
      assert.deepEqual(read.lines.map((l) => l.template), ['visit_open', 'visit_open', 'request_open', 'request_open', 'request_open', 'request_open', 'more_open']);
      assert.match(read.line, /^You have a Carpet Cleaning visit request, today, 9 AM, Kitengela\. You have a Carpet Cleaning \(per room\) visit request, tomorrow, 9 AM, Kitengela, Grace Apartments\./);
      assert.match(read.line, /Mansion Cleaning Custom Quote/);
      assert.match(read.line, /There are 25 older open items on file too\.$/);
      assert.ok(read.lines.some((l) => l.template === 'request_open'));
      assert.doesNotMatch(read.line, /shillings|KSh/);
      assert.equal(t7.state.conversation.fileAskPending, false);
    }));
});

describe('HD_1b3a67ea7ee9 replay, flag off keeps the live behaviour', () => {
  it('keeps the no-record claim, the repeated ask, and has no confirm read', () =>
    withFlag(null, () => {
      const gates = {};
      const { asks } = replay(7, { onTurn: (t, r) => { gates[t.turn] = r; } });
      assert.equal(gates[6].spoken, 'Am I speaking with Alvin?');
      assert.equal(asks.length, 2);
      const fresh = createBrainState(callProfile());
      fresh.conversation.answersReceived = ['About my book.'];
      fresh.caller.fileNameAsked = 'Alvin';
      assert.match(
        guard(fresh, callProfile(), 'There are no bookings saved under this number right now.', 'About my book.'),
        /no bookings/
      );
      const read = planVisitReadTurn({ nameConfirmed: true, nameJustConfirmed: true, callerText: 'Yeah.', language: 'en', fileState: gates[7].state, now: NOW });
      assert.equal(read.runModel, true);
    }));
});
