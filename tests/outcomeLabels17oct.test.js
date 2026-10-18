// 17 Oct audit: outcome labels and own-past-request reads.
// BRAIN_CALL_FIXES_D199=on fixes them; off keeps today's prod labels (pinned).
//   - prod calls: tests/fixtures/brain-calls/outcome-labels-17oct.json
//   - staging HD_7522f9a7ba06: tests/fixtures/brain-calls/HD_7522f9a7ba06.call.json

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const CALLS = require('./fixtures/brain-calls/outcome-labels-17oct.json').calls;
const FIXTURE_7522 = require('./fixtures/brain-calls/HD_7522f9a7ba06.call.json');
const TENANT = require('./fixtures/tenants/done-and-dusted-staging.json');
const { deriveCallResolution } = require('../src/conversation/callResolution');
const {
  mergeTranscriptReview,
  sweepUnreviewedCalls,
  toolFlagsFromBrain,
} = require('../src/conversation/callTranscriptReview');
const fixesD199 = require('../src/conversation/callFixesD199');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const { buildCallerMemoryCard } = require('../src/conversation/callerMemory');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const { looksLikeOfferAsk, looksLikeFileRead } = require('../src/conversation/fileRead');
const { offerCatalogueLine } = require('../src/conversation/knownFacts');

const RESOLVE_REASON = 'Resolve from knowledge; clarify once only if a specific fact is missing.';
const DIRECT_REASON =
  'Attempt direct resolution from relevant live ground truth before any capture or handoff.';

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

function call(id) {
  const row = CALLS.find((c) => c.callId === id);
  assert.ok(row, id);
  return row;
}

function callerTurns(row) {
  return row.turns.filter((t) => t.role === 'caller').map((t) => t.text);
}

/** Hangup Brain state as the live call left it (intent + last NBA from the stored summary). */
function hangupState(row, { intent, nba = 'ANSWER', status = 'unresolved', reason = RESOLVE_REASON, goal, saved = [] } = {}) {
  const caller = callerTurns(row);
  return {
    intent,
    goal: { description: goal ?? caller[0] ?? null, status: 'unknown', missingSlots: [] },
    conversation: { turnCount: caller.length, answersReceived: caller.slice(-8) },
    resolution: { status, nextBestAction: nba, reason },
    handoff: { requested: false, required: false },
    actions: {
      savedWork: saved.map((s, i) => ({
        action: 'create_service_request',
        status: 'succeeded',
        requestType: s.type,
        value: { type: s.type, item: s.item },
        record: { id: `sr-${i}`, item: s.item },
      })),
    },
  };
}

function hangup(row, opts) {
  return deriveCallResolution({ brainState: hangupState(row, opts) });
}

function review(row) {
  return row.prod.owner_review;
}

// ------------------------------------------------------------ no real need

const NO_NEED = [
  // id, live intent, NBA at hangup
  ['HD_a4b0a3d6f512', 'general_enquiry'],
  ['HD_d06d5aae4373', 'general_enquiry'],
  ['HD_e00d94d4fea8', 'general_enquiry'],
  ['HD_30a3970034a4', 'general_enquiry'],
];

