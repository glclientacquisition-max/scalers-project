// HD_d199dbbf6b79 (staging re-dial, 2026-10-09 11:41 EAT): five Brain bugs,
// replayed from the call's traces and the caller file rows at call start.
// BRAIN_CALL_FIXES_D199=on fixes them; off keeps the old behaviour (pinned here).

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const FIXTURE = require('./fixtures/voice-calls/HD_d199dbbf6b79.call.json');
const TENANT = require('./fixtures/tenants/done-and-dusted-staging.json');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const { buildCallerMemoryCard } = require('../src/conversation/callerMemory');
const { createBrainState, observeCallerTurn, recordActionResults } = require('../src/conversation/brainState');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');
const { coverageAskPlace, coverageAskSpeech } = require('../src/conversation/visitLocation');
const { resolveLocalReply } = require('../src/conversation/turnPolicy');
const { planVisitReadTurn } = require('../src/conversation/openLineSpeech');
const { guardToolPlan } = require('../src/conversation/requiredCreateRequest');
const { executeBrainTools, formatToolConfirmation } = require('../src/conversation/toolExecution');
const { nairobiDateTime, quantityWithUnit } = require('../src/conversation/callFixesD199');

const { setVoiceRendererForTest } = require('../src/conversation/factLine');

// These tests pin Brain's fallback wording (factLine.js). Voice's renderer
// (src/speech/spokenFacts, #633) wins when it is present, so it is switched
// off here; the line objects are asserted as well.
before(() => setVoiceRendererForTest(null));
after(() => setVoiceRendererForTest(undefined));

const NOW = new Date(FIXTURE.startedAt);
const TODAY_VISIT = '47362e7b-a0df-44c2-9e3e-6740192a94f1';
const MANSION = '2b684460-2ae5-4ae3-8a83-787f594415e0';

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

