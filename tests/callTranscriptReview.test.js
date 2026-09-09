const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractCallerNameFromTranscript,
  formatTranscriptForReview,
  isReviewEnabled,
  mergeTranscriptReview,
  parseExtractedCallerName,
  parseReviewJson,
  persistCompletedCallContact,
  resetTranscriptReviewScheduleForTests,
  runPostCallHangupJobs,
  runPostCallTranscriptReview,
  schedulePostCallTranscriptReview,
  toolFlagsFromBrain,
} = require('../src/conversation/callTranscriptReview');
const { createBrainState, recordActionResults } = require('../src/conversation/brainState');

afterEach(() => {
  resetTranscriptReviewScheduleForTests();
  delete process.env.POST_CALL_GEMINI_REVIEW;
});

const holdFlags = {
  holdSaved: true,
  visitSaved: false,
  escalateSaved: false,
  handoff: false,
};

const visitFlags = {
  holdSaved: false,
  visitSaved: true,
  escalateSaved: false,
  handoff: false,
};

const escalateFlags = {
  holdSaved: false,
  visitSaved: false,
  escalateSaved: true,
  handoff: true,
};

const emptyFlags = {
  holdSaved: false,
  visitSaved: false,
  escalateSaved: false,
  handoff: false,
};

describe('formatTranscriptForReview', () => {
  it('labels caller and receptionist turns', () => {
    const text = formatTranscriptForReview([
      { speaker: 'caller', text: 'Are you open on Sunday?' },
      { speaker: 'agent', text_content: 'Yes, 10 to 4.' },
      { speaker: 'system', text: 'noise' },
    ]);
    assert.match(text, /^Caller: Are you open on Sunday\?/m);
    assert.match(text, /^Receptionist: Yes, 10 to 4\./m);
    assert.doesNotMatch(text, /noise/);
  });
});

describe('parseReviewJson', () => {
  it('parses fenced JSON and strips dash punctuation from reason', () => {
    const parsed = parseReviewJson(`
\`\`\`json
{
  "reason": "Brian left a hold — Atomic Habits tomorrow at 5",
  "primary_intent": "hold_or_pickup",
  "needs_human": false,
  "needs_owner": false,
  "urgent": false,
  "confidence": 0.91
}
\`\`\`
`);
    assert.equal(parsed.primary_intent, 'hold_or_pickup');
    assert.equal(parsed.needs_human, false);
    assert.doesNotMatch(parsed.reason, /[\u2014\u2013]/);
    assert.match(parsed.reason, /Atomic Habits/);
    assert.equal(parsed.confidence, 0.91);
  });

  it('maps callback aliases onto human intent', () => {
    const parsed = parseReviewJson(
      JSON.stringify({
        reason: 'Caller asked to speak to the owner now',
        primary_intent: 'needs_human',
        needs_human: true,
        confidence: 0.8,
      })
    );
    assert.equal(parsed.primary_intent, 'human');
    assert.equal(parsed.needs_human, true);
  });
});

