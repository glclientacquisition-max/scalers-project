// Recording copy: provider URL saved first, background retry on 404/403,
// pending_copy when it never lands (HD_b401138c8ffd / HD_923e63f8a72b: 404 at +0.3s).
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  copyRecordingWithRetry,
  RETRY_DELAYS_MS,
} = require('../src/sautikit/recordingCopy');

function res(status, body = 'RIFFwav') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'audio/wav' : null) },
    arrayBuffer: async () => Buffer.from(body),
  };
}
function seqFetch(statuses) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const s = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    return res(s);
  };
  fn.calls = calls;
  return fn;
}
const quiet = { log() {}, warn() {} };

// Minimal fake of the supabase calls table + storage.
const rows = new Map();
const uploads = [];
function fakeSupabase() {
  function q() {
    const st = { filters: [], update: null };
    const api = {
      select() { return api; },
      update(u) { st.update = u; return api; },
      eq(col, val) { st.filters.push([col, val]); return api; },
      like() { return api; },
      order() { return api; },
      limit() { return api; },
      maybeSingle() { return run(true); },
      then(resolve, reject) { return run(false).then(resolve, reject); },
    };
    function run(single) {
      const sid = (st.filters.find(([c]) => c === 'sautikit_call_sid') || [])[1];
      const row = rows.get(sid);
      if (row && st.update) Object.assign(row, st.update);
      return Promise.resolve({ data: single ? row || null : row ? [row] : [], error: null });
    }
    return api;
  }
  return {
    from: () => q(),
    storage: {
      from: () => ({
        upload: async (path, buffer) => { uploads.push({ path, size: buffer.length }); return { error: null }; },
        createSignedUrl: async (path) => ({ data: { signedUrl: `https://supa.example/signed/${path}` }, error: null }),
      }),
    },
  };
}

let db;
before(() => {
  const clientPath = require.resolve('../src/lib/supabaseClient');
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { supabase: fakeSupabase() } };
  db = require('../src/db');
});

const PROVIDER = 'https://storage.sautikit.com/recordings/t/abc.wav?sig=x';

describe('copyRecordingWithRetry', () => {
  it('uses the 2/5/10/20/40s schedule', () => {
    assert.deepEqual(RETRY_DELAYS_MS, [2000, 5000, 10000, 20000, 40000]);
  });

  it('404, 404, then 200: copies on the third try after 2s and 5s waits', async () => {
    const fetchImpl = seqFetch([404, 404, 200]);
    const slept = [];
    const up = [];
    const out = await copyRecordingWithRetry({
      callSid: 'HD_x', url: PROVIDER, fetchImpl,
      sleep: async (ms) => slept.push(ms),
      upload: async (a) => { up.push(a); return { recordingUrl: 'u', recordingPath: 'p' }; },
      log: quiet,
    });
    assert.equal(out.ok, true);
    assert.equal(out.attempts, 3);
    assert.deepEqual(slept, [2000, 5000]);
    assert.equal(fetchImpl.calls.length, 3);
    assert.equal(up.length, 1);
    assert.equal(up[0].extension, 'wav');
  });

  it('403 is retried too; 410 stops at once', async () => {
    const a = await copyRecordingWithRetry({ callSid: 'a', url: PROVIDER, fetchImpl: seqFetch([403, 200]), sleep: async () => {}, upload: async () => ({}), log: quiet });
    assert.equal(a.ok, true);
    assert.equal(a.attempts, 2);
    const b = await copyRecordingWithRetry({ callSid: 'b', url: PROVIDER, fetchImpl: seqFetch([410]), sleep: async () => {}, upload: async () => ({}), log: quiet });
    assert.equal(b.ok, false);
    assert.equal(b.attempts, 1);
  });

  it('always 404: six tries, then gives up', async () => {
    const out = await copyRecordingWithRetry({ callSid: 'c', url: PROVIDER, fetchImpl: seqFetch([404]), sleep: async () => {}, upload: async () => ({}), log: quiet });
    assert.equal(out.ok, false);
    assert.equal(out.attempts, 6);
    assert.equal(out.lastStatus, 404);
  });
});

describe('db.attachRecording', () => {
  beforeEach(() => { rows.clear(); uploads.length = 0; });

  it('saves the provider URL right away, before any download', async () => {
    rows.set('HD_1', { sautikit_call_sid: 'HD_1', summary: '{}', status: 'in_progress' });
    const fetchImpl = seqFetch([404]);
    let release;
    const gate = new Promise((r) => { release = r; });
    await db.attachRecording({
      callSid: 'HD_1', sourceUrl: PROVIDER, recordingUrl: PROVIDER,
      copyOptions: { fetchImpl, sleep: () => gate },
    });
    assert.equal(rows.get('HD_1').recording_url, PROVIDER);
    assert.equal(rows.get('HD_1').status, 'complete');
    release();
  });

  it('404, 404, 200: Storage URL and path replace the provider URL', async () => {
    rows.set('HD_2', { sautikit_call_sid: 'HD_2', summary: '{}' });
    await db.attachRecording({
      callSid: 'HD_2', sourceUrl: PROVIDER, recordingUrl: PROVIDER, recordingSid: 'rs',
      copy: 'await', copyOptions: { fetchImpl: seqFetch([404, 404, 200]), sleep: async () => {} },
    });
    const row = rows.get('HD_2');
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].path, 'HD_2/rs.wav');
    assert.match(row.recording_url, /supa\.example\/signed\/HD_2\/rs\.wav/);
    const meta = JSON.parse(row.summary);
    assert.equal(meta.recording_path, 'HD_2/rs.wav');
    assert.equal(meta.recording_status, undefined);
  });

  it('never lands: keeps provider URL and marks pending_copy', async () => {
    rows.set('HD_3', { sautikit_call_sid: 'HD_3', summary: '{}' });
    await db.attachRecording({
      callSid: 'HD_3', sourceUrl: PROVIDER, recordingUrl: PROVIDER,
      copy: 'await', copyOptions: { fetchImpl: seqFetch([404]), sleep: async () => {} },
    });
    const row = rows.get('HD_3');
    assert.equal(row.recording_url, PROVIDER);
    const meta = JSON.parse(row.summary);
    assert.equal(meta.recording_status, 'pending_copy');
    assert.match(meta.recording_copy_last_error, /HTTP 404/);
  });

  it('sweep retries count up and end at copy_failed', async () => {
    rows.set('HD_4', { sautikit_call_sid: 'HD_4', summary: JSON.stringify({ recording_status: 'pending_copy', recording_copy_attempts: 5 }) });
    await db.copyRecordingToStorage({ callSid: 'HD_4', url: PROVIDER, delays: [], fetchImpl: seqFetch([404]), fromSweep: true });
    assert.equal(JSON.parse(rows.get('HD_4').summary).recording_status, 'copy_failed');
  });
});
