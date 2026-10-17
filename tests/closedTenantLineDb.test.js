'use strict';

// db.tenantLineClosed and getTenantById line columns (VOICE_CLOSED_TENANT_GUARD).
// Fake Supabase client: no network.

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

let tenantRows = [];
let failWith = null;
let missing = new Set();
const selects = [];

function project(row, cols) {
  const keep = cols.split(',').map((c) => c.trim());
  return Object.fromEntries(keep.filter((k) => k in row).map((k) => [k, row[k]]));
}

function fakeSupabase() {
  return {
    from(table) {
      assert.equal(table, 'tenants');
      return {
        select(cols) {
          selects.push(cols);
          const miss = [...missing].find((c) => new RegExp(`\\b${c}\\b`).test(cols));
          const error = failWith
            ? { message: failWith }
            : miss
              ? { message: `column tenants.${miss} does not exist` }
              : null;
          const run = (filter) =>
            error ? { data: null, error } : { data: tenantRows.filter(filter).map((r) => project(r, cols)), error: null };
          const all = Promise.resolve(run(() => true));
          all.eq = (col, value) => {
            const res = run((r) => r[col] === value);
            const q = Promise.resolve(res);
            q.maybeSingle = async () => (res.error ? res : { data: res.data[0] || null, error: null });
            return q;
          };
          return all;
        },
      };
    },
  };
}

const ROWS = [
  { id: 'active', business_name: 'Live Co', sautikit_virtual_number: '+254700000001', is_active: true, archived_at: null, line_status: 'active' },
  { id: 'suspended', business_name: 'Unpaid Co', sautikit_virtual_number: '+254700000002', is_active: true, archived_at: null, line_status: 'suspended' },
  { id: 'archived', business_name: 'Gone Co', sautikit_virtual_number: '+254700000003', is_active: true, archived_at: '2026-10-17T10:00:00Z', line_status: 'active' },
  { id: 'inactive', business_name: 'Paused Co', sautikit_virtual_number: '+254700000004', is_active: false, archived_at: null, line_status: 'active' },
  { id: 'grace', business_name: 'Grace Co', sautikit_virtual_number: '+254700000005', is_active: true, archived_at: null, line_status: 'grace' },
];

let db;
const warnings = [];
const realWarn = console.warn;
before(() => {
  const clientPath = require.resolve('../src/lib/supabaseClient');
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { supabase: fakeSupabase() } };
  delete process.env.TENANT_ID;
  db = require('../src/db');
});

beforeEach(() => {
  tenantRows = ROWS.map((r) => ({ ...r }));
  failWith = null;
  missing = new Set();
  selects.length = 0;
  warnings.length = 0;
  db.forgetTenantLine();
});

function captureWarn() {
  console.warn = (...args) => warnings.push(args.join(' '));
  return () => {
    console.warn = realWarn;
  };
}

describe('db.tenantLineClosed', () => {
  it('suspended, archived and is_active=false are closed; active and grace are open', async () => {
    assert.deepEqual(await db.tenantLineClosed('suspended'), { closed: true, reason: 'suspended', tenantId: 'suspended' });
    assert.deepEqual(await db.tenantLineClosed('archived'), { closed: true, reason: 'archived', tenantId: 'archived' });
    assert.deepEqual(await db.tenantLineClosed('inactive'), { closed: true, reason: 'inactive', tenantId: 'inactive' });
    assert.deepEqual(await db.tenantLineClosed('active'), { closed: false, reason: 'live', tenantId: 'active' });
    assert.deepEqual(await db.tenantLineClosed('grace'), { closed: false, reason: 'live', tenantId: 'grace' });
  });

  it('unknown tenant and no id answer open', async () => {
    assert.deepEqual(await db.tenantLineClosed('nobody'), { closed: false, reason: 'no_tenant', tenantId: 'nobody' });
    assert.equal((await db.tenantLineClosed('')).closed, false);
    assert.equal((await db.tenantLineClosed(null)).closed, false);
  });

  it('reads one tenant through the selectTenantLineRows ladder (line_status missing → archived_at still closes)', async () => {
    missing = new Set(['line_status']);
    assert.deepEqual(await db.tenantLineClosed('archived'), { closed: true, reason: 'archived', tenantId: 'archived' });
    // suspended cannot be seen without the column: never a closure on an older schema.
    assert.deepEqual(await db.tenantLineClosed('suspended'), { closed: false, reason: 'live', tenantId: 'suspended' });
    assert.ok(selects.some((c) => /line_status/.test(c)), 'tried the full select first');
    assert.ok(selects.some((c) => /archived_at/.test(c) && !/line_status/.test(c)), 'fell back without line_status');
  });

  it('caches for ~60 s: a second ask does not query again', async () => {
    await db.tenantLineClosed('suspended');
    const n = selects.length;
    await db.tenantLineClosed('suspended');
    assert.equal(selects.length, n);
    db.forgetTenantLine('suspended');
    await db.tenantLineClosed('suspended');
    assert.ok(selects.length > n);
  });

  it('lookup error fails open with a log and is not cached', async () => {
    const restore = captureWarn();
    try {
      failWith = 'connection reset';
      assert.deepEqual(await db.tenantLineClosed('suspended'), { closed: false, reason: 'lookup_failed', tenantId: 'suspended' });
      assert.ok(warnings.some((w) => /\[closed-tenant\] line lookup failed tenant=suspended/.test(w) && /connection reset/.test(w)));
      failWith = null;
      assert.deepEqual(await db.tenantLineClosed('suspended'), { closed: true, reason: 'suspended', tenantId: 'suspended' });
    } finally {
      restore();
    }
  });
});

describe('getTenantById line columns and profile.lineState', () => {
  const { tenantProfileFromRow } = require('../src/tenantProfile');

  it('selects archived_at and line_status on the main select', async () => {
    const row = await db.getTenantById('suspended');
    assert.equal(row.line_status, 'suspended');
    assert.ok(selects[0].includes('archived_at') && selects[0].includes('line_status'));
    assert.deepEqual(tenantProfileFromRow(row).lineState, { closed: true, reason: 'suspended', tenantId: 'suspended' });
  });

  it('column fallback: a schema without line_status keeps the row and archived_at', async () => {
    missing = new Set(['line_status']);
    const row = await db.getTenantById('archived');
    assert.equal(row.business_name, 'Gone Co');
    assert.equal(row.archived_at, '2026-10-17T10:00:00Z');
    assert.equal('line_status' in row, false);
    assert.deepEqual(tenantProfileFromRow(row).lineState, { closed: true, reason: 'archived', tenantId: 'archived' });
  });

  it('a schema with neither column still returns the row (line answers open)', async () => {
    missing = new Set(['line_status', 'archived_at']);
    const row = await db.getTenantById('active');
    assert.equal(row.business_name, 'Live Co');
    assert.equal(tenantProfileFromRow(row).lineState, null);
  });

  it('an unrelated older-schema error still walks the existing ladder', async () => {
    missing = new Set(['spoken_name']);
    const row = await db.getTenantById('inactive');
    assert.equal(row.business_name, 'Paused Co');
    assert.equal(row.is_active, false);
    assert.deepEqual(tenantProfileFromRow(row).lineState, { closed: true, reason: 'inactive', tenantId: 'inactive' });
  });

  it('active and grace profiles have lineState null', async () => {
    assert.equal(tenantProfileFromRow(await db.getTenantById('active')).lineState, null);
    assert.equal(tenantProfileFromRow(await db.getTenantById('grace')).lineState, null);
  });
});
