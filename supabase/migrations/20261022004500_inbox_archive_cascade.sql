-- Inbox archive cascade: archiving a call also hides its open holds and
-- visits from the Desk inbox, and one Undo restores all of them together.
-- Run after lead_status_archive.sql, contacts_and_requests.sql,
-- appointments.sql and supabase/migrations/20261011000000_team_invites.sql
-- (member_can_write).
--
-- Why a flag and not a status: holds and visits keep their real status.
-- Reusing cancelled / fulfilled would change Voice's caller memory
-- (listRequestsByStatus, listOpenAppointments) and the calendar. Those
-- readers filter on status only, so a flagged row still reads as open to
-- Voice and the calendar. Only the Desk inbox reads inbox_archived_at.
--
-- Adds:
--   service_requests.inbox_archived_at, appointments.inbox_archived_at
--     (timestamptz null; null = shown in the inbox) + partial indexes.
--   inbox_archive_undo (RLS on, no policies, no anon/authenticated grants;
--     reached only through the two functions below).
--   inbox_archive_calls(p_tenant_id uuid, p_call_ids uuid[]) returns jsonb
--   inbox_undo_archive(p_tenant_id uuid, p_undo_id uuid) returns jsonb
--
-- Access: a signed-in member with write access (member_can_write: owner,
-- admin, staff) of p_tenant_id, or service_role. Viewers, non-members and
-- anon are refused with 42501 'not allowed'.
--
-- ADDITIVE. ASCII-only. Safe to re-run.
--
-- Rollback (run in this order):
--   drop function if exists public.inbox_undo_archive(uuid, uuid);
--   drop function if exists public.inbox_archive_calls(uuid, uuid[]);
--   drop function if exists public._inbox_archive_assert_writer(uuid);
--   drop table if exists public.inbox_archive_undo;
--   drop index if exists public.service_requests_inbox_live_idx;
--   drop index if exists public.appointments_inbox_live_idx;
--   alter table public.service_requests drop column if exists inbox_archived_at;
--   alter table public.appointments drop column if exists inbox_archived_at;
-- Rolling back does not un-archive calls (lead_status stays archived);
-- run any pending undo first if that matters.

-- ---------------------------------------------------------------------------
-- 1. Flag columns (status columns are not touched)
-- ---------------------------------------------------------------------------
alter table public.service_requests
  add column if not exists inbox_archived_at timestamptz;
alter table public.appointments
  add column if not exists inbox_archived_at timestamptz;

comment on column public.service_requests.inbox_archived_at is
  'Desk inbox archive stamp. Null = shown. Set/cleared only by inbox_archive_calls / inbox_undo_archive. Status is unchanged; Voice and the calendar ignore this column.';
comment on column public.appointments.inbox_archived_at is
  'Desk inbox archive stamp. Null = shown. Set/cleared only by inbox_archive_calls / inbox_undo_archive. Status is unchanged; Voice and the calendar ignore this column.';

create index if not exists service_requests_inbox_live_idx
  on public.service_requests (tenant_id, call_id)
  where inbox_archived_at is null;
create index if not exists appointments_inbox_live_idx
  on public.appointments (tenant_id, call_id)
  where inbox_archived_at is null;

-- ---------------------------------------------------------------------------
-- 2. Undo records
-- ---------------------------------------------------------------------------
create table if not exists public.inbox_archive_undo (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  payload jsonb not null,
  consumed_at timestamptz
);

comment on table public.inbox_archive_undo is
  'One row per inbox_archive_calls run that changed something. payload = {calls:[{id,prev}], holds:[ids], visits:[ids]}. consumed_at set by inbox_undo_archive. No direct client access.';

create index if not exists inbox_archive_undo_tenant_created_idx
  on public.inbox_archive_undo (tenant_id, created_at desc);

alter table public.inbox_archive_undo enable row level security;
revoke all on table public.inbox_archive_undo from public, anon, authenticated;
grant all on table public.inbox_archive_undo to service_role;

