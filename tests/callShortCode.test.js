// Run: node --test tests/callShortCode.test.js
// calls.short_code (supabase/migrations/20261018230000_call_short_code.sql),
// executed for real in an in-process Postgres (PGlite): random codes from the
// unambiguous alphabet, unique, backfilled, idempotent, helpers not callable
// by anon / authenticated.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FILE = 'supabase/migrations/20261018230000_call_short_code.sql';
const SQL = fs.readFileSync(path.join(__dirname, '..', FILE), 'utf8');
const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6,8}$/;

describe('call short code migration: text', () => {
  it('is idempotent and staging first', () => {
    assert.match(SQL, /add column if not exists short_code text/);
    assert.match(SQL, /create unique index if not exists calls_short_code_key on public\.calls \(short_code\)/);
    assert.match(SQL, /drop trigger if exists calls_set_short_code on public\.calls/);
    assert.match(SQL, /Run after: supabase\/migrations\/20261018220000_revoke_anon_accept_transfer\.sql/);
    assert.match(SQL, /Staging first\. Production waits for the owner's OK/);
  });
  it('codes are random, never derived from the call id', () => {
    assert.match(SQL, /gen_random_uuid\(\)/);
    assert.doesNotMatch(SQL, /md5|sha|digest|hashtext|new\.id|r\.id\)::text/i);
  });
  it('the ledger lists it as not applied', () => {
    const ledger = fs.readFileSync(path.join(__dirname, '..', 'docs/supabase/MIGRATION_LEDGER.md'), 'utf8');
    assert.match(ledger, /20261018230000_call_short_code\.sql/);
  });
});

describe('call short code migration: executed (PGlite)', () => {
  let db;
  before(async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    db = new PGlite();
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.calls (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null,
        created_at timestamptz not null default now()
      );
      insert into public.calls (tenant_id) select gen_random_uuid() from generate_series(1, 300);
    `);
    await db.exec(SQL);
  });

  it('backfills every existing row with a unique, valid code', async () => {
    const { rows } = await db.query(
      'select count(*)::int as n, count(distinct short_code)::int as d, count(short_code)::int as filled from public.calls'
    );
    assert.deepEqual(rows[0], { n: 300, d: 300, filled: 300 });
    const { rows: codes } = await db.query('select short_code from public.calls');
    for (const r of codes) assert.match(r.short_code, CODE_RE);
    assert.ok(codes.every((r) => r.short_code.length === 7));
  });

  it('new calls get a code on insert; an explicit code is kept', async () => {
    const { rows } = await db.query('insert into public.calls (tenant_id) values (gen_random_uuid()) returning short_code');
    assert.match(rows[0].short_code, CODE_RE);
    const { rows: set } = await db.query(
      "insert into public.calls (tenant_id, short_code) values (gen_random_uuid(), 'K7P2QXZ') returning short_code"
    );
    assert.equal(set[0].short_code, 'K7P2QXZ');
  });

  it('duplicates and bad codes are refused', async () => {
    await assert.rejects(db.query("insert into public.calls (tenant_id, short_code) values (gen_random_uuid(), 'K7P2QXZ')"), /unique|duplicate/i);
    await assert.rejects(db.query("insert into public.calls (tenant_id, short_code) values (gen_random_uuid(), 'K0O1IL2')"), /calls_short_code_format/);
  });

  it('runs twice without changing existing codes', async () => {
    const before = (await db.query('select id, short_code from public.calls order by id')).rows;
    await db.exec(SQL);
    const after = (await db.query('select id, short_code from public.calls order by id')).rows;
    assert.deepEqual(after, before);
  });

  it('helpers are not callable by anon or authenticated', async () => {
    const { rows } = await db.query(`
      select has_function_privilege('anon', 'public.call_short_code_new()', 'execute') as anon_new,
             has_function_privilege('authenticated', 'public.call_short_code_new()', 'execute') as auth_new,
             has_function_privilege('anon', 'public.call_short_code_random(integer)', 'execute') as anon_rand,
             has_function_privilege('authenticated', 'public.calls_set_short_code()', 'execute') as auth_trg`);
    assert.deepEqual(rows[0], { anon_new: false, auth_new: false, anon_rand: false, auth_trg: false });
  });
});
