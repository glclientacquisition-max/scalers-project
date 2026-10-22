// Prod HD_e75a669780d4 (Aris, 20 Oct): 259 s, order be519ced saved, labelled
// abandoned / no intent / "Call completed." / "Very short call". The live
// state that reached the hangup writer had no turns or tool results and the
// transcripts table held only the greeting; voice_turn_traces kept 19 caller
// turns. BRAIN_CALL_FIXES_D199=on: a saved request or visit is never
// abandoned, and thin transcripts fall back to traced turns. Off: today's
// labels (pinned).
//   fixture: tests/fixtures/brain-calls/HD_e75a669780d4.call.json (prod SELECT, phone redacted)

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const FX = require('./fixtures/brain-calls/HD_e75a669780d4.call.json');
const { deriveCallResolution } = require('../src/conversation/callResolution');
const { deriveCallSummary } = require('../src/conversation/callSummary');
const {
  runPostCallTranscriptReview,
  sweepUnreviewedCalls,
} = require('../src/conversation/callTranscriptReview');
const saved = require('../src/conversation/savedRequestOutcome');

const VERY_SHORT = 'Very short call — little conversation';
// What the hangup writer stored for this call (prod row).
const PROD_DERIVED = Object.freeze({
  resolution: FX.call.resolution,
  primaryIntent: FX.call.primary_intent,
  resolutionNote: FX.call.resolution_note,
});
const REVIEW_JSON = JSON.stringify({
  reason: 'Chris ordered an A4 zipper bag for the exam period.',
  want: 'Chris wants an A4 zipper bag.',
  done: 'Order saved for an A4 zipper bag.',
  next: 'Confirm the order with Chris.',
  mood: 'neutral',
  needs_human: false,
  needs_owner: true,
  urgent: false,
  primary_intent: 'order_enquiry',
  confidence: 0.9,
});

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

function storedWith(extra) {
  const base = { ...FX.call.summary };
  delete base.service_request_id;
  delete base.service_request_type;
  delete base.service_request_item;
  return { ...base, ...extra };
}

function reviewDeps(overrides = {}) {
  const calls = { generate: [], save: [], repair: [], status: [], traceLoads: 0 };
  const deps = {
    waitMs: 0,
    retryMs: 0,
    loadTurns: async () => FX.transcripts,
    loadTraceTurns: async () => {
      calls.traceLoads += 1;
      return saved.traceTurnsForReview(FX.traceTurns);
    },
    loadCall: async () => FX.call,
    generateText: async (args) => {
      calls.generate.push(args);
      return REVIEW_JSON;
    },
    save: async (args) => calls.save.push(args),
    saveRepair: async (args) => calls.repair.push(args),
    recordStatus: async (args) => calls.status.push(args.status),
    ...overrides,
  };
  return { deps, calls };
}

describe('HD_e75a669780d4 fixture (prod)', () => {
  it('is the prod shape: request saved, label abandoned, transcript greeting only, 19 traced caller turns', () => {
    assert.equal(FX.call.duration_seconds, 259);
    assert.equal(FX.call.resolution, 'abandoned');
    assert.equal(FX.call.primary_intent, null);
    assert.equal(FX.call.resolution_note, VERY_SHORT);
    assert.equal(FX.call.summary.text, 'Call completed.');
    assert.equal(FX.call.summary.service_request_id, FX.serviceRequest.id);
    assert.equal(FX.serviceRequest.request_type, 'order');
    assert.deepEqual(FX.transcripts.map((t) => t.speaker), ['agent']);
    assert.equal(FX.traceTurns.length, 19);
    assert.doesNotMatch(JSON.stringify(FX), /\+254(?!709221536)\d{9}/, 'caller phone is redacted');
  });
});

