'use strict';

// greeting_language.sql (13c): tenants.greeting_text / greeting_language and
// contacts.last_language / last_language_at, plus the db.js read/write
// contract. Fake Supabase client: no network.

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const calls = [];
let missing = new Set();
let tables = {};
let failUpdate = null;
let throwUpdate = false;

function project(row, cols) {
  const keep = cols.split(',').map((c) => c.trim());
  return Object.fromEntries(keep.filter((k) => k in row).map((k) => [k, row[k]]));
}

// Chainable query: records ops, resolves on await / maybeSingle.
function query(table) {
  const q = { table, op: 'select', cols: '*', filters: [], patch: null, single: false };
  const run = () => {
    calls.push({ ...q, filters: [...q.filters] });
    const miss = [...missing].find((c) => new RegExp(`\\b${c}\\b`).test(q.op === 'update' ? Object.keys(q.patch).join(',') : q.cols));
    if (q.op === 'update' && throwUpdate) throw new Error('socket hang up');
    if (miss) return { data: null, error: { message: `column ${table}.${miss} does not exist` } };
    if (q.op === 'update' && failUpdate) return { data: null, error: { message: failUpdate } };
    let rows = (tables[table] || []).filter((r) =>
      q.filters.every(([kind, col, v]) =>
        kind === 'eq' ? r[col] === v : kind === 'is' ? (r[col] ?? null) === v : v.includes(r[col])
      )
    );
    if (q.op === 'update') {
      rows.forEach((r) => Object.assign(r, q.patch));
      return { data: rows.map((r) => (q.cols && q.cols !== '*' ? project(r, q.cols) : { id: r.id })), error: null };
    }
    rows = rows.map((r) => project(r, q.cols));
    if (q.single) return { data: rows[0] || null, error: null };
    return { data: rows, error: null };
  };
  const b = {
    select(cols) { q.cols = cols; return b; },
    update(patch) { q.op = 'update'; q.patch = patch; return b; },
    eq(col, v) { q.filters.push(['eq', col, v]); return b; },
    in(col, v) { q.filters.push(['in', col, v]); return b; },
    is(col, v) { q.filters.push(['is', col, v]); return b; }, neq() { return b; }, gte() { return b; }, lte() { return b; }, lt() { return b; }, gt() { return b; },
    not() { return b; }, or() { return b; }, order() { return b; }, limit() { return b; },
    maybeSingle() { q.single = true; return Promise.resolve().then(run); },
    then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
  };
  return b;
}

let rpcError = null;
async function fakeRpc(fn, args) {
  calls.push({ table: 'rpc', op: fn, args });
  if (rpcError) return { data: null, error: { message: rpcError } };
  assert.equal(fn, 'bump_call_stream_seq');
  const row = (tables.calls || []).find((r) => r.sautikit_call_sid === args.p_call_sid);
  if (!row) return { data: null, error: null };
  row.stream_seq = (row.stream_seq || 0) + 1;
  row.last_stream_at = new Date().toISOString();
  return { data: row.stream_seq, error: null };
}

let db;
before(() => {
  const clientPath = require.resolve('../src/lib/supabaseClient');
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { supabase: { from: query, rpc: fakeRpc } } };
  delete process.env.TENANT_ID;
  db = require('../src/db');
});

beforeEach(() => {
  calls.length = 0;
  missing = new Set();
  failUpdate = null;
  throwUpdate = false;
  rpcError = null;
  tables = {
    tenants: [{ id: 't1', business_name: 'Shop', spoken_name: 'Shopu', greeting_invite: 'Karibu', greeting_text: 'Habari, hii ni Shopu.', greeting_language: 'sw', is_active: true }],
    contacts: [{ id: 'c1', tenant_id: 't1', phone: '+254712345678', name: 'Wanjiku', notes: null, last_reason: null, metadata: {}, last_language: 'sw', last_language_at: '2026-10-20T08:00:00Z' }],
    service_requests: [],
    appointments: [],
    calls: [{ id: '55555555-5555-4555-8555-555555555555', sautikit_call_sid: 'HD_a1', greeted_at: null, last_agent_line: null, notice_given: false, stream_seq: 0, last_stream_at: null }],
  };
});

