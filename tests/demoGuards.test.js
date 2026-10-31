'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { demoEnabled, maxConcurrent, sessionsPerVisitor, visitorPersistOn } = require('../src/demo/flags');
const { maxCallMs, maxCallOn, deadAirHangupOn } = require('../src/speech/callLimits');
const { numberHoldClipEnabled, isProtectedNumber } = require('../src/sautikit/numberHold');
const {
  TURNSTILE_URL,
  BUSY_MESSAGE,
  PAUSED_MESSAGE,
  STATUS_MAX,
  createDemoGuard,
  handleDemoTokenRequest,
  visitorHash,
} = require('../src/demo/guards');

const SECRET = 'test-token-secret';
const SALT = 'test-ip-salt';
const TURNSTILE_SECRET = '1x0000000000000000000000000000000AA';
const IP = '203.0.113.10';
const IP_HASH = visitorHash(SALT, 'ip', IP);
const TURNSTILE_TOKEN = 'turnstile-client-token';

function env(over = {}) {
  return {
    DEMO_ENABLED: 'on',
    DEMO_ALLOWED_ORIGINS: 'https://staging.example',
    DEMO_TOKEN_SECRET: SECRET,
    DEMO_IP_SALT: SALT,
    TURNSTILE_SECRET_KEY: TURNSTILE_SECRET,
    ...over,
  };
}

function request(over = {}) {
  return {
    method: over.method || 'POST',
    headers: {
      origin: 'https://staging.example',
      host: 'voice.example',
      'x-forwarded-proto': 'https',
      ...(over.headers || {}),
    },
    body: {
      tenant: 'home',
      lang: 'en',
      turnstile: TURNSTILE_TOKEN,
      device_id: 'device-1234',
      consent_ts: 1760000000000,
      notice_v: '2026-10-31',
      ...(over.body || {}),
    },
    ip: over.ip || IP,
  };
}

function harness(over = {}, fetchImpl, visitorStore) {
  const clock = { t: Date.parse('2026-10-31T08:00:00Z') };
  const lines = [];
  const calls = [];
  const fetchFn = fetchImpl || (async (url, init) => {
    calls.push({ url: String(url), body: String(init && init.body) });
    return { json: async () => ({ success: true }) };
  });
  const guard = createDemoGuard({
    env: env(over),
    now: () => clock.t,
    fetch: fetchFn,
    log: (line) => lines.push(line),
    visitorStore,
  });
  return { guard, clock, lines, calls };
}