describe('17 Oct: a call with only greetings or a fragment is never resolved', () => {
  for (const [id, intent] of NO_NEED) {
    it(`${id} off: resolved with the prompt reason as note (prod)`, () =>
      withFlag(null, () => {
        const row = call(id);
        const out = hangup(row, { intent });
        assert.equal(out.resolution, 'resolved');
        assert.equal(out.resolutionNote, RESOLVE_REASON);
        assert.equal(row.prod.resolution, 'resolved');
        assert.equal(row.prod.resolution_note, RESOLVE_REASON);
      }));

    it(`${id} on: abandoned, no prompt text`, () =>
      withFlag('on', () => {
        const row = call(id);
        const out = hangup(row, { intent });
        assert.equal(out.resolution, 'abandoned');
        assert.equal(out.resolutionNote, fixesD199.NO_NEED_NOTE);
        assert.equal(fixesD199.isPromptReasonNote(out.resolutionNote), false);
        if (review(row)) {
          const merged = mergeTranscriptReview({
            derived: { resolution: 'resolved', primaryIntent: intent, resolutionNote: RESOLVE_REASON },
            summary: { reason: row.prod.owner_review.reason },
            toolFlags: {},
            review: review(row),
            callerTurns: callerTurns(row),
          });
          assert.equal(merged.resolution, 'abandoned');
          assert.notEqual(merged.next, 'Call them back.');
        }
      }));
  }

  it('caller lines: greetings, fragments and side talk are not a need; a question is', () => {
    for (const text of ['Halo.', 'Halo?', 'Hey, come here— Yes?', 'One sec—', 'Dada, kazi gani?', 'Okay, listen—', 'Oh, habari, ni namna gani? Mnaendelea aje?', 'Habari yako.']) {
      assert.equal(fixesD199.callerNeedTurn(text), false, text);
    }
    for (const text of ['Files today. Which ones do you have?', 'bei gani?', 'I want— I want to order printing materials. Are they available?', 'Uh, I was looking to hold the Oxford set. Is it available?', 'huduma gani mnatoa?']) {
      assert.equal(fixesD199.callerNeedTurn(text), true, text);
    }
  });
});

// ---------------------------------------------------- prompt text as a note

describe('17 Oct: a next-best-action reason is never a resolution note', () => {
  it('HD_e4573ff2f3ad off: "Attempt direct resolution…" is the note (prod)', () =>
    withFlag(null, () => {
      const row = call('HD_e4573ff2f3ad');
      const out = hangup(row, { intent: 'availability', reason: DIRECT_REASON, goal: 'And what about my previous nini, my previous hold. Can you review it' });
      assert.equal(out.resolution, 'resolved');
      assert.equal(out.resolutionNote, DIRECT_REASON);
      assert.equal(row.prod.resolution_note, DIRECT_REASON);
    }));

  it('HD_e4573ff2f3ad on: resolved, the note names what was asked', () =>
    withFlag('on', () => {
      const row = call('HD_e4573ff2f3ad');
      const out = hangup(row, { intent: 'availability', reason: DIRECT_REASON, goal: 'And what about my previous nini, my previous hold. Can you review it' });
      assert.equal(out.resolution, 'resolved');
      assert.match(out.resolutionNote, /^Answered: And what about my previous/);
      assert.equal(fixesD199.isPromptReasonNote(out.resolutionNote), false);
    }));

  it('every NBA reason that reached prod notes is detected', () => {
    for (const note of [RESOLVE_REASON, DIRECT_REASON, 'Awaiting the caller goal.', 'The caller said goodbye. Close with a short farewell.', 'The caller goal is not established; ask one useful question.']) {
      assert.equal(fixesD199.isPromptReasonNote(note), true, note);
    }
    for (const note of ['Hold saved; awaiting owner Done.', 'Request saved (enquiry)', 'Answered: price.', 'Alvin k asked if printing materials are available.', 'Caller needed a human']) {
      assert.equal(fixesD199.isPromptReasonNote(note), false, note);
    }
  });

  it('on: a stored prompt-text note is not written back by the review', async () =>
    withFlagAsync('on', async () => {
      const row = call('HD_a4b0a3d6f512');
      const writes = [];
      await sweepUnreviewedCalls({
        findCalls: async () => [
          { sautikit_call_sid: row.callId, resolution: 'resolved', primary_intent: 'general_enquiry', resolution_note: RESOLVE_REASON, summary: { reason: 'No clear ask.' } },
        ],
        review: async (ctx) => {
          writes.push(ctx);
          return { ok: true };
        },
      });
      assert.equal(writes.length, 1);
      assert.equal(writes[0].derived.resolutionNote, null);
    }));
});

// ------------------------------------------------- needs_human only for a handoff

