'use strict';

// Line-unavailable clips hosted through SautiKit uploads (#639): packaged
// WAVs, the uploader, the refresh job, the stored-URL read, and the ops alert.
// All network and DB calls are mocked.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const audio = require('../src/sautikit/lineUnavailableAudio');
const ops = require('../src/notifications/platformOpsAlert');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 9, 12, 0, 0);
const SIGNED = 'https://storage.sautikit.com/ws1/uploads/abc.wav?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20261009T120000Z&X-Amz-Expires=604800&X-Amz-Signature=deadbeef';
const SCOPE_DENIED = {
  error: {
    code: 'api_key.scope_denied',
    message: 'missing scope: numbers.claim',
    resolution: 'Use a key whose scopes include this operation, or mint one with the required scope.',
    request_id: 'req-1',
  },
};

function response(status, json) {
  const text = json == null ? '' : JSON.stringify(json);
  return { status, text: async () => text };
}

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
  fn.calls = calls;
  return fn;
}

function fakeDb(rows = []) {
  const db = {
    rows: rows.slice(),
    upserts: [],
    errors: [],
    async getPlatformAudio(keys) {
      return db.rows.filter((r) => keys.includes(r.key));
    },
    async upsertPlatformAudio(row) {
      db.upserts.push(row);
      db.rows = db.rows.filter((r) => r.key !== row.key);
      db.rows.push({ key: row.key, url: row.url, expires_at: row.expiresAt, file_sha256: row.fileSha256 });
    },
    async notePlatformAudioError(row) {
      db.errors.push(row);
    },
  };
  return db;
}

function fakeOps() {
  const o = { degraded: [], recovered: [] };
  o.notePlatformOpsDegrade = async (kind, detail) => {
    o.degraded.push({ kind, detail });
    return { ok: true };
  };
  o.notePlatformOpsRecovered = (kind) => o.recovered.push(kind);
  return o;
}

function wavInfo(file) {
  const b = fs.readFileSync(file);
  return {
    riff: b.toString('ascii', 0, 4) + b.toString('ascii', 8, 12),
    format: b.readUInt16LE(20),
    channels: b.readUInt16LE(22),
    rate: b.readUInt32LE(24),
    bits: b.readUInt16LE(34),
    seconds: (b.length - 44) / 32000,
  };
}

beforeEach(() => audio.resetLineUnavailableAudioForTests());

describe('packaged clips', () => {
  for (const lang of ['en', 'sw']) {
    it(`${lang}: src/speech/pcm/line-unavailable-${lang}.v1.wav is 16 kHz mono 16-bit PCM, 1-15 s`, () => {
      const file = audio.clipPath(lang);
      assert.match(file, new RegExp(`src/speech/pcm/line-unavailable-${lang}\\.v1\\.wav$`));
      const info = wavInfo(file);
      assert.equal(info.riff, 'RIFFWAVE');
      assert.deepEqual([info.format, info.channels, info.rate, info.bits], [1, 1, 16000, 16]);
      assert.ok(info.seconds > 1 && info.seconds < 15, String(info.seconds));
      assert.ok(fs.statSync(file).size < 10 * 1024 * 1024, 'under the 10 MiB upload limit');
    });
  }
});

describe('uploadClip', () => {
  it('no key: no request', async () => {
    const f = fakeFetch(() => response(200, {}));
    assert.deepEqual(await audio.uploadClip('en', { apiKey: '', fetchImpl: f }), { ok: false, reason: 'no_key' });
    assert.equal(f.calls.length, 0);
  });

  it('POSTs multipart file to /v1/uploads/audio with the bearer key', async () => {
    const f = fakeFetch(() => response(200, { url: SIGNED, mime_type: 'audio/wav', size_bytes: 161154 }));
    const r = await audio.uploadClip('en', { apiKey: 'k-test', fetchImpl: f, now: () => T0 });
    assert.equal(f.calls[0].url, 'https://api.sautikit.com/v1/uploads/audio');
    assert.equal(f.calls[0].init.method, 'POST');
    assert.equal(f.calls[0].init.headers.Authorization, 'Bearer k-test');
    const file = f.calls[0].init.body.get('file');
    assert.equal(file.name, 'line-unavailable-en.v1.wav');
    assert.equal(file.type, 'audio/wav');
    assert.equal(r.ok, true);
    assert.equal(r.url, SIGNED);
    assert.equal(r.expiresAt, '2026-10-16T12:00:00.000Z', 'X-Amz-Date + X-Amz-Expires');
  });

  it('expiry falls back to upload time + 7 days when the URL has no SigV4 fields', () => {
    assert.equal(audio.signedUrlExpiry('https://storage.sautikit.com/x.wav', T0), T0 + 7 * DAY);
  });

  it('403 api_key.scope_denied (the live staging answer) is missing_scope, body redacted', async () => {
    const f = fakeFetch(() => response(403, SCOPE_DENIED));
    const r = await audio.uploadClip('sw', { apiKey: 'k', fetchImpl: f });
    assert.equal(r.reason, 'missing_scope');
    assert.equal(r.status, 403);
    assert.equal(r.code, 'api_key.scope_denied');
    assert.match(r.body, /missing scope: numbers\.claim/);
  });

  it('401, 5xx, a non-SautiKit URL and a network error are reported, not thrown', async () => {
    assert.equal((await audio.uploadClip('en', { apiKey: 'k', fetchImpl: fakeFetch(() => response(401, {})) })).reason, 'unauthorized');
    const five = await audio.uploadClip('en', { apiKey: 'k', fetchImpl: fakeFetch(() => response(503, { error: { code: 'upstream' } })) });
    assert.deepEqual([five.reason, five.status, five.code], ['http', 503, 'upstream']);
    const bad = await audio.uploadClip('en', { apiKey: 'k', fetchImpl: fakeFetch(() => response(200, { url: 'https://evil.example.com/x.wav' })) });
    assert.deepEqual([bad.reason, bad.body], ['bad_response', 'host=evil.example.com']);
    const net = await audio.uploadClip('en', { apiKey: 'k', fetchImpl: async () => { throw new Error('ECONNRESET'); } });
    assert.equal(net.reason, 'fetch_error');
  });

  it('redactBody strips URLs, JWTs and bearer tokens', () => {
    const out = audio.redactBody(`see ${SIGNED} Bearer abc.def eyJhbGciOi.eyJzdWIi.sig`);
    assert.doesNotMatch(out, /Signature|deadbeef|eyJ|abc\.def/);
    assert.match(out, /storage\.sautikit\.com/);
  });
});

