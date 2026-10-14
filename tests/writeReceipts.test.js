'use strict';
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { writeReceiptsEnabled, writeKey, callbackSupersededBy } = require('../src/conversation/writeReceipts');

const log = [];
const tables = { calls: [], service_requests: [], appointments: [], contacts: [] };
let nextId = 1;

function builder(table) {
  const st = { table, op: 'select', filters: [], row: null, opts: null };
  const run = () => {
    log.push({ table, op: st.op, row: st.row, opts: st.opts, filters: st.filters.slice() });
    const rows = tables[table] || [];
    const match = (r) => st.filters.every(([k, v]) => r[k] === v);
    if (st.op === 'upsert') {
      const dup = rows.find((r) => r.tenant_id === st.row.tenant_id && r.idempotency_key && r.idempotency_key === st.row.idempotency_key);
      if (dup) return { data: null, error: null };
      const r = { id: `row-${nextId++}`, ...st.row }; rows.push(r); return { data: r, error: null };
    }
    if (st.op === 'insert') { const r = { id: `row-${nextId++}`, ...st.row }; rows.push(r); return { data: r, error: null }; }
    if (st.op === 'update') { const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, st.row)); return { data: hit[0] || null, error: null }; }
    const hit = rows.filter(match);
    return { data: st.single ? hit[0] || null : hit, error: null };
  };
  const b = {
    select() { return b; },
    insert(row) { st.op = 'insert'; st.row = row; return b; },
    upsert(row, opts) { st.op = 'upsert'; st.row = row; st.opts = opts; return b; },
    update(row) { st.op = 'update'; st.row = row; return b; },
    eq(k, v) { st.filters.push([k, v]); return b; },
    in() { return b; }, order() { return b; }, limit() { return b; }, is() { return b; }, ilike() { return b; }, or() { return b; }, neq() { return b; },
    maybeSingle() { st.single = true; return Promise.resolve(run()); },
    single() { st.single = true; return Promise.resolve(run()); },
    then(res, rej) { return Promise.resolve(run()).then(res, rej); },
  };
  return b;
}

const rpcCalls = [];
// Mirrors create_appointment_superseding: insert, then close listed open
// callbacks on the same tenant AND caller phone, atomically.
function fakeRpc(fn, args) {
  rpcCalls.push({ fn, args });
  if (fn !== 'create_appointment_superseding') return { data: null, error: null };
  const appt = { id: `row-${nextId++}`, ...args.p_row, status: 'requested' };
  tables.appointments.push(appt);
  const closed = [];
  for (const r of tables.service_requests) {
    if (!args.p_supersedes.includes(r.id)) continue;
    if (r.tenant_id !== appt.tenant_id || r.caller_phone !== appt.caller_phone || r.status !== 'open') continue;
    r.status = 'fulfilled'; r.metadata = { ...(r.metadata || {}), superseded_by: appt.id };
    closed.push(r.id);
  }
  return { data: { appointment: appt, superseded: closed }, error: null };
}

let db;
before(() => {
  const clientPath = require.resolve('../src/lib/supabaseClient');
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { supabase: { from: builder, rpc: async (fn, args) => fakeRpc(fn, args) } } };
  db = require('../src/db');
});

beforeEach(() => {
  log.length = 0;
  for (const k of Object.keys(tables)) tables[k].length = 0;
  rpcCalls.length = 0;
  require('../src/notifications/ownerNotifyQueue').resetOwnerNotifyQueue();
  delete process.env.WRITE_RECEIPTS;
  delete process.env.WRITE_RECEIPTS_TENANTS;
});

describe('writeReceipts flag and keys', () => {
  it('is off by default and honours the tenant allowlist', () => {
    assert.equal(writeReceiptsEnabled({ env: {} }), false);
    assert.equal(writeReceiptsEnabled({ env: { WRITE_RECEIPTS: '1' }, tenantId: 't' }), true);
    assert.equal(writeReceiptsEnabled({ env: { WRITE_RECEIPTS: '1', WRITE_RECEIPTS_TENANTS: 'a,b' }, tenantId: 't' }), false);
  });
  it('keys one logical write per call, kind and item', () => {
    assert.equal(writeKey({ callId: 'c1', kind: 'appointment', item: 'Mattress cleaning' }), 'call:c1:appointment:mattress-cleaning');
    assert.equal(writeKey({ callId: 'c1', kind: 'appointment', item: ' mattress  CLEANING ' }), 'call:c1:appointment:mattress-cleaning');
    assert.equal(writeKey({ kind: 'appointment' }), null);
  });
  it('HD_4ec204aafa93: the mattress rescue callback is superseded by the booked visit', () => {
    const cb = { request_type: 'callback', status: 'open', item: 'Mattress cleaning', call_id: 'c1' };
    assert.equal(callbackSupersededBy(cb, { service_name: 'Mattress cleaning', call_id: 'c1' }), true);
    assert.equal(callbackSupersededBy({ ...cb, item: 'visit' }, { service_name: 'Sofa', call_id: 'c1' }), true);
    assert.equal(callbackSupersededBy({ ...cb, item: 'message' }, { service_name: 'Sofa', call_id: 'c1' }), false);
    assert.equal(callbackSupersededBy(cb, { service_name: 'Carpet cleaning', call_id: 'c1' }), false);
    assert.equal(callbackSupersededBy(cb, { service_name: 'Mattress cleaning', call_id: 'c2' }), false);
    assert.equal(callbackSupersededBy({ ...cb, request_type: 'enquiry' }, { service_name: 'Mattress cleaning', call_id: 'c1' }), false);
  });
});

