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
      q.filters.every(([kind, col, v]) => (kind === 'eq' ? r[col] === v : v.includes(r[col])))
    );
    if (q.op === 'update') {
      rows.forEach((r) => Object.assign(r, q.patch));
      return { data: rows.map((r) => ({ id: r.id })), error: null };
    }
    rows = rows.map((r) => project(r, q.cols));
    if (q.single) return { data: rows[0] || null, error: null };
    return { data: rows, error: null };
  };
  const b = {
    select(cols) { if (q.op === 'select') q.cols = cols; return b; },
    update(patch) { q.op = 'update'; q.patch = patch; return b; },
    eq(col, v) { q.filters.push(['eq', col, v]); return b; },
    in(col, v) { q.filters.push(['in', col, v]); return b; },
    is() { return b; }, neq() { return b; }, gte() { return b; }, lte() { return b; }, lt() { return b; }, gt() { return b; },
    not() { return b; }, or() { return b; }, order() { return b; }, limit() { return b; },
    maybeSingle() { q.single = true; return Promise.resolve().then(run); },
    then(res, rej) { return Promise.resolve().then(run).then(res, rej); },
  };
  return b;
}

let db;
before(() => {
  const clientPath = require.resolve('../src/lib/supabaseClient');
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { supabase: { from: query } } };
  delete process.env.TENANT_ID;
  db = require('../src/db');
});

beforeEach(() => {
  calls.length = 0;
  missing = new Set();
  failUpdate = null;
  throwUpdate = false;
  tables = {
    tenants: [{ id: 't1', business_name: 'Shop', spoken_name: 'Shopu', greeting_invite: 'Karibu', greeting_text: 'Habari, hii ni Shopu.', greeting_language: 'sw', is_active: true }],
    contacts: [{ id: 'c1', tenant_id: 't1', phone: '+254712345678', name: 'Wanjiku', notes: null, last_reason: null, metadata: {}, last_language: 'sw', last_language_at: '2026-10-20T08:00:00Z' }],
    service_requests: [],
    appointments: [],
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
