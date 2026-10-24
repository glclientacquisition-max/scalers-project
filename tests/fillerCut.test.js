'use strict';
// Phase A filler cut (Voice review of #927): held caller speech survives the cut; late filler race.
const test = require('node:test');
const assert = require('node:assert');
const { planFillerCut, carryHeldSpeech, FILLER_MIN_MS } = require('../src/speech/fillerCut');
const { createOverlapHold } = require('../src/speech/overlapHold');

test('held caller speech under the cut filler is released at the reply end', () => {
  const hold = createOverlapHold();
  const fillerGen = 7; const replyGen = 9; // cut bumped 7 -> 8, reply speakText took 9
  hold.enqueue('and also the balcony', fillerGen);
  assert.strictEqual(carryHeldSpeech(hold, fillerGen, replyGen), 1);
  // the filler's late cleanup sees a different gen and never drains 7; the reply's finally drains 9
  assert.ok(!hold.drain(fillerGen).text);
  assert.match(hold.drain(replyGen).text, /balcony/);
});

test('without the carry, held speech is stranded (the bug)', () => {
  const hold = createOverlapHold();
  hold.enqueue('and also the balcony', 7);
  assert.ok(!hold.drain(9).text);
});

test('cut waits for the minimum measured from the filler real start, not a stale speakStartedAt', () => {
  const now = 10_000;
  assert.deepStrictEqual(planFillerCut({ fillerStreamId: 'f1', fillerStartedAt: now - 100, now }), { action: 'cut', waitMs: FILLER_MIN_MS - 100 });
  assert.deepStrictEqual(planFillerCut({ fillerStreamId: 'f1', fillerStartedAt: now - 2000, now }), { action: 'cut', waitMs: 0 });
  // filler bound but start unknown: treat as just started (full minimum), never 0 from a stale clock
  assert.strictEqual(planFillerCut({ fillerStreamId: 'f1', fillerStartedAt: 0, now }).waitMs, FILLER_MIN_MS);
});

test('late filler race: timer fired, audio not bound yet -> abort the pending filler', () => {
  assert.deepStrictEqual(planFillerCut({ fillerStreamId: null, fillerPending: true, now: 1 }), { action: 'abort_pending', waitMs: 0 });
  assert.strictEqual(planFillerCut({ fillerStreamId: null, fillerPending: false }).action, 'none');
});

test('carry is a no-op without a cut generation', () => {
  const hold = createOverlapHold();
  hold.enqueue('x', 3);
  assert.strictEqual(carryHeldSpeech(hold, 0, 4), 0);
  assert.match(hold.drain(3).text, /x/);
});

test('barge-in between cut and reply: held speech moves to the live gen, cut gen cleared', () => {
  const hold = createOverlapHold();
  let cutFillerGen = 7; let active = 8; // cut bumped 7 -> 8, reply not started yet
  hold.enqueue('no wait, Saturday', 7);
  // cancelSpeech: carry, then clear so the next speakText does not reassign a stale gen
  if (cutFillerGen) { carryHeldSpeech(hold, cutFillerGen, active); cutFillerGen = 0; }
  assert.strictEqual(cutFillerGen, 0);
  assert.match(hold.drain(active).text, /Saturday/);
  // a later reply (gen 9) carries nothing stale
  active = 9;
  assert.strictEqual(carryHeldSpeech(hold, cutFillerGen, active), 0);
});
