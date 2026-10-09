const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  planHoldTiming,
  toolStillRunningAfter,
  deferredToolHoldEnabled,
  TOOL_HOLD_SLOW_MS,
  HOLD_AFTER_ACK_MS,
} = require('../src/speech/toolHold');

describe('tool hold after a thinking-ack', () => {
  it('no recent ack: hold now (unchanged)', () => {
    assert.deepEqual(planHoldTiming({ kind: 'hold', ackAtMs: 0, nowMs: 5000 }), { mode: 'now', delayMs: 0 });
    assert.equal(
      planHoldTiming({ kind: 'hold', ackAtMs: 1000, nowMs: 1000 + HOLD_AFTER_ACK_MS }).mode,
      'now'
    );
  });

  it('recent ack: defer by the slow-tool threshold instead of skipping', () => {
    const plan = planHoldTiming({ kind: 'hold', ackAtMs: 1000, nowMs: 2757, deferred: true });
    assert.equal(plan.mode, 'defer');
    assert.equal(plan.delayMs, TOOL_HOLD_SLOW_MS);
    assert.equal(TOOL_HOLD_SLOW_MS, 700);
  });

  it('flag off keeps the HD_c98820 skip', () => {
    assert.equal(planHoldTiming({ kind: 'hold', ackAtMs: 1000, nowMs: 2757, deferred: false }).mode, 'skip');
    assert.equal(deferredToolHoldEnabled({ VOICE_TOOL_HOLD_DEFERRED: 'off' }), false);
    assert.equal(deferredToolHoldEnabled({}), true);
  });

  it('a fast tool finishes first: no hold (no stacked acks)', async () => {
    const fast = new Promise((r) => setTimeout(r, 10));
    assert.equal(await toolStillRunningAfter(fast, 80), false);
  });

  it('a slow tool is still running: hold plays', async () => {
    const slow = new Promise((r) => setTimeout(r, 150));
    assert.equal(await toolStillRunningAfter(slow, 40), true);
  });

  it('a failed tool counts as finished', async () => {
    const failed = Promise.reject(new Error('x'));
    failed.catch(() => {});
    assert.equal(await toolStillRunningAfter(failed, 50), false);
  });
});
