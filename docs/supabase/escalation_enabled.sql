-- Per-business toggle: escalate / notify teammates from Team Directory.
-- Default ON. When off, the receptionist still helps callers but does not
-- fire escalation notifications (Telegram / later WhatsApp).
-- ASCII-only (safe for Supabase SQL Editor).

alter table public.tenants
  add column if not exists escalation_enabled boolean not null default true;

comment on column public.tenants.escalation_enabled is
  'When true, send Telegram/WhatsApp call alerts (leads + team escalation). When false, save calls to Inbox only — no alert messages.';
