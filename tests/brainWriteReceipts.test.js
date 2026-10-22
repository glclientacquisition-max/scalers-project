'use strict';

// brain_write_receipts.sql + db.recordWriteReceipt / getWriteReceipts.
// Fake Supabase client: no network.

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ops = [];
let nextResult = null;
let throwNext = false;

function builder(table) {
  const q = { table, op: null, row: null, opts: null, cols: null, filters: [], order: null };
  const settle = () => {
    ops.push(q);
    if (throwNext) throw new Error('fetch failed');
    if (nextResult) return nextResult;
    if (q.op === 'upsert') return { data: { id: '11111111-1111-4111-8111-111111111111' }, error: null };
    return { data: [{ id: 'a', phase: 'proposed' }, { id: 'b', phase: 'committed' }], error: null };
  };
  const b = {
    upsert(row, opts) { q.op = 'upsert'; q.row = row; q.opts = opts; return b; },
    select(cols) { if (!q.op) q.op = 'select'; q.cols = cols; return b; },
    eq(col, v) { q.filters.push([col, v]); return b; },
    order(col, o) { q.order = [col, o]; return b; },
    maybeSingle() { return Promise.resolve().then(settle); },
    then(res, rej) { return Promise.resolve().then(settle).then(res, rej); },
  };
  return b;
}

let db;
const warnings = [];
const realWarn = console.warn;
before(() => {
  const clientPath = require.resolve('../src/lib/supabaseClient');
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { supabase: { from: builder } } };
  db = require('../src/db');
});
beforeEach(() => {
  ops.length = 0;
  nextResult = null;
  throwNext = false;
  warnings.length = 0;
  console.warn = (...a) => warnings.push(a.join(' '));
});
process.on('exit', () => { console.warn = realWarn; });

const CALL = '22222222-2222-4222-8222-222222222222';
const TENANT = '33333333-3333-4333-8333-333333333333';
const WRITE = '44444444-4444-4444-8444-444444444444';
const base = {
  callId: CALL,
  callSid: 'HD_e75a669780d4',
  tenantId: TENANT,
  turnIndex: 4,
  path: 'v2',
  tool: 'book_appointment',
  phase: 'proposed',
  confirmToken: 'tok-1',
  tokenIssuedTurn: 4,
  idempotencyKey: 'call:book_appointment:abc123',
  slots: { service: 'plumbing', when: '2026-10-22T09:00:00+03:00' },
  validators: { hours: 'ok', area: 'ok', availability: 'ok' },
  latencyMs: 41,
};

describe('brain_write_receipts.sql', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../docs/supabase/brain_write_receipts.sql'), 'utf8');
  it('has the agreed shape, checks, indexes and RLS', () => {
    assert.ok(/^[\x00-\x7F]*$/.test(sql), 'ASCII only');
    assert.match(sql, /^-- Run after /m);
    assert.match(sql, /create table if not exists public\.brain_write_receipts/);
    assert.match(sql, /call_id uuid references public\.calls\(id\)/);
    assert.match(sql, /call_sid text/);
    assert.match(sql, /tenant_id uuid references public\.tenants\(id\)/);
    assert.match(sql, /idempotency_key text not null/);
    assert.match(sql, /slots jsonb not null default '\{\}'::jsonb/);
    assert.match(sql, /unique \(idempotency_key, phase\)/);
    assert.match(sql, /check \(path in \('v1', 'v2'\)\)/);
    assert.match(sql, /'book_appointment', 'create_order', 'request_callback', 'log_complaint', 'escalate', 'quote'/);
    assert.match(sql, /'proposed', 'confirmed', 'committed', 'failed', 'rejected'/);
    assert.match(sql, /check \(write_id is null or phase = 'committed'\)/);
    assert.match(sql, /char_length\(error_detail\) <= 500/);
    assert.match(sql, /on public\.brain_write_receipts \(call_id\)/);
    assert.match(sql, /on public\.brain_write_receipts \(call_sid\)/);
    assert.match(sql, /on public\.brain_write_receipts \(tenant_id, created_at desc\)/);
    assert.match(sql, /enable row level security/);
    assert.match(sql, /revoke all on public\.brain_write_receipts from anon/);
    assert.match(sql, /grant select on public\.brain_write_receipts to authenticated/);
    assert.match(sql, /for select\s+to authenticated\s+using \(tenant_id in \(select public\.current_user_tenant_ids\(\)\)\)/);
    assert.doesNotMatch(sql, /for (insert|update|delete|all)/i);
  });
  it('is in the README apply order', () => {
    const readme = fs.readFileSync(path.join(__dirname, '../docs/supabase/README.md'), 'utf8');
    assert.match(readme, /\[`brain_write_receipts\.sql`\]\(\.\/brain_write_receipts\.sql\)/);
  });
});

