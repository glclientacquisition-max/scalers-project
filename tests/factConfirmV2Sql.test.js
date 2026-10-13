// GIGO confirm v2 SQL, executed for real in an in-process Postgres (PGlite):
// confirm_tenant_fields (batch, all or nothing), reopen_tenant_field, the
// service id backfill, and the staging-only D&D reset.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const DND = 'df4ad9d8-28ff-4810-b1e6-94f5495472b0';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STRANGER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

/** The P0 helpers confirm v2 calls, lifted verbatim from tenant_field_provenance.sql. */
function p0Helpers() {
  const sql = read('docs/supabase/tenant_field_provenance.sql');
  const grab = (name) => {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    assert.ok(start >= 0, name);
    const end = sql.indexOf('$$;', sql.indexOf('as $$', start) + 5);
    return sql.slice(start, end + 3);
  };
  return [grab('_tenant_assert_member'), grab('_tenant_append_field_history')].join('\n\n');
}

let db;

async function as(user, fn) {
  await db.query(`select set_config('test.uid', $1, false)`, [user || '']);
  try {
    return await fn();
  } finally {
    await db.query(`select set_config('test.uid', '', false)`);
  }
}

async function rejects(promise, re) {
  await assert.rejects(promise, (err) => {
    assert.match(String(err.message), re);
    return true;
  });
}

async function meta(tenant, fieldPath) {
  const { rows } = await db.query(
    'select * from tenant_field_meta where tenant_id = $1 and field_path = $2',
    [tenant, fieldPath]
  );
  return rows[0] || null;
}

