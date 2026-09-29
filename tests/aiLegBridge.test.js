const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  isAiLegDestination,
  shouldDialAiLeg,
  buildShopBridgeXml,
  parentDidForTenant,
  aiLegBridgeEnabled,
} = require('../src/sautikit/aiLegBridge');

const KEYS = ['VOICE_AI_LEG_DID', 'VOICE_AI_LEG_PARENT_DID', 'VOICE_AI_LEG_BRIDGE'];

describe('ai leg bridge', () => {
  const previous = {};

  beforeEach(() => {
    for (const key of KEYS) previous[key] = process.env[key];
    process.env.VOICE_AI_LEG_DID = '+254709221542';
    process.env.VOICE_AI_LEG_PARENT_DID = '+254709221536';
    process.env.VOICE_AI_LEG_BRIDGE = 'on';
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });

  it('treats the second number as the stream leg and the shop number as the dial', () => {
    assert.equal(isAiLegDestination('+254709221542'), true);
    assert.equal(isAiLegDestination('254709221542'), true);
    assert.equal(shouldDialAiLeg('+254709221536'), true);
    assert.equal(shouldDialAiLeg('+254709221542'), false);
    assert.equal(parentDidForTenant(), '+254709221536');
  });

  it('stays off unless the bridge flag and both numbers are set', () => {
    process.env.VOICE_AI_LEG_BRIDGE = 'off';
    assert.equal(aiLegBridgeEnabled(), false);
    assert.equal(shouldDialAiLeg('+254709221536'), false);
    assert.equal(isAiLegDestination('+254709221542'), true);
  });

  it('dials the AI leg with a holding stream on that leg only', () => {
    const xml = buildShopBridgeXml({
      aiLeg: '+254709221542',
      callerId: '+254709221536',
      doneUrl: 'https://voice.test/voice/ai-leg-done?callSid=HD_abc',
    });
    assert.match(xml, /<Number>\+254709221542<\/Number>/);
    assert.match(xml, /callerId="\+254709221536"/);
    assert.match(xml, /voice\/ai-leg-done\?callSid=HD_abc/);
    assert.doesNotMatch(xml, /connect="false"/);
    assert.doesNotMatch(xml, /<Stream/);
  });
});
