-- DRAFT for Platform review. NOT in supabase/migrations/ and NOT applied anywhere.
-- Speech-ready knowledge base ("spoken catalogue"), one current doc per tenant
-- plus an append-only version history for owner review (draft -> approved).
-- ADDITIVE: new nullable column + new table; no existing data changes. Safe to re-run.

set lock_timeout = '3s';
alter table public.tenants add column if not exists spoken_catalogue jsonb;

create table if not exists public.tenant_spoken_catalogue_versions (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  version      integer not null check (version >= 0),
  schema_version integer not null default 1,
  source_hash  text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  status       text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  generator    text not null check (generator in ('rules', 'ai+rules', 'owner')),
  doc          jsonb not null check (jsonb_typeof(doc) = 'object'),
  issues       jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  approved_at  timestamptz,
  approved_by  uuid references auth.users(id) on delete set null,
  unique (tenant_id, version)
);
-- (tenant_id, version) lookups use the unique constraint's index; no extra index.
create index if not exists tenant_spoken_catalogue_versions_approved_by_idx
  on public.tenant_spoken_catalogue_versions (approved_by) where approved_by is not null;

alter table public.tenant_spoken_catalogue_versions enable row level security;
revoke all on table public.tenant_spoken_catalogue_versions from public, anon, authenticated;
grant select on table public.tenant_spoken_catalogue_versions to authenticated;
grant all on table public.tenant_spoken_catalogue_versions to service_role;
-- Members read their own tenant's versions (Desk review UI). Writes: service role
-- (compile/backfill) only for now; owner edit/approve goes through a server route later.
drop policy if exists spoken_catalogue_versions_select_member on public.tenant_spoken_catalogue_versions;
create policy spoken_catalogue_versions_select_member on public.tenant_spoken_catalogue_versions
  for select to authenticated using (tenant_id in (select public.current_user_tenant_ids()));
