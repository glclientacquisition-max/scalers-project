-- PRODUCTION PENDING — DO NOT APPLY WITHOUT EXPLICIT HUMAN APPROVAL
-- Project: ALCR (fjxcdccgyhnvnnlnovcl)
-- Ledger: LEDGER-PROD-NOTIFY-GRANT (add on apply)
-- See: docs/operations/PRODUCTION_CHANGE_NOTIFY_CHANNELS.md
--
-- Minimal fix: allow authenticated owners to UPDATE notify_channels column only.
-- RLS policy tenants_update_member already permits row-level UPDATE for members.
-- Reversible: REVOKE UPDATE (notify_channels) ON public.tenants FROM authenticated;

grant update (notify_channels) on public.tenants to authenticated;
