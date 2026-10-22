// call_messages table + RPCs (Desk per-call SMS thread), executed for real in
// an in-process Postgres (PGlite) on top of the real notify_send_ledger.sql and
// inbox_archive_cascade.sql. Also runs the OPTIONAL backfill file once against
// seeded ledger rows (the file itself is never run by a migration).

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
const C3 = 'c1000000-0000-4000-8000-000000000003';
const C_OTHER = 'c2000000-0000-4000-8000-000000000001';
const MISSING = 'c9000000-0000-4000-8000-000000000009';
const CONTACT = 'ab000000-0000-4000-8000-000000000001';
const APPT = 'a0000000-0000-4000-8000-000000000001';
const APPT_C2 = 'a0000000-0000-4000-8000-000000000002';
const NS_SENT = 'e0000000-0000-4000-8000-000000000001';
const NS_PENDING = 'e0000000-0000-4000-8000-000000000002';
const NS_OTHER_T = 'e0000000-0000-4000-8000-000000000003';
const NS_FAILED = 'e0000000-0000-4000-8000-000000000004';

const FUNCS = [
  'public.call_messages_list(uuid, uuid, timestamptz, uuid, integer)',
  'public.call_messages_mark_read(uuid, uuid)',
  'public.call_messages_unread_counts(uuid, uuid[])',
  'public.call_messages_record_out(uuid, uuid, text, text, text, uuid, uuid, uuid)',
  'public.call_messages_retry(uuid, uuid)',
];
const HELPERS = [
  'public._call_messages_ke_phone(text)',
  'public._call_messages_assert_member(uuid)',
  'public._call_messages_rows(uuid, uuid, timestamptz, uuid, integer)',
];

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

const SERVICE = '';

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

const rpc = (sql, args, user = OWNER) => as(user, () => db.query(sql, args)).then((x) => x.rows[0].r);
const list = (callId, opts = {}, user = OWNER, tenant = TENANT) =>
  rpc('select call_messages_list($1, $2, $3, $4, $5) as r', [
    tenant,
    callId,
    opts.before?.created_at ?? opts.beforeAt ?? null,
    opts.before?.id ?? opts.beforeId ?? null,
    opts.limit ?? 50,
  ], user);
const recordOut = (o, user = OWNER, tenant = TENANT) =>
  rpc('select call_messages_record_out($1, $2, $3, $4, $5, $6, $7, $8) as r', [
    tenant,
    'call' in o ? o.call : C1,
    o.key,
    o.source ?? 'caller_note',
    o.body ?? 'Hi, we open at 9',
    o.notify ?? null,
    o.appt ?? null,
    o.req ?? null,
  ], user);
const markRead = (callId, user = OWNER, tenant = TENANT) =>
  rpc('select call_messages_mark_read($1, $2) as r', [tenant, callId], user);
const unread = (ids, user = OWNER, tenant = TENANT) =>
  rpc('select call_messages_unread_counts($1, $2) as r', [tenant, ids], user);
const retry = (id, user = OWNER, tenant = TENANT) =>
  rpc('select call_messages_retry($1, $2) as r', [tenant, id], user);

const code = (c) => (e) => {
  assert.equal(e.code, c, `${e.code} ${e.message}`);
  return true;
};