describe('mergeTranscriptReview', () => {
  it('applies a clean owner sentence', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'hold_or_pickup', resolution: 'resolved' },
      summary: { reason: 'Brian left a hold.' },
      toolFlags: holdFlags,
      review: {
        reason: 'Brian left a hold for Atomic Habits. Pickup tomorrow at 5pm.',
        primary_intent: 'hold_or_pickup',
        needs_human: false,
        needs_owner: false,
        confidence: 0.9,
      },
    });
    assert.equal(merged.applied.reason, true);
    assert.match(merged.reason, /Atomic Habits/);
    assert.equal(merged.resolution, 'resolved');
    assert.equal(merged.primaryIntent, 'hold_or_pickup');
  });

  it('never downgrades a successful escalate', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'human', resolution: 'needs_human' },
      summary: { reason: 'Amina needs you to return the call.' },
      toolFlags: escalateFlags,
      review: {
        reason: 'Hours question was answered.',
        primary_intent: 'hours_open',
        needs_human: false,
        needs_owner: false,
        confidence: 0.99,
      },
    });
    assert.equal(merged.primaryIntent, 'human');
    assert.equal(merged.resolution, 'needs_human');
    assert.equal(merged.applied.intent, false);
    assert.equal(merged.applied.resolution, false);
    assert.match(merged.reason, /Amina needs you/);
  });

  it('never overrides a saved hold with needs_human', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'hold_or_pickup', resolution: 'resolved' },
      summary: { reason: 'Brian left a hold.' },
      toolFlags: holdFlags,
      review: {
        reason: 'Brian still needs a callback about the hold.',
        primary_intent: 'human',
        needs_human: true,
        needs_owner: false,
        confidence: 0.99,
      },
    });
    assert.equal(merged.primaryIntent, 'hold_or_pickup');
    assert.equal(merged.resolution, 'resolved');
  });

  it('never overrides a saved visit with needs_human', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'book_visit', resolution: 'resolved' },
      summary: { reason: 'Mary booked a visit.' },
      toolFlags: visitFlags,
      review: {
        reason: 'Mary needs you to confirm the plumber.',
        primary_intent: 'human',
        needs_human: true,
        confidence: 0.95,
      },
    });
    assert.equal(merged.primaryIntent, 'book_visit');
    assert.equal(merged.resolution, 'resolved');
  });

  it('upgrades to needs_human at high confidence when nothing was saved', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'general_enquiry', resolution: 'unresolved' },
      summary: { reason: 'Caller called.' },
      toolFlags: emptyFlags,
      review: {
        reason: 'James asked to speak to the owner about an unpaid invoice.',
        primary_intent: 'human',
        needs_human: true,
        needs_owner: false,
        confidence: 0.8,
      },
    });
    assert.equal(merged.primaryIntent, 'human');
    assert.equal(merged.resolution, 'needs_human');
    assert.equal(merged.applied.intent, true);
    assert.equal(merged.applied.resolution, true);
  });

  it('does not upgrade to needs_human below confidence', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'general_enquiry', resolution: 'unresolved' },
      summary: { reason: 'Caller called.' },
      toolFlags: emptyFlags,
      review: {
        reason: 'Maybe they wanted a person.',
        primary_intent: 'human',
        needs_human: true,
        confidence: 0.5,
      },
    });
    assert.equal(merged.primaryIntent, 'general_enquiry');
    assert.equal(merged.resolution, 'unresolved');
  });

  it('marks a confident FAQ as resolved without a return call', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'other', resolution: 'unresolved' },
      summary: { reason: 'Caller called.' },
      toolFlags: emptyFlags,
      review: {
        reason: 'Caller asked if the shop is open on Sunday. Receptionist said 10 to 4.',
        primary_intent: 'hours_open',
        needs_human: false,
        needs_owner: false,
        confidence: 0.88,
      },
    });
    assert.equal(merged.resolution, 'resolved');
    assert.equal(merged.primaryIntent, 'hours_open');
    assert.equal(merged.applied.resolution, true);
  });

  it('does not mark resolved when the owner still owes a fact', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'price', resolution: 'unresolved' },
      summary: { reason: 'Caller asked about price.' },
      toolFlags: emptyFlags,
      review: {
        reason: 'Caller asked the price of Atomic Habits. Receptionist said someone will check.',
        primary_intent: 'product_inquiry',
        needs_human: false,
        needs_owner: true,
        confidence: 0.95,
      },
    });
    assert.equal(merged.resolution, 'unresolved');
    assert.equal(merged.applied.resolution, false);
  });
});

describe('toolFlagsFromBrain', () => {
  it('reads succeeded tools and handoff', () => {
    let state = createBrainState();
    state.handoff.requested = true;
    state = recordActionResults(state, [
      {
        action: 'create_service_request',
        status: 'succeeded',
        requestType: 'hold',
      },
    ]);
    const flags = toolFlagsFromBrain(state);
    assert.equal(flags.holdSaved, true);
    assert.equal(flags.visitSaved, false);
    assert.equal(flags.handoff, true);
  });
});

