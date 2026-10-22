-- call_messages: one row per SMS on a call, so Desk can show a per-call text
-- thread next to the transcript. DRAFT: not applied anywhere yet. Staging
-- first with a go; prod only with Alvin's yes.
-- Run after: notify_send_ledger.sql + notify_send_reserve_settle.sql
-- (notify_sends with status/failure_reason/settled_at), contacts_and_requests.sql,
-- appointments.sql, inbox_archive_cascade.sql (_inbox_archive_assert_writer).
--
-- Outbound only for now. The table keeps the inbound columns (direction 'in',
-- status 'received', read_at) so the shape does not change later, but there is
-- NO inbound write path here: callers texting back needs an inbound SMS
-- webhook (Ops/Voice lane) and Alvin's decision. Today TextSMS sends from one
-- shared sender ID, so callers likely cannot reply at all.
--
-- Status vocabulary follows notify_sends (pending | sent | failed | refused)
-- plus 'delivered' (only once a delivery report exists; nothing sets it yet)
-- and 'received' (inbound only). There is no queued/sending: a reserved,
-- not-yet-settled send is 'pending' in the ledger and here.
--
-- Status sync without touching reserve/settle (Ops lane): while a message row
-- is 'pending', the read RPCs show the live status of its notify_sends row
-- (by notify_send_id, else by (tenant_id, idempotency_key)), with
-- "status_from": "ledger". Hooking reserve_notify_send / settle_notify_send to
-- write call_messages directly is a follow-up for Ops.
--
-- Access: RLS on, NO table grants to anon or authenticated (explicit revoke,
-- because Supabase default privileges grant new tables to them). Members read
-- only through the RPCs below; there are no client insert/update/delete paths.
-- service_role keeps table access (backfill, future inbound webhook).
--
-- Adds:
--   table call_messages (+ indexes, RLS on, no policies)
--   _call_messages_ke_phone(text) -> text            (helper, no client grants)
--   _call_messages_assert_member(uuid)               (helper, no client grants)
--   call_messages_list(p_tenant_id, p_call_id, p_before_created_at timestamptz default null,
--                      p_before_id uuid default null, p_limit int default 50)
--     -> jsonb {"messages": [...oldest first], "unread_in": int, "has_more": bool}
--     Keyset paging on (created_at, id): pass the oldest message's created_at
--     and id to get the page before it. Both or neither, else 22023.
--   call_messages_mark_read(p_tenant_id, p_call_id) -> jsonb {"marked": int}
--   call_messages_unread_counts(p_tenant_id, p_call_ids uuid[]) -> jsonb {"<call_id>": n, ...} (only n > 0)
--   call_messages_record_out(p_tenant_id, p_call_id, p_key, p_source, p_body, p_notify_send_id,
--                            p_appointment_id default null, p_request_id default null)
--     -> jsonb {"id", "status", "created_at"}
--   call_messages_retry(p_tenant_id, p_message_id) -> jsonb {"id", "idempotency_key", "retry_of"}
--
-- Who: list and unread_counts: any member of the tenant (viewer included) or
-- service_role. mark_read, record_out, retry: owner/admin/staff
-- (member_can_write) or service_role. Everyone else: 42501 'not allowed'.
-- Errors: 22023 bad input, 42501 not allowed, P0002 not found (including
-- another tenant's call/message), 23505 replayed key (Desk: "Already sent").
--
-- ADDITIVE. ASCII-only. Safe to re-run.
--
-- Rollback (in this order; drops the thread rows, notify_sends is untouched):
--   drop function if exists public.call_messages_retry(uuid, uuid);
--   drop function if exists public.call_messages_record_out(uuid, uuid, text, text, text, uuid, uuid, uuid);
--   drop function if exists public.call_messages_unread_counts(uuid, uuid[]);
--   drop function if exists public.call_messages_mark_read(uuid, uuid);
--   drop function if exists public.call_messages_list(uuid, uuid, timestamptz, uuid, integer);
--   drop function if exists public._call_messages_rows(uuid, uuid, timestamptz, uuid, integer);
--   drop function if exists public._call_messages_assert_member(uuid);
--   drop table if exists public.call_messages;
--   drop function if exists public._call_messages_ke_phone(text);

-- ---------------------------------------------------------------------------
-- 1. Phone helper: same rule as dashboard/src/lib/kePhone.ts kePhoneDigits().
--    07xx/01xx -> 2547xx/2541xx, 9 digits 7/1 -> 254..., 254/+254 kept,
--    anything else -> null.
-- ---------------------------------------------------------------------------
create or replace function public._call_messages_ke_phone(p_raw text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when d ~ '^254[17][0-9]{8}$' then d
    when d ~ '^0[17][0-9]{8}$' then '254' || substr(d, 2)
    when d ~ '^[17][0-9]{8}$' then '254' || d
    else null
  end
  from (select regexp_replace(coalesce(p_raw, ''), '[^0-9]', '', 'g') as d) x;
$$;

revoke all on function public._call_messages_ke_phone(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Table
-- ---------------------------------------------------------------------------
create table if not exists public.call_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  call_id uuid references public.calls (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  phone text,
  direction text not null,
  body text not null,
  status text not null default 'pending',
  failure_reason text,
  retry_of uuid references public.call_messages (id) on delete set null,
  author_kind text,
  author_user_id uuid,
  source text not null,
  appointment_id uuid references public.appointments (id) on delete set null,
  request_id uuid references public.service_requests (id) on delete set null,
  approved_by uuid,
  approved_at timestamptz,
  read_at timestamptz,
  idempotency_key text not null,
  notify_send_id uuid references public.notify_sends (id) on delete set null,
  provider text,
  provider_message_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  constraint call_messages_direction_check check (direction in ('in', 'out')),
  constraint call_messages_status_check check (
    status in ('pending', 'sent', 'delivered', 'failed', 'refused', 'received')
  ),
  constraint call_messages_status_direction_check check (
    (direction = 'in') = (status = 'received')
  ),
  constraint call_messages_source_check check (
    source in (
      'caller_note', 'caller_inbox_reply', 'caller_callback',
      'caller_appointment', 'caller_appointment_confirmed',
      'caller_appointment_cancelled', 'caller_appointment_rescheduled',
      'caller_hold', 'caller_hold_updated', 'caller_hold_ready',
      'caller_hold_cancelled', 'caller_order', 'missed_textback',
      'inbound'
    )
  ),
  constraint call_messages_source_direction_check check (
    (direction = 'in') = (source = 'inbound')
  ),
  constraint call_messages_author_check check (
    (direction = 'out' and author_kind in ('owner', 'assistant', 'system'))
    or (direction = 'in' and author_kind is null and author_user_id is null)
  ),
  constraint call_messages_read_at_check check (direction = 'in' or read_at is null),
  constraint call_messages_body_check check (char_length(body) between 1 and 1600),
  constraint call_messages_phone_check check (phone is null or phone ~ '^254[17][0-9]{8}$'),
  constraint call_messages_key_check check (char_length(idempotency_key) between 1 and 500),
  constraint call_messages_failure_reason_check check (
    failure_reason is null or char_length(failure_reason) <= 200
  )
);

comment on table public.call_messages is
  'Per-call SMS thread for Desk (outbound now; inbound columns reserved). Read via call_messages_* RPCs only. Billing stays on notify_sends.';
comment on column public.call_messages.status is
  'pending | sent | delivered (needs DLR) | failed | refused (out); received (in). Mirrors notify_sends.status.';
comment on column public.call_messages.idempotency_key is
  'Same key as the notify_sends row (deskSendKey). Unique per tenant; a replay is 23505.';
comment on column public.call_messages.read_at is
  'Inbound only: when an owner/staff opened the thread (call_messages_mark_read).';

create unique index if not exists call_messages_tenant_key_uidx
  on public.call_messages (tenant_id, idempotency_key);
create unique index if not exists call_messages_notify_send_uidx
  on public.call_messages (notify_send_id)
  where notify_send_id is not null;
create unique index if not exists call_messages_retry_of_uidx
  on public.call_messages (retry_of)
  where retry_of is not null;
-- Thread paging: call_messages_list filters (tenant_id, call_id), seeks
-- (created_at, id) < cursor and reads "order by created_at desc, id desc
-- limit n". This index matches that exactly (backward scan, stops after n
-- rows, no sort). The sent_at index below cannot: sent_at is null while
-- pending and is not the paging key.
create index if not exists call_messages_tenant_call_created_id_idx
  on public.call_messages (tenant_id, call_id, created_at, id);
create index if not exists call_messages_tenant_call_sent_idx
  on public.call_messages (tenant_id, call_id, sent_at);
create index if not exists call_messages_tenant_phone_sent_idx
  on public.call_messages (tenant_id, phone, sent_at);
create index if not exists call_messages_unread_in_idx
  on public.call_messages (tenant_id, call_id)
  where direction = 'in' and read_at is null;

alter table public.call_messages enable row level security;

-- No policies: clients never touch the table directly.
revoke all on public.call_messages from public, anon, authenticated;
grant all on public.call_messages to service_role;

-- ---------------------------------------------------------------------------
-- 3. Access helper: any member (viewer included) or service_role.
-- ---------------------------------------------------------------------------
create or replace function public._call_messages_assert_member(p_tenant_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_tenant_id is null then
    raise exception 'tenant required' using errcode = '22023';
  end if;
  if auth.uid() is null then
    if coalesce(auth.role(), '') <> 'service_role' then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    return;
  end if;
  if public.current_member_role(p_tenant_id) is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public._call_messages_assert_member(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Rows with live ledger status (internal; callers check access first).
--    While a message is 'pending', status/sent_at/failed_at/failure_reason/
--    provider_message_id come from its notify_sends row.
-- ---------------------------------------------------------------------------
drop function if exists public._call_messages_rows(uuid, uuid, timestamptz, integer);

create or replace function public._call_messages_rows(
  p_tenant_id uuid,
  p_call_id uuid,
  p_before_created_at timestamptz,
  p_before_id uuid,
  p_limit integer
)
returns setof jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', m.id,
    'created_at', m.created_at,
    'call_id', m.call_id,
    'contact_id', m.contact_id,
    'phone', m.phone,
    'direction', m.direction,
    'body', m.body,
    'status', case when lv then n.status else m.status end,
    'status_from', case when lv then 'ledger' else 'message' end,
    'failure_reason', case when lv then n.failure_reason else m.failure_reason end,
    'retry_of', m.retry_of,
    'author_kind', m.author_kind,
    'author_user_id', m.author_user_id,
    'source', m.source,
    'appointment_id', m.appointment_id,
    'request_id', m.request_id,
    'approved_by', m.approved_by,
    'approved_at', m.approved_at,
    'read_at', m.read_at,
    'idempotency_key', m.idempotency_key,
    'notify_send_id', coalesce(m.notify_send_id, n.id),
    'channel', coalesce(n.channel, 'sms'),
    'provider', m.provider,
    'provider_message_id', case when lv then n.provider_message_id else m.provider_message_id end,
    'sent_at', case when lv and n.status = 'sent'
                    then coalesce(n.settled_at, n.created_at) else m.sent_at end,
    'delivered_at', m.delivered_at,
    'failed_at', case when lv and n.status in ('failed', 'refused')
                      then coalesce(n.settled_at, n.created_at) else m.failed_at end
  )
  from (
    select m.*
    from public.call_messages m
    where m.tenant_id = p_tenant_id
      and m.call_id = p_call_id
      and (p_before_created_at is null
           or (m.created_at, m.id) < (p_before_created_at, p_before_id))
    order by m.created_at desc, m.id desc
    limit p_limit
  ) m
  left join lateral (
    select x.id, x.status, x.failure_reason, x.settled_at, x.created_at,
           x.provider_message_id, x.channel
    from public.notify_sends x
    where (m.notify_send_id is not null and x.id = m.notify_send_id)
       or (m.notify_send_id is null and x.tenant_id = m.tenant_id
           and x.idempotency_key = m.idempotency_key)
    limit 1
  ) n on true
  cross join lateral (
    select (m.direction = 'out' and m.status = 'pending' and n.status is not null) as lv
  ) f
  order by m.created_at, m.id;
$$;

revoke all on function public._call_messages_rows(uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. call_messages_list: one page of a call's thread, oldest first.
--    Keyset paging on (created_at, id): rows with (created_at, id) below the
--    cursor, newest p_limit of them, returned oldest first. Pass the first
--    (oldest) message's created_at + id to page back. Ties on created_at are
--    split by id, so no row is skipped or repeated across pages.
--    p_before_created_at and p_before_id: both or neither. p_limit 1..100.
-- ---------------------------------------------------------------------------
drop function if exists public.call_messages_list(uuid, uuid, timestamptz, integer);

create or replace function public.call_messages_list(
  p_tenant_id uuid,
  p_call_id uuid,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := coalesce(p_limit, 50);
  v_rows jsonb;
  v_unread integer;
  v_more boolean;
  v_oldest_at timestamptz;
  v_oldest_id uuid;
begin
  perform public._call_messages_assert_member(p_tenant_id);

  if p_call_id is null then
    raise exception 'call id required' using errcode = '22023';
  end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'p_before_created_at and p_before_id go together' using errcode = '22023';
  end if;
  if v_limit < 1 or v_limit > 100 then
    raise exception 'limit must be 1..100 (got %)', v_limit using errcode = '22023';
  end if;
  if not exists (select 1 from public.calls c where c.id = p_call_id and c.tenant_id = p_tenant_id) then
    raise exception 'call not found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(r order by (r ->> 'created_at')::timestamptz, (r ->> 'id')::uuid), '[]'::jsonb)
    into v_rows
  from public._call_messages_rows(p_tenant_id, p_call_id, p_before_created_at, p_before_id, v_limit) as r;

  if jsonb_array_length(v_rows) > 0 then
    v_oldest_at := (v_rows -> 0 ->> 'created_at')::timestamptz;
    v_oldest_id := (v_rows -> 0 ->> 'id')::uuid;
    select exists (
      select 1 from public.call_messages m
      where m.tenant_id = p_tenant_id and m.call_id = p_call_id
        and (m.created_at, m.id) < (v_oldest_at, v_oldest_id)
    ) into v_more;
  else
    v_more := false;
  end if;

  select count(*)::int into v_unread
  from public.call_messages m
  where m.tenant_id = p_tenant_id and m.call_id = p_call_id
    and m.direction = 'in' and m.read_at is null;

  return jsonb_build_object('messages', v_rows, 'unread_in', v_unread, 'has_more', v_more);
end;
$$;

revoke all on function public.call_messages_list(uuid, uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.call_messages_list(uuid, uuid, timestamptz, uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. call_messages_mark_read: stamp read_at on the call's unread inbound rows.
-- ---------------------------------------------------------------------------
create or replace function public.call_messages_mark_read(p_tenant_id uuid, p_call_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  perform public._inbox_archive_assert_writer(p_tenant_id);

  if p_call_id is null then
    raise exception 'call id required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.calls c where c.id = p_call_id and c.tenant_id = p_tenant_id) then
    raise exception 'call not found' using errcode = 'P0002';
  end if;

  update public.call_messages m
     set read_at = now()
   where m.tenant_id = p_tenant_id
     and m.call_id = p_call_id
     and m.direction = 'in'
     and m.read_at is null;
  get diagnostics v_n = row_count;

  return jsonb_build_object('marked', v_n);
end;
$$;

revoke all on function public.call_messages_mark_read(uuid, uuid) from public, anon;
grant execute on function public.call_messages_mark_read(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. call_messages_unread_counts: inbox row badges. Max 200 ids. Only calls
--    with unread > 0 appear; ids of other tenants simply count nothing.
-- ---------------------------------------------------------------------------
create or replace function public.call_messages_unread_counts(p_tenant_id uuid, p_call_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_out jsonb;
begin
  perform public._call_messages_assert_member(p_tenant_id);

  select coalesce(array_agg(distinct x), '{}')
    into v_ids
  from unnest(coalesce(p_call_ids, '{}'::uuid[])) as x
  where x is not null;

  if cardinality(v_ids) > 200 then
    raise exception 'too many calls (max 200, got %)', cardinality(v_ids)
      using errcode = '22023';
  end if;

  select coalesce(jsonb_object_agg(m.call_id, m.n), '{}'::jsonb)
    into v_out
  from (
    select cm.call_id, count(*)::int as n
    from public.call_messages cm
    where cm.tenant_id = p_tenant_id
      and cm.call_id = any (v_ids)
      and cm.direction = 'in'
      and cm.read_at is null
    group by cm.call_id
  ) m;

  return v_out;
end;
$$;

revoke all on function public.call_messages_unread_counts(uuid, uuid[]) from public, anon;
grant execute on function public.call_messages_unread_counts(uuid, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. call_messages_record_out: record one outbound SMS on a call.
--    Desk calls it with the same key it gave reserve_notify_send (deskSendKey)
--    and, when it has one, the notify_sends id. Phone comes from the call's
--    caller_number; contact is the tenant's contact with that number.
--    Status: copied from the linked notify_sends row when given, else 'pending'
--    (the read RPCs then follow the ledger row with the same key).
--    author_kind: 'owner' for a signed-in member, 'system' for service_role.
-- ---------------------------------------------------------------------------
create or replace function public.call_messages_record_out(
  p_tenant_id uuid,
  p_call_id uuid,
  p_key text,
  p_source text,
  p_body text,
  p_notify_send_id uuid,
  p_appointment_id uuid default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := nullif(btrim(coalesce(p_key, '')), '');
  v_uid uuid := auth.uid();
  v_phone text;
  v_contact uuid;
  v_n record;
  v_link_call uuid;
  v_status text := 'pending';
  v_sent timestamptz;
  v_failed timestamptz;
  v_reason text;
  v_pmid text;
  v_id uuid;
  v_created timestamptz;
begin
  perform public._inbox_archive_assert_writer(p_tenant_id);

  if p_call_id is null then
    raise exception 'call id required' using errcode = '22023';
  end if;
  if v_key is null then
    raise exception 'key required' using errcode = '22023';
  end if;
  if char_length(v_key) > 500 then
    raise exception 'key too long (max 500)' using errcode = '22023';
  end if;
  if p_source is null or p_source = 'inbound' or p_source not in (
      'caller_note', 'caller_inbox_reply', 'caller_callback',
      'caller_appointment', 'caller_appointment_confirmed',
      'caller_appointment_cancelled', 'caller_appointment_rescheduled',
      'caller_hold', 'caller_hold_updated', 'caller_hold_ready',
      'caller_hold_cancelled', 'caller_order', 'missed_textback') then
    raise exception 'bad source %', coalesce(p_source, '(null)') using errcode = '22023';
  end if;
  if p_body is null or btrim(p_body) = '' then
    raise exception 'body required' using errcode = '22023';
  end if;
  if char_length(p_body) > 1600 then
    raise exception 'body too long (max 1600, got %)', char_length(p_body)
      using errcode = '22023';
  end if;

  select public._call_messages_ke_phone(c.caller_number)
    into v_phone
  from public.calls c
  where c.id = p_call_id and c.tenant_id = p_tenant_id;
  if not found then
    raise exception 'call not found' using errcode = 'P0002';
  end if;

  if p_notify_send_id is not null then
    select n.* into v_n
    from public.notify_sends n
    where n.id = p_notify_send_id and n.tenant_id = p_tenant_id;
    if not found then
      raise exception 'notify send not found' using errcode = 'P0002';
    end if;
    if v_n.audience <> 'caller' then
      raise exception 'notify send is not a caller send' using errcode = '22023';
    end if;
    if v_n.call_id is not null and v_n.call_id <> p_call_id then
      raise exception 'notify send belongs to another call' using errcode = '22023';
    end if;
    if v_n.idempotency_key <> v_key then
      raise exception 'notify send key differs from p_key' using errcode = '22023';
    end if;
    v_status := v_n.status;
    v_reason := v_n.failure_reason;
    v_pmid := v_n.provider_message_id;
    if v_status = 'sent' then
      v_sent := coalesce(v_n.settled_at, v_n.created_at);
    elsif v_status in ('failed', 'refused') then
      v_failed := coalesce(v_n.settled_at, v_n.created_at);
    end if;
  end if;

  if p_appointment_id is not null then
    select a.call_id into v_link_call
    from public.appointments a
    where a.id = p_appointment_id and a.tenant_id = p_tenant_id;
    if not found then
      raise exception 'appointment not found' using errcode = 'P0002';
    end if;
    if v_link_call is not null and v_link_call <> p_call_id then
      raise exception 'appointment belongs to another call' using errcode = '22023';
    end if;
  end if;
  if p_request_id is not null then
    select s.call_id into v_link_call
    from public.service_requests s
    where s.id = p_request_id and s.tenant_id = p_tenant_id;
    if not found then
      raise exception 'request not found' using errcode = 'P0002';
    end if;
    if v_link_call is not null and v_link_call <> p_call_id then
      raise exception 'request belongs to another call' using errcode = '22023';
    end if;
  end if;

  if exists (select 1 from public.call_messages m
             where m.tenant_id = p_tenant_id and m.idempotency_key = v_key) then
    raise exception 'already recorded' using errcode = '23505';
  end if;

  if v_phone is not null then
    select ct.id into v_contact
    from public.contacts ct
    where ct.tenant_id = p_tenant_id
      and ct.phone in (v_phone, '+' || v_phone, '0' || substr(v_phone, 4))
    order by ct.updated_at desc nulls last
    limit 1;
  end if;

  insert into public.call_messages (
    tenant_id, call_id, contact_id, phone, direction, body, status,
    failure_reason, author_kind, author_user_id, source,
    appointment_id, request_id, idempotency_key, notify_send_id,
    provider_message_id, sent_at, failed_at
  ) values (
    p_tenant_id, p_call_id, v_contact, v_phone, 'out', p_body, v_status,
    left(v_reason, 200), case when v_uid is null then 'system' else 'owner' end, v_uid, p_source,
    p_appointment_id, p_request_id, v_key, p_notify_send_id,
    v_pmid, v_sent, v_failed
  )
  returning id, created_at into v_id, v_created;

  return jsonb_build_object('id', v_id, 'status', v_status, 'created_at', v_created);
end;
$$;

revoke all on function public.call_messages_record_out(uuid, uuid, text, text, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.call_messages_record_out(uuid, uuid, text, text, text, uuid, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. call_messages_retry: a new 'pending' outbound row copying a failed or
--    refused one (same call, phone, contact, body, source, links), with
--    retry_of = the original and key = original key || ':retry'. Desk then
--    reserves/sends with the returned key; the read RPCs follow that ledger row.
--    A message can be retried once (retry the retry after that); a second
--    retry of the same message, or a replayed key, is 23505.
-- ---------------------------------------------------------------------------
create or replace function public.call_messages_retry(p_tenant_id uuid, p_message_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_m public.call_messages%rowtype;
  v_live text;
  v_key text;
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  perform public._inbox_archive_assert_writer(p_tenant_id);

  if p_message_id is null then
    raise exception 'message id required' using errcode = '22023';
  end if;

  select m.* into v_m
  from public.call_messages m
  where m.id = p_message_id and m.tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'message not found' using errcode = 'P0002';
  end if;
  if v_m.direction <> 'out' then
    raise exception 'only outbound messages can be retried' using errcode = '22023';
  end if;

  v_live := v_m.status;
  if v_m.status = 'pending' then
    select n.status into v_live
    from public.notify_sends n
    where (v_m.notify_send_id is not null and n.id = v_m.notify_send_id)
       or (v_m.notify_send_id is null and n.tenant_id = v_m.tenant_id
           and n.idempotency_key = v_m.idempotency_key)
    limit 1;
    v_live := coalesce(v_live, 'pending');
  end if;
  if v_live not in ('failed', 'refused') then
    raise exception 'not retryable (status %)', v_live using errcode = '22023';
  end if;

  if exists (select 1 from public.call_messages r where r.retry_of = v_m.id) then
    raise exception 'already retried' using errcode = '23505';
  end if;

  v_key := v_m.idempotency_key || ':retry';
  if char_length(v_key) > 500 then
    raise exception 'retry chain too long' using errcode = '22023';
  end if;
  if exists (select 1 from public.call_messages m
             where m.tenant_id = p_tenant_id and m.idempotency_key = v_key) then
    raise exception 'already recorded' using errcode = '23505';
  end if;

  insert into public.call_messages (
    tenant_id, call_id, contact_id, phone, direction, body, status,
    retry_of, author_kind, author_user_id, source,
    appointment_id, request_id, idempotency_key
  ) values (
    v_m.tenant_id, v_m.call_id, v_m.contact_id, v_m.phone, 'out', v_m.body, 'pending',
    v_m.id, case when v_uid is null then 'system' else 'owner' end, v_uid, v_m.source,
    v_m.appointment_id, v_m.request_id, v_key
  )
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'idempotency_key', v_key, 'retry_of', v_m.id);
end;
$$;

revoke all on function public.call_messages_retry(uuid, uuid) from public, anon;
grant execute on function public.call_messages_retry(uuid, uuid) to authenticated, service_role;