async function inbound(callId, body, at, id = null) {
  await db.query(
    `insert into call_messages (id, tenant_id, call_id, phone, direction, body, status, source, idempotency_key, created_at, sent_at)
     values (coalesce($5::uuid, gen_random_uuid()), $1, $2, '254712345678', 'in', $3, 'received', 'inbound', 'in:' || gen_random_uuid(), $4, $4)`,
    [TENANT, callId, body, at, id]
  );
}

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
    -- Supabase-style default privileges: new tables and functions are granted
    -- to anon/authenticated unless the file revokes them explicitly.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create table public.tenants (id uuid primary key);
    create table public.tenant_members (tenant_id uuid, user_id uuid, role text);
    create function public.current_user_tenant_ids() returns setof uuid language sql stable as
      $$ select tenant_id from public.tenant_members where user_id = auth.uid() $$;
    create table public.calls (
      id uuid primary key,
      created_at timestamptz not null default now(),
      tenant_id uuid not null references public.tenants (id),
      caller_number text,
      sautikit_call_sid text,
      lead_status text not null default 'new'
    );
    create table public.contacts (
      id uuid primary key default gen_random_uuid(),
      updated_at timestamptz not null default now(),
      tenant_id uuid not null, phone text not null
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
  await db.exec(read('docs/supabase/notify_send_ledger.sql'));
  // Columns notify_send_reserve_settle.sql adds (applied on staging and prod).
  await db.exec(`
    alter table public.notify_sends
      add column status text not null default 'sent',
      add column failure_reason text,
      add column settled_at timestamptz;
    alter table public.notify_sends add constraint notify_sends_status_check
      check (status in ('pending', 'sent', 'failed', 'refused'));
  `);
  await db.exec(read('docs/supabase/inbox_archive_cascade.sql'));
  // Apply twice: the file is idempotent.
  for (let i = 0; i < 2; i++) await db.exec(read('docs/supabase/call_messages.sql'));

  await db.query('insert into tenants values ($1), ($2)', [TENANT, OTHER]);
  await db.query(
    `insert into tenant_members values ($1, $2, 'owner'), ($1, $3, 'viewer'), ($4, $5, 'owner')`,
    [TENANT, OWNER, VIEWER, OTHER, STRANGER]
  );
  await db.query(
    `insert into calls (id, tenant_id, caller_number, sautikit_call_sid) values
       ($1, $5, '0712345678', 'sid-1'), ($2, $5, '+254 712 345 678', 'sid-2'),
       ($3, $5, 'withheld', 'sid-3'), ($4, $6, '0799000000', 'sid-x')`,
    [C1, C2, C3, C_OTHER, TENANT, OTHER]
  );
  await db.query(`insert into contacts (id, tenant_id, phone) values ($1, $2, '+254712345678')`, [CONTACT, TENANT]);
  await db.query(`insert into appointments (id, tenant_id, call_id) values ($1, $3, $4), ($2, $3, $5)`, [
    APPT,
    APPT_C2,
    TENANT,
    C1,
    C2,
  ]);
  await db.query(
    `insert into notify_sends (id, tenant_id, call_id, call_sid, kind, channel, recipient, audience, billed_to, body, idempotency_key, status, failure_reason, settled_at, provider_message_id) values
      ($1, $5, $6, null, 'caller_note', 'sms', '254712345678', 'caller', 'tenant', 'Hi', 'k-sent', 'sent', null, '2026-10-22T05:00:00Z', 'pm-1'),
      ($2, $5, $6, null, 'caller_inbox_reply', 'sms', '254712345678', 'caller', 'tenant', 'Hi', 'k-pending', 'pending', null, null, null),
      ($3, $7, null, null, 'caller_note', 'sms', '254799000000', 'caller', 'tenant', 'Hi', 'k-other', 'sent', null, null, null),
      ($4, $5, $6, null, 'caller_note', 'sms', '254712345678', 'caller', 'tenant', 'Hi', 'k-failed', 'failed', 'textsms_402', '2026-10-22T05:01:00Z', null)`,
    [NS_SENT, NS_PENDING, NS_OTHER_T, NS_FAILED, TENANT, C1, OTHER]
  );
});

