-- Undo number_hold_winback.sql. DRAFT: NOT APPLIED. Running holds become plain quarantine rows.
drop function if exists public.number_on_winback_hold(text);
drop function if exists public.admin_restore_held_number(text, uuid, text, text, boolean);
drop function if exists public.admin_end_number_hold(text, text, text, boolean);
drop function if exists public.admin_hold_number_for_winback(text, integer, text, text, boolean);
drop function if exists public.admin_set_number_hold_settings(boolean, numeric, boolean, integer, text, text, boolean);
drop trigger if exists sautikit_did_pool_winback_guard on public.sautikit_did_pool;
drop function if exists public.sautikit_did_pool_winback_guard();
alter table public.sautikit_did_pool drop column if exists winback_hold;
alter table public.billing_lifecycle_settings
  drop constraint if exists billing_lifecycle_settings_number_hold_days_check,
  drop constraint if exists billing_lifecycle_settings_reactivation_fee_check,
  drop column if exists number_hold_days,
  drop column if exists reactivation_fee_kes,
  drop column if exists hold_winback_enabled;
