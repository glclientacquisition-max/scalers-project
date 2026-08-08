-- Per-business toggle: escalate / notify teammates from Team Directory.
-- Default ON. When off, the receptionist still helps callers but does not
-- fire escalation notifications (Telegram / later WhatsApp).
-- ASCII-only (safe for Supabase SQL Editor).

alter table public.tenants
  add column if not exists escalation_enabled boolean not null default true;

comment on column public.tenants.escalation_enabled is
  'When true, voice may escalate to Team Directory and send owner/teammate alerts. When false, skip escalation notify.';
