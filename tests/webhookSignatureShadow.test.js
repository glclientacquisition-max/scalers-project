// SautiKit webhook signature guard: two secrets, shadow mode, raw bytes for
// every content type, fail-open on a missing secret, 401 when enforcing.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const webhook = require('../src/sautikit/webhook');

const VOICE = 'test-voice-secret-not-real';
const HOOK = 'test-webhook-secret-not-real';
const ENV_KEYS = ['SAUTIKIT_VALIDATE_WEBHOOKS', 'SAUTIKIT_VOICE_SIGNING_SECRET', 'SAUTIKIT_WEBHOOK_SECRET'];

function sign(secret, body, t = Math.floor(Date.now() / 1000)) {
  const v1 = crypto.createHmac('sha256', secret).update(Buffer.from(body)).update('.').update(String(t)).digest('hex');
  return `t=${t},v1=${v1}`;
}

function withEnv(vars, fn) {
  const saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  Object.assign(process.env, vars);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });
}

function captureLogs() {
  const lines = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.join(' '));
  return { lines, restore: () => Object.assign(console, orig) };
}

async function withApp(fn) {
  const app = express();
  webhook.installWebhookBodyParsers(app, express);
  const seen = [];
  const handler = (req, res) => {
    seen.push({ body: req.body, raw: req.rawBody ? Buffer.from(req.rawBody).toString('utf8') : null });
    res.status(200).send('OK');
  };
  app.post('/', webhook.sautikitWebhookGuard, handler);
  app.post('/voice/events', webhook.sautikitWebhookGuard, handler);
  app.post('/other', handler);
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base, seen);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

async function post(base, p, body, headers = {}) {
  const res = await fetch(base + p, { method: 'POST', body, headers });
  return { status: res.status, text: await res.text() };
}

const JSON_BODY = JSON.stringify({ callSessionState: 'Ringing', sessionId: 'HD_test1', destinationNumber: '+254700000000' });

test('true: JSON post signed with the voice secret passes, matched=SAUTIKIT_VOICE_SIGNING_SECRET', () =>
  withEnv({ SAUTIKIT_VALIDATE_WEBHOOKS: 'true', SAUTIKIT_VOICE_SIGNING_SECRET: VOICE, SAUTIKIT_WEBHOOK_SECRET: HOOK }, () =>
    withApp(async (base, seen) => {
      const logs = captureLogs();
      let r;
      try {
        r = await post(base, '/', JSON_BODY, { 'content-type': 'application/json', 'x-sautikit-signature': sign(VOICE, JSON_BODY), 'user-agent': 'Sautikit-VoiceProxy/1.0' });
      } finally {
        logs.restore();
      }
      assert.equal(r.status, 200);
      assert.equal(seen[0].body.sessionId, 'HD_test1');
      const line = logs.lines.find((l) => l.startsWith('[sautikit] sig '));
      assert.match(line, /route=\/ ok=true reason=ok matched=SAUTIKIT_VOICE_SIGNING_SECRET ua=Sautikit-VoiceProxy\/1\.0/);
      assert.ok(!logs.lines.join('\n').includes(VOICE) && !logs.lines.join('\n').includes(HOOK), 'secret values never logged');
    })
  ));

test('true: JSON post signed with the webhook secret passes, matched=SAUTIKIT_WEBHOOK_SECRET', () =>
  withEnv({ SAUTIKIT_VALIDATE_WEBHOOKS: 'true', SAUTIKIT_VOICE_SIGNING_SECRET: VOICE, SAUTIKIT_WEBHOOK_SECRET: HOOK }, () =>
    withApp(async (base) => {
      const logs = captureLogs();
      let r;
      try {
        r = await post(base, '/voice/events', JSON_BODY, { 'content-type': 'application/json', 'x-sautikit-signature': sign(HOOK, JSON_BODY) });
      } finally {
        logs.restore();
      }
      assert.equal(r.status, 200);
      assert.ok(logs.lines.some((l) => /route=\/voice\/events ok=true reason=ok matched=SAUTIKIT_WEBHOOK_SECRET/.test(l)));
    })
  ));

test('true: form post verifies over the exact form bytes and still parses', () =>
  withEnv({ SAUTIKIT_VALIDATE_WEBHOOKS: 'true', SAUTIKIT_WEBHOOK_SECRET: HOOK }, () =>
    withApp(async (base, seen) => {
      const form = 'sessionId=HD_form1&callSessionState=Completed&note=a%20b';
      const logs = captureLogs();
      let r;
      try {
        r = await post(base, '/', form, { 'content-type': 'application/x-www-form-urlencoded', 'x-sautikit-signature': sign(HOOK, form) });
      } finally {
        logs.restore();
      }
      assert.equal(r.status, 200);
      assert.equal(seen[0].body.sessionId, 'HD_form1');
      assert.equal(seen[0].raw, form);
    })
  ));