function payloadOf(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

describe('demo flags', () => {
  it('treats On, true, and anything except the exact value on as off', () => {
    assert.equal(demoEnabled({}), false);
    for (const value of ['', 'On', 'ON', 'true', 'TRUE', '1', 'yes', 'on ', ' on']) {
      assert.equal(demoEnabled({ DEMO_ENABLED: value }), false, JSON.stringify(value));
    }
    assert.equal(demoEnabled({ DEMO_ENABLED: 'on' }), true);
  });

  it('defaults the concurrency cap to 5', () => {
    assert.equal(maxConcurrent({}), 5);
    assert.equal(maxConcurrent({ DEMO_MAX_CONCURRENT: '' }), 5);
    assert.equal(maxConcurrent({ DEMO_MAX_CONCURRENT: 'nope' }), 5);
    assert.equal(maxConcurrent({ DEMO_MAX_CONCURRENT: '2' }), 2);
  });

  it('defaults to one session per visitor and keeps persistence off unless the value is on', () => {
    assert.equal(sessionsPerVisitor({}), 1);
    for (const value of ['', 'nope', '0', '1.5', '-1', '101']) {
      assert.equal(sessionsPerVisitor({ DEMO_SESSIONS_PER_VISITOR: value }), 1, JSON.stringify(value));
    }
    assert.equal(sessionsPerVisitor({ DEMO_SESSIONS_PER_VISITOR: '2' }), 2);
    assert.equal(visitorPersistOn({}), false);
    for (const value of ['', 'On', 'true', '1', 'never']) {
      assert.equal(visitorPersistOn({ DEMO_VISITOR_PERSIST: value }), false, JSON.stringify(value));
    }
    assert.equal(visitorPersistOn({ DEMO_VISITOR_PERSIST: 'on' }), true);
  });
});

describe('demo token guards', () => {
  it('returns demo paused when the kill switch is off and does not call Turnstile', async () => {
    for (const value of [undefined, '', 'On', 'true', '1']) {
      const { guard, calls, lines } = harness({ DEMO_ENABLED: value });
      const out = await guard.decide(request());
      assert.equal(out.status, 503, String(value));
      assert.deepEqual(out.body, { reason: 'disabled', message: PAUSED_MESSAGE });
      assert.equal(calls.length, 0, String(value));
      assert.match(lines[0], /^demo_token_reject /);
      assert.equal(JSON.parse(lines[0].slice('demo_token_reject '.length)).reason, 'disabled');
    }
  });

  it('fails closed when the IP salt, token secret, or Turnstile secret is missing', async () => {
    for (const over of [{ DEMO_IP_SALT: '' }, { DEMO_TOKEN_SECRET: ' ' }, { TURNSTILE_SECRET_KEY: '' }]) {
      const { guard, calls, lines } = harness(over);
      const out = await guard.decide(request());
      assert.equal(out.status, 503);
      assert.equal(out.body.reason, 'disabled');
      assert.equal(calls.length, 0);
      const text = lines.join('\n');
      assert.equal(text.includes(IP), false);
      assert.equal(text.includes(SECRET), false);
      assert.equal(text.includes(SALT), false);
      assert.equal(text.includes(TURNSTILE_SECRET), false);
    }
  });

  it('rejects a bad or missing origin', async () => {
    const { guard, calls, lines } = harness();
    const missing = await guard.decide(request({ headers: { origin: '' } }));
    const bad = await guard.decide(request({ headers: { origin: 'https://evil.example' } }));
    assert.equal(missing.status, 403);
    assert.equal(missing.body.reason, 'origin');
    assert.equal(bad.status, 403);
    assert.equal(bad.body.reason, 'origin');
    assert.equal(bad.headers['access-control-allow-origin'], undefined);
    assert.equal(calls.length, 0);
    assert.match(lines.at(-1), /demo_token_reject/);
  });

  it('rejects a missing or failed Turnstile check', async () => {
    const missing = harness();
    const noToken = await missing.guard.decide(request({ body: { turnstile: '' } }));
    assert.equal(noToken.status, 403);
    assert.equal(noToken.body.reason, 'turnstile');
    assert.equal(missing.calls.length, 0);
    assert.match(missing.lines[0], /"turnstile":"missing"/);

    const failed = harness({}, async (url, init) => {
      failed.calls.push({ url: String(url), body: String(init.body) });
      return { json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }) };
    });
    const out = await failed.guard.decide(request());
    assert.equal(out.status, 403);
    assert.equal(out.body.reason, 'turnstile');
    assert.equal(failed.calls[0].url, TURNSTILE_URL);
    assert.match(failed.calls[0].body, new RegExp(`secret=${TURNSTILE_SECRET}`));
    assert.match(failed.lines.at(-1), /demo_token_reject/);
    assert.equal(failed.lines.join('\n').includes(TURNSTILE_TOKEN), false);
    assert.equal(failed.lines.join('\n').includes(TURNSTILE_SECRET), false);
  });

  it('returns used after one session for this hashed IP', async () => {
    const { guard, clock, calls, lines } = harness();
    const first = await guard.decide(request({ body: { device_id: 'device-ip0x' } }));
    assert.equal(first.status, 200);
    clock.t += 61_000;
    const second = await guard.decide(request({ body: { device_id: 'device-ip1x' } }));
    assert.equal(second.status, 429);
    assert.deepEqual(second.body, { reason: 'used' });
    assert.equal(calls.length, 1);
    const logged = JSON.parse(lines.at(-1).slice('demo_token_reject '.length));
    assert.equal(logged.reason, 'used');
    assert.equal(logged.ip_hash, IP_HASH);
    assert.equal(logged.device_id, undefined);
    const text = lines.join('\n');
    assert.equal(text.includes(IP), false);
    assert.equal(text.includes('device-ip1x'), false);
  });

  it('returns used after one session for this device', async () => {
    const { guard, lines } = harness();
    const first = await guard.decide(request({
      ip: '198.51.100.1',
      body: { device_id: 'device-same' },
    }));
    assert.equal(first.status, 200);
    const second = await guard.decide(request({
      ip: '198.51.100.9',
      body: { device_id: 'device-same' },
    }));
    assert.equal(second.status, 429);
    assert.deepEqual(second.body, { reason: 'used' });
    const text = lines.join('\n');
    assert.equal(text.includes('198.51.100.9'), false);
    assert.equal(text.includes('device-same'), false);
  });

  it('reads the visitor allowance from DEMO_SESSIONS_PER_VISITOR', async () => {
    const { guard, clock } = harness({ DEMO_SESSIONS_PER_VISITOR: '2' });
    assert.equal((await guard.decide(request({ body: { device_id: 'device-n1xx' } }))).status, 200);
    clock.t += 61_000;
    assert.equal((await guard.decide(request({ body: { device_id: 'device-n2xx' } }))).status, 200);
    clock.t += 61_000;
    const third = await guard.decide(request({ body: { device_id: 'device-n3xx' } }));
    assert.equal(third.status, 429);
    assert.deepEqual(third.body, { reason: 'used' });
  });

  it('allows one session at a time per IP when the visitor still has a session left', async () => {
    const { guard, calls } = harness({ DEMO_SESSIONS_PER_VISITOR: '2' });
    const first = await guard.decide(request());
    const second = await guard.decide(request({ body: { device_id: 'device-other' } }));
    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal(second.body.reason, 'rate');
    assert.equal(calls.length, 1);
  });

  it('returns a polite busy response at the cap plus one', async () => {
    const { guard, calls, lines } = harness();
    for (let i = 0; i < 5; i += 1) {
      const out = await guard.decide(request({
        ip: `203.0.113.${10 + i}`,
        body: { device_id: `device-${i}abc` },
      }));
      assert.equal(out.status, 200, String(i));
    }
    const sixth = await guard.decide(request({
      ip: '198.51.100.20',
      body: { device_id: 'device-sixth' },
    }));
    assert.equal(sixth.status, 503);
    assert.deepEqual(sixth.body, { reason: 'busy', message: BUSY_MESSAGE });
    assert.equal(calls.length, 5);
    assert.match(lines.at(-1), /demo_token_reject/);
    assert.equal(JSON.parse(lines.at(-1).slice('demo_token_reject '.length)).reason, 'busy');
  });

  it('uses the cap from DEMO_MAX_CONCURRENT', async () => {
    const { guard } = harness({ DEMO_MAX_CONCURRENT: '2' });
    assert.equal((await guard.decide(request({ ip: '203.0.113.1', body: { device_id: 'device-cap1' } }))).status, 200);
    assert.equal((await guard.decide(request({ ip: '203.0.113.2', body: { device_id: 'device-cap2' } }))).status, 200);
    const third = await guard.decide(request({ ip: '203.0.113.3', body: { device_id: 'device-cap3' } }));
    assert.equal(third.status, 503);
    assert.equal(third.body.reason, 'busy');
  });

  it('mints a demo-scoped token and logs without secrets, raw IPs, or audio', async () => {
    const { guard, lines, calls } = harness();
    const out = await guard.decide(request({ body: { tenant: 'shop', lang: 'sw' } }));
    assert.equal(out.status, 200);
    assert.equal(out.body.max_sec, 180);
    assert.match(out.body.ws_url, /^wss:\/\/voice\.example\/ws\/demo\?t=/);
    assert.equal(out.body.ws_url.includes(out.body.token), true);
    const claims = payloadOf(out.body.token);
    assert.equal(claims.tenant, 'demo_shop');
    assert.equal(claims.lang, 'sw');
    assert.equal(claims.ip_hash, IP_HASH);
    assert.equal(claims.dial, undefined);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, TURNSTILE_URL);
    assert.match(lines[0], /^demo_token_ok /);
    const logged = JSON.parse(lines[0].slice('demo_token_ok '.length));
    assert.equal(logged.ip_hash, IP_HASH);
    assert.equal(logged.tenant, 'demo_shop');
    assert.equal(logged.turnstile, 'pass');
    assert.equal(logged.consent_ts, 1760000000000);
    assert.equal(logged.notice_v, '2026-10-31');
    const text = lines.join('\n');
    for (const secret of [SECRET, SALT, TURNSTILE_SECRET, TURNSTILE_TOKEN, IP, out.body.token]) {
      assert.equal(text.includes(secret), false, secret);
    }
    assert.equal(text.includes('audio'), false);
    assert.equal(text.includes('transcript'), false);
  });

  it('rejects a non-demo tenant and never mints for Aris', async () => {
    const { guard, calls } = harness();
    for (const tenant of ['aris', 'demo_home', '+254709221536', '254709221536', '0709221536', 'real-tenant-id']) {
      const out = await guard.decide(request({ body: { tenant } }));
      assert.equal(out.status, 403, tenant);
      assert.equal(out.body.reason, 'tenant', tenant);
      assert.equal(out.body.token, undefined, tenant);
    }
    assert.equal(calls.length, 0);
  });

  it('rejects an expired token and a reused jti', async () => {
    const { guard, clock } = harness();
    const out = await guard.decide(request());
    const fresh = guard.verify(out.body.token);
    const again = guard.verify(out.body.token);
    assert.equal(fresh.ok, true);
    assert.equal(fresh.claims.tenant, 'demo_home');
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'reused');

    const later = harness();
    const minted = await later.guard.decide(request());
    later.clock.t += 60_000;
    const expired = later.guard.verify(minted.body.token);
    assert.equal(expired.ok, false);
    assert.equal(expired.reason, 'expired');
    assert.equal(clock.t > 0, true);
  });

  it('never clears a used visitor when the clock jumps', async () => {
    const { guard, clock } = harness({ DEMO_VISITOR_WINDOW_HOURS: '1' });
    clock.t = Date.parse('2026-10-31T20:30:00Z');
    assert.equal((await guard.decide(request({ body: { device_id: 'device-day0' } }))).status, 200);
    clock.t = Date.parse('2026-10-31T21:30:00Z');
    const nextEatDay = await guard.decide(request({ body: { device_id: 'device-day1' } }));
    assert.equal(nextEatDay.status, 429);
    assert.equal(nextEatDay.body.reason, 'used');
    clock.t += 365 * 24 * 60 * 60 * 1000;
    const nextYear = await guard.decide(request({ body: { device_id: 'device-year1' } }));
    assert.equal(nextYear.status, 429);
    assert.deepEqual(nextYear.body, { reason: 'used' });
  });

  it('does not call any host except Turnstile siteverify', async () => {
    const { guard, calls } = harness();
    await guard.decide(request({ body: { tenant: 'other', lang: 'en' } }));
    assert.deepEqual(calls.map((call) => call.url), [TURNSTILE_URL]);
    const claims = payloadOf((await guard.decide(request({
      ip: '203.0.113.77',
      body: { device_id: 'device-other2', tenant: 'home' },
    }))).body.token);
    assert.equal(claims.tenant, 'demo_home');
  });
});

