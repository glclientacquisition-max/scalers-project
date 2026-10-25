-- Owner service-area picks on the versioned Kenya area tree (Desk › Settings › Service areas).
-- Contract: docs/reference/platform/AREA_PICKS.md. Read by Desk and by Brain's KB coverage check.
-- picks shape: { "version": 1, "tree_version": "ke-areas-YYYY-MM-DD.N",
--                "picks": [ { "node": "county:nairobi", "serve": true, "fee_kes": null, "note": null }, ... ] }
-- moved_from: the old free-text / Locations list this row was moved over from (audit only).
-- confirmed_at: set when the owner taps "Looks right" on Check your areas (null = not yet checked).
-- ADDITIVE. Safe to re-run. Service-role only (Desk server actions); no client access.
-- Rollback: docs/supabase/tenant_area_picks_down.sql

create table if not exists public.tenant_area_picks (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  tree_version text not null,
  picks jsonb not null default '{"version":1,"picks":[]}'::jsonb,
  moved_from jsonb,
  confirmed_at timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint tenant_area_picks_shape check (jsonb_typeof(picks -> 'picks') = 'array')
);

comment on table public.tenant_area_picks is
  'Owner include/exclude picks on the Kenya area tree, with per-node fee_kes and caller note. Nearest pick wins.';

alter table public.tenant_area_picks enable row level security;
revoke all on public.tenant_area_picks from anon, authenticated;