describe('files', () => {
  it('migration is byte-identical to docs/supabase/call_messages.sql', () => {
    assert.equal(read('supabase/migrations/20261022080000_call_messages.sql'), read('docs/supabase/call_messages.sql'));
  });

  it('every function in the file has an explicit revoke from public and anon', () => {
    const sql = read('docs/supabase/call_messages.sql');
    const defs = [...sql.matchAll(/create or replace function (public\.[a-z_]+)\(/g)].map((m) => m[1]);
    assert.equal(defs.length, 8);
    for (const fn of defs) {
      assert.match(sql, new RegExp(`revoke all on function ${fn.replace('.', '\\.')}\\([^)]*\\) from public, anon`), fn);
    }
  });

  it('ASCII only; backfill is never in a migration', () => {
    for (const f of ['docs/supabase/call_messages.sql', 'docs/supabase/call_messages_backfill_optional.sql']) {
      assert.ok(/^[\x00-\x7f]*$/.test(read(f)), f);
    }
    for (const f of fs.readdirSync(path.join(ROOT, 'supabase/migrations'))) {
      assert.doesNotMatch(read(`supabase/migrations/${f}`), /OPTIONAL BACKFILL for call_messages/, f);
    }
  });
});

describe('grants', () => {
  it('table: RLS on, no anon/authenticated privileges, service_role yes', async () => {
    const { rows } = await db.query(
      `select relrowsecurity as rls,
              has_table_privilege('anon', 'public.call_messages', 'select,insert,update,delete') as anon,
              has_table_privilege('authenticated', 'public.call_messages', 'select') as auth_sel,
              has_table_privilege('authenticated', 'public.call_messages', 'insert,update,delete') as auth_write,
              has_table_privilege('service_role', 'public.call_messages', 'select,insert') as svc
       from pg_class where oid = 'public.call_messages'::regclass`
    );
    assert.deepEqual(rows[0], { rls: true, anon: false, auth_sel: false, auth_write: false, svc: true });
  });

  it('RPCs: authenticated yes, anon no; helpers: nobody', async () => {
    for (const fn of FUNCS) {
      const { rows } = await db.query(
        `select has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as authed`,
        [fn]
      );
      assert.deepEqual(rows[0], { anon: false, authed: true }, fn);
    }
    for (const fn of HELPERS) {
      const { rows } = await db.query(
        `select has_function_privilege('anon', $1, 'execute') as anon,
                has_function_privilege('authenticated', $1, 'execute') as authed`,
        [fn]
      );
      assert.deepEqual(rows[0], { anon: false, authed: false }, fn);
    }
  });
});

describe('phone helper', () => {
  it('matches kePhoneDigits', async () => {
    const cases = {
      '0712345678': '254712345678',
      '+254 712-345-678': '254712345678',
      '712345678': '254712345678',
      '0112345678': '254112345678',
      '254112345678': '254112345678',
      withheld: null,
      '+447700900123': null,
      '': null,
    };
    for (const [raw, want] of Object.entries(cases)) {
      const { rows } = await db.query('select public._call_messages_ke_phone($1) as p', [raw]);
      assert.equal(rows[0].p, want, raw);
    }
  });
});

describe('call_messages_record_out', () => {
  it('records with ledger status, phone, contact and author', async () => {
    const r = await recordOut({ key: 'k-sent', notify: NS_SENT, appt: APPT });
    assert.equal(r.status, 'sent');
    const { rows } = await db.query('select * from call_messages where id = $1', [r.id]);
    const m = rows[0];
    assert.equal(m.phone, '254712345678');
    assert.equal(m.contact_id, CONTACT);
    assert.equal(m.author_kind, 'owner');
    assert.equal(m.author_user_id, OWNER);
    assert.equal(m.direction, 'out');
    assert.equal(m.appointment_id, APPT);
    assert.equal(m.provider_message_id, 'pm-1');
    assert.equal(new Date(m.sent_at).toISOString(), '2026-10-22T05:00:00.000Z');
  });

  it('replayed key is 23505 (Desk: Already sent)', async () => {
    await assert.rejects(recordOut({ key: 'k-sent' }), code('23505'));
    await assert.rejects(recordOut({ key: 'k-sent2', notify: NS_SENT }), code('22023')); // key differs from ledger
  });

  it('without a notify id: pending, then follows the ledger row by key', async () => {
    const r = await recordOut({ key: 'k-pending', source: 'caller_inbox_reply' });
    assert.equal(r.status, 'pending');
    let msg = (await list(C1)).messages.find((x) => x.id === r.id);
    assert.equal(msg.status, 'pending');
    assert.equal(msg.status_from, 'ledger');
    assert.equal(msg.notify_send_id, NS_PENDING);
    await db.exec('alter table notify_sends disable trigger notify_sends_no_update');
    await db.query(
      `update notify_sends set status = 'sent', settled_at = '2026-10-22T05:05:00Z', provider_message_id = 'pm-2' where id = $1`,
      [NS_PENDING]
    );
    await db.exec('alter table notify_sends enable trigger notify_sends_no_update');
    msg = (await list(C1)).messages.find((x) => x.id === r.id);
    assert.equal(msg.status, 'sent');
    assert.equal(msg.provider_message_id, 'pm-2');
    assert.equal(new Date(msg.sent_at).toISOString(), '2026-10-22T05:05:00.000Z');
  });

  it('withheld caller: phone and contact null', async () => {
    const r = await recordOut({ call: C3, key: 'k-c3', source: 'caller_callback' });
    const { rows } = await db.query('select phone, contact_id from call_messages where id = $1', [r.id]);
    assert.deepEqual(rows[0], { phone: null, contact_id: null });
  });

  it('service_role records as system', async () => {
    const r = await recordOut({ call: C2, key: 'k-svc', source: 'missed_textback' }, SERVICE);
    const { rows } = await db.query('select author_kind, author_user_id from call_messages where id = $1', [r.id]);
    assert.deepEqual(rows[0], { author_kind: 'system', author_user_id: null });
  });

  it('bad input is 22023 and writes nothing', async () => {
    const before = (await db.query('select count(*)::int n from call_messages')).rows[0].n;
    for (const o of [
      { key: '' },
      { key: '   ' },
      { key: 'x'.repeat(501) },
      { key: 'b1', source: 'inbound' },
      { key: 'b2', source: 'caller_inbox_reply:abc' },
      { key: 'b3', source: 'lead' },
      { key: 'b4', body: '' },
      { key: 'b5', body: '  ' },
      { key: 'b6', body: 'x'.repeat(1601) },
      { key: 'b7', call: null },
      { key: 'b8', appt: APPT_C2 },
    ]) {
      await assert.rejects(recordOut(o), code('22023'), JSON.stringify(o).slice(0, 60));
    }
    await assert.rejects(recordOut({ key: 'b9', notify: NS_OTHER_T }), code('P0002'));
    await assert.rejects(recordOut({ key: 'b10', call: C_OTHER }), code('P0002'));
    await assert.rejects(recordOut({ key: 'b11', call: MISSING }), code('P0002'));
    await assert.rejects(recordOut({ key: 'b12', appt: MISSING }), code('P0002'));
    assert.equal((await db.query('select count(*)::int n from call_messages')).rows[0].n, before);
    assert.ok(await recordOut({ key: 'b-max', body: 'x'.repeat(1600) }));
  });

  it('viewer, stranger, anon: 42501', async () => {
    await assert.rejects(recordOut({ key: 'v1' }, VIEWER), code('42501'));
    await assert.rejects(recordOut({ key: 'v2' }, STRANGER), code('42501'));
    await assert.rejects(recordOut({ key: 'v3' }, null), code('42501'));
    await assert.rejects(recordOut({ key: 'v4' }, OWNER, null), code('22023'));
  });

  it('clients cannot write the table directly', async () => {
    await db.exec('set role authenticated');
    try {
      await assert.rejects(
        db.query(`insert into call_messages (tenant_id, direction, body, source, author_kind, idempotency_key)
                  values ('${TENANT}', 'out', 'x', 'caller_note', 'owner', 'direct')`),
        /permission denied/
      );
      await assert.rejects(db.query('select * from call_messages'), /permission denied/);
    } finally {
      await db.exec('reset role');
    }
  });
});

describe('call_messages_list', () => {
  it('oldest first, keyset paging on (created_at, id), has_more', async () => {
    await db.query(`delete from call_messages where call_id = $1`, [C2]);
    const times = ['2026-10-22T04:00:00Z', '2026-10-22T04:01:00Z', '2026-10-22T04:02:00Z'];
    for (const t of times) await inbound(C2, `in ${t}`, t);
    const all = await list(C2);
    assert.deepEqual(
      all.messages.map((m) => m.body),
      times.map((t) => `in ${t}`)
    );
    assert.equal(all.has_more, false);
    assert.equal(all.unread_in, 3);
    const page = await list(C2, { limit: 2 });
    assert.deepEqual(page.messages.map((m) => m.body), [`in ${times[1]}`, `in ${times[2]}`]);
    assert.equal(page.has_more, true);
    const older = await list(C2, { limit: 2, before: page.messages[0] });
    assert.deepEqual(older.messages.map((m) => m.body), [`in ${times[0]}`]);
    assert.equal(older.has_more, false);
  });

  it('viewer may read; stranger, anon may not; other tenant call is P0002', async () => {
    assert.ok((await list(C1, {}, VIEWER)).messages.length > 0);
    await assert.rejects(list(C1, {}, STRANGER), code('42501'));
    await assert.rejects(list(C1, {}, null), code('42501'));
    await assert.rejects(list(C_OTHER), code('P0002'));
    assert.deepEqual((await list(C_OTHER, {}, STRANGER, OTHER)).messages, []);
  });

  it('same created_at across a page boundary: split by id, nothing skipped or repeated', async () => {
    // In the future so they sort after C3's earlier outbound row.
    const T = '2099-01-01T00:00:00Z';
    const ids = [
      'f0000000-0000-4000-8000-000000000001',
      'f0000000-0000-4000-8000-000000000002',
      'f0000000-0000-4000-8000-000000000003',
    ];
    // Insert out of id order; two share T with the first-page boundary between them.
    await inbound(C3, 'tie-b', T, ids[1]);
    await inbound(C3, 'tie-a', T, ids[0]);
    await inbound(C3, 'early', '2098-12-31T23:59:59Z', 'f0000000-0000-4000-8000-000000000000');
    await inbound(C3, 'tie-c', T, ids[2]);
    const p1 = await list(C3, { limit: 2 });
    assert.deepEqual(p1.messages.map((m) => m.body), ['tie-b', 'tie-c']);
    assert.equal(p1.has_more, true);
    const p2 = await list(C3, { limit: 2, before: p1.messages[0] });
    assert.deepEqual(p2.messages.map((m) => m.body), ['early', 'tie-a']);
    assert.equal(p2.has_more, true); // C3's older outbound row
    const seen = [...p2.messages, ...p1.messages].filter((m) => m.direction === 'in').map((m) => m.body);
    assert.deepEqual(seen, ['early', 'tie-a', 'tie-b', 'tie-c']);
    // limit 1 walks every row one at a time
    const walk = [];
    let cur = null;
    for (;;) {
      const pg = await list(C3, { limit: 1, before: cur });
      if (!pg.messages.length) break;
      walk.unshift(pg.messages[0].body);
      cur = pg.messages[0];
      if (!pg.has_more) break;
    }
    assert.deepEqual(walk.filter((b) => ['early', 'tie-a', 'tie-b', 'tie-c'].includes(b)), ['early', 'tie-a', 'tie-b', 'tie-c']);
    await db.query(`delete from call_messages where call_id = $1 and direction = 'in'`, [C3]);
  });

  it('cursor needs both parts (22023)', async () => {
    await assert.rejects(list(C1, { beforeAt: '2026-10-22T03:00:00Z' }), code('22023'));
    await assert.rejects(list(C1, { beforeId: C1 }), code('22023'));
  });

  it('limit bounds are 22023', async () => {
    await assert.rejects(list(C1, { limit: 0 }), code('22023'));
    await assert.rejects(list(C1, { limit: 101 }), code('22023'));
    assert.ok(await list(C1, { limit: 100 }));
    await assert.rejects(list(null), code('22023'));
  });
});

describe('unread + mark_read', () => {
  it('unread counts per call, only non-zero, max 200', async () => {
    const r = await unread([C1, C2, C_OTHER, MISSING, null]);
    assert.deepEqual(r, { [C2]: 3 });
    assert.deepEqual(await unread([C2], VIEWER), { [C2]: 3 });
    await assert.rejects(unread([C2], STRANGER), code('42501'));
    await assert.rejects(unread([C2], null), code('42501'));
    const many = Array.from({ length: 201 }, (_, i) => `d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    await assert.rejects(unread(many), code('22023'));
    assert.deepEqual(await unread([]), {});
  });

  it('mark_read marks inbound only, is idempotent, writers only', async () => {
    await assert.rejects(markRead(C2, VIEWER), code('42501'));
    await assert.rejects(markRead(C_OTHER), code('P0002'));
    assert.deepEqual(await markRead(C2), { marked: 3 });
    assert.deepEqual(await markRead(C2), { marked: 0 });
    assert.deepEqual(await markRead(C1), { marked: 0 });
    assert.equal((await list(C2)).unread_in, 0);
    assert.deepEqual(await unread([C2]), {});
  });

  it('read_at on outbound and author on inbound are refused by checks', async () => {
    await assert.rejects(db.query(`update call_messages set read_at = now() where direction = 'out'`), /read_at_check/);
    await assert.rejects(
      db.query(`update call_messages set author_kind = 'owner' where direction = 'in'`),
      /author_check/
    );
  });
});

describe('call_messages_retry', () => {
  it('retries a failed message once; key gets :retry; replays are 23505', async () => {
    const f = await recordOut({ key: 'k-failed', notify: NS_FAILED });
    assert.equal(f.status, 'failed');
    const r = await retry(f.id);
    assert.equal(r.retry_of, f.id);
    assert.equal(r.idempotency_key, 'k-failed:retry');
    const { rows } = await db.query('select * from call_messages where id = $1', [r.id]);
    assert.equal(rows[0].status, 'pending');
    assert.equal(rows[0].body, 'Hi, we open at 9');
    assert.equal(rows[0].phone, '254712345678');
    await assert.rejects(retry(f.id), code('23505'));
  });

  it('pending whose ledger row failed is retryable (status from the ledger)', async () => {
    const m = await recordOut({ key: 'k-late-fail' });
    await assert.rejects(retry(m.id), code('22023')); // no ledger row yet: still pending
    await db.query(
      `insert into notify_sends (tenant_id, call_id, kind, channel, recipient, audience, billed_to, body, idempotency_key, status, failure_reason)
       values ($1, $2, 'caller_note', 'sms', '254712345678', 'caller', 'tenant', 'Hi', 'k-late-fail', 'failed', 'textsms_402')`,
      [TENANT, C1]
    );
    const msg = (await list(C1, { limit: 100 })).messages.find((x) => x.id === m.id);
    assert.equal(msg.status, 'failed');
    assert.equal(msg.failure_reason, 'textsms_402');
    assert.ok(await retry(m.id));
  });

  it('sent and inbound are not retryable; other tenant P0002; viewer 42501', async () => {
    const sent = (await db.query(`select id from call_messages where idempotency_key = 'k-sent'`)).rows[0].id;
    await assert.rejects(retry(sent), code('22023'));
    const inb = (await db.query(`select id from call_messages where direction = 'in' limit 1`)).rows[0].id;
    await assert.rejects(retry(inb), code('22023'));
    await assert.rejects(retry(sent, OWNER, OTHER), code('42501'));
    await assert.rejects(retry(sent, STRANGER, OTHER), code('P0002'));
    await assert.rejects(retry(sent, VIEWER), code('42501'));
    await assert.rejects(retry(MISSING), code('P0002'));
    await assert.rejects(retry(null), code('22023'));
  });
});

describe('optional backfill (run here only)', () => {
  it('copies caller SMS by call_id or call_sid, strips kind suffix, re-runnable', async () => {
    await db.query(
      `insert into notify_sends (tenant_id, call_id, call_sid, kind, channel, recipient, audience, billed_to, body, idempotency_key, status) values
        ($1, $2, null, 'caller_inbox_reply:0ac3d01f-47f4-410d-a08d-0e0285c362ce', 'sms', '0712345678', 'caller', 'tenant', 'old reply', 'bf-1', 'sent'),
        ($1, null, 'sid-2', 'caller_appointment', 'sms', '254712345678', 'caller', 'tenant', 'booked', 'bf-2', 'sent'),
        ($1, null, 'sid-none', 'caller_hold', 'sms', '254712345678', 'caller', 'tenant', 'no call', 'bf-3', 'sent'),
        ($1, $2, null, 'lead', 'sms', '254700000000', 'staff', 'tenant', 'staff', 'bf-4', 'sent'),
        ($1, $2, null, 'caller_note', 'whatsapp', '254712345678', 'caller', 'tenant', 'wa', 'bf-5', 'sent'),
        ($1, $2, null, 'caller_note', 'sms', '254712345678', 'caller', 'tenant', null, 'bf-6', 'sent'),
        ($1, $2, null, 'caller_order', 'sms', '254712345678', 'caller', 'tenant', 'order ready', 'bf-7', 'refused')`,
      [TENANT, C1]
    );
    const sql = read('docs/supabase/call_messages_backfill_optional.sql');
    const first = await db.exec(sql);
    const n = first.find((r) => r.affectedRows != null)?.affectedRows;
    const got = await db.query(
      `select idempotency_key k, call_id, source, author_kind, status, phone, contact_id, sent_at is not null s, failed_at is not null f
       from call_messages where idempotency_key like 'bf-%' order by 1`
    );
    assert.deepEqual(
      got.rows.map((r) => [r.k, r.call_id, r.source, r.author_kind, r.status, r.phone, r.contact_id, r.s, r.f]),
      [
        ['bf-1', C1, 'caller_inbox_reply', 'owner', 'sent', '254712345678', CONTACT, true, false],
        ['bf-2', C2, 'caller_appointment', 'assistant', 'sent', '254712345678', CONTACT, true, false],
        ['bf-7', C1, 'caller_order', 'system', 'refused', '254712345678', CONTACT, false, true],
      ]
    );
    // Already-recorded ledger rows (k-sent, k-failed, ...) were not duplicated.
    const dup = await db.query(`select count(*)::int n from call_messages where idempotency_key = 'k-sent'`);
    assert.equal(dup.rows[0].n, 1);
    // Ledger rows not yet in the thread for C1 (k-late-fail is linked by key) stay single.
    const before2 = (await db.query('select count(*)::int n from call_messages')).rows[0].n;
    await db.exec(sql);
    assert.equal((await db.query('select count(*)::int n from call_messages')).rows[0].n, before2);
    assert.ok(n === undefined || n >= 3);
  });
});
