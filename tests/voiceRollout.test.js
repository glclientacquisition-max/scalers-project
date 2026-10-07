const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { structuredReplyEnabled } = require('../src/speech/structuredReplyFlag');
const { voiceTraceEnabledFor } = require('../src/speech/voiceTrace');

function env(extra) {
  return {
    VOICE_STRUCTURED_REPLY: 'auto',
    VOICE_TRACE: 'auto',
    NODE_ENV: 'production',
    RAILWAY_ENVIRONMENT_NAME: 'production',
    ...extra,
  };
}

describe('per-tenant voice rollout', () => {
  it('keeps staging on and production off when the allowlist is empty', () => {
    const staging = env({
      NODE_ENV: 'production',
      RAILWAY_ENVIRONMENT_NAME: 'staging',
      VOICE_ROLLOUT_TENANTS: '',
    });
    const prod = env({ VOICE_ROLLOUT_TENANTS: '' });
    assert.equal(structuredReplyEnabled('tenant-a', staging), true);
    assert.equal(voiceTraceEnabledFor('tenant-a', staging), true);
    assert.equal(structuredReplyEnabled('tenant-a', prod), false);
    assert.equal(voiceTraceEnabledFor('tenant-a', prod), false);
  });

  it('turns the mouth and the trace on only for listed tenants, including production', () => {
    const prod = env({ VOICE_ROLLOUT_TENANTS: 'tenant-a, tenant-b' });
    assert.equal(structuredReplyEnabled('tenant-a', prod), true);
    assert.equal(voiceTraceEnabledFor('tenant-b', prod), true);
    assert.equal(structuredReplyEnabled('tenant-c', prod), false);
    assert.equal(voiceTraceEnabledFor('', prod), false);
    assert.equal(structuredReplyEnabled(undefined, prod), false);
  });

  it('does not open the trace for a tenant outside the list', () => {
    const staging = env({
      RAILWAY_ENVIRONMENT_NAME: 'staging',
      VOICE_ROLLOUT_TENANTS: 'tenant-a',
    });
    assert.equal(voiceTraceEnabledFor('tenant-z', staging), false);
    assert.equal(structuredReplyEnabled('tenant-a', staging), true);
  });
});
