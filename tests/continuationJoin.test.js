'use strict';
// HD_6d4e7863db76 T6/T7 (staging 924878f6): "Ah, like. Do you guys do it?" became two turns and two booking asks.
// Fragment hold goes through decideCallerEvent; the join reuses #939's 1.5 s merge window (graceFinalDisposition).
const test = require('node:test');
const assert = require('node:assert');
const TT = require('../src/speech/turnTaking');

test('fragment "like." while listening is held 600 ms (flag on), not a turn of its own', () => {
  const d = TT.decideCallerEvent({ text: 'like.', speaking: false, turnBusy: false, isFinal: true, fragmentHold: true, lastAgentText: 'Ungependa kujua kuhusu huduma gani?' });
  assert.equal(d.reason, 'fragment_hold'); assert.equal(d.holdMs, 600); assert.equal(d.queue, true); assert.equal(d.runGemini, false);
});
test('fragment hold is off without the flag, and never holds a real one-word answer', () => {
  assert.notEqual(TT.decideCallerEvent({ text: 'like.', isFinal: true }).reason, 'fragment_hold');
  for (const t of ['Alvin.', 'Yes.', 'Sawa.', 'Thika', 'Hapana']) assert.notEqual(TT.decideCallerEvent({ text: t, isFinal: true, fragmentHold: true, lastAgentText: 'May I have your name?' }).reason, 'fragment_hold', t);
  assert.ok(TT.isFillerFragment('Ah,')); assert.ok(TT.isFillerFragment('like.')); assert.ok(!TT.isFillerFragment('Do you guys do it?'));
});
test('continuation within the same 1.5 s window as #939 merges; a later one queues', () => {
  assert.equal(TT.graceFinalDisposition({ msSinceLastCallerTurn: 840 }), 'merge'); // T7 landed 0.84 s after T6 flushed
  assert.equal(TT.graceFinalDisposition({ msSinceLastCallerTurn: 2500, replyStarted: true }), 'queue'); // D3 re-ask stays its own turn
  assert.equal(TT.GRACE_MERGE_MS, 1500);
});
test('flag is exact "on"', () => {
  assert.equal(TT.continuationJoinOn({ VOICE_CONTINUATION_JOIN: 'on' }), true);
  assert.equal(TT.continuationJoinOn({ VOICE_CONTINUATION_JOIN: '1' }), false);
  assert.equal(TT.continuationJoinOn({}), false);
});
