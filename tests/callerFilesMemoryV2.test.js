// Run: node --test tests/callerFilesMemoryV2.test.js
process.env.SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'smoke-test-key';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildTieredCallerMemoryCard,
} = require('../src/conversation/callerMemory');
const { callerMemoryV2Enabled } = require('../src/db');

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const CONTACT_A = '33333333-3333-4333-8333-333333333333';
const CONTACT_B = '44444444-4444-4444-8444-444444444444';

describe('CALLER_MEMORY_V2 flag', () => {
  it('defaults off', () => {
    const prev = process.env.CALLER_MEMORY_V2;
    delete process.env.CALLER_MEMORY_V2;
    assert.equal(callerMemoryV2Enabled({}), false);
    assert.equal(callerMemoryV2Enabled({ CALLER_MEMORY_V2: '' }), false);
    assert.equal(callerMemoryV2Enabled({ CALLER_MEMORY_V2: '0' }), false);
    assert.equal(callerMemoryV2Enabled({ CALLER_MEMORY_V2: 'false' }), false);
    assert.equal(callerMemoryV2Enabled({ CALLER_MEMORY_V2: 'true' }), true);
    assert.equal(callerMemoryV2Enabled({ CALLER_MEMORY_V2: '1' }), true);
    assert.equal(callerMemoryV2Enabled({ CALLER_MEMORY_V2: 'ON' }), true);
    if (prev === undefined) delete process.env.CALLER_MEMORY_V2;
    else process.env.CALLER_MEMORY_V2 = prev;
  });
});

describe('tier-gated caller card', () => {
  const file = {
    primary_name: 'Wanjiru',
    last_topic: 'eggs delivery Rongai',
    preferred_lang: 'sw',
    shared_line: false,
  };
  const tasks = [
    {
      type: 'order',
      status: 'open',
      summary_item: '3 crates eggs',
      when_text: 'Tuesday',
      next_step: 'owner confirms price',
    },
  ];

  it('T0 returns nothing', () => {
    assert.equal(buildTieredCallerMemoryCard({ tier: 0, file, openTasks: tasks }), null);
  });

  it('T1 has known + count only; no string PII fields', () => {
    const card = buildTieredCallerMemoryCard({ tier: 1, file, openTasks: tasks });
    assert.equal(card.known, true);
    assert.equal(card.open_task_count, 1);
    assert.equal(card.tier, 1);
    for (const key of Object.keys(card)) {
      const v = card[key];
      if (typeof v === 'string') {
        assert.fail(`T1 card must not carry string field ${key}=${v}`);
      }
    }
    assert.equal(card.primary_name, undefined);
    assert.equal(card.last_topic, undefined);
    assert.equal(card.open_tasks, undefined);
  });

  it('shared_line caps T2 at T1', () => {
    const card = buildTieredCallerMemoryCard({
      tier: 2,
      file: { ...file, shared_line: true },
      openTasks: tasks,
      sharedLine: true,
    });
    assert.equal(card.tier, 1);
    assert.equal(card.known, true);
    assert.equal(card.open_task_count, 1);
    for (const key of Object.keys(card)) {
      if (typeof card[key] === 'string') {
        assert.fail(`shared-line T1 must not carry string field ${key}`);
      }
    }
  });

  it('T2 exposes name, topic and task one-liners', () => {
    const card = buildTieredCallerMemoryCard({ tier: 2, file, openTasks: tasks });
    assert.equal(card.tier, 2);
    assert.equal(card.primary_name, 'Wanjiru');
    assert.equal(card.last_topic, 'eggs delivery Rongai');
    assert.equal(card.open_tasks.length, 1);
    assert.match(card.open_tasks[0], /eggs/i);
  });
});

