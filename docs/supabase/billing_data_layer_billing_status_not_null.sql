-- billing_data_layer_billing_status_not_null.sql
-- Purpose: set tenant_subscriptions.billing_status NOT NULL without holding
--          ACCESS EXCLUSIVE across the index builds in billing_data_layer.sql.
-- Run after: billing_data_layer.sql (the backfill must already have filled
--            every billing_status). Run this file on its own.
-- Idempotent. A column that is already NOT NULL is left alone.
--
-- DO NOT RUN on production fjxcdccgyhnvnnlnovcl until a backup and Alvin's GO.
-- Staging project is sgcdncjxauhsbunobmob.
--
-- Lock expectations (PostgreSQL 12+, including 17):
--   Block 1. ADD CONSTRAINT ... CHECK (billing_status IS NOT NULL) NOT VALID
--            takes ACCESS EXCLUSIVE and does not scan. It is short.
--   Block 2. VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE and scans.
--            Reads and writes continue. This is the long step, and it is
--            not an exclusive lock.
--   Block 3. SET NOT NULL sees the validated check and is a catalog update.
--            It still takes ACCESS EXCLUSIVE, but it does not scan or rewrite.
--            The helper check is then dropped. DROP CONSTRAINT is short.
--
--   Locks last until the transaction commits. psql -f commits after each
--   statement, so the exclusive lock from block 1 is gone before the scan.
--   The Supabase SQL editor sends a whole script as one transaction. That
--   holds the block 1 exclusive lock through the scan. On staging the
--   subscription table is a handful of rows, so one transaction is a short
--   lock. On production, run block 1, then block 2, then block 3, each on
--   its own, in a quiet window, after a backup.
--
--   Do not paste this file into billing_data_layer.sql. Do not add the
--   column with DEFAULT now() or any other volatile default: that rewrites
--   the table under ACCESS EXCLUSIVE. This script does not add a column.
--
-- Rollback of this step only (the rest of the data layer stays):
--   alter table public.tenant_subscriptions
--     drop constraint if exists tenant_subscriptions_billing_status_not_null;
--   alter table public.tenant_subscriptions
--     alter column billing_status drop not null;
-- Full layer rollback: billing_data_layer_down.sql.

-- Block 1. No scan. Skip when the column is already NOT NULL.
do $$
declare
  v_not_null boolean;
  v_nulls int;
begin
  select a.attnotnull into v_not_null
  from pg_attribute a
  where a.attrelid = 'public.tenant_subscriptions'::regclass
    and a.attname = 'billing_status'
    and not a.attisdropped;
  if coalesce(v_not_null, false) then
    raise notice 'billing_status is already not null';
    return;
  end if;
  select count(*) into v_nulls
  from public.tenant_subscriptions
  where billing_status is null;
  if v_nulls > 0 then
    raise exception 'billing_status has % null rows; backfill before locking', v_nulls;
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tenant_subscriptions'::regclass
      and conname = 'tenant_subscriptions_billing_status_not_null'
  ) then
    alter table public.tenant_subscriptions
      add constraint tenant_subscriptions_billing_status_not_null
      check (billing_status is not null) not valid;
  end if;
end $$;

-- Block 2. Scan under SHARE UPDATE EXCLUSIVE. Writes continue when this
-- statement is its own transaction.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tenant_subscriptions'::regclass
      and conname = 'tenant_subscriptions_billing_status_not_null'
      and not convalidated
  ) then
    alter table public.tenant_subscriptions
      validate constraint tenant_subscriptions_billing_status_not_null;
  end if;
end $$;

-- Block 3. Catalog-only SET NOT NULL once the check is validated, then drop
-- the helper so the column has one NOT NULL and the existing value check.
do $$
begin
  if exists (
    select 1
    from pg_attribute
    where attrelid = 'public.tenant_subscriptions'::regclass
      and attname = 'billing_status'
      and attnotnull
      and not attisdropped
  ) then
    alter table public.tenant_subscriptions
      drop constraint if exists tenant_subscriptions_billing_status_not_null;
    return;
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tenant_subscriptions'::regclass
      and conname = 'tenant_subscriptions_billing_status_not_null'
      and convalidated
  ) then
    raise exception 'validated billing_status not-null check is missing; run block 2 first';
  end if;
  alter table public.tenant_subscriptions
    alter column billing_status set not null;
  alter table public.tenant_subscriptions
    drop constraint if exists tenant_subscriptions_billing_status_not_null;
end $$;
