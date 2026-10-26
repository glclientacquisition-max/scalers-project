'use strict';
// Caller profile v1 stubs (#871). Flag default off → no behaviour change.
const test = require('node:test');
const assert = require('node:assert/strict');
const CP = require('../src/conversation/v2/callerProfile');
const PW = require('../src/conversation/v2/profileWriter');

function withEnv(map, fn) {
  return async () => {
    const prev = {};
    for (const k of Object.keys(map)) {
      prev[k] = process.env[k];
      if (map[k] == null) delete process.env[k];
      else process.env[k] = map[k];
    }
    try { await fn(); }
    finally {
      for (const k of Object.keys(map)) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  };
}

test('flag: off by default (unset BRAIN_V2_CALLER_PROFILE and BRAIN_CALLER_PROFILE)', withEnv({
  BRAIN_V2_CALLER_PROFILE: null,
  BRAIN_CALLER_PROFILE: null,
}, () => {
  assert.equal(CP.callerProfileMode(), 'off');
  assert.equal(CP.callerProfileEnabled(), false);
  assert.equal(CP.callerProfileLive(), false);
}));

test('flag: alias BRAIN_CALLER_PROFILE=on works when canonical unset', withEnv({
  BRAIN_V2_CALLER_PROFILE: null,
  BRAIN_CALLER_PROFILE: 'on',
}, () => {
  assert.equal(CP.callerProfileMode(), 'on');
  assert.equal(CP.callerProfileEnabled(), true);
  assert.equal(CP.callerProfileLive(), true);
}));

test('flag: shadow and on values', withEnv({ BRAIN_CALLER_PROFILE: null }, async () => {
  await withEnv({ BRAIN_V2_CALLER_PROFILE: 'shadow' }, () => {
    assert.equal(CP.callerProfileMode(), 'shadow');
    assert.equal(CP.callerProfileEnabled(), true);
    assert.equal(CP.callerProfileLive(), false);
  })();
  await withEnv({ BRAIN_V2_CALLER_PROFILE: 'on' }, () => {
    assert.equal(CP.callerProfileMode(), 'on');
    assert.equal(CP.callerProfileLive(), true);
  })();
  await withEnv({ BRAIN_V2_CALLER_PROFILE: '0' }, () => {
    assert.equal(CP.callerProfileMode(), 'off');
  })();
}));

test('tools: flag off → disabled (no bind check needed)', withEnv({
  BRAIN_V2_CALLER_PROFILE: null,
  BRAIN_CALLER_PROFILE: null,
}, () => {
  assert.deepEqual(CP.getCallerProfile({ nameConfirmed: true, personId: 'p1' }), {
    error: 'disabled', mode: 'off',
  });
  assert.deepEqual(CP.getCallerHistory({ nameConfirmed: true, personId: 'p1' }), {
    error: 'disabled', mode: 'off',
  });
}));

test('tools: flag on but name not confirmed → not_bound', withEnv({
  BRAIN_V2_CALLER_PROFILE: 'on',
  BRAIN_CALLER_PROFILE: null,
}, () => {
  const r = CP.getCallerProfile({ nameConfirmed: false });
  assert.equal(r.error, 'not_bound');
  assert.equal(r.bind_state, 'unbound');
  const h = CP.getCallerHistory({ nameConfirmed: false, scope: 'open_items' });
  assert.equal(h.error, 'not_bound');
}));

test('tools: shared line without person → candidate / not_bound', withEnv({
  BRAIN_V2_CALLER_PROFILE: 'on',
}, () => {
  const r = CP.getCallerProfile({ nameConfirmed: true, lineShared: true });
  assert.equal(r.error, 'not_bound');
  assert.equal(r.bind_state, 'candidate');
}));

test('tools: bound + on returns card; shadow does not inject', withEnv({
  BRAIN_V2_CALLER_PROFILE: 'on',
}, () => {
  const card = { CALLER: 'Grace' };
  const r = CP.getCallerProfile({ nameConfirmed: true, personId: 'p1', card });
  assert.equal(r.ok, true);
  assert.equal(r.inject, true);
  assert.equal(r.card, card);
}));

test('tools: shadow mode ok but inject false', withEnv({
  BRAIN_V2_CALLER_PROFILE: 'shadow',
}, () => {
  const r = CP.getCallerProfile({ nameConfirmed: true, personId: 'p1', card: { x: 1 } });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'shadow');
  assert.equal(r.inject, false);
}));

test('writer: flag off is a no-op and never throws', withEnv({
  BRAIN_V2_CALLER_PROFILE: null,
  BRAIN_CALLER_PROFILE: null,
}, async () => {
  const out = await PW.writeCallerProfile({
    tenantId: 't1', callId: 'c1', receipts: [{ id: 'r1' }],
  });
  assert.equal(out.ok, true);
  assert.equal(out.skipped, 'flag_off');
  assert.equal(out.written, 0);
  assert.deepEqual(PW.registerProfileWriter(() => {}), { registered: false, reason: 'stub' });
}));

test('writer: no consent skips; missing ids skip', withEnv({
  BRAIN_V2_CALLER_PROFILE: 'on',
}, async () => {
  assert.equal((await PW.writeCallerProfile({
    tenantId: 't1', callId: 'c1', profileConsent: false,
  })).skipped, 'no_consent');
  assert.equal((await PW.writeCallerProfile({ receipts: [] })).skipped, 'missing_ids');
}));

test('v2 barrel still loads with new modules required directly (no wire-up yet)', () => {
  const V2 = require('../src/conversation/v2');
  assert.equal(typeof V2.brainV2Enabled, 'function');
  assert.equal(typeof CP.getCallerProfile, 'function');
  assert.equal(typeof PW.writeCallerProfile, 'function');
});
