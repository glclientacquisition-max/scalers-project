-- Owner inbox triage fields on calls (read, mute, pin, assignee, labels, snooze).
-- Run after: call_resolution.sql
--
-- Owners triage the inbox via JWT + RLS. Voice (service_role) does not write these.
-- New calls are unread (inbox_read_at null). Existing rows are stamped read at apply.
-- Mute is per-ticket, not per-contact. Assignee is a team_directory label, not a login.
-- Archive remains lead_status = archived. No owner DELETE on calls.
-- ASCII-only (safe for Supabase SQL Editor).

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.calls
  add column if not exists inbox_read_at timestamptz default timezone('utc'::text, now());

alter table public.calls
  alter column inbox_read_at drop default;

alter table public.calls
  add column if not exists inbox_muted boolean not null default false;

alter table public.calls
  add column if not exists inbox_pinned_at timestamptz;

alter table public.calls
  add column if not exists inbox_assignee text;

alter table public.calls
  add column if not exists inbox_labels text[] not null default '{}'::text[];

alter table public.calls
  add column if not exists inbox_snoozed_until timestamptz;

comment on column public.calls.inbox_read_at is
  'Owner inbox read stamp. Null = unread. Distinct from needsYou / lead_status.';

comment on column public.calls.inbox_muted is
  'Per-ticket mute. Survives refresh. Not a contact-level mute.';

comment on column public.calls.inbox_pinned_at is
  'When set, the ticket stays at the top of the current inbox pile.';

comment on column public.calls.inbox_assignee is
  'team_directory teammate label assigned to this ticket. Not tenant_members.user_id.';

comment on column public.calls.inbox_labels is
  'Free-text labels on this ticket.';

comment on column public.calls.inbox_snoozed_until is
  'Hide from the active inbox until this time. Then the row returns to its pile.';

create index if not exists calls_tenant_inbox_pin_created_idx
  on public.calls (tenant_id, inbox_pinned_at desc nulls last, created_at desc);

create index if not exists calls_tenant_inbox_snooze_idx
  on public.calls (tenant_id, inbox_snoozed_until)
  where inbox_snoozed_until is not null;

-- ---------------------------------------------------------------------------
-- RLS: keep member UPDATE; expand column grant with prior CRM columns.
-- ---------------------------------------------------------------------------
revoke update on public.calls from authenticated;
grant update (
  lead_status,
  resolution,
  primary_intent,
  resolution_note,
  inbox_read_at,
  inbox_muted,
  inbox_pinned_at,
  inbox_assignee,
  inbox_labels,
  inbox_snoozed_until
) on public.calls to authenticated;