const quiet = async (fn) => {
  const w = console.warn;
  const logs = [];
  console.warn = (...a) => logs.push(a.join(' '));
  try { return { out: await fn(), logs }; } finally { console.warn = w; }
};

describe('greeting_language.sql', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../docs/supabase/greeting_language.sql'), 'utf8');
  it('is additive, idempotent, ASCII, en/sw only, and grants owners only the tenant columns', () => {
    assert.match(sql, /Run after greeting_spoken_name\.sql and contacts_and_requests\.sql/);
    assert.ok(/^[\x00-\x7F]*$/.test(sql), 'ASCII only');
    assert.doesNotMatch(sql, /drop (table|column)/i);
    assert.match(sql, /add column if not exists greeting_text text/);
    assert.match(sql, /add column if not exists greeting_language text/);
    assert.match(sql, /add column if not exists last_language text/);
    assert.match(sql, /add column if not exists last_language_at timestamptz/);
    assert.match(sql, /char_length\(greeting_text\) <= 240/);
    assert.match(sql, /greeting_language in \('en', 'sw'\)/);
    assert.match(sql, /last_language in \('en', 'sw'\)/);
    assert.match(sql, /grant update \(greeting_text, greeting_language\) on public\.tenants to authenticated/);
    assert.doesNotMatch(sql, /grant[^;]*last_language[^;]*to authenticated/i);
  });
  it('is listed in the README apply order as 13c after 13b', () => {
    const readme = fs.readFileSync(path.join(__dirname, '../docs/supabase/README.md'), 'utf8');
    const b = readme.indexOf('| 13b | [`greeting_spoken_name.sql`]');
    const c = readme.indexOf('| 13c | [`greeting_language.sql`]');
    assert.ok(b > 0 && c > b);
  });
});

describe('getTenantById / profile greeting columns', () => {
  it('selects greeting_text + greeting_language and maps them onto the profile', async () => {
    const row = await db.getTenantById('t1');
    assert.equal(row.greeting_text, 'Habari, hii ni Shopu.');
    assert.match(calls[0].cols, /greeting_text, greeting_language/);
    const { tenantProfileFromRow } = require('../src/tenantProfile');
    const p = tenantProfileFromRow(row);
    assert.equal(p.greetingText, 'Habari, hii ni Shopu.');
    assert.equal(p.greetingLanguage, 'sw');
    assert.equal(p.spokenName, 'Shopu');
  });
  it('an unmigrated database falls back to the pre-13c select and keeps spoken_name', async () => {
    missing = new Set(['greeting_text']);
    const row = await db.getTenantById('t1');
    assert.equal(row.spoken_name, 'Shopu');
    assert.equal(row.greeting_text, undefined);
    assert.ok(calls.some((c) => c.table === 'tenants' && /spoken_name/.test(c.cols) && !/greeting_text/.test(c.cols)));
    const p = require('../src/tenantProfile').tenantProfileFromRow(row);
    assert.equal(p.greetingText, null);
    assert.equal(p.greetingLanguage, null);
  });
  it('unknown greeting_language reads as null', () => {
    const { tenantProfileFromRow } = require('../src/tenantProfile');
    assert.equal(tenantProfileFromRow({ id: 'x', greeting_language: 'fr' }).greetingLanguage, null);
    assert.equal(tenantProfileFromRow({ id: 'x', greeting_language: ' EN ' }).greetingLanguage, 'en');
  });
});

