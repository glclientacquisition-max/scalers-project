-- Permanent browser-demo visitor markers. One row per salted hash.
-- kind is ip or device. visitor_hash is sha256(DEMO_IP_SALT|kind|value).
-- No raw IP, no raw device id, no transcript, no audio.
-- grants_remaining is the only way to allow another session.
-- Service role only. Deploy does not apply this file.
-- Apply by hand after Alvin's GO. Do not apply on prod from Voice.
-- Idempotent. ASCII-only.

create table if not exists public.demo_visitor_use (
  visitor_hash text primary key,
  kind text not null,
  first_used_at timestamptz,
  grants_remaining integer not null default 0,
  granted_by text,
  granted_at timestamptz,
  constraint demo_visitor_use_hash_check check (visitor_hash ~ '^[0-9a-f]{64}$'),
  constraint demo_visitor_use_kind_check check (kind in ('ip', 'device')),
  constraint demo_visitor_use_grants_check check (grants_remaining >= 0)
);

comment on table public.demo_visitor_use is
  'Salted demo visitor hashes. No raw IP or device id. A row with grants_remaining 0 is used.';

alter table public.demo_visitor_use enable row level security;

revoke all on public.demo_visitor_use from public;
revoke all on public.demo_visitor_use from anon;
revoke all on public.demo_visitor_use from authenticated;

grant all on public.demo_visitor_use to service_role;
