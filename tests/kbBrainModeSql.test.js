// set_brain_mode ("Take messages only"), executed for real in an in-process Postgres (PGlite):
// docs/supabase/kb_v2_brain_mode.sql (2026-10-28.4) + its down file.
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const TADMIN = 'aaaaaaaa-0000-4000-8000-000000000002';
const STAFF = 'aaaaaaaa-0000-4000-8000-000000000003';
const VIEWER = 'aaaaaaaa-0000-4000-8000-000000000004';
const OWNER2 = 'aaaaaaaa-0000-4000-8000-000000000005';
const SUPER = 'aaaaaaaa-0000-4000-8000-000000000009';

let db;
/** Run as a signed-in user (role authenticated, auth.uid() = uid), as anon, or as the service role. */
async function as(who, sql, params) {
  const role = who === 'service' ? 'service_role' : who === 'anon' ? 'anon' : 'authenticated';
  await db.query(`select set_config('test.uid', $1, false), set_config('test.role', $2, false)`, [who === 'service' || who === 'anon' ? '' : who, role]);
  await db.exec(`set role ${role}`);
  try { return await db.query(sql, params); } finally {
    await db.exec('reset role');
    await db.query(`select set_config('test.uid', '', false), set_config('test.role', '', false)`);
  }
}
const row = async (id) => (await db.query('select * from public.tenants where id = $1', [id])).rows[0];
const audits = async (id) => (await db.query('select * from public.tenant_brain_mode_audit where tenant_id = $1 order by id', [id])).rows;
const rejects = (p, re) => assert.rejects(p, (e) => { assert.match(String(e.message), re); return true; });

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true), '') $$;
    create role anon; create role authenticated; create role service_role;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table public.tenants (id uuid primary key, business_name text, services_offered text, kb_live_version int, brain_target text default 'v2');
    create table public.tenant_members (tenant_id uuid, user_id uuid, role text);
    grant select on public.tenants to authenticated;
    grant update (business_name, services_offered) on public.tenants to authenticated;
    grant all on public.tenants, public.tenant_members to service_role;
  `);
  await db.query(`insert into public.tenants (id, business_name, services_offered, kb_live_version) values ($1, 'Biz One', 'cleaning', 2), ($2, 'Biz Two', 'plants', 1)`, [T1, T2]);
  for (const [u, r, t] of [[OWNER, 'owner', T1], [TADMIN, 'admin', T1], [STAFF, 'staff', T1], [VIEWER, 'viewer', T1], [OWNER2, 'owner', T2]]) {
    await db.query('insert into public.tenant_members values ($1, $2, $3)', [t, u, r]);
  }
  await db.exec(read('docs/supabase/kb_v2_brain_mode.sql'));
  await db.exec(read('docs/supabase/kb_v2_brain_mode.sql')); // idempotent
});

describe('set_brain_mode (kb_v2_brain_mode.sql .4)', () => {
  it('adds the columns with full as the default', async () => {
    const t = await row(T1);
    assert.equal(t.brain_mode, 'full');
    assert.equal(t.brain_mode_source, null); assert.equal(t.brain_mode_set_by, null); assert.equal(t.brain_mode_set_at, null);
  });

  it('an owner sets their own business; only the brain_mode columns change; one audit row', async () => {
    const before = await row(T1);
    const { rows } = await as(OWNER, 'select public.set_brain_mode($1, $2) as r', [T1, 'safe']);
    assert.equal(rows[0].r.brain_mode, 'safe'); assert.equal(rows[0].r.source, 'owner'); assert.equal(rows[0].r.from, 'full');
    const after = await row(T1);
    assert.equal(after.brain_mode, 'safe'); assert.equal(after.brain_mode_source, 'owner'); assert.equal(after.brain_mode_set_by, OWNER);
    assert.ok(after.brain_mode_set_at);
    for (const k of Object.keys(before).filter((k) => !k.startsWith('brain_mode'))) assert.deepEqual(after[k], before[k], `${k} unchanged`);
    const a = await audits(T1);
    assert.equal(a.length, 1);
    assert.deepEqual([a[0].actor, a[0].source, a[0].from_mode, a[0].to_mode], [OWNER, 'owner', 'full', 'safe']);
  });

  it('a tenant admin member may also set it (source owner = the business side)', async () => {
    await as(TADMIN, 'select public.set_brain_mode($1, $2)', [T1, 'full']);
    const t = await row(T1);
    assert.equal(t.brain_mode, 'full'); assert.equal(t.brain_mode_set_by, TADMIN); assert.equal(t.brain_mode_source, 'owner');
  });

  it('a non-owner member (staff, viewer) is denied and nothing is written', async () => {
    const n = (await audits(T1)).length;
    for (const u of [STAFF, VIEWER]) await rejects(as(u, 'select public.set_brain_mode($1, $2)', [T1, 'safe']), /forbidden/);
    assert.equal((await row(T1)).brain_mode, 'full');
    assert.equal((await audits(T1)).length, n);
  });

  it("another business's owner is denied; p_actor cannot be spoofed by a member", async () => {
    await rejects(as(OWNER2, 'select public.set_brain_mode($1, $2)', [T1, 'safe']), /forbidden/);
    await rejects(as(OWNER, 'select public.set_brain_mode($1, $2)', [T2, 'safe']), /forbidden/);
    assert.equal((await row(T1)).brain_mode, 'full'); assert.equal((await row(T2)).brain_mode, 'full');
    await as(OWNER2, 'select public.set_brain_mode($1, $2, $3)', [T2, 'safe', SUPER]);
    const t2 = await row(T2);
    assert.equal(t2.brain_mode_set_by, OWNER2); assert.equal(t2.brain_mode_source, 'owner');
  });

  it('an invalid mode is rejected (owner and service role)', async () => {
    for (const m of ['v1', 'SAFE', '', null]) await rejects(as(OWNER, 'select public.set_brain_mode($1, $2)', [T1, m]), /invalid_mode/);
    await rejects(as('service', 'select public.set_brain_mode($1, $2)', [T1, 'off']), /invalid_mode/);
    assert.equal((await row(T1)).brain_mode, 'full');
  });

  it('anon cannot execute it; an unknown business is not_found', async () => {
    await rejects(as('anon', 'select public.set_brain_mode($1, $2)', [T1, 'safe']), /permission denied/);
    await rejects(as('service', 'select public.set_brain_mode($1, $2)', ['33333333-3333-4333-8333-333333333333', 'safe']), /not_found/);
  });

  it('Super Admin (service role) sets any business with source admin and its actor', async () => {
    await as('service', 'select public.set_brain_mode($1, $2, $3)', [T1, 'safe', SUPER]);
    const t = await row(T1);
    assert.equal(t.brain_mode, 'safe'); assert.equal(t.brain_mode_source, 'admin'); assert.equal(t.brain_mode_set_by, SUPER);
    assert.equal((await audits(T1)).at(-1).source, 'admin');
  });

  it('members get no direct column UPDATE on brain_mode (only through the RPC)', async () => {
    await rejects(as(OWNER, "update public.tenants set brain_mode = 'full' where id = $1", [T1]), /permission denied/);
    await rejects(as(OWNER, "update public.tenants set brain_mode_source = 'admin' where id = $1", [T1]), /permission denied/);
    await as(OWNER, "update public.tenants set business_name = 'Biz One' where id = $1", [T1]); // other granted columns still work
    assert.equal((await row(T1)).brain_mode, 'safe');
    const { rows } = await db.query(`select prosecdef, proconfig from pg_proc where proname = 'set_brain_mode'`);
    assert.equal(rows[0].prosecdef, true);
    assert.ok(rows[0].proconfig.some((c) => /^search_path=public, pg_temp$/.test(c)), String(rows[0].proconfig));
  });

  it('down file removes everything and leaves brain_target', async () => {
    await db.exec(read('docs/supabase/kb_v2_brain_mode_down.sql'));
    const { rows } = await db.query(`select column_name from information_schema.columns where table_name = 'tenants' and column_name like 'brain%' order by 1`);
    assert.deepEqual(rows.map((r) => r.column_name), ['brain_target']);
    assert.equal((await db.query(`select to_regclass('public.tenant_brain_mode_audit') as t`)).rows[0].t, null);
    assert.equal((await db.query(`select count(*)::int n from pg_proc where proname = 'set_brain_mode'`)).rows[0].n, 0);
  });
});
