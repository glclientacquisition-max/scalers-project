-- billing_data_layer.sql
-- Purpose: billing data layer only. Versioned packages, subscription billing
--          status, invoices, payments, credits, billing notices, escalation
--          allowance, and DID quarantine. No charges. No payment provider
--          calls. No voice routing. No send-path changes.
-- Run after: package_catalog.sql, package_state_rules.sql, tenant_billing_state.sql,
--            did_number_pool.sql, super_admin_ops.sql, notify_channels.sql,
--            alert_email.sql, admin_business_archive.sql, admin_business_suspend.sql,
--            wallet_security_beta.sql (ops_audit_log).
-- Idempotent. Safe to re-run until invoice_documents.sql (#780) has been applied.
-- After that file, do not re-run this one: it would put the older
-- finalize_invoice and enqueue_billing_notice bodies back. The
-- finalize_invoice block below refuses to replace a body that already
-- numbers SCL-. billing_status NOT NULL is a separate short script,
-- billing_data_layer_billing_status_not_null.sql, so this file does not
-- hold an exclusive lock across index builds. Rollback:
-- billing_data_layer_down.sql.
--
-- DO NOT RUN on production fjxcdccgyhnvnnlnovcl until a backup and Alvin's GO.
-- Staging project is sgcdncjxauhsbunobmob. This file is the production script.
--
-- Chief (voice and send paths), do not re-apply the assign/release functions in
-- did_number_pool.sql or super_admin_ops.sql after this file. They are replaced
-- here.
--
-- Chief, two clocks. Do not mix them:
--   * tenant_subscriptions.voicemail_until is the owner-decided voicemail window
--     (default 7 days, billing_lifecycle_settings.voicemail_hold_days).
--     now() < voicemail_until -> voicemail. After that -> the existing
--     "line not available" message. This file does not play either message.
--   * sautikit_did_pool.quarantine_until is a reuse hold so a released number
--     is not assigned again. 30 days is a PLACEHOLDER (Part F), not a decision.
--     When quarantine_until has passed, release_expired_quarantine() returns
--     the row to available. assign_did_from_pool calls that function, and
--     both assign functions also accept an expired quarantine row. A future
--     hold still blocks assignment.
--
-- Chief, billing notices are NOT call escalations:
--   * billing_notices is the outbox. Kinds are platform_billing_*.
--     Claim with claim_billing_notices, send on the existing notify path,
--     then settle_billing_notice. Pass billed_to = 'platform' and
--     audience = 'staff' (both stored on the row) and the stored
--     idempotency_key as the notify ledger keyBase. A reclaimed notice
--     then cannot send twice. A replay whose notify ledger already shows
--     that send settles sent, not failed. The sender runs only when
--     BILLING_NOTICES_SEND=on. Do not gate these on tenant_escalation_allowed.
--     claim sets claimed_at and reclaims a sending row whose claimed_at is
--     null or older than 15 minutes. It does not change idempotency_key.
--     settle_billing_notice leaves a sent row unchanged.
--     Invoice due, trial ending, past due, trial ended, and line suspended
--     stay on this outbox.
--   * tenant_escalation_allowed(tenant_id) is the check for voicemail and
--     call-update SMS/WhatsApp. allowed = false means the owner's dashboard
--     Inbox only (the existing call row). No parallel voicemail table.
--
-- Deleting a business (remove_business_and_release_did) still works when the
-- business has notices, status events, or invoices. A before-delete flag lets
-- those child rows cascade. Payments and credits stay restricted. The audit
-- log stays.
--
-- tenant_id on quarantine (both functions agree): entering quarantine clears
-- sautikit_did_pool.tenant_id and stores the business in last_tenant_id.
-- release_did_from_business sets last_tenant_id = p_tenant_id and detaches
-- the business number to pending:{id}, so voice lookup no longer finds that
-- line. quarantine_pool_number sets last_tenant_id from the previous
-- tenant_id and does not rewrite the business number. The Numbers screen
-- calls it only when no business is linked.

-- ---------------------------------------------------------------------------
-- 0. Preconditions. Fail closed if an earlier script has not been applied.
-- ---------------------------------------------------------------------------
do $$
declare
  v_missing text;
begin
  select string_agg(col, ', ') into v_missing
  from (
    select col
    from (values
      ('archived_at'),
      ('suspended_at'),
      ('line_status'),
      ('billing_enforcement'),
      ('minutes_included'),
      ('seconds_used'),
      ('on_demand_usage_enabled'),
      ('notify_channels'),
      ('alert_email'),
      ('whatsapp_notification_number')
    ) as needed(col)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'tenants'
        and c.column_name = needed.col
    )
  ) gaps;
  if v_missing is not null then
    raise exception 'billing_data_layer needs tenants columns: %', v_missing;
  end if;
  if to_regclass('public.billing_packages') is null
     or to_regclass('public.billing_rate_card') is null
     or to_regclass('public.tenant_subscriptions') is null then
    raise exception 'billing_data_layer needs the package catalogue tables';
  end if;
  if to_regclass('public.sautikit_did_pool') is null then
    raise exception 'billing_data_layer needs sautikit_did_pool';
  end if;
  if to_regclass('public.ops_audit_log') is null then
    raise exception 'billing_data_layer needs ops_audit_log';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Lifecycle settings. Voicemail hold is the owner decision (7 days).
--    shadow_invoices stays true until a later invoice builder is switched on.
--    This file does not build invoices from usage.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_lifecycle_settings (
  id integer primary key default 1 check (id = 1),
  voicemail_hold_days integer not null default 7,
  shadow_invoices boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint billing_lifecycle_settings_hold_check
    check (voicemail_hold_days between 1 and 90)
);

insert into public.billing_lifecycle_settings (id)
values (1)
on conflict (id) do nothing;

comment on table public.billing_lifecycle_settings is
  'Billing lifecycle knobs. voicemail_hold_days is the owner decision (default 7). shadow_invoices stays true until a later builder is turned on. Not a price.';

comment on column public.billing_lifecycle_settings.voicemail_hold_days is
  'Days callers can leave a voicemail after a trial ends or a line is suspended. Then the line plays the existing not-available message. Default 7. Range 1 to 90.';

-- PLACEHOLDER. Part F proposal. Not an owner decision. Not the voicemail window.
create or replace function public.billing_quarantine_placeholder_days()
returns integer
language sql
immutable
as $$ select 30 $$;

comment on function public.billing_quarantine_placeholder_days() is
  'PLACEHOLDER. 30-day reuse hold for a released number. Not an owner decision. Distinct from the 7-day voicemail window.';

revoke all on function public.billing_quarantine_placeholder_days() from public, anon, authenticated;
grant execute on function public.billing_quarantine_placeholder_days() to service_role;

-- ---------------------------------------------------------------------------
-- 2. Package versions and features.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_package_versions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.billing_packages (id),
  version integer not null check (version >= 1),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'retired')),
  monthly_price_kes numeric not null check (monthly_price_kes >= 0),
  seats integer not null check (seats >= 0),
  minutes integer not null check (minutes >= 0),
  sms integer not null check (sms >= 0),
  email integer not null check (email >= 0),
  staff_wa integer not null check (staff_wa >= 0),
  dids integer not null check (dids >= 0),
  inbound_kes_per_second numeric not null check (inbound_kes_per_second >= 0),
  outbound_kes_per_second numeric not null check (outbound_kes_per_second >= 0),
  whatsapp_kes numeric not null check (whatsapp_kes >= 0),
  sms_kes numeric not null check (sms_kes >= 0),
  email_kes numeric not null check (email_kes >= 0),
  annual_discount_percent numeric not null
    check (annual_discount_percent >= 0 and annual_discount_percent <= 100),
  trial_days integer check (trial_days is null or trial_days between 1 and 90),
  allowances_placeholder boolean not null default false,
  active_from timestamptz not null default now(),
  published_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  unique (package_id, version)
);

comment on table public.billing_package_versions is
  'Frozen commercial terms. Subscribers keep the version they were pinned to. A published row cannot change price or allowances. Retire it and publish a new version.';

comment on column public.billing_package_versions.allowances_placeholder is
  'True when SMS, email, seats, or staff WhatsApp on this version are not an owner decision. Trial v1 is the marked placeholder (SMS 20, email 30).';

comment on column public.billing_package_versions.trial_days is
  'Set only on a trial version. Trial v1 is 14 days and 20 minutes. Price 0 is the free trial, not a new commercial price.';

create table if not exists public.billing_features (
  key text primary key,
  label text not null
);

comment on table public.billing_features is
  'Capabilities that exist today. Gating is not decided. A missing key is not a denial. v1 turns every key on.';

create table if not exists public.billing_package_version_features (
  package_version_id uuid not null references public.billing_package_versions (id) on delete cascade,
  feature_key text not null references public.billing_features (key),
  enabled boolean not null default true,
  primary key (package_version_id, feature_key)
);

