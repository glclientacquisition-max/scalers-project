'use strict';

// E) HD_1677e57f73f9: a rejected create's re-ask ("Saa ngapi leo?") that the
// caller talked over is kept pending by Voice, not lost: it is not counted as
// asked, not replayed stale from the owed-outcome queue, and Brain then
// re-asks, or retries when the caller's words filled the slot.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const TENANT = require('./fixtures/tenants/done-and-dusted-staging.json');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { extractConversationEntities } = require('../src/conversation/entityExtraction');
const fixes = require('../src/conversation/callFixesD199');
const { queueToolOutcome, takeToolOutcome } = require('../src/conversation/toolOutcomeQueue');
const {
  lineHasReask,
  splitOwedOutcome,
  noteReaskResult,
  reaskUnheard,
  reaskSnapshot,
  keepUnheardReask,
} = require('../src/speech/pendingReask');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const NOW = new Date('2026-10-09T08:00:00Z');
const PLAN = { serviceName: 'Kitchen and Wardrobe Cleaning', name: 'Chris', whenText: 'today', landmark: 'Riverside, Westlands' };

function withFlag(fn) {
  const prev = process.env.BRAIN_CALL_FIXES_D199;
  process.env.BRAIN_CALL_FIXES_D199 = 'on';
  try {
    return fn();
  } finally {
    if (prev == null) delete process.env.BRAIN_CALL_FIXES_D199;
    else process.env.BRAIN_CALL_FIXES_D199 = prev;
  }
}

const profile = profileFromSnapshot(TENANT);

function observe(state, text, lastAgentText) {
  const entities = extractConversationEntities(text, { profile, intent: 'booking', state });
  return observeCallerTurn(state, {
    text,
    entities,
    lastAgentText,
    detectedLanguage: 'sw',
    resolvedLanguage: 'sw',
    profile,
    now: NOW,
  });
}

/** t30: the guard rejected the create; the confirmation is the re-ask. */
function heldCreate() {
  let state = createBrainState(profile);
  state = observe(state, 'Nataka usafishaji wa jikoni leo, hapa Riverside, Westlands.', 'Tukusaidie vipi?');
  fixes.noteRejectedCreate(state, { slot: 'when', whenText: 'leo', appointment: PLAN, now: NOW });
  const reask = fixes.reaskSlotLine(state, 'sw');
  return { state, reask: reask.line, confirmation: `Sawa kabisa. ${reask.line}` };
}

/** Voice's caller turn: snapshot, Brain observe, keep an unheard re-ask. */
function voiceTurn(state, text, lastAgentText) {
  const before = reaskSnapshot(state);
  const next = observe(state, text, lastAgentText);
  keepUnheardReask(before, next);
  return next;
}

