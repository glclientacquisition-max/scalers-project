-- LEGACY / unused by the app.
-- Column may still exist on older DBs from an interim Telegram alerts toggle.
-- Scalers does not expose or read this setting anymore; scale path is
-- per-tenant WhatsApp owner/teammate numbers, not a global Telegram switch.
-- Safe to leave the column in place; do not re-wire product UI to it.

-- alter table public.tenants
--   add column if not exists escalation_enabled boolean not null default true;
