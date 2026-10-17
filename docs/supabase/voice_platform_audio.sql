-- Platform audio hosted by SautiKit for <Play> (line-unavailable clips, #639).
-- One row per clip key (line_unavailable_en_v1, line_unavailable_sw_v1).
-- url is a presigned storage.sautikit.com link (7 days). Voice re-uploads
-- before expires_at. Secret-ish: service role only, never logged.
-- Deploy does not apply this file. Idempotent. ASCII-only.

create table if not exists public.voice_platform_audio (
  key text primary key,
  url text not null,
  expires_at timestamptz not null,
  uploaded_at timestamptz not null default now(),
  file_sha256 text,
  size_bytes integer,
  mime_type text,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint voice_platform_audio_key_check check (key ~ '^[a-z0-9_]+$'),
  constraint voice_platform_audio_url_check check (url like 'https://storage.sautikit.com/%')
);

create or replace function public.voice_platform_audio_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists voice_platform_audio_touch on public.voice_platform_audio;
create trigger voice_platform_audio_touch
  before update on public.voice_platform_audio
  for each row execute function public.voice_platform_audio_touch();

comment on table public.voice_platform_audio is
  'SautiKit-hosted platform clips for <Play>. url is presigned (7 days); Voice refreshes it under 48 h left. Service role only.';

alter table public.voice_platform_audio enable row level security;

revoke all on public.voice_platform_audio from public;
revoke all on public.voice_platform_audio from anon;
revoke all on public.voice_platform_audio from authenticated;
