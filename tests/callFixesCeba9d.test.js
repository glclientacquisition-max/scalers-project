// HD_ceba9d9b3f37 (staging call ae6d7c03, 2026-10-09 12:59 EAT, D&D, en):
// the caller asked about their booking and the services, never hours. The
// owner review said "Hours were answered." for done and next, and the reason
// read "Alvin asked about that's all.". BRAIN_CALL_FIXES_D199=on drops
// topics nobody raised and never takes a closing as the goal.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const FIXTURE = require('./fixtures/voice-calls/HD_ceba9d9b3f37.call.json');
const {
  runPostCallTranscriptReview,
  mergeTranscriptReview,
  REVIEW_SYSTEM,
} = require('../src/conversation/callTranscriptReview');
const { isRejectedGoalText, callerGoalText } = require('../src/conversation/entityExtraction');
const { deriveCallSummary } = require('../src/conversation/callSummary');
const { createBrainState } = require('../src/conversation/brainState');
const { keepRaisedTopics } = require('../src/conversation/callFixesD199');

function withFlag(value, fn) {
  const prev = process.env.BRAIN_CALL_FIXES_D199;
  if (value == null) delete process.env.BRAIN_CALL_FIXES_D199;
  else process.env.BRAIN_CALL_FIXES_D199 = value;
  const restore = () => {
    if (prev == null) delete process.env.BRAIN_CALL_FIXES_D199;
    else process.env.BRAIN_CALL_FIXES_D199 = prev;
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(restore);
    restore();
    return out;
  } catch (err) {
    restore();
    throw err;
  }
}

async function replayReview(review = FIXTURE.live.ownerReview) {
  let system = '';
  const saved = [];
  const result = await runPostCallTranscriptReview(
    {
      callSid: FIXTURE.callSid,
      turns: FIXTURE.transcript,
      derived: { primaryIntent: 'general_enquiry', resolution: 'resolved', resolutionNote: FIXTURE.live.resolutionNote },
      summary: FIXTURE.live.summary,
      toolFlags: { intent: 'general_enquiry', callerName: 'Alvin' },
      vertical: 'home_services',
    },
    {
      generateText: async (args) => {
        system = args.system;
        return JSON.stringify(review);
      },
      save: async (row) => saved.push(row),
      waitMs: 0,
      retryMs: 0,
    }
  );
  return { result, system, saved };
}

describe('HD_ceba9d9b3f37 owner review, BRAIN_CALL_FIXES_D199=on', () => {
  it('(8a) "Hours were answered." is dropped: hours never came up', () =>
    withFlag('on', async () => {
      const { result, system } = await replayReview();
      assert.equal(result.ok, true);
      assert.equal(result.merged.done, 'None.');
      assert.equal(result.merged.next, 'None.');
      assert.deepEqual(result.merged.applied.topicsDropped, ['hours']);
      // The prompt no longer offers canned hours lines.
      assert.doesNotMatch(system, /Hours answered\.|Hours were answered/);
      assert.match(REVIEW_SYSTEM, /Hours answered\./);
    }));

  it('(8b) the reason is never "asked about that\'s all"', () =>
    withFlag('on', async () => {
      const { result } = await replayReview();
      assert.equal(result.merged.reason, 'Answered.');
      assert.doesNotMatch(`${result.merged.reason} ${result.merged.want}`, /that's all/i);
      for (const said of ["That's all", 'hiyo tu', 'okay thank you', 'Okay, thank you.', 'asante', 'nothing else', 'Natafakari.']) {
        assert.equal(isRejectedGoalText(said), true, said);
        assert.equal(callerGoalText(said), '', said);
      }
      assert.equal(isRejectedGoalText('what services do you offer'), false);
      const state = createBrainState({});
      state.caller.name = 'Alvin';
      state.goal.description = "That's all";
      const summary = deriveCallSummary({ brainState: state, toolResults: [] });
      assert.doesNotMatch(JSON.stringify(summary), /that's all/i);
    }));

  it('a topic the caller raised is kept; only the unraised sentence goes', () =>
    withFlag('on', () => {
      const asked = ['What time do you open on Saturday?'];
      assert.equal(keepRaisedTopics('Hours were answered.', { callerTurns: asked }).text, 'Hours were answered.');
      assert.equal(keepRaisedTopics('Hours were answered.', { intent: 'hours_open' }).text, 'Hours were answered.');
      assert.equal(
        keepRaisedTopics('Services were listed. Price was quoted.', { callerTurns: ['what services do you offer?'] }).text,
        'Services were listed.'
      );
      assert.equal(
        keepRaisedTopics('Price was quoted.', { callerTurns: ['Bei ni ngapi?'] }).text,
        'Price was quoted.'
      );
      const merged = mergeTranscriptReview({
        derived: { primaryIntent: 'general_enquiry', resolution: 'resolved' },
        summary: {},
        toolFlags: { visitRequested: true, visitSaved: true },
        review: { ...FIXTURE.live.ownerReview, done: 'Visit request saved — confirm on desk. Coverage was confirmed.' },
        callerTurns: ['Book carpet cleaning tomorrow in Kilimani.'],
      });
      assert.equal(merged.next, 'Confirm the visit.');
      assert.match(merged.done, /^Visit request saved/);
    }));
});

describe('HD_ceba9d9b3f37 owner review, flag off keeps the live card', () => {
  it('done and next say "Hours were answered."', () =>
    withFlag(null, async () => {
      const { result, system } = await replayReview();
      assert.equal(result.merged.done, 'Hours were answered.');
      assert.equal(result.merged.next, 'Hours were answered.');
      assert.equal(system, REVIEW_SYSTEM);
      assert.equal(isRejectedGoalText("That's all"), false);
    }));
});