describe('recordWriteReceipt', () => {
  it('upserts one row on (idempotency_key, phase) and returns ok + id', async () => {
    const out = await db.recordWriteReceipt(base);
    assert.deepEqual(out, { ok: true, id: '11111111-1111-4111-8111-111111111111' });
    assert.equal(ops.length, 1);
    const q = ops[0];
    assert.equal(q.table, 'brain_write_receipts');
    assert.deepEqual(q.opts, { onConflict: 'idempotency_key,phase' });
    assert.equal(q.row.call_id, CALL);
    assert.equal(q.row.call_sid, 'HD_e75a669780d4');
    assert.equal(q.row.tenant_id, TENANT);
    assert.equal(q.row.turn_index, 4);
    assert.equal(q.row.confirm_token, 'tok-1');
    assert.deepEqual(q.row.validators, { hours: 'ok', area: 'ok', availability: 'ok' });
    assert.equal(q.row.write_id, null);
    assert.equal(q.row.latency_ms, 41);
  });
  it('accepts snake_case keys', async () => {
    const out = await db.recordWriteReceipt({ call_id: CALL, tenant_id: TENANT, path: 'v1', tool: 'escalate', phase: 'committed', idempotency_key: 'k', write_table: 'service_requests', write_id: WRITE });
    assert.equal(out.ok, true);
    assert.equal(ops[0].row.write_id, WRITE);
    assert.equal(ops[0].row.write_table, 'service_requests');
    assert.deepEqual(ops[0].row.slots, {});
  });
  it('keeps write_id only on committed, trims error_detail to 500, moves a SID callId to call_sid', async () => {
    await db.recordWriteReceipt({ ...base, callId: 'HD_abc', callSid: undefined, phase: 'failed', writeId: WRITE, errorCode: 'db_error', errorDetail: 'x'.repeat(900) });
    const row = ops[0].row;
    assert.equal(row.write_id, null);
    assert.equal(row.error_detail.length, 500);
    assert.equal(row.call_id, null);
    assert.equal(row.call_sid, 'HD_abc');
  });
  it('refuses an invalid receipt without a DB call and without throwing', async () => {
    for (const bad of [null, {}, { ...base, path: 'v3' }, { ...base, tool: 'delete_all' }, { ...base, phase: 'done' }, { ...base, idempotencyKey: '' }]) {
      const out = await db.recordWriteReceipt(bad);
      assert.equal(out.ok, false);
      assert.ok(out.error);
    }
    assert.equal(ops.length, 0);
    assert.ok(warnings.every((w) => /\[db\] recordWriteReceipt rejected/.test(w)));
  });
  it('never throws: a DB error or a thrown client returns ok:false and logs a structured warning', async () => {
    nextResult = { data: null, error: { message: 'relation "public.brain_write_receipts" does not exist', code: '42P01' } };
    let out = await db.recordWriteReceipt(base);
    assert.equal(out.ok, false);
    assert.match(out.error, /does not exist/);
    const w = warnings.find((x) => /recordWriteReceipt failed/.test(x));
    assert.ok(w);
    const payload = JSON.parse(w.slice(w.indexOf('{')));
    assert.equal(payload.hint, 'apply brain_write_receipts.sql');
    assert.equal(payload.code, '42P01');
    assert.equal(payload.tool, 'book_appointment');
    nextResult = null;
    throwNext = true;
    out = await db.recordWriteReceipt(base);
    assert.deepEqual(out, { ok: false, error: 'fetch failed' });
  });
});

describe('getWriteReceipts', () => {
  it('reads by callId (uuid) ordered by created_at', async () => {
    const rows = await db.getWriteReceipts({ callId: CALL });
    assert.equal(rows.length, 2);
    assert.deepEqual(ops[0].filters, [['call_id', CALL]]);
    assert.deepEqual(ops[0].order, ['created_at', { ascending: true }]);
  });
  it('reads by callSid, and a SID passed as callId', async () => {
    await db.getWriteReceipts({ callSid: 'HD_e75a669780d4' });
    await db.getWriteReceipts({ callId: 'HD_e75a669780d4' });
    assert.deepEqual(ops[0].filters, [['call_sid', 'HD_e75a669780d4']]);
    assert.deepEqual(ops[1].filters, [['call_sid', 'HD_e75a669780d4']]);
  });
  it('returns [] with nothing to read by, on error, or when the client throws', async () => {
    assert.deepEqual(await db.getWriteReceipts({}), []);
    assert.equal(ops.length, 0);
    nextResult = { data: null, error: { message: 'boom' } };
    assert.deepEqual(await db.getWriteReceipts({ callId: CALL }), []);
    nextResult = null;
    throwNext = true;
    assert.deepEqual(await db.getWriteReceipts({ callSid: 'HD_x' }), []);
  });
});

describe('exports', () => {
  it('root db.js shim re-exports both', () => {
    const shim = require('../db');
    assert.equal(typeof shim.recordWriteReceipt, 'function');
    assert.equal(typeof shim.getWriteReceipts, 'function');
  });
});