create or replace function public.billing_package_versions_freeze()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'draft' then
    return new;
  end if;
  if new.package_id is distinct from old.package_id
     or new.version is distinct from old.version
     or new.monthly_price_kes is distinct from old.monthly_price_kes
     or new.seats is distinct from old.seats
     or new.minutes is distinct from old.minutes
     or new.sms is distinct from old.sms
     or new.email is distinct from old.email
     or new.staff_wa is distinct from old.staff_wa
     or new.dids is distinct from old.dids
     or new.inbound_kes_per_second is distinct from old.inbound_kes_per_second
     or new.outbound_kes_per_second is distinct from old.outbound_kes_per_second
     or new.whatsapp_kes is distinct from old.whatsapp_kes
     or new.sms_kes is distinct from old.sms_kes
     or new.email_kes is distinct from old.email_kes
     or new.annual_discount_percent is distinct from old.annual_discount_percent
     or new.trial_days is distinct from old.trial_days
     or new.allowances_placeholder is distinct from old.allowances_placeholder
     or new.active_from is distinct from old.active_from
     or new.published_at is distinct from old.published_at
     or new.created_at is distinct from old.created_at
  then
    raise exception 'published package version is frozen';
  end if;
  if old.status = 'published' and new.status = 'retired' then
    return new;
  end if;
  if old.status = new.status and new.retired_at is not distinct from old.retired_at then
    return new;
  end if;
  raise exception 'package version status can only move from published to retired';
end;
$$;

drop trigger if exists billing_package_versions_freeze on public.billing_package_versions;
create trigger billing_package_versions_freeze
  before update on public.billing_package_versions
  for each row execute function public.billing_package_versions_freeze();

-- Refuse to grandfather a surprise. Insert versions FROM the live rows after this.
do $$
begin
  if not exists (
    select 1 from public.billing_packages
    where sku = 'starter'
      and monthly_price_kes = 5000 and seats = 2 and minutes = 300
      and sms = 200 and email = 100 and staff_wa = 200 and dids = 1
  ) then
    raise exception 'starter catalogue does not match current prices; refusing to seed a version';
  end if;
  if not exists (
    select 1 from public.billing_packages
    where sku = 'growth'
      and monthly_price_kes = 12000 and seats = 5 and minutes = 800
      and sms = 500 and email = 250 and staff_wa = 500 and dids = 1
  ) then
    raise exception 'growth catalogue does not match current prices; refusing to seed a version';
  end if;
  if not exists (
    select 1 from public.billing_packages
    where sku = 'scale'
      and monthly_price_kes = 25000 and seats = 10 and minutes = 2000
      and sms = 1500 and email = 500 and staff_wa = 1000 and dids = 1
  ) then
    raise exception 'scale catalogue does not match current prices; refusing to seed a version';
  end if;
  if not exists (
    select 1 from public.billing_rate_card
    where id = 1
      and inbound_kes_per_second = 0.10
      and outbound_kes_per_second = 0.15
      and whatsapp_kes = 2
      and sms_kes = 1
      and email_kes = 1
      and annual_discount_percent = 17
  ) then
    raise exception 'rate card does not match current rates; refusing to seed a version';
  end if;
end $$;

insert into public.billing_package_versions (
  package_id, version, status, monthly_price_kes, seats, minutes, sms, email, staff_wa, dids,
  inbound_kes_per_second, outbound_kes_per_second, whatsapp_kes, sms_kes, email_kes,
  annual_discount_percent, trial_days, allowances_placeholder, active_from, published_at
)
select
  p.id, 1, 'published', p.monthly_price_kes, p.seats, p.minutes, p.sms, p.email, p.staff_wa, p.dids,
  r.inbound_kes_per_second, r.outbound_kes_per_second, r.whatsapp_kes, r.sms_kes, r.email_kes,
  r.annual_discount_percent, null, false, now(), now()
from public.billing_packages p
cross join public.billing_rate_card r
where r.id = 1
  and p.sku in ('starter', 'growth', 'scale')
  and not exists (
    select 1 from public.billing_package_versions v
    where v.package_id = p.id and v.version = 1
  );

-- Trial is its own inactive SKU so it is not a mutated Growth price.
-- SMS 20, email 30, seats 2, staff WhatsApp 0, and 1 number are PLACEHOLDERS.
-- 20 minutes and 14 days are the owner decision. Price 0 is the free trial.
-- is_active false hides it from the public catalogue filter. Admin lists that
-- select every package will still show the row. Do not present it as a priced plan.
insert into public.billing_packages (
  sku, name, monthly_price_kes, seats, minutes, sms, email, staff_wa, dids, sort_order, is_active
)
values ('trial', 'Trial', 0, 2, 20, 20, 30, 0, 1, 0, false)
on conflict (sku) do nothing;

insert into public.billing_package_versions (
  package_id, version, status, monthly_price_kes, seats, minutes, sms, email, staff_wa, dids,
  inbound_kes_per_second, outbound_kes_per_second, whatsapp_kes, sms_kes, email_kes,
  annual_discount_percent, trial_days, allowances_placeholder, active_from, published_at
)
select
  p.id, 1, 'published', p.monthly_price_kes, p.seats, p.minutes, p.sms, p.email, p.staff_wa, p.dids,
  r.inbound_kes_per_second, r.outbound_kes_per_second, r.whatsapp_kes, r.sms_kes, r.email_kes,
  r.annual_discount_percent, 14, true, now(), now()
from public.billing_packages p
cross join public.billing_rate_card r
where r.id = 1
  and p.sku = 'trial'
  and not exists (
    select 1 from public.billing_package_versions v
    where v.package_id = p.id and v.version = 1
  );

insert into public.billing_features (key, label)
values
  ('calls', 'Calls'),
  ('inbox', 'Inbox'),
  ('voicemail', 'Voicemail'),
  ('bookings', 'Bookings'),
  ('catalogue', 'Catalogue'),
  ('sms_alerts', 'SMS alerts'),
  ('whatsapp_alerts', 'WhatsApp alerts'),
  ('email_alerts', 'Email alerts'),
  ('staff', 'Staff')
on conflict (key) do nothing;

insert into public.billing_package_version_features (package_version_id, feature_key, enabled)
select v.id, f.key, true
from public.billing_package_versions v
cross join public.billing_features f
where v.status = 'published'
on conflict (package_version_id, feature_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Subscription billing status. Does not touch the package clock
--    (tenant_subscriptions.status is still active|cancelled).
-- ---------------------------------------------------------------------------
-- New columns on this existing table are nullable and have no default.
-- ADD COLUMN ... DEFAULT now() would rewrite every row: now() is volatile.
-- A constant default is metadata-only, and it is set in its own statement
-- after the add. Do not fold a volatile default into the ADD COLUMN.
alter table public.tenant_subscriptions
  add column if not exists package_version_id uuid references public.billing_package_versions (id),
  add column if not exists billing_status text,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists past_due_at timestamptz,
  add column if not exists grace_started_at timestamptz,
  add column if not exists billing_suspended_at timestamptz,
  add column if not exists billing_cancelled_at timestamptz,
  add column if not exists billing_archived_at timestamptz,
  add column if not exists billing_status_changed_at timestamptz,
  add column if not exists paid_through date,
  add column if not exists collection_method text,
  add column if not exists voicemail_until timestamptz;

alter table public.tenant_subscriptions
  drop constraint if exists tenant_subscriptions_billing_status_check;
alter table public.tenant_subscriptions
  add constraint tenant_subscriptions_billing_status_check check (
    billing_status is null or billing_status in (
      'beta', 'trialing', 'active', 'past_due', 'grace', 'suspended', 'cancelled', 'archived'
    )
  );

alter table public.tenant_subscriptions
  drop constraint if exists tenant_subscriptions_collection_method_check;
alter table public.tenant_subscriptions
  add constraint tenant_subscriptions_collection_method_check check (
    collection_method is null or collection_method in ('bachs', 'daraja', 'manual')
  );

comment on column public.tenant_subscriptions.billing_status is
  'Money state: beta, trialing, active, past_due, grace, suspended, cancelled, archived. Not the package clock (status). beta because enforcement off is not active.';

comment on column public.tenant_subscriptions.voicemail_until is
  'Callers can leave a voicemail until this time (trial end or suspension). After it, the existing line-not-available message applies. Null while the line is in good standing. Voice reads this. This file does not route calls.';

comment on column public.tenant_subscriptions.package_version_id is
  'Pinned commercial version. Grandfathered. A package change pins the latest published version. An unchanged package does not move version.';

create or replace function public.billing_latest_package_version(p_package_id uuid)
returns uuid
language sql
stable
as $$
  select v.id
  from public.billing_package_versions v
  where v.package_id = p_package_id
    and v.status = 'published'
    and v.active_from <= now()
  order by v.active_from desc, v.version desc
  limit 1
$$;

revoke all on function public.billing_latest_package_version(uuid) from public, anon, authenticated;
grant execute on function public.billing_latest_package_version(uuid) to service_role;

-- Backfill once. Does not change enforcement, line status, minutes, or the package clock.
do $$
begin
  perform set_config('scalers.billing_transition', '1', true);
  update public.tenant_subscriptions s
  set
    billing_status = case
      when t.archived_at is not null then 'archived'
      when t.suspended_at is not null or t.line_status = 'suspended' then 'suspended'
      when t.line_status = 'grace' then 'grace'
      when s.status = 'cancelled' then 'cancelled'
      when coalesce(t.billing_enforcement, 'off') = 'off' then 'beta'
      else 'active'
    end,
    billing_status_changed_at = coalesce(s.billing_status_changed_at, now()),
    package_version_id = coalesce(
      s.package_version_id,
      public.billing_latest_package_version(s.package_id)
    )
  from public.tenants t
  where t.id = s.tenant_id
    and s.billing_status is null;
end $$;

alter table public.tenant_subscriptions
  alter column billing_status set default 'beta';

-- Rows with no tenant match stay null and block NOT NULL. Surface them.
do $$
declare
  v_orphans int;
begin
  select count(*) into v_orphans
  from public.tenant_subscriptions
  where billing_status is null or package_version_id is null;
  if v_orphans > 0 then
    raise exception 'billing backfill left % subscription rows without a status or version', v_orphans;
  end if;
end $$;

-- NOT NULL is not set here. SET NOT NULL takes ACCESS EXCLUSIVE for the
-- scan, and this file goes on to build indexes in the same transaction, so
-- the exclusive lock would cover those builds. Run
-- billing_data_layer_billing_status_not_null.sql on its own after this
-- file. It adds a NOT VALID check, validates it (writes continue), then
-- sets NOT NULL from that proof so PostgreSQL 12+ does not scan again.
-- Lock notes and the rollback are in that file and billing_data_layer_down.sql.

create or replace function public.tenant_subscriptions_b_pin_version()
returns trigger
language plpgsql
as $$
declare
  v_version uuid;
begin
  if new.billing_status is null then
    new.billing_status := 'beta';
  end if;
  if tg_op = 'INSERT' then
    if new.package_version_id is null then
      v_version := public.billing_latest_package_version(new.package_id);
      if v_version is null then
        raise exception 'no published package version for this package';
      end if;
      new.package_version_id := v_version;
    end if;
    return new;
  end if;
  if new.package_id is distinct from old.package_id
     and new.package_version_id is not distinct from old.package_version_id
  then
    v_version := public.billing_latest_package_version(new.package_id);
    if v_version is null then
      raise exception 'no published package version for this package';
    end if;
    new.package_version_id := v_version;
  end if;
  return new;
end;
$$;

create or replace function public.tenant_subscriptions_a_billing_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if current_setting('scalers.billing_transition', true) = '1' then
    return new;
  end if;
  if new.billing_status is distinct from old.billing_status
     or new.voicemail_until is distinct from old.voicemail_until
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.past_due_at is distinct from old.past_due_at
     or new.grace_started_at is distinct from old.grace_started_at
     or new.billing_suspended_at is distinct from old.billing_suspended_at
     or new.billing_cancelled_at is distinct from old.billing_cancelled_at
     or new.billing_archived_at is distinct from old.billing_archived_at
     or new.billing_status_changed_at is distinct from old.billing_status_changed_at
  then
    raise exception 'billing status changes go through transition_subscription_billing_status';
  end if;
  if new.package_version_id is distinct from old.package_version_id
     and new.package_id is not distinct from old.package_id
     and old.package_version_id is not null
  then
    raise exception 'package version is pinned; change the package to move version';
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_subscriptions_a_billing_guard on public.tenant_subscriptions;
create trigger tenant_subscriptions_a_billing_guard
  before update on public.tenant_subscriptions
  for each row execute function public.tenant_subscriptions_a_billing_guard();

drop trigger if exists tenant_subscriptions_b_pin_version on public.tenant_subscriptions;
create trigger tenant_subscriptions_b_pin_version
  before insert or update on public.tenant_subscriptions
  for each row execute function public.tenant_subscriptions_b_pin_version();

-- ---------------------------------------------------------------------------
-- 4. Events and audit. Append-only. Also written to ops_audit_log.
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  from_status text,
  to_status text not null,
  actor text not null default 'system',
  reason text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists subscription_events_tenant_idx
  on public.subscription_events (tenant_id, created_at);

create table if not exists public.billing_audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor text not null,
  action text not null,
  tenant_id uuid,
  detail jsonb not null default '{}'::jsonb
);

