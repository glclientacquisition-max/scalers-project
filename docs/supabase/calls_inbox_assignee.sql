-- Inbox assignee contact snapshot on calls (name + phone of the teammate a ticket is assigned to).
-- Run after: inbox_triage.sql (adds calls.inbox_assignee).
--
-- Written from scalers-staging as it stands on 2026-10-09. These two columns exist on
-- staging, with no SQL file behind them until now. Types read from information_schema:
--   inbox_assignee_name   text, nullable, no default
--   inbox_assignee_phone  text, nullable, no default
-- No constraints or indexes on staging. No column UPDATE grant to authenticated on staging
-- (inbox_triage.sql's owner grant list does not include them), so none is added here.
--
-- Additive and idempotent. Safe to re-run. Does not backfill.
-- ASCII-only (safe for Supabase SQL Editor).

alter table public.calls
  add column if not exists inbox_assignee_name text;

alter table public.calls
  add column if not exists inbox_assignee_phone text;

comment on column public.calls.inbox_assignee_name is
  'Display name of the teammate this ticket is assigned to. Snapshot; null when unassigned.';

comment on column public.calls.inbox_assignee_phone is
  'Phone of the teammate this ticket is assigned to. Snapshot; null when unassigned.';
