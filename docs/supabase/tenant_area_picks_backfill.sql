-- Backfill tenant_area_picks from legacy coverage (unconfirmed).
-- One row per legacy area id. anywhere_kenya adds node ke.
-- Fee/note merge: node scripts/backfill-tenant-area-picks.mjs --apply (areaPicksMigrate.ts).
-- ADDITIVE. Idempotent. Service role only.
-- Rollback: docs/supabase/tenant_area_picks_backfill_down.sql

with legacy as (
  select
    t.id as tenant_id,
    coalesce(
      (
        select jsonb_agg(distinct x)
        from (
          select jsonb_array_elements_text(t.business_policies -> 'coverage_areas') as x
          where jsonb_typeof(t.business_policies -> 'coverage_areas') = 'array'
          union all
          select a ->> 'id'
          from jsonb_array_elements(coalesce(t.service_areas -> 'areas', '[]'::jsonb)) a
          where (a ->> 'id') is not null
        ) u
      ),
      '[]'::jsonb
    ) as moved_from,
    coalesce(t.business_policies -> 'coverage_outside' ->> 'anywhere_kenya', 'false') = 'true'
      or coalesce(t.service_areas ->> 'anywhere_kenya', 'false') = 'true' as anywhere
  from public.tenants t
),
nodes as (
  select tenant_id, moved_from, jsonb_array_elements_text(moved_from) as node
  from legacy
  where jsonb_array_length(moved_from) > 0
  union all
  select tenant_id, moved_from, 'ke' as node
  from legacy
  where anywhere
)
insert into public.tenant_area_picks (
  tenant_id, node, serve, fee_kes, note, confirmed_at, tree_version, moved_from, updated_at
)
select
  n.tenant_id,
  n.node,
  true,
  null,
  null,
  null,
  'ke-areas-2026-10-24.1',
  n.moved_from,
  now()
from nodes n
where n.node is not null and length(trim(n.node)) > 0
on conflict (tenant_id, node) do nothing;