async function withFlagAsync(value, fn) {
  const prev = process.env.BRAIN_CALL_FIXES_D199;
  if (value == null) delete process.env.BRAIN_CALL_FIXES_D199;
  else process.env.BRAIN_CALL_FIXES_D199 = value;
  try {
    return await fn();
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

/** Replay caller turns 1..upto through Brain, as the live call did. */
function replay(upto) {
  const profile = callProfile();
  let state = createBrainState(profile);
  let lastAgent = '';
  for (const turn of FIXTURE.turns.filter((t) => t.turn <= upto)) {
    if (turn.turn === 1) {
      state.caller.fileNameAsked = 'Alvin';
      state.caller.fileNameAskSpoken = true;
    }
    // The server extracts entities and passes the agent's last line.
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
    lastAgent = turn.spoken || lastAgent;
  }
  return { state, profile };
}

function fileRead(state, turn) {
  const t = FIXTURE.turns.find((row) => row.turn === turn);
  return planVisitReadTurn({
    nameConfirmed: state.caller.nameConfirmed === true,
    nameJustConfirmed: state.caller.nameJustConfirmed === true,
    callerText: t ? t.caller : turn,
    language: t ? t.language : 'en',
    openVisits: state.returning?.openVisits,
    openRequests: state.returning?.openRequests,
    fileState: state,
    now: NOW,
  });
}

function turnText(n) {
  return FIXTURE.turns.find((row) => row.turn === n).caller;
}

// t12 tool plan as Gemini sent it.
const T12_PLAN = {
  appointment: {
    serviceName: 'Carpet Cleaning (per room)',
    name: 'like',
    whenText: 'tomorrow 9 AM',
    landmark: 'Kitengela, Grace Apartments',
  },
};

describe('HD_d199dbbf6b79 replay, BRAIN_CALL_FIXES_D199=on', () => {
  it('(e) the opening read carries today 9 AM Kitengela, first', () =>
    withFlag('on', () => {
      const card = callProfile().callerMemory;
      assert.equal(card.openVisits[0], 'Carpet Cleaning | today, 9 AM | requested | Kitengela');
      assert.equal(card.nextVisitWhen, 'today, 9 AM');
      const { state } = replay(2);
      assert.equal(state.caller.nameConfirmed, true);
      assert.match(state.returning.openVisits[0], /today, 9 AM/);
    }));

  it('(e) t3 "when did I request that?" is answered from created_at in Nairobi time', () =>
    withFlag('on', () => {
      assert.equal(nairobiDateTime('2026-10-08T13:47:30.22025+00:00', 'en', NOW), 'yesterday at 4:47 PM');
      assert.equal(nairobiDateTime('2026-10-06T13:47:30Z', 'en', NOW), 'Tuesday 6 October at 4:47 PM');
      const { state } = replay(3);
      const read = fileRead(state, 3);
      assert.equal(read.runModel, false);
      assert.equal(read.line, 'You asked for the Carpet Cleaning visit yesterday at 4:47 PM.');
      assert.equal(read.lines[0].template, 'requested_at');
      assert.deepEqual(read.lines[0].slots.requested_at, { iso: '2026-10-08T13:47:30.22025+00:00', precision: 'relative' });
      assert.equal(read.lines[0].gate.appointment_id, TODAY_VISIT);
      assert.equal(state.conversation.lastFileRowId, TODAY_VISIT);
    }));

  it('(c) t4 "the mansion one" runs no coverage check', () =>
    withFlag('on', () => {
      assert.equal(coverageAskPlace(turnText(4)), '');
      const { state, profile } = replay(4);
      // The file and hold lookup owns this turn: no local reply (coverage,
      // place block, fact) runs ahead of it, and the file read answers.
      assert.equal(resolveLocalReply({ text: turnText(4), state, profile, language: 'en' }), null);
      assert.equal(fileRead(state, 4).line, 'You have an enquiry for Mansion Cleaning Custom Quote.');
      // A file row named by a real place is still the file's, not coverage.
      const kit = 'What about ile ya Kitengela?';
      assert.equal(coverageAskPlace(kit), 'ile ya Kitengela');
      assert.match(coverageAskSpeech(kit, profile, 'en'), /\S/);
      assert.equal(resolveLocalReply({ text: kit, state, profile, language: 'en' }), null);
      assert.match(fileRead(state, kit).line, /Carpet Cleaning visit request, today, 9 AM, Kitengela/);
      assert.equal(coverageAskSpeech(turnText(4), profile, 'en'), '');
      assert.equal(state.entities.location, undefined);
      // A real place still gets the check.
      assert.equal(coverageAskPlace('What about Kitengela?'), 'Kitengela');
    }));

  it('(b) t4/t5 the file read finds the open Mansion Cleaning Custom Quote request', () =>
    withFlag('on', () => {
      for (const turn of [4, 5]) {
        const { state } = replay(turn);
        const read = fileRead(state, turn);
        assert.equal(read.runModel, false, `t${turn}`);
        assert.equal(read.line, 'You have an enquiry for Mansion Cleaning Custom Quote.', `t${turn}`);
        assert.equal(state.conversation.lastFileRowId, MANSION);
      }
      const { state } = replay(3);
      const all = fileRead(state, 'What do I have on file?');
      assert.equal(all.runModel, false);
      assert.match(all.line, /^You have a Carpet Cleaning visit request, today, 9 AM, Kitengela\./);
      assert.deepEqual(
        [...new Set(all.lines.map((l) => l.template))],
        ['visit_open', 'request_open', 'more_open']
      );
      assert.match(all.line, /Mansion Cleaning Custom Quote/);
      // t8 "ile carpet cleaning ... ya Kitengela" reads that one visit.
      assert.equal(fileRead(replay(8).state, 8).line, 'Una ziara ya Carpet Cleaning, leo, 9 AM, Kitengela.');
    }));

  it('(d) slots: no time as location, no clock or pronoun as quantity, no filler as name', () =>
    withFlag('on', () => {
      const profile = callProfile();
      const askingArea = { intent: 'booking', goal: { missingSlots: ['area'] }, conversation: {} };
      const t12 = extractConversationEntities('Ah, 9 works best.', { profile, intent: 'booking', state: askingArea });
      assert.equal(t12.location, undefined);
      assert.equal(t12.quantity, undefined);
      const t5 = extractConversationEntities(turnText(5), { profile, intent: 'booking', state: askingArea });
      assert.equal(t5.quantity, undefined);
      assert.equal(t5.name, undefined);
      assert.equal(quantityWithUnit('carpet cleaning for 3 rooms'), '3');
      assert.equal(quantityWithUnit('I want 2 diaries'), '2');
      const { state } = replay(12);
      assert.equal(state.caller.name, 'Alvin');
      assert.equal(state.entities.name.value, 'Alvin');
      assert.match(String(state.entities.location?.value || ''), /Kitengela/i);
      assert.doesNotMatch(String(state.entities.location?.value || ''), /works best|\b9\b|mansion/i);
      assert.equal(state.entities.quantity, undefined);
      assert.doesNotMatch(String(state.entities.service?.value || ''), /\blike\b/i);
      // t16 "So that I can confirm?" is not a place either.
      const t16 = replay(16).state;
      assert.equal(t16.entities.location.value, 'Kitengela');
    }));

  it('(a) t12 reschedule moves 47362e7b; no second live visit', async () =>
    withFlagAsync('on', async () => {
      const { state, profile } = replay(12);
      assert.equal(state.conversation.rescheduleAsked, true);
      const plan = guardToolPlan(JSON.parse(JSON.stringify(T12_PLAN)), state, { createAppointment: true, updateAppointment: true });
      assert.equal(plan.appointment, undefined);
      assert.equal(plan.appointmentUpdate.appointmentId, TODAY_VISIT);
      assert.equal(plan.appointmentUpdate.whenText, 'tomorrow 9 AM');
      const calls = [];
      const exec = await executeBrainTools({
        parsed: plan,
        capabilities: { createAppointment: true, updateAppointment: true },
        heldCallerName: state.caller.name,
        hoursSchedule: profile.hoursSchedule || null,
        now: NOW,
        handlers: {
          createAppointment: async (row) => {
            calls.push(['create', row]);
            return { id: 'b140110d-9d62-422e-ae78-2b85cab837c6', status: 'requested' };
          },
          updateAppointment: async (row) => {
            calls.push(['update', row]);
            return { id: row.appointmentId, status: 'requested', service_name: 'Carpet Cleaning', when_text: row.whenText, address_landmark: row.landmark };
          },
        },
      });
      assert.deepEqual(calls.map((c) => c[0]), ['update']);
      assert.equal(calls[0][1].appointmentId, TODAY_VISIT);
      const results = exec.results || exec;
      const line = formatToolConfirmation(results, 'sw');
      assert.match(line, /^Sawa, nimehamisha ziara /);
      const { brainLinesForResults } = require('../src/conversation/toolExecution');
      const moved = brainLinesForResults(results, 'en').lines;
      assert.equal(moved[0].template, 'move_ok');
      assert.equal(moved[0].gate.appointment_id, TODAY_VISIT);
      // (e) t15 "what exactly you've saved?" reads back the saved row.
      const after = recordActionResults(state, results);
      const read = fileRead(after, 15);
      assert.equal(read.runModel, false);
      assert.match(read.line, /^I have saved a Carpet Cleaning visit request for tomorrow, 9 AM, Kitengela, Grace Apartments\. The team will confirm it\.$/);
      assert.deepEqual(read.lines.map((l) => l.template), ['saved_item', 'team_will_confirm']);
    }));

  it('(3) t9 save_caller_info "like" does not save the name; Alvin stays', async () =>
    withFlagAsync('on', async () => {
      const { state, profile } = replay(9);
      assert.equal(state.caller.name, 'Alvin');
      const t9 = FIXTURE.turns.find((t) => t.turn === 9).tools[0];
      assert.equal(t9.args.name, 'like');
      const saves = [];
      const exec = await executeBrainTools({
        parsed: { name: t9.args.name, reason: t9.args.reason },
        capabilities: {},
        heldCallerName: state.caller.name,
        nameConfirmed: true,
        now: NOW,
        handlers: { saveCallerInfo: async (row) => (saves.push(row), { ...row }) },
      });
      assert.equal(saves.length, 1);
      assert.notEqual(saves[0].name, 'like');
      assert.equal(saves[0].reason, 'Carpet cleaning booking for mansion');
      const after = recordActionResults(state, exec.results || exec);
      assert.equal(after.caller.name, 'Alvin');
      assert.equal(after.entities.name.value, 'Alvin');
      void profile;
    }));

  it('(4) a bare hour is asked back in Swahili clock time', () =>
    withFlag('on', () => {
      const { timeAskLine } = require('../src/conversation/visitTime');
      let clock = null;
      try {
        clock = require('../src/conversation/swahiliClock');
      } catch {
        clock = null;
      }
      const line = timeAskLine({ when: 'kesho', pendingHour: 9, language: 'sw' });
      if (clock) {
        assert.equal(line, 'Saa tatu asubuhi au saa tatu usiku?');
        assert.equal(timeAskLine({ when: 'kesho', pendingHour: 2, language: 'sw' }), 'Saa nane usiku au saa nane mchana?');
      } else {
        // swahiliClock.js (#633) not on this branch yet: the old line stays.
        assert.equal(line, 'Saa 9 asubuhi au mchana?');
      }
      assert.equal(timeAskLine({ when: 'tomorrow', pendingHour: 9, language: 'en' }), '9 in the morning or in the afternoon?');
      withFlag(null, () =>
        assert.equal(timeAskLine({ when: 'kesho', pendingHour: 9, language: 'sw' }), 'Saa 9 asubuhi au mchana?')
      );
    }));

  it('a new job is never turned into a move', () =>
    withFlag('on', () => {
      const { state } = replay(12);
      const fresh = observeCallerTurn(state, {
        text: 'I also want another visit for couch cleaning',
        resolvedLanguage: 'en',
        profile: callProfile(),
        now: NOW,
      });
      assert.equal(fresh.conversation.rescheduleAsked, false);
      const plan = guardToolPlan({ appointment: { serviceName: 'Couch cleaning', whenText: 'Monday 10 AM', landmark: 'Kitengela' } }, fresh, {});
      assert.equal(plan.appointmentUpdate, undefined);
      assert.equal(plan.rescheduledFrom, undefined);
    }));
});

describe('HD_d199dbbf6b79 replay, flag off keeps the live behaviour', () => {
  it('reproduces all five bugs', () =>
    withFlag(null, () => {
      const card = callProfile().callerMemory;
      assert.match(card.openVisits[0], /^Carpet Cleaning \| past 9 Oct/);
      assert.equal(card.openRows, undefined);
      assert.equal(coverageAskPlace(turnText(4)), 'mansion one');
      const off4 = replay(4);
      assert.equal(resolveLocalReply({ text: turnText(4), state: off4.state, profile: off4.profile, language: 'en' })?.outcome, 'coverage');
      const { state } = replay(12);
      assert.equal(state.caller.name, 'like');
      assert.equal(fileRead(state, 3).runModel, true);
      const plan = guardToolPlan(JSON.parse(JSON.stringify(T12_PLAN)), state, {});
      assert.ok(plan.appointment);
      const t12 = extractConversationEntities('Ah, 9 works best.', {
        profile: callProfile(),
        intent: 'booking',
        state: { intent: 'booking', goal: { missingSlots: ['area'] }, conversation: {} },
      });
      assert.equal(t12.quantity.value, '9');
      assert.equal(t12.location.value, 'Ah, 9 works best');
    }));
});

describe('fact lines (docs/specs/fact-lines.md)', () => {
  const { factLine, renderLine } = require('../src/conversation/factLine');
  const { createVoiceTrace } = require('../src/speech/voiceTrace');

  it('drops an unknown template or a missing required slot', () => {
    assert.equal(factLine('nope', {}), null);
    assert.equal(factLine('move_ok', { job: 'Carpet Cleaning' }), null);
    assert.ok(factLine('move_ok', { job: 'Carpet Cleaning', to_when: { iso: '2026-10-10T06:00:00Z', precision: 'time' } }));
  });

  it("uses Voice's renderer when present, and falls back on null", () => {
    const line = factLine('saved_none', {}, { lang: 'en' });
    try {
      setVoiceRendererForTest({ renderFactLine: (l) => (l.template === 'saved_none' ? 'VOICE' : null), renderFact: () => null });
      assert.equal(renderLine(line), 'VOICE');
      assert.equal(renderLine(factLine('team_will_confirm', {}, { lang: 'en' })), 'The team will confirm it.');
      setVoiceRendererForTest(null);
      assert.equal(renderLine(line), 'I have not saved anything new on this call yet.');
    } finally {
      setVoiceRendererForTest(null);
    }
  });

  it('an update with no new time is visit_updated, never move_ok', () =>
    withFlag('on', () => {
      const { brainLinesForResults } = require('../src/conversation/toolExecution');
      const lines = brainLinesForResults(
        [{ action: 'update_appointment', status: 'succeeded', id: 'b140110d', value: { landmark: 'Grace Apartments' } }],
        'sw'
      ).lines;
      assert.deepEqual(lines.map((l) => l.template), ['visit_updated']);
      assert.doesNotMatch(lines[0].text, /hamisha/);
    }));

  it('records brain.lines[] on the turn trace', () => {
    const written = [];
    const trace = createVoiceTrace({ enabled: true, sink: { write: (r) => written.push(r) }, callId: () => 'HD_test', tenantId: () => 't' });
    trace.beginTurn({ callerText: 'when did I request that?' });
    trace.noteBrainLines([{ template: 'requested_at', lang: 'en', slots: { kind: 'visit' }, gate: { appointment_id: TODAY_VISIT }, text: 'You asked ...' }]);
    trace.commitTurn({});
    assert.equal(written[0].brain.lines[0].template, 'requested_at');
    assert.equal(written[0].brain.lines[0].gate.appointment_id, TODAY_VISIT);
  });
});

describe("fact lines with Voice's renderer (#633), when it is on the branch", () => {
  let voice = null;
  try {
    voice = require('../src/speech/spokenFacts');
  } catch {
    voice = null;
  }
  it('every Brain line from the replay renders, and saved_item never says moved', { skip: !voice && 'src/speech/spokenFacts not on this branch' }, async () => {
    const prevVoice = process.env.VOICE_SPOKEN_FACTS;
    process.env.VOICE_SPOKEN_FACTS = 'on';
    setVoiceRendererForTest(undefined);
    try {
      await withFlagAsync('on', async () => {
        const { factLine, renderLine } = require('../src/conversation/factLine');
        const saved = factLine('saved_item', { kind: 'visit', job: 'Carpet Cleaning', when: { iso: '2026-10-10T06:00:00Z', precision: 'time' }, place: 'Kitengela' }, { lang: 'en' });
        assert.equal(saved.slots.moved, undefined);
        assert.doesNotMatch(renderLine(saved, { now: NOW }), /moved|hamisha/i);
        const move = factLine('move_ok', { job: 'Carpet Cleaning', to_when: { iso: '2026-10-10T06:00:00Z', precision: 'time' } }, { lang: 'sw' });
        assert.match(renderLine(move, { now: NOW }), /hamisha/);
        const { state } = replay(3);
        const read = fileRead(state, 3);
        assert.equal(read.lines[0].template, 'requested_at');
        assert.ok(read.line.length > 0);
      });
    } finally {
      if (prevVoice == null) delete process.env.VOICE_SPOKEN_FACTS;
      else process.env.VOICE_SPOKEN_FACTS = prevVoice;
      setVoiceRendererForTest(null);
    }
  });
});
