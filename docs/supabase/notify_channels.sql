-- Per-tenant notify channel preferences for leads + escalation.
-- ASCII-only (safe for Supabase SQL Editor).

alter table public.tenants
  add column if not exists notify_channels jsonb not null default '{"sms":true,"whatsapp":true,"email":true}'::jsonb;

comment on column public.tenants.notify_channels is
  'Owner notify prefs: {sms, whatsapp, email} booleans. Platform still greys channels that are not live yet.';

-- Desk settings save patches this column with the owner JWT.
-- RLS: tenants_update_member. Idempotent if already granted.
grant update (notify_channels) on public.tenants to authenticated;