describe('normalizeCallerLanguage', () => {
  it('maps sheng to sw and drops mixed/unknown', () => {
    assert.equal(db.normalizeCallerLanguage('en'), 'en');
    assert.equal(db.normalizeCallerLanguage('sw'), 'sw');
    assert.equal(db.normalizeCallerLanguage('sheng'), 'sw');
    assert.equal(db.normalizeCallerLanguage('mixed'), null);
    assert.equal(db.normalizeCallerLanguage('unknown'), null);
    assert.equal(db.normalizeCallerLanguage(null), null);
  });
});

describe('saveCallerLanguage', () => {
  it('writes last_language + last_language_at on the existing contact (sheng -> sw)', async () => {
    tables.contacts[0].last_language = 'en';
    const out = await db.saveCallerLanguage({ tenantId: 't1', phone: '0712345678', language: 'sheng' });
    assert.deepEqual(out, { ok: true, updated: 1 });
    assert.equal(tables.contacts[0].last_language, 'sw');
    assert.ok(tables.contacts[0].last_language_at);
    const upd = calls.find((c) => c.op === 'update');
    assert.deepEqual(Object.keys(upd.patch).sort(), ['last_language', 'last_language_at']);
    assert.equal(tables.contacts[0].name, 'Wanjiku');
    assert.ok(upd.filters.some(([k, col, v]) => k === 'in' && col === 'phone' && v.includes('+254712345678')));
  });
  it('mixed / unknown write nothing and keep the previous value', async () => {
    for (const language of ['mixed', 'unknown', '']) {
      const out = await db.saveCallerLanguage({ tenantId: 't1', phone: '+254712345678', language });
      assert.equal(out.updated, 0);
      assert.equal(out.skipped, 'no_language');
    }
    assert.equal(calls.length, 0);
    assert.equal(tables.contacts[0].last_language, 'sw');
  });
  it('never throws: a missing column or a thrown client returns ok:false with a warning', async () => {
    missing = new Set(['last_language']);
    let r = await quiet(() => db.saveCallerLanguage({ tenantId: 't1', phone: '+254712345678', language: 'en' }));
    assert.equal(r.out.ok, false);
    assert.ok(r.logs.some((l) => /saveCallerLanguage failed \(apply greeting_language\.sql\)/.test(l)));
    missing = new Set();
    throwUpdate = true;
    r = await quiet(() => db.saveCallerLanguage({ tenantId: 't1', phone: '+254712345678', language: 'en' }));
    assert.equal(r.out.ok, false);
    assert.match(r.out.error, /socket hang up/);
  });
  it('no tenant or phone is a no-op', async () => {
    assert.equal((await db.saveCallerLanguage({ phone: '+254712345678', language: 'en' })).ok, false);
    assert.equal((await db.saveCallerLanguage({ tenantId: 't1', language: 'en' })).ok, false);
    assert.equal(calls.length, 0);
  });
});

describe('getCallerMemory last_language', () => {
  it('returns lastLanguage and lastLanguageAt on the card', async () => {
    const card = await db.getCallerMemory({ tenantId: 't1', phone: '0712345678' });
    assert.equal(card.lastLanguage, 'sw');
    assert.equal(card.lastLanguageAt, '2026-10-20T08:00:00Z');
    assert.match(calls.find((c) => c.table === 'contacts').cols, /last_language, last_language_at/);
  });
  it('an unmigrated contacts table falls back and returns lastLanguage null', async () => {
    missing = new Set(['last_language']);
    const card = await db.getCallerMemory({ tenantId: 't1', phone: '0712345678' });
    assert.ok(card);
    assert.equal(card.lastLanguage, null);
    assert.equal(card.lastLanguageAt, null);
  });
});