describe('demo status', () => {
  function statusRequest(ip) {
    return {
      method: 'GET',
      headers: { origin: 'https://staging.example' },
      ip: ip || IP,
    };
  }

  it('returns enabled, busy, and cap with no counts and no raw IP', async () => {
    const { guard, lines } = harness();
    const open = await guard.status(statusRequest());
    assert.equal(open.status, 200);
    assert.deepEqual(open.body, { enabled: true, busy: false, cap: false, reason: null });
    assert.deepEqual(Object.keys(open.body).sort(), ['busy', 'cap', 'enabled', 'reason']);

    const paused = createDemoGuard({
      env: env({ DEMO_ENABLED: 'off' }),
      now: () => Date.parse('2026-10-31T08:00:00Z'),
      fetch: async () => { throw new Error('no turnstile'); },
      log: () => {},
    });
    const off = await paused.status(statusRequest());
    assert.equal(off.status, 200);
    assert.deepEqual(off.body, { enabled: false, busy: false, cap: false, reason: 'disabled' });

    const full = harness({ DEMO_MAX_CONCURRENT: '1' });
    assert.equal((await full.guard.decide(request({ ip: '203.0.113.21', body: { device_id: 'device-status1' } }))).status, 200);
    const busy = await full.guard.status(statusRequest('203.0.113.22'));
    assert.equal(busy.status, 200);
    assert.equal(busy.body.busy, true);
    assert.equal(busy.body.reason, 'busy');
    assert.equal(busy.body.cap, false);
    assert.equal(JSON.stringify(busy.body).includes('1'), false);

    const { createDemoLedger, createMemorySpendStore } = require('../src/demo/meter');
    const ledger = createDemoLedger({
      store: createMemorySpendStore(),
      env: env({ DEMO_DAILY_CAP_USD: '2' }),
      now: () => Date.parse('2026-10-31T08:00:00Z'),
    });
    await ledger.ready();
    await ledger.record({
      sessionId: 'demo_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9',
      minutes: 1,
      sttSeconds: 1,
      ttsSeconds: 1,
      modelInputTokens: 1,
      modelOutputTokens: 1,
      costUsd: 2,
    });
    const cappedLines = [];
    const capped = createDemoGuard({
      env: env(),
      now: () => Date.parse('2026-10-31T08:00:00Z'),
      spend: ledger,
      fetch: async () => { throw new Error('no turnstile'); },
      log: (line) => cappedLines.push(line),
    });
    const cap = await capped.status(statusRequest('203.0.113.23'));
    assert.equal(cap.status, 200);
    assert.deepEqual(cap.body, { enabled: true, busy: false, cap: true, reason: 'cap' });
    const dumped = JSON.stringify(cap.body);
    for (const secret of ['dayUsd', 'daySessions', 'monthUsd', IP, 'device', 'audio', 'transcript']) {
      assert.equal(dumped.includes(secret), false, secret);
    }
    assert.equal(lines.join('\n').includes(IP), false);

    const usedGuard = harness();
    assert.equal((await usedGuard.guard.decide(request())).status, 200);
    const used = await usedGuard.guard.status(statusRequest());
    assert.equal(used.status, 200);
    assert.equal(used.body.enabled, true);
    assert.equal(used.body.cap, false);
    assert.equal(used.body.reason, 'used');
    assert.deepEqual(Object.keys(used.body).sort(), ['busy', 'cap', 'enabled', 'reason']);
    const otherVisitor = await usedGuard.guard.status(statusRequest('198.51.100.77'));
    assert.equal(otherVisitor.body.reason, null);
    assert.equal(JSON.stringify(used.body).includes(IP), false);
    assert.equal(JSON.stringify(used.body).includes(IP_HASH), false);
    assert.equal(usedGuard.lines.join('\n').includes(IP), false);

    const sameIp = await full.guard.status(statusRequest('203.0.113.21'));
    assert.equal(sameIp.body.busy, true);
    assert.equal(sameIp.body.reason, 'used');
  });

  it('rate-limits status polls per IP and does not log the raw address', async () => {
    const { guard, lines } = harness();
    for (let i = 0; i < STATUS_MAX; i += 1) {
      const out = await guard.status(statusRequest());
      assert.equal(out.status, 200, String(i));
    }
    const blocked = await guard.status(statusRequest());
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.body, { reason: 'rate' });
    const other = await guard.status(statusRequest('198.51.100.40'));
    assert.equal(other.status, 200);
    const text = lines.join('\n');
    assert.match(text, /demo_status_reject/);
    assert.equal(text.includes(IP), false);
    assert.equal(text.includes('audio'), false);
  });
});

