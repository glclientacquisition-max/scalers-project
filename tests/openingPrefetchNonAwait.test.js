'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadOpeningForPrefetch, createCallPrefetch } = require('../src/speech/callPrefetch');

describe('opening prefetch D1 — settle without awaiting greeting TTS', () => {
  it('resolves with profile while slow warm still runs (firstPcm gate removed)', async () => {
    let warmStarted = false;
    let warmDone = false;
    const profile = { id: 't-dnd', businessName: 'Done and Dusted' };

    const t0 = Date.now();
    const settled = await loadOpeningForPrefetch({
      loadProfile: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return profile;
      },
      warmGreeting: async () => {
        warmStarted = true;
        await new Promise((r) => setTimeout(r, 5000));
        warmDone = true;
      },
    });
    const settleMs = Date.now() - t0;

    assert.equal(settled.profile, profile);
    assert.ok(settleMs < 3000, `prefetch settled in ${settleMs}ms; must not await 5s warm`);
    assert.ok(settleMs < 500, `profile was ~50ms; settle was ${settleMs}ms`);
    // Warm is fire-and-forget: started, not finished, when we settle.
    assert.equal(warmDone, false);
    // Give the void task a tick to start.
    await new Promise((r) => setImmediate(r));
    assert.equal(warmStarted, true);
  });

  it('callPrefetch.take sees settled entry before slow warm finishes', async () => {
    const store = createCallPrefetch();
    let warmDone = false;
    const profile = { id: 't-jirani', businessName: 'Jirani' };

    store.start('HD_d1_sim', () =>
      loadOpeningForPrefetch({
        loadProfile: async () => {
          await new Promise((r) => setTimeout(r, 30));
          return profile;
        },
        warmGreeting: async () => {
          await new Promise((r) => setTimeout(r, 5000));
          warmDone = true;
        },
      })
    );

    // Simulate /ws/media opening while warm is still running.
    await new Promise((r) => setTimeout(r, 80));
    const pre = store.take('HD_d1_sim');
    assert.ok(pre, 'prefetch entry present');
    const t0 = Date.now();
    const got = await pre.promise;
    const waitMs = Date.now() - t0;
    assert.equal(got.profile.id, 't-jirani');
    assert.ok(waitMs < 3000, `media awaited ${waitMs}ms; must not wait on 5s warm`);
    assert.equal(warmDone, false);
  });

  it('omitting warmGreeting still returns profile', async () => {
    const got = await loadOpeningForPrefetch({
      loadProfile: async () => ({ id: 't' }),
    });
    assert.equal(got.profile.id, 't');
  });
});
