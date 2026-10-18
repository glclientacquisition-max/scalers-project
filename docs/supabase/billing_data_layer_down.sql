-- billing_data_layer_down.sql
-- Rollback for billing_data_layer.sql and
-- billing_data_layer_billing_status_not_null.sql.
--
-- Destructive. Drops the invoices, payments, credits, notices, package
-- versions, and the columns this layer added on tenant_subscriptions and
-- sautikit_did_pool. Does not delete tenant rows. Does not drop
-- billing_packages or the rate card.
--
-- Does not restore assign_did_from_pool, assign_specific_did_to_tenant, or
-- release_did_from_business. After this file, re-apply did_number_pool.sql
-- and super_admin_ops.sql if those functions should return to the
-- pre-quarantine bodies.
--
-- Quarantine rows are set to disabled before the status check is tightened
-- back to available|assigned|reserved|disabled, so a released number is not
-- put straight back to available.
--
-- DO NOT RUN on production fjxcdccgyhnvnnlnovcl.
-- DO NOT RUN on staging sgcdncjxauhsbunobmob unless the billing data layer
-- is being removed on purpose.
--
-- Locks: DROP NOT NULL, DROP CONSTRAINT, and DROP COLUMN take ACCESS
-- EXCLUSIVE. DROP NOT NULL and DROP COLUMN (PostgreSQL marks the column
-- dropped) do not rewrite the table. They are still brief exclusive locks.
-- Run this on its own, not in the middle of another script.
--
-- Section A undoes only the NOT NULL. Section B removes the layer.
-- Running this file runs both. Section A is safe to run on its own when
-- the column still exists: stop after it if the rest of the layer stays.

-- ---------------------------------------------------------------------------
-- A. Undo billing_status NOT NULL only.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tenant_subscriptions'
      and column_name = 'billing_status'
  ) then
    execute 'alter table public.tenant_subscriptions drop constraint if exists tenant_subscriptions_billing_status_not_null';
    execute 'alter table public.tenant_subscriptions alter column billing_status drop not null';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- B. Remove the data layer.
-- ---------------------------------------------------------------------------
drop view if exists public.billing_subscription_read;
drop view if exists public.billing_notice_outbox;
drop view if exists public.tenant_credit_balance;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'billing_quarantine_placeholder_days',
        'billing_package_versions_freeze',
        'billing_latest_package_version',
        'tenant_subscriptions_b_pin_version',
        'tenant_subscriptions_a_billing_guard',
        'billing_audit_log_freeze',
        'tenants_billing_purge_flag',
        '_billing_audit',
        'invoices_freeze',
        'invoice_lines_freeze',
        'invoice_lines_tenant',
        'tenant_credits_freeze',
        'billing_notice_when',
        'billing_notices_guard',
        'enqueue_billing_notice',
        'claim_billing_notices',
        'settle_billing_notice',
        'mark_billing_notice_read',
        'set_voicemail_hold_days',
        'transition_subscription_billing_status',
        'finalize_invoice',
        'apply_payment',
        'record_payment_event',
        'tenant_escalation_allowed',
        'sautikit_did_pool_quarantine_guard',
        'quarantine_pool_number',
        'release_expired_quarantine',
        'assign_did_from_pool',
        'assign_specific_did_to_tenant',
        'release_did_from_business'
      )
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

do $$
begin
  if to_regclass('public.sautikit_did_pool') is not null then
    update public.sautikit_did_pool
    set status = 'disabled'
    where status = 'quarantine';
    alter table public.sautikit_did_pool
      drop constraint if exists sautikit_did_pool_status_check;
    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.sautikit_did_pool'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%available%'
    ) then
      alter table public.sautikit_did_pool
        add constraint sautikit_did_pool_status_check check (
          status in ('available', 'assigned', 'reserved', 'disabled')
        );
    end if;
  end if;
end $$;

drop index if exists public.sautikit_did_pool_quarantine_idx;

alter table if exists public.sautikit_did_pool
  drop column if exists quarantine_until,
  drop column if exists quarantined_at,
  drop column if exists last_tenant_id;

alter table if exists public.tenant_subscriptions
  drop column if exists voicemail_until,
  drop column if exists collection_method,
  drop column if exists paid_through,
  drop column if exists billing_status_changed_at,
  drop column if exists billing_archived_at,
  drop column if exists billing_cancelled_at,
  drop column if exists billing_suspended_at,
  drop column if exists grace_started_at,
  drop column if exists past_due_at,
  drop column if exists trial_ends_at,
  drop column if exists billing_status,
  drop column if exists package_version_id;

drop table if exists public.tenant_credits cascade;
drop table if exists public.payment_events cascade;
drop table if exists public.payments cascade;
drop table if exists public.payment_attempts cascade;
drop table if exists public.invoice_lines cascade;
drop table if exists public.invoices cascade;
drop table if exists public.billing_invoice_counters cascade;
drop table if exists public.billing_notices cascade;
drop table if exists public.billing_audit_log cascade;
drop table if exists public.subscription_events cascade;
drop table if exists public.billing_package_version_features cascade;
drop table if exists public.billing_features cascade;
drop table if exists public.billing_package_versions cascade;
drop table if exists public.billing_lifecycle_settings cascade;
