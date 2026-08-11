-- Thin Scalers CRM: contacts + service_requests (retail holds/enquiries).
-- Run after business_operating_model.sql and owner_rls.sql.
-- Voice writes via service_role; owners read/update via RLS.
-- ASCII-only (safe for Supabase SQL Editor).

-- ---------------------------------------------------------------------------
-- contacts
-- ---------------------------------------------------------------------------
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text,
  name text,
  notes text,
  last_reason text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists contacts_tenant_updated_idx
  on public.contacts (tenant_id, updated_at desc);

create unique index if not exists contacts_tenant_phone_uidx
  on public.contacts (tenant_id, phone)
  where phone is not null and length(trim(phone)) > 0;

comment on table public.contacts is
  'Caller memory per tenant (phone-keyed when available)';

-- ---------------------------------------------------------------------------
-- service_requests
-- ---------------------------------------------------------------------------
create table if not exists public.service_requests (
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

do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'service_requests_type_check'
  ) then
    alter table public.service_requests
      add constraint service_requests_type_check
      check (request_type in ('hold', 'enquiry', 'order', 'callback', 'other'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'service_requests_status_check'
  ) then
    alter table public.service_requests
      add constraint service_requests_status_check
      check (status in ('open', 'fulfilled', 'cancelled'));
  end if;
end
$do$;

create index if not exists service_requests_tenant_created_idx
  on public.service_requests (tenant_id, created_at desc);

create index if not exists service_requests_tenant_status_idx
  on public.service_requests (tenant_id, status, created_at desc);

comment on table public.service_requests is
  'Retail/home work objects: holds, enquiries, order notes from voice';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.contacts enable row level security;
alter table public.service_requests enable row level security;

drop policy if exists contacts_select_member on public.contacts;
create policy contacts_select_member
  on public.contacts
  for select
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists contacts_update_member on public.contacts;
create policy contacts_update_member
  on public.contacts
  for update
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists service_requests_select_member on public.service_requests;
create policy service_requests_select_member
  on public.service_requests
  for select
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists service_requests_update_member on public.service_requests;
create policy service_requests_update_member
  on public.service_requests
  for update
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

grant select, update on public.contacts to authenticated;
grant select, update on public.service_requests to authenticated;

-- Owners may only change request status (and notes) from the desk.
revoke update on public.service_requests from authenticated;
grant update (status, notes, updated_at) on public.service_requests to authenticated;

revoke update on public.contacts from authenticated;
grant update (name, notes, last_reason, updated_at, metadata) on public.contacts to authenticated;
