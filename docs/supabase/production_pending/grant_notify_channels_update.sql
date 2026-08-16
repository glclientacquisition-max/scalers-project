-- APPLIED 2026-08-16 on ALCR (fjxcdccgyhnvnnlnovcl)
-- Human approval: operator (Phase 3H A3)
-- CLI: supabase_migrations.schema_migrations 20260816180900 grant_notify_channels_update
-- Ledger: LEDGER-PROD-NOTIFY-GRANT
-- See: docs/operations/PRODUCTION_CHANGE_NOTIFY_CHANNELS.md
--
-- Minimal fix: allow authenticated owners to UPDATE notify_channels column only.
-- RLS policy tenants_update_member already permits row-level UPDATE for members.
-- Reversible: REVOKE UPDATE (notify_channels) ON public.tenants FROM authenticated;

grant update (notify_channels) on public.tenants to authenticated;