describe('permanent visitor use', () => {
  const { createMemoryVisitorStore, createSupabaseVisitorStore } = require('../src/demo/visitors');

  it('reloads a used visitor from the store when persist is on', async () => {
    const store = createMemoryVisitorStore();
    const first = harness({ DEMO_VISITOR_PERSIST: 'on' }, null, store);
    assert.equal((await first.guard.decide(request())).status, 200);
    const restarted = harness({ DEMO_VISITOR_PERSIST: 'on' }, null, store);
    const again = await restarted.guard.decide(request({ body: { device_id: 'device-restart' } }));
    assert.equal(again.status, 429);
    assert.deepEqual(again.body, { reason: 'used' });
    const rows = await store.load();
    const dumped = JSON.stringify(rows);
    assert.equal(dumped.includes(IP), false);
    assert.equal(dumped.includes('device-1234'), false);
    assert.equal(rows.some((row) => row.kind === 'ip' && row.visitor_hash === IP_HASH && row.grants_remaining === 0), true);
    assert.equal(rows.some((row) => row.kind === 'device' && row.grants_remaining === 0), true);
  });

  it('ignores the store when persist is not exactly on', async () => {
    const store = createMemoryVisitorStore();
    const first = harness({ DEMO_VISITOR_PERSIST: 'on' }, null, store);
    assert.equal((await first.guard.decide(request())).status, 200);
    const fresh = harness({ DEMO_VISITOR_PERSIST: 'true' }, null, store);
    assert.equal((await fresh.guard.decide(request({ body: { device_id: 'device-fresh1' } }))).status, 200);
  });

  it('blocks a new IP when the device hash is marked, and status can see that device id', async () => {
    const { guard } = harness();
    assert.equal((await guard.decide(request({
      ip: '198.51.100.1',
      body: { device_id: 'device-same' },
    }))).status, 200);
    const moved = await guard.status({
      method: 'GET',
      headers: { origin: 'https://staging.example' },
      ip: '198.51.100.9',
    });
    assert.equal(moved.body.reason, null);
    const seen = await guard.status({
      method: 'GET',
      headers: { origin: 'https://staging.example' },
      ip: '198.51.100.9',
      query: { device_id: 'device-same' },
    });
    assert.equal(seen.status, 200);
    assert.equal(seen.body.reason, 'used');
    assert.equal(JSON.stringify(seen.body).includes('device-same'), false);
    assert.equal(JSON.stringify(seen.body).includes('198.51.100.9'), false);
  });

  it('adds a grant only with the internal secret, and one grant does not clear the other hash', async () => {
    const { guard, clock, lines } = harness({ VOICE_INTERNAL_SECRET: 'ops-secret' });
    assert.equal((await guard.decide(request())).status, 200);
    clock.t += 61_000;
    const secret = 'ops-secret';
    const denied = await guard.grant({
      method: 'POST',
      headers: {},
      body: { visitor_hash: IP_HASH, kind: 'ip' },
    });
    assert.equal(denied.status, 401);
    const wrong = await guard.grant({
      method: 'POST',
      headers: { 'x-voice-internal-secret': 'nope' },
      body: { visitor_hash: IP_HASH, kind: 'ip' },
    });
    assert.equal(wrong.status, 401);
    const ipGrant = await guard.grant({
      method: 'POST',
      headers: { 'x-voice-internal-secret': secret },
      body: { visitor_hash: IP_HASH, kind: 'ip', by: 'alvin' },
    });
    assert.equal(ipGrant.status, 200);
    assert.equal(ipGrant.body.grants_remaining, 1);
    const still = await guard.decide(request({ body: { device_id: 'device-1234' } }));
    assert.equal(still.status, 429);
    assert.equal(still.body.reason, 'used');
    const deviceHash = visitorHash(SALT, 'device', 'device-1234');
    const deviceGrant = await guard.grant({
      method: 'POST',
      headers: { 'x-voice-internal-secret': secret },
      body: { visitor_hash: deviceHash, kind: 'device', by: 'alvin' },
    });
    assert.equal(deviceGrant.body.grants_remaining, 1);
    const next = await guard.decide(request({ body: { device_id: 'device-1234' } }));
    assert.equal(next.status, 200);
    clock.t += 61_000;
    const after = await guard.decide(request({ body: { device_id: 'device-1234' } }));
    assert.equal(after.status, 429);
    assert.equal(after.body.reason, 'used');
    const text = lines.join('\n');
    assert.equal(text.includes(secret), false);
    assert.equal(text.includes(IP), false);
    assert.equal(text.includes('device-1234'), false);
    assert.match(text, /demo_grant /);
  });

  it('round-trips visitor rows through the supabase store without an address', async () => {
    const rows = new Map();
    const client = {
      from(table) {
        assert.equal(table, 'demo_visitor_use');
        return {
          select() {
            return Promise.resolve({ data: [...rows.values()], error: null });
          },
          upsert(row) {
            assert.equal(row.ip, undefined);
            assert.equal(row.device_id, undefined);
            assert.equal(JSON.stringify(row).includes(IP), false);
            rows.set(row.visitor_hash, { ...row, grants_remaining: String(row.grants_remaining) });
            return Promise.resolve({ error: null });
          },
          delete() {
            return {
              eq(_col, hash) {
                rows.delete(hash);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    };
    const store = createSupabaseVisitorStore(client);
    const first = harness({ DEMO_VISITOR_PERSIST: 'on' }, null, store);
    assert.equal((await first.guard.decide(request())).status, 200);
    const restarted = harness({ DEMO_VISITOR_PERSIST: 'on' }, null, store);
    const again = await restarted.guard.decide(request({ body: { device_id: 'device-db1xx' } }));
    assert.equal(again.body.reason, 'used');
    assert.equal(rows.size, 2);
  });

  it('describes the visitor table and does not apply it from this process', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'docs/supabase/demo_visitor_use.sql'), 'utf8');
    assert.match(sql, /visitor_hash text primary key/);
    assert.match(sql, /kind text not null/);
    assert.match(sql, /first_used_at timestamptz/);
    assert.match(sql, /grants_remaining integer not null default 0/);
    assert.match(sql, /granted_by text/);
    assert.match(sql, /granted_at timestamptz/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /Do not apply/);
    const guards = fs.readFileSync(path.join(__dirname, '..', 'src/demo/guards.js'), 'utf8');
    assert.equal(guards.includes('demo_visitor_use.sql'), false);
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.equal(server.split("app.use('/demo/grant'").length - 1, 1);
    assert.equal(server.includes("app.post('/demo/"), false);
  });
});

describe('phone path unchanged', () => {
  it('keeps the phone limits and Aris protection when the demo flag is off', () => {
    assert.equal(maxCallOn({}), false);
    assert.equal(maxCallOn({ VOICE_MAX_CALL: 'true' }), false);
    assert.equal(maxCallOn({ VOICE_MAX_CALL: 'on' }), true);
    assert.equal(maxCallMs({}), 1_200_000);
    assert.equal(deadAirHangupOn({}), false);
    assert.equal(numberHoldClipEnabled({}), false);
    assert.equal(numberHoldClipEnabled({ VOICE_NUMBER_HOLD_CLIP: 'true' }), false);
    assert.equal(numberHoldClipEnabled({ VOICE_NUMBER_HOLD_CLIP: 'on' }), true);
    assert.equal(isProtectedNumber('+254709221536'), true);
  });

  it('existing voice tests are unchanged', () => {
    const untouched = [
      'tests/voiceWiring.test.js',
      'tests/numberHoldClip.test.js',
      'tests/recordingEvents.test.js',
      'tests/turnTaking.test.js',
    ];
    for (const file of untouched) {
      const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
      assert.equal(text.includes('DEMO_ENABLED'), false, file);
      assert.equal(text.includes('/demo/token'), false, file);
      assert.equal(text.includes('src/demo/'), false, file);
    }
  });

  it('mounts only the demo token route and leaves the phone routes in place', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const lines = [
      "app.post('/', sautikitWebhookGuard, handleSautikitRootPost);",
      "app.post('/voice/incoming', sautikitWebhookGuard, handleVoiceIncoming);",
      "app.post('/voice', sautikitWebhookGuard, handleVoiceIncoming);",
      "app.post('/whatsapp/events', sautikitWebhookGuard, handleWhatsAppWebhook);",
      "app.post('/voice/transfer', sautikitWebhookGuard, handleVoiceTransferContinue);",
      "app.post('/voice/recording-status', sautikitWebhookGuard, async (req, res) => {",
      "app.post('/voice/events', sautikitWebhookGuard, async (req, res) => {",
      "if (pathname === '/ws/media') {",
    ];
    for (const line of lines) assert.equal(source.includes(line), true, line);
    assert.equal(source.split("app.use('/demo/token'").length - 1, 1);
    const incoming = source.slice(
      source.indexOf('async function handleVoiceIncoming'),
      source.indexOf('function handleSautikitRootPost')
    );
    assert.equal(incoming.includes('demo'), false);
    assert.equal(incoming.includes('DEMO_'), false);
    const media = source.slice(
      source.indexOf("pathname === '/ws/media'"),
      source.indexOf("pathname === '/ws/relay'")
    );
    assert.equal(media.includes('demo'), false);
    for (const file of ['flags.js', 'token.js', 'guards.js']) {
      const text = fs.readFileSync(path.join(__dirname, '..', 'src/demo', file), 'utf8');
      assert.doesNotMatch(text, /require\([^)]*sautikit/);
      assert.equal(text.includes('/v1/calls'), false, file);
      assert.equal(text.includes('/v1/webrtc'), false, file);
    }
  });

  it('answers 503 for the token handler when the flag is off, and other /demo paths are not mounted', async () => {
    const guard = createDemoGuard({
      env: {},
      fetch: async () => {
        throw new Error('turnstile must not be called');
      },
      log: () => {},
    });
    const res = {
      statusCode: 0,
      body: null,
      headers: {},
      headersSent: false,
      setHeader(key, value) { this.headers[key] = value; },
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      end() { return this; },
    };
    await guard.respond({
      method: 'POST',
      headers: { origin: 'https://staging.example' },
      body: { tenant: '+254709221536' },
    }, res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { reason: 'disabled', message: PAUSED_MESSAGE });
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(source, /if \(req\.method !== 'POST' && req\.method !== 'OPTIONS'\) return next\(\);/);
    assert.equal(source.includes("app.post('/demo/"), false);
    assert.equal(source.split("app.get('/demo/status'").length - 1, 1);
    assert.equal(typeof handleDemoTokenRequest, 'function');
  });
});
