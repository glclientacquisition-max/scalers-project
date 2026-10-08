const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  idleNudgeDelayMs,
  createIdleNudgeController,
} = require('../src/speech/idleNudge');
const { pickIdleNudgeLine } = require('../src/conversation/dynamicSpeech');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('idleNudgeDelayMs', () => {
  it('defaults to 10000 and clamps the env knob', () => {
    assert.equal(idleNudgeDelayMs({}), 10000);
    assert.equal(idleNudgeDelayMs({ VOICE_IDLE_NUDGE_MS: '4000' }), 4000);
    assert.equal(idleNudgeDelayMs({ VOICE_IDLE_NUDGE_MS: '200' }), 10000);
    assert.equal(idleNudgeDelayMs({ VOICE_IDLE_NUDGE_MS: '99999' }), 10000);
  });
});

describe('pickIdleNudgeLine', () => {
  it('stays English until the caller has a language, then matches SW', () => {
    assert.equal(pickIdleNudgeLine({ language: 'en' }), 'How can I help?');
    assert.equal(pickIdleNudgeLine({ language: 'unknown' }), 'How can I help?');
    assert.equal(pickIdleNudgeLine({ language: 'sw' }), 'Naweza kusaidia?');
    assert.equal(pickIdleNudgeLine({ language: 'sheng' }), 'Naweza kusaidia?');
  });
});

describe('createIdleNudgeController', () => {
  it('speaks once after the delay when still idle', async () => {
    const spoken = [];
    const idle = createIdleNudgeController({
      delayMs: 20,
      maxPerCall: 2,
      canFire: () => true,
      speak: () => spoken.push('nudge'),
    });
    assert.equal(idle.arm(), true);
    await wait(40);
    assert.equal(spoken.length, 1);
    assert.equal(idle.count(), 1);
  });

  it('does not speak when caller speech clears the timer', async () => {
    const spoken = [];
    const idle = createIdleNudgeController({
      delayMs: 40,
      canFire: () => true,
      speak: () => spoken.push('nudge'),
    });
    idle.arm();
    idle.clear();
    await wait(60);
    assert.equal(spoken.length, 0);
    assert.equal(idle.count(), 0);
  });

  it('does not fire when canFire is false', async () => {
    const spoken = [];
    const idle = createIdleNudgeController({
      delayMs: 20,
      canFire: () => false,
      speak: () => spoken.push('nudge'),
    });
    idle.arm();
    await wait(40);
    assert.equal(spoken.length, 0);
    assert.equal(idle.count(), 0);
  });

  it('caps at two nudges and skips arm after an idle-nudge playback', async () => {
    const spoken = [];
    const idle = createIdleNudgeController({
      delayMs: 15,
      maxPerCall: 2,
      canFire: () => true,
      speak: () => spoken.push('nudge'),
    });
    idle.arm();
    await wait(25);
    idle.arm({ skip: true });
    await wait(25);
    idle.arm();
    await wait(25);
    idle.arm();
    await wait(25);
    assert.equal(spoken.length, 2);
    assert.equal(idle.arm(), false);
  });
});

describe('idle check-in after an agent statement (HD_48e5ce069c12)', () => {
  const {
    idleArmAfterAgentLine,
    idleStatementDelayMs,
    DEFAULT_STATEMENT_DELAY_MS,
  } = require('../src/speech/idleNudge');

  it('arms after a statement sooner than after a question, never after goodbye', () => {
    assert.equal(DEFAULT_STATEMENT_DELAY_MS, 4000);
    assert.deepEqual(idleArmAfterAgentLine({ text: 'When would you like us to come?', isQuestion: true }), {
      arm: true,
      afterStatement: false,
    });
    assert.deepEqual(
      idleArmAfterAgentLine({ text: 'We cover Nairobi and its close surroundings. Yes, we cover Kitengela.' }, {}),
      { arm: true, afterStatement: true, delayMs: 4000 }
    );
    assert.equal(idleArmAfterAgentLine({ text: 'Thank you for calling. Goodbye.' }).arm, false);
    assert.equal(idleArmAfterAgentLine({ text: 'Asante, kwaheri.' }).arm, false);
    assert.equal(idleArmAfterAgentLine({ text: '' }).arm, false);
    assert.equal(idleStatementDelayMs({ VOICE_IDLE_STATEMENT_MS: '3000' }), 3000);
    assert.equal(idleStatementDelayMs({ VOICE_IDLE_STATEMENT_MS: '20000' }), 4000);
  });

  it('fires before the 7.2 s HD_48e5 silence and offers the next step', async () => {
    const heard = [];
    const idle = createIdleNudgeController({
      delayMs: 200,
      canFire: () => true,
      speak: (context) => heard.push(context),
    });
    idle.arm({ afterStatement: true, delayMs: 20 });
    await wait(40);
    assert.deepEqual(heard, [{ afterStatement: true }]);
    assert.equal(
      pickIdleNudgeLine({ language: 'en', afterStatement: true, slotLine: 'What day and time works?' }),
      'What day and time works?'
    );
    assert.equal(
      pickIdleNudgeLine({ language: 'en', afterStatement: true }),
      'Is there anything else I can help with?'
    );
    assert.equal(
      pickIdleNudgeLine({ language: 'sw', afterStatement: true }),
      'Kuna kingine naweza kukusaidia?'
    );
  });
});
