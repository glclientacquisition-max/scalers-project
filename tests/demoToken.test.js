'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  ALLOWED_CLAIMS,
  createTokenStore,
  mintDemoToken,
  verifyDemoToken,
} = require('../src/demo/token');

const SECRET = 'test-token-secret';
const NOW = 1_700_000_000_000;

function mint(over = {}, store = createTokenStore()) {
  return {
    store,
    ...mintDemoToken({
      tenant: 'demo_home',
      lang: 'en',
      ipHash: 'abc123',
      deviceId: 'device-1234',
      secret: SECRET,
      now: NOW,
      store,
      ...over,
    }),
  };
}

function payloadOf(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

function sign(data, secret) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

describe('demo token', () => {
  it('mints an HS256 token for a demo tenant with a 60s TTL and no dial claim', () => {
    const minted = mint();
    assert.equal(minted.ok, true);
    const claims = payloadOf(minted.token);
    assert.deepEqual(Object.keys(claims).sort(), [...ALLOWED_CLAIMS].sort());
    assert.equal(claims.tenant, 'demo_home');
    assert.equal(claims.lang, 'en');
    assert.equal(claims.exp - claims.iat, 60);
    assert.equal(claims.dial, undefined);
    assert.equal(JSON.stringify(claims).includes('254709221536'), false);
    const header = JSON.parse(Buffer.from(minted.token.split('.')[0], 'base64url').toString());
    assert.equal(header.alg, 'HS256');
  });

  it('rejects a non-demo tenant, including Aris', () => {
    for (const tenant of ['home', 'prod-tenant', '+254709221536', '254709221536', 'demo_aris']) {
      const minted = mint({ tenant });
      assert.equal(minted.ok, false, tenant);
      assert.equal(minted.reason, 'tenant', tenant);
      assert.equal(minted.token, undefined, tenant);
    }
  });

  it('rejects an expired token', () => {
    const { token, store } = mint();
    const verified = verifyDemoToken(token, { secret: SECRET, now: NOW + 60_000, store });
    assert.equal(verified.ok, false);
    assert.equal(verified.reason, 'expired');
  });

  it('rejects a reused jti', () => {
    const { token, store } = mint();
    const first = verifyDemoToken(token, { secret: SECRET, now: NOW + 1000, store });
    const second = verifyDemoToken(token, { secret: SECRET, now: NOW + 1000, store });
    assert.equal(first.ok, true);
    assert.equal(first.claims.tenant, 'demo_home');
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'reused');
  });

  it('rejects a forged dial claim, a bad signature, and alg none', () => {
    const store = createTokenStore();
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const claims = {
      tenant: 'demo_home',
      lang: 'en',
      ip_hash: 'abc123',
      device_id: 'device-1234',
      iat: Math.floor(NOW / 1000),
      exp: Math.floor(NOW / 1000) + 60,
      jti: 'forged-jti',
      dial: true,
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const token = `${header}.${payload}.${sign(`${header}.${payload}`, SECRET)}`;
    store.set(claims.jti, { expMs: NOW + 60_000, used: false });
    const dial = verifyDemoToken(token, { secret: SECRET, now: NOW + 1000, store });
    assert.equal(dial.ok, false);
    assert.equal(dial.reason, 'rejected');

    const clean = mint();
    const tampered = `${clean.token.slice(0, -1)}${clean.token.endsWith('a') ? 'b' : 'a'}`;
    const badSig = verifyDemoToken(tampered, { secret: SECRET, now: NOW + 1000, store: clean.store });
    assert.equal(badSig.ok, false);

    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const none = verifyDemoToken(`${noneHeader}.${clean.token.split('.')[1]}.`, {
      secret: SECRET,
      now: NOW + 1000,
      store: clean.store,
    });
    assert.equal(none.ok, false);
  });

  it('does not embed a secret or the SautiKit client', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src/demo/token.js'), 'utf8');
    assert.equal(source.includes('1x0000000000000000000000000000000AA'), false);
    assert.doesNotMatch(source, /require\([^)]*sautikit/);
    assert.equal(source.includes('/v1/calls'), false);
    assert.equal(source.includes('/v1/webrtc'), false);
  });
});
