// Desk RPCs inbox_unarchive_calls and calls_record_caller_reply, executed for
// real in an in-process Postgres (PGlite) on top of inbox_archive_cascade.sql.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VIEWER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STRANGER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C1 = 'c1000000-0000-4000-8000-000000000001';
const C2 = 'c1000000-0000-4000-8000-000000000002';
const C_OTHER = 'c2000000-0000-4000-8000-000000000001';
const MISSING = 'c9000000-0000-4000-8000-000000000009';

/** member_can_write + current_member_role, lifted verbatim from team_invites. */
function memberHelpers() {
  const sql = read('supabase/migrations/20261011000000_team_invites.sql');
  const grab = (name) => {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    assert.ok(start >= 0, name);
    const end = sql.indexOf('$$;', sql.indexOf('as $$', start) + 5);
    return sql.slice(start, end + 3);
  };
  return [grab('current_member_role'), grab('member_can_write')].join('\n\n');
}

let db;

async function as(user, fn) {
  await db.query(`select set_config('test.uid', $1, false)`, [user || '']);
  await db.query(`select set_config('test.role', $1, false)`, [user === null ? 'anon' : '']);
  try {
    return await fn();
  } finally {
    await db.query(`select set_config('test.uid', '', false)`);
    await db.query(`select set_config('test.role', '', false)`);
  }
}

async function rejects(promise, re) {
  await assert.rejects(promise, (err) => {
    assert.match(String(err.message), re);
    return true;
  });
}

async function call(id) {
  const { rows } = await db.query('select * from calls where id = $1', [id]);
  return rows[0];
}

async function stamps(callId) {
  const h = await db.query('select inbox_archived_at from service_requests where call_id = $1 order by id', [callId]);
  const v = await db.query('select inbox_archived_at from appointments where call_id = $1 order by id', [callId]);
  return [...h.rows, ...v.rows].map((r) => r.inbox_archived_at);
}

const unarchive = (ids, user = OWNER, tenant = TENANT) =>
  as(user, () => db.query('select inbox_unarchive_calls($1, $2) as r', [tenant, ids])).then((x) => x.rows[0].r);
const archive = (ids, user = OWNER, tenant = TENANT) =>
  as(user, () => db.query('select inbox_archive_calls($1, $2) as r', [tenant, ids])).then((x) => x.rows[0].r);
const reply = (callId, body, user = OWNER, tenant = TENANT) =>
  as(user, () => db.query('select calls_record_caller_reply($1, $2, $3) as r', [tenant, callId, body])).then(
    (x) => x.rows[0].r
  );

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as
      $$ select coalesce(nullif(current_setting('test.role', true), ''),
                case when nullif(current_setting('test.uid', true), '') is null
                     then 'service_role' else 'authenticated' end) $$;
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.tenants (id uuid primary key);
    create table public.tenant_members (tenant_id uuid, user_id uuid, role text);
    create table public.calls (
      id uuid primary key,
      tenant_id uuid not null references public.tenants (id),
      lead_status text not null default 'new'
        check (lead_status in ('new', 'contacted', 'resolved', 'archived')),
      summary text
    );
    create table public.service_requests (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null, call_id uuid, status text not null default 'open'
    );
    create table public.appointments (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null, call_id uuid, status text not null default 'requested'
    );
  `);
  await db.exec(memberHelpers());
  await db.query('insert into tenants values ($1), ($2)', [TENANT, OTHER]);
  await db.query(
    `insert into tenant_members values ($1, $2, 'owner'), ($1, $3, 'viewer'), ($4, $5, 'owner')`,
    [TENANT, OWNER, VIEWER, OTHER, STRANGER]
  );
  await db.exec(read('docs/supabase/inbox_archive_cascade.sql'));
  // Apply twice: both files are idempotent.
  for (let i = 0; i < 2; i++) {
    await db.exec(read('docs/supabase/inbox_unarchive_calls.sql'));
    await db.exec(read('docs/supabase/calls_record_caller_reply.sql'));
  }
  await db.query(
    `insert into calls (id, tenant_id, lead_status, summary) values
       ($1, $4, 'contacted', '{"a":1}'), ($2, $4, 'new', null), ($3, $5, 'new', '{"x":"y"}')`,
    [C1, C2, C_OTHER, TENANT, OTHER]
  );
  await db.query(
    `insert into service_requests (tenant_id, call_id, status) values ($1, $2, 'open'), ($1, $2, 'fulfilled')`,
    [TENANT, C1]
  );
  await db.query(`insert into appointments (tenant_id, call_id, status) values ($1, $2, 'confirmed')`, [TENANT, C1]);
});

describe('migrations match docs', () => {
  it('migration files are byte-identical to docs/supabase', () => {
    assert.equal(
      read('supabase/migrations/20261022013000_inbox_unarchive_calls.sql'),
      read('docs/supabase/inbox_unarchive_calls.sql')
    );
    assert.equal(
      read('supabase/migrations/20261022013500_calls_record_caller_reply.sql'),
      read('docs/supabase/calls_record_caller_reply.sql')
    );
  });
});

describe('inbox_unarchive_calls', () => {
  it('archive then unarchive round-trips lead_status and stamps', async () => {
    const a = await archive([C1]);
    assert.equal(a.holds.length, 1);
    assert.equal(a.visits.length, 1);
    assert.equal((await call(C1)).lead_status, 'archived');
    assert.equal((await stamps(C1)).filter(Boolean).length, 2);

    const u = await unarchive([C1, C2, C_OTHER, MISSING, null, C1]);
    assert.equal(u.unarchived, 1);
    assert.deepEqual(u.call_ids, [C1]);
    assert.equal(u.holds, 1);
    assert.equal(u.visits, 1);
    assert.equal(u.skipped, 3);
    const reasons = Object.fromEntries(u.skipped_detail.map((d) => [d.id, d.reason]));
    assert.deepEqual(reasons, { [C2]: 'not_archived', [C_OTHER]: 'not_found', [MISSING]: 'not_found' });
    assert.equal((await call(C1)).lead_status, 'new');
    assert.deepEqual(await stamps(C1), [null, null, null]);
    assert.equal((await call(C_OTHER)).lead_status, 'new');
  });

  it('is idempotent', async () => {
    const u = await unarchive([C1]);
    assert.equal(u.unarchived, 0);
    assert.equal(u.holds, 0);
    assert.deepEqual(u.skipped_detail, [{ id: C1, reason: 'not_archived' }]);
  });

  it('a stale undo after unarchive changes nothing', async () => {
    const a = await archive([C1]);
    await unarchive([C1]);
    await db.query(`update calls set lead_status = 'resolved' where id = $1`, [C1]);
    const r = await as(OWNER, () => db.query('select inbox_undo_archive($1, $2) as r', [TENANT, a.undo_id]));
    assert.deepEqual(r.rows[0].r.restored.calls, []);
    assert.equal((await call(C1)).lead_status, 'resolved');
  });

  it('empty input returns zero counts', async () => {
    assert.equal((await unarchive([])).unarchived, 0);
    assert.equal((await unarchive(null)).skipped, 0);
  });

  it('refuses viewers, non-members, anon, bad input', async () => {
    await rejects(unarchive([C1], VIEWER), /not allowed/);
    await rejects(unarchive([C1], STRANGER), /not allowed/);
    await rejects(unarchive([C1], null), /not allowed/);
    await rejects(unarchive([C1], OWNER, null), /tenant required/);
    const many = Array.from({ length: 201 }, (_, i) => `d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    await rejects(unarchive(many), /max 200/);
  });

  it('execute: authenticated yes, anon no', async () => {
    const { rows } = await db.query(
      `select has_function_privilege('anon', 'public.inbox_unarchive_calls(uuid, uuid[])', 'execute') as anon,
              has_function_privilege('authenticated', 'public.inbox_unarchive_calls(uuid, uuid[])', 'execute') as authed`
    );
    assert.equal(rows[0].anon, false);
    assert.equal(rows[0].authed, true);
  });
});