describe('db insertWithReceipt / supersedeRescueCallbacks', () => {
  it('without a key, plain insert (flag off path unchanged)', async () => {
    await db.insertWithReceipt('appointments', { tenant_id: 't', service_name: 'X' }, null);
    assert.equal(log[0].op, 'insert');
    assert.equal(tables.appointments.length, 1);
  });
  it('with a key, a repeated write upserts onConflict and returns the existing row', async () => {
    const row = { tenant_id: 't', service_name: 'X' };
    const a = await db.insertWithReceipt('appointments', row, 'call:c1:appointment:x');
    const b = await db.insertWithReceipt('appointments', row, 'call:c1:appointment:x');
    assert.equal(tables.appointments.length, 1);
    assert.equal(a.data.id, b.data.id);
    assert.equal(log[0].opts.onConflict, 'tenant_id,idempotency_key');
    assert.equal(log[0].opts.ignoreDuplicates, true);
  });
  it('closes the open rescue callback for the booked service, not others', async () => {
    tables.service_requests.push(
      { id: 'cb1', tenant_id: 't', call_id: 'c1', request_type: 'callback', status: 'open', item: 'Mattress cleaning', metadata: {} },
      { id: 'cb2', tenant_id: 't', call_id: 'c1', request_type: 'callback', status: 'open', item: 'Carpet cleaning', metadata: {} }
    );
    const done = await db.supersedeRescueCallbacks({ tenantId: 't', appointment: { id: 'ap1', call_id: 'c1', service_name: 'Mattress cleaning' } });
    assert.deepEqual(done, ['cb1']);
    assert.equal(tables.service_requests[0].status, 'fulfilled');
    assert.equal(tables.service_requests[0].metadata.superseded_by, 'ap1');
    assert.equal(tables.service_requests[1].status, 'open');
  });
});

describe('Brain v2 contract: createAppointment supersedes[] (one transaction)', () => {
  const q = () => require('../src/notifications/ownerNotifyQueue');
  it('closes listed tasks on tenant AND phone, cancels their queued owner notify', async () => {
    tables.service_requests.push(
      { id: 'cb1', tenant_id: 't', request_type: 'callback', status: 'open', caller_phone: '+254707222419', item: 'Mattress cleaning', metadata: {} },
      { id: 'cbOther', tenant_id: 't', request_type: 'callback', status: 'open', caller_phone: '+254700000001', item: 'x', metadata: {} }
    );
    let fired = 0;
    q().queueOwnerNotify('cb1', () => { fired += 1; }, { delay: 50 });
    q().queueOwnerNotify('cbOther', () => {}, { delay: 50 });
    const out = await db.createAppointment({ tenantId: 't', serviceName: 'Mattress cleaning', phone: '+254707222419', whenText: 'Thu 9 AM', supersedes: ['cb1', 'cbOther'] });
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].fn, 'create_appointment_superseding');
    assert.deepEqual(out.superseded, ['cb1']);
    assert.deepEqual(out.notifyCancelled, ['cb1']);
    assert.equal(tables.service_requests[0].metadata.superseded_by, out.id);
    assert.equal(tables.service_requests[1].status, 'open', 'other phone untouched');
    assert.equal(q().isOwnerNotifyQueued('cbOther'), true);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(fired, 0, 'superseded task notify never sent');
  });
  it('empty or missing supersedes uses the plain insert path', async () => {
    const a = await db.createAppointment({ tenantId: 't', serviceName: 'Sofa', phone: '+254707222419', supersedes: [] });
    const b = await db.createAppointment({ tenantId: 't', serviceName: 'Sofa', phone: '+254707222419' });
    assert.ok(a.id && b.id);
    assert.equal(rpcCalls.length, 0);
    assert.equal(a.supersedes, undefined);
  });
});

describe('Brain v2 contract: escalateTask resolves on the row, notify queued', () => {
  it('returns {ok,id,notify:queued} before the owner notify runs; failure does not flip ok', async () => {
    let started = false;
    const warns = []; const orig = console.warn; console.warn = (...a) => warns.push(a.join(' '));
    try {
      const out = await db.escalateTask({
        tenantId: 't', phone: '+254707222419', reason: 'callback:ladder', name: 'Chris',
        notifyOwner: async () => { started = true; throw new Error('smtp down'); },
      });
      assert.equal(out.ok, true);
      assert.ok(out.id);
      assert.equal(out.notify, 'queued');
      assert.equal(started, false, 'notify not awaited');
      assert.equal(tables.service_requests[0].request_type, 'callback');
      process.env.OWNER_NOTIFY_QUEUE_MS = '0';
    } finally { /* restore below */ }
    await new Promise((r) => setTimeout(r, 1700));
    console.warn = orig;
    delete process.env.OWNER_NOTIFY_QUEUE_MS;
    assert.equal(started, true);
    assert.ok(warns.some((w) => w.includes('[owner-notify]') && w.includes('smtp down')));
  });
  it('dry run returns the contract shape and writes nothing', async () => {
    const out = await db.escalateTask({ tenantId: 't', reason: 'complaint:late', dryRun: true });
    assert.deepEqual(Object.keys(out).sort(), ['dryRun', 'id', 'intended', 'notify', 'ok']);
    assert.equal(out.ok, true); assert.equal(out.dryRun, true); assert.equal(out.id, null); assert.equal(out.notify, 'queued');
    assert.equal(out.intended.reason, 'complaint:late');
    assert.equal(tables.service_requests.length, 0);
  });
});
