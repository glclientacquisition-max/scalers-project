'use strict';

// Replay of staging call 5bbb0871-b674-4e24-a484-a80a3504e2c3 (HD_b82fbfef7649,
// Done and Dusted, 2026-10-09 20:12 EAT) behind BRAIN_CALL_FIXES_D199.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const FIXTURE = require('./fixtures/voice-calls/HD_b82fbfef7649.call.json');
const TENANT = require('./fixtures/tenants/done-and-dusted-staging.json');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const { buildCallerMemoryCard } = require('../src/conversation/callerMemory');
const {
  createBrainState,
  observeCallerTurn,
  recordActionResults,
  setNextBestAction,
  formatBrainStateForPrompt,
} = require('../src/conversation/brainState');
const { extractConversationEntities, findCatalogMatch } = require('../src/conversation/entityExtraction');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const { guardToolPlan } = require('../src/conversation/requiredCreateRequest');
const { executeBrainTools } = require('../src/conversation/toolExecution');
const { deriveCallResolution } = require('../src/conversation/callResolution');
const { formatHomeServicesPlaybookForPrompt } = require('../src/conversation/playbooks/homeServices');
const { appointmentEvent, renderEventText } = require('../src/notifications/events');
const fixes = require('../src/conversation/callFixesD199');
const { setVoiceRendererForTest } = require('../src/conversation/factLine');

before(() => setVoiceRendererForTest(null));
after(() => setVoiceRendererForTest(undefined));

const NOW = new Date(FIXTURE.startedAt);
const VISIT = 'b140110d-9d62-422e-ae78-2b85cab837c6';
const THIS_CALL = FIXTURE.callId;
const CAPS = { createAppointment: true, updateAppointment: true, createServiceRequest: true };

async function withFlag(value, fn) {
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

/** Replay caller turns 1..upto through Brain, with the server's next-best-action step. */
function replay(upto) {
  const profile = callProfile();
  let state = createBrainState(profile);
  let lastAgent = '';
  const trace = [];
  for (const turn of FIXTURE.turns.filter((t) => t.turn <= upto)) {
    if (turn.turn === 1) {
      state.caller.fileNameAsked = 'Alvin';
      state.caller.fileNameAskSpoken = true;
    }
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
      now: new Date(NOW.getTime() + turn.turn * 10000),
    });
    const decision = determineNextBestAction({ state, capabilities: CAPS });
    state = setNextBestAction(state, decision);
    trace.push({ turn: turn.turn, decision, visitPlace: state.visitPlace, entities: state.entities });
    lastAgent = turn.spoken || lastAgent;
  }
  return { state, profile, trace };
}

const value = (e) => (e && typeof e === 'object' ? e.value : e) || '';

async function moveAtT12(state, profile) {
  const t12 = FIXTURE.turns.find((t) => t.turn === 12);
  const plan = guardToolPlan(
    { appointmentUpdate: { status: 'requested', whenText: t12.tools[0].args.when_text } },
    state,
    CAPS
  );
  const writes = [];
  const exec = await executeBrainTools({
    parsed: plan,
    capabilities: CAPS,
    heldCallerName: state.caller.name,
    hoursSchedule: profile.hoursSchedule || null,
    openAppointments: FIXTURE.callerFile.openAppointments,
    now: new Date(NOW.getTime() + 120000),
    handlers: {
      updateAppointment: async (row) => {
        writes.push(row);
        return { ...FIXTURE.live.updatedRow };
      },
      createAppointment: async (row) => {
        writes.push({ create: row });
        return { id: 'should-not-create', status: 'requested' };
      },
    },
  });
  return { plan, writes, results: exec.results || exec };
}

describe('HD_b82fbfef7649 replay, BRAIN_CALL_FIXES_D199=off pins the live call', () => {
  it('junk when/location, the coverage gate on the move, and Haya as goal are the live bugs', () =>
    withFlag('off', () => {
      const { trace } = replay(14);
      const at = (n) => trace.find((row) => row.turn === n);
      assert.equal(value(at(7).entities.when), "Oh, so it's done per room");
      assert.equal(value(at(8).entities.location), 'line');
      for (const n of [9, 10, 11]) {
        assert.equal(at(n).visitPlace?.blocked, 'unknown_coverage');
        assert.match(at(n).decision.reason, /^Coverage is not on file/);
      }
      const { state } = replay(14);
      assert.equal(state.goal.description, 'Haya');
    }));

  it('the update alert reads the row name like; the note is Answered.', async () =>
    withFlag('off', async () => {
      const text = renderEventText(appointmentEvent(FIXTURE.live.updatedRow, FIXTURE.businessName, 'updated'));
      assert.match(text, /Caller: like/);
      const { state, profile } = replay(12);
      const { results } = await moveAtT12(state, profile);
      const after = recordActionResults(state, results);
      const res = deriveCallResolution({ brainState: after, callId: THIS_CALL, turnCount: 17 });
      assert.equal(res.resolutionNote, 'Answered.');
    }));
});