test('true: other content type is read raw on webhook paths; body stays {}', () =>
  withEnv({ SAUTIKIT_VALIDATE_WEBHOOKS: 'true', SAUTIKIT_WEBHOOK_SECRET: HOOK }, () =>
    withApp(async (base, seen) => {
      const txt = 'plain text payload';
      const logs = captureLogs();
      let r;
      try {
        r = await post(base, '/voice/events', txt, { 'content-type': 'text/plain', 'x-sautikit-signature': sign(HOOK, txt) });
      } finally {
        logs.restore();
      }
      assert.equal(r.status, 200);
      assert.deepEqual(seen[0].body, {});
      assert.equal(seen[0].raw, txt);
    })
  ));

test('true: missing header -> 401 reason=missing', () =>
  withEnv({ SAUTIKIT_VALIDATE_WEBHOOKS: 'true', SAUTIKIT_WEBHOOK_SECRET: HOOK }, () =>
    withApp(async (base, seen) => {
      const logs = captureLogs();
      let r;
      try {
        r = await post(base, '/voice/events', JSON_BODY, { 'content-type': 'application/json' });
      } finally {
        logs.restore();
      }
      assert.equal(r.status, 401);
      assert.equal(seen.length, 0);
      assert.ok(logs.lines.some((l) => /ok=false reason=missing matched=none/.test(l)));
    })
  ));

test('true: stale t (> 300 s) -> 401 reason=stale', () =>
  withEnv({ SAUTIKIT_VALIDATE_WEBHOOKS: 'true', SAUTIKIT_WEBHOOK_SECRET: HOOK }, () =>
    withApp(async (base) => {
      const old = Math.floor(Date.now() / 1000) - 301;
      const logs = captureLogs();
      let r;
      try {
        r = await post(base, '/', JSON_BODY, { 'content-type': 'application/json', 'x-sautikit-signature': sign(HOOK, JSON_BODY, old) });
      } finally {
        logs.restore();
      }
      assert.equal(r.status, 401);
      assert.ok(logs.lines.some((l) => /reason=stale/.test(l)));
    })
  ));

test('true: wrong secret / tampered body -> 401 reason=mismatch', () =>
  withEnv({ SAUTIKIT_VALIDATE_WEBHOOKS: 'true', SAUTIKIT_VOICE_SIGNING_SECRET: VOICE, SAUTIKIT_WEBHOOK_SECRET: HOOK }, () =>
    withApp(async (base) => {
      const logs = captureLogs();
      let r1;
      let r2;
      try {
        r1 = await post(base, '/', JSON_BODY, { 'content-type': 'application/json', 'x-sautikit-signature': sign('some-other-secret', JSON_BODY) });
        r2 = await post(base, '/', JSON_BODY.replace('Ringing', 'Answered'), { 'content-type': 'application/json', 'x-sautikit-signature': sign(VOICE, JSON_BODY) });
      } finally {
        logs.restore();
      }
      assert.equal(r1.status, 401);
      assert.equal(r2.status, 401);
      assert.equal(JSON.parse(r1.text).error, 'invalid_signature');
      assert.ok(logs.lines.some((l) => /reason=mismatch matched=none/.test(l)));
    })
  ));

test('shadow: never blocks (missing, stale, mismatch all pass) and logs one sig line each', () =>
  withEnv({ SAUTIKIT_VALIDATE_WEBHOOKS: 'shadow', SAUTIKIT_WEBHOOK_SECRET: HOOK }, () =>
    withApp(async (base, seen) => {
      const logs = captureLogs();
      const results = [];
      try {
        results.push(await post(base, '/', JSON_BODY, { 'content-type': 'application/json' }));
        results.push(await post(base, '/', JSON_BODY, { 'content-type': 'application/json', 'x-sautikit-signature': sign(HOOK, JSON_BODY, 1000) }));
        results.push(await post(base, '/', JSON_BODY, { 'content-type': 'application/json', 'x-sautikit-signature': sign('nope', JSON_BODY) }));
        results.push(await post(base, '/', JSON_BODY, { 'content-type': 'application/json', 'x-sautikit-signature': sign(HOOK, JSON_BODY) }));
      } finally {
        logs.restore();
      }
      assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200]);
      assert.equal(seen.length, 4);
      const sig = logs.lines.filter((l) => l.startsWith('[sautikit] sig '));
      assert.equal(sig.length, 4);
      assert.match(sig[0], /reason=missing .*mode=shadow/);
      assert.match(sig[1], /reason=stale/);
      assert.match(sig[2], /reason=mismatch/);
      assert.match(sig[3], /ok=true reason=ok matched=SAUTIKIT_WEBHOOK_SECRET/);
      assert.ok(!logs.lines.some((l) => l.includes('verification failed')));
    })
  ));

