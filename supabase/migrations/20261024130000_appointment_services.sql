-- NOT APPLIED (Brain #928, Alvin t320u). Requires Alvin GO before any apply.
-- One booking holds N services (line items). The code works WITHOUT this table:
-- appointments.metadata.services (jsonb) is the source of truth today, and
-- db.mirrorAppointmentServices ignores a missing table. This table makes items
-- queryable for Desk/billing later.
create table if not exists public.appointment_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  service_name text not null,
  position int not null default 0,
  status text not null default 'active' check (status in ('active','removed')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (appointment_id, idempotency_key)
);
create index if not exists appointment_services_tenant_appt_idx
  on public.appointment_services (tenant_id, appointment_id);
alter table public.appointment_services enable row level security;
-- Service role (server) bypasses RLS; no anon/authenticated policies until Desk reads it.
revoke all on public.appointment_services from anon, authenticated;