create index if not exists billing_audit_log_tenant_idx
  on public.billing_audit_log (tenant_id, created_at);

create or replace function public.billing_audit_log_freeze()
returns trigger
language plpgsql
as $$
begin
  -- remove_business_and_release_did deletes the tenant. Cascade may remove
  -- status events. The audit table itself stays, and so does a direct delete.
  if tg_op = 'DELETE'
     and tg_table_name = 'subscription_events'
     and current_setting('scalers.billing_purge', true) = '1'
  then
    return old;
  end if;
  raise exception 'billing audit is append-only';
end;
$$;

drop trigger if exists billing_audit_log_no_update on public.billing_audit_log;
create trigger billing_audit_log_no_update
  before update or delete on public.billing_audit_log
  for each row execute function public.billing_audit_log_freeze();

drop trigger if exists subscription_events_no_update on public.subscription_events;
create trigger subscription_events_no_update
  before update or delete on public.subscription_events
  for each row execute function public.billing_audit_log_freeze();

-- Transaction-local flag so an existing business delete can cascade through
-- notices, status events, and invoices. Payments and credits stay restricted.
create or replace function public.tenants_billing_purge_flag()
returns trigger
language plpgsql
as $$
begin
  perform set_config('scalers.billing_purge', '1', true);
  return old;
end;
$$;

drop trigger if exists tenants_billing_purge_flag on public.tenants;
create trigger tenants_billing_purge_flag
  before delete on public.tenants
  for each row execute function public.tenants_billing_purge_flag();

create or replace function public._billing_audit(
  p_actor text,
  p_action text,
  p_tenant_id uuid,
  p_detail jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.billing_audit_log (actor, action, tenant_id, detail)
  values (coalesce(nullif(btrim(p_actor), ''), 'system'), p_action, p_tenant_id, coalesce(p_detail, '{}'::jsonb));
  insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
  values (coalesce(nullif(btrim(p_actor), ''), 'system'), p_action, p_tenant_id, null, coalesce(p_detail, '{}'::jsonb));
end;
$$;

revoke all on function public._billing_audit(text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public._billing_audit(text, text, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Invoices, payments, credits. apply_payment is safe to replay.
--    Does not move billing_status and does not call refresh_line_status.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_invoice_counters (
  year integer primary key,
  last_number integer not null
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_number text unique,
  status text not null default 'draft'
    check (status in ('draft', 'open', 'paid', 'void', 'uncollectible')),
  currency text not null default 'KES' check (currency = 'KES'),
  subtotal_kes numeric not null default 0 check (subtotal_kes >= 0),
  total_kes numeric not null default 0 check (total_kes >= 0),
  amount_paid_kes numeric not null default 0 check (amount_paid_kes >= 0),
  due_at timestamptz,
  issued_at timestamptz,
  paid_at timestamptz,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists invoices_tenant_idx on public.invoices (tenant_id, created_at);

create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  description text not null,
  quantity numeric not null default 1 check (quantity >= 0),
  unit_amount_kes numeric not null default 0,
  amount_kes numeric not null default 0,
  sort_order integer not null default 0
);

create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id);
create index if not exists invoice_lines_tenant_idx on public.invoice_lines (tenant_id);

create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete restrict,
  invoice_id uuid references public.invoices (id) on delete restrict,
  provider text not null,
  checkout_session_id text,
  status text not null default 'pending',
  amount_kes numeric,
  created_at timestamptz not null default now()
);

create unique index if not exists payment_attempts_checkout_uidx
  on public.payment_attempts (checkout_session_id)
  where checkout_session_id is not null;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete restrict,
  invoice_id uuid references public.invoices (id) on delete restrict,
  provider text not null,
  provider_ref text not null,
  amount_kes numeric not null check (amount_kes > 0),
  settled_amount_minor integer,
  settled_currency text,
  fx_rate numeric,
  fee_minor integer,
  match_status text not null check (match_status in ('matched', 'partial', 'over', 'unmatched')),
  payer_msisdn_masked text,
  bill_ref text,
  paid_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  actor text,
  created_at timestamptz not null default now(),
  unique (provider, provider_ref)
);

create index if not exists payments_tenant_idx on public.payments (tenant_id, created_at);
create index if not exists payments_invoice_idx on public.payments (invoice_id);

create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_key text not null,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 1,
  received_at timestamptz not null default now(),
  unique (provider, event_key)
);

comment on table public.payment_events is
  'Provider-agnostic webhook inbox. Bachs first. Stores the event. Does not call a provider.';

