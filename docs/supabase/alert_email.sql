-- Per-business alert email (fallback when WhatsApp is not ready / fails).
-- ASCII-only (safe for Supabase SQL Editor).

alter table public.tenants
  add column if not exists alert_email text;

comment on column public.tenants.alert_email is
  'Owner alert email used as fallback when WhatsApp sender is unavailable or send fails.';
