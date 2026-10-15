// Run: node --test tests/adminHealth.test.js
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { checkAdminHealthAuth, sautikitScopeChecks } = require('../src/ops/adminHealth');
const {
  classifySonioxBalance,
  probeSonioxBalance,
  getSonioxBalanceHealth,
  resetSonioxBalance,
} = require('../src/speech/sonioxBalanceProbe');

const saved = { ADMIN_HEALTH_TOKEN: process.env.ADMIN_HEALTH_TOKEN, SONIOX_ADMIN_KEY: process.env.SONIOX_ADMIN_KEY };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function fakeJwt(payload) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256' })}.${b(payload)}.sig`;
}

describe('GET /admin/health auth', () => {
  it('is not_configured without ADMIN_HEALTH_TOKEN (never open)', () => {
    delete process.env.ADMIN_HEALTH_TOKEN;
    assert.equal(checkAdminHealthAuth({ authorization: 'Bearer anything' }), 'not_configured');
  });
  it('accepts only the exact Bearer token', () => {
    process.env.ADMIN_HEALTH_TOKEN = 'tok-123';
    assert.equal(checkAdminHealthAuth({ authorization: 'Bearer tok-123' }), 'ok');
    assert.equal(checkAdminHealthAuth({ authorization: 'Bearer tok-124' }), 'unauthorized');
    assert.equal(checkAdminHealthAuth({ authorization: 'tok-123' }), 'unauthorized');
    assert.equal(checkAdminHealthAuth({}), 'unauthorized');
  });
});

describe('SautiKit key scopes', () => {
  it('reports pass/fail per required scope, no key material', () => {
    const key = fakeJwt({ iss: 'sautikit', workspace_id: 'e0e57aa5-xxxx', scopes: ['wallet.read', 'numbers.read'] });
    const r = sautikitScopeChecks(key);
    assert.equal(r.configured, true);
    assert.equal(r.workspaceId, 'e0e57aa5');
    assert.deepEqual(r.checks.filter((c) => !c.ok).map((c) => c.scope), ['calls.read', 'recordings.read', 'whatsapp.messages']);
    assert.ok(!JSON.stringify(r).includes(key));
  });
  it('unset key is not configured', () => {
    assert.equal(sautikitScopeChecks('').configured, false);
  });
});

describe('public /healthz is trimmed', () => {
  it('healthz handler returns ok/sha/branch/startedAt only', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const start = src.indexOf("app.get('/healthz'");
    const body = src.slice(start, src.indexOf('});', start));
    assert.match(body, /gitSha: resolveVoiceGitSha\(\)/);
    assert.doesNotMatch(body, /balance|telephony|sms|soniox|gemini|notify/i);
    assert.match(src, /app\.get\('\/admin\/health'/);
  });
});

describe('Soniox balance probe', () => {
  beforeEach(() => resetSonioxBalance());

  it('classifies exhausted, payment error, low, autopay off, invoice billing', () => {
    assert.equal(classifySonioxBalance({ balance_exhausted: true, available_balance_usd: '0' }).state, 'exhausted');
    assert.equal(classifySonioxBalance({ available_balance_usd: '3', autopay_enabled: true }).state, 'critical');
    assert.equal(classifySonioxBalance({ available_balance_usd: '50', autopay_enabled: true, has_payment_error: true }).state, 'critical');
    assert.equal(classifySonioxBalance({ available_balance_usd: '12', autopay_enabled: true }).state, 'warn');
    const off = classifySonioxBalance({ available_balance_usd: '80', autopay_enabled: false });
    assert.equal(off.state, 'warn');
    assert.match(off.reason, /autopay is off/);
    assert.equal(classifySonioxBalance({ available_balance_usd: '80', autopay_enabled: true }).state, 'ok');
    assert.equal(classifySonioxBalance({ available_balance_usd: '0', invoice_billing_enabled: true }).state, 'ok');
  });

  it('GETs /v1/organization/balance with the admin key (mocked)', async () => {
    const calls = [];
    const r = await probeSonioxBalance({
      adminKey: 'snx_org_test',
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, text: async () => JSON.stringify({ available_balance_usd: '42.5', autopay_enabled: true }) };
      },
    });
    assert.equal(calls[0].url, 'https://api.soniox.com/v1/organization/balance');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(r.state, 'ok');
    assert.equal(r.balanceUsd, 42.5);
  });

  it('a refused admin key reads as unknown with a plain error', async () => {
    const r = await probeSonioxBalance({
      adminKey: 'snx_org_test',
      fetchImpl: async () => ({ ok: false, status: 403, text: async () => '{}' }),
    });
    assert.equal(r.state, 'unknown');
    assert.match(r.error, /Balance and spend/);
  });

  it('no SONIOX_ADMIN_KEY: unknown, not configured', async () => {
    delete process.env.SONIOX_ADMIN_KEY;
    const r = await probeSonioxBalance();
    assert.equal(r.state, 'unknown');
    assert.equal(getSonioxBalanceHealth().configured, false);
  });
});
