// Unfinished-turn hold (ported from #609 60e3b0dc / 4e6abe8f).
// HD_72ab69cbab2b T1: "Nilikuwa nauliza," got the early-return name ask.
// Run: node --test tests/unfinishedHold.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createUnfinishedHold, unfinishedHoldMs } = require('../src/speech/unfinishedHold');
const { unfinishedTurnHold } = require('../src/conversation/unfinishedTurn');
const { planCallerModelTurn } = require('../src/conversation/turnPolicy');
const { noteCallTerminal, callTerminalSince, forgetCallTerminal } = require('../src/speech/callLifecycle');
const { profileFromSnapshot } = require('../src/conversation/promptFacts');
const DUSTED = profileFromSnapshot(require('./fixtures/tenants/done-and-dusted-staging.json'));

describe('unfinishedHoldMs', () => {
  it('defaults to 1600 and clamps 1200-2500', () => {
    assert.equal(unfinishedHoldMs({}), 1600);
    assert.equal(unfinishedHoldMs({ VOICE_UNFINISHED_HOLD_MS: '800' }), 1200);
    assert.equal(unfinishedHoldMs({ VOICE_UNFINISHED_HOLD_MS: '9000' }), 2500);
  });
});

describe('HD_72ab T1: Nilikuwa nauliza is held, not the name ask', () => {
  it('holds the fragment and never the whole catalogue or coverage ask', () => {
    assert.equal(unfinishedTurnHold({}, { text: 'Nilikuwa nauliza,', profile: DUSTED }).hold, 'unfinished');
    assert.equal(unfinishedTurnHold({}, { text: 'And what are the services you offer?', profile: DUSTED }), null);
    assert.equal(unfinishedTurnHold({}, { text: 'What about Kitengela?', profile: DUSTED }), null);
    assert.equal(
      unfinishedTurnHold({}, { text: 'Nilikuwa nauliza,', profile: DUSTED, holdTimedOut: true }),
      null
    );
  });

  it('the early-return name ask respects the hold and the timeout', () => {
    const state = {
      caller: { fileNameAsked: 'Alvin', nameConfirmed: false, fileNameAskSpoken: false },
      conversation: { answersReceived: ['Nilikuwa nauliza,'] },
    };
    assert.equal(planCallerModelTurn(state, {}).hold, 'unfinished');
    const timed = planCallerModelTurn(state, { unfinishedDecided: true, holdTimedOut: true });
    assert.equal(timed.runModel, true);
    assert.equal(timed.nameAskDeferred, true);
    assert.equal(timed.line, '');
  });
});

describe('createUnfinishedHold', () => {
  it('answers on timeout and merges new finals', async () => {
    let fired = null;
    const hold = createUnfinishedHold({
      delayMs: 40,
      maxPostponeMs: 40,
      onTimeout: (text) => {
        fired = text;
      },
    });
    hold.hold('Nilikuwa nauliza,');
    assert.equal(hold.take(' juu.'), 'Nilikuwa nauliza, juu.');
    assert.equal(hold.pending(), false);
    hold.hold('Nilikuwa nauliza,');
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(fired, 'Nilikuwa nauliza,');
  });

  it('a short word postpones once, never past the cap', async () => {
    let now = 1_000_000;
    let fired = null;
    const timers = [];
    const hold = createUnfinishedHold({
      delayMs: 50,
      maxPostponeMs: 60,
      now: () => now,
      setTimeout: (fn, ms) => {
        const id = { fireAt: now + ms, fn };
        timers.push(id);
        return id;
      },
      clearTimeout: (id) => {
        const i = timers.indexOf(id);
        if (i >= 0) timers.splice(i, 1);
      },
      onTimeout: (text) => {
        fired = text;
      },
    });
    hold.hold('Nilikuwa nauliza,');
    assert.equal(hold.postpone('For'), true);
    assert.equal(hold.postpone('For'), false, 'same interim does not postpone again');
    now += 120;
    // Past the deadline: postpone refuses.
    assert.equal(hold.postpone('a 3'), false);
    // Drain the pending timer.
    const due = timers.filter((t) => t.fireAt <= now);
    for (const t of due) t.fn();
    assert.equal(fired, 'Nilikuwa nauliza,');
  });
});

describe('idle nudge never fires after a terminal webhook', () => {
  it('callTerminalSince only counts ends after the socket opened', () => {
    forgetCallTerminal('HD_72ab');
    noteCallTerminal('HD_72ab', { source: 'voice/events', status: 'complete', at: 5_000 });
    assert.ok(callTerminalSince('HD_72ab', 4_000));
    assert.equal(callTerminalSince('HD_72ab', 6_000), null);
    forgetCallTerminal('HD_72ab');
  });
});