describe('calls_record_caller_reply', () => {
  it('merges only the two keys and keeps the rest', async () => {
    await db.query(`update calls set summary = '{"a":1,"caller_reply_body":"old"}' where id = $1`, [C1]);
    const r = await reply(C1, 'Thanks, we open at 9');
    assert.ok(r.at);
    const s = JSON.parse((await call(C1)).summary);
    assert.equal(s.a, 1);
    assert.equal(s.caller_reply_body, 'Thanks, we open at 9');
    assert.equal(new Date(s.caller_reply_at).getTime(), new Date(r.at).getTime());
  });

  it('null / empty summary starts from {}', async () => {
    await db.query(`update calls set summary = null where id = $1`, [C2]);
    await reply(C2, 'hi');
    assert.deepEqual(Object.keys(JSON.parse((await call(C2)).summary)).sort(), ['caller_reply_at', 'caller_reply_body']);
    await db.query(`update calls set summary = '  ' where id = $1`, [C2]);
    await reply(C2, 'hi');
    assert.equal(JSON.parse((await call(C2)).summary).caller_reply_body, 'hi');
  });

  it('non-JSON and non-object summary is kept under "text"', async () => {
    for (const raw of ['plain words {', '[1,2]', '"quoted"', '42']) {
      await db.query(`update calls set summary = $2 where id = $1`, [C2, raw]);
      await reply(C2, 'ok');
      const s = JSON.parse((await call(C2)).summary);
      assert.equal(s.text, raw);
      assert.equal(s.caller_reply_body, 'ok');
    }
  });

  it('rejects bad body with 22023 and writes nothing', async () => {
    const before = (await call(C1)).summary;
    for (const body of [null, '', '   ', 'x'.repeat(1601)]) {
      await assert.rejects(reply(C1, body), (e) => e.code === '22023');
    }
    await assert.rejects(reply(null, 'x'), (e) => e.code === '22023');
    assert.equal((await call(C1)).summary, before);
    assert.ok(await reply(C1, 'x'.repeat(1600)));
  });

  it("another tenant's call is P0002; non-members 42501", async () => {
    await assert.rejects(reply(C_OTHER, 'x'), (e) => e.code === 'P0002');
    await assert.rejects(reply(MISSING, 'x'), (e) => e.code === 'P0002');
    await assert.rejects(reply(C_OTHER, 'x', OWNER, OTHER), (e) => e.code === '42501');
    await assert.rejects(reply(C1, 'x', VIEWER), (e) => e.code === '42501');
    await assert.rejects(reply(C1, 'x', null), (e) => e.code === '42501');
    assert.equal((await call(C_OTHER)).summary, '{"x":"y"}');
  });

  it('execute: authenticated yes, anon no; helper not granted', async () => {
    const { rows } = await db.query(
      `select has_function_privilege('anon', 'public.calls_record_caller_reply(uuid, uuid, text)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.calls_record_caller_reply(uuid, uuid, text)', 'execute') as authed,
              has_function_privilege('authenticated', 'public._calls_summary_object(text)', 'execute') as helper`
    );
    assert.equal(rows[0].anon, false);
    assert.equal(rows[0].authed, true);
    assert.equal(rows[0].helper, false);
  });
});
