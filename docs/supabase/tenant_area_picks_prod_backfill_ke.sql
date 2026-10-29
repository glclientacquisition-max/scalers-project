-- APPLIED on prod 27 Oct 2026 17:39:00 EAT, version 20261027143900 (tenant_area_picks_prod_backfill_ke): 3 rows (ALFAAL, Esga, Grow Tech).
-- Rollback (scoped): delete from public.tenant_area_picks where tenant_id in ('61dbbf92-32e8-47b1-a5c6-af6212c9761a','c81b3480-0cc5-4224-b0e7-24c641d78db2','24ca3d5e-db5c-4cc3-b745-a87a68cf3ce0') and node='ke' and confirmed_at is null and updated_by is null and updated_at between '2026-10-27 17:39:00+03' and '2026-10-27 17:39:01+03';
-- PROD-ONLY alternative to tenant_area_picks_backfill.sql + scripts/backfill-tenant-area-picks.mjs --apply.
-- Writes exactly what the TS mapper (dashboard/src/lib/areaPicksMigrate.ts @ b235fa9a) produces for prod's
-- 27 Oct data: one unconfirmed 'ke' pick per tenant whose legacy coverage is "anywhere in Kenya"
-- (named areas collapse under ke via simplifyAreaPicks). Aborts if any tenant needs real tree mapping.
-- One transaction. Idempotent (skips tenants that already have rows). Writes only public.tenant_area_picks.
do $guard$
declare n int;
begin
  if to_regclass('public.tenant_area_picks') is null then
    raise exception 'tenant_area_picks missing: apply tenant_area_picks.sql first';
  end if;
  -- named areas without anywhere_kenya -> needs the TS mapper (tree ids), not this file
  select count(*) into n from public.tenants t
  where ((jsonb_typeof(t.business_policies->'coverage_areas')='array' and jsonb_array_length(t.business_policies->'coverage_areas')>0)
      or (jsonb_typeof(t.service_areas->'areas')='array' and jsonb_array_length(t.service_areas->'areas')>0))
    and not (coalesce(t.business_policies->'coverage_outside'->>'anywhere_kenya','false')='true'
          or coalesce(t.service_areas->>'anywhere_kenya','false')='true');
  if n > 0 then raise exception '% tenant(s) have named areas without anywhere_kenya: run the TS script instead', n; end if;
  -- exclusions, fees or notes on legacy areas, or an outside fee -> TS script
  select count(*) into n from public.tenants t
  cross join lateral jsonb_array_elements(case when jsonb_typeof(t.service_areas->'areas')='array' then t.service_areas->'areas' else '[]'::jsonb end) a
  where (a->>'serve')='false' or nullif(a->>'fee_ksh','') is not null or nullif(a->>'fee_kes','') is not null or nullif(a->>'note','') is not null;
  if n > 0 then raise exception '% legacy area(s) carry serve=false/fee/note: run the TS script instead', n; end if;
  select count(*) into n from public.tenants t
  where nullif(t.business_policies->'coverage_outside'->>'fee_ksh','') is not null or nullif(t.service_areas->>'outside_fee_ksh','') is not null;
  if n > 0 then raise exception '% tenant(s) have an outside fee: run the TS script instead', n; end if;
end
$guard$;

with legacy as (
  select t.id as tenant_id,
    coalesce((select jsonb_agg(distinct x) from (
      select a->>'id' as x from jsonb_array_elements(case when jsonb_typeof(t.service_areas->'areas')='array' then t.service_areas->'areas' else '[]'::jsonb end) a where (a->>'id') is not null
      union all
      select jsonb_array_elements_text(case when jsonb_typeof(t.business_policies->'coverage_areas')='array' then t.business_policies->'coverage_areas' else '[]'::jsonb end)
    ) u), '[]'::jsonb) as moved_from,
    (coalesce(t.business_policies->'coverage_outside'->>'anywhere_kenya','false')='true'
      or coalesce(t.service_areas->>'anywhere_kenya','false')='true') as anywhere
  from public.tenants t
)
insert into public.tenant_area_picks (tenant_id, node, serve, fee_kes, note, confirmed_at, tree_version, moved_from, updated_at)
select l.tenant_id, 'ke', true, null, null, null, 'ke-areas-2026-10-24.1',
       case when jsonb_array_length(l.moved_from) > 0 then l.moved_from else null end, now()
from legacy l
where l.anywhere
  and not exists (select 1 from public.tenant_area_picks p where p.tenant_id = l.tenant_id)
on conflict (tenant_id, node) do nothing;
