-- Inbox unarchive: move archived calls back into the Desk inbox, and show
-- their holds and visits again. This is the "later" path, for when the
-- one-shot Undo from inbox_archive_calls is gone or already used.
-- Run after inbox_archive_cascade.sql (it reuses _inbox_archive_assert_writer
-- and the inbox_archived_at columns).
--
-- What it reverses: inbox_archive_calls sets calls.lead_status = 'archived'
-- and stamps inbox_archived_at = now() on that call's open holds
-- (service_requests) and live visits (appointments). This function sets
-- lead_status back to 'new' and clears inbox_archived_at on every hold and
-- visit of that call that carries a stamp (any status). Statuses of holds and
-- visits are not touched, the same as archive.
--
-- Why 'new' and not the previous status: the previous status lives only in
-- the inbox_archive_undo payload, which may be consumed or old. Use
-- inbox_undo_archive for an exact restore right after archiving; use this
-- for "move back to inbox" at any later time. Pending undo rows are left
-- alone: a later inbox_undo_archive only touches calls still archived, so it
-- is a no-op for calls unarchived here.
--
-- Adds:
--   inbox_unarchive_calls(p_tenant_id uuid, p_call_ids uuid[]) returns jsonb
--     {
--       "unarchived": int,          -- calls moved archived -> new
--       "holds": int,               -- service_requests stamps cleared
--       "visits": int,              -- appointments stamps cleared
--       "skipped": int,
--       "call_ids": [uuid],         -- the unarchived calls
--       "skipped_detail": [{"id": uuid, "reason": "not_archived" | "not_found"}]
--     }
--   not_found = no such call in p_tenant_id (missing, or another tenant's).
--
-- Access: a signed-in member with write access (member_can_write: owner,
-- admin, staff) of p_tenant_id, or service_role. Viewers, non-members and
-- anon get 42501 'not allowed'. Null tenant or more than 200 ids gets 22023.
-- Idempotent: a second run skips every call as not_archived.
--
-- ADDITIVE. ASCII-only. Safe to re-run.
--
-- Rollback:
--   drop function if exists public.inbox_unarchive_calls(uuid, uuid[]);

create or replace function public.inbox_unarchive_calls(p_tenant_id uuid, p_call_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_unarchive uuid[] := '{}';
  v_skipped_detail jsonb := '[]'::jsonb;
  v_holds int := 0;
  v_visits int := 0;
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
      'unarchived', 0, 'holds', 0, 'visits', 0, 'skipped', 0,
      'call_ids', '[]'::jsonb, 'skipped_detail', '[]'::jsonb);
  end if;

  -- Lock this tenant's rows only, in a stable order (same as archive).
  for r in
    select c.id, c.lead_status
    from public.calls c
    where c.id = any (v_ids)
      and c.tenant_id = p_tenant_id
    order by c.id
    for update
  loop
    if r.lead_status = 'archived' then
      v_unarchive := v_unarchive || r.id;
    else
      v_skipped_detail := v_skipped_detail
        || jsonb_build_object('id', r.id, 'reason', 'not_archived');
    end if;
  end loop;

  -- Ids not found for this tenant (other tenant or missing).
  select v_skipped_detail || coalesce(
           jsonb_agg(jsonb_build_object('id', x, 'reason', 'not_found') order by x),
           '[]'::jsonb)
    into v_skipped_detail
  from unnest(v_ids) as x
  where not exists (
    select 1 from public.calls c where c.id = x and c.tenant_id = p_tenant_id
  );

  if cardinality(v_unarchive) > 0 then
    update public.calls
       set lead_status = 'new'
     where id = any (v_unarchive)
       and tenant_id = p_tenant_id
       and lead_status = 'archived';

    with u as (
      update public.service_requests s
         set inbox_archived_at = null
       where s.tenant_id = p_tenant_id
         and s.call_id = any (v_unarchive)
         and s.inbox_archived_at is not null
      returning 1
    )
    select count(*)::int into v_holds from u;

    with u as (
      update public.appointments a
         set inbox_archived_at = null
       where a.tenant_id = p_tenant_id
         and a.call_id = any (v_unarchive)
         and a.inbox_archived_at is not null
      returning 1
    )
    select count(*)::int into v_visits from u;
  end if;

  return jsonb_build_object(
    'unarchived', cardinality(v_unarchive),
    'holds', v_holds,
    'visits', v_visits,
    'skipped', jsonb_array_length(v_skipped_detail),
    'call_ids', (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from unnest(v_unarchive) as x),
    'skipped_detail', v_skipped_detail);
end;
$$;

revoke all on function public.inbox_unarchive_calls(uuid, uuid[]) from public, anon;
grant execute on function public.inbox_unarchive_calls(uuid, uuid[]) to authenticated, service_role;