describe('greeting_language.sql: name confirmed + resume state', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../docs/supabase/greeting_language.sql'), 'utf8');
  it('adds the contacts name_confirmed columns, checks, FK and reset trigger', () => {
    assert.match(sql, /add column if not exists name_confirmed boolean not null default false/);
    assert.match(sql, /add column if not exists name_confirmed_at timestamptz/);
    assert.match(sql, /add column if not exists name_confirmed_source text/);
    assert.match(sql, /add column if not exists name_confirmed_call_id uuid/);
    assert.match(sql, /references public\.calls\(id\) on delete set null/);
    assert.match(sql, /name_confirmed_source in \('readback_yes', 'owner_edit'\)/);
    assert.match(sql, /not name_confirmed or \(name_confirmed_at is not null and name_confirmed_source is not null\)/);
    assert.match(sql, /new\.name is distinct from old\.name\s+and new\.name_confirmed_at is not distinct from old\.name_confirmed_at/);
    assert.match(sql, /drop trigger if exists contacts_name_confirmed_reset on public\.contacts/);
    assert.match(sql, /before update on public\.contacts/);
    assert.doesNotMatch(sql, /^\s*security definer/im);
    assert.doesNotMatch(sql, /grant[^;]*name_confirmed[^;]*to authenticated/i);
  });
  it('adds the calls resume columns and a service-role-only stream counter', () => {
    for (const col of ['greeted_at timestamptz', 'last_agent_line text', 'notice_given boolean not null default false', 'stream_seq integer not null default 0', 'last_stream_at timestamptz']) {
      assert.ok(sql.includes(`alter table public.calls add column if not exists ${col}`), col);
    }
    assert.match(sql, /char_length\(last_agent_line\) <= 500/);
    assert.match(sql, /create or replace function public\.bump_call_stream_seq\(p_call_sid text\)/);
    assert.match(sql, /revoke all on function public\.bump_call_stream_seq\(text\) from anon/);
    assert.match(sql, /grant execute on function public\.bump_call_stream_seq\(text\) to service_role/);
    assert.doesNotMatch(sql, /grant update \([^)]*(greeted_at|last_agent_line|stream_seq)/i);
  });
});

describe('confirmCallerName', () => {
  it('sets name + all four confirmed fields in one update', async () => {
    const out = await db.confirmCallerName({ tenantId: 't1', phone: '0712345678', name: ' Wanjiku Kamau ', source: 'readback_yes', callId: '55555555-5555-4555-8555-555555555555' });
    assert.deepEqual(out, { ok: true, updated: 1 });
    const upd = calls.filter((c) => c.op === 'update');
    assert.equal(upd.length, 1);
    const c = tables.contacts[0];
    assert.equal(c.name, 'Wanjiku Kamau');
    assert.equal(c.name_confirmed, true);
    assert.ok(c.name_confirmed_at);
    assert.equal(c.name_confirmed_source, 'readback_yes');
    assert.equal(c.name_confirmed_call_id, '55555555-5555-4555-8555-555555555555');
  });
  it('a HD_ SID callId stores null call id; bad source / no name refused without a DB call', async () => {
    await db.confirmCallerName({ tenantId: 't1', phone: '0712345678', name: 'W', callId: 'HD_a1' });
    assert.equal(tables.contacts[0].name_confirmed_call_id, null);
    calls.length = 0;
    assert.equal((await db.confirmCallerName({ tenantId: 't1', phone: '0712345678', name: 'W', source: 'guess' })).ok, false);
    assert.equal((await db.confirmCallerName({ tenantId: 't1', phone: '0712345678', name: '  ' })).skipped, 'no_name');
    assert.equal(calls.length, 0);
  });
  it('never throws', async () => {
    throwUpdate = true;
    const r = await quiet(() => db.confirmCallerName({ tenantId: 't1', phone: '0712345678', name: 'W' }));
    assert.equal(r.out.ok, false);
    assert.ok(r.logs.some((l) => /confirmCallerName threw/.test(l)));
  });
  it('getCallerMemory carries nameConfirmed for callOpening.js', async () => {
    let card = await db.getCallerMemory({ tenantId: 't1', phone: '0712345678' });
    assert.equal(card.nameConfirmed, false);
    tables.contacts[0].name_confirmed = true;
    tables.contacts[0].name_confirmed_at = '2026-10-21T10:00:00Z';
    card = await db.getCallerMemory({ tenantId: 't1', phone: '0712345678' });
    assert.equal(card.nameConfirmed, true);
    assert.equal(card.nameConfirmedAt, '2026-10-21T10:00:00Z');
    missing = new Set(['name_confirmed']);
    card = await db.getCallerMemory({ tenantId: 't1', phone: '0712345678' });
    assert.equal(card.nameConfirmed, false);
  });
});