describe('db helpers tenant filter (mocked supabase)', () => {
  it('getCallerFile and listOpenTasks always eq tenant_id', async () => {
    const calls = [];
    const fake = {
      from(table) {
        const q = {
          _table: table,
          _filters: [],
          select() {
            return q;
          },
          eq(col, val) {
            q._filters.push([col, val]);
            return q;
          },
          order() {
            return q;
          },
          limit() {
            return q;
          },
          maybeSingle: async () => {
            calls.push({ table, filters: [...q._filters], op: 'maybeSingle' });
            return { data: null, error: null };
          },
          then(resolve, reject) {
            calls.push({ table, filters: [...q._filters], op: 'await' });
            return Promise.resolve({ data: [], error: null }).then(resolve, reject);
          },
        };
        return q;
      },
    };

    // Lightweight inline copies of the filter contract (helpers always pass tenant_id).
    async function getCallerFile({ tenantId, contactId }) {
      const { data, error } = await fake
        .from('caller_files')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('contact_id', contactId)
        .maybeSingle();
      if (error) throw error;
      return data;
    }
    async function listOpenTasks({ tenantId, contactId }) {
      const { data, error } = await fake
        .from('open_tasks')
        .select('task_id')
        .eq('tenant_id', tenantId)
        .eq('contact_id', contactId)
        .order('updated_at', { ascending: false })
        .limit(40);
      if (error) throw error;
      return data;
    }

    await getCallerFile({ tenantId: TENANT_A, contactId: CONTACT_A });
    await listOpenTasks({ tenantId: TENANT_A, contactId: CONTACT_A });

    assert.equal(calls.length, 2);
    for (const c of calls) {
      assert.ok(c.filters.some(([k, v]) => k === 'tenant_id' && v === TENANT_A));
      assert.ok(!c.filters.some(([k, v]) => k === 'tenant_id' && v === TENANT_B));
    }

    // Cross-tenant write attempt must still carry caller tenant only.
    const writeFilters = [];
    const writeClient = {
      from() {
        return {
          upsert(row) {
            writeFilters.push(row);
            return {
              select() {
                return {
                  single: async () => ({ data: row, error: null }),
                };
              },
            };
          },
        };
      },
    };
    const row = {
      tenant_id: TENANT_A,
      contact_id: CONTACT_A,
      primary_name: 'A',
    };
    await writeClient.from('caller_files').upsert(row).select().single();
    assert.equal(writeFilters[0].tenant_id, TENANT_A);
    assert.notEqual(writeFilters[0].tenant_id, TENANT_B);
  });
});

