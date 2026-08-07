-- Knowledge Acquisition: Daily Bulletin (temporary high-priority updates).
-- Run after services_catalog.sql / after_hours_mode.sql.
--
-- Shape: JSON array of
--   { id, text, active, starts_at, ends_at, created_at }
-- Voice loads active, in-window items into CONTEXT HEADER on every call.
-- ASCII-only (safe for Supabase SQL Editor).

alter table public.tenants
  add column if not exists daily_bulletin jsonb not null default '[]'::jsonb;

comment on column public.tenants.daily_bulletin is
  'Temporary owner updates [{id,text,active,starts_at,ends_at,created_at}] injected live at call time';
