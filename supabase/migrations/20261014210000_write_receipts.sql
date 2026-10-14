-- Write receipts: one idempotency key per logical write on a call.
-- Ship-only file. NOT applied anywhere by this PR; apply on staging first
-- (Platform, with a go), then prod only with Alvin's explicit yes.
--
-- Why a full unique (tenant_id, idempotency_key) and not WHERE-partial:
-- PostgREST/supabase-js upsert(onConflict) cannot target a partial index
-- predicate. NULLs are distinct in Postgres, so legacy rows (key NULL) never
-- collide: this behaves as "unique where idempotency_key is not null".
-- The extra partial index below enforces one OPEN callback per call+item.

alter table public.service_requests add column if not exists idempotency_key text;
alter table public.appointments    add column if not exists idempotency_key text;

-- Pre-check (run before the constraints; must return 0 rows):
--   select tenant_id, idempotency_key, count(*) from public.service_requests
--    where idempotency_key is not null group by 1,2 having count(*) > 1;
--   select tenant_id, call_id, lower(item), count(*) from public.service_requests
--    where request_type = 'callback' and status = 'open' and call_id is not null
--    group by 1,2,3 having count(*) > 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_requests_tenant_idem_key') then
    alter table public.service_requests
      add constraint service_requests_tenant_idem_key unique (tenant_id, idempotency_key);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'appointments_tenant_idem_key') then
    alter table public.appointments
      add constraint appointments_tenant_idem_key unique (tenant_id, idempotency_key);
  end if;
end $$;

create unique index if not exists service_requests_one_open_callback_per_call_item
  on public.service_requests (tenant_id, call_id, lower(coalesce(item, '')))
  where request_type = 'callback' and status = 'open' and call_id is not null;

create unique index if not exists appointments_one_open_per_call_service
  on public.appointments (tenant_id, call_id, lower(service_name))
  where status in ('requested', 'confirmed') and call_id is not null
    and idempotency_key is not null;

-- Rollback:
--   drop index if exists public.appointments_one_open_per_call_service;
--   drop index if exists public.service_requests_one_open_callback_per_call_item;
--   alter table public.appointments drop constraint if exists appointments_tenant_idem_key;
--   alter table public.service_requests drop constraint if exists service_requests_tenant_idem_key;
--   alter table public.appointments drop column if exists idempotency_key;
--   alter table public.service_requests drop column if exists idempotency_key;

-- ---------------------------------------------------------------------------
-- create_appointment_superseding: ONE transaction for Brain's v2 contract.
-- Insert (or return the receipt-keyed existing) appointment, then close the
-- listed escalate tasks (service_requests callbacks from this call) that match
-- tenant_id AND caller phone: status fulfilled (allowed by
-- service_requests_status_check), closed_at, metadata.superseded_by.
-- Service role only (called from the voice server).
create or replace function public.create_appointment_superseding(
  p_row jsonb,
  p_supersedes uuid[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_appt public.appointments;
  v_closed uuid[] := '{}';
begin
  insert into public.appointments (
    tenant_id, contact_id, call_id, service_name, status, when_text,
    window_start, window_end, address_landmark, notes, caller_name,
    caller_phone, idempotency_key, updated_at
  ) values (
    (p_row->>'tenant_id')::uuid, nullif(p_row->>'contact_id','')::uuid,
    nullif(p_row->>'call_id','')::uuid, p_row->>'service_name', 'requested',
    p_row->>'when_text', nullif(p_row->>'window_start','')::timestamptz,
    nullif(p_row->>'window_end','')::timestamptz, p_row->>'address_landmark',
    p_row->>'notes', p_row->>'caller_name', p_row->>'caller_phone',
    nullif(p_row->>'idempotency_key',''), now()
  )
  on conflict (tenant_id, idempotency_key) do nothing
  returning * into v_appt;

  if v_appt.id is null then
    select * into v_appt from public.appointments
     where tenant_id = (p_row->>'tenant_id')::uuid
       and idempotency_key = p_row->>'idempotency_key';
  end if;

  if coalesce(array_length(p_supersedes, 1), 0) > 0 and v_appt.id is not null then
    with closed as (
      update public.service_requests sr
         set status = 'fulfilled',
             closed_at = now(),
             updated_at = now(),
             metadata = coalesce(sr.metadata, '{}'::jsonb)
                        || jsonb_build_object('superseded_by', v_appt.id, 'superseded_kind', 'appointment')
       where sr.id = any(p_supersedes)
         and sr.tenant_id = v_appt.tenant_id
         and sr.caller_phone is not distinct from v_appt.caller_phone
         and sr.status = 'open'
      returning sr.id
    )
    select coalesce(array_agg(id), '{}') into v_closed from closed;
  end if;

  return jsonb_build_object('appointment', to_jsonb(v_appt), 'superseded', to_jsonb(v_closed));
end $$;

revoke all on function public.create_appointment_superseding(jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.create_appointment_superseding(jsonb, uuid[]) to service_role;
-- Rollback: drop function if exists public.create_appointment_superseding(jsonb, uuid[]);
