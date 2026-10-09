// HD_1677e57f73f9 (staging, 2026-10-09 13:04 EAT, build ccdab29b, sw, Chris):
// "leo saa 8:00" was never read as a clock, the create was rejected ("Visit
// has a day but no time.") and nothing was saved; the file-name confirm never
// ran (junk alternates made a "shared line"); closings read as goals; past
// rows read as open. BRAIN_CALL_FIXES_D199=on fixes items 1-6; off keeps the
// live behaviour.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const FIXTURE = require('./fixtures/voice-calls/HD_1677e57f73f9.call.json');
const TENANT = require('./fixtures/tenants/done-and-dusted-staging.json');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const { buildCallerMemoryCard } = require('../src/conversation/callerMemory');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { extractConversationEntities, callerGoalText } = require('../src/conversation/entityExtraction');
const { planCallerModelTurn, resolveLocalReply } = require('../src/conversation/turnPolicy');
const { guardSpokenReply } = require('../src/conversation/speechGuard');
const { guardToolPlan } = require('../src/conversation/requiredCreateRequest');
const { resolveAppointmentWhen } = require('../src/conversation/appointmentHours');
const { timeAskLine, clockPhrase } = require('../src/conversation/visitTime');
const { normalizeSwahiliClock } = require('../src/conversation/swahiliClockParse');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const { deriveCallSummary } = require('../src/conversation/callSummary');
const { formatToolConfirmation } = require('../src/conversation/toolExecution');
const fixes = require('../src/conversation/callFixesD199');
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

const turn = (n) => FIXTURE.turns.find((t) => t.turn === n);

function observe(state, profile, text, lastAgent, language = 'sw') {
  const entities = extractConversationEntities(text, {
    profile,
    intent: state.intent && state.intent !== 'unknown' ? state.intent : 'general_enquiry',
    state,
  });
  return observeCallerTurn(state, {
    text,
    entities,
    lastAgentText: lastAgent,
    detectedLanguage: language,
    resolvedLanguage: language,
    profile,
    now: NOW,
  });
}

/**
 * Replay answered caller turns 1..upto: observe, then the name gate. A code
 * ask is spoken; otherwise the trace's model line goes through the guard.
 */
function replay(upto, { onTurn } = {}) {
  const profile = callProfile();
  let state = createBrainState(profile);
  let lastAgent = 'Done and Dusted, this is Shy. You can speak in English or Kiswahili. Tukusaidie vipi.';
  const asks = [];
  for (const t of FIXTURE.turns.filter((x) => x.turn <= upto && !x.held)) {
    state = observe(state, profile, t.caller, lastAgent, t.language);
    const gate = planCallerModelTurn(state, { unfinishedDecided: true, holdTimedOut: t.holdTimedOut === true, profile });
    let spoken;
    if (!gate.runModel && gate.line) {
      state.caller.fileNameAskSpoken = true;
      asks.push({ turn: t.turn, by: 'code', line: gate.line });
      spoken = gate.line;
    } else {
      const say = t.modelSay ? t.modelSay.join(' ') : t.spoken || '';
      spoken = guardSpokenReply(say, {
        language: t.language,
        state,
        profile,
        callerTurns: state.conversation?.answersReceived || [],
        toolResults: [],
      });
    }
    if (onTurn) onTurn(t, { state, gate, spoken, profile });
    lastAgent = spoken || lastAgent;
  }
  return { state, asks, profile, lastAgent };
}

// t30's model plan: create_appointment when_text "today at 2:00 PM" for "leo saa 8:00".
const T30_PLAN = {
  appointment: {
    serviceName: 'Kitchen and Wardrobe Cleaning',
    name: 'Chris',
    whenText: 'today at 2:00 PM',
    landmark: 'Kijani, Riverside, Westlands',
    notes: 'confirm access',
  },
};

