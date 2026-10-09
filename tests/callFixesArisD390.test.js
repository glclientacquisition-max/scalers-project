'use strict';

// Replay of PROD Aris Kenya call 32fb7b9d-1bdc-4deb-bd92-7db1a9bfd202
// (HD_d3900cbf2b2d, 2026-10-09 20:18 EAT) behind BRAIN_CALL_FIXES_D199.
// Pulled read-only; nothing was written to prod.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const FIXTURE = require('./fixtures/voice-calls/HD_d3900cbf2b2d.call.json');
const TENANT = require('./fixtures/tenants/aris-prod.json');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const { buildCallerMemoryCard } = require('../src/conversation/callerMemory');
const { createBrainState, observeCallerTurn, recordActionResults } = require('../src/conversation/brainState');
const { extractConversationEntities, findCatalogMatch } = require('../src/conversation/entityExtraction');
const { guardToolPlan } = require('../src/conversation/requiredCreateRequest');
const { formatToolConfirmation } = require('../src/conversation/toolExecution');
const { deriveCallSummary } = require('../src/conversation/callSummary');
const { mergeTranscriptReview, toolFlagsFromBrain } = require('../src/conversation/callTranscriptReview');
const fixes = require('../src/conversation/callFixesD199');
const { setVoiceRendererForTest } = require('../src/conversation/factLine');

before(() => setVoiceRendererForTest(null));
after(() => setVoiceRendererForTest(undefined));

const NOW = new Date('2026-10-09T17:18:30Z');

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
  const profile = profileFromSnapshot(TENANT);
  profile.callerMemory = buildCallerMemoryCard({
    contact: FIXTURE.callerFile.contact,
    openRequests: [],
    openAppointments: [],
    now: NOW,
  });
  return profile;
}

function replay(upto) {
  const profile = callProfile();
  let state = createBrainState(profile);
  state.caller.fileNameAsked = 'Alvin Yegon';
  state.caller.fileNameAskSpoken = true;
  let lastAgent = '';
  for (const turn of FIXTURE.turns.filter((t) => t.turn <= upto)) {
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
      bargeIn: turn.bargeIn === true,
      profile,
      now: new Date(NOW.getTime() + turn.turn * 10000),
    });
    lastAgent = turn.spoken || lastAgent;
  }
  return { state, profile };
}

const T5_PLAN = {
  name: 'Alvin Yegon',
  reason: 'Inquiring about products and services',
  serviceRequest: {
    type: 'enquiry',
    item: 'General product enquiry',
    notes: 'Caller asked about offerings and products',
  },
};

const ENQUIRY_SAVED = [
  {
    action: 'create_service_request',
    status: 'succeeded',
    requestType: 'enquiry',
    requestStatus: 'open',
    value: { type: 'enquiry', item: 'General product enquiry', notes: 'Caller asked about offerings and products' },
  },
];

describe('HD_d3900cbf2b2d replay, BRAIN_CALL_FIXES_D199=off pins the live call', () => {
  it('the fragment save goes through; the goal is "A mood. Diary"; the matcher misses', () =>
    withFlag('off', () => {
      const { state, profile } = replay(5);
      const plan = guardToolPlan({ ...T5_PLAN, serviceRequest: { ...T5_PLAN.serviceRequest } }, state, {
        createServiceRequest: true,
      });
      assert.ok(plan.serviceRequest);
      assert.equal(plan.fragmentBlocked, undefined);
      assert.equal(findCatalogMatch('A mood. Diary?', profile)?.canonical, undefined);
      const end = replay(7).state;
      assert.equal(end.goal.description, 'A mood. Diary');
    }));
});

describe('HD_d3900cbf2b2d replay, BRAIN_CALL_FIXES_D199=on', () => {
  it('(6) a cut-off turn saves nothing and asks what they need', () =>
    withFlag('on', () => {
      for (const text of ['Uh, I was inquiring—', 'Uh, I was inquiring', 'I wanted to ask about…', 'Nilikuwa nauliza', 'Uh, how much for a.']) {
        assert.equal(fixes.isFragmentTurn(text), true, text);
      }
      for (const text of ['How much is the Mood diary A8?', 'What do you guys deal with?', 'Nataka hiyo']) {
        assert.equal(fixes.isFragmentTurn(text), false, text);
      }
      const { state } = replay(5);
      assert.equal(state.conversation.fragmentTurn, true);
      const plan = guardToolPlan({ ...T5_PLAN, serviceRequest: { ...T5_PLAN.serviceRequest } }, state, {
        createServiceRequest: true,
      });
      assert.equal(plan.serviceRequest, undefined);
      assert.equal(plan.name, undefined, 'no caller-info write either');
      assert.equal(plan.fragmentBlocked, true);
      const ask = fixes.askNeedLine('en');
      const spoken = formatToolConfirmation(
        [{ action: 'create_service_request', status: 'blocked', code: 'fragment_turn', askLine: ask.line }],
        'en'
      );
      assert.equal(spoken, 'Sure. What would you like to know?');
      assert.doesNotMatch(spoken, /saved/i);
      assert.equal(ask.lines[0].template, 'ask_need');
      assert.equal(ask.lines[0].gate.write, 'none');
      assert.equal(fixes.askNeedLine('sw').line, 'Sawa. Ungependa kujua nini?');
      assert.equal(fixes.askNeedLine('sheng').line, 'Poa. Unataka kujua nini?');
    }));

  it('(6) a whole ask after the fragment is not blocked', () =>
    withFlag('on', () => {
      const { state } = replay(7);
      assert.notEqual(state.conversation.fragmentTurn, true);
    }));

  it('(7) "A mood. Diary" matches Mood diary a8, which has no price; nothing invented', () =>
    withFlag('on', () => {
      const profile = profileFromSnapshot(TENANT);
      for (const text of ['A mood. Diary?', 'mood diary', 'A8 mood diary', 'How much is the mood diary?']) {
        const match = findCatalogMatch(text, profile);
        assert.equal(match?.canonical, 'Mood diary a8', text);
      }
      const row = TENANT.tenant.product_catalog.find((p) => p.name === 'Mood diary a8');
      assert.equal(row.price, '');
      // A size-less base shared by two products is never guessed.
      assert.deepEqual(
        fixes.sizelessProductTerms([{ name: 'Note book a4' }, { name: 'Note book a5' }]).map((t) => t.term || t),
        []
      );
    }));

  it('(8) the goal is the canonical product; the review kind comes from the write', () =>
    withFlag('on', () => {
      const { state } = replay(7);
      assert.equal(state.goal.description, 'Mood diary a8');
      const after = recordActionResults(state, ENQUIRY_SAVED);
      const summary = deriveCallSummary({ brainState: after });
      assert.doesNotMatch(summary.brainSummary || summary.text || JSON.stringify(summary), /A mood\. Diary/);
      const flags = toolFlagsFromBrain(after);
      assert.equal(flags.holdOpen, false);
      assert.equal(flags.enquirySaved, true);
      const merged = mergeTranscriptReview({
        derived: { primaryIntent: 'order_enquiry', resolution: 'resolved' },
        summary: {},
        toolFlags: flags,
        review: { ...FIXTURE.live.ownerReview },
        callerTurns: FIXTURE.turns.map((t) => t.caller),
      });
      assert.notEqual(merged.reviewKind, 'hold_or_pickup');
      assert.equal(merged.reviewKind, 'order_enquiry');
      assert.equal(merged.done, 'Enquiry saved: General product enquiry.');
    }));
});
