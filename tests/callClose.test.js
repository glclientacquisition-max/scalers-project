// Brain END must speak a farewell and hang up. An armed idle nudge must stay quiet.
// Run: node --test tests/callClose.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createIdleNudgeController } = require('../src/speech/idleNudge');
const { planBrainEndClose, runBrainEndClose } = require('../src/speech/callClose');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('planBrainEndClose', () => {
  it('speaks Kiswahili on a sw or sheng call and English otherwise', () => {
    assert.deepEqual(planBrainEndClose({ action: 'END', language: 'sw' }), {
      close: true,
      line: 'Asante. Kwaheri.',
    });
    assert.deepEqual(planBrainEndClose({ action: 'END', language: 'sheng' }), {
      close: true,
      line: 'Asante. Kwaheri.',
    });
    assert.deepEqual(planBrainEndClose({ action: 'end', language: 'en' }), {
      close: true,
      line: 'Thank you. Goodbye.',
    });
    assert.equal(planBrainEndClose({ action: 'ANSWER', language: 'sw' }).close, false);
    assert.equal(planBrainEndClose({ action: '', language: 'en' }).line, '');
  });
});

describe('runBrainEndClose', () => {
  it('speaks the farewell, hangs up, and the armed idle nudge never fires', async () => {
    const spoken = [];
    const hung = [];
    const idle = createIdleNudgeController({
      delayMs: 25,
      canFire: () => true,
      speak: () => spoken.push('How can I help?'),
    });
    assert.equal(idle.arm(), true);

    const plan = await runBrainEndClose({
      action: 'END',
      language: 'sw',
      idle,
      speak: (line) =>
        new Promise((resolve) => {
          setTimeout(() => {
            spoken.push(line);
            resolve();
          }, 40);
        }),
      hangup: (reason) => hung.push(reason),
    });

    assert.equal(plan.line, 'Asante. Kwaheri.');
    await wait(50);
    assert.deepEqual(spoken, ['Asante. Kwaheri.']);
    assert.deepEqual(hung, ['end_call']);
    assert.equal(idle.armed(), false);
    assert.equal(idle.arm(), false);
    assert.equal(idle.count(), 0);
  });

  it('leaves an open call and its idle nudge alone', async () => {
    const spoken = [];
    const hung = [];
    const idle = createIdleNudgeController({
      delayMs: 20,
      canFire: () => true,
      speak: () => spoken.push('How can I help?'),
    });
    idle.arm();
    const plan = await runBrainEndClose({
      action: 'ASK_CLARIFICATION',
      language: 'en',
      idle,
      speak: (line) => spoken.push(line),
      hangup: (reason) => hung.push(reason),
    });
    assert.equal(plan.close, false);
    await wait(40);
    assert.deepEqual(spoken, ['How can I help?']);
    assert.deepEqual(hung, []);
    assert.equal(idle.count(), 1);
  });
});
