-- Staff platform notices and ops-mail settings.
-- Not owner lead mail and not caller alerts.
-- Run after admin_billing_ops.sql (independent of wallet RPCs).
-- ASCII-only (safe for Supabase SQL Editor).
-- Service role only. Owners have no policies.

create table if not exists public.platform_ops_settings (
  id smallint primary key default 1 check (id = 1),
  emails text[] not null default '{}',
  kinds jsonb not null default '{
    "speech": true,
    "reasoning": true,
    "phone_line": true,
    "sautikit_low": true,
    "pool_empty": true,
    "beta_expired": true
  }'::jsonb,
  sautikit_warn_minor integer not null default 50000,
  updated_at timestamptz not null default now()
);

comment on table public.platform_ops_settings is
  'Singleton staff ops-mail list and type toggles. Not owner notify.';

create table if not exists public.platform_ops_notices (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  status text not null default 'open'
    check (status in ('open', 'acked', 'resolved')),
  detail text,
  opened_at timestamptz not null default now(),
  notified_at timestamptz,
  acked_at timestamptz,
  resolved_at timestamptz
);

comment on table public.platform_ops_notices is
  'Open staff notices so a process restart does not lose or re-fire ops mail.';

create unique index if not exists platform_ops_notices_one_open
  on public.platform_ops_notices (kind)
  where status in ('open', 'acked');

alter table public.platform_ops_settings enable row level security;
alter table public.platform_ops_notices enable row level security;

revoke all on table public.platform_ops_settings from anon, authenticated;
revoke all on table public.platform_ops_notices from anon, authenticated;

grant select, insert, update, delete on table public.platform_ops_settings to service_role;
grant select, insert, update, delete on table public.platform_ops_notices to service_role;

insert into public.platform_ops_settings (id)
values (1)
on conflict (id) do nothing;