describe('calls resume state', () => {
  it('markCallGreeted: exactly one claim wins, the second sees greetedAt', async () => {
    const [a, b] = await Promise.all([
      db.markCallGreeted({ callSid: 'HD_a1', lastAgentLine: 'Hapa ni Shopu. Nikusaidie vipi?', noticeGiven: true }),
      db.markCallGreeted({ callSid: 'HD_a1', lastAgentLine: 'other' }),
    ]);
    assert.equal([a, b].filter((r) => r.won === true).length, 1);
    const loser = a.won ? b : a;
    assert.equal(loser.ok, true);
    assert.equal(loser.won, false);
    assert.ok(loser.greetedAt);
    assert.equal(tables.calls[0].last_agent_line, 'Hapa ni Shopu. Nikusaidie vipi?');
    assert.equal(tables.calls[0].notice_given, true);
    const upd = calls.find((c) => c.op === 'update' && c.table === 'calls');
    assert.ok(upd.filters.some(([k, col, v]) => k === 'is' && col === 'greeted_at' && v === null));
  });
  it('markCallGreeted: no calls row is missing; an error is ok:false won:null (fail open)', async () => {
    assert.deepEqual(await db.markCallGreeted({ callSid: 'HD_none' }), { ok: true, won: false, missing: true });
    missing = new Set(['greeted_at']);
    const r = await quiet(() => db.markCallGreeted({ callSid: 'HD_a1' }));
    assert.equal(r.out.ok, false);
    assert.equal(r.out.won, null);
    assert.ok(r.logs.some((l) => /markCallGreeted failed/.test(l) && /apply greeting_language\.sql/.test(l)));
  });
  it('getCallResumeState maps the row; null when missing or on error', async () => {
    tables.calls[0].greeted_at = '2026-10-21T10:00:00Z';
    tables.calls[0].last_agent_line = 'Karibu';
    tables.calls[0].stream_seq = 2;
    assert.deepEqual(await db.getCallResumeState('HD_a1'), { greetedAt: '2026-10-21T10:00:00Z', lastAgentLine: 'Karibu', noticeGiven: false, streamSeq: 2, lastStreamAt: null });
    assert.equal(await db.getCallResumeState('HD_none'), null);
    missing = new Set(['stream_seq']);
    assert.equal((await quiet(() => db.getCallResumeState('HD_a1'))).out, null);
  });
  it('updateLastAgentLine trims to 500 and never throws', async () => {
    assert.deepEqual(await db.updateLastAgentLine('HD_a1', 'x'.repeat(800)), { ok: true });
    assert.equal(tables.calls[0].last_agent_line.length, 500);
    throwUpdate = true;
    assert.equal((await quiet(() => db.updateLastAgentLine('HD_a1', 'hi'))).out.ok, false);
    assert.equal((await db.updateLastAgentLine('', 'hi')).ok, false);
  });
  it('bumpStreamSeq uses the atomic RPC; missing row and RPC error do not throw', async () => {
    assert.deepEqual(await db.bumpStreamSeq('HD_a1'), { ok: true, streamSeq: 1 });
    assert.deepEqual(await db.bumpStreamSeq('HD_a1'), { ok: true, streamSeq: 2 });
    assert.deepEqual(await db.bumpStreamSeq('HD_none'), { ok: true, streamSeq: null, missing: true });
    rpcError = 'Could not find the function public.bump_call_stream_seq';
    const r = await quiet(() => db.bumpStreamSeq('HD_a1'));
    assert.equal(r.out.ok, false);
    assert.ok(r.logs.some((l) => /apply greeting_language\.sql/.test(l)));
  });
});
