'use strict';

// BRAIN_CALL_FIXES_D199 (visit read, last one only), replay HD_7522f9a7ba06.
// "Mara ya mwisho" / "the last one" reads only the newest open row. A general
// "what do I have open" reads newest first, two rows and a count (more_open),
// with "more" paging. The past-dated count (past_open) is read only on demand.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const F = require('./fixtures/brain-calls/HD_7522f9a7ba06.call.json');
const T = require('./fixtures/tenants/done-and-dusted-staging.json');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const { buildCallerMemoryCard } = require('../src/conversation/callerMemory');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');
const fixes = require('../src/conversation/callFixesD199');
const { planVisitReadTurn } = require('../src/conversation/openLineSpeech');

const NOW = new Date(F.startedAt);
const NEWEST_SW = 'Una ziara ya Carpet Cleaning (per room), kesho, 1 PM, Kitengela, Grace Apartments.';

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

function replay(upto) {
  const card = buildCallerMemoryCard({
    contact: F.callerFile.contact,
    openRequests: F.callerFile.requests,
    openAppointments: F.callerFile.openAppointments,
    now: NOW,
  });
  const profile = profileFromSnapshot(T);
  profile.callerMemory = card;
  profile.openAppointments = F.callerFile.openAppointments;
  let state = createBrainState(profile);
  let last = 'Good evening';
  const reads = {};
  for (const t of F.turns.filter((turn) => turn.turn <= upto)) {
    const entities = extractConversationEntities(t.caller, {
      profile,
      intent: state.intent && state.intent !== 'unknown' ? state.intent : 'general_enquiry',
      state,
    });
    state = observeCallerTurn(state, {
      text: t.caller,
      entities,
      lastAgentText: last,
      detectedLanguage: t.language,
      resolvedLanguage: t.language,
      profile,
      now: NOW,
    });
    reads[t.turn] = state.conversation.fileReadSentence || '';
    last = t.spoken || last;
  }
  return { state, profile, reads };
}

function say(state, profile, text) {
  return observeCallerTurn(state, { text, profile, detectedLanguage: 'en', resolvedLanguage: 'en', now: NOW });
}

describe('visit read, last one only (BRAIN_CALL_FIXES_D199=on)', () => {
  it('HD_7522 t4 "mara ya mwisho ... niliitisha" reads only the newest item', () =>
    withFlag('on', () => {
      const { state, reads } = replay(4);
      assert.equal(state.returning.openRows.length, 31);
      assert.equal(state.returning.pastOpenCount, 19);
      assert.equal(reads[4], NEWEST_SW);
      assert.doesNotMatch(reads[4], /maombi mengine|zilizopita|Mansion/);
      assert.equal(state.conversation.lastFileRowId, 'b140110d-9d62-422e-ae78-2b85cab837c6');
    }));

  it('detects last-one and past-dated asks', () => {
    for (const t of ['mara ya mwisho niliitisha', 'what was my last booking?', 'the latest one', 'niliitisha carpet']) {
      assert.equal(fixes.looksLikeLastOneAsk(t), true, t);
    }
    for (const t of ['what do I have open?', 'nataka kubook']) assert.equal(fixes.looksLikeLastOneAsk(t), false, t);
    for (const t of ['and the past-dated ones?', 'zile zilizopita']) assert.equal(fixes.looksLikePastDatedAsk(t), true, t);
    assert.equal(fixes.looksLikePastDatedAsk('what do I have open?'), false);
    assert.equal(fixes.looksLikeReadMoreAsk('Any more?'), true);
    assert.equal(fixes.looksLikeReadMoreAsk('I want to book a carpet cleaning for more rooms next week please now'), false);
  });

  it('general read: newest first, two rows and more_open; "more" pages; past_open on demand', () =>
    withFlag('on', () => {
      const { state, profile } = replay(3);
      const open = say(state, profile, 'What do I have open?');
      assert.equal(
        open.conversation.fileReadSentence,
        'You have a Carpet Cleaning (per room) visit request, tomorrow, 1 PM, Kitengela, Grace Apartments. ' +
          'You have an enquiry for Mansion Cleaning Custom Quote. There are 10 more open requests on file.'
      );
      const more = say(open, profile, 'Any more?');
      assert.match(more.conversation.fileReadSentence, /There are 8 more open requests on file\.$/);
      assert.doesNotMatch(more.conversation.fileReadSentence, /Mansion|Grace Apartments|past-dated/);
      const past = say(more, profile, 'And the past-dated ones?');
      assert.equal(past.conversation.fileReadSentence, 'There are 19 past-dated requests the team still has to confirm.');
    }));

  it('pagedFileRead ends the pages with "Nothing further back."', () =>
    withFlag('on', () => {
      const rows = [
        { id: 'a', kind: 'request', type: 'enquiry', job: 'Old', createdAt: '2026-10-01T00:00:00Z', past: false },
        { id: 'b', kind: 'request', type: 'enquiry', job: 'New', createdAt: '2026-10-05T00:00:00Z', past: false },
        { id: 'c', kind: 'request', type: 'enquiry', job: 'Past', createdAt: '2026-09-01T00:00:00Z', past: true },
      ];
      const state = { returning: { openRows: rows }, conversation: {} };
      const first = fixes.pagedFileRead(state, 'en', { text: 'what do I have?', now: NOW });
      assert.equal(first.line, 'You have an enquiry for New. You have an enquiry for Old.');
      assert.deepEqual(first.rowIds, ['b', 'a']);
      const end = fixes.pagedFileRead(state, 'en', { text: 'more', more: true, now: NOW });
      assert.equal(end.line, 'Nothing further back.');
      const last = fixes.pagedFileRead(state, 'en', { text: 'my last one', now: NOW });
      assert.equal(last.kind, 'last_one');
      assert.equal(last.line, 'You have an enquiry for New.');
    }));

  it('the D199 lookup plan pages too', () =>
    withFlag('on', () => {
      const { state } = replay(3);
      const fileState = JSON.parse(JSON.stringify(state));
      const plan = planVisitReadTurn({ nameConfirmed: true, callerText: 'What are my bookings?', language: 'en', fileState, now: NOW });
      assert.equal(plan.runModel, false);
      assert.deepEqual(plan.lines.map((l) => l.template), ['visit_open', 'request_open', 'more_open']);
      const next = planVisitReadTurn({ nameConfirmed: true, callerText: 'Any more?', language: 'en', fileState, now: NOW });
      assert.match(next.line, /There are 8 more open requests on file\.$/);
    }));
});

describe('visit read, flag off keeps the live behaviour', () => {
  it('HD_7522 t4 is unchanged and there are no open rows', () =>
    withFlag(null, () => {
      const { state, reads } = replay(4);
      assert.equal(state.returning.openRows, undefined);
      assert.notEqual(reads[4], NEWEST_SW);
      assert.equal(reads[4], 'Hakuna kilicho wazi.');
    }));
});
