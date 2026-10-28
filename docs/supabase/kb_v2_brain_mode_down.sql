-- Rollback for kb_v2_brain_mode.sql (2026-10-28.4). Removes the safe-mode RPC, its audit table and the brain_mode
-- columns. Every business returns to the full KB brain (BRAIN_SAFE_MODE=all still works on code that reads it).
-- Safe on code that reads brain_mode: db.selectKbTenantFacts and Desk loadKbLive fall back when the column is absent.
drop function if exists public.set_brain_mode(uuid, text, uuid);
drop table if exists public.tenant_brain_mode_audit;
alter table public.tenants drop constraint if exists tenants_brain_mode_source;
alter table public.tenants drop constraint if exists tenants_brain_mode;
alter table public.tenants drop column if exists brain_mode_source;
alter table public.tenants drop column if exists brain_mode_set_at;
alter table public.tenants drop column if exists brain_mode_set_by;
alter table public.tenants drop column if exists brain_mode;
