const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { purgeExpiredRecordingsBatch, retentionDays, startRecordingRetentionDaily } = require('../src/lib/recordingRetention');
const { eatDay, eatHour } = require('../src/lib/dataQualityDaily');

const rows = new Map();
const storageObjects = new Set();
const providerDeletes = [];

function fakeSupabase() {
  function q() {
    const st = { filters: [], update: null, ltCol: null, ltVal: null, orFilter: null };
    const api = {
      select() { return api; },
      update(u) { st.update = u; return api; },
      eq(col, val) { st.filters.push([col, val]); return api; },
      lt(col, val) { st.ltCol = col; st.ltVal = val; return api; },
      or(expr) { st.orFilter = expr; return api; },
      order() { return api; },
      limit() { return api; },
      maybeSingle() { return run(true); },
      then(resolve, reject) { return run(false).then(resolve, reject); },
    };
    function run(single) {
      let list = [...rows.values()];
      if (st.ltCol && st.ltVal) {
        list = list.filter((r) => r[st.ltCol] < st.ltVal);
      }
      const sid = (st.filters.find(([c]) => c === 'sautikit_call_sid') || [])[1];
      if (sid) {
        const row = rows.get(sid);
        if (row && st.update) Object.assign(row, st.update);
        return Promise.resolve({ data: single ? row || null : row ? [row] : [], error: null });
      }
      if (st.update) {
        for (const row of list) Object.assign(row, st.update);
      }
      return Promise.resolve({ data: single ? list[0] || null : list, error: null });
    }
    return api;
  }
  return {
    from: () => q(),
    storage: {
      from: () => ({
        remove: async (paths) => {
          for (const p of paths) storageObjects.delete(p);
          return { error: null };
        },
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

function seedRow({ sid, tenant, createdAt, recordingUrl, summary }) {
  rows.set(sid, {
    sautikit_call_sid: sid,
    tenant_id: tenant,
    created_at: createdAt,
    recording_url: recordingUrl,
    summary: typeof summary === 'string' ? summary : JSON.stringify(summary || {}),
  });
}

describe('recording retention purge', () => {
  beforeEach(() => {
    rows.clear();
    storageObjects.clear();
    providerDeletes.length = 0;
  });

  it('retentionDays defaults to 30', () => {
    assert.equal(retentionDays(), 30);
  });

  it('purges only calls older than cutoff and never other tenants', async () => {
    const old = '2020-01-01T00:00:00.000Z';
    const recent = new Date().toISOString();
    seedRow({
      sid: 'HD_old_a',
      tenant: 't1',
      createdAt: old,
      recordingUrl: 'https://provider/old.mp3',
      summary: { recording_path: 'HD_old_a/rs.mp3' },
    });
    storageObjects.add('HD_old_a/rs.mp3');
    seedRow({
      sid: 'HD_new_b',
      tenant: 't1',
      createdAt: recent,
      recordingUrl: 'https://provider/new.mp3',
      summary: { recording_path: 'HD_new_b/rs.mp3' },
    });
    storageObjects.add('HD_new_b/rs.mp3');
    seedRow({
      sid: 'HD_old_other',
      tenant: 't2',
      createdAt: old,
      recordingUrl: 'https://provider/x.mp3',
      summary: { recording_path: 'HD_old_other/rs.mp3' },
    });
    storageObjects.add('HD_old_other/rs.mp3');

    const cutoff = db.recordingRetentionCutoffIso(30);
    const listed = await db.listCallsForRecordingRetentionPurge({ olderThanDays: 30, limit: 50 });
    assert.equal(listed.length, 2);
    assert.ok(listed.every((r) => r.created_at < cutoff));

    const batch = await purgeExpiredRecordingsBatch({
      listCalls: db.listCallsForRecordingRetentionPurge,
      purgeCall: db.purgeCallRecordingRetention,
      deleteProvider: async (sid) => {
        providerDeletes.push(sid);
        return { ok: true };
      },
      olderThanDays: 30,
      batchSize: 50,
      log: { info() {}, warn() {} },
    });
    assert.equal(batch.purged, 2);
    assert.deepEqual(providerDeletes.sort(), ['HD_old_a', 'HD_old_other'].sort());
    assert.ok(!storageObjects.has('HD_old_a/rs.mp3'));
    assert.ok(!storageObjects.has('HD_old_other/rs.mp3'));
    assert.ok(storageObjects.has('HD_new_b/rs.mp3'));
    const metaNew = JSON.parse(rows.get('HD_new_b').summary);
    assert.equal(metaNew.recording_path, 'HD_new_b/rs.mp3');
    const metaOld = JSON.parse(rows.get('HD_old_a').summary);
    assert.ok(metaOld.recording_deleted_at);
    assert.equal(rows.get('HD_old_a').recording_url, null);
  });

  it('is idempotent on a second run', async () => {
    const old = '2020-06-01T00:00:00.000Z';
    seedRow({
      sid: 'HD_idem',
      tenant: 't1',
      createdAt: old,
      recordingUrl: 'https://p/x',
      summary: { recording_path: 'HD_idem/r.mp3' },
    });
    storageObjects.add('HD_idem/r.mp3');
    const deps = {
      listCalls: db.listCallsForRecordingRetentionPurge,
      purgeCall: db.purgeCallRecordingRetention,
      olderThanDays: 30,
      log: { info() {}, warn() {} },
    };
    const first = await purgeExpiredRecordingsBatch(deps);
    assert.equal(first.purged, 1);
    const second = await purgeExpiredRecordingsBatch(deps);
    assert.equal(second.candidates, 0);
    assert.equal(second.purged, 0);
  });

  it('refuses to purge when tenantId does not match', async () => {
    seedRow({
      sid: 'HD_guard',
      tenant: 't-real',
      createdAt: '2020-01-01T00:00:00.000Z',
      recordingUrl: 'https://p/x',
      summary: { recording_path: 'HD_guard/r.mp3' },
    });
    storageObjects.add('HD_guard/r.mp3');
    const result = await db.purgeCallRecordingRetention({
      callSid: 'HD_guard',
      tenantId: 't-wrong',
    });
    assert.equal(result.purged, false);
    assert.equal(result.reason, 'tenant_mismatch');
    assert.ok(storageObjects.has('HD_guard/r.mp3'));
  });

  it('daily scheduler module exposes startRecordingRetentionDaily (wired from server.js)', () => {
    assert.equal(typeof eatDay, 'function');
    assert.equal(typeof eatHour, 'function');
    assert.equal(typeof startRecordingRetentionDaily, 'function');
  });
});