describe('HD_1677e57f73f9 replay, BRAIN_CALL_FIXES_D199=on', () => {
  it('(1a) the Swahili clock: saa N + 6, a period maps to 24h, no period is ambiguous', () =>
    withFlag('on', () => {
      const at = (text) => {
        const r = resolveAppointmentWhen(text, NOW);
        return r.ok ? r.minutesSinceMidnight : null;
      };
      assert.equal(at('leo saa nane mchana'), 14 * 60);
      assert.equal(at('leo saa 8:00 mchana'), 14 * 60);
      assert.equal(at('kesho saa tatu asubuhi'), 9 * 60);
      assert.equal(at('kesho asubuhi saa tatu'), 9 * 60);
      assert.equal(at('leo saa mbili usiku'), 20 * 60);
      assert.equal(at('leo saa kumi na moja jioni'), 17 * 60);
      assert.equal(at('kesho saa nne na nusu asubuhi'), 10 * 60 + 30);
      // No period: never 08:00, never a guessed 2 PM.
      for (const said of ['leo saa 8:00', 'leo saa 8', 'leo saa nane']) {
        const r = resolveAppointmentWhen(said, NOW);
        assert.equal(r.ok, false, said);
        assert.deepEqual(r.swahiliAmbiguous, { hour: 8, westernHour: 2, minute: 0 }, said);
      }
      assert.equal(clockPhrase('leo saa nane mchana'), '2pm');
      assert.equal(clockPhrase('leo saa 8:00'), '');
      assert.equal(normalizeSwahiliClock('saa hizi').changed, false);
      assert.equal(normalizeSwahiliClock('saa 2 pm').changed, false);
      // The ambiguity ask in Swahili clock wording.
      assert.equal(timeAskLine({ when: 'leo', pendingHour: 2, language: 'sw' }), 'Saa nane usiku au saa nane mchana?');
    }));

  it('(1a) t30: "leo saa 8:00" never becomes the model\'s 2:00 PM; a period said is kept', () =>
    withFlag('on', () => {
      const { state } = replay(29);
      const plan = guardToolPlan(JSON.parse(JSON.stringify(T30_PLAN)), state, {});
      assert.equal(plan.appointment, undefined);
      assert.equal(plan.needsVisitTime, 'today');
      assert.equal(plan.rejectedAppointment.serviceName, 'Kitchen and Wardrobe Cleaning');
      assert.equal(plan.rejectedAppointment.whenText, 'today');
      // Had the caller said "saa nane mchana", the 2 PM is theirs.
      const said = JSON.parse(JSON.stringify(state));
      said.conversation.answersReceived = [...said.conversation.answersReceived, 'Leo saa nane mchana.'];
      const kept = guardToolPlan(JSON.parse(JSON.stringify(T30_PLAN)), said, {});
      assert.equal(kept.appointment.whenText, 'today at 2:00 PM');
      assert.equal(kept.needsVisitTime, undefined);
    }));

  it('(1b) the rejected create is re-asked (AM/PM in Swahili), then saved as a callback', () =>
    withFlag('on', () => {
      const run = replay(29);
      const { profile } = run;
      let { state } = run;
      // t30: guard rejects; the turn's reply carries reask_slot.
      const required = JSON.parse(JSON.stringify(T30_PLAN));
      const plan = guardToolPlan(JSON.parse(JSON.stringify(required)), state, {});
      const results = [
        { action: 'save_caller_info', status: 'deferred' },
        { action: 'create_appointment', status: 'invalid', code: 'unparsed_when', reason: 'Visit has a day but no time.', missingSlots: ['when_text'], hours: { whenText: plan.needsVisitTime } },
      ];
      fixes.noteRejectedCreate(state, { slot: 'when', whenText: plan.needsVisitTime, appointment: required.appointment, now: NOW });
      const reask = fixes.reaskSlotLine(state, 'sw');
      assert.equal(reask.line, 'Saa nane usiku au saa nane mchana?');
      assert.equal(reask.lines[0].template, 'reask_slot');
      results[1].reaskLine = reask.line;
      assert.equal(formatToolConfirmation(results, 'sw'), 'Saa nane usiku au saa nane mchana?');
      // Hard check: the live turn spoke "Sawa kabisa." only. That breaks it.
      assert.equal(fixes.rejectedCreateUnhandled(state, { spoken: 'Sawa kabisa.', results }), true);
      assert.equal(fixes.rejectedCreateUnhandled(state, { spoken: `Sawa kabisa. ${reask.line}`, results }), false);
      // The caller barged; t31 "Riverside, Westlands.": the re-ask never
      // reached them, so code speaks it before the model.
      state = observe(state, profile, turn(31).caller, 'Sawa kabisa.');
      const t31 = fixes.planRejectedCreate(state, { language: 'sw' });
      assert.equal(t31.kind, 'reask');
      assert.equal(t31.line, 'Saa nane usiku au saa nane mchana?');
      fixes.markReaskSpoken(state);
      assert.equal(state.conversation.pendingHour, 2);
      // t32 "Sawa, ni hayo tu. Baadaye basi.": a closing with the slot open
      // saves a callback; the call is never lost.
      const closing = observe(JSON.parse(JSON.stringify(state)), profile, turn(32).caller, t31.line);
      assert.equal(closing.conversation.rejectedCreate.reasks, 1);
      const t32 = fixes.planRejectedCreate(closing, { language: 'sw' });
      assert.equal(t32.kind, 'callback');
      const saved = guardToolPlan(JSON.parse(JSON.stringify(t32.parsed)), closing, {});
      assert.equal(saved.serviceRequest.type, 'callback');
      assert.equal(saved.serviceRequest.item, 'Kitchen and Wardrobe Cleaning');
      assert.equal(saved.serviceRequest.whenText, 'today');
      assert.match(saved.serviceRequest.notes, /^Visit time to confirm\. Place: Kijani, Riverside, Westlands\./);
      assert.equal(saved.consentBlocked, undefined);
      fixes.settleRejectedCreate(closing, [{ action: 'create_service_request', status: 'succeeded' }]);
      assert.equal(closing.conversation.rejectedCreate, null);
      // Or the caller answers the AM/PM ask: the visit is saved at 2 PM today.
      const answered = observe(JSON.parse(JSON.stringify(state)), profile, 'Mchana.', t31.line);
      const retry = fixes.planRejectedCreate(answered, { language: 'sw' });
      assert.equal(retry.kind, 'retry');
      const kept = guardToolPlan(JSON.parse(JSON.stringify(retry.parsed)), answered, {});
      assert.equal(kept.appointment.whenText, 'today 2 pm');
      assert.equal(resolveAppointmentWhen(kept.appointment.whenText, NOW).minutesSinceMidnight, 14 * 60);
      // An unanswered re-ask (no closing) also ends in a callback, not a loop.
      const silent = observe(JSON.parse(JSON.stringify(state)), profile, 'Riverside.', t31.line);
      assert.equal(fixes.planRejectedCreate(silent, { language: 'sw' }).kind, 'callback');
    }));

  it('(2, 4) closings are closings, never questions or a goal', () =>
    withFlag('on', () => {
      for (const said of ['Okay, thank you.', 'asante', 'Asante sana.', "That's all.", 'hiyo tu', 'Sawa, ni hayo tu. Baadaye basi.', 'Baadaye.']) {
        assert.equal(fixes.isClosingCue(said), true, said);
        assert.equal(callerGoalText(said), '', said);
      }
      for (const said of ['Okay.', 'Sawa.', 'Okay, thank you. What time?', 'Asante, how much is carpet cleaning?']) {
        assert.equal(fixes.isClosingCue(said), false, said);
      }
      assert.equal(callerGoalText('Natafakari.'), '');
      const { state } = replay(33);
      assert.equal(state.goal.description, 'Na unionyeshe direction ya carpet');
      const t32 = replay(32).state;
      assert.equal(determineNextBestAction({ state: t32 }).action, 'END');
      // callSummary: "Alvin asked about that's all." can never be written.
      const fresh = createBrainState({});
      fresh.caller.name = 'Alvin';
      fresh.goal.description = "That's all.";
      const summary = deriveCallSummary({ brainState: fresh, toolResults: [] });
      assert.doesNotMatch(JSON.stringify(summary), /that's all/i);
    }));

  it('(3) past-dated rows still requested are a count, never open or upcoming', () =>
    withFlag('on', () => {
      const card = callProfile().callerMemory;
      assert.deepEqual(card.openVisits, []);
      assert.equal(card.nextVisitWhen, null);
      assert.equal(card.pastOpenCount, 5);
      const read = fixes.openFileRead({ returning: { openRows: card.openRows } }, 'en', { now: NOW });
      assert.deepEqual(read.lines.map((l) => l.template), ['request_open', 'request_open', 'past_open']);
      assert.equal(
        read.line,
        'You have an enquiry for Carpet cleaning. You have an enquiry for General cleaning issue. There are 5 past-dated requests the team still has to confirm.'
      );
      // Today's 9 AM at 1 PM is past.
      const today = buildCallerMemoryCard({
        contact: { name: 'Chris' },
        openAppointments: [{ id: 'a', service_name: 'Carpet cleaning', status: 'requested', when_text: 'Friday 9 October 2026, 9 AM', window_start: '2026-10-09T06:00:00Z', created_at: '2026-10-08T10:00:00Z' }],
        now: new Date('2026-10-09T10:00:00Z'),
      });
      assert.deepEqual(today.openVisits, []);
      assert.equal(today.pastOpenCount, 1);
      assert.equal(today.openRows[0].past, true);
    }));

  it('(5) junk alternates do not make a shared line; the code-held file-name ask fires', () =>
    withFlag('on', () => {
      const card = callProfile().callerMemory;
      assert.equal(card.sharedLine, false);
      const { asks, state } = replay(33);
      assert.deepEqual(asks.map((a) => a.turn), [1]);
      assert.equal(asks[0].line, 'Am I speaking with Chris?');
      assert.equal(state.caller.fileNameAskSpoken, true);
      // Brain's guard never drops a first confirm of the on-file name.
      const fresh = createBrainState(callProfile());
      const kept = guardSpokenReply('Je, ninaongea na Chris?', { language: 'sw', state: fresh, profile: callProfile(), callerTurns: ['Si ndiyo?'], toolResults: [] });
      assert.equal(kept, 'Je, ninaongea na Chris?');
      // A real second person still makes a shared line.
      const shared = buildCallerMemoryCard({ contact: { name: 'Chris', metadata: { alternate_names: [{ name: 'Wanjiru' }] } }, now: NOW });
      assert.equal(shared.sharedLine, true);
    }));

  it('(6) "Do you cover the shops?" asks which area; no coverage claim', () =>
    withFlag('on', () => {
      const profile = callProfile();
      const state = createBrainState(profile);
      const en = resolveLocalReply({ text: 'Do you cover the shops?', state, profile, language: 'en' });
      assert.equal(en.outcome, 'ask_area');
      assert.equal(en.line, 'Which area are you in?');
      assert.equal(en.lines[0].template, 'ask_area');
      const sw = resolveLocalReply({ text: 'Mnafika maduka?', state, profile, language: 'sw' });
      assert.equal(sw.line, 'Uko eneo gani?');
      // A real place keeps the coverage answer; a service is not coverage.
      assert.notEqual(resolveLocalReply({ text: 'Do you cover Kilimani?', state, profile, language: 'en' })?.outcome, 'ask_area');
      assert.equal(fixes.coverageAskWithoutPlace('Do you cover carpets?', profile), null);
      assert.ok(TEMPLATES.ask_area && TEMPLATES.reask_slot && TEMPLATES.past_open && TEMPLATES.past_row);
    }));
});

describe('HD_1677e57f73f9 replay, flag off keeps the live behaviour', () => {
  it('rejects saa 8:00 silently, shared line, no ask, closings as goals', () =>
    withFlag(null, () => {
      const card = callProfile().callerMemory;
      assert.equal(card.sharedLine, true);
      const { asks, state } = replay(29);
      assert.deepEqual(asks, []);
      const plan = guardToolPlan(JSON.parse(JSON.stringify(T30_PLAN)), state, {});
      assert.equal(plan.needsVisitTime, 'today');
      assert.equal(fixes.planRejectedCreate(state, { language: 'sw' }), null);
      assert.equal(resolveAppointmentWhen('leo saa 8:00', NOW).minutesSinceMidnight, 8 * 60);
      assert.equal(callerGoalText("That's all."), "That's all");
      assert.equal(resolveLocalReply({ text: 'Do you cover the shops?', state: createBrainState(callProfile()), profile: callProfile(), language: 'en' })?.outcome, 'coverage');
    }));
});
