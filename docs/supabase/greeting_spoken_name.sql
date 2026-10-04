-- Spoken shop name and short greeting invite.
-- Run after soniox_voice_id.sql.
--
-- tenants.spoken_name: what callers hear. Empty keeps business_name.
-- tenants.greeting_invite: the line after the shop and agent name.
-- Empty keeps "How can I help?".
-- ASCII-only (safe for Supabase SQL Editor).
-- Do not apply to production from the app. Apply in the SQL editor when ready.

alter table public.tenants
  add column if not exists spoken_name text;

alter table public.tenants
  add column if not exists greeting_invite text;

comment on column public.tenants.spoken_name is
  'Short shop name spoken on the greeting. Empty uses business_name.';

comment on column public.tenants.greeting_invite is
  'Short line after the shop and agent name. Empty uses How can I help?';

alter table public.tenants
  drop constraint if exists tenants_spoken_name_len;

alter table public.tenants
  add constraint tenants_spoken_name_len
  check (spoken_name is null or char_length(spoken_name) <= 40);

alter table public.tenants
  drop constraint if exists tenants_greeting_invite_len;

alter table public.tenants
  add constraint tenants_greeting_invite_len
  check (greeting_invite is null or char_length(greeting_invite) <= 80);

grant update (spoken_name, greeting_invite) on public.tenants to authenticated;
