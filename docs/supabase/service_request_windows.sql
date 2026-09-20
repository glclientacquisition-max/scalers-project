-- service_request_windows.sql
-- Purpose: Desk When+Save stamps when_text with window_start/window_end on holds.
-- Run after: contacts_and_requests.sql
-- Additive. Safe to re-run. Voice still writes via service_role.
-- ASCII-only (safe for Supabase SQL Editor).

alter table public.service_requests
  add column if not exists window_start timestamptz;

alter table public.service_requests
  add column if not exists window_end timestamptz;

comment on column public.service_requests.window_start is
  'Parsed When instant for Today/Week. Written with when_text on desk Save.';

comment on column public.service_requests.window_end is
  'Parsed When end instant. Written with when_text on desk Save.';

revoke update on public.service_requests from authenticated;
grant update (
  status,
  notes,
  when_text,
  window_start,
  window_end,
  updated_at
) on public.service_requests to authenticated;
