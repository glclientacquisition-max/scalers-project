-- Greeting module (plan B3): owner's verbatim greeting, the shop's greeting
-- language, each caller's last spoken language, the caller's confirmed name,
-- and the per-call opening resume state (calls row, keyed by
-- sautikit_call_sid, shared by every Voice replica; Voice #843).
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

-- ---------------------------------------------------------------------------
-- Caller name confirmed (Brain v2 save_caller_name after readback_yes).
-- Voice/service writes these. Owners read them; owners have no grant on them.
-- An owner edit of contacts.name resets them (trigger below).

alter table public.contacts add column if not exists name_confirmed boolean not null default false;
alter table public.contacts add column if not exists name_confirmed_at timestamptz;
alter table public.contacts add column if not exists name_confirmed_source text;
alter table public.contacts add column if not exists name_confirmed_call_id uuid;

alter table public.contacts drop constraint if exists contacts_name_confirmed_call_id_fkey;
alter table public.contacts add constraint contacts_name_confirmed_call_id_fkey
  foreign key (name_confirmed_call_id) references public.calls(id) on delete set null;

alter table public.contacts drop constraint if exists contacts_name_confirmed_source_check;
alter table public.contacts add constraint contacts_name_confirmed_source_check
  check (name_confirmed_source is null or name_confirmed_source in ('readback_yes', 'owner_edit'));

alter table public.contacts drop constraint if exists contacts_name_confirmed_consistent;
alter table public.contacts add constraint contacts_name_confirmed_consistent
  check (not name_confirmed or (name_confirmed_at is not null and name_confirmed_source is not null));

comment on column public.contacts.name_confirmed is
  'True when the caller confirmed this name (readback yes). Reset when the name changes without a fresh confirmation.';
comment on column public.contacts.name_confirmed_at is
  'When the name was confirmed. A name change that does not change this column resets the confirmation.';
comment on column public.contacts.name_confirmed_source is
  'readback_yes (caller said yes to the readback) or owner_edit.';
comment on column public.contacts.name_confirmed_call_id is
  'calls.id of the call that confirmed the name.';

-- A name change resets the confirmation unless the same statement brings a
-- fresh one (name_confirmed_at changed). Plain trigger: it only edits NEW,
-- so no security definer is needed.
create or replace function public.contacts_name_confirmed_reset()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.name is distinct from old.name
     and new.name_confirmed_at is not distinct from old.name_confirmed_at then
    new.name_confirmed := false;
    new.name_confirmed_at := null;
    new.name_confirmed_source := null;
    new.name_confirmed_call_id := null;
  end if;
  return new;
end
$fn$;

drop trigger if exists contacts_name_confirmed_reset on public.contacts;
create trigger contacts_name_confirmed_reset
  before update on public.contacts
  for each row
  execute function public.contacts_name_confirmed_reset();

-- ---------------------------------------------------------------------------
-- Opening resume state on calls (Voice #843 createMemoryGreetedMirror ->
-- DB mirror). Service role writes; owners do not get a grant.

alter table public.calls add column if not exists greeted_at timestamptz;
alter table public.calls add column if not exists last_agent_line text;
alter table public.calls add column if not exists notice_given boolean not null default false;
alter table public.calls add column if not exists stream_seq integer not null default 0;
alter table public.calls add column if not exists last_stream_at timestamptz;

alter table public.calls drop constraint if exists calls_last_agent_line_len;
alter table public.calls add constraint calls_last_agent_line_len
  check (last_agent_line is null or char_length(last_agent_line) <= 500);

comment on column public.calls.greeted_at is
  'First greeting audio sent. Claimed once (update ... where greeted_at is null) so two replicas never both greet.';
comment on column public.calls.last_agent_line is
  'Last line the agent spoke (<= 500), re-spoken after a reconnect if it was cut.';
comment on column public.calls.notice_given is
  'Recording notice already spoken on this call.';
comment on column public.calls.stream_seq is
  'Media streams opened for this call (1 = first). Bumped by bump_call_stream_seq.';
comment on column public.calls.last_stream_at is
  'When the latest media stream for this call opened.';

-- Atomic stream counter. Returns the new value, or null when no calls row.
create or replace function public.bump_call_stream_seq(p_call_sid text)
returns integer
language sql
set search_path = public
as $fn$
  update public.calls
     set stream_seq = stream_seq + 1,
         last_stream_at = now()
   where sautikit_call_sid = p_call_sid
  returning stream_seq;
$fn$;

revoke all on function public.bump_call_stream_seq(text) from public;
revoke all on function public.bump_call_stream_seq(text) from anon;
revoke all on function public.bump_call_stream_seq(text) from authenticated;
grant execute on function public.bump_call_stream_seq(text) to service_role;
