-- Rollback for kb_v2.sql (2026-10-28.1). Drops the v2 Knowledge Base objects. Legacy columns
-- (services_catalog, product_catalog, spoken_catalogue) are untouched, so the old brain keeps working.
-- Set BRAIN_KB_GATE=off first so no call reads these tables.
drop function if exists public.kb_record_readiness(uuid, integer, boolean, jsonb, jsonb, text, text);
drop function if exists public.kb_search_items(uuid, text, integer);
drop function if exists public.kb_publish_snapshot(uuid, jsonb, text, jsonb, text, text);
drop function if exists public.kb_upsert_items(uuid, jsonb, jsonb, boolean, text);
drop table if exists public.kb_readiness;
drop table if exists public.kb_snapshots;
drop table if exists public.kb_item_variants;
drop table if exists public.kb_items;
drop function if exists public.kb_items_search_fill();
drop table if exists public.kb_categories;
alter table public.tenants drop constraint if exists tenants_brain_target;
alter table public.tenants drop column if exists brain_target;
alter table public.tenants drop column if exists kb_ready_version;
alter table public.tenants drop column if exists kb_live_version;
-- pg_trgm / btree_gin stay installed (harmless, may be used elsewhere).