-- ---------------------------------------------------------------------------
-- 3. Shared access check
-- ---------------------------------------------------------------------------
create or replace function public._inbox_archive_assert_writer(p_tenant_id uuid)
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
  if not public.member_can_write(p_tenant_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public._inbox_archive_assert_writer(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Archive
-- ---------------------------------------------------------------------------
create or replace function public.inbox_archive_calls(p_tenant_id uuid, p_call_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_calls jsonb := '[]'::jsonb;
  v_archive uuid[] := '{}';
  v_holds uuid[] := '{}';
  v_visits uuid[] := '{}';
  v_skipped uuid[] := '{}';
  v_skipped_detail jsonb := '[]'::jsonb;
  v_undo uuid;
  r record;
begin
  perform public._inbox_archive_assert_writer(p_tenant_id);

  select coalesce(array_agg(distinct x), '{}')
    into v_ids
  from unnest(coalesce(p_call_ids, '{}'::uuid[])) as x
  where x is not null;

  if cardinality(v_ids) > 200 then
    raise exception 'too many calls (max 200, got %)', cardinality(v_ids)
      using errcode = '22023';
  end if;

  if cardinality(v_ids) = 0 then
    return jsonb_build_object(
      'undo_id', null, 'calls', '[]'::jsonb, 'holds', '[]'::jsonb,
      'visits', '[]'::jsonb, 'skipped', '[]'::jsonb, 'skipped_detail', '[]'::jsonb);
  end if;

  -- Lock this tenant's rows only, in a stable order.
  for r in
    select c.id, c.lead_status
    from public.calls c
    where c.id = any (v_ids)
      and c.tenant_id = p_tenant_id
    order by c.id
    for update
  loop
    if r.lead_status = 'archived' then
      v_skipped := v_skipped || r.id;
      v_skipped_detail := v_skipped_detail
        || jsonb_build_object('id', r.id, 'reason', 'already_archived');
    else
      v_archive := v_archive || r.id;
      v_calls := v_calls || jsonb_build_object('id', r.id, 'prev', r.lead_status);
    end if;
  end loop;

  -- Ids not found for this tenant (other tenant or missing): skipped.
  select v_skipped || coalesce(array_agg(x order by x), '{}'),
         v_skipped_detail || coalesce(
           jsonb_agg(jsonb_build_object('id', x, 'reason', 'not_found') order by x),
           '[]'::jsonb)
    into v_skipped, v_skipped_detail
  from unnest(v_ids) as x
  where not (x = any (v_archive)) and not (x = any (v_skipped));

  if cardinality(v_archive) = 0 then
    return jsonb_build_object(
      'undo_id', null, 'calls', '[]'::jsonb, 'holds', '[]'::jsonb,
      'visits', '[]'::jsonb, 'skipped', to_jsonb(v_skipped),
      'skipped_detail', v_skipped_detail);
  end if;

  update public.calls
     set lead_status = 'archived'
   where id = any (v_archive)
     and tenant_id = p_tenant_id;

  with u as (
    update public.service_requests s
       set inbox_archived_at = now()
     where s.tenant_id = p_tenant_id
       and s.call_id = any (v_archive)
       and s.status = 'open'
       and s.inbox_archived_at is null
    returning s.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_holds from u;

  with u as (
    update public.appointments a
       set inbox_archived_at = now()
     where a.tenant_id = p_tenant_id
       and a.call_id = any (v_archive)
       and a.status in ('requested', 'confirmed')
       and a.inbox_archived_at is null
    returning a.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_visits from u;

  insert into public.inbox_archive_undo (tenant_id, created_by, payload)
  values (
    p_tenant_id,
    auth.uid(),
    jsonb_build_object('calls', v_calls, 'holds', to_jsonb(v_holds), 'visits', to_jsonb(v_visits))
  )
  returning id into v_undo;

  return jsonb_build_object(
    'undo_id', v_undo,
    'calls', v_calls,
    'holds', to_jsonb(v_holds),
    'visits', to_jsonb(v_visits),
    'skipped', to_jsonb(v_skipped),
    'skipped_detail', v_skipped_detail);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Undo
-- ---------------------------------------------------------------------------
create or replace function public.inbox_undo_archive(p_tenant_id uuid, p_undo_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  u public.inbox_archive_undo%rowtype;
  v_call_ids uuid[];
  v_hold_ids uuid[];
  v_visit_ids uuid[];
  v_calls uuid[] := '{}';
  v_holds uuid[] := '{}';
  v_visits uuid[] := '{}';
  v_changed uuid[] := '{}';
begin
  perform public._inbox_archive_assert_writer(p_tenant_id);

  if p_undo_id is null then
    raise exception 'undo id required' using errcode = '22023';
  end if;

  select * into u
  from public.inbox_archive_undo
  where id = p_undo_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'undo not found' using errcode = 'P0002';
  end if;

  if u.consumed_at is not null then
    return jsonb_build_object(
      'restored', jsonb_build_object('calls', '[]'::jsonb, 'holds', '[]'::jsonb, 'visits', '[]'::jsonb),
      'changed_since', '[]'::jsonb,
      'already_undone', true);
  end if;

  select coalesce(array_agg((e->>'id')::uuid order by (e->>'id')::uuid), '{}')
    into v_call_ids
  from jsonb_array_elements(coalesce(u.payload->'calls', '[]'::jsonb)) as e;
  select coalesce(array_agg(x::uuid order by x::uuid), '{}')
    into v_hold_ids
  from jsonb_array_elements_text(coalesce(u.payload->'holds', '[]'::jsonb)) as x;
  select coalesce(array_agg(x::uuid order by x::uuid), '{}')
    into v_visit_ids
  from jsonb_array_elements_text(coalesce(u.payload->'visits', '[]'::jsonb)) as x;

  perform 1
  from public.calls c
  where c.id = any (v_call_ids)
    and c.tenant_id = p_tenant_id
  order by c.id
  for update;

  -- Restore prev only where the call is still archived.
  with prev as (
    select (e->>'id')::uuid as id, e->>'prev' as prev
    from jsonb_array_elements(coalesce(u.payload->'calls', '[]'::jsonb)) as e
  ), upd as (
    update public.calls c
       set lead_status = prev.prev
      from prev
     where c.id = prev.id
       and c.tenant_id = p_tenant_id
       and c.lead_status = 'archived'
    returning c.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_calls from upd;

  with upd as (
    update public.service_requests s
       set inbox_archived_at = null
     where s.id = any (v_hold_ids)
       and s.tenant_id = p_tenant_id
       and s.inbox_archived_at is not null
    returning s.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_holds from upd;

  with upd as (
    update public.appointments a
       set inbox_archived_at = null
     where a.id = any (v_visit_ids)
       and a.tenant_id = p_tenant_id
       and a.inbox_archived_at is not null
    returning a.id
  )
  select coalesce(array_agg(id order by id), '{}') into v_visits from upd;

  select coalesce(array_agg(x order by x), '{}') into v_changed
  from (
    select unnest(v_call_ids) as x
    except select unnest(v_calls)
    union all
    (select unnest(v_hold_ids) except select unnest(v_holds))
    union all
    (select unnest(v_visit_ids) except select unnest(v_visits))
  ) d;

  update public.inbox_archive_undo
     set consumed_at = now()
   where id = u.id;

  return jsonb_build_object(
    'restored', jsonb_build_object(
      'calls', to_jsonb(v_calls),
      'holds', to_jsonb(v_holds),
      'visits', to_jsonb(v_visits)),
    'changed_since', to_jsonb(v_changed),
    'already_undone', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
revoke all on function public.inbox_archive_calls(uuid, uuid[]) from public, anon;
revoke all on function public.inbox_undo_archive(uuid, uuid) from public, anon;
grant execute on function public.inbox_archive_calls(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.inbox_undo_archive(uuid, uuid) to authenticated, service_role;
