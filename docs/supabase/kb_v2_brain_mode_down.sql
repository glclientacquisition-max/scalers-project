-- Rollback for kb_v2_brain_mode.sql (2026-10-28.4). Code reads brain_mode with a fallback (no column = full).
alter table public.tenants drop constraint if exists tenants_brain_mode;
alter table public.tenants drop column if exists brain_mode;