describe('17 Oct: needs_human only when a person must act', () => {
  const HOLD_SUMMARY = {
    service_request_id: 'c348b394-1cc6-4194-8cae-f2f19e197517',
    service_request_type: 'hold',
    service_request_item: 'Oxford set (metallic)',
    reason: 'Alvin Yegon left a hold for the Oxford set (metallic) for tomorrow morning.',
  };

  async function sweep4139() {
    const row = call('HD_4139ea705878');
    let merged = null;
    await sweepUnreviewedCalls({
      findCalls: async () => [
        { sautikit_call_sid: row.callId, resolution: 'resolved', primary_intent: 'hold_or_pickup', resolution_note: 'Hold saved; awaiting owner Done.', summary: HOLD_SUMMARY },
      ],
      review: async (ctx) => {
        merged = mergeTranscriptReview({ ...ctx, review: review(row), callerTurns: callerTurns(row) });
        return { ok: true };
      },
    });
    return merged;
  }

  it('HD_4139ea705878 off: the review sweep upgrades a saved hold to needs_human / human (prod)', async () =>
    withFlagAsync(null, async () => {
      const merged = await sweep4139();
      assert.equal(merged.resolution, 'needs_human');
      assert.equal(merged.primaryIntent, 'human');
      assert.equal(call('HD_4139ea705878').prod.resolution, 'needs_human');
    }));

  it('HD_4139ea705878 on: the sweep reads the saved hold from the summary; resolved / hold_or_pickup', async () =>
    withFlagAsync('on', async () => {
      const merged = await sweep4139();
      assert.equal(merged.resolution, 'resolved');
      assert.equal(merged.primaryIntent, 'hold_or_pickup');
      assert.equal(merged.next, 'None.');
    }));

  for (const [id, intent] of [
    ['HD_5290300eb772', 'general_enquiry'],
    ['HD_e2549533b468', 'product_inquiry'],
  ]) {
    const derive = (row) => hangup(row, { intent, nba: 'END', status: 'resolved', goal: callerTurns(row).find((t) => fixesD199.callerNeedTurn(t)) });

    it(`${id} off: an info call is upgraded to needs_human / human (prod)`, () =>
      withFlag(null, () => {
        const row = call(id);
        const derived = derive(row);
        const merged = mergeTranscriptReview({ derived, summary: {}, toolFlags: {}, review: review(row), callerTurns: callerTurns(row) });
        assert.equal(merged.resolution, 'needs_human');
        assert.equal(merged.primaryIntent, 'human');
        assert.equal(row.prod.resolution, 'needs_human');
        assert.equal(row.prod.primary_intent, 'human');
      }));

    it(`${id} on: resolved, intent is what they asked (${intent})`, () =>
      withFlag('on', () => {
        const row = call(id);
        const derived = derive(row);
        assert.equal(derived.resolution, 'resolved');
        const merged = mergeTranscriptReview({ derived, summary: {}, toolFlags: {}, review: review(row), callerTurns: callerTurns(row) });
        assert.equal(merged.resolution, 'resolved');
        assert.equal(merged.primaryIntent, intent);
        assert.notEqual(merged.next, 'Call them back.');
      }));
  }

  it('HD_e6d2aca7886c off: two enquiry rows (one junk) read as resolved (prod)', () =>
    withFlag(null, () => {
      const row = call('HD_e6d2aca7886c');
      const state = hangupState(row, { intent: 'order', saved: row.savedRows });
      const out = deriveCallResolution({ brainState: state });
      assert.equal(out.resolution, 'resolved');
      assert.equal(out.resolutionNote, 'Request saved (enquiry)');
      const merged = mergeTranscriptReview({ derived: out, summary: {}, toolFlags: toolFlagsFromBrain(state), review: review(row), callerTurns: callerTurns(row) });
      assert.equal(merged.resolution, 'resolved');
    }));

  it('HD_e6d2aca7886c on: only enquiry rows: the owner must answer, needs_human / order_enquiry', () =>
    withFlag('on', () => {
      const row = call('HD_e6d2aca7886c');
      const state = hangupState(row, { intent: 'order', saved: row.savedRows });
      const out = deriveCallResolution({ brainState: state });
      assert.equal(out.resolution, 'needs_human');
      assert.equal(out.primaryIntent, 'order_enquiry');
      const merged = mergeTranscriptReview({ derived: out, summary: {}, toolFlags: toolFlagsFromBrain(state), review: review(row), callerTurns: callerTurns(row) });
      assert.equal(merged.resolution, 'needs_human');
      assert.equal(merged.primaryIntent, 'order_enquiry');
    }));

  it('on: an escalate keeps the caller ask; a person ask stays human', () =>
    withFlag('on', () => {
      const esc = [{ action: 'escalate', status: 'succeeded' }];
      const priced = deriveCallResolution({ brainState: { intent: 'price', conversation: { turnCount: 3, answersReceived: ['bei ya kalamu ni ngapi?'] } }, toolResults: esc });
      assert.equal(priced.resolution, 'needs_human');
      assert.equal(priced.primaryIntent, 'price');
      const person = deriveCallResolution({ brainState: { intent: 'human', conversation: { turnCount: 2, answersReceived: ['nataka kuongea na manager'] } }, toolResults: esc });
      assert.equal(person.primaryIntent, 'human');
      // Asked for a person, then asked the hours: still human (high-water).
      let state = createBrainState();
      state = observeCallerTurn(state, { text: 'Nataka kuongea na manager.', detectedLanguage: 'sw', resolvedLanguage: 'sw' });
      state = observeCallerTurn(state, { text: 'Mnafunga saa ngapi?', detectedLanguage: 'sw', resolvedLanguage: 'sw' });
      assert.equal(state.conversation.askedForPerson, true);
      const later = deriveCallResolution({ brainState: state, toolResults: esc });
      assert.equal(later.primaryIntent, 'human');
    }));

  const UNFINISHED_VISIT = {
    derived: { primaryIntent: 'book_visit', resolution: 'unresolved' },
    summary: { reason: 'Caller asked for carpet cleaning.' },
    toolFlags: { visitAsk: true, service: 'carpet cleaning', place: 'Runda', when: 'morning', callerName: '' },
    review: { reason: 'Carpet cleaning in Runda.', primary_intent: 'book_visit', needs_human: false, confidence: 0.4 },
  };

  it('on: an unfinished talked visit needs a callback and stays book_visit', () =>
    withFlag('on', () => {
      const merged = mergeTranscriptReview(UNFINISHED_VISIT);
      assert.equal(merged.resolution, 'needs_human');
      assert.equal(merged.primaryIntent, 'book_visit');
      assert.equal(merged.next, 'Call them back.');
    }));

  it('off: an unfinished talked visit is stamped human (pinned)', () =>
    withFlag(null, () => {
      const merged = mergeTranscriptReview(UNFINISHED_VISIT);
      assert.equal(merged.resolution, 'needs_human');
      assert.equal(merged.primaryIntent, 'human');
    }));

  it('off: an escalate is human whatever was asked (pinned)', () =>
    withFlag(null, () => {
      const out = deriveCallResolution({ brainState: { intent: 'price', conversation: { turnCount: 3 } }, toolResults: [{ action: 'escalate', status: 'succeeded' }] });
      assert.equal(out.primaryIntent, 'human');
    }));
});