describe('refreshLineUnavailableClips', () => {
  const ok = () => response(200, { url: SIGNED, mime_type: 'audio/wav', size_bytes: 1 });

  it('no rows: uploads en and sw, stores url + expiry + sha, clears the ops latch; logs host and expiry only', async () => {
    const db = fakeDb();
    const o = fakeOps();
    const logs = [];
    const f = fakeFetch(ok);
    const r = await audio.refreshLineUnavailableClips({ db, ops: o, apiKey: 'k', fetchImpl: f, now: () => T0, log: (m) => logs.push(m) });
    assert.deepEqual(r, { ok: true, results: { en: 'uploaded:missing', sw: 'uploaded:missing' } });
    assert.deepEqual(db.upserts.map((u) => u.key), ['line_unavailable_en_v1', 'line_unavailable_sw_v1']);
    assert.equal(db.upserts[0].expiresAt, '2026-10-16T12:00:00.000Z');
    assert.match(db.upserts[0].fileSha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(o.recovered, ['audio']);
    assert.equal(o.degraded.length, 0);
    assert.ok(logs.length === 2 && logs.every((m) => /host=storage\.sautikit\.com expires=2026-10-16/.test(m)));
    assert.ok(logs.every((m) => !/Signature|deadbeef|uploads\/abc/.test(m)), 'never the signed URL');
  });

  it('re-uploads only under 48 h left (about day 5 of 7) or when the file changed', async () => {
    const f = fakeFetch(ok);
    const db = fakeDb();
    await audio.refreshLineUnavailableClips({ db, ops: fakeOps(), apiKey: 'k', fetchImpl: f, now: () => T0, log: () => {} });
    assert.equal(f.calls.length, 2);
    const day = (n) => () => T0 + n * DAY;
    let r = await audio.refreshLineUnavailableClips({ db, ops: fakeOps(), apiKey: 'k', fetchImpl: f, now: day(4.9), log: () => {} });
    assert.deepEqual(r.results, { en: 'fresh', sw: 'fresh' });
    assert.equal(f.calls.length, 2, 'no upload with > 48 h left');
    r = await audio.refreshLineUnavailableClips({ db, ops: fakeOps(), apiKey: 'k', fetchImpl: f, now: day(5.1), log: () => {} });
    assert.deepEqual(r.results, { en: 'uploaded:expiring', sw: 'uploaded:expiring' });
    db.rows[0].file_sha256 = 'old';
    assert.equal(audio.needsUpload(db.rows[0], { sha: 'new', nowMs: T0 }), 'file_changed');
    assert.equal(audio.needsUpload(null, { sha: 'x', nowMs: T0 }), 'missing');
  });

  it('key without numbers.claim (403): one warn across passes, no alert, nothing stored', async () => {
    const db = fakeDb();
    const o = fakeOps();
    const logs = [];
    const f = fakeFetch(() => response(403, SCOPE_DENIED));
    for (let i = 0; i < 3; i++) {
      const r = await audio.refreshLineUnavailableClips({ db, ops: o, apiKey: 'k', fetchImpl: f, now: () => T0, log: (m) => logs.push(m) });
      assert.equal(r.reason, 'missing_scope');
    }
    assert.equal(logs.length, 1);
    assert.match(logs[0], /missing_scope HTTP 403 api_key\.scope_denied.*numbers\.claim.*<Say>/);
    assert.equal(o.degraded.length, 0);
    assert.equal(db.upserts.length, 0);
  });

  it('no key: one warn, no request, no alert', async () => {
    const o = fakeOps();
    const logs = [];
    const f = fakeFetch(ok);
    await audio.refreshLineUnavailableClips({ db: fakeDb(), ops: o, apiKey: '', fetchImpl: f, log: (m) => logs.push(m) });
    await audio.refreshLineUnavailableClips({ db: fakeDb(), ops: o, apiKey: '', fetchImpl: f, log: (m) => logs.push(m) });
    assert.equal(f.calls.length, 0);
    assert.equal(logs.length, 1);
    assert.equal(o.degraded.length, 0);
  });

  it('table missing: one warn, no upload, no alert', async () => {
    const o = fakeOps();
    const logs = [];
    const f = fakeFetch(ok);
    const db = { getPlatformAudio: async () => { throw new Error('relation "voice_platform_audio" does not exist'); } };
    const r = await audio.refreshLineUnavailableClips({ db, ops: o, apiKey: 'k', fetchImpl: f, log: (m) => logs.push(m) });
    assert.equal(r.reason, 'no_store');
    assert.equal(f.calls.length, 0);
    assert.equal(o.degraded.length, 0);
    assert.equal(logs.length, 1);
  });

  it('a real upload failure (5xx) keeps the old row, notes the error and sends one ops alert (kind audio)', async () => {
    const db = fakeDb([{ key: 'line_unavailable_en_v1', url: SIGNED, expires_at: new Date(T0 + DAY).toISOString(), file_sha256: null }]);
    const o = fakeOps();
    const f = fakeFetch(() => response(503, { error: { code: 'storage.unavailable' } }));
    const r = await audio.refreshLineUnavailableClips({ db, ops: o, apiKey: 'k', fetchImpl: f, now: () => T0, log: () => {} });
    assert.equal(r.reason, 'upload_failed');
    assert.equal(db.upserts.length, 0);
    assert.equal(db.rows[0].url, SIGNED, 'old link kept until it expires');
    assert.deepEqual(db.errors.map((e) => e.key), ['line_unavailable_en_v1', 'line_unavailable_sw_v1']);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(o.degraded.length, 1);
    assert.equal(o.degraded[0].kind, 'audio');
    assert.match(o.degraded[0].detail.message, /en http 503 storage\.unavailable; sw http 503/);
    assert.equal(o.recovered.length, 0);
  });
});

describe('storedClipUrls (call time)', () => {
  it('returns unexpired URLs, skips rows with under 10 min left, caches for a minute', async () => {
    let reads = 0;
    const rows = [
      { key: 'line_unavailable_en_v1', url: SIGNED, expires_at: new Date(T0 + DAY).toISOString() },
      { key: 'line_unavailable_sw_v1', url: SIGNED, expires_at: new Date(T0 + 5 * 60 * 1000).toISOString() },
    ];
    const db = { getPlatformAudio: async () => { reads += 1; return rows; } };
    let t = T0;
    const now = () => t;
    assert.deepEqual(await audio.storedClipUrls({ db, now }), { en: SIGNED, sw: '' });
    t += 30_000;
    await audio.storedClipUrls({ db, now });
    assert.equal(reads, 1);
    t += 31_000;
    await audio.storedClipUrls({ db, now });
    assert.equal(reads, 2);
  });

  it('DB error: no clips (the gate uses <Say>)', async () => {
    const db = { getPlatformAudio: async () => { throw new Error('down'); } };
    assert.deepEqual(await audio.storedClipUrls({ db, now: () => T0 }), { en: '', sw: '' });
  });
});

describe('ops alert kind audio respects VOICE_PLATFORM_OPS_DRY_RUN', () => {
  it('dry run logs, sends nothing', async () => {
    const saved = { ...process.env };
    process.env.VOICE_PLATFORM_OPS_DRY_RUN = 'true';
    process.env.SCALERS_OPS_ALERT_PHONES = '+254700000099';
    ops.resetPlatformOpsAlert();
    let sent = 0;
    ops.setPlatformOpsDispatch(async () => {
      sent += 1;
      return { sent: [], errors: [] };
    });
    const warn = console.warn;
    const lines = [];
    console.warn = (m) => lines.push(String(m));
    try {
      const r = await ops.notePlatformOpsDegrade('audio', { message: 'upload failed' });
      assert.equal(r.channel, 'dry_run');
      assert.equal(sent, 0);
      assert.ok(lines.some((m) => /DRY_RUN kind=audio/.test(m) && /Phone audio/.test(m)));
    } finally {
      console.warn = warn;
      ops.resetPlatformOpsAlert();
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});

describe('boot wiring', () => {
  it('server starts the refresh job; VOICE_LINE_UNAVAILABLE_REFRESH=off disables it', () => {
    const server = fs.readFileSync(require.resolve('../server.js'), 'utf8');
    assert.match(server, /startLineUnavailableClipRefresh\(\)/);
    const saved = process.env.VOICE_LINE_UNAVAILABLE_REFRESH;
    process.env.VOICE_LINE_UNAVAILABLE_REFRESH = 'off';
    try {
      assert.equal(audio.startLineUnavailableClipRefresh(), null);
    } finally {
      if (saved === undefined) delete process.env.VOICE_LINE_UNAVAILABLE_REFRESH;
      else process.env.VOICE_LINE_UNAVAILABLE_REFRESH = saved;
    }
  });
});