create table if not exists public.tenant_credits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  amount_kes numeric not null check (amount_kes <> 0),
  reason text not null,
  idempotency_key text not null unique,
  payment_id uuid references public.payments (id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table public.tenant_credits is
  'Invoice credits (overpay). Not a wallet top-up and not a product balance.';

create index if not exists tenant_credits_tenant_idx on public.tenant_credits (tenant_id);

create or replace function public.invoices_freeze()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and current_setting('scalers.billing_purge', true) = '1' then
    return old;
  end if;
  if current_setting('scalers.billing_write', true) = '1' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'draft' then
    if new.invoice_number is not null or new.status is distinct from 'draft' then
      raise exception 'invoice number and status are set only by finalize_invoice';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' and old.status = 'draft' then
    return old;
  end if;
  raise exception 'invoice % is frozen', coalesce(old.invoice_number, old.id::text);
end;
$$;

drop trigger if exists invoices_freeze on public.invoices;
create trigger invoices_freeze
  before update or delete on public.invoices
  for each row execute function public.invoices_freeze();

create or replace function public.invoice_lines_freeze()
returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_invoice uuid;
begin
  if tg_op = 'DELETE' and current_setting('scalers.billing_purge', true) = '1' then
    return old;
  end if;
  if current_setting('scalers.billing_write', true) = '1' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  v_invoice := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  select status into v_status from public.invoices where id = v_invoice;
  if v_status = 'draft' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception 'invoice lines are frozen';
end;
$$;

drop trigger if exists invoice_lines_freeze on public.invoice_lines;
create trigger invoice_lines_freeze
  before update or delete on public.invoice_lines
  for each row execute function public.invoice_lines_freeze();

create or replace function public.invoice_lines_tenant()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id is null then
    select tenant_id into new.tenant_id from public.invoices where id = new.invoice_id;
  end if;
  if new.tenant_id is null then
    raise exception 'invoice line needs a tenant';
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_lines_tenant on public.invoice_lines;
create trigger invoice_lines_tenant
  before insert on public.invoice_lines
  for each row execute function public.invoice_lines_tenant();

create or replace function public.tenant_credits_freeze()
returns trigger
language plpgsql
as $$
begin
  raise exception 'credits are append-only';
end;
$$;

drop trigger if exists tenant_credits_no_update on public.tenant_credits;
create trigger tenant_credits_no_update
  before update or delete on public.tenant_credits
  for each row execute function public.tenant_credits_freeze();

-- ---------------------------------------------------------------------------
-- 6. Billing notices. One row per notice. The existing sender consumes it.
--    Not gated by tenant_escalation_allowed.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_notices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null check (kind in (
    'platform_billing_trial_ending',
    'platform_billing_trial_ended',
    'platform_billing_invoice_due',
    'platform_billing_past_due',
    'platform_billing_suspended'
  )),
  title text not null,
  body text not null,
  channel text check (channel is null or channel in ('sms', 'whatsapp', 'email')),
  recipient text,
  fallback jsonb not null default '{}'::jsonb,
  audience text not null default 'staff' check (audience = 'staff'),
  billed_to text not null default 'platform' check (billed_to = 'platform'),
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  idempotency_key text not null,
  notify_send_id uuid,
  last_error text,
  read_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

alter table public.billing_notices
  add column if not exists claimed_at timestamptz;

create index if not exists billing_notices_pending_idx
  on public.billing_notices (created_at)
  where delivery_status = 'pending';

create index if not exists billing_notices_tenant_idx
  on public.billing_notices (tenant_id, created_at);

create index if not exists billing_notices_sending_idx
  on public.billing_notices (claimed_at)
  where delivery_status = 'sending';

comment on table public.billing_notices is
  'Billing outbox and the dashboard copy. One row, not three sends. Chief claims, sends on the existing notify path (billed_to platform, audience staff, stored idempotency_key), then settles. Do not gate on tenant_escalation_allowed. Call and voicemail updates are a different path.';

comment on column public.billing_notices.claimed_at is
  'When the sender last claimed the row. A sending row with claimed_at null or older than 15 minutes can be claimed again. idempotency_key stays.';

create or replace function public.billing_notice_when(p_ts timestamptz)
returns text
language sql
stable
as $$
  select to_char(p_ts at time zone 'Africa/Nairobi', 'DD Mon YYYY, HH24:MI') || ' EAT'
$$;

revoke all on function public.billing_notice_when(timestamptz) from public, anon, authenticated;
grant execute on function public.billing_notice_when(timestamptz) to service_role;

create or replace function public.billing_notices_guard()
returns trigger
language plpgsql
as $$
declare
  v_delivery boolean := current_setting('scalers.billing_notice_delivery', true) = '1';
  v_read boolean := current_setting('scalers.billing_notice_read', true) = '1';
begin
  if tg_op = 'DELETE' then
    if current_setting('scalers.billing_purge', true) = '1' then
      return old;
    end if;
    raise exception 'billing notices are append-only';
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.kind is distinct from old.kind
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.channel is distinct from old.channel
     or new.recipient is distinct from old.recipient
     or new.fallback is distinct from old.fallback
     or new.audience is distinct from old.audience
     or new.billed_to is distinct from old.billed_to
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at
  then
    raise exception 'billing notices are append-only';
  end if;
  if new.read_at is distinct from old.read_at and not v_read then
    raise exception 'read_at is owner mark-read only';
  end if;
  if (new.delivery_status is distinct from old.delivery_status
      or new.notify_send_id is distinct from old.notify_send_id
      or new.last_error is distinct from old.last_error
      or new.claimed_at is distinct from old.claimed_at)
     and not v_delivery
  then
    raise exception 'delivery fields are the sender only';
  end if;
  if v_read and not v_delivery then
    if new.delivery_status is distinct from old.delivery_status
       or new.notify_send_id is distinct from old.notify_send_id
       or new.last_error is distinct from old.last_error
       or new.claimed_at is distinct from old.claimed_at
    then
      raise exception 'mark-read cannot change delivery';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists billing_notices_guard on public.billing_notices;
create trigger billing_notices_guard
  before update or delete on public.billing_notices
  for each row execute function public.billing_notices_guard();

create or replace function public.enqueue_billing_notice(
  p_tenant_id uuid,
  p_kind text,
  p_idempotency_key text,
  p_title text default null,
  p_body text default null
)
returns public.billing_notices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants%rowtype;
  v_channels jsonb;
  v_sms boolean;
  v_wa boolean;
  v_email_on boolean;
  v_phone text;
  v_email text;
  v_channel text;
  v_recipient text;
  v_status text;
  v_error text;
  v_title text;
  v_body text;
  v_row public.billing_notices%rowtype;
begin
  if p_tenant_id is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'tenant and idempotency key are required';
  end if;
  if p_kind not in (
    'platform_billing_trial_ending',
    'platform_billing_trial_ended',
    'platform_billing_invoice_due',
    'platform_billing_past_due',
    'platform_billing_suspended'
  ) then
    raise exception 'unknown billing notice kind';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then
    raise exception 'business not found';
  end if;

  v_title := nullif(btrim(p_title), '');
  v_body := nullif(btrim(p_body), '');
  if p_kind = 'platform_billing_trial_ending' and v_title is null then
    v_title := 'Trial ending';
    v_body := 'Your Business Assistant trial is ending soon. The line stays on until the trial ends.';
  end if;
  if v_title is null or v_body is null then
    raise exception 'notice title and body are required';
  end if;

  -- Same order as dispatch: SMS, then WhatsApp, then email.
  -- If every channel is off, SMS stays on (parseNotifyChannels).
  v_channels := coalesce(v_tenant.notify_channels, '{"sms":true,"whatsapp":true,"email":true}'::jsonb);
  v_sms := coalesce((v_channels->>'sms')::boolean, true);
  v_wa := coalesce((v_channels->>'whatsapp')::boolean, true);
  v_email_on := coalesce((v_channels->>'email')::boolean, true);
  if not v_sms and not v_wa and not v_email_on then
    v_sms := true;
  end if;

  v_phone := nullif(btrim(v_tenant.whatsapp_notification_number), '');
  if v_phone like 'pending:%' then
    v_phone := null;
  end if;
  v_email := nullif(btrim(v_tenant.alert_email), '');

  v_channel := null;
  v_recipient := null;
  v_status := 'pending';
  v_error := null;
  if v_sms and v_phone is not null then
    v_channel := 'sms';
    v_recipient := v_phone;
  elsif v_wa and v_phone is not null then
    v_channel := 'whatsapp';
    v_recipient := v_phone;
  elsif v_email_on and v_email is not null then
    v_channel := 'email';
    v_recipient := v_email;
  else
    v_status := 'skipped';
    v_error := 'no recipient';
  end if;

  insert into public.billing_notices (
    tenant_id, kind, title, body, channel, recipient, fallback,
    audience, billed_to, delivery_status, idempotency_key, last_error
  ) values (
    p_tenant_id, p_kind, v_title, v_body, v_channel, v_recipient,
    jsonb_build_object(
      'order', jsonb_build_array('sms', 'whatsapp', 'email'),
      'sms', v_phone,
      'whatsapp', v_phone,
      'email', v_email
    ),
    'staff', 'platform', v_status, p_idempotency_key, v_error
  )
  on conflict (tenant_id, idempotency_key) do nothing;

  select * into v_row
  from public.billing_notices
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  return v_row;
end;
$$;

comment on function public.enqueue_billing_notice(uuid, text, text, text, text) is
  'Queues one billing notice for the existing sender. Does not call tenant_escalation_allowed. Does not send.';

revoke all on function public.enqueue_billing_notice(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.enqueue_billing_notice(uuid, text, text, text, text) to service_role;

create or replace function public.claim_billing_notices(p_limit integer default 20)
returns setof public.billing_notices
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    p_limit := 20;
  end if;
  perform set_config('scalers.billing_notice_delivery', '1', true);
  return query
  update public.billing_notices n
  set delivery_status = 'sending',
      claimed_at = now()
  where n.id in (
    select id
    from public.billing_notices
    where delivery_status = 'pending'
       or (
         delivery_status = 'sending'
         and (claimed_at is null or claimed_at < now() - interval '15 minutes')
       )
    order by created_at
    for update skip locked
    limit p_limit
  )
  returning n.*;
end;
$$;

comment on function public.claim_billing_notices(integer) is
  'Marks pending billing notices as sending, and reclaims sending rows whose claimed_at is null or older than 15 minutes. Sets claimed_at. Does not change idempotency_key. Does not send.';

revoke all on function public.claim_billing_notices(integer) from public, anon, authenticated;
grant execute on function public.claim_billing_notices(integer) to service_role;

create or replace function public.settle_billing_notice(
  p_id uuid,
  p_status text,
  p_notify_send_id uuid default null,
  p_error text default null
)
returns public.billing_notices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.billing_notices%rowtype;
begin
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'settle status must be sent, failed, or skipped';
  end if;
  select * into v_row from public.billing_notices where id = p_id for update;
  if not found then
    raise exception 'notice not found';
  end if;
  -- A sent notice stays sent. A later failed or skipped settle, or a
  -- different notify_send_id, does not overwrite it.
  if v_row.delivery_status = 'sent' then
    return v_row;
  end if;
  perform set_config('scalers.billing_notice_delivery', '1', true);
  update public.billing_notices
  set delivery_status = p_status,
      notify_send_id = p_notify_send_id,
      last_error = p_error
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$$;

comment on function public.settle_billing_notice(uuid, text, uuid, text) is
  'Records sent, failed, or skipped. A notice that is already sent is returned unchanged.';

revoke all on function public.settle_billing_notice(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.settle_billing_notice(uuid, text, uuid, text) to service_role;

create or replace function public.mark_billing_notice_read(p_id uuid)
returns public.billing_notices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.billing_notices%rowtype;
begin
  select * into v_row
  from public.billing_notices
  where id = p_id
    and tenant_id in (select public.current_user_tenant_ids());
  if not found then
    raise exception 'notice not found';
  end if;
  perform set_config('scalers.billing_notice_read', '1', true);
  update public.billing_notices
  set read_at = coalesce(read_at, now())
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$$;

comment on function public.mark_billing_notice_read(uuid) is
  'Owner marks their own billing notice read. Sets read_at once. Does not change delivery.';

revoke all on function public.mark_billing_notice_read(uuid) from public, anon;
grant execute on function public.mark_billing_notice_read(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Transition. Records billing_status only. Does not change enforcement,
--    line_status, minutes, or the package clock. Does not detach a DID.
-- ---------------------------------------------------------------------------
create or replace function public.set_voicemail_hold_days(
  p_days integer,
  p_actor text,
  p_reason text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'voicemail hold must be 1 to 90 days';
  end if;
  update public.billing_lifecycle_settings
  set voicemail_hold_days = p_days, updated_at = now()
  where id = 1;
  perform public._billing_audit(
    p_actor,
    'set_voicemail_hold_days',
    null,
    jsonb_build_object('days', p_days, 'reason', p_reason)
  );
  return p_days;
end;
$$;

revoke all on function public.set_voicemail_hold_days(integer, text, text) from public, anon, authenticated;
grant execute on function public.set_voicemail_hold_days(integer, text, text) to service_role;

create or replace function public.transition_subscription_billing_status(
  p_tenant_id uuid,
  p_to text,
  p_actor text,
  p_reason text default null,
  p_voicemail_days integer default null
)
returns public.tenant_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.tenant_subscriptions%rowtype;
  v_tenant public.tenants%rowtype;
  v_version public.billing_package_versions%rowtype;
  v_from text;
  v_days integer;
  v_vm timestamptz;
  v_trial_ends timestamptz;
  v_notice_kind text;
  v_notice_title text;
  v_notice_body text;
  v_when text;
  v_allowed_move boolean := false;
begin
  if p_tenant_id is null then
    raise exception 'business id required';
  end if;
  if p_to not in (
    'beta', 'trialing', 'active', 'past_due', 'grace', 'suspended', 'cancelled', 'archived'
  ) then
    raise exception 'unknown billing status %', p_to;
  end if;

  select * into v_sub
  from public.tenant_subscriptions
  where tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'no subscription';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then
    raise exception 'business not found';
  end if;

  v_from := v_sub.billing_status;
  if v_from = p_to then
    return v_sub;
  end if;

  if v_from = 'beta' and p_to in ('past_due', 'grace', 'suspended') then
    raise exception 'a beta business is not billed';
  end if;
  if v_from = 'beta' and p_to = 'active' and coalesce(v_tenant.billing_enforcement, 'off') = 'off' then
    raise exception 'set billing mode before active';
  end if;

  if v_from = 'beta' and p_to in ('trialing', 'active', 'cancelled', 'archived') then
    v_allowed_move := true;
  elsif v_from = 'trialing' and p_to in ('active', 'past_due', 'grace', 'suspended', 'cancelled', 'archived') then
    v_allowed_move := true;
  elsif v_from = 'active' and p_to in ('past_due', 'grace', 'suspended', 'cancelled', 'archived') then
    v_allowed_move := true;
  elsif v_from = 'past_due' and p_to in ('active', 'grace', 'suspended', 'cancelled', 'archived') then
    v_allowed_move := true;
  elsif v_from = 'grace' and p_to in ('active', 'past_due', 'suspended', 'cancelled', 'archived') then
    v_allowed_move := true;
  elsif v_from = 'suspended' and p_to in ('active', 'grace', 'cancelled', 'archived') then
    v_allowed_move := true;
  elsif v_from = 'cancelled' and p_to in ('active', 'trialing', 'archived') then
    v_allowed_move := true;
  elsif v_from = 'archived' and p_to in ('beta', 'active', 'cancelled') then
    v_allowed_move := true;
  end if;
  if not v_allowed_move then
    raise exception 'cannot move billing status from % to %', v_from, p_to;
  end if;

  if p_voicemail_days is not null and (p_voicemail_days < 1 or p_voicemail_days > 90) then
    raise exception 'voicemail hold must be 1 to 90 days';
  end if;
  select coalesce(p_voicemail_days, voicemail_hold_days)
    into v_days
  from public.billing_lifecycle_settings
  where id = 1;
  if v_days is null or v_days < 1 or v_days > 90 then
    raise exception 'voicemail hold must be 1 to 90 days';
  end if;

  v_vm := v_sub.voicemail_until;
  v_trial_ends := v_sub.trial_ends_at;
  v_notice_kind := null;

  if p_to = 'trialing' then
    select * into v_version
    from public.billing_package_versions
    where id = v_sub.package_version_id;
    if v_version.trial_days is null then
      raise exception 'this package version has no trial';
    end if;
    if v_trial_ends is null then
      v_trial_ends := now() + make_interval(days => v_version.trial_days);
    end if;
  end if;

  -- Trial end opens the voicemail window, except when the trial converts to active.
  -- Suspension opens it too. Active, and a non-trial past_due or grace, clear it
  -- because the Business Assistant still answers. Cancel keeps a window only when
  -- the trial itself just ended.
  if p_to in ('active', 'beta') or (p_to = 'trialing') then
    v_vm := null;
  elsif v_from = 'trialing' and p_to <> 'active' then
    v_vm := now() + make_interval(days => v_days);
    v_notice_kind := 'platform_billing_trial_ended';
  elsif p_to = 'suspended' then
    v_vm := now() + make_interval(days => v_days);
    v_notice_kind := 'platform_billing_suspended';
  elsif p_to in ('past_due', 'grace') and v_from <> 'trialing' then
    v_vm := null;
    if p_to = 'past_due' then
      v_notice_kind := 'platform_billing_past_due';
    end if;
  end if;

  perform set_config('scalers.billing_transition', '1', true);
  update public.tenant_subscriptions s
  set
    billing_status = p_to,
    billing_status_changed_at = now(),
    voicemail_until = v_vm,
    trial_ends_at = v_trial_ends,
    past_due_at = case
      when p_to = 'past_due' then coalesce(s.past_due_at, now())
      when p_to in ('active', 'trialing', 'beta') then null
      else s.past_due_at
    end,
    grace_started_at = case
      when p_to = 'grace' then coalesce(s.grace_started_at, now())
      when p_to in ('active', 'trialing', 'beta') then null
      else s.grace_started_at
    end,
    billing_suspended_at = case
      when p_to = 'suspended' then coalesce(s.billing_suspended_at, now())
      when p_to in ('active', 'trialing', 'beta') then null
      else s.billing_suspended_at
    end,
    billing_cancelled_at = case
      when p_to = 'cancelled' then coalesce(s.billing_cancelled_at, now())
      when p_to in ('active', 'trialing', 'beta') then null
      else s.billing_cancelled_at
    end,
    billing_archived_at = case
      when p_to = 'archived' then coalesce(s.billing_archived_at, now())
      else s.billing_archived_at
    end,
    updated_at = now()
  where s.tenant_id = p_tenant_id
  returning * into v_sub;

  insert into public.subscription_events (tenant_id, from_status, to_status, actor, reason, detail)
  values (
    p_tenant_id, v_from, p_to, coalesce(nullif(btrim(p_actor), ''), 'system'), p_reason,
    jsonb_build_object(
      'billing_enforcement', v_tenant.billing_enforcement,
      'line_status', v_tenant.line_status,
      'minutes_included', v_tenant.minutes_included,
      'package_clock_status', v_sub.status,
      'voicemail_until', v_vm,
      'note', 'does not change enforcement, line status, minutes, or the package clock'
    )
  );

  perform public._billing_audit(
    p_actor,
    'billing_status_' || p_to,
    p_tenant_id,
    jsonb_build_object('from', v_from, 'to', p_to, 'reason', p_reason, 'voicemail_until', v_vm)
  );

  if v_notice_kind is not null then
    v_when := public.billing_notice_when(v_vm);
    if v_notice_kind = 'platform_billing_trial_ended' then
      v_notice_title := 'Trial ended';
      v_notice_body := 'Your Business Assistant trial has ended. Callers can leave a voicemail until '
        || v_when || '. After that, callers hear that this line is not available.';
    elsif v_notice_kind = 'platform_billing_suspended' then
      v_notice_title := 'Line suspended';
      v_notice_body := 'Your line is suspended. Callers can leave a voicemail until '
        || v_when || '. After that, callers hear that this line is not available.';
    elsif v_notice_kind = 'platform_billing_past_due' then
      v_notice_title := 'Payment past due';
      v_notice_body := 'Your Business Assistant payment is past due. The line stays on until it is suspended.';
    end if;
    perform public.enqueue_billing_notice(
      p_tenant_id,
      v_notice_kind,
      v_notice_kind || ':' || p_tenant_id::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
      v_notice_title,
      v_notice_body
    );
  end if;

  return v_sub;
end;
$$;

comment on function public.transition_subscription_billing_status(uuid, text, text, text, integer) is
  'Moves billing_status only. Does not change billing_enforcement, line_status, minutes, or the package clock. Does not call suspend_line_for_nonpayment or archive_tenant_billing. Same status is a no-op.';

revoke all on function public.transition_subscription_billing_status(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.transition_subscription_billing_status(uuid, text, text, text, integer) to service_role;

-- finalize_invoice (data-layer numbering).
-- SC- is the data-layer number only. billing_company.sql (P8) owns the
-- canonical SCL- body. Re-applying this file must not put SC- back over it.
-- A body that already contains SCL- is left as it is. The SC- body still sets
-- scalers.billing_write so a draft number and status write can pass invoices_freeze.
do $install_finalize_invoice$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'finalize_invoice'
      and pg_get_functiondef(p.oid) like '%SCL-%'
  ) then
    raise notice 'finalize_invoice already numbers SCL-; leaving the billing_company.sql body in place';
    return;
  end if;

  execute $fn$
create or replace function public.finalize_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_inv public.invoices%rowtype;
  v_year integer;
  v_n integer;
  v_number text;
  v_body text;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status <> 'draft' then
    raise exception 'only a draft invoice can be finalized';
  end if;

  v_year := extract(year from (now() at time zone 'Africa/Nairobi'))::integer;
  insert into public.billing_invoice_counters (year, last_number)
  values (v_year, 0)
  on conflict (year) do nothing;
  update public.billing_invoice_counters
  set last_number = last_number + 1
  where year = v_year
  returning last_number into v_n;
  v_number := 'SC-' || v_year::text || '-' || lpad(v_n::text, 6, '0');

  -- invoices_freeze rejects a draft row whose number or status changes
  -- unless this flag is set. Direct updates cannot set the flag.
  perform set_config('scalers.billing_write', '1', true);
  update public.invoices
  set status = 'open',
      invoice_number = v_number,
      issued_at = coalesce(issued_at, now()),
      updated_at = now()
  where id = p_invoice_id
  returning * into v_inv;

  v_body := 'Your Business Assistant invoice ' || v_number
    || ' for KES ' || trim(to_char(v_inv.total_kes, 'FM999999990.00')) || ' is due.';
  perform public.enqueue_billing_notice(
    v_inv.tenant_id,
    'platform_billing_invoice_due',
    'platform_billing_invoice_due:' || v_inv.id::text,
    'Invoice due',
    v_body
  );
  return v_inv;
end;
$body$;
$fn$;

  execute $c$comment on function public.finalize_invoice(uuid) is
  'Assigns SC-YYYY-000001 for the Africa/Nairobi year and queues platform_billing_invoice_due once per invoice. Does not charge. Sets scalers.billing_write so the freeze allows the number and status. Do not run this file after billing_company.sql.'$c$;
  execute 'revoke all on function public.finalize_invoice(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.finalize_invoice(uuid) to service_role';
end
$install_finalize_invoice$;

create or replace function public.apply_payment(
  p_provider text,
  p_provider_ref text,
  p_amount_kes numeric,
  p_tenant_id uuid default null,
  p_invoice_id uuid default null,
  p_paid_at timestamptz default null,
  p_actor text default 'system',
  p_raw jsonb default '{}'::jsonb,
  p_settled_amount_minor integer default null,
  p_settled_currency text default null,
  p_fx_rate numeric default null,
  p_fee_minor integer default null,
  p_payer_msisdn_masked text default null,
  p_bill_ref text default null
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.payments%rowtype;
  v_inv public.invoices%rowtype;
  v_paid numeric;
  v_match text;
  v_row public.payments%rowtype;
  v_excess numeric;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_provider_ref), '') is null then
    raise exception 'provider and provider ref are required';
  end if;
  if p_amount_kes is null or p_amount_kes <= 0 then
    raise exception 'payment amount must be positive';
  end if;

  select * into v_existing
  from public.payments
  where provider = p_provider and provider_ref = p_provider_ref
  for update;
  if found then
    return v_existing;
  end if;

  if p_invoice_id is not null then
    select * into v_inv from public.invoices where id = p_invoice_id for update;
    if not found then
      raise exception 'invoice not found';
    end if;
    if v_inv.status in ('void', 'uncollectible') then
      raise exception 'invoice cannot be paid';
    end if;
    if v_inv.status = 'draft' then
      raise exception 'draft invoices are not payable';
    end if;
    if p_tenant_id is not null and p_tenant_id is distinct from v_inv.tenant_id then
      raise exception 'payment tenant does not match the invoice';
    end if;
    p_tenant_id := v_inv.tenant_id;
    v_paid := v_inv.amount_paid_kes + p_amount_kes;
    if v_paid < v_inv.total_kes then
      v_match := 'partial';
    elsif v_paid = v_inv.total_kes then
      v_match := 'matched';
    else
      v_match := 'over';
    end if;
  else
    v_match := 'unmatched';
  end if;

  insert into public.payments (
    tenant_id, invoice_id, provider, provider_ref, amount_kes,
    settled_amount_minor, settled_currency, fx_rate, fee_minor,
    match_status, payer_msisdn_masked, bill_ref, paid_at, raw, actor
  ) values (
    p_tenant_id, p_invoice_id, p_provider, p_provider_ref, p_amount_kes,
    p_settled_amount_minor, p_settled_currency, p_fx_rate, p_fee_minor,
    v_match, p_payer_msisdn_masked, p_bill_ref, coalesce(p_paid_at, now()),
    coalesce(p_raw, '{}'::jsonb), p_actor
  )
  returning * into v_row;

  if p_invoice_id is not null then
    perform set_config('scalers.billing_write', '1', true);
    if v_match = 'over' then
      v_excess := v_paid - v_inv.total_kes;
      update public.invoices
      set amount_paid_kes = total_kes,
          status = 'paid',
          paid_at = coalesce(paid_at, coalesce(p_paid_at, now())),
          updated_at = now()
      where id = p_invoice_id;
      insert into public.tenant_credits (tenant_id, amount_kes, reason, idempotency_key, payment_id)
      values (
        p_tenant_id,
        v_excess,
        'overpay',
        'overpay:' || p_provider || ':' || p_provider_ref,
        v_row.id
      );
    elsif v_match = 'matched' then
      update public.invoices
      set amount_paid_kes = total_kes,
          status = 'paid',
          paid_at = coalesce(paid_at, coalesce(p_paid_at, now())),
          updated_at = now()
      where id = p_invoice_id;
    else
      update public.invoices
      set amount_paid_kes = amount_paid_kes + p_amount_kes,
          updated_at = now()
      where id = p_invoice_id;
    end if;
  end if;

  perform public._billing_audit(
    p_actor,
    'apply_payment',
    p_tenant_id,
    jsonb_build_object(
      'provider', p_provider,
      'provider_ref', p_provider_ref,
      'amount_kes', p_amount_kes,
      'match_status', v_match,
      'invoice_id', p_invoice_id
    )
  );
  return v_row;
end;
$$;

comment on function public.apply_payment(text, text, numeric, uuid, uuid, timestamptz, text, jsonb, integer, text, numeric, integer, text, text) is
  'Idempotent on (provider, provider_ref). Replay returns the existing row and does not increase amount_paid. Does not move billing_status or reopen a line.';

revoke all on function public.apply_payment(text, text, numeric, uuid, uuid, timestamptz, text, jsonb, integer, text, numeric, integer, text, text) from public, anon, authenticated;
grant execute on function public.apply_payment(text, text, numeric, uuid, uuid, timestamptz, text, jsonb, integer, text, numeric, integer, text, text) to service_role;

create or replace function public.record_payment_event(
  p_provider text,
  p_event_key text,
  p_payload jsonb default '{}'::jsonb
)
returns public.payment_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payment_events%rowtype;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_event_key), '') is null then
    raise exception 'provider and event key are required';
  end if;
  insert into public.payment_events (provider, event_key, payload)
  values (p_provider, p_event_key, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, event_key) do update
    set attempts = public.payment_events.attempts + 1
  returning * into v_row;
  return v_row;
end;
$$;

comment on function public.record_payment_event(text, text, jsonb) is
  'Webhook inbox. Replay increments attempts and does not insert a second row. Does not call a provider.';

revoke all on function public.record_payment_event(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_payment_event(text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Escalation allowance. Read-only. Chief wires this into voice and the
--    call/voicemail send path. Billing notices do not call it.
--    allowed = false -> dashboard Inbox only (the existing call row).
--    No SMS or WhatsApp for voicemails and call updates.
-- ---------------------------------------------------------------------------
create or replace function public.tenant_escalation_allowed(p_tenant_id uuid)
returns table (allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants%rowtype;
  v_sub public.tenant_subscriptions%rowtype;
  v_included integer;
  v_used integer;
  v_enforced boolean;
  v_known boolean;
  v_none boolean;
begin
  if p_tenant_id is null then
    allowed := false;
    reason := 'unknown';
    return next;
    return;
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then
    allowed := false;
    reason := 'unknown';
    return next;
    return;
  end if;

  select * into v_sub from public.tenant_subscriptions where tenant_id = p_tenant_id;

  if v_tenant.archived_at is not null or v_sub.billing_status = 'archived' then
    allowed := false;
    reason := 'archived';
    return next;
    return;
  end if;

  if v_sub.billing_status = 'cancelled' then
    allowed := false;
    reason := 'cancelled';
    return next;
    return;
  end if;

  -- The voicemail window wins over the reason that opened it.
  if v_sub.voicemail_until is not null and v_sub.voicemail_until > now() then
    allowed := false;
    reason := 'voicemail';
    return next;
    return;
  end if;

  if v_sub.billing_status = 'suspended'
     or v_tenant.line_status = 'suspended'
     or v_tenant.suspended_at is not null
  then
    allowed := false;
    if v_sub.voicemail_until is not null and v_sub.voicemail_until <= now() then
      reason := 'line_not_available';
    else
      reason := 'suspended';
    end if;
    return next;
    return;
  end if;

  if v_sub.billing_status = 'trialing'
     and v_sub.trial_ends_at is not null
     and v_sub.trial_ends_at <= now()
  then
    allowed := false;
    if v_sub.voicemail_until is not null and v_sub.voicemail_until <= now() then
      reason := 'line_not_available';
    else
      reason := 'trial_ended';
    end if;
    return next;
    return;
  end if;

  if v_sub.voicemail_until is not null and v_sub.voicemail_until <= now() then
    allowed := false;
    reason := 'line_not_available';
    return next;
    return;
  end if;

  -- Minute cap mirrors inboundOpen. Beta (enforcement off) stays open.
  -- On-demand stays open. Cap does not start the 7-day voicemail clock.
  v_included := greatest(0, coalesce(v_tenant.minutes_included, 0));
  v_used := greatest(0, coalesce(v_tenant.seconds_used, 0));
  v_enforced := coalesce(v_tenant.billing_enforcement, 'off') in ('soft', 'hard');
  v_known := v_sub.tenant_id is not null;
  v_none := v_sub.status = 'cancelled';

  if not v_known and v_included <= 0 then
    allowed := true;
    reason := 'ok';
    return next;
    return;
  end if;
  if v_used < v_included * 60 then
    allowed := true;
    reason := 'ok';
    return next;
    return;
  end if;
  if coalesce(v_tenant.on_demand_usage_enabled, false) then
    allowed := true;
    reason := 'ok';
    return next;
    return;
  end if;
  if not v_enforced then
    allowed := true;
    reason := 'ok';
    return next;
    return;
  end if;

  allowed := false;
  if v_none then
    reason := 'no_package';
  else
    reason := 'minutes_cap';
  end if;
  return next;
end;
$$;

comment on function public.tenant_escalation_allowed(uuid) is
  'Whether SMS and WhatsApp escalation of voicemails and call updates is allowed. False means the owner dashboard Inbox only. Billing notices (invoice due, trial ending, past due, trial ended, suspended) are not gated by this function. Chief wires the call into the voice and escalation send paths.';

revoke all on function public.tenant_escalation_allowed(uuid) from public, anon, authenticated;
grant execute on function public.tenant_escalation_allowed(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 9. DID quarantine. Assignment skips a number until quarantine_until.
--    After that, release_expired_quarantine() returns it to available, and
--    both assign functions will also take the expired row.
--
--    tenant_id: both quarantine_pool_number and release_did_from_business
--    clear pool.tenant_id and write last_tenant_id. release_did_from_business
--    also detaches the business number to pending:{id}. quarantine_pool_number
--    does not change the business number.
-- ---------------------------------------------------------------------------
alter table public.sautikit_did_pool
  add column if not exists quarantine_until timestamptz,
  add column if not exists quarantined_at timestamptz,
  add column if not exists last_tenant_id uuid;

alter table public.sautikit_did_pool
  drop constraint if exists sautikit_did_pool_status_check;
alter table public.sautikit_did_pool
  add constraint sautikit_did_pool_status_check check (
    status in ('available', 'assigned', 'reserved', 'disabled', 'quarantine')
  );

comment on column public.sautikit_did_pool.quarantine_until is
  'Reuse hold. A released number is not assignable until this time. PLACEHOLDER length is billing_quarantine_placeholder_days() (30). Not the voicemail window.';

create index if not exists sautikit_did_pool_quarantine_idx
  on public.sautikit_did_pool (quarantine_until)
  where status = 'quarantine';

create or replace function public.sautikit_did_pool_quarantine_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('available', 'reserved')
     and new.quarantine_until is not null
     and new.quarantine_until > now()
  then
    raise exception 'number is in quarantine until %', new.quarantine_until;
  end if;
  if new.status = 'quarantine'
     and (new.quarantine_until is null or new.quarantined_at is null)
  then
    raise exception 'quarantine requires a until date';
  end if;
  return new;
end;
$$;

drop trigger if exists sautikit_did_pool_quarantine_guard on public.sautikit_did_pool;
create trigger sautikit_did_pool_quarantine_guard
  before insert or update on public.sautikit_did_pool
  for each row execute function public.sautikit_did_pool_quarantine_guard();

create or replace function public.quarantine_pool_number(
  p_e164 text,
  p_until timestamptz default null,
  p_actor text default 'ops',
  p_reason text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e164 text := nullif(btrim(p_e164), '');
  v_until timestamptz;
  v_tenant uuid;
begin
  if v_e164 is null then
    raise exception 'e164 is required';
  end if;
  v_until := coalesce(
    p_until,
    now() + make_interval(days => public.billing_quarantine_placeholder_days())
  );
  if v_until <= now() then
    raise exception 'quarantine until must be in the future';
  end if;

  select tenant_id into v_tenant
  from public.sautikit_did_pool
  where e164 = v_e164;
  if not found then
    raise exception 'DID % is not in the pool', v_e164;
  end if;

  update public.sautikit_did_pool
  set
    status = 'quarantine',
    tenant_id = null,
    quarantine_until = v_until,
    quarantined_at = now(),
    last_tenant_id = coalesce(v_tenant, last_tenant_id)
  where e164 = v_e164;

  perform public._billing_audit(
    p_actor,
    'quarantine_number',
    v_tenant,
    jsonb_build_object('e164', v_e164, 'until', v_until, 'reason', p_reason)
  );
  return v_e164;
end;
$$;

comment on function public.quarantine_pool_number(text, timestamptz, text, text) is
  'Marks a pool number quarantine, clears tenant_id, and keeps the previous business on last_tenant_id. Does not change the business number. Default length is the 30-day PLACEHOLDER. Does not route calls.';

revoke all on function public.quarantine_pool_number(text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.quarantine_pool_number(text, timestamptz, text, text) to service_role;

-- Exit from quarantine. A future hold stays. Called from both assign functions
-- so a number is not stuck after quarantine_until.
create or replace function public.release_expired_quarantine()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.sautikit_did_pool
  set
    status = 'available',
    tenant_id = null,
    last_tenant_id = coalesce(last_tenant_id, tenant_id),
    assigned_at = null,
    quarantine_until = null,
    quarantined_at = null
  where status = 'quarantine'
    and quarantine_until is not null
    and quarantine_until <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.release_expired_quarantine() is
  'Returns expired quarantine rows to available and clears the hold. Keeps last_tenant_id. Does not assign a number.';

revoke all on function public.release_expired_quarantine() from public, anon, authenticated;
grant execute on function public.release_expired_quarantine() to service_role;

-- Replaces did_number_pool.sql. Do not re-apply that file's assign functions after this.
create or replace function public.assign_did_from_pool(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.sautikit_did_pool%rowtype;
  v_current text;
begin
  if p_tenant_id is null then
    return null;
  end if;

  select sautikit_virtual_number into v_current
  from public.tenants
  where id = p_tenant_id;

  if v_current is not null and v_current not like 'pending:%' then
    return v_current;
  end if;

  perform public.release_expired_quarantine();

  select *
  into v_row
  from public.sautikit_did_pool
  where (
      status = 'available'
      or (status = 'quarantine' and quarantine_until <= now())
    )
    and (quarantine_until is null or quarantine_until <= now())
  order by created_at asc
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.sautikit_did_pool
  set
    status = 'assigned',
    tenant_id = p_tenant_id,
    assigned_at = now(),
    quarantine_until = null,
    quarantined_at = null
  where id = v_row.id;

  update public.tenants
  set sautikit_virtual_number = v_row.e164
  where id = p_tenant_id;

  return v_row.e164;
end;
$$;

create or replace function public.assign_specific_did_to_tenant(
  p_tenant_id uuid,
  p_e164 text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e164 text := nullif(btrim(p_e164), '');
  v_id uuid;
begin
  if p_tenant_id is null or v_e164 is null then
    raise exception 'tenant_id and e164 are required';
  end if;

  -- The update below accepts an expired quarantine row before the sweeper
  -- runs, so this path does not depend on release_expired_quarantine.
  -- The sweeper still runs after a successful assign so other expired rows exit.

  if exists (
    select 1
    from public.sautikit_did_pool
    where e164 = v_e164
      and (
        quarantine_until > now()
        or (status = 'quarantine' and quarantine_until is null)
      )
  ) then
    raise exception 'DID % is in quarantine', v_e164;
  end if;

  update public.sautikit_did_pool
  set
    status = 'assigned',
    tenant_id = p_tenant_id,
    assigned_at = now(),
    quarantine_until = null,
    quarantined_at = null
  where e164 = v_e164
    and (
      status in ('available', 'reserved')
      or (status = 'quarantine' and quarantine_until <= now())
    )
  returning id into v_id;

  if v_id is null then
    raise exception 'DID % is not available in the pool', v_e164;
  end if;

  perform public.release_expired_quarantine();

  -- Do not flip a future quarantine row back to available. Expired rows
  -- were already returned to available by release_expired_quarantine.
  update public.sautikit_did_pool
  set
    status = 'available',
    tenant_id = null,
    assigned_at = null
  where tenant_id = p_tenant_id
    and id <> v_id
    and status <> 'quarantine'
    and (quarantine_until is null or quarantine_until <= now());

  update public.tenants
  set sautikit_virtual_number = v_e164
  where id = p_tenant_id;

  return v_e164;
end;
$$;

-- Replaces super_admin_ops.sql. Still detaches the business number to pending
-- (voice lookup unchanged) and now quarantines the pool row for the placeholder
-- hold so the number is not reused immediately.
create or replace function public.release_did_from_business(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e164 text;
  v_until timestamptz;
begin
  if p_tenant_id is null then
    raise exception 'business id required';
  end if;

  select sautikit_virtual_number into v_e164
  from public.tenants
  where id = p_tenant_id;

  if v_e164 is null then
    raise exception 'business not found';
  end if;

  v_until := now() + make_interval(days => public.billing_quarantine_placeholder_days());

  update public.sautikit_did_pool
  set
    status = 'quarantine',
    tenant_id = null,
    assigned_at = null,
    last_tenant_id = p_tenant_id,
    quarantined_at = now(),
    quarantine_until = v_until
  where tenant_id = p_tenant_id
     or (e164 = v_e164 and v_e164 not like 'pending:%');

  update public.tenants
  set sautikit_virtual_number = 'pending:' || p_tenant_id::text
  where id = p_tenant_id;

  if v_e164 like 'pending:%' then
    return null;
  end if;

  perform public._billing_audit(
    'system',
    'release_number_quarantine',
    p_tenant_id,
    jsonb_build_object('e164', v_e164, 'until', v_until, 'placeholder_days', public.billing_quarantine_placeholder_days())
  );
  return v_e164;
end;
$$;

comment on function public.release_did_from_business(uuid) is
  'Detaches the business number to pending:{id}, clears pool.tenant_id, sets last_tenant_id to that business, and quarantines the number. Does not route calls.';

revoke all on function public.assign_did_from_pool(uuid) from public, anon, authenticated;
revoke all on function public.assign_specific_did_to_tenant(uuid, text) from public, anon, authenticated;
revoke all on function public.release_did_from_business(uuid) from public, anon, authenticated;
grant execute on function public.assign_did_from_pool(uuid) to service_role;
grant execute on function public.assign_specific_did_to_tenant(uuid, text) to service_role;
grant execute on function public.release_did_from_business(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 10. RLS. Owners read their own invoices, lines, subscription, notices,
--     and published versions. Writes are service role or the functions above.
-- ---------------------------------------------------------------------------
alter table public.billing_packages enable row level security;
alter table public.tenant_subscriptions enable row level security;
alter table public.billing_lifecycle_settings enable row level security;
alter table public.billing_package_versions enable row level security;
alter table public.billing_features enable row level security;
alter table public.billing_package_version_features enable row level security;
alter table public.subscription_events enable row level security;
alter table public.billing_audit_log enable row level security;
alter table public.billing_invoice_counters enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.tenant_credits enable row level security;
alter table public.billing_notices enable row level security;

revoke all on table public.billing_lifecycle_settings from public, anon, authenticated;
revoke all on table public.billing_package_versions from public, anon, authenticated;
revoke all on table public.billing_features from public, anon, authenticated;
revoke all on table public.billing_package_version_features from public, anon, authenticated;
revoke all on table public.subscription_events from public, anon, authenticated;
revoke all on table public.billing_audit_log from public, anon, authenticated;
revoke all on table public.billing_invoice_counters from public, anon, authenticated;
revoke all on table public.invoices from public, anon, authenticated;
revoke all on table public.invoice_lines from public, anon, authenticated;
revoke all on table public.payment_attempts from public, anon, authenticated;
revoke all on table public.payments from public, anon, authenticated;
revoke all on table public.payment_events from public, anon, authenticated;
revoke all on table public.tenant_credits from public, anon, authenticated;
revoke all on table public.billing_notices from public, anon, authenticated;

grant all on table public.billing_lifecycle_settings to service_role;
grant all on table public.billing_package_versions to service_role;
grant all on table public.billing_features to service_role;
grant all on table public.billing_package_version_features to service_role;
grant all on table public.subscription_events to service_role;
grant all on table public.billing_audit_log to service_role;
grant all on table public.billing_invoice_counters to service_role;
grant all on table public.invoices to service_role;
grant all on table public.invoice_lines to service_role;
grant all on table public.payment_attempts to service_role;
grant all on table public.payments to service_role;
grant all on table public.payment_events to service_role;
grant all on table public.tenant_credits to service_role;
grant all on table public.billing_notices to service_role;

grant select on table public.billing_package_versions to authenticated;
grant select on table public.billing_features to authenticated;
grant select on table public.billing_package_version_features to authenticated;
grant select on table public.invoices to authenticated;
grant select on table public.invoice_lines to authenticated;
grant select on table public.billing_notices to authenticated;

-- Keep the owner read that tenant_billing_state.sql already installed.
drop policy if exists tenant_subscriptions_select_member on public.tenant_subscriptions;
create policy tenant_subscriptions_select_member
  on public.tenant_subscriptions for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
grant select on public.tenant_subscriptions to authenticated;

drop policy if exists billing_packages_select_all on public.billing_packages;
create policy billing_packages_select_all
  on public.billing_packages for select to authenticated
  using (true);
grant select on public.billing_packages to authenticated;

drop policy if exists billing_package_versions_select_published on public.billing_package_versions;
create policy billing_package_versions_select_published
  on public.billing_package_versions for select to authenticated
  using (status = 'published');

drop policy if exists billing_features_select_all on public.billing_features;
create policy billing_features_select_all
  on public.billing_features for select to authenticated
  using (true);

drop policy if exists billing_package_version_features_select_published on public.billing_package_version_features;
create policy billing_package_version_features_select_published
  on public.billing_package_version_features for select to authenticated
  using (
    package_version_id in (
      select id from public.billing_package_versions where status = 'published'
    )
  );

drop policy if exists invoices_select_member on public.invoices;
create policy invoices_select_member
  on public.invoices for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists invoice_lines_select_member on public.invoice_lines;
create policy invoice_lines_select_member
  on public.invoice_lines for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists billing_notices_select_member on public.billing_notices;
create policy billing_notices_select_member
  on public.billing_notices for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

-- ---------------------------------------------------------------------------
-- 11. Read models. security invoker so owner RLS applies.
-- ---------------------------------------------------------------------------
create or replace view public.billing_subscription_read
with (security_invoker = true) as
select
  s.tenant_id,
  t.business_name,
  p.sku as package_sku,
  p.name as package_name,
  p.is_active as package_listed,
  s.status as package_clock_status,
  s.billing_status,
  s.package_version_id,
  v.version as package_version,
  v.monthly_price_kes as version_monthly_price_kes,
  v.minutes as version_minutes,
  v.sms as version_sms,
  v.email as version_email,
  v.seats as version_seats,
  v.staff_wa as version_staff_wa,
  v.dids as version_dids,
  v.trial_days,
  v.allowances_placeholder,
  v.active_from as version_active_from,
  s.trial_ends_at,
  s.voicemail_until,
  s.past_due_at,
  s.grace_started_at,
  s.billing_suspended_at,
  s.billing_cancelled_at,
  s.billing_archived_at,
  s.paid_through,
  s.collection_method,
  t.billing_enforcement,
  t.line_status,
  t.minutes_included,
  t.seconds_used,
  t.on_demand_usage_enabled
from public.tenant_subscriptions s
join public.tenants t on t.id = s.tenant_id
join public.billing_packages p on p.id = s.package_id
left join public.billing_package_versions v on v.id = s.package_version_id;

comment on view public.billing_subscription_read is
  'Owner and admin read of the pinned version, billing status, and voicemail window. Price is the grandfathered version, not the live package row. Trial allowances_placeholder is true. No pay action.';

grant select on public.billing_subscription_read to authenticated, service_role;

create or replace view public.billing_notice_outbox
with (security_invoker = true) as
select *
from public.billing_notices
where delivery_status in ('pending', 'sending');

comment on view public.billing_notice_outbox is
  'Service role queue for Chief. Pending and sending billing notices. Not a send implementation.';

revoke all on public.billing_notice_outbox from public, anon, authenticated;
grant select on public.billing_notice_outbox to service_role;

create or replace view public.tenant_credit_balance
with (security_invoker = true) as
select tenant_id, sum(amount_kes) as balance_kes
from public.tenant_credits
group by tenant_id;

comment on view public.tenant_credit_balance is
  'Service role invoice-credit balance. Not a wallet. Owners do not read credits or payments from this layer.';

revoke all on public.tenant_credit_balance from public, anon, authenticated;
grant select on public.tenant_credit_balance to service_role;
