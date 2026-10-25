'use strict';
// voice/grace-queue-hardening: #936 grace-window queue — tenant gate, strict flags, merge-not-double-reply, trace reason.
const test = require('node:test');
const assert = require('node:assert');
const TT = require('../src/speech/turnTaking');
const ML = require('../src/conversation/v2/modelLead');

const DND = 'df4ad9d8-28ff-4810-b1e6-94f5495472b0';
const LEAD_ENV = { BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on', BRAIN_MODEL_LEAD: 'on' };
const gate = (env, tenantId) => TT.graceQueueOn(env) && ML.leadOn({ env, tenantId });

test('graceQueue env half: exact "on" only (no lowercasing, unset = off)', () => {
  assert.equal(TT.graceQueueOn({ VOICE_GRACE_QUEUE: 'on' }), true);
  for (const v of [undefined, '', 'ON', ' on', 'On', 'true', '1', 'off']) assert.equal(TT.graceQueueOn({ VOICE_GRACE_QUEUE: v }), false, String(v));
  assert.equal(TT.graceQueueOn({ BRAIN_MODEL_LEAD: 'on' }), false); // model lead alone no longer turns the queue on
});

test('graceQueue tenant gate: on for DnD with model lead, off for other tenants / no tenant', () => {
  const env = { ...LEAD_ENV, VOICE_GRACE_QUEUE: 'on' };
  assert.equal(gate(env, DND), true);
  assert.equal(gate(env, '00000000-0000-0000-0000-000000000000'), false);
  assert.equal(gate(env, null), false);
  assert.equal(gate({ ...LEAD_ENV }, DND), false);
});

test('decideCallerEvent ignores the global env for the grace queue (uses opts.graceQueue only)', () => {
  const prev = { ...process.env };
  try {
    process.env.VOICE_GRACE_QUEUE = 'on'; process.env.BRAIN_MODEL_LEAD = 'on';
    const at = { phase: 'speaking', speakStartedAt: 1000, now: 1100, isFinal: true, text: 'Rongai or Kileleshwa?' };
    assert.equal(TT.decideCallerEvent(at).reason, 'grace');
    assert.equal(TT.decideCallerEvent({ ...at, graceQueue: true }).reason, 'grace_queued');
  } finally { for (const k of ['VOICE_GRACE_QUEUE', 'BRAIN_MODEL_LEAD']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
});

test('graceFinalDisposition: merge when busy before the reply speaks, or < 1.5 s after the caller turn; else queue', () => {
  assert.equal(TT.graceFinalDisposition({ turnBusy: true, replyStarted: false, msSinceLastCallerTurn: 5000 }), 'merge');
  assert.equal(TT.graceFinalDisposition({ turnBusy: true, replyStarted: true, msSinceLastCallerTurn: 1499 }), 'merge');
  assert.equal(TT.graceFinalDisposition({ turnBusy: true, replyStarted: true, msSinceLastCallerTurn: 1500 }), 'queue');
  assert.equal(TT.graceFinalDisposition({ turnBusy: false, replyStarted: true, msSinceLastCallerTurn: 4000 }), 'queue');
  assert.equal(TT.graceFinalDisposition({}), 'queue');
});

// Sim of the server.js final path (decision -> merge/queue -> replies). Mirrors server.js; not a live ws test.
function simCall(events, { graceQueue = true } = {}) {
  const s = { now: 0, turnBusy: false, speaking: false, filler: false, speakStartedAt: 0, lastCallerTurnAt: 0, replies: [], queued: [], inFlight: null };
  const startTurn = (text) => { s.turnBusy = true; s.lastCallerTurnAt = s.now; s.inFlight = { text, aborted: false }; s.speaking = true; s.filler = true; s.speakStartedAt = s.now; };
  for (const ev of events) {
    s.now = ev.at;
    if (ev.type === 'turn') startTurn(ev.text);
    if (ev.type === 'final') {
      const d = TT.decideCallerEvent({ text: ev.text, phase: s.speaking ? 'speaking' : (s.turnBusy ? 'thinking' : 'idle'), speakStartedAt: s.speakStartedAt, now: s.now, isFinal: true, graceQueue });
      if (d.reason === 'grace_queued') {
        const disp = TT.graceFinalDisposition({ turnBusy: s.turnBusy, replyStarted: s.speaking && !s.filler, msSinceLastCallerTurn: s.now - s.lastCallerTurnAt });
        if (disp === 'merge') { const prior = s.inFlight; if (prior) prior.aborted = true; startTurn(ev.text); s.inFlight.merged = true; continue; }
        s.queued.push(ev.text); continue;
      }
      if (d.interrupt) { if (s.inFlight) s.inFlight.aborted = true; startTurn(ev.text); }
    }
    if (ev.type === 'reply_done') { if (s.inFlight && !s.inFlight.aborted) s.replies.push(s.inFlight.text); s.inFlight = null; s.turnBusy = false; s.speaking = false; for (const q of s.queued.splice(0)) s.replies.push(q); }
  }
  return s;
}

test('SIM: barge-in, then a final ~150 ms into the filler -> exactly one reply', () => {
  const s = simCall([
    { type: 'turn', at: 0, text: 'I need a cleaner' },
    { type: 'final', at: 1500, text: 'No wait, actually I need two cleaners' }, // barge after grace
    { type: 'final', at: 1650, text: 'for Kilimani on Saturday' }, // lands ~150 ms into the new filler (grace window)
    { type: 'reply_done', at: 3000 },
  ]);
  assert.equal(s.replies.length, 1, JSON.stringify(s.replies));
  assert.equal(s.queued.length, 0);
});

test('SIM: grace queue off -> the grace final is ignored (pre-#936 behaviour), still one reply', () => {
  const s = simCall([
    { type: 'turn', at: 0, text: 'I need a cleaner' },
    { type: 'final', at: 1500, text: 'No wait, actually I need two cleaners' },
    { type: 'final', at: 1650, text: 'for Kilimani on Saturday' },
    { type: 'reply_done', at: 3000 },
  ], { graceQueue: false });
  assert.equal(s.replies.length, 1);
});
