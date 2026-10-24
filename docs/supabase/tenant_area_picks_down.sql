-- Rollback tenant_area_picks. Desk falls back to "Could not load areas" on the Service areas page; nothing else reads it yet.
drop table if exists public.tenant_area_picks;
