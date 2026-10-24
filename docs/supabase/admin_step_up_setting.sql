-- Admin Unlock length (Settings › Security "Unlock lasts"). Alvin, 24 Oct 2026.
-- One row (id = true). unlock_minutes is 5–30; the app offers 5, 10, 15, 30 and clamps too.
-- A missing row (or a read error) means the 10-minute default. A change applies to the next Unlock.
-- Idempotent. service_role only; RLS on with no policies. STAGING first; prod only on Alvin's GO.
-- Down: admin_step_up_setting_down.sql
create table if not exists public.admin_step_up_setting (
  id boolean primary key default true check (id),
  unlock_minutes integer not null default 10 check (unlock_minutes between 5 and 30),
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.admin_step_up_setting enable row level security;
revoke all on public.admin_step_up_setting from anon, authenticated;