describe('HD_b82fbfef7649 replay, BRAIN_CALL_FIXES_D199=on', () => {
  it('(1) when must be a date/time and location a place: the junk is dropped', () =>
    withFlag('on', () => {
      const { trace } = replay(14);
      const at = (n) => trace.find((row) => row.turn === n);
      assert.equal(value(at(7).entities.when), '');
      assert.equal(value(at(8).entities.location), '');
      assert.equal(value(at(11).entities.when), '1:00 PM');
      for (const n of [10, 13, 14]) assert.equal(value(at(n).entities.location), '');
      assert.equal(fixes.isWhenSlotValue("Oh, so it's done per room"), false);
      assert.equal(fixes.isWhenSlotValue('Saturday 1 PM'), true);
      assert.equal(fixes.isWhenSlotValue('kesho asubuhi'), true);
      assert.equal(fixes.isPlaceSlotValue('line'), false);
      assert.equal(fixes.isPlaceSlotValue('Haya'), false);
      assert.equal(fixes.isPlaceSlotValue("Let's do at"), false);
      assert.equal(fixes.isPlaceSlotValue('Kitengela'), true);
      assert.equal(fixes.isPlaceSlotValue('Grace Apartments'), true);
    }));

  it('(1) the alert and notify name is the code-held Alvin, never like', () =>
    withFlag('on', () => {
      const { state } = replay(12);
      const name = fixes.alertCallerName({ state, rowName: 'like' });
      assert.equal(name, 'Alvin');
      const text = renderEventText(
        appointmentEvent({ ...FIXTURE.live.updatedRow, caller_name: name }, FIXTURE.businessName, 'updated')
      );
      assert.match(text, /Caller: Alvin/);
      assert.doesNotMatch(text, /Caller: like/);
      // No confirmed name and a junk row name: no name at all.
      assert.equal(fixes.alertCallerName({ state: { caller: {} }, rowName: 'like' }), '');
    }));

  it('(2) a move keeps its place: no coverage gate, only the new when, then update_appointment', () =>
    withFlag('on', () => {
      const { trace } = replay(14);
      for (const row of trace.filter((r) => r.turn >= 9)) {
        assert.notEqual(row.visitPlace?.blocked, 'unknown_coverage');
        assert.doesNotMatch(row.decision.reason, /Coverage is not on file/);
        assert.doesNotMatch(row.decision.reason, /create_appointment/);
      }
      const at11 = trace.find((r) => r.turn === 11);
      assert.match(at11.decision.reason, /update_appointment/);
    }));

  it('(2) a new job in a new place still meets the gate', () =>
    withFlag('on', () => {
      const { state } = replay(9);
      const fresh = structuredClone(state);
      fresh.conversation.answersReceived.push('I want a new booking for another house');
      assert.equal(
        fixes.skipCoverageGateForMove(fresh, { incomingPlace: 'Ruiru', profile: callProfile() }),
        false
      );
    }));

  it('price, the existing-visit lookup and the move to 1 PM stay green', async () =>
    withFlag('on', async () => {
      const profile = callProfile();
      const price = findCatalogMatch('Mimi nataka kujua ni pesa ngapi kuosha carpet, na', profile);
      assert.equal(price?.canonical, 'Carpet Cleaning (per room)');
      const { state } = replay(12);
      assert.ok(state.returning.openRows.some((r) => r.id === VISIT && r.kind === 'visit'));
      const { plan, writes, results } = await moveAtT12(state, profile);
      assert.ok(plan.appointmentUpdate, 'the move plan is kept');
      assert.equal(plan.fragmentBlocked, undefined);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].create, undefined);
      assert.equal(writes[0].appointmentId, VISIT);
      const ok = results.find((r) => r.action === 'update_appointment');
      assert.equal(ok.status, 'succeeded');
    }));

  it('(3) resolution_note says what was written; Haya is never the goal', async () =>
    withFlag('on', async () => {
      const { state, profile } = replay(12);
      const { results } = await moveAtT12(state, profile);
      const after = recordActionResults(state, results);
      const res = deriveCallResolution({ brainState: after, callId: THIS_CALL, turnCount: 17, now: NOW });
      assert.equal(res.resolutionNote, 'Moved Carpet Cleaning (per room) visit to Sat 10 Oct, 1 PM');
      const end = replay(14).state;
      assert.notEqual(end.goal.description, 'Haya');
      assert.match(end.goal.description, /move the time/);
      for (const filler of ['Haya.', 'Sawa.', 'okay', 'Okay then.', 'haya basi', 'Uh, I appreciate it then.']) {
        assert.equal(fixes.notAGoal(filler), true, filler);
      }
      // Haya does not end the call by itself.
      assert.equal(fixes.isClosingCue('Haya.'), false);
    }));

  it('(3) nothing written: Answered names the topic', () =>
    withFlag('on', () => {
      const { state } = replay(6);
      const res = deriveCallResolution({ brainState: { ...state, resolution: { ...state.resolution, status: 'resolved' } }, callId: THIS_CALL, turnCount: 6 });
      assert.match(res.resolutionNote, /^Answered: /);
      assert.notEqual(res.resolutionNote, 'Answered.');
    }));

  it('(4) no "Okay, Sawa" pair in Brain prompt text; one ack in the call language', () =>
    withFlag('on', () => {
      const { state } = replay(12);
      const prompt = formatBrainStateForPrompt(state) + '\n' + formatHomeServicesPlaybookForPrompt({});
      assert.doesNotMatch(prompt, /Okay, Sawa/);
      assert.match(prompt, /Never both in one reply/);
    }));

  it('(5) every flagged incomplete turn spoke its full say[]: scorer false positives', () => {
    for (const n of FIXTURE.live.incompleteTurns) {
      const turn = FIXTURE.turns.find((t) => t.voiceTurn === n);
      assert.ok(turn, `voice turn ${n}`);
      const say = turn.model?.say || [];
      assert.ok(say.length > 0, `voice turn ${n} has say[]`);
      for (const line of say) assert.ok(turn.spoken.includes(line), `voice turn ${n}: ${line}`);
    }
  });
});