describe('deriveCallResolution: a saved request is never abandoned', () => {
  it('off: an empty live state on a call that saved an order stays "Very short call" (today, pinned)', () =>
    withFlag(null, () => {
      const out = deriveCallResolution({ brainState: {}, storedSummary: FX.call.summary });
      assert.equal(out.resolution, 'abandoned');
      assert.equal(out.resolutionNote, VERY_SHORT);
    }));

  it('on: the stored order makes it resolved, intent from the order row, honest note (HD_e75a669780d4)', () =>
    withFlag('on', () => {
      const out = deriveCallResolution({ brainState: {}, storedSummary: JSON.stringify(FX.call.summary) });
      assert.equal(out.resolution, 'resolved');
      assert.equal(out.primaryIntent, 'order_enquiry');
      assert.equal(out.resolutionNote, 'Request saved (order)');
      assert.doesNotMatch(String(out.resolutionNote), /very short/i);
    }));

  it('on: a stored hold is resolved / hold_or_pickup', () =>
    withFlag('on', () => {
      const out = deriveCallResolution({
        brainState: {},
        storedSummary: storedWith({ service_request_id: 'r1', service_request_type: 'hold', service_request_item: 'A4 rim' }),
      });
      assert.equal(out.resolution, 'resolved');
      assert.equal(out.primaryIntent, 'hold_or_pickup');
      assert.equal(out.resolutionNote, 'Hold saved; awaiting owner Done.');
    }));

  it('on: an enquiry or callback row needs the owner (needs_human, #732 rule)', () =>
    withFlag('on', () => {
      for (const type of ['enquiry', 'callback']) {
        const out = deriveCallResolution({
          brainState: {},
          storedSummary: storedWith({ service_request_id: 'r2', service_request_type: type, service_request_item: 'Toner' }),
        });
        assert.equal(out.resolution, 'needs_human', type);
        assert.notEqual(out.primaryIntent, null, type);
      }
    }));

  it('on: a stored visit is resolved / book_visit with the visit note', () =>
    withFlag('on', () => {
      const out = deriveCallResolution({
        brainState: {},
        storedSummary: storedWith({ appointment_id: 'a1', appointment_service: 'Carpet cleaning' }),
      });
      assert.equal(out.resolution, 'resolved');
      assert.equal(out.primaryIntent, 'book_visit');
      assert.equal(out.resolutionNote, 'Visit request saved — confirm on desk.');
    }));

  it('on: live results win; the stored row is not added twice', () =>
    withFlag('on', () => {
      const live = [
        { action: 'create_service_request', status: 'succeeded', requestType: 'hold', value: { type: 'hold', item: 'Pens' } },
      ];
      const rows = saved.withStoredWork(live, FX.call.summary);
      assert.equal(rows.length, 1);
      const out = deriveCallResolution({ brainState: {}, toolResults: live, storedSummary: FX.call.summary });
      assert.equal(out.primaryIntent, 'hold_or_pickup');
    }));

  it('on: no stored work and one turn is still a short call', () =>
    withFlag('on', () => {
      const out = deriveCallResolution({ brainState: {}, storedSummary: storedWith({}) });
      assert.equal(out.resolution, 'abandoned');
      assert.equal(out.resolutionNote, VERY_SHORT);
    }));

  it('on: more than one traced caller turn is never "very short"', () =>
    withFlag('on', () => {
      const turns = saved.traceTurnsForReview(FX.traceTurns);
      const out = deriveCallResolution({ brainState: {}, callerTurnCount: saved.callerTurnCount(turns) });
      assert.notEqual(out.resolutionNote, VERY_SHORT);
      assert.notEqual(out.resolution, 'abandoned');
    }));
});

describe('deriveCallSummary: the stored order is in the summary', () => {
  it('off: "Call completed." (today)', () =>
    withFlag(null, () => {
      const out = deriveCallSummary({ brainState: {}, storedSummary: FX.call.summary });
      assert.equal(out.text, 'Call completed.');
      assert.equal(out.primaryIntent, null);
    }));

  it('on: intent and the ordered item, not "Call completed."', () =>
    withFlag('on', () => {
      const out = deriveCallSummary({ brainState: {}, storedSummary: FX.call.summary });
      assert.equal(out.primaryIntent, 'order_enquiry');
      assert.notEqual(out.text, 'Call completed.');
      assert.match(out.text, /Mg zipper bag-a4/);
    }));
});

describe('traced turns', () => {
  it('reads 19 caller turns and the spoken receptionist lines, not fillers', () => {
    const turns = saved.traceTurnsForReview(FX.traceTurns);
    assert.equal(saved.callerTurnCount(turns), 19);
    const caller = turns.filter((t) => t.speaker === 'caller').map((t) => t.text);
    assert.equal(caller[18], 'Mimi naitwa Chris.');
    assert.ok(caller.some((t) => /zipper bag/i.test(t)));
    const agent = turns.filter((t) => t.speaker === 'agent').map((t) => t.text);
    assert.ok(agent.some((t) => /A4 zipper bag tayari/.test(t)));
    assert.ok(!agent.includes('Mm.'), 'filler is not a receptionist line');
  });
});

