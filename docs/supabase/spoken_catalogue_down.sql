-- Rollback for S6 then S5 (prod). Drops data in tenants.spoken_catalogue/live_version and all version rows.
drop function if exists public.save_spoken_catalogue_version(uuid, integer, integer, text, text, text, jsonb, jsonb, text);
drop table if exists public.tenant_spoken_catalogue_versions;
alter table public.tenants drop column if exists live_version;
alter table public.tenants drop column if exists spoken_catalogue;