describe('runPostCallTranscriptReview', () => {
  it('loads turns, merges, and saves without calling live Gemini', async () => {
    const saved = [];
    const result = await runPostCallTranscriptReview(
      {
        callSid: 'CA_review_1',
        derived: { primaryIntent: 'hours_open', resolution: 'resolved' },
        summary: { reason: 'Caller asked about hours.' },
        toolFlags: emptyFlags,
      },
      {
        waitMs: 0,
        retryMs: 0,
        delay: async () => {},
        loadTurns: async () => [
          { speaker: 'caller', text: 'Are you open on Sunday?' },
          { speaker: 'agent', text: 'Yes, from 10 to 4.' },
        ],
        generateText: async ({ user }) => {
          assert.match(user, /Are you open on Sunday/);
          return JSON.stringify({
            reason: 'Caller asked if the shop is open Sunday. Receptionist said 10 to 4.',
            primary_intent: 'hours_open',
            needs_human: false,
            needs_owner: false,
            urgent: false,
            confidence: 0.92,
          });
        },
        save: async (payload) => {
          saved.push(payload);
        },
      }
    );
    assert.equal(result.ok, true);
    assert.equal(saved.length, 1);
    assert.match(saved[0].merged.reason, /Sunday/);
    assert.equal(saved[0].merged.resolution, 'resolved');
  });

  it('no-ops without turns', async () => {
    const result = await runPostCallTranscriptReview(
      { callSid: 'CA_empty' },
      {
        waitMs: 0,
        retryMs: 0,
        delay: async () => {},
        loadTurns: async () => [],
        generateText: async () => {
          throw new Error('should not generate');
        },
        save: async () => {
          throw new Error('should not save');
        },
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no_turns');
  });

  it('honors POST_CALL_GEMINI_REVIEW=off for the review pass only', async () => {
    process.env.POST_CALL_GEMINI_REVIEW = 'off';
    assert.equal(isReviewEnabled(), false);
    const result = await runPostCallTranscriptReview({ callSid: 'CA_off' });
    assert.equal(result.reason, 'disabled');
    const scheduled = schedulePostCallTranscriptReview(
      { callSid: 'CA_off' },
      { scheduleDelayMs: 999999 }
    );
    assert.equal(scheduled.scheduled, true);
  });
});

const fatTurns = [
  { speaker: 'caller', text: 'Hi, my name is Amina. Are you open on Sunday?' },
  { speaker: 'agent', text: 'Yes, 10 to 4.' },
];

describe('parseExtractedCallerName', () => {
  it('returns null for NONE', () => {
    assert.equal(parseExtractedCallerName('NONE'), null);
    assert.equal(parseExtractedCallerName('none'), null);
  });

  it('accepts a plausible name', () => {
    assert.equal(parseExtractedCallerName('Amina'), 'Amina');
    assert.equal(parseExtractedCallerName('"Brian"'), 'Brian');
  });
});

describe('post-call contact persist and name extract', () => {
  it('upserts a contact with a null name when none is known', async () => {
    const upserts = [];
    const result = await persistCompletedCallContact(
      { callSid: 'CA_anon' },
      {
        getCall: async () => ({
          id: 'call-1',
          tenant_id: 't1',
          from_number: '+254712345678',
          name: null,
          reason: 'Hours',
        }),
        upsertContact: async (row) => {
          upserts.push(row);
          return { id: 'ct-1', ...row };
        },
      }
    );
    assert.equal(result.ok, true);
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].name, null);
    assert.equal(upserts[0].phone, '+254712345678');
    assert.equal(upserts[0].callId, 'call-1');
  });

  it('skips unknown phones', async () => {
    const result = await persistCompletedCallContact(
      { callSid: 'CA_unk' },
      {
        getCall: async () => ({
          id: 'call-2',
          tenant_id: 't1',
          from_number: 'unknown',
        }),
        upsertContact: async () => {
          throw new Error('should not upsert');
        },
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no_phone');
  });

  it('maps mocked Gemini NONE to a nameless upsert', async () => {
    process.env.POST_CALL_GEMINI_REVIEW = 'off';
    const upserts = [];
    const result = await runPostCallHangupJobs(
      {
        callSid: 'CA_none',
        turns: fatTurns,
        summary: { name: null, reason: 'Sunday hours' },
      },
      {
        waitMs: 0,
        retryMs: 0,
        generateNameText: async () => 'NONE',
        generateText: async () => {
          throw new Error('review should not run');
        },
        getCall: async () => ({
          id: 'call-3',
          tenant_id: 't1',
          from_number: '+254700000001',
          name: null,
        }),
        upsertContact: async (row) => {
          upserts.push(row);
          return row;
        },
        save: async () => {
          throw new Error('should not save review');
        },
      }
    );
    assert.equal(result.ok, true);
    assert.equal(result.extracted, null);
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].name, null);
  });

  it('feeds a mocked Gemini name into upsertContact', async () => {
    process.env.POST_CALL_GEMINI_REVIEW = 'off';
    const upserts = [];
    const result = await runPostCallHangupJobs(
      {
        callSid: 'CA_name',
        turns: fatTurns,
        summary: { name: null, reason: 'Sunday hours' },
      },
      {
        waitMs: 0,
        retryMs: 0,
        generateNameText: async ({ system }) => {
          assert.match(system, /ONLY the name/);
          return 'Amina';
        },
        getCall: async () => ({
          id: 'call-4',
          tenant_id: 't1',
          from_number: '+254700000002',
          name: null,
        }),
        upsertContact: async (row) => {
          upserts.push(row);
          return row;
        },
      }
    );
    assert.equal(result.extracted, 'Amina');
    assert.equal(upserts[upserts.length - 1].name, 'Amina');
  });

  it('extractCallerNameFromTranscript maps NONE and a real name', async () => {
    const none = await extractCallerNameFromTranscript(fatTurns, {
      generateNameText: async () => 'NONE',
    });
    const named = await extractCallerNameFromTranscript(fatTurns, {
      generateNameText: async () => 'Jane',
    });
    assert.equal(none, null);
    assert.equal(named, 'Jane');
  });
});
