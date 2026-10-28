-- NOT APPLIED. Phase 8 of the v2 Knowledge Base: drop the legacy knowledge copies.
-- Apply only after: the old brain is retired on prod (BRAIN_KB_GATE=on for every business for 14 days,
-- BRAIN_KB_LEGACY_ROUTE unset), every Desk writer uses kb_items, and Alvin says yes in chat.
-- Not reversible without a backup: take `pg_dump -t public.tenants` first.
-- Version 2026-10-28.1.
begin;
-- services_offered: free-text copy of the services list (replaced by kb_items).
alter table public.tenants drop column if exists services_offered;
-- spoken_catalogue (+ versions): replaced by kb_snapshots.
alter table public.tenants drop column if exists spoken_catalogue;
drop table if exists public.tenant_spoken_catalogue_versions;
-- services_catalog / product_catalog: replaced by kb_items + kb_item_variants.
alter table public.tenants drop column if exists services_catalog;
alter table public.tenants drop column if exists product_catalog;
-- Area mirrors: business_policies.coverage_areas / coverage_outside (tenant_area_picks is the only source).
update public.tenants set business_policies = business_policies - 'coverage_areas' - 'coverage_outside'
  where business_policies ? 'coverage_areas' or business_policies ? 'coverage_outside';
commit;