// ------------------------------------------------- HD_7522f9a7ba06 own past request

function profile7522() {
  const now = new Date(FIXTURE_7522.startedAt);
  const card = buildCallerMemoryCard({
    contact: FIXTURE_7522.callerFile.contact,
    openRequests: FIXTURE_7522.callerFile.requests,
    openAppointments: FIXTURE_7522.callerFile.openAppointments,
    now,
  });
  const profile = profileFromSnapshot(TENANT);
  profile.callerMemory = card;
  profile.openAppointments = FIXTURE_7522.callerFile.openAppointments;
  return { profile, now };
}

function replay7522(upto) {
  const { profile, now } = profile7522();
  let state = createBrainState(profile);
  let last = "Good evening, Done and Dusted, this is Shy. We're closed now. Tukusaidie vipi.";
  for (const turn of FIXTURE_7522.turns.filter((t) => t.turn <= upto)) {
    const entities = extractConversationEntities(turn.caller, {
      profile,
      intent: state.intent && state.intent !== 'unknown' ? state.intent : 'general_enquiry',
      state,
    });
    state = observeCallerTurn(state, {
      text: turn.caller,
      entities,
      lastAgentText: last,
      detectedLanguage: turn.language,
      resolvedLanguage: turn.language,
      profile,
      now,
    });
    last = turn.spoken || last;
  }
  return { state, profile };
}

