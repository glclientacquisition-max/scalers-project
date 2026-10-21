-- Greeting module (plan B3): owner's verbatim greeting, the shop's greeting
-- language, and each caller's last spoken language.
-- Run after greeting_spoken_name.sql and contacts_and_requests.sql.
-- Additive. Empty values keep today's greeting. Not applied by deploy.
-- ASCII-only (safe for Supabase SQL Editor). Idempotent: safe to re-run.
-- Do not apply to production from the app. Production needs Alvin's GO.

alter table public.tenants add column if not exists greeting_text text;
alter table public.tenants add column if not exists greeting_language text;

alter table public.tenants drop constraint if exists tenants_greeting_text_len;
alter table public.tenants add constraint tenants_greeting_text_len
  check (greeting_text is null or char_length(greeting_text) <= 240);

alter table public.tenants drop constraint if exists tenants_greeting_language_check;
alter table public.tenants add constraint tenants_greeting_language_check
  check (greeting_language is null or greeting_language in ('en', 'sw'));

comment on column public.tenants.greeting_text is
  'Owner full greeting, spoken verbatim. Empty uses the template: Shop, this is Agent. Invite.';
comment on column public.tenants.greeting_language is
  'Language of the greeting and the bare-hello/silence lines (en or sw). Empty: derive from greeting_text, else en.';

-- Owners edit both from Desk (column-scoped, like spoken_name).
grant update (greeting_text, greeting_language) on public.tenants to authenticated;

alter table public.contacts add column if not exists last_language text;
alter table public.contacts add column if not exists last_language_at timestamptz;

alter table public.contacts drop constraint if exists contacts_last_language_check;
alter table public.contacts add constraint contacts_last_language_check
  check (last_language is null or last_language in ('en', 'sw'));

comment on column public.contacts.last_language is
  'Language the caller settled on in their last call (en or sw). Voice writes it at finalize; service_role only.';
comment on column public.contacts.last_language_at is
  'When last_language was last written. Lets the greeting ignore a stale language.';
-- No grant to authenticated: owners can read it (contacts_select_member) but not edit it.
