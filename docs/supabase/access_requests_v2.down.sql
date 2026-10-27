-- Roll back access_requests v2 columns. ASCII-only.

alter table public.access_requests
  drop column if exists reopened_at,
  drop column if exists invite_resent_at,
  drop column if exists decline_emailed_at,
  drop column if exists decline_reason,
  drop column if exists note_updated_by,
  drop column if exists note_updated_at,
  drop column if exists note;
