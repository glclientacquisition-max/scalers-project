delete process.env.FACT_HASH_MODE;
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  silentCallerPromptEnabled,
  silentCallerPromptDelayMs,
  pickSilentCallerPromptLine,
  createSilentCallerPrompt,
} = require('../src/speech/silentCallerPrompt');
const {
  mediaStallWatchdogEnabled,
  mediaStallGapMs,
  createMediaStallWatchdog,
} = require('../src/speech/mediaStallWatchdog');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('silentCallerPromptEnabled', () => {
  it('defaults off', () => {
    assert.equal(silentCallerPromptEnabled({}), false);
    assert.equal(silentCallerPromptEnabled({ VOICE_SILENT_CALLER_PROMPT: 'on' }), true);
  });

  it('clamps delay', () => {
    assert.equal(silentCallerPromptDelayMs({}), 5000);
    assert.equal(silentCallerPromptDelayMs({ VOICE_SILENT_CALLER_PROMPT_MS: '4000' }), 4000);
    assert.equal(silentCallerPromptDelayMs({ VOICE_SILENT_CALLER_PROMPT_MS: '100' }), 5000);
  });
});

describe('pickSilentCallerPromptLine', () => {
  it('matches language', () => {
    assert.equal(pickSilentCallerPromptLine({ language: 'en' }), 'Hello, can you hear me?');
    assert.equal(pickSilentCallerPromptLine({ language: 'sw' }), 'Halo, unanisikia?');
  });
});

describe('createSilentCallerPrompt (HD_31d8 / HD_1af0)', () => {
  it('fires once after the delay even before any caller utterance', async () => {
    const spoken = [];
    const prompt = createSilentCallerPrompt({
      delayMs: 20,
      canFire: () => true,
      speak: () => spoken.push('prompt'),
    });
    assert.equal(prompt.arm(), true);
    await wait(40);
    assert.equal(spoken.length, 1);
    assert.equal(prompt.arm(), false);
  });

  it('clears when the caller speaks', async () => {
    const spoken = [];
    const prompt = createSilentCallerPrompt({
      delayMs: 40,
      canFire: () => true,
      speak: () => spoken.push('prompt'),
    });
    prompt.arm();
    prompt.clear();
    await wait(60);
    assert.equal(spoken.length, 0);
  });
});

describe('mediaStallWatchdog (HD_226f / HD_9ed7)', () => {
  it('defaults off', () => {
    assert.equal(mediaStallWatchdogEnabled({}), false);
    assert.equal(mediaStallGapMs({}), 2000);
  });

  it('fires once when binary frames stop', () => {
    const stalls = [];
    let t = 0;
    let tickFn = null;
    const dog = createMediaStallWatchdog({
      gapMs: 30,
      pollMs: 10,
      isOpen: () => true,
      now: () => t,
      setInterval: (fn) => {
        tickFn = fn;
        return 1;
      },
      clearInterval: () => {
        tickFn = null;
      },
      onStall: (info) => stalls.push(info),
    });
    dog.arm();
    dog.noteBinaryFrame();
    t = 40;
    tickFn();
    assert.equal(stalls.length, 1);
    assert.ok(stalls[0].gapMs >= 30);
    t = 80;
    tickFn();
    assert.equal(stalls.length, 1);
    dog.close();
  });
});

describe('server wiring is flag-gated', () => {
  it('references the new modules and keeps idle nudge skip on heardCallerUtterance', () => {
    assert.ok(SERVER.includes('silentCallerPromptEnabled'));
    assert.ok(SERVER.includes('mediaStallWatchdogEnabled'));
    assert.ok(SERVER.includes('skip: Boolean(opts.isIdleNudge) || !heardCallerUtterance'));
    assert.ok(SERVER.includes('VOICE_SILENT_CALLER_PROMPT'));
    assert.ok(SERVER.includes('VOICE_MEDIA_STALL_WATCHDOG'));
  });
});
