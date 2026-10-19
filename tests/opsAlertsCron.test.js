'use strict';
// Voice-side 10-minute trigger for Desk's ops alert cron (#772). Off unless
// both a URL and CRON_SECRET are set. One run at a time, a timeout, no retries.
// Logs status and counts only: never the secret, the URL query or the body.
const test = require('node:test');
const assert = require('node:assert/strict');

const cron = require('../src/notifications/opsAlertsCron');

const SECRET = 's3cret-value-0123456789';
const ENV = { OPS_ALERTS_CRON_URL: 'https://desk.example.com/api/cron/ops-alerts', CRON_SECRET: SECRET };

function capture() {
  const lines = [];
  return { lines, log: (...a) => lines.push(a.join(' ')) };
}
function jsonResponse(status, body) {
  return { status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) };
}

test('config: off unless both a URL and CRON_SECRET are set', () => {
  assert.equal(cron.opsCronConfig({}), null);
  assert.equal(cron.opsCronConfig({ OPS_ALERTS_CRON_URL: ENV.OPS_ALERTS_CRON_URL }), null);
  assert.equal(cron.opsCronConfig({ CRON_SECRET: SECRET }), null);
  assert.equal(cron.opsCronConfig({ DESK_BASE_URL: 'https://desk.example.com' }), null);
  const on = cron.opsCronConfig(ENV);
  assert.equal(on.url, ENV.OPS_ALERTS_CRON_URL);
  assert.equal(on.intervalMs, 10 * 60_000);
});

test('config: DESK_BASE_URL builds the path; explicit URL wins', () => {
  assert.equal(cron.opsCronConfig({ DESK_BASE_URL: 'https://desk.example.com/', CRON_SECRET: SECRET }).url, 'https://desk.example.com/api/cron/ops-alerts');
  assert.equal(cron.opsCronConfig({ ...ENV, DESK_BASE_URL: 'https://other.example.com' }).url, ENV.OPS_ALERTS_CRON_URL);
});

test('config: kill switch, short secret, plain http and tests stay off', () => {
  assert.equal(cron.opsCronConfig({ ...ENV, OPS_ALERTS_CRON: 'off' }), null);
  assert.equal(cron.opsCronConfig({ ...ENV, CRON_SECRET: 'short' }), null);
  assert.equal(cron.opsCronConfig({ ...ENV, OPS_ALERTS_CRON_URL: 'http://desk.example.com/api/cron/ops-alerts' }), null);
  assert.equal(cron.opsCronConfig({ ...ENV, OPS_ALERTS_CRON_URL: 'not a url' }), null);
  assert.equal(cron.opsCronConfig({ ...ENV, NODE_ENV: 'test' }), null);
  assert.ok(cron.opsCronConfig({ ...ENV, OPS_ALERTS_CRON_URL: 'http://localhost:3001/api/cron/ops-alerts' }));
});

test('config: interval override is clamped to at least 1 minute', () => {
  assert.equal(cron.opsCronConfig({ ...ENV, OPS_ALERTS_CRON_INTERVAL_MS: '5' }).intervalMs, 60_000);
  assert.equal(cron.opsCronConfig({ ...ENV, OPS_ALERTS_CRON_INTERVAL_MS: '1800000' }).intervalMs, 1_800_000);
});

test('run: sends Bearer CRON_SECRET with GET and logs only status and counts', async () => {
  const { lines, log } = capture();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(200, { ok: true, dryRun: true, recipients: 2, opened: 1, resolved: 0, sent: 0, wouldSend: 1, failed: 0, secretEcho: SECRET, detail: 'KES 15, below KES 100' });
  };
  const runner = cron.createOpsCronRunner(cron.opsCronConfig(ENV), { fetchImpl, log });
  const out = await runner.runOnce();
  assert.equal(out.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ENV.OPS_ALERTS_CRON_URL);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${SECRET}`);
  assert.ok(calls[0].init.signal, 'request has an abort signal');
  const text = lines.join('\n');
  assert.match(text, /status=200/);
  assert.match(text, /opened=1/);
  assert.match(text, /wouldSend=1/);
  assert.doesNotMatch(text, new RegExp(SECRET));
  assert.doesNotMatch(text, /KES|below|secretEcho|desk\.example\.com/);
});

test('run: a 404 or 401 is harmless and logs the status only', async () => {
  for (const status of [404, 401, 500]) {
    const { lines, log } = capture();
    const runner = cron.createOpsCronRunner(cron.opsCronConfig(ENV), { fetchImpl: async () => jsonResponse(status, { error: 'Check failed.', token: SECRET }), log });
    const out = await runner.runOnce();
    assert.equal(out.status, status);
    assert.match(lines.join('\n'), new RegExp(`status=${status}`));
    assert.doesNotMatch(lines.join('\n'), /Check failed|token/);
    assert.doesNotMatch(lines.join('\n'), new RegExp(SECRET));
  }
});

test('run: no overlap while a run is in flight; no retry after a failure', async () => {
  const { log } = capture();
  let release;
  let count = 0;
  const fetchImpl = () => { count += 1; return new Promise((r) => { release = () => r(jsonResponse(200, { ok: true })); }); };
  const runner = cron.createOpsCronRunner(cron.opsCronConfig(ENV), { fetchImpl, log });
  const first = runner.runOnce();
  const second = await runner.runOnce();
  assert.equal(second.skipped, 'in_flight');
  release();
  await first;
  assert.equal(count, 1);

  let failures = 0;
  const failing = cron.createOpsCronRunner(cron.opsCronConfig(ENV), { fetchImpl: async () => { failures += 1; throw new Error(`connect failed ${SECRET}`); }, log: capture().log });
  const res = await failing.runOnce();
  assert.equal(res.error, true);
  assert.equal(failures, 1, 'one attempt per tick, no retry loop');
});

test('run: timeout aborts the request and logs a timeout without the secret', async () => {
  const { lines, log } = capture();
  const fetchImpl = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  });
  const runner = cron.createOpsCronRunner({ ...cron.opsCronConfig(ENV), timeoutMs: 20 }, { fetchImpl, log });
  // The runner's own timer is unref()d (it must not hold a server open); keep the test loop alive.
  const keepAlive = setTimeout(() => {}, 1000);
  const out = await runner.runOnce();
  clearTimeout(keepAlive);
  assert.equal(out.error, true);
  assert.match(lines.join('\n'), /timeout/);
  assert.doesNotMatch(lines.join('\n'), new RegExp(SECRET));
});

test('start: off config starts nothing; on config uses unref timers and stop clears them', () => {
  const made = [];
  const timers = {
    setTimeout: (fn, ms) => { const t = { kind: 'timeout', ms, unrefd: false, unref() { this.unrefd = true; return this; } }; made.push(t); return t; },
    setInterval: (fn, ms) => { const t = { kind: 'interval', ms, unrefd: false, unref() { this.unrefd = true; return this; } }; made.push(t); return t; },
    clearTimeout: (t) => { t.cleared = true; },
    clearInterval: (t) => { t.cleared = true; },
  };
  assert.equal(cron.startOpsAlertsCron({ env: {}, timers, log: () => {} }), null);
  assert.equal(made.length, 0);
  const handle = cron.startOpsAlertsCron({ env: ENV, timers, log: () => {}, fetchImpl: async () => jsonResponse(200, {}) });
  assert.ok(handle);
  assert.ok(made.some((t) => t.kind === 'interval' && t.ms === 600_000));
  assert.ok(made.every((t) => t.unrefd), 'every timer is unref()d');
  handle.stop();
  assert.ok(made.every((t) => t.cleared));
});
