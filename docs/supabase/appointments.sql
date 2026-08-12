-- appointments.sql
-- Purpose: Home-services visit booking system of record (Phase 2).
-- Run after: contacts_and_requests.sql
-- Voice writes via service_role; owners read/update via RLS.
-- ASCII-only (safe for Supabase SQL Editor).

create table if not exists public.appointments (
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

do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'appointments_status_check'
  ) then
    alter table public.appointments
      add constraint appointments_status_check
      check (status in ('requested', 'confirmed', 'cancelled', 'done'));
  end if;
end
$do$;

create index if not exists appointments_tenant_created_idx
  on public.appointments (tenant_id, created_at desc);

create index if not exists appointments_tenant_status_idx
  on public.appointments (tenant_id, status, created_at desc);

create index if not exists appointments_tenant_phone_idx
  on public.appointments (tenant_id, caller_phone, created_at desc);

comment on table public.appointments is
  'Home-services visit bookings from voice (requested/confirmed/cancelled/done)';

alter table public.appointments enable row level security;

drop policy if exists appointments_select_member on public.appointments;
create policy appointments_select_member
  on public.appointments
  for select
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists appointments_update_member on public.appointments;
create policy appointments_update_member
  on public.appointments
  for update
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

grant select, update on public.appointments to authenticated;

-- Owners may change booking status/notes from the desk (not rewrite caller fields).
revoke update on public.appointments from authenticated;
grant update (
  status,
  notes,
  when_text,
  window_start,
  window_end,
  address_landmark,
  updated_at
) on public.appointments to authenticated;
