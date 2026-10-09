// HD_04cf5d5cb1aa: "Wait." cut the greeting, then 14 s of dead air until hang-up.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_DELAY_MS,
  waitRepromptDelayMs,
  pickWaitRepromptLine,
  isLoneWaitWord,
  shouldIgnoreEarlyGreetingWait,
  createWaitBargeReprompt,
} = require('../src/speech/waitBargeReprompt');

function fakeClock() {
  let seq = 0;
  const timers = new Map();
  return {
    setTimeout: (fn, ms) => {
      seq += 1;
      timers.set(seq, { fn, ms });
      return seq;
    },
    clearTimeout: (id) => timers.delete(id),
    pending: () => timers.size,
    lastMs: () => [...timers.values()].pop()?.ms,
    runAll: () => {
      const list = [...timers.entries()];
      timers.clear();
      for (const [, t] of list) t.fn();
    },
  };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('wait reprompt line', () => {
  it('English by default, Kiswahili when the call is sw', () => {
    assert.deepEqual(pickWaitRepromptLine('en'), { text: 'Sure, go ahead.', language: 'en' });
    assert.deepEqual(pickWaitRepromptLine('unknown'), { text: 'Sure, go ahead.', language: 'en' });
    assert.deepEqual(pickWaitRepromptLine(undefined), { text: 'Sure, go ahead.', language: 'en' });
    assert.deepEqual(pickWaitRepromptLine('sw'), { text: 'Sawa, endelea.', language: 'sw' });
  });
  it('delay defaults to 4.5 s and clamps the env knob', () => {
    assert.equal(DEFAULT_DELAY_MS, 4500);
    assert.equal(waitRepromptDelayMs({}), 4500);
    assert.equal(waitRepromptDelayMs({ VOICE_WAIT_REPROMPT_MS: '3000' }), 3000);
    assert.equal(waitRepromptDelayMs({ VOICE_WAIT_REPROMPT_MS: '50' }), 4500);
  });
});

describe('createWaitBargeReprompt', () => {
  it('arms after a wait barge with no caller turn yet, and fires once', async () => {
    const clock = fakeClock();
    let spoken = 0;
    const r = createWaitBargeReprompt({ ...clock, speak: () => { spoken += 1; } });
    assert.equal(r.arm(), true);
    assert.equal(r.armed(), true);
    assert.equal(clock.lastMs(), 4500);
    clock.runAll();
    await flush();
    assert.equal(spoken, 1);
    assert.equal(r.fired(), true);
    // Once only: a second wait barge does not re-arm.
    assert.equal(r.arm(), false);
    assert.equal(clock.pending(), 0);
  });

  it('cancel (caller final / new turn) stops it without using up the once', async () => {
    const clock = fakeClock();
    let spoken = 0;
    const r = createWaitBargeReprompt({ ...clock, speak: () => { spoken += 1; } });
    r.arm();
    assert.equal(r.cancel(), true);
    assert.equal(r.armed(), false);
    clock.runAll();
    await flush();
    assert.equal(spoken, 0);
    assert.equal(r.fired(), false);
    assert.equal(r.arm(), true);
  });

  it('re-arm restarts one timer, never stacks two', () => {
    const clock = fakeClock();
    const r = createWaitBargeReprompt({ ...clock });
    r.arm();
    r.arm();
    r.arm();
    assert.equal(clock.pending(), 1);
  });

  it('close (call end / socket close) cancels and blocks later arms', async () => {
    const clock = fakeClock();
    let spoken = 0;
    const r = createWaitBargeReprompt({ ...clock, speak: () => { spoken += 1; } });
    r.arm();
    r.close();
    assert.equal(clock.pending(), 0);
    assert.equal(r.arm(), false);
    await flush();
    assert.equal(spoken, 0);
  });

  it('does not speak when canFire is false (agent talking, turn busy, call over)', async () => {
    const clock = fakeClock();
    let spoken = 0;
    const r = createWaitBargeReprompt({ ...clock, canFire: () => false, speak: () => { spoken += 1; } });
    r.arm();
    clock.runAll();
    await flush();
    assert.equal(spoken, 0);
    assert.equal(r.fired(), false);
  });
});

describe('early greeting wait', () => {
  it('lone wait words only', () => {
    for (const t of ['Wait.', 'Stop!', 'subiri', 'Acha.', 'simama']) assert.equal(isLoneWaitWord(t), true, t);
    for (const t of ['Wait a second', 'wait, I need a cleaner', 'Hold on', 'no wait', 'Hello', '']) {
      assert.equal(isLoneWaitWord(t), false, t);
    }
  });

  it('ignored in the first 1.5 s of greeting audio, honoured after', () => {
    const at = 1_000_000;
    const base = { greetingPlaying: true, greetingAudioAt: at, windowMs: 1500 };
    assert.equal(shouldIgnoreEarlyGreetingWait({ ...base, text: 'Wait.', now: at + 400 }), true);
    assert.equal(shouldIgnoreEarlyGreetingWait({ ...base, text: 'Wait.', now: at + 1499 }), true);
    assert.equal(shouldIgnoreEarlyGreetingWait({ ...base, text: 'Wait.', now: at + 1500 }), false);
    // HD_04cf5d5cb1aa: "Wait." ~2 s into greeting audio still barges (and the reprompt covers it).
    assert.equal(shouldIgnoreEarlyGreetingWait({ ...base, text: 'Wait.', now: at + 2000 }), false);
    // Before any greeting audio the caller cannot be stopping it.
    assert.equal(shouldIgnoreEarlyGreetingWait({ ...base, greetingAudioAt: null, text: 'Wait.', now: at }), true);
  });

  it('never ignores more words, a reply in progress, or a zero window', () => {
    const at = 1_000_000;
    const base = { greetingPlaying: true, greetingAudioAt: at, now: at + 300, windowMs: 1500 };
    assert.equal(shouldIgnoreEarlyGreetingWait({ ...base, text: 'Wait, I need a deep clean' }), false);
    assert.equal(shouldIgnoreEarlyGreetingWait({ ...base, text: 'Wait a second' }), false);
    assert.equal(shouldIgnoreEarlyGreetingWait({ ...base, greetingPlaying: false, text: 'Wait.' }), false);
    assert.equal(shouldIgnoreEarlyGreetingWait({ ...base, windowMs: 0, text: 'Wait.' }), false);
  });
});

describe('server wiring (HD_04cf5d5cb1aa)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  it('arms on the interrupt_wait barge and cancels on turn, end and close', () => {
    assert.match(src, /if \(decision\.reason === 'interrupt_wait'\) waitReprompt\.arm\(\);/);
    assert.match(src, /idleNudge\.clear\(\);\n\s+waitReprompt\.cancel\(\);/); // runCallerTurn
    assert.match(src, /callEnding = true;\n\s+waitReprompt\.close\(\);/);
    assert.match(src, /idleNudge\.close\(\);\n\s+waitReprompt\.close\(\);\n\s+unfinishedHold\.close\(\);/); // ws close
  });
  it('hands over to the idle nudge and traces barge + reprompt', () => {
    assert.match(src, /idleNudge\.arm\(\{ skip: false \}\)/);
    assert.match(src, /stage: 'reprompt',\n\s+path: 'wait_barge'/);
    assert.match(src, /stage: 'barge',\n\s+path: 'call'/);
    assert.match(src, /reason: 'early_greeting_wait'/);
  });
});