async function historyCount(tenant) {
  const { rows } = await db.query('select count(*)::int as n from tenant_field_history where tenant_id = $1', [tenant]);
  return rows[0].n;
}

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as
      $$ select case when nullif(current_setting('test.uid', true), '') is null
                     then 'service_role' else 'authenticated' end $$;
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.tenants (
      id uuid primary key,
      business_name text,
      services_catalog jsonb
    );
    create table public.tenant_members (tenant_id uuid, user_id uuid, role text);
    create table public.tenant_field_meta (
      tenant_id uuid not null references public.tenants (id) on delete cascade,
      field_path text not null,
      source text not null,
      source_ref text,
      confirmed_by uuid references auth.users (id) on delete set null,
      confirmed_at timestamptz,
      last_verified_at timestamptz,
      confidence numeric(4, 3),
      stale_after_days integer,
      updated_at timestamptz not null default now(),
      constraint tenant_field_meta_pkey primary key (tenant_id, field_path),
      constraint tenant_field_meta_source_check check (
        source in ('owner', 'seed', 'import', 'inferred', 'call_suggested')
      )
    );
    create table public.tenant_field_history (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references public.tenants (id) on delete cascade,
      field_path text not null,
      actor text not null default 'system',
      source text,
      old_value jsonb,
      new_value jsonb,
      created_at timestamptz not null default now()
    );
  `);
  await db.exec(p0Helpers());
  await db.query('insert into auth.users values ($1), ($2)', [OWNER, STRANGER]);
  await db.query(
    `insert into tenants values ($1, 'Test Shop', '[]'), ($2, 'Other Shop', '[]')`,
    [TENANT, OTHER]
  );
  await db.query(`insert into tenant_members values ($1, $2, 'owner')`, [TENANT, OWNER]);
  // Apply twice: the file is idempotent.
  await db.exec(read('docs/supabase/tenant_field_confirm_v2.sql'));
  await db.exec(read('docs/supabase/tenant_field_confirm_v2.sql'));
});

describe('confirm_tenant_fields', () => {
  it('confirms a batch with hashes and one history row per path', async () => {
    await db.query(
      `insert into tenant_field_meta (tenant_id, field_path, source, source_ref) values ($1, 'policies.payment', 'seed', 'backfill')`,
      [TENANT]
    );
    const h0 = await historyCount(TENANT);
    const { rows } = await as(OWNER, () =>
      db.query('select confirm_tenant_fields($1, $2, $3) as n', [
        TENANT,
        ['policies.payment', 'identity.business_name'],
        [H1, H2],
      ])
    );
    assert.equal(rows[0].n, 2);
    const pay = await meta(TENANT, 'policies.payment');
    assert.equal(pay.source, 'owner');
    assert.equal(pay.value_hash, H1);
    assert.equal(pay.confirmed_by, OWNER);
    assert.ok(pay.confirmed_at);
    assert.equal((await meta(TENANT, 'identity.business_name')).value_hash, H2);
    assert.equal((await historyCount(TENANT)) - h0, 2);
    const { rows: hist } = await db.query(
      `select old_value, new_value from tenant_field_history where tenant_id = $1 and field_path = 'policies.payment' order by created_at desc limit 1`,
      [TENANT]
    );
    assert.equal(hist[0].old_value.source, 'seed');
    assert.equal(hist[0].new_value.value_hash, H1);
  });

  it('rejects bad input and writes nothing', async () => {
    const h0 = await historyCount(TENANT);
    const call = (paths, hashes, user = OWNER, tenant = TENANT) =>
      as(user, () => db.query('select confirm_tenant_fields($1, $2, $3)', [tenant, paths, hashes]));
    await rejects(call(['hours.weekly_grid'], [H1, H2]), /differ in length/);
    await rejects(call(['hours.weekly_grid'], [null]), /64 lowercase hex/);
    await rejects(call(['hours.weekly_grid'], ['']), /64 lowercase hex/);
    await rejects(call(['hours.weekly_grid'], ['A'.repeat(64)]), /64 lowercase hex/);
    await rejects(call(['hours.weekly_grid'], ['abc']), /64 lowercase hex/);
    await rejects(call([' '], [H1]), /field_path required/);
    await rejects(call(['faqs.1', 'faqs.1'], [H1, H2]), /duplicate field_path/);
    await rejects(call(null, [H1]), /required/);
    const many = Array.from({ length: 501 }, (_, i) => `faqs.${i + 1}`);
    await rejects(call(many, many.map(() => H1)), /max 500/);
    await rejects(call(['hours.weekly_grid'], [H1], STRANGER), /forbidden/);
    await rejects(call(['hours.weekly_grid'], [H1], OWNER, OTHER), /forbidden/);
    // A valid path next to a bad hash: nothing lands (all or nothing).
    await rejects(call(['hours.weekly_grid', 'locations.branches'], [H1, null]), /64 lowercase hex/);
    assert.equal(await meta(TENANT, 'hours.weekly_grid'), null);
    assert.equal(await historyCount(TENANT), h0);
  });

  it('accepts exactly 500 paths', async () => {
    const paths = Array.from({ length: 500 }, (_, i) => `faqs.${i + 1}`);
    const { rows } = await as(OWNER, () =>
      db.query('select confirm_tenant_fields($1, $2, $3) as n', [TENANT, paths, paths.map(() => H1)])
    );
    assert.equal(rows[0].n, 500);
  });

  it('the hash column only takes 64 lowercase hex', async () => {
    await rejects(
      db.query(
        `insert into tenant_field_meta (tenant_id, field_path, source, value_hash) values ($1, 'x.y', 'owner', 'nope')`,
        [TENANT]
      ),
      /value_hash_check/
    );
  });

  it('is not callable by anon', async () => {
    const { rows } = await db.query(
      `select has_function_privilege('anon', 'public.confirm_tenant_fields(uuid, text[], text[])', 'execute') as anon,
              has_function_privilege('authenticated', 'public.confirm_tenant_fields(uuid, text[], text[])', 'execute') as authed`
    );
    assert.equal(rows[0].anon, false);
    assert.equal(rows[0].authed, true);
  });
});

describe('reopen_tenant_field', () => {
  it('clears the confirm and hash, owner steps down to seed, with history', async () => {
    await as(OWNER, () =>
      db.query('select confirm_tenant_fields($1, $2, $3)', [TENANT, ['policies.returns'], [H1]])
    );
    const h0 = await historyCount(TENANT);
    await as(OWNER, () => db.query(`select reopen_tenant_field($1, 'policies.returns')`, [TENANT]));
    const row = await meta(TENANT, 'policies.returns');
    assert.equal(row.source, 'seed');
    assert.equal(row.value_hash, null);
    assert.equal(row.confirmed_at, null);
    assert.equal(row.confirmed_by, null);
    assert.equal((await historyCount(TENANT)) - h0, 1);
  });

  it('is a no-op without a row and refuses non-members', async () => {
    const { rows } = await as(OWNER, () =>
      db.query(`select reopen_tenant_field($1, 'policies.warranty') as r`, [TENANT])
    );
    assert.equal(rows[0].r, null);
    await rejects(
      as(STRANGER, () => db.query(`select reopen_tenant_field($1, 'policies.payment')`, [TENANT])),
      /forbidden/
    );
  });
});

describe('services_catalog_stable_ids.sql', () => {
  it('assigns svc_ ids, keeps valid ones, splits duplicates, moves position paths, and is idempotent', async () => {
    const T = '33333333-3333-4333-8333-333333333333';
    await db.query(`insert into tenants values ($1, 'Cleaner', $2)`, [
      T,
      JSON.stringify([
        { name: 'Sofa clean' },
        { id: 'svc_keepme', name: 'Carpet clean' },
        { id: '7', name: 'Numeric id' },
        { id: 'svc_keepme', name: 'Duplicate id' },
      ]),
    ]);
    await db.query(
      `insert into tenant_field_meta (tenant_id, field_path, source, value_hash) values
        ($1, 'catalog.service.1.name', 'owner', $2),
        ($1, 'catalog.service.3.name', 'seed', null)`,
      [T, H1]
    );
    const sql = read('docs/supabase/services_catalog_stable_ids.sql');
    await db.exec(sql);
    const { rows } = await db.query('select services_catalog from tenants where id = $1', [T]);
    const list = rows[0].services_catalog;
    assert.equal(list.length, 4);
    assert.match(list[0].id, /^svc_[0-9a-f]{16}$/);
    assert.equal(list[1].id, 'svc_keepme');
    assert.match(list[2].id, /^svc_[0-9a-f]{16}$/);
    assert.match(list[3].id, /^svc_[0-9a-f]{16}$/);
    assert.notEqual(list[3].id, 'svc_keepme');
    assert.equal(new Set(list.map((r) => r.id)).size, 4);
    assert.equal(list[0].name, 'Sofa clean');

    assert.equal(await meta(T, 'catalog.service.1.name'), null);
    const moved = await meta(T, `catalog.service.${list[0].id}.name`);
    assert.equal(moved.source, 'owner');
    assert.equal(moved.value_hash, null, 'hash cleared: the row now hashes with its id');
    assert.ok(await meta(T, `catalog.service.${list[2].id}.name`));

    await db.exec(sql);
    const again = await db.query('select services_catalog from tenants where id = $1', [T]);
    assert.deepEqual(again.rows[0].services_catalog, list);
  });
});

describe('staging/dnd_reset_owner_confirms.sql', () => {
  const sql = read('docs/supabase/staging/dnd_reset_owner_confirms.sql');

  // The snippet runs begin ... commit; a refusal leaves the transaction aborted.
  const refuses = async (re) => {
    await rejects(db.exec(sql), re);
    await db.exec('rollback');
  };

  it('refuses when the D&D tenant is missing', async () => {
    await refuses(/not found/);
  });

  it('steps every D&D owner row down to seed and leaves other tenants alone', async () => {
    await db.query(`insert into tenants values ($1, 'Done and Dusted Cleaning Services', '[]')`, [DND]);
    await db.query(`insert into tenant_members values ($1, $2, 'owner')`, [DND, OWNER]);
    await as(OWNER, () =>
      db.query('select confirm_tenant_fields($1, $2, $3)', [
        DND,
        ['policies.payment', 'catalog.service.1.name'],
        [H1, H2],
      ])
    );
    await db.query(
      `insert into tenant_field_meta (tenant_id, field_path, source) values ($1, 'faqs.1', 'seed')`,
      [DND]
    );
    const h0 = await historyCount(DND);
    await db.exec(sql);
    const { rows } = await db.query(
      'select field_path, source, value_hash, confirmed_at from tenant_field_meta where tenant_id = $1 order by field_path',
      [DND]
    );
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.source, 'seed');
      assert.equal(row.value_hash, null);
      assert.equal(row.confirmed_at, null);
    }
    assert.equal((await historyCount(DND)) - h0, 2);
    assert.equal((await meta(TENANT, 'policies.payment')).source, 'owner');
    // Re-run: nothing left to reset.
    await db.exec(sql);
    assert.equal((await historyCount(DND)) - h0, 2);
  });

  it('refuses on a database with the live customer', async () => {
    await db.query(`insert into tenants values (gen_random_uuid(), 'Aris Kenya', '[]')`);
    await refuses(/production/);
  });
});
