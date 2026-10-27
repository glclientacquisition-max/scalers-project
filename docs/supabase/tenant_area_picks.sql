-- Owner service-area picks on the versioned Kenya area tree (Desk › Settings › Service areas).
-- Contract: docs/reference/platform/AREA_PICKS.md. Brain #960 reads these columns (one row per pick).
-- node: tree id (county:, town:, estate:, or ke). serve: include (true) or exclude (false).
-- fee_kes, note: optional on serving picks. confirmed_at: owner tapped "Looks right" (null = unconfirmed).
-- moved_from: legacy Locations / coverage ids (audit); duplicated on each pick row for that tenant when set.
-- ADDITIVE. Safe to re-run. Service-role only (Desk server actions); no client access.
-- Rollback: docs/supabase/tenant_area_picks_down.sql

create table if not exists public.tenant_area_picks (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  node text not null,
  serve boolean not null default true,
  fee_kes integer,
  note text,
  confirmed_at timestamptz,
  tree_version text not null,
  moved_from jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, node),
  constraint tenant_area_picks_fee_range check (fee_kes is null or (fee_kes > 0 and fee_kes <= 100000)),
  constraint tenant_area_picks_note_len check (note is null or char_length(note) <= 200)
);

comment on table public.tenant_area_picks is
  'Owner include/exclude picks on the Kenya area tree. Nearest pick wins. One row per node per tenant.';

alter table public.tenant_area_picks enable row level security;
revoke all on public.tenant_area_picks from anon, authenticated;