const T4 = 'Ni huduma gani nilikuwa nimeitisha, mara ya mwisho?';

describe('HD_7522f9a7ba06: "huduma gani nilikuwa nimeitisha" is the caller file, not the services list', () => {
  it('off: turn 4 reads the services catalogue (prod/staging behaviour)', () =>
    withFlag(null, () => {
      const { state, profile } = replay7522(4);
      assert.equal(looksLikeOfferAsk(T4), true);
      const nba = determineNextBestAction({ state, capabilities: {} });
      assert.match(nba.reason, /services catalogue/);
      assert.match(offerCatalogueLine(T4, profile, 'sw'), /^Tuna /);
      assert.equal(state.conversation.fileReadSentence, 'Hakuna kilicho wazi.');
    }));

  it('on: turn 4 is a file read; the backend reads the caller visit, no catalogue', () =>
    withFlag('on', () => {
      const { state, profile } = replay7522(4);
      assert.equal(state.caller.nameConfirmed, true);
      assert.equal(looksLikeOfferAsk(T4), false);
      assert.equal(looksLikeFileRead(T4), true);
      const nba = determineNextBestAction({ state, capabilities: {} });
      assert.doesNotMatch(nba.reason, /services catalogue/);
      assert.equal(offerCatalogueLine(T4, profile, 'sw'), '');
      // #733 paged visit read: the sw fact line names the visit and the day relative to the call.
      assert.match(state.conversation.fileReadSentence, /^Una ziara ya Carpet Cleaning \(per room\), kesho, 1 PM, Kitengela, Grace Apartments\./);
    }));

  it('on: before the name is confirmed, the name gate comes first', () =>
    withFlag('on', () => {
      const card = { name: 'Alvin', sharedLine: false, greetByName: false, openVisits: ['Carpet Cleaning | Sat 10 Oct, 1 PM | Kitengela, Grace Apartments'], recentBookings: [] };
      const profile = { vertical: 'home_services', callerMemory: card };
      const state = observeCallerTurn(createBrainState(profile), { text: T4, profile, detectedLanguage: 'sw', resolvedLanguage: 'sw' });
      const nba = determineNextBestAction({ state, capabilities: {} });
      assert.match(nba.reason, /Name is not confirmed/);
      assert.equal(state.conversation.fileReadSentence, '');
      assert.equal(state.conversation.fileAskPending, true);
    }));

  it('on: past-tense own-request phrasing (sw, Sheng, en) is a file read; "huduma gani mnatoa" still lists', () =>
    withFlag('on', () => {
      const own = [
        T4,
        'Niliitisha nini?',
        'Niliomba huduma gani?',
        'Nilibook cleaning gani?',
        'Niliagiza nini jana?',
        'Nilikuwa nimeomba carpet cleaning, iko aje?',
        'Nilikua nimebook nini?',
        'Nili-order kitu gani?',
        'Nilirequest nini last time?',
        'What did I book?',
        'What did I order last week?',
        'Which service did I book?',
        'What was my last order?',
      ];
      for (const text of own) {
        assert.equal(fixesD199.looksLikeOwnPastRequest(text), true, text);
        assert.equal(looksLikeOfferAsk(text), false, text);
        assert.equal(looksLikeFileRead(text), true, text);
      }
      for (const text of ['Huduma gani mnatoa?', 'What services do you offer?', 'Niambie huduma zenu.']) {
        assert.equal(fixesD199.looksLikeOwnPastRequest(text), false, text);
        assert.equal(looksLikeOfferAsk(text), true, text);
      }
      for (const text of ['Nataka kuitisha cleaning kesho', 'I want to book carpet cleaning']) {
        assert.equal(fixesD199.looksLikeOwnPastRequest(text), false, text);
      }
    }));

  it('off: own-request phrasing keeps the old routing (pinned)', () =>
    withFlag(null, () => {
      assert.equal(looksLikeOfferAsk(T4), true);
      assert.equal(looksLikeFileRead('Niliagiza nini?'), false);
    }));
});
