'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { demoEnabled, maxConcurrent } = require('../src/demo/flags');
const { maxCallMs, maxCallOn, deadAirHangupOn } = require('../src/speech/callLimits');
const { numberHoldClipEnabled, isProtectedNumber } = require('../src/sautikit/numberHold');
const {
  TURNSTILE_URL,
  BUSY_MESSAGE,
  PAUSED_MESSAGE,
  createDemoGuard,
  handleDemoTokenRequest,
} = require('../src/demo/guards');

const SECRET = 'test-token-secret';
const SALT = 'test-ip-salt';
const TURNSTILE_SECRET = '1x0000000000000000000000000000000AA';
const IP = '203.0.113.10';
const IP_HASH = '6e38ea0c936a2177adf40771c48c23cb7cd6299d8c46833cd5934ed407e0036c';
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

function harness(over = {}, fetchImpl) {
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

  it('rate-limits the 4th session per hashed IP', async () => {
    const { guard, clock, calls } = harness();
    for (let i = 0; i < 3; i += 1) {
      const out = await guard.decide(request({ body: { device_id: `device-ip${i}x` } }));
      assert.equal(out.status, 200, String(i));
      clock.t += 61_000;
    }
    const fourth = await guard.decide(request({ body: { device_id: 'device-ip4x' } }));
    assert.equal(fourth.status, 429);
    assert.equal(fourth.body.reason, 'limit_daily');
    assert.equal(calls.length, 3);
  });

  it('rate-limits the 4th session per device', async () => {
    const { guard, clock } = harness();
    for (let i = 0; i < 3; i += 1) {
      const out = await guard.decide(request({
        ip: `198.51.100.${i + 1}`,
        body: { device_id: 'device-same' },
      }));
      assert.equal(out.status, 200, String(i));
      clock.t += 61_000;
    }
    const fourth = await guard.decide(request({
      ip: '198.51.100.9',
      body: { device_id: 'device-same' },
    }));
    assert.equal(fourth.status, 429);
    assert.equal(fourth.body.reason, 'limit_daily');
  });

  it('allows one session at a time per IP', async () => {
    const { guard, calls } = harness();
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

  it('rolls the daily limit at the EAT day boundary', async () => {
    const { guard, clock } = harness();
    clock.t = Date.parse('2026-10-31T20:30:00Z');
    for (let i = 0; i < 3; i += 1) {
      const out = await guard.decide(request({ body: { device_id: `device-day${i}` } }));
      assert.equal(out.status, 200, String(i));
      clock.t += 61_000;
    }
    const blocked = await guard.decide(request({ body: { device_id: 'device-day4' } }));
    assert.equal(blocked.body.reason, 'limit_daily');
    clock.t = Date.parse('2026-10-31T21:30:00Z');
    const nextDay = await guard.decide(request({ body: { device_id: 'device-day5' } }));
    assert.equal(nextDay.status, 200);
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
    assert.equal(source.includes("app.get('/demo/"), false);
    assert.equal(typeof handleDemoTokenRequest, 'function');
  });
});