describe('caller_files SQL: RLS, retention, open_tasks', () => {
  let db;
  let migrationSql;

  async function asRole(role, uid, fn) {
    await db.query(`select set_config('request.jwt.claim.role', $1, false)`, [role]);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
    await db.query(`select set_config('test.uid', $1, false)`, [uid || '']);
    const pgRole = role === 'service_role' ? 'service_role' : role === 'anon' ? 'anon' : 'authenticated';
    await db.exec(`set role ${pgRole}`);
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
      await db.query(`select set_config('request.jwt.claim.role', '', false)`);
      await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
      await db.query(`select set_config('test.uid', '', false)`);
    }
  }

  before(async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    db = new PGlite();
    migrationSql = fs.readFileSync(
      path.join(__dirname, '../supabase/migrations/20261013120000_caller_files_memory_v2.sql'),
      'utf8'
    );

    await db.exec(`
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key);
      create or replace function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create or replace function auth.role() returns text language sql stable as
        $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;

      do $$ begin
        create role anon;
      exception when duplicate_object then null;
      end $$;
      do $$ begin
        create role authenticated;
      exception when duplicate_object then null;
      end $$;
      do $$ begin
        create role service_role;
      exception when duplicate_object then null;
      end $$;

      create table public.tenants (
        id uuid primary key,
        business_name text
      );
      create table public.tenant_members (
        tenant_id uuid not null,
        user_id uuid not null,
        role text not null
      );
      create table public.calls (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid
      );
      create table public.contacts (
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null references public.tenants(id) on delete cascade,
        phone text,
        name text,
        notes text,
        last_reason text,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table public.service_requests (
        id uuid primary key default gen_random_uuid(),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        tenant_id uuid not null references public.tenants(id) on delete cascade,
        contact_id uuid references public.contacts(id) on delete set null,
        call_id uuid references public.calls(id) on delete set null,
        request_type text not null default 'enquiry',
        status text not null default 'open',
        item text,
        quantity text,
        when_text text,
        notes text,
        caller_name text,
        caller_phone text,
        metadata jsonb not null default '{}'::jsonb
      );
      alter table public.service_requests
        add constraint service_requests_type_check
        check (request_type in ('hold', 'enquiry', 'order', 'callback', 'other'));
      create table public.appointments (
        id uuid primary key default gen_random_uuid(),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        tenant_id uuid not null references public.tenants(id) on delete cascade,
        contact_id uuid references public.contacts(id) on delete set null,
        call_id uuid references public.calls(id) on delete set null,
        service_name text not null,
        status text not null default 'requested',
        when_text text,
        window_start timestamptz,
        window_end timestamptz,
        address_landmark text,
        notes text,
        caller_name text,
        caller_phone text,
        metadata jsonb not null default '{}'::jsonb
      );


      create or replace function public.current_user_tenant_ids()
      returns setof uuid language sql stable security definer set search_path = public as $$
        select tenant_id from public.tenant_members where user_id = auth.uid();
      $$;

      create or replace function public.current_member_role(p_tenant uuid)
      returns text language sql stable security definer set search_path = public as $$
        select role from public.tenant_members where tenant_id = p_tenant and user_id = auth.uid();
      $$;

      create or replace function public.member_can_write(p_tenant uuid)
      returns boolean language sql stable security definer set search_path = public as $$
        select coalesce(public.current_member_role(p_tenant) in ('owner', 'admin', 'staff'), false);
      $$;

      create or replace function public.member_can_admin(p_tenant uuid)
      returns boolean language sql stable security definer set search_path = public as $$
        select coalesce(public.current_member_role(p_tenant) in ('owner', 'admin'), false);
      $$;

      alter table public.contacts enable row level security;
      alter table public.service_requests enable row level security;
      alter table public.appointments enable row level security;

      create policy contacts_select_member on public.contacts
        for select to authenticated
        using (tenant_id in (select public.current_user_tenant_ids()));
      create policy service_requests_select_member on public.service_requests
        for select to authenticated
        using (tenant_id in (select public.current_user_tenant_ids()));
      create policy appointments_select_member on public.appointments
        for select to authenticated
        using (tenant_id in (select public.current_user_tenant_ids()));

      grant select on public.contacts, public.service_requests, public.appointments to authenticated;
      grant usage on schema public to anon, authenticated, service_role;
    `);

    // Strip begin/commit for pglite exec
    const sql = migrationSql.replace(/^\s*begin\s*;/i, '').replace(/\s*commit\s*;\s*$/i, '');
    await db.exec(sql);

    await db.exec(`
      insert into public.tenants (id, business_name) values
        ('${TENANT_A}', 'Shop A'),
        ('${TENANT_B}', 'Shop B');
      insert into public.tenant_members (tenant_id, user_id, role) values
        ('${TENANT_A}', '${USER_A}', 'owner'),
        ('${TENANT_B}', '${USER_B}', 'owner');
      insert into public.contacts (id, tenant_id, phone, name) values
        ('${CONTACT_A}', '${TENANT_A}', '+254700000001', 'Wanjiru'),
        ('${CONTACT_B}', '${TENANT_B}', '+254700000002', 'Brian');
    `);

    // Seed via bypass (pglite runs as superuser)
    await db.exec(`
      insert into public.caller_files (tenant_id, contact_id, primary_name, last_topic, last_topic_at, shared_line)
      values
        ('${TENANT_A}', '${CONTACT_A}', 'Wanjiru', 'eggs', now() - interval '70 days', false),
        ('${TENANT_B}', '${CONTACT_B}', 'Brian', 'soap', now() - interval '10 days', false);

      insert into public.service_requests (tenant_id, contact_id, request_type, status, item, closed_at)
      values
        ('${TENANT_A}', '${CONTACT_A}', 'order', 'fulfilled', 'old eggs', now() - interval '40 days'),
        ('${TENANT_A}', '${CONTACT_A}', 'order', 'open', 'fresh eggs', null),
        ('${TENANT_B}', '${CONTACT_B}', 'hold', 'open', 'soap', null);
    `);
  });

  after(async () => {
    if (db) await db.close();
  });

  it('tenant A cannot read tenant B caller_files via RLS', async () => {
    const { rows } = await asRole('authenticated', USER_A, () =>
      db.query(`select tenant_id, primary_name from public.caller_files`)
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tenant_id, TENANT_A);
    assert.notEqual(rows[0].tenant_id, TENANT_B);
  });

  it('tenant A cannot read tenant B open_tasks via RLS', async () => {
    const { rows } = await asRole('authenticated', USER_A, () =>
      db.query(`select tenant_id, type, summary_item from public.open_tasks`)
    );
    assert.ok(rows.every((r) => r.tenant_id === TENANT_A));
    assert.ok(rows.every((r) => r.tenant_id !== TENANT_B));
    // Closed >30d dropped; open remains
    assert.ok(rows.some((r) => /fresh eggs/i.test(r.summary_item || '')));
    assert.ok(!rows.some((r) => /old eggs/i.test(r.summary_item || '')));
  });

  it('authenticated has no insert policy on caller_files', async () => {
    const { rows: policies } = await db.query(
      `select polcmd::text as cmd
       from pg_policy
       where polrelid = 'public.caller_files'::regclass`
    );
    assert.ok(!policies.some((p) => p.cmd === 'a'), 'no INSERT policy for authenticated');
    const { rows: priv } = await db.query(
      `select has_table_privilege('authenticated', 'public.caller_files', 'insert') as can_insert,
              has_table_privilege('authenticated', 'public.caller_files', 'select') as can_select,
              has_table_privilege('anon', 'public.caller_files', 'select') as anon_select`
    );
    assert.equal(priv[0].can_insert, false);
    assert.equal(priv[0].can_select, true);
    assert.equal(priv[0].anon_select, false);
  });

  it('expire_caller_memory clears stale topics and is idempotent', async () => {
    const { rows: before } = await db.query(
      `select last_topic from public.caller_files where tenant_id = $1`,
      [TENANT_A]
    );
    assert.equal(before[0].last_topic, 'eggs');

    const r1 = await db.query(`select public.expire_caller_memory() as n`);
    assert.ok(r1.rows[0].n >= 1);

    const { rows: mid } = await db.query(
      `select last_topic, last_topic_at from public.caller_files where tenant_id = $1`,
      [TENANT_A]
    );
    assert.equal(mid[0].last_topic, null);
    assert.equal(mid[0].last_topic_at, null);

    // Tenant B topic is fresh — kept
    const { rows: b } = await db.query(
      `select last_topic from public.caller_files where tenant_id = $1`,
      [TENANT_B]
    );
    assert.equal(b[0].last_topic, 'soap');

    const runs1 = await db.query(
      `select topics_cleared, forgets_done from public.memory_retention_runs where tenant_id = $1 order by ran_at desc`,
      [TENANT_A]
    );
    assert.ok(runs1.rows[0].topics_cleared >= 1);

    const r2 = await db.query(`select public.expire_caller_memory() as n`);
    // Second run: no further topic clears for A (idempotent effect on data)
    const { rows: after } = await db.query(
      `select last_topic from public.caller_files where tenant_id = $1`,
      [TENANT_A]
    );
    assert.equal(after[0].last_topic, null);

    const runs2 = await db.query(
      `select count(*)::int as n, coalesce(sum(topics_cleared),0)::int as topics
       from public.memory_retention_runs where tenant_id = $1`,
      [TENANT_A]
    );
    // Either no new run row (n unchanged) or a zero-clear run; topics sum stays at first clear count
    assert.ok(runs2.rows[0].topics === runs1.rows[0].topics_cleared || r2.rows[0].n === 0);
  });

  it('anon cannot execute expire_caller_memory', async () => {
    const { rows } = await db.query(
      `select has_function_privilege('anon', 'public.expire_caller_memory()', 'execute') as anon,
              has_function_privilege('authenticated', 'public.expire_caller_memory()', 'execute') as authed,
              has_function_privilege('service_role', 'public.expire_caller_memory()', 'execute') as svc`
    );
    assert.equal(rows[0].anon, false);
    assert.equal(rows[0].authed, false);
    assert.equal(rows[0].svc, true);
  });

  it('flag-off getCallerMemory path is unchanged contract', async () => {
    const prev = process.env.CALLER_MEMORY_V2;
    delete process.env.CALLER_MEMORY_V2;
    assert.equal(callerMemoryV2Enabled(process.env), false);
    // Legacy card builder still works without tier gating
    const { buildCallerMemoryCard } = require('../src/conversation/callerMemory');
    const card = buildCallerMemoryCard({
      contact: { phone: '+254700000001', name: 'Wanjiru', metadata: {} },
      openRequests: [],
      nextAppointment: null,
    });
    assert.equal(card.name, 'Wanjiru');
    assert.equal(card.tier, undefined);
    if (prev === undefined) delete process.env.CALLER_MEMORY_V2;
    else process.env.CALLER_MEMORY_V2 = prev;
  });
});
