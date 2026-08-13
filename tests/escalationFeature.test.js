// Run: node --test tests/escalationFeature.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  deriveEscalationStage,
  shapeEscalationNotifyOutcome,
  escalationMvpRules,
  NOTIFY_CHANNEL_ORDER,
} = require('../src/conversation/escalationFeature');

describe('escalation feature contract', () => {
  it('derives need_name when human asked without caller name', () => {
    assert.equal(
      deriveEscalationStage({
        intent: 'human',
        handoff: { requested: true },
        caller: { name: null },
        goal: { missingSlots: ['name'] },
        resolution: { nextBestAction: 'ASK_CLARIFICATION' },
      }),
      'need_name'
    );
  });

  it('derives ready when ESCALATE and name known', () => {
    assert.equal(
      deriveEscalationStage({
        intent: 'human',
        handoff: { requested: true },
        caller: { name: 'Brian' },
        goal: { missingSlots: [] },
        resolution: { nextBestAction: 'ESCALATE' },
      }),
      'ready'
    );
  });

  it('shapes SMS notify outcome as notified', () => {
    const shaped = shapeEscalationNotifyOutcome({
      ok: true,
      sent: [{ channel: 'sms', role: 'teammate', to: '254790381872' }],
    });
    assert.equal(shaped.stage, 'notified');
    assert.equal(shaped.soft, false);
    assert.equal(shaped.channels[0].channel, 'sms');
  });

  it('shapes desk-only soft success', () => {
    const shaped = shapeEscalationNotifyOutcome({
      ok: true,
      soft: true,
      channel: 'desk_note',
    });
    assert.equal(shaped.stage, 'desk_only');
    assert.equal(shaped.soft, true);
  });

  it('documents SMS-first channel order', () => {
    assert.deepEqual(NOTIFY_CHANNEL_ORDER[0], 'sms');
    assert.equal(escalationMvpRules().channelOrder[0], 'sms');
  });
});
