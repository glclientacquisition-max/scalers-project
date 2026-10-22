'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const policy = require('../src/lib/recordingRetentionPolicy');

describe('recording retention policy', () => {
  it('resolveEffectiveRetentionDays uses override, platform, env, default', () => {
    assert.equal(
      policy.resolveEffectiveRetentionDays({
        tenantOverride: 14,
        platformDays: 30,
        envDays: 30,
      }),
      14
    );
    assert.equal(
      policy.resolveEffectiveRetentionDays({
        tenantOverride: null,
        platformDays: 60,
        envDays: 30,
      }),
      60
    );
    assert.equal(
      policy.resolveEffectiveRetentionDays({
        tenantOverride: null,
        platformDays: null,
        envDays: 45,
      }),
      45
    );
    assert.equal(
      policy.resolveEffectiveRetentionDays({
        tenantOverride: null,
        platformDays: null,
        envDays: null,
      }),
      30
    );
  });

  it('never skips purge and hides desk note', () => {
    assert.equal(
      policy.resolveEffectiveRetentionDays({
        tenantOverride: policy.RETENTION_NEVER,
        platformDays: 30,
      }),
      'never'
    );
    assert.equal(policy.retentionNoteCopy('never'), null);
    assert.equal(
      policy.callEligibleForRetentionPurge('2020-01-01T00:00:00.000Z', 'never'),
      false
    );
  });

  it('minActiveRetentionDays ignores never-only scopes', () => {
    assert.equal(
      policy.minActiveRetentionDays({
        platformDays: policy.RETENTION_NEVER,
        overrides: new Map(),
        envDays: policy.RETENTION_NEVER,
      }),
      null
    );
    assert.equal(
      policy.minActiveRetentionDays({
        platformDays: policy.RETENTION_NEVER,
        overrides: new Map([['t1', 14]]),
        envDays: policy.RETENTION_NEVER,
      }),
      14
    );
  });
});