describe('runPostCallTranscriptReview on HD_e75a669780d4', () => {
  it('off: greeting-only transcript stops at thin; no trace read, no repair (today)', () =>
    withFlag(null, async () => {
      const { deps, calls } = reviewDeps();
      const out = await runPostCallTranscriptReview(
        { callSid: FX.callSid, derived: { ...PROD_DERIVED }, summary: { text: 'Call completed.' } },
        deps
      );
      assert.equal(out.reason, 'thin');
      assert.equal(calls.traceLoads, 0);
      assert.equal(calls.repair.length, 0);
      assert.deepEqual(calls.status, ['thin']);
    }));

  it('on: reviews the traced turns and floors the label from the saved order', () =>
    withFlag('on', async () => {
      const { deps, calls } = reviewDeps();
      const out = await runPostCallTranscriptReview(
        { callSid: FX.callSid, derived: { ...PROD_DERIVED }, summary: { text: 'Call completed.' } },
        deps
      );
      assert.equal(out.ok, true);
      assert.equal(calls.traceLoads, 1);
      assert.equal(calls.generate.length, 1);
      assert.match(calls.generate[0].user, /Caller: Do you have do you guys mnakwanga na zipper bag\?/);
      assert.deepEqual(calls.status, ['ok']);
      // Repair: label and the thin summary text.
      assert.equal(calls.repair.length, 1);
      const repair = calls.repair[0].repair;
      assert.equal(repair.labelChanged, true);
      assert.equal(repair.derived.resolution, 'resolved');
      assert.equal(repair.derived.primaryIntent, 'order_enquiry');
      assert.equal(repair.derived.resolutionNote, 'Request saved (order)');
      assert.equal(repair.summaryPatch.text, 'Intent: order_enquiry. Chris left an order for Mg zipper bag-a4.');
      assert.equal(repair.summaryPatch.reason, 'Chris left an order for Mg zipper bag-a4.');
      assert.equal(repair.summaryPatch.primary_intent, 'order_enquiry');
      // The merged review never reads abandoned or a callback.
      assert.notEqual(out.merged.resolution, 'abandoned');
      assert.notEqual(out.merged.resolution, 'needs_human');
    }));

  it('on: no traces either: still thin, but the saved order is never abandoned', () =>
    withFlag('on', async () => {
      const { deps, calls } = reviewDeps({ loadTraceTurns: async () => [] });
      const out = await runPostCallTranscriptReview(
        { callSid: FX.callSid, derived: { ...PROD_DERIVED }, summary: { text: 'Call completed.' } },
        deps
      );
      assert.equal(out.reason, 'thin');
      assert.equal(calls.generate.length, 0);
      assert.equal(calls.repair.length, 1);
      assert.equal(calls.repair[0].repair.derived.resolution, 'resolved');
      assert.doesNotMatch(String(calls.repair[0].repair.derived.resolutionNote), /very short/i);
    }));

  it('on: a label that already says resolved with an intent is left alone', () =>
    withFlag('on', async () => {
      const { deps, calls } = reviewDeps({ loadTraceTurns: async () => [] });
      const call = {
        ...FX.call,
        summary: {
          ...FX.call.summary,
          text: 'Intent: order_enquiry. Actions: order. Mg zipper bag-a4',
          brain_summary: 'Intent: order_enquiry. Actions: order. Mg zipper bag-a4',
          reason: 'Chris ordered.',
          primary_intent: 'order_enquiry',
        },
      };
      await runPostCallTranscriptReview(
        {
          callSid: FX.callSid,
          call,
          derived: { resolution: 'resolved', primaryIntent: 'order_enquiry', resolutionNote: 'Request saved (order)' },
        },
        deps
      );
      assert.equal(calls.repair.length, 0);
    }));
});

describe('review sweep: a thin call that saved a request gets one more pass', () => {
  const row = () => ({
    sautikit_call_sid: FX.callSid,
    id: FX.call.id,
    resolution: FX.call.resolution,
    primary_intent: null,
    summary: { ...FX.call.summary },
  });

  it('off: review_status thin is final (today)', () =>
    withFlag(null, async () => {
      const seen = [];
      await sweepUnreviewedCalls({ findCalls: async () => [row()], review: async (ctx) => seen.push(ctx) && { ok: true } });
      assert.equal(seen.length, 0);
    }));

  it('on: thin + saved order + abandoned is revisited with the stored tool flags', () =>
    withFlag('on', async () => {
      const seen = [];
      await sweepUnreviewedCalls({
        findCalls: async () => [row()],
        review: async (ctx) => {
          seen.push(ctx);
          return { ok: true };
        },
      });
      assert.equal(seen.length, 1);
      assert.equal(seen[0].derived.resolution, 'abandoned');
      assert.equal(seen[0].toolFlags.holdSaved, true);
      assert.equal(seen[0].reviewAttempt, 2);
    }));

  it('on: thin + saved order already resolved is not revisited', () =>
    withFlag('on', async () => {
      const seen = [];
      const r = { ...row(), resolution: 'resolved', primary_intent: 'order_enquiry' };
      await sweepUnreviewedCalls({ findCalls: async () => [r], review: async (ctx) => seen.push(ctx) && { ok: true } });
      assert.equal(seen.length, 0);
    }));
});
