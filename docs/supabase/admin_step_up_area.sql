-- Admin Unlock areas (Settings › Security "What needs Unlock"). Alvin, 24 Oct 2026.
-- One row per area; required=false turns Unlock off for that area's switchable actions.
-- A missing row (or a read error) means ON. Always-on actions ignore this table.
-- Idempotent. service_role only; RLS on with no policies. STAGING first; prod only on Alvin's GO.
-- Down: admin_step_up_area_down.sql
create table if not exists public.admin_step_up_area (
  area text primary key check (area in ('numbers', 'billing', 'businesses', 'voices', 'operators')),
  required boolean not null default true,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.admin_step_up_area enable row level security;
revoke all on public.admin_step_up_area from anon, authenticated;
