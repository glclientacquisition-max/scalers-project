const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createInitialBurstGate,
  prerollFilter,
  pcmBytesToMs,
  drainInitialBurstEnabled,
  greetingPrerollGuardEnabled,
} = require('../src/speech/greetingPreroll');

describe('initial burst gate', () => {
  it('drains an oversized first frame and passes normal frames', () => {
    let t = 0;
    const gate = createInitialBurstGate({ enabled: true, now: () => t });
    assert.deepEqual(gate.admit(39040), { forward: false, drained: true });
    t = 20;
    assert.deepEqual(gate.admit(640), { forward: true, drained: false });
    // After settling, even a big frame passes (mid-call jitter is real audio).
    assert.equal(gate.admit(4000).forward, true);
    assert.equal(gate.drainedFrames, 1);
    assert.equal(gate.forwardedMs, pcmBytesToMs(640 + 4000));
  });

  it('never drains once the greeting started or after the window', () => {
    let t = 0;
    const a = createInitialBurstGate({ enabled: true, now: () => t });
    assert.equal(a.admit(39040, { greetingStarted: true }).forward, true);
    const b = createInitialBurstGate({ enabled: true, now: () => t });
    t = 2000;
    assert.equal(b.admit(39040).forward, true);
  });

  it('a normal first frame settles the gate (no burst, nothing drained)', () => {
    const gate = createInitialBurstGate({ enabled: true, now: () => 0 });
    assert.equal(gate.admit(640).forward, true);
    assert.equal(gate.admit(39040).forward, true);
    assert.equal(gate.drainedBytes, 0);
  });

  it('off switch keeps every frame', () => {
    const gate = createInitialBurstGate({ enabled: false });
    assert.equal(gate.admit(39040).forward, true);
    assert.equal(drainInitialBurstEnabled({ VOICE_DRAIN_INITIAL_BURST: 'off' }), false);
    assert.equal(drainInitialBurstEnabled({}), true);
  });
});

describe('greeting preroll filter', () => {
  const tokens = [
    { text: 'I', startMs: 720 },
    { text: "'m", startMs: 780 },
    { text: ' not', startMs: 960 },
  ];

  it('marks speech from before the greeting as preroll', () => {
    const r = prerollFilter(tokens, { prerollMs: 2330, greetingPlaying: true, enabled: true });
    assert.equal(r.preroll, true);
    assert.equal(r.text, '');
    assert.equal(r.droppedText, "I'm not");
  });

  it('keeps only the words after the greeting started', () => {
    const r = prerollFilter(
      [...tokens, { text: ' wait', startMs: 2500 }],
      { prerollMs: 2330, greetingPlaying: true, enabled: true }
    );
    assert.equal(r.preroll, false);
    assert.equal(r.text, 'wait');
  });

  it('Infinity means armed with no PCM yet: everything is preroll', () => {
    const r = prerollFilter(tokens, { prerollMs: Infinity, greetingPlaying: true, enabled: true });
    assert.equal(r.preroll, true);
  });

  it('does nothing after the greeting, when off, or without timing (fail open)', () => {
    assert.equal(prerollFilter(tokens, { prerollMs: 2330, greetingPlaying: false, enabled: true }).applied, false);
    assert.equal(prerollFilter(tokens, { prerollMs: 2330, greetingPlaying: true, enabled: false }).applied, false);
    const untimed = prerollFilter([{ text: 'stop' }], { prerollMs: 2330, greetingPlaying: true, enabled: true });
    assert.equal(untimed.applied, false);
    assert.equal(untimed.text, 'stop');
    assert.equal(greetingPrerollGuardEnabled({ VOICE_GREETING_PREROLL_GUARD: '0' }), false);
  });
});