test('true with no secret: logs loudly and fails open (no 500)', () =>
  withEnv({ SAUTIKIT_VALIDATE_WEBHOOKS: 'true' }, () =>
    withApp(async (base, seen) => {
      const logs = captureLogs();
      let r;
      try {
        r = await post(base, '/', JSON_BODY, { 'content-type': 'application/json' });
      } finally {
        logs.restore();
      }
      assert.equal(r.status, 200);
      assert.equal(seen.length, 1);
      assert.ok(logs.lines.some((l) => /NOT VERIFYING/.test(l)));
      assert.ok(logs.lines.some((l) => /reason=no_secret/.test(l)));
    })
  ));

test('unset: passes everything through with no sig logging (same as before)', () =>
  withEnv({ SAUTIKIT_WEBHOOK_SECRET: HOOK }, () =>
    withApp(async (base, seen) => {
      const logs = captureLogs();
      let r;
      try {
        r = await post(base, '/', JSON_BODY, { 'content-type': 'application/json', 'x-sautikit-signature': 't=1,v1=bad' });
      } finally {
        logs.restore();
      }
      assert.equal(r.status, 200);
      assert.equal(seen[0].body.sessionId, 'HD_test1');
      assert.ok(!logs.lines.some((l) => l.startsWith('[sautikit]')));
    })
  ));

test('non-webhook paths keep express defaults: unknown type -> {} body, no raw read', () =>
  withEnv({}, () =>
    withApp(async (base, seen) => {
      const r = await post(base, '/other', 'hello', { 'content-type': 'text/plain' });
      assert.equal(r.status, 200);
      assert.deepEqual(seen[0].body, {});
      assert.equal(seen[0].raw, null);
    })
  ));

test('checkSignature: no raw body -> no_raw_body; hashes raw bytes not a re-serialised body', () => {
  const t = Math.floor(Date.now() / 1000);
  const secrets = [{ name: 'SAUTIKIT_WEBHOOK_SECRET', value: HOOK }];
  assert.equal(webhook.checkSignature({ secrets, rawBody: null, signatureHeader: sign(HOOK, '{}', t) }).reason, 'no_raw_body');
  const spaced = '{ "a" : 1 }';
  assert.equal(webhook.checkSignature({ secrets, rawBody: Buffer.from(spaced), signatureHeader: sign(HOOK, spaced, t) }).ok, true);
  assert.equal(webhook.checkSignature({ secrets, rawBody: JSON.stringify(JSON.parse(spaced)), signatureHeader: sign(HOOK, spaced, t) }).ok, false);
  // Legacy helper unchanged for callers.
  assert.equal(webhook.verifySautikitSignature({ secret: HOOK, rawBody: spaced, signatureHeader: sign(HOOK, spaced, t) }), true);
  assert.equal(webhook.verifySautikitSignature({ secret: '', rawBody: 'x', signatureHeader: '' }), true);
});

test('validationMode: only "true" and "shadow" switch it on', () => {
  assert.equal(webhook.validationMode({}), 'off');
  assert.equal(webhook.validationMode({ SAUTIKIT_VALIDATE_WEBHOOKS: 'false' }), 'off');
  assert.equal(webhook.validationMode({ SAUTIKIT_VALIDATE_WEBHOOKS: 'TRUE' }), 'true');
  assert.equal(webhook.validationMode({ SAUTIKIT_VALIDATE_WEBHOOKS: ' Shadow ' }), 'shadow');
});

test('server.js: every guarded route is in SAUTIKIT_WEBHOOK_PATHS and parsers come from installWebhookBodyParsers', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const guarded = [...src.matchAll(/app\.post\('([^']+)',\s*sautikitWebhookGuard/g)].map((m) => m[1]);
  assert.ok(guarded.length >= 7);
  for (const p of guarded) assert.ok(webhook.SAUTIKIT_WEBHOOK_PATHS.has(p), `missing ${p}`);
  assert.match(src, /installWebhookBodyParsers\(app, express\)/);
  assert.doesNotMatch(src, /app\.use\(\s*express\.json\(/);
});
