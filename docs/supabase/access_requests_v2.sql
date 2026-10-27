-- Access requests v2: ops notes, decline reason, invite resend, reopen.
-- Additive only. Run after access_requests.sql.
-- ASCII-only.

alter table public.access_requests
  add column if not exists note text,
  add column if not exists note_updated_at timestamptz,
  add column if not exists note_updated_by text,
  add column if not exists decline_reason text,
  add column if not exists decline_emailed_at timestamptz,
  add column if not exists invite_resent_at timestamptz,
  add column if not exists reopened_at timestamptz;

comment on column public.access_requests.note is 'Private ops note; service role only';
comment on column public.access_requests.decline_reason is 'Optional reason when declined';
