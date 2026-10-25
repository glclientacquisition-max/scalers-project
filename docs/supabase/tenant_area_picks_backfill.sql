-- Backfill tenant_area_picks from legacy coverage (unconfirmed).
-- Copies business_policies.coverage_areas, tenants.service_areas area ids, and
-- coverage_outside / anywhere_kenya into one row per tenant. Leaves confirmed_at null.
-- Old columns stay readable; nothing is dropped.
--
-- Pick JSON is built with the same rules as dashboard/src/lib/areaPicksMigrate.ts
-- (run node scripts/backfill-tenant-area-picks.mjs --apply on staging after this SQL
-- if you need fee/note merge from service_areas.areas[]).
--
-- ADDITIVE. Idempotent. Service role only.
-- Rollback: docs/supabase/tenant_area_picks_backfill_down.sql

insert into public.tenant_area_picks (tenant_id, tree_version, picks, moved_from, confirmed_at, updated_at)
select
  t.id,
  coalesce(
    (select tree_version from public.tenant_area_picks tap where tap.tenant_id = t.id limit 1),
    'ke-areas-2026-10-24.1'
  ),
  coalesce(
    (select picks from public.tenant_area_picks tap where tap.tenant_id = t.id),
    jsonb_build_object('version', 1, 'tree_version', 'ke-areas-2026-10-24.1', 'picks', '[]'::jsonb)
  ),
  src.moved_from,
  null,
  now()
from public.tenants t
cross join lateral (
  select coalesce(
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
  ) as moved_from
) src
where (
  jsonb_array_length(src.moved_from) > 0
  or coalesce(t.business_policies -> 'coverage_outside' ->> 'anywhere_kenya', 'false') = 'true'
  or coalesce(t.service_areas ->> 'anywhere_kenya', 'false') = 'true'
)
and not exists (select 1 from public.tenant_area_picks existing where existing.tenant_id = t.id);