describe('E) HD_1677e57f73f9: a barged re-ask stays pending', () => {
  it('the held create re-asks "Saa ngapi leo?"', () =>
    withFlag(() => {
      const { reask, confirmation } = heldCreate();
      assert.equal(reask, 'Saa ngapi leo?');
      assert.equal(confirmation, 'Sawa kabisa. Saa ngapi leo?');
    }));

  it('before: Brain counted the discarded re-ask from lastAgentText and saved a callback instead', () =>
    withFlag(() => {
      const { state, confirmation } = heldCreate();
      queueToolOutcome(state, confirmation); // the barged reply
      const next = observe(state, 'Riverside, Westlands.', confirmation);
      assert.equal(next.conversation.rejectedCreate.reasks, 1);
      assert.equal(fixes.planRejectedCreate(next, { language: 'sw' }).kind, 'callback');
    }));

  it('after: the unheard re-ask is not counted; Brain re-asks on the next turn', () =>
    withFlag(() => {
      const { state, confirmation, reask } = heldCreate();
      queueToolOutcome(state, confirmation);
      assert.equal(reaskUnheard(state), true);
      const next = voiceTurn(state, 'Riverside, Westlands.', confirmation);
      assert.equal(next.conversation.rejectedCreate.reasks, 0);
      assert.equal(next.conversation.rejectedCreate.reaskUnheard, true);
      const plan = fixes.planRejectedCreate(next, { language: 'sw' });
      assert.equal(plan.kind, 'reask');
      assert.equal(plan.line, reask);
    }));

  it('the owed outcome keeps only the non-question part; the re-ask is not replayed stale', () =>
    withFlag(() => {
      const { state, confirmation } = heldCreate();
      queueToolOutcome(state, confirmation);
      const split = splitOwedOutcome(takeToolOutcome(state), state);
      assert.deepEqual(split, { outcome: 'Sawa kabisa.', reask: 'Saa ngapi leo?' });
      // Nothing held: an owed booking outcome is untouched.
      const free = createBrainState(profile);
      assert.deepEqual(splitOwedOutcome('Nimehifadhi ombi lako. Kuna kingine?', free), {
        outcome: 'Nimehifadhi ombi lako. Kuna kingine?',
        reask: '',
      });
    }));

  it('the caller\'s barge words filled the slot: retry, no stale re-ask', () =>
    withFlag(() => {
      const { state, confirmation } = heldCreate();
      queueToolOutcome(state, confirmation);
      const next = voiceTurn(state, 'Saa nane mchana.', confirmation);
      assert.equal(fixes.planRejectedCreate(next, { language: 'sw' }).kind, 'retry');
    }));

  it('a re-ask barged again stays pending; a heard one counts and then a callback is saved', () =>
    withFlag(() => {
      const { state, confirmation } = heldCreate();
      queueToolOutcome(state, confirmation);
      let next = voiceTurn(state, 'Riverside, Westlands.', confirmation);
      takeToolOutcome(next);
      let plan = fixes.planRejectedCreate(next, { language: 'sw' });
      fixes.markReaskSpoken(next);
      // Barged again.
      assert.equal(noteReaskResult(next, plan.line, { ok: false, barged: true }), true);
      next = voiceTurn(next, 'Eeh, ngoja.', plan.line);
      assert.equal(next.conversation.rejectedCreate.reasks, 0);
      plan = fixes.planRejectedCreate(next, { language: 'sw' });
      assert.equal(plan.kind, 'reask');
      // Heard this time.
      assert.equal(noteReaskResult(next, plan.line, { ok: true }), false);
      next = voiceTurn(next, 'Sijui bado.', plan.line);
      assert.equal(next.conversation.rejectedCreate.reasks, 1);
      assert.equal(fixes.planRejectedCreate(next, { language: 'sw' }).kind, 'callback');
    }));

  it('lineHasReask only while a create is held, only for the slot question', () =>
    withFlag(() => {
      const { state } = heldCreate();
      assert.equal(lineHasReask('Saa ngapi leo?', state), true);
      assert.equal(lineHasReask('Saa nane usiku au saa nane mchana?', state), true);
      assert.equal(lineHasReask('Tuje wapi?', state), true);
      assert.equal(lineHasReask('Sawa kabisa.', state), false);
      assert.equal(lineHasReask('Saa ngapi leo?', createBrainState(profile)), false);
    }));

  it('server wiring: snapshot before observe, keep after; owed split; re-ask speak result noted', () => {
    assert.match(SERVER, /const reaskBefore = reaskSnapshot\(previousBrainState\);\s*let brainState = observeCallerTurn\(/);
    assert.match(SERVER, /if \(keepUnheardReask\(reaskBefore, brainState\)\)/);
    assert.match(SERVER, /const owedOutcome = takeToolOutcome\(brainState\);\s*const owedSplit = splitOwedOutcome\(owedOutcome, brainState\);/);
    assert.match(SERVER, /const reaskSpoken = noteSpokenLine\(rescue\.line, 'reask_slot', await speakText\(rescue\.line\)\);\s*\/\/[^\n]*\n\s*noteReaskResult\(brainState, rescue\.line, reaskSpoken\);/);
  });
});
