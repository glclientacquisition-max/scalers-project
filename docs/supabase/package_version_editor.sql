-- package_version_editor.sql
-- Purpose: Super Admin package versions. Draft from the current version, edit
--          the draft, publish it from a date, or archive it. Published rows
--          stay frozen. A new subscription pins the latest published version.
--          An existing business keeps its version. A beta business
--          (billing_enforcement off, usage metered only) is not moved onto a
--          later version, enforcement is not turned on, and no invoice is
--          written. The trial is the trial package version.
-- Run after: billing_data_layer.sql
-- Idempotent. Safe to re-run.
--
-- Re-apply this file after any re-apply of billing_data_layer.sql. Both files
-- replace the version freeze and the subscription guard. This file must be last
-- so a published version stays frozen and a version move stays explicit.
--
-- DO NOT RUN on production fjxcdccgyhnvnnlnovcl until a backup and Alvin's GO.
-- Staging project is sgcdncjxauhsbunobmob.
-- package_editor_enabled defaults on, which is right for staging. Before this
-- file is ever applied on production, set package_editor_enabled false in the
-- same change. Production receives a version through
-- admin_import_promoted_package_version, not through the editor.
--
-- Prices are copied from the version an admin starts from. This file does not
-- write a new commercial price. The owner price table is
-- package_version_owner_prices.sql. Run that after this file, on staging only.
--
-- Messages are one shared allowance: message_credits. credit_kes is the KSh
-- price of one credit (default 1). sms_credit_burn, whatsapp_credit_burn, and
-- email_credit_burn are credits per SMS segment, WhatsApp message, and email.
-- The editor writes those burns into sms_kes, whatsapp_kes, and email_kes so
-- the stored rate matches. It does not edit the old sms, email, and staff_wa
-- included columns. Seeded versions leave message_credits null. An admin sets
-- the pool on the draft. Owner defaults, still editable on a draft: SMS
-- segment 1, WhatsApp alert 2, email 1. A draft copies the burns from the
-- version it starts from. on_demand_allowed is true on a paid version. The
-- trial version can lock it off. Metering still reads the old buckets until
-- a later change.
--
-- annual_price_kes is stored. annual_discount_percent is the implied discount
-- and is rewritten from the annual price on every draft save, so a later
-- extra-seat annualization that reads the percent stays in step.
-- spend_limit_share_percent is the default on-demand cap as a percent of the
-- monthly price (default 50). Desk reads it from the version row.
-- extra_seat_monthly_kes belongs to the owner billing actions file. This file
-- does not add that column. When it is already there, a draft copies it and
-- the editor can change it. A null on a new paid draft becomes 500. A
-- published value is not rewritten. Trial stays null.
-- Trial minutes are minutes on sku trial. Trial credits are message_credits
-- on sku trial. Trial length is trial_days.

-- ---------------------------------------------------------------------------
-- 1. Editor settings and version bookkeeping.
-- ---------------------------------------------------------------------------
alter table public.billing_lifecycle_settings
  add column if not exists price_change_approval_threshold_kes numeric,
  add column if not exists package_editor_enabled boolean not null default true,
  add column if not exists new_signup_trial_enabled boolean not null default false;

alter table public.billing_lifecycle_settings
  drop constraint if exists billing_lifecycle_settings_threshold_check;
alter table public.billing_lifecycle_settings
  add constraint billing_lifecycle_settings_threshold_check check (
    price_change_approval_threshold_kes is null
    or price_change_approval_threshold_kes >= 0
  );

comment on column public.billing_lifecycle_settings.price_change_approval_threshold_kes is
  'Null: a publish does not need a second admin. Set: a monthly price move above this amount, or any call rate, credit price, annual price, spend-limit share, or extra-seat price change, needs a second admin. Zero means any monthly price change.';

comment on column public.billing_lifecycle_settings.package_editor_enabled is
  'When false, draft, edit, publish, archive, approve, and move are refused. Import of a promoted version still runs. Staging stays true.';

comment on column public.billing_lifecycle_settings.new_signup_trial_enabled is
  'When false, a new business gets no subscription from signup. When true, inserting a business with no subscription pins the latest published trial version. Does not change billing enforcement. Does not start trial expiry. Default false.';

alter table public.billing_package_versions
  add column if not exists copied_from_id uuid,
  add column if not exists promote_fingerprint text,
  add column if not exists notes text,
  add column if not exists price_set_by text,
  add column if not exists message_credits integer,
  add column if not exists sms_credit_burn numeric,
  add column if not exists whatsapp_credit_burn numeric,
  add column if not exists email_credit_burn numeric,
  add column if not exists on_demand_allowed boolean not null default true;

-- Burns follow the existing per-channel KSh rate because 1 credit = KSh 1.
-- message_credits stays null on rows that were seeded with separate buckets.
update public.billing_package_versions
set
  sms_credit_burn = coalesce(sms_credit_burn, sms_kes),
  whatsapp_credit_burn = coalesce(whatsapp_credit_burn, whatsapp_kes),
  email_credit_burn = coalesce(email_credit_burn, email_kes)
where sms_credit_burn is null
   or whatsapp_credit_burn is null
   or email_credit_burn is null;

alter table public.billing_package_versions
  drop constraint if exists billing_package_versions_message_credits_check;
alter table public.billing_package_versions
  add constraint billing_package_versions_message_credits_check check (
    (message_credits is null or message_credits >= 0)
    and (sms_credit_burn is null or sms_credit_burn >= 0)
    and (whatsapp_credit_burn is null or whatsapp_credit_burn >= 0)
    and (email_credit_burn is null or email_credit_burn >= 0)
  );

comment on column public.billing_package_versions.message_credits is
  'One shared allowance for SMS, WhatsApp, and email. Null on a seeded version until an admin sets it. Not three buckets.';

comment on column public.billing_package_versions.sms_credit_burn is
  'Credits burned per SMS segment. Owner default is 1. 1 credit = KSh 1, so this is also the SMS on-demand rate. Editable on a draft.';

comment on column public.billing_package_versions.whatsapp_credit_burn is
  'Credits burned per WhatsApp alert. Owner default is 2, matching the on-demand rate. Editable on a draft.';

comment on column public.billing_package_versions.email_credit_burn is
  'Credits burned per email. Owner default is 1. 1 credit = KSh 1. Editable on a draft.';

comment on column public.billing_package_versions.on_demand_allowed is
  'When false, this version does not offer on-demand minutes or credits. The trial locks it off. Editable on a draft.';

alter table public.billing_package_versions
  add column if not exists annual_price_kes numeric,
  add column if not exists credit_kes numeric not null default 1,
  add column if not exists spend_limit_share_percent numeric not null default 50;

update public.billing_package_versions
set annual_price_kes = round(monthly_price_kes * 12 * (1 - annual_discount_percent / 100))
where annual_price_kes is null;

alter table public.billing_package_versions
  alter column annual_price_kes set not null;

alter table public.billing_package_versions
  drop constraint if exists billing_package_versions_desk_terms_check;
alter table public.billing_package_versions
  add constraint billing_package_versions_desk_terms_check check (
    annual_price_kes >= 0
    and credit_kes >= 0
    and spend_limit_share_percent >= 0
    and spend_limit_share_percent <= 100
  );

comment on column public.billing_package_versions.annual_price_kes is
  'Annual price in KSh, stored. The implied discount is annual_discount_percent, rewritten from this price and the monthly price.';

comment on column public.billing_package_versions.credit_kes is
  'KSh price of one message credit. Default 1. Editable on a draft. Burn rates stay in credits.';

comment on column public.billing_package_versions.spend_limit_share_percent is
  'Default on-demand spend cap as a percent of monthly_price_kes. Default 50. Editable on a draft. Desk reads this column. billing_spend_limit_kes from the owner billing actions file still uses 50 percent until that function reads this column.';

create or replace function public._package_version_has_column(p_column text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'billing_package_versions'
      and column_name = p_column
  )
$$;

create or replace function public._package_annual_discount(p_monthly numeric, p_annual numeric)
returns numeric
language plpgsql
immutable
as $$
begin
  if p_monthly is null or p_monthly < 0 or p_annual is null or p_annual < 0 then
    raise exception 'package numbers must be zero or more';
  end if;
  if p_monthly = 0 then
    if p_annual <> 0 then
      raise exception 'annual price is above twelve months';
    end if;
    return 0;
  end if;
  if p_annual > p_monthly * 12 then
    raise exception 'annual price is above twelve months';
  end if;
  return round((1 - (p_annual / (p_monthly * 12))) * 100, 2);
end;
$$;

create or replace function public._package_version_copy_extra_seat(p_target uuid, p_source uuid)
returns void
language plpgsql
as $$
begin
  if not public._package_version_has_column('extra_seat_monthly_kes') then
    return;
  end if;
  execute $sql$
    update public.billing_package_versions d
    set extra_seat_monthly_kes = case
      when s.extra_seat_monthly_kes is null and p.sku <> 'trial' and d.status = 'draft' then 500
      else s.extra_seat_monthly_kes
    end
    from public.billing_package_versions s
    join public.billing_packages p on p.id = s.package_id
    where d.id = $1 and s.id = $2
  $sql$
  using p_target, p_source;
end;
$$;

-- Returns true when the stored extra-seat price changes. No-op when the
-- column is absent or the patch does not mention it.
create or replace function public._package_version_apply_extra_seat(p_id uuid, p_patch jsonb)
returns boolean
language plpgsql
as $$
declare
  v_old numeric;
  v_new numeric;
begin
  if not public._package_version_has_column('extra_seat_monthly_kes') then
    return false;
  end if;
  if p_patch is null or not (p_patch ? 'extra_seat_monthly_kes') then
    return false;
  end if;
  execute 'select extra_seat_monthly_kes from public.billing_package_versions where id = $1'
    into v_old
    using p_id;
  if jsonb_typeof(p_patch -> 'extra_seat_monthly_kes') = 'null' then
    if v_old is null then
      return false;
    end if;
    execute 'update public.billing_package_versions set extra_seat_monthly_kes = null where id = $1'
      using p_id;
    return true;
  end if;
  if jsonb_typeof(p_patch -> 'extra_seat_monthly_kes') <> 'number' then
    raise exception 'package numbers must be zero or more';
  end if;
  v_new := (p_patch ->> 'extra_seat_monthly_kes')::numeric;
  if v_new < 0 or v_new > 100000000 then
    raise exception 'package numbers must be zero or more';
  end if;
  if v_old is not distinct from v_new then
    return false;
  end if;
  execute 'update public.billing_package_versions set extra_seat_monthly_kes = $1 where id = $2'
    using v_new, p_id;
  return true;
end;
$$;

create or replace function public._package_version_fill_extra_seat()
returns void
language plpgsql
as $$
begin
  if not public._package_version_has_column('extra_seat_monthly_kes') then
    return;
  end if;
  execute $sql$
    update public.billing_package_versions v
    set extra_seat_monthly_kes = 500
    from public.billing_packages p
    where v.package_id = p.id
      and p.sku <> 'trial'
      and v.status = 'draft'
      and v.extra_seat_monthly_kes is null
  $sql$;
end;
$$;

select public._package_version_fill_extra_seat();

do $$
begin
  alter table public.billing_package_versions
    add constraint billing_package_versions_copied_from_fk
    foreign key (copied_from_id)
    references public.billing_package_versions (id)
    on delete set null;
exception when duplicate_object then null;
end $$;

create unique index if not exists billing_package_versions_fingerprint_idx
  on public.billing_package_versions (package_id, promote_fingerprint)
  where promote_fingerprint is not null;

comment on column public.billing_package_versions.copied_from_id is
  'Published version this draft was copied from. Null on the seeded versions and on a promoted import.';

comment on column public.billing_package_versions.promote_fingerprint is
  'Set when a version was imported from another environment. A second import of the same fingerprint returns this row.';

comment on column public.billing_package_versions.price_set_by is
  'Admin who last changed a price field on the draft. A second admin must approve before that person can publish, when the threshold says so.';

-- Freeze the new columns too. Drafts can still change. Published can still retire.
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
     or new.annual_price_kes is distinct from old.annual_price_kes
     or new.credit_kes is distinct from old.credit_kes
     or new.spend_limit_share_percent is distinct from old.spend_limit_share_percent
     or (to_jsonb(new) -> 'extra_seat_monthly_kes') is distinct from (to_jsonb(old) -> 'extra_seat_monthly_kes')
     or new.trial_days is distinct from old.trial_days
     or new.allowances_placeholder is distinct from old.allowances_placeholder
     or new.active_from is distinct from old.active_from
     or new.published_at is distinct from old.published_at
     or new.created_at is distinct from old.created_at
     or new.copied_from_id is distinct from old.copied_from_id
     or new.promote_fingerprint is distinct from old.promote_fingerprint
     or new.notes is distinct from old.notes
     or new.price_set_by is distinct from old.price_set_by
     or new.message_credits is distinct from old.message_credits
     or new.sms_credit_burn is distinct from old.sms_credit_burn
     or new.whatsapp_credit_burn is distinct from old.whatsapp_credit_burn
     or new.email_credit_burn is distinct from old.email_credit_burn
     or new.on_demand_allowed is distinct from old.on_demand_allowed
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

-- Published feature rows stay put. An identical re-insert (the data layer seed)
-- is allowed so that file can still be re-run.
create or replace function public.billing_package_version_features_freeze()
returns trigger
language plpgsql
as $$
declare
  v_status text;
  v_version uuid;
begin
  v_version := case when tg_op = 'DELETE' then old.package_version_id else new.package_version_id end;
  select status into v_status
  from public.billing_package_versions
  where id = v_version;
  if v_status is null or v_status = 'draft' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' and exists (
    select 1
    from public.billing_package_version_features f
    where f.package_version_id = new.package_version_id
      and f.feature_key = new.feature_key
      and f.enabled = new.enabled
  ) then
    return new;
  end if;
  raise exception 'published package version is frozen';
end;
$$;

drop trigger if exists billing_package_version_features_freeze on public.billing_package_version_features;
create trigger billing_package_version_features_freeze
  before insert or update or delete on public.billing_package_version_features
  for each row execute function public.billing_package_version_features_freeze();

-- Explicit move flag. Billing status changes still go through the transition RPC.
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
     and current_setting('scalers.billing_version_move', true) is distinct from '1'
  then
    raise exception 'package version is pinned';
  end if;
  return new;
end;
$$;

-- A new row pins the latest published version of its package. An existing row
-- does not. Changing its package keeps the same version number on the new
-- package, so a business already on version 1 cannot land on a later price.
-- A direct or system version change on a beta business (status beta, or
-- enforcement off) is refused. An explicit admin move sets
-- scalers.billing_admin_move and is allowed. It does not change beta or
-- enforcement.
create or replace function public.tenant_subscriptions_b_pin_version()
returns trigger
language plpgsql
as $$
declare
  v_version uuid;
  v_generation integer;
  v_enforcement text;
begin
  if new.billing_status is null then
    new.billing_status := 'beta';
  end if;
  if current_setting('scalers.billing_admin_move', true) = '1' then
    return new;
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
  if new.package_id is distinct from old.package_id then
    select v.version into v_generation
    from public.billing_package_versions v
    where v.id = old.package_version_id;
    select v.id into v_version
    from public.billing_package_versions v
    where v.package_id = new.package_id
      and v.version = v_generation
      and v.status = 'published';
    if v_version is null then
      raise exception 'a package change keeps the current version; this package has no published version at that generation';
    end if;
    new.package_version_id := v_version;
    return new;
  end if;
  if new.package_version_id is distinct from old.package_version_id then
    select coalesce(t.billing_enforcement, 'off') into v_enforcement
    from public.tenants t
    where t.id = new.tenant_id;
    if new.billing_status = 'beta' or v_enforcement = 'off' then
      raise exception 'a beta business is not moved onto a package version';
    end if;
  end if;
  return new;
end;
$$;

comment on column public.tenant_subscriptions.package_version_id is
  'Pinned on insert to the latest published version. An existing row keeps that version unless an admin confirms a move. A package change keeps the same version number. A system move skips a beta business.';

-- ---------------------------------------------------------------------------
-- 2. Second-admin approvals. Append-only.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_package_version_approvals (
  id uuid primary key default gen_random_uuid(),
  package_version_id uuid not null references public.billing_package_versions (id) on delete cascade,
  requested_by text not null,
  approver text,
  status text not null check (status in ('pending', 'approved', 'rejected')),
  reason text not null,
  price_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists billing_package_version_approvals_version_idx
  on public.billing_package_version_approvals (package_version_id, created_at);

comment on table public.billing_package_version_approvals is
  'Second admin on a draft whose price moved past the threshold. Insert only. A matching approved row lets the other admin publish.';

-- Updates never. A delete is only the cascade when the draft itself is discarded.
create or replace function public.billing_package_version_approvals_freeze()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'package version approval is append-only';
  end if;
  if exists (
    select 1
    from public.billing_package_versions v
    where v.id = old.package_version_id
      and v.status <> 'draft'
  ) then
    raise exception 'package version approval is append-only';
  end if;
  return old;
end;
$$;

drop trigger if exists billing_package_version_approvals_no_update on public.billing_package_version_approvals;
create trigger billing_package_version_approvals_no_update
  before update or delete on public.billing_package_version_approvals
  for each row execute function public.billing_package_version_approvals_freeze();

-- ---------------------------------------------------------------------------
-- 3. Shared checks.
-- ---------------------------------------------------------------------------
create or replace function public._package_editor_actor(p_actor text, p_reason text)
returns void
language plpgsql
as $$
begin
  if nullif(btrim(coalesce(p_actor, '')), '') is null or length(btrim(p_actor)) > 80 then
    raise exception 'say who is making this change';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null or length(btrim(p_reason)) > 500 then
    raise exception 'a reason is required';
  end if;
end;
$$;

create or replace function public._package_editor_open()
returns void
language plpgsql
as $$
begin
  if not coalesce(
    (select package_editor_enabled from public.billing_lifecycle_settings where id = 1),
    false
  ) then
    raise exception 'package editor is off on this database';
  end if;
end;
$$;

create or replace function public._package_editor_count(p_patch jsonb, p_key text)
returns integer
language plpgsql
immutable
as $$
declare
  v numeric;
begin
  if p_patch is null or p_patch -> p_key is null or jsonb_typeof(p_patch -> p_key) = 'null' then
    raise exception 'package numbers must be zero or more';
  end if;
  if jsonb_typeof(p_patch -> p_key) <> 'number' then
    raise exception 'package numbers must be zero or more';
  end if;
  v := (p_patch ->> p_key)::numeric;
  if v < 0 or v <> trunc(v) or v > 1000000 then
    raise exception 'package numbers must be zero or more';
  end if;
  return v::integer;
end;
$$;

create or replace function public._package_editor_money(p_patch jsonb, p_key text)
returns numeric
language plpgsql
immutable
as $$
declare
  v numeric;
begin
  if p_patch is null or p_patch -> p_key is null or jsonb_typeof(p_patch -> p_key) = 'null' then
    raise exception 'package numbers must be zero or more';
  end if;
  if jsonb_typeof(p_patch -> p_key) <> 'number' then
    raise exception 'package numbers must be zero or more';
  end if;
  v := (p_patch ->> p_key)::numeric;
  if v < 0 or v > 100000000 then
    raise exception 'package numbers must be zero or more';
  end if;
  return v;
end;
$$;

create or replace function public._package_version_sha256(p_text text)
returns text
language plpgsql
stable
as $$
declare
  v_hash text;
begin
  begin
    execute 'select encode(public.digest(convert_to($1, ''utf8''), ''sha256''), ''hex'')'
      into v_hash
      using p_text;
    return v_hash;
  exception when undefined_function then
    execute 'select encode(extensions.digest(convert_to($1, ''utf8''), ''sha256''), ''hex'')'
      into v_hash
      using p_text;
    return v_hash;
  end;
end;
$$;

create or replace function public._package_version_price_snapshot(p_version_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'annual_discount_percent', v.annual_discount_percent,
    'annual_price_kes', v.annual_price_kes,
    'credit_kes', v.credit_kes,
    'email_kes', v.email_kes,
    'extra_seat_monthly_kes', to_jsonb(v) -> 'extra_seat_monthly_kes',
    'inbound_kes_per_second', v.inbound_kes_per_second,
    'monthly_price_kes', v.monthly_price_kes,
    'outbound_kes_per_second', v.outbound_kes_per_second,
    'sms_kes', v.sms_kes,
    'spend_limit_share_percent', v.spend_limit_share_percent,
    'whatsapp_kes', v.whatsapp_kes,
    'sms_credit_burn', v.sms_credit_burn,
    'whatsapp_credit_burn', v.whatsapp_credit_burn,
    'email_credit_burn', v.email_credit_burn
  )
  from public.billing_package_versions v
  where v.id = p_version_id
$$;

create or replace function public._package_version_current_id(p_package_id uuid)
returns uuid
language sql
stable
as $$
  select coalesce(
    public.billing_latest_package_version(p_package_id),
    (
      select v.id
      from public.billing_package_versions v
      where v.package_id = p_package_id
        and v.status = 'published'
      order by v.version desc
      limit 1
    )
  )
$$;

create or replace function public._package_version_needs_approval(p_version_id uuid)
returns boolean
language plpgsql
stable
as $$
declare
  v_draft public.billing_package_versions%rowtype;
  v_current public.billing_package_versions%rowtype;
  v_threshold numeric;
begin
  select * into v_draft from public.billing_package_versions where id = p_version_id;
  if not found or v_draft.status <> 'draft' then
    return false;
  end if;
  select price_change_approval_threshold_kes into v_threshold
  from public.billing_lifecycle_settings
  where id = 1;
  if v_threshold is null then
    return false;
  end if;
  select * into v_current
  from public.billing_package_versions
  where id = public._package_version_current_id(v_draft.package_id);
  if not found then
    return abs(v_draft.monthly_price_kes) > v_threshold;
  end if;
  if abs(v_draft.monthly_price_kes - v_current.monthly_price_kes) > v_threshold then
    return true;
  end if;
  if v_draft.inbound_kes_per_second is distinct from v_current.inbound_kes_per_second
     or v_draft.outbound_kes_per_second is distinct from v_current.outbound_kes_per_second
     or v_draft.whatsapp_kes is distinct from v_current.whatsapp_kes
     or v_draft.sms_kes is distinct from v_current.sms_kes
     or v_draft.email_kes is distinct from v_current.email_kes
     or v_draft.sms_credit_burn is distinct from v_current.sms_credit_burn
     or v_draft.whatsapp_credit_burn is distinct from v_current.whatsapp_credit_burn
     or v_draft.email_credit_burn is distinct from v_current.email_credit_burn
     or v_draft.annual_discount_percent is distinct from v_current.annual_discount_percent
     or v_draft.annual_price_kes is distinct from v_current.annual_price_kes
     or v_draft.credit_kes is distinct from v_current.credit_kes
     or v_draft.spend_limit_share_percent is distinct from v_current.spend_limit_share_percent
     or (to_jsonb(v_draft) -> 'extra_seat_monthly_kes') is distinct from (to_jsonb(v_current) -> 'extra_seat_monthly_kes')
  then
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.package_version_fingerprint(
  p_sku text,
  p_terms jsonb,
  p_features jsonb
)
returns text
language plpgsql
stable
as $$
declare
  v_active timestamptz;
  v_payload jsonb;
  v_trial integer;
begin
  if nullif(btrim(coalesce(p_sku, '')), '') is null then
    raise exception 'package not found';
  end if;
  if p_terms is null or p_terms -> 'active_from' is null or jsonb_typeof(p_terms -> 'active_from') = 'null' then
    raise exception 'active from is required';
  end if;
  v_active := (p_terms ->> 'active_from')::timestamptz;
  if p_terms -> 'trial_days' is null or jsonb_typeof(p_terms -> 'trial_days') = 'null' then
    v_trial := null;
  else
    v_trial := (p_terms ->> 'trial_days')::integer;
  end if;
  v_payload := jsonb_build_object(
    'active_from', to_char(v_active at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'allowances_placeholder', (p_terms ->> 'allowances_placeholder')::boolean,
    'annual_discount_percent', (p_terms ->> 'annual_discount_percent')::numeric,
    'annual_price_kes', case
      when p_terms ? 'annual_price_kes' and jsonb_typeof(p_terms -> 'annual_price_kes') <> 'null'
        then (p_terms ->> 'annual_price_kes')::numeric
      else round(
        (p_terms ->> 'monthly_price_kes')::numeric * 12
        * (1 - (p_terms ->> 'annual_discount_percent')::numeric / 100)
      )
    end,
    'credit_kes', coalesce((p_terms ->> 'credit_kes')::numeric, 1),
    'dids', (p_terms ->> 'dids')::integer,
    'email', (p_terms ->> 'email')::integer,
    'email_credit_burn', (p_terms ->> 'email_credit_burn')::numeric,
    'on_demand_allowed', coalesce((p_terms ->> 'on_demand_allowed')::boolean, true),
    'email_kes', (p_terms ->> 'email_kes')::numeric,
    'features', coalesce((
      select jsonb_agg(jsonb_build_object('enabled', s.enabled, 'key', s.feature_key) order by s.feature_key)
      from (
        select f ->> 'key' as feature_key, (f ->> 'enabled')::boolean as enabled
        from jsonb_array_elements(coalesce(p_features, '[]'::jsonb)) f
      ) s
    ), '[]'::jsonb),
    'inbound_kes_per_second', (p_terms ->> 'inbound_kes_per_second')::numeric,
    'message_credits', case
      when p_terms -> 'message_credits' is null or jsonb_typeof(p_terms -> 'message_credits') = 'null' then null
      else (p_terms ->> 'message_credits')::integer
    end,
    'minutes', (p_terms ->> 'minutes')::integer,
    'monthly_price_kes', (p_terms ->> 'monthly_price_kes')::numeric,
    'outbound_kes_per_second', (p_terms ->> 'outbound_kes_per_second')::numeric,
    'seats', (p_terms ->> 'seats')::integer,
    'sku', p_sku,
    'sms', (p_terms ->> 'sms')::integer,
    'sms_credit_burn', (p_terms ->> 'sms_credit_burn')::numeric,
    'sms_kes', (p_terms ->> 'sms_kes')::numeric,
    'spend_limit_share_percent', coalesce((p_terms ->> 'spend_limit_share_percent')::numeric, 50),
    'staff_wa', (p_terms ->> 'staff_wa')::integer,
    'trial_days', v_trial,
    'whatsapp_credit_burn', (p_terms ->> 'whatsapp_credit_burn')::numeric,
    'whatsapp_kes', (p_terms ->> 'whatsapp_kes')::numeric
  );
  if p_terms ? 'extra_seat_monthly_kes' then
    v_payload := v_payload || jsonb_build_object(
      'extra_seat_monthly_kes', p_terms -> 'extra_seat_monthly_kes'
    );
  end if;
  return public._package_version_sha256(v_payload::text);
end;
$$;

create or replace function public._package_version_json(p_version_id uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', v.id,
    'package_id', v.package_id,
    'sku', p.sku,
    'name', p.name,
    'version', v.version,
    'status', v.status,
    'monthly_price_kes', v.monthly_price_kes,
    'annual_price_kes', v.annual_price_kes,
    'seats', v.seats,
    'minutes', v.minutes,
    'message_credits', v.message_credits,
    'sms_credit_burn', v.sms_credit_burn,
    'whatsapp_credit_burn', v.whatsapp_credit_burn,
    'email_credit_burn', v.email_credit_burn,
    'on_demand_allowed', v.on_demand_allowed,
    'sms', v.sms,
    'email', v.email,
    'staff_wa', v.staff_wa,
    'dids', v.dids,
    'inbound_kes_per_second', v.inbound_kes_per_second,
    'outbound_kes_per_second', v.outbound_kes_per_second,
    'whatsapp_kes', v.whatsapp_kes,
    'sms_kes', v.sms_kes,
    'email_kes', v.email_kes,
    'annual_discount_percent', v.annual_discount_percent,
    'credit_kes', v.credit_kes,
    'spend_limit_share_percent', v.spend_limit_share_percent,
    'extra_seat_monthly_kes', to_jsonb(v) -> 'extra_seat_monthly_kes',
    'trial_days', v.trial_days,
    'allowances_placeholder', v.allowances_placeholder,
    'active_from', v.active_from,
    'published_at', v.published_at,
    'retired_at', v.retired_at,
    'copied_from_id', v.copied_from_id,
    'promote_fingerprint', v.promote_fingerprint,
    'notes', v.notes,
    'price_set_by', v.price_set_by,
    'subscriber_count', (
      select count(*)::integer
      from public.tenant_subscriptions s
      where s.package_version_id = v.id
    ),
    'features', coalesce((
      select jsonb_agg(
        jsonb_build_object('key', f.feature_key, 'label', cat.label, 'enabled', f.enabled)
        order by f.feature_key
      )
      from public.billing_package_version_features f
      join public.billing_features cat on cat.key = f.feature_key
      where f.package_version_id = v.id
    ), '[]'::jsonb),
    'approval', (
      select jsonb_build_object(
        'status', a.status,
        'requested_by', a.requested_by,
        'approver', a.approver,
        'created_at', a.created_at
      )
      from public.billing_package_version_approvals a
      where a.package_version_id = v.id
        and a.price_snapshot = public._package_version_price_snapshot(v.id)
      order by a.created_at desc
      limit 1
    ),
    'needs_approval', public._package_version_needs_approval(v.id)
  )
  from public.billing_package_versions v
  join public.billing_packages p on p.id = v.package_id
  where v.id = p_version_id
$$;

create or replace function public.admin_list_package_versions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'price_change_approval_threshold_kes', s.price_change_approval_threshold_kes,
    'package_editor_enabled', s.package_editor_enabled,
    'new_signup_trial_enabled', s.new_signup_trial_enabled,
    'extra_seat_supported', public._package_version_has_column('extra_seat_monthly_kes'),
    'features', coalesce((
      select jsonb_agg(jsonb_build_object('key', f.key, 'label', f.label) order by f.key)
      from public.billing_features f
    ), '[]'::jsonb),
    'packages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'sku', p.sku,
          'name', p.name,
          'is_active', p.is_active,
          'versions', coalesce((
            select jsonb_agg(public._package_version_json(v.id) order by v.version)
            from public.billing_package_versions v
            where v.package_id = p.id
          ), '[]'::jsonb)
        )
        order by p.sort_order, p.sku
      )
      from public.billing_packages p
    ), '[]'::jsonb)
  )
  from public.billing_lifecycle_settings s
  where s.id = 1
$$;

-- ---------------------------------------------------------------------------
-- 4. Draft, edit, publish, archive.
-- ---------------------------------------------------------------------------
create or replace function public.admin_draft_package_version(
  p_sku text,
  p_actor text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_package public.billing_packages%rowtype;
  v_source public.billing_package_versions%rowtype;
  v_id uuid;
  v_next integer;
begin
  perform public._package_editor_open();
  perform public._package_editor_actor(p_actor, p_reason);
  select * into v_package from public.billing_packages where sku = btrim(p_sku);
  if not found then
    raise exception 'package not found';
  end if;
  if exists (
    select 1 from public.billing_package_versions
    where package_id = v_package.id and status = 'draft'
  ) then
    raise exception 'a draft already exists';
  end if;
  select * into v_source
  from public.billing_package_versions
  where id = public._package_version_current_id(v_package.id);
  if not found then
    raise exception 'no published package version for this package';
  end if;
  select coalesce(max(version), 0) + 1 into v_next
  from public.billing_package_versions
  where package_id = v_package.id;
  insert into public.billing_package_versions (
    package_id, version, status, monthly_price_kes, seats, minutes, sms, email, staff_wa, dids,
    inbound_kes_per_second, outbound_kes_per_second, whatsapp_kes, sms_kes, email_kes,
    annual_discount_percent, annual_price_kes, credit_kes, spend_limit_share_percent,
    trial_days, allowances_placeholder, active_from,
    copied_from_id, notes, price_set_by,
    message_credits, sms_credit_burn, whatsapp_credit_burn, email_credit_burn,
    on_demand_allowed
  ) values (
    v_package.id, v_next, 'draft',
    v_source.monthly_price_kes, v_source.seats, v_source.minutes, v_source.sms, v_source.email,
    v_source.staff_wa, v_source.dids,
    v_source.inbound_kes_per_second, v_source.outbound_kes_per_second, v_source.whatsapp_kes,
    v_source.sms_kes, v_source.email_kes, v_source.annual_discount_percent,
    v_source.annual_price_kes, v_source.credit_kes, v_source.spend_limit_share_percent,
    v_source.trial_days, v_source.allowances_placeholder, v_source.active_from,
    v_source.id, null, null,
    v_source.message_credits, v_source.sms_credit_burn, v_source.whatsapp_credit_burn, v_source.email_credit_burn,
    v_source.on_demand_allowed
  )
  returning id into v_id;
  perform public._package_version_copy_extra_seat(v_id, v_source.id);
  insert into public.billing_package_version_features (package_version_id, feature_key, enabled)
  select v_id, f.feature_key, f.enabled
  from public.billing_package_version_features f
  where f.package_version_id = v_source.id;
  perform public._billing_audit(
    btrim(p_actor),
    'draft_package_version',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'package_sku', v_package.sku,
      'version', v_next,
      'version_id', v_id,
      'copied_from_id', v_source.id,
      'before', public._package_version_json(v_source.id),
      'after', public._package_version_json(v_id)
    )
  );
  return jsonb_build_object('version_id', v_id, 'version', public._package_version_json(v_id));
end;
$$;

create or replace function public._package_editor_apply_features(
  p_version_id uuid,
  p_features jsonb
)
returns void
language plpgsql
as $$
declare
  v_item jsonb;
  v_key text;
  v_seen text[] := '{}';
  v_catalog integer;
begin
  if p_features is null or jsonb_typeof(p_features) <> 'array' then
    raise exception 'features are required';
  end if;
  select count(*) into v_catalog from public.billing_features;
  if jsonb_array_length(p_features) <> v_catalog then
    raise exception 'every feature is required';
  end if;
  for v_item in select value from jsonb_array_elements(p_features)
  loop
    v_key := v_item ->> 'key';
    if v_key is null or not exists (select 1 from public.billing_features where key = v_key) then
      raise exception 'unknown feature';
    end if;
    if v_key = any (v_seen) then
      raise exception 'feature listed twice';
    end if;
    if v_item -> 'enabled' is null or jsonb_typeof(v_item -> 'enabled') <> 'boolean' then
      raise exception 'features are required';
    end if;
    v_seen := array_append(v_seen, v_key);
  end loop;
  if coalesce(array_length(v_seen, 1), 0) <> v_catalog then
    raise exception 'every feature is required';
  end if;
  delete from public.billing_package_version_features where package_version_id = p_version_id;
  insert into public.billing_package_version_features (package_version_id, feature_key, enabled)
  select p_version_id, f ->> 'key', (f ->> 'enabled')::boolean
  from jsonb_array_elements(p_features) f;
end;
$$;

create or replace function public.admin_update_package_version_draft(
  p_version_id uuid,
  p_patch jsonb,
  p_actor text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.billing_package_versions%rowtype;
  v_sku text;
  v_before jsonb;
  v_monthly numeric;
  v_seats integer;
  v_minutes integer;
  v_message_credits integer;
  v_sms_burn integer;
  v_whatsapp_burn integer;
  v_email_burn integer;
  v_on_demand boolean;
  v_dids integer;
  v_inbound numeric;
  v_outbound numeric;
  v_annual numeric;
  v_discount numeric;
  v_credit numeric;
  v_share numeric;
  v_trial integer;
  v_placeholder boolean;
  v_notes text;
  v_price_set_by text;
  v_price_changed boolean;
  v_extra_changed boolean;
begin
  perform public._package_editor_open();
  perform public._package_editor_actor(p_actor, p_reason);
  select * into v_old from public.billing_package_versions where id = p_version_id;
  if not found or v_old.status <> 'draft' then
    raise exception 'this package version is not a draft';
  end if;
  select sku into v_sku from public.billing_packages where id = v_old.package_id;
  v_before := public._package_version_json(p_version_id);
  v_monthly := public._package_editor_money(p_patch, 'monthly_price_kes');
  v_seats := public._package_editor_count(p_patch, 'seats');
  v_minutes := public._package_editor_count(p_patch, 'minutes');
  v_message_credits := public._package_editor_count(p_patch, 'message_credits');
  v_sms_burn := public._package_editor_count(p_patch, 'sms_credit_burn');
  v_whatsapp_burn := public._package_editor_count(p_patch, 'whatsapp_credit_burn');
  v_email_burn := public._package_editor_count(p_patch, 'email_credit_burn');
  v_dids := public._package_editor_count(p_patch, 'dids');
  v_inbound := public._package_editor_money(p_patch, 'inbound_kes_per_second');
  v_outbound := public._package_editor_money(p_patch, 'outbound_kes_per_second');
  v_annual := public._package_editor_money(p_patch, 'annual_price_kes');
  v_discount := public._package_annual_discount(v_monthly, v_annual);
  v_credit := public._package_editor_money(p_patch, 'credit_kes');
  v_share := public._package_editor_money(p_patch, 'spend_limit_share_percent');
  if v_share > 100 then
    raise exception 'spend limit must be 0 to 100';
  end if;
  if p_patch -> 'trial_days' is null then
    raise exception 'trial length is required';
  end if;
  if jsonb_typeof(p_patch -> 'trial_days') = 'null' then
    v_trial := null;
  else
    v_trial := public._package_editor_count(p_patch, 'trial_days');
  end if;
  if v_sku = 'trial' then
    if v_trial is null or v_trial < 1 or v_trial > 90 then
      raise exception 'trial length must be 1 to 90 days';
    end if;
  elsif v_trial is not null then
    raise exception 'only a trial version has a trial length';
  end if;
  if p_patch -> 'allowances_placeholder' is null
     or jsonb_typeof(p_patch -> 'allowances_placeholder') <> 'boolean'
  then
    raise exception 'allowances placeholder is required';
  end if;
  v_placeholder := (p_patch ->> 'allowances_placeholder')::boolean;
  if p_patch -> 'on_demand_allowed' is null
     or jsonb_typeof(p_patch -> 'on_demand_allowed') <> 'boolean'
  then
    raise exception 'on-demand setting is required';
  end if;
  v_on_demand := (p_patch ->> 'on_demand_allowed')::boolean;
  if p_patch ? 'notes' and jsonb_typeof(p_patch -> 'notes') <> 'null' then
    v_notes := nullif(btrim(p_patch ->> 'notes'), '');
    if v_notes is not null and length(v_notes) > 500 then
      raise exception 'notes must be 500 characters or less';
    end if;
  else
    v_notes := v_old.notes;
  end if;
  perform public._package_editor_apply_features(p_version_id, p_patch -> 'features');
  v_extra_changed := public._package_version_apply_extra_seat(p_version_id, p_patch);
  v_price_changed :=
    v_monthly is distinct from v_old.monthly_price_kes
    or v_inbound is distinct from v_old.inbound_kes_per_second
    or v_outbound is distinct from v_old.outbound_kes_per_second
    or v_sms_burn is distinct from v_old.sms_credit_burn
    or v_whatsapp_burn is distinct from v_old.whatsapp_credit_burn
    or v_email_burn is distinct from v_old.email_credit_burn
    or v_annual is distinct from v_old.annual_price_kes
    or v_discount is distinct from v_old.annual_discount_percent
    or v_credit is distinct from v_old.credit_kes
    or v_share is distinct from v_old.spend_limit_share_percent
    or v_extra_changed;
  if v_price_changed then
    v_price_set_by := btrim(p_actor);
  else
    v_price_set_by := v_old.price_set_by;
  end if;
  update public.billing_package_versions
  set
    monthly_price_kes = v_monthly,
    seats = v_seats,
    minutes = v_minutes,
    message_credits = v_message_credits,
    sms_credit_burn = v_sms_burn,
    whatsapp_credit_burn = v_whatsapp_burn,
    email_credit_burn = v_email_burn,
    dids = v_dids,
    inbound_kes_per_second = v_inbound,
    outbound_kes_per_second = v_outbound,
    whatsapp_kes = v_whatsapp_burn,
    sms_kes = v_sms_burn,
    email_kes = v_email_burn,
    annual_price_kes = v_annual,
    annual_discount_percent = v_discount,
    credit_kes = v_credit,
    spend_limit_share_percent = v_share,
    trial_days = v_trial,
    allowances_placeholder = v_placeholder,
    on_demand_allowed = v_on_demand,
    notes = v_notes,
    price_set_by = v_price_set_by
  where id = p_version_id;
  perform public._billing_audit(
    btrim(p_actor),
    'update_package_version_draft',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'package_sku', v_sku,
      'version', v_old.version,
      'version_id', p_version_id,
      'before', v_before,
      'after', public._package_version_json(p_version_id)
    )
  );
  return jsonb_build_object('version_id', p_version_id, 'version', public._package_version_json(p_version_id));
end;
$$;

create or replace function public.admin_approve_package_version(
  p_version_id uuid,
  p_actor text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.billing_package_versions%rowtype;
  v_sku text;
  v_snapshot jsonb;
begin
  perform public._package_editor_open();
  perform public._package_editor_actor(p_actor, p_reason);
  select * into v_row from public.billing_package_versions where id = p_version_id;
  if not found or v_row.status <> 'draft' then
    raise exception 'this package version is not a draft';
  end if;
  if not public._package_version_needs_approval(p_version_id) then
    raise exception 'this draft does not need a second admin';
  end if;
  if v_row.price_set_by is not null
     and lower(btrim(p_actor)) = lower(btrim(v_row.price_set_by))
  then
    raise exception 'you cannot approve your own price change';
  end if;
  select sku into v_sku from public.billing_packages where id = v_row.package_id;
  v_snapshot := public._package_version_price_snapshot(p_version_id);
  insert into public.billing_package_version_approvals (
    package_version_id, requested_by, approver, status, reason, price_snapshot
  ) values (
    p_version_id,
    coalesce(v_row.price_set_by, btrim(p_actor)),
    btrim(p_actor),
    'approved',
    btrim(p_reason),
    v_snapshot
  );
  perform public._billing_audit(
    btrim(p_actor),
    'approve_package_version',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'package_sku', v_sku,
      'version', v_row.version,
      'version_id', p_version_id,
      'requested_by', v_row.price_set_by,
      'approver', btrim(p_actor),
      'price_snapshot', v_snapshot
    )
  );
  return jsonb_build_object('version_id', p_version_id, 'version', public._package_version_json(p_version_id));
end;
$$;

create or replace function public.admin_publish_package_version(
  p_version_id uuid,
  p_active_from timestamptz,
  p_actor text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.billing_package_versions%rowtype;
  v_sku text;
  v_before jsonb;
  v_snapshot jsonb;
  v_staying integer;
begin
  if current_setting('scalers.package_version_promote', true) is distinct from '1' then
    perform public._package_editor_open();
  end if;
  perform public._package_editor_actor(p_actor, p_reason);
  if p_active_from is null then
    raise exception 'active from is required';
  end if;
  select * into v_row from public.billing_package_versions where id = p_version_id for update;
  if not found or v_row.status <> 'draft' then
    raise exception 'this package version is not a draft';
  end if;
  if current_setting('scalers.package_version_promote', true) is distinct from '1'
     and v_row.message_credits is null
  then
    raise exception 'message credits are required';
  end if;
  select sku into v_sku from public.billing_packages where id = v_row.package_id;
  v_before := public._package_version_json(p_version_id);
  if current_setting('scalers.package_version_promote', true) is distinct from '1'
     and public._package_version_needs_approval(p_version_id)
  then
    v_snapshot := public._package_version_price_snapshot(p_version_id);
    if not exists (
      select 1
      from public.billing_package_version_approvals a
      where a.package_version_id = p_version_id
        and a.status = 'approved'
        and a.price_snapshot = v_snapshot
        and lower(a.approver) <> lower(btrim(p_actor))
        and (
          v_row.price_set_by is null
          or lower(a.approver) <> lower(btrim(v_row.price_set_by))
        )
    ) then
      raise exception 'price change needs a second admin';
    end if;
  end if;
  update public.billing_package_versions
  set status = 'published', published_at = now(), active_from = p_active_from
  where id = p_version_id;
  select count(*) into v_staying
  from public.tenant_subscriptions s
  where s.package_id = v_row.package_id
    and s.package_version_id is distinct from p_version_id;
  perform public._billing_audit(
    btrim(p_actor),
    'publish_package_version',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'package_sku', v_sku,
      'version', v_row.version,
      'version_id', p_version_id,
      'active_from', p_active_from,
      'subscribers_staying', v_staying,
      'before', v_before,
      'after', public._package_version_json(p_version_id)
    )
  );
  return jsonb_build_object(
    'version_id', p_version_id,
    'subscribers_staying', v_staying,
    'version', public._package_version_json(p_version_id)
  );
end;
$$;

create or replace function public.admin_archive_package_version(
  p_version_id uuid,
  p_actor text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.billing_package_versions%rowtype;
  v_sku text;
  v_before jsonb;
  v_published integer;
begin
  perform public._package_editor_open();
  perform public._package_editor_actor(p_actor, p_reason);
  select * into v_row from public.billing_package_versions where id = p_version_id for update;
  if not found or v_row.status <> 'published' then
    raise exception 'only a published version can be archived';
  end if;
  select count(*) into v_published
  from public.billing_package_versions
  where package_id = v_row.package_id and status = 'published';
  if v_published < 2 then
    raise exception 'cannot archive the only published version';
  end if;
  select sku into v_sku from public.billing_packages where id = v_row.package_id;
  v_before := public._package_version_json(p_version_id);
  update public.billing_package_versions
  set status = 'retired', retired_at = now()
  where id = p_version_id;
  perform public._billing_audit(
    btrim(p_actor),
    'archive_package_version',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'package_sku', v_sku,
      'version', v_row.version,
      'version_id', p_version_id,
      'before', v_before,
      'after', public._package_version_json(p_version_id)
    )
  );
  return jsonb_build_object('version_id', p_version_id, 'version', public._package_version_json(p_version_id));
end;
$$;

create or replace function public.admin_discard_package_version_draft(
  p_version_id uuid,
  p_actor text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.billing_package_versions%rowtype;
  v_sku text;
  v_before jsonb;
  v_pins integer;
begin
  perform public._package_editor_open();
  perform public._package_editor_actor(p_actor, p_reason);
  select * into v_row from public.billing_package_versions where id = p_version_id;
  if not found or v_row.status <> 'draft' then
    raise exception 'this package version is not a draft';
  end if;
  select count(*) into v_pins
  from public.tenant_subscriptions
  where package_version_id = p_version_id;
  if v_pins > 0 then
    raise exception 'a business is still on this version';
  end if;
  select sku into v_sku from public.billing_packages where id = v_row.package_id;
  v_before := public._package_version_json(p_version_id);
  perform public._billing_audit(
    btrim(p_actor),
    'discard_package_version_draft',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'package_sku', v_sku,
      'version', v_row.version,
      'version_id', p_version_id,
      'before', v_before
    )
  );
  delete from public.billing_package_versions where id = p_version_id and status = 'draft';
  return jsonb_build_object('version_id', p_version_id, 'discarded', true);
end;
$$;

-- Applies one confirmed move. Caller has already decided this tenant is eligible.
-- Sets the plan and the version, and copies minutes (and seats when that column
-- exists) from the version. billing_status and billing_enforcement stay as they were.
create or replace function public._apply_package_version_move(
  p_version public.billing_package_versions,
  p_tenant uuid,
  p_actor text,
  p_reason text,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub public.tenant_subscriptions%rowtype;
  v_from_sku text;
  v_from_version integer;
  v_to_sku text;
  v_status_before text;
  v_status_after text;
  v_enf_before text;
  v_enf_after text;
  v_minutes_before integer;
  v_minutes_after integer;
begin
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'business not found';
  end if;
  v_sub := null;
  select * into v_sub from public.tenant_subscriptions where tenant_id = p_tenant for update;
  select sku into v_to_sku from public.billing_packages where id = p_version.package_id;
  select minutes_included, billing_enforcement
    into v_minutes_before, v_enf_before
  from public.tenants where id = p_tenant;
  if v_sub.tenant_id is not null then
    v_status_before := v_sub.billing_status;
    select p.sku, v.version into v_from_sku, v_from_version
    from public.billing_packages p
    join public.billing_package_versions v on v.id = v_sub.package_version_id
    where p.id = v_sub.package_id;
  end if;

  perform set_config('scalers.billing_admin_move', '1', true);
  perform set_config('scalers.billing_version_move', '1', true);
  perform set_config('scalers.wallet_write', '1', true);
  if v_sub.tenant_id is null then
    insert into public.tenant_subscriptions (
      tenant_id, package_id, package_version_id, status, billing_status
    ) values (
      p_tenant, p_version.package_id, p_version.id, 'active', 'beta'
    );
    v_status_before := null;
  else
    update public.tenant_subscriptions
    set
      package_id = p_version.package_id,
      package_version_id = p_version.id,
      updated_at = now()
    where tenant_id = p_tenant;
  end if;
  update public.tenants
  set minutes_included = p_version.minutes
  where id = p_tenant;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tenants' and column_name = 'seat_included'
  ) then
    execute 'update public.tenants set seat_included = $1 where id = $2'
      using p_version.seats, p_tenant;
  end if;

  select billing_status into v_status_after
  from public.tenant_subscriptions where tenant_id = p_tenant;
  select minutes_included, billing_enforcement
    into v_minutes_after, v_enf_after
  from public.tenants where id = p_tenant;
  if v_sub.tenant_id is not null and (
       v_status_after is distinct from v_status_before
       or v_enf_after is distinct from v_enf_before
     )
  then
    raise exception 'a version move must not change billing status or enforcement';
  end if;
  if v_enf_after is distinct from v_enf_before then
    raise exception 'a version move must not change billing status or enforcement';
  end if;

  perform public._billing_audit(
    btrim(p_actor),
    'move_package_version',
    p_tenant,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'source', p_source,
      'confirm', p_source = 'admin',
      'from_version_id', v_sub.package_version_id,
      'from_version', v_from_version,
      'from_sku', v_from_sku,
      'to_version_id', p_version.id,
      'to_version', p_version.version,
      'to_sku', v_to_sku,
      'billing_status_before', v_status_before,
      'billing_status_after', v_status_after,
      'billing_enforcement_before', v_enf_before,
      'billing_enforcement_after', v_enf_after,
      'minutes_before', v_minutes_before,
      'minutes_after', v_minutes_after,
      'moved_at', now()
    )
  );
end;
$$;

drop function if exists public.admin_move_subscribers_to_package_version(uuid, uuid[], text, text);

create or replace function public.admin_move_subscribers_to_package_version(
  p_version_id uuid,
  p_tenant_ids uuid[],
  p_actor text,
  p_reason text,
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.billing_package_versions%rowtype;
  v_tenant uuid;
  v_moved integer := 0;
  v_invoices integer;
begin
  perform public._package_editor_open();
  perform public._package_editor_actor(p_actor, p_reason);
  if p_confirm is distinct from true then
    raise exception 'confirm the move';
  end if;
  if p_tenant_ids is null or coalesce(array_length(p_tenant_ids, 1), 0) < 1 then
    raise exception 'choose at least one business';
  end if;
  if array_length(p_tenant_ids, 1) > 200 then
    raise exception 'too many businesses in one move';
  end if;
  select * into v_version from public.billing_package_versions where id = p_version_id;
  if not found or v_version.status <> 'published' then
    raise exception 'move businesses onto a published version';
  end if;
  select count(*) into v_invoices from public.invoices;
  foreach v_tenant in array p_tenant_ids
  loop
    perform public._apply_package_version_move(v_version, v_tenant, p_actor, p_reason, 'admin');
    v_moved := v_moved + 1;
  end loop;
  if (select count(*) from public.invoices) is distinct from v_invoices then
    raise exception 'a version move must not create an invoice';
  end if;
  perform set_config('scalers.billing_admin_move', '0', true);
  perform set_config('scalers.billing_version_move', '0', true);
  perform set_config('scalers.wallet_write', '0', true);
  return jsonb_build_object(
    'version_id', p_version_id,
    'moved', v_moved,
    'version', public._package_version_json(p_version_id)
  );
end;
$$;

-- Renewals, trial expiry, and other jobs call this. A beta business, or one
-- with billing enforcement off, is left where it is and the skip is audited.
-- It never turns enforcement on.
create or replace function public.system_move_subscribers_to_package_version(
  p_version_id uuid,
  p_tenant_ids uuid[],
  p_actor text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.billing_package_versions%rowtype;
  v_tenant uuid;
  v_sub public.tenant_subscriptions%rowtype;
  v_status text;
  v_enforcement text;
  v_from_sku text;
  v_from_version integer;
  v_to_sku text;
  v_moved integer := 0;
  v_skipped integer := 0;
  v_invoices integer;
begin
  if p_tenant_ids is null or coalesce(array_length(p_tenant_ids, 1), 0) < 1 then
    raise exception 'choose at least one business';
  end if;
  select * into v_version from public.billing_package_versions where id = p_version_id;
  if not found or v_version.status <> 'published' then
    raise exception 'move businesses onto a published version';
  end if;
  select sku into v_to_sku from public.billing_packages where id = v_version.package_id;
  select count(*) into v_invoices from public.invoices;
  foreach v_tenant in array p_tenant_ids
  loop
    if not exists (select 1 from public.tenants where id = v_tenant) then
      raise exception 'business not found';
    end if;
    v_sub := null;
    select * into v_sub from public.tenant_subscriptions where tenant_id = v_tenant;
    select billing_enforcement into v_enforcement from public.tenants where id = v_tenant;
    v_status := v_sub.billing_status;
    if v_sub.tenant_id is null
       or v_status = 'beta'
       or coalesce(v_enforcement, 'off') = 'off'
    then
      select p.sku, v.version into v_from_sku, v_from_version
      from public.billing_packages p
      join public.billing_package_versions v on v.id = v_sub.package_version_id
      where p.id = v_sub.package_id;
      perform public._billing_audit(
        coalesce(nullif(btrim(p_actor), ''), 'system'),
        'skip_package_version',
        v_tenant,
        jsonb_build_object(
          'reason', btrim(coalesce(p_reason, '')),
          'source', 'system',
          'skipped', case
            when v_sub.tenant_id is null then 'no subscription'
            when v_status = 'beta' then 'beta'
            else 'enforcement off'
          end,
          'from_version_id', v_sub.package_version_id,
          'from_version', v_from_version,
          'from_sku', v_from_sku,
          'to_version_id', v_version.id,
          'to_version', v_version.version,
          'to_sku', v_to_sku,
          'billing_status_before', v_status,
          'billing_status_after', v_status,
          'billing_enforcement_before', v_enforcement,
          'billing_enforcement_after', v_enforcement,
          'moved_at', now()
        )
      );
      v_skipped := v_skipped + 1;
    else
      perform public._apply_package_version_move(
        v_version, v_tenant, coalesce(nullif(btrim(p_actor), ''), 'system'), p_reason, 'system'
      );
      v_moved := v_moved + 1;
    end if;
  end loop;
  if (select count(*) from public.invoices) is distinct from v_invoices then
    raise exception 'a version move must not create an invoice';
  end if;
  perform set_config('scalers.billing_admin_move', '0', true);
  perform set_config('scalers.billing_version_move', '0', true);
  perform set_config('scalers.wallet_write', '0', true);
  return jsonb_build_object('version_id', p_version_id, 'moved', v_moved, 'skipped', v_skipped);
end;
$$;

-- Beta and billing enforcement are separate from the plan. This is the only
-- writer that turns enforcement on, and only when an admin confirms.
create or replace function public.admin_set_tenant_billing_mode(
  p_tenant_id uuid,
  p_billing_status text,
  p_enforcement text,
  p_actor text,
  p_reason text,
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before_status text;
  v_after_status text;
  v_before_enf text;
  v_after_enf text;
  v_version uuid;
  v_minutes integer;
  v_invoices integer;
begin
  perform public._package_editor_open();
  perform public._package_editor_actor(p_actor, p_reason);
  if p_confirm is distinct from true then
    raise exception 'confirm the billing change';
  end if;
  if p_billing_status not in ('beta', 'active') then
    raise exception 'billing status must be beta or active';
  end if;
  if p_enforcement not in ('off', 'soft', 'hard') then
    raise exception 'billing enforcement must be off, soft, or hard';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'business not found';
  end if;
  select billing_status, package_version_id into v_before_status, v_version
  from public.tenant_subscriptions where tenant_id = p_tenant_id for update;
  if v_before_status is null then
    raise exception 'business not found';
  end if;
  if v_before_status not in ('beta', 'active') and v_before_status is distinct from p_billing_status then
    raise exception 'billing status is not beta or active';
  end if;
  if p_billing_status = 'active' and p_enforcement = 'off' and v_before_status = 'beta' then
    raise exception 'set billing mode before active';
  end if;
  select billing_enforcement, minutes_included into v_before_enf, v_minutes
  from public.tenants where id = p_tenant_id;
  select count(*) into v_invoices from public.invoices;

  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants
  set billing_enforcement = p_enforcement
  where id = p_tenant_id;

  if v_before_status is distinct from p_billing_status then
    perform set_config('scalers.billing_transition', '1', true);
    update public.tenant_subscriptions
    set billing_status = p_billing_status, billing_status_changed_at = now()
    where tenant_id = p_tenant_id;
  end if;

  select billing_status into v_after_status
  from public.tenant_subscriptions where tenant_id = p_tenant_id;
  select billing_enforcement into v_after_enf from public.tenants where id = p_tenant_id;
  if (select package_version_id from public.tenant_subscriptions where tenant_id = p_tenant_id) is distinct from v_version
     or (select minutes_included from public.tenants where id = p_tenant_id) is distinct from v_minutes
     or (select count(*) from public.invoices) is distinct from v_invoices
  then
    raise exception 'a billing change must not change the plan';
  end if;
  perform public._billing_audit(
    btrim(p_actor),
    'set_tenant_billing_mode',
    p_tenant_id,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'confirm', true,
      'billing_status_before', v_before_status,
      'billing_status_after', v_after_status,
      'billing_enforcement_before', v_before_enf,
      'billing_enforcement_after', v_after_enf,
      'package_version_id', v_version,
      'changed_at', now()
    )
  );
  perform set_config('scalers.wallet_write', '0', true);
  perform set_config('scalers.billing_transition', '0', true);
  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'billing_status', v_after_status,
    'billing_enforcement', v_after_enf
  );
end;
$$;

create or replace function public.admin_set_new_signup_trial(
  p_enabled boolean,
  p_actor text,
  p_reason text,
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before boolean;
begin
  perform public._package_editor_open();
  perform public._package_editor_actor(p_actor, p_reason);
  if p_confirm is distinct from true then
    raise exception 'confirm the signup setting';
  end if;
  if p_enabled is null then
    raise exception 'new signup trial must be on or off';
  end if;
  select new_signup_trial_enabled into v_before
  from public.billing_lifecycle_settings where id = 1;
  update public.billing_lifecycle_settings
  set new_signup_trial_enabled = p_enabled, updated_at = now()
  where id = 1;
  perform public._billing_audit(
    btrim(p_actor),
    'set_new_signup_trial',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'confirm', true,
      'before', v_before,
      'after', p_enabled,
      'changed_at', now()
    )
  );
  return jsonb_build_object('new_signup_trial_enabled', p_enabled);
end;
$$;

create or replace function public.admin_set_price_approval_threshold(
  p_threshold numeric,
  p_actor text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before numeric;
begin
  perform public._package_editor_open();
  perform public._package_editor_actor(p_actor, p_reason);
  if p_threshold is not null and (p_threshold < 0 or p_threshold > 100000000) then
    raise exception 'the approval threshold must be zero or more';
  end if;
  select price_change_approval_threshold_kes into v_before
  from public.billing_lifecycle_settings
  where id = 1;
  update public.billing_lifecycle_settings
  set price_change_approval_threshold_kes = p_threshold, updated_at = now()
  where id = 1;
  perform public._billing_audit(
    btrim(p_actor),
    'set_price_approval_threshold',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'before', jsonb_build_object('price_change_approval_threshold_kes', v_before),
      'after', jsonb_build_object('price_change_approval_threshold_kes', p_threshold)
    )
  );
  return public.admin_list_package_versions();
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Promote one published version from one database to another.
--    Import does not move subscribers and does not require the editor to be on.
-- ---------------------------------------------------------------------------
create or replace function public.admin_export_package_version(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.billing_package_versions%rowtype;
  v_sku text;
  v_terms jsonb;
  v_features jsonb;
  v_fingerprint text;
begin
  select * into v from public.billing_package_versions where id = p_version_id;
  if not found or v.status <> 'published' then
    raise exception 'only a published version can be promoted';
  end if;
  select sku into v_sku from public.billing_packages where id = v.package_id;
  v_features := coalesce((
    select jsonb_agg(jsonb_build_object('enabled', f.enabled, 'key', f.feature_key) order by f.feature_key)
    from public.billing_package_version_features f
    where f.package_version_id = v.id
  ), '[]'::jsonb);
  v_terms := jsonb_build_object(
    'active_from', to_char(v.active_from at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'allowances_placeholder', v.allowances_placeholder,
    'annual_discount_percent', v.annual_discount_percent,
    'annual_price_kes', v.annual_price_kes,
    'credit_kes', v.credit_kes,
    'dids', v.dids,
    'email', v.email,
    'email_credit_burn', v.email_credit_burn,
    'email_kes', v.email_kes,
    'on_demand_allowed', v.on_demand_allowed,
    'inbound_kes_per_second', v.inbound_kes_per_second,
    'message_credits', v.message_credits,
    'minutes', v.minutes,
    'monthly_price_kes', v.monthly_price_kes,
    'outbound_kes_per_second', v.outbound_kes_per_second,
    'seats', v.seats,
    'sms', v.sms,
    'sms_credit_burn', v.sms_credit_burn,
    'sms_kes', v.sms_kes,
    'spend_limit_share_percent', v.spend_limit_share_percent,
    'staff_wa', v.staff_wa,
    'trial_days', v.trial_days,
    'whatsapp_credit_burn', v.whatsapp_credit_burn,
    'whatsapp_kes', v.whatsapp_kes
  );
  if public._package_version_has_column('extra_seat_monthly_kes') then
    v_terms := v_terms || jsonb_build_object(
      'extra_seat_monthly_kes', to_jsonb(v) -> 'extra_seat_monthly_kes'
    );
  end if;
  v_fingerprint := public.package_version_fingerprint(v_sku, v_terms, v_features);
  return jsonb_build_object(
    'format', 'scalers.package_version.v1',
    'sku', v_sku,
    'source_version', v.version,
    'source_version_id', v.id,
    'fingerprint', v_fingerprint,
    'terms', v_terms,
    'features', v_features
  );
end;
$$;

create or replace function public.admin_import_promoted_package_version(
  p_payload jsonb,
  p_actor text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sku text;
  v_package public.billing_packages%rowtype;
  v_terms jsonb;
  v_features jsonb;
  v_fingerprint text;
  v_existing uuid;
  v_id uuid;
  v_next integer;
  v_active timestamptz;
begin
  perform public._package_editor_actor(p_actor, p_reason);
  if p_payload is null or p_payload ->> 'format' is distinct from 'scalers.package_version.v1' then
    raise exception 'promote file is not a package version';
  end if;
  v_sku := btrim(p_payload ->> 'sku');
  v_terms := p_payload -> 'terms';
  v_features := p_payload -> 'features';
  select * into v_package from public.billing_packages where sku = v_sku;
  if not found then
    raise exception 'package not found';
  end if;
  v_fingerprint := public.package_version_fingerprint(v_sku, v_terms, v_features);
  if nullif(p_payload ->> 'fingerprint', '') is not null
     and p_payload ->> 'fingerprint' is distinct from v_fingerprint
  then
    raise exception 'promote file does not match its fingerprint';
  end if;
  select id into v_existing
  from public.billing_package_versions
  where package_id = v_package.id
    and promote_fingerprint = v_fingerprint
  limit 1;
  if v_existing is not null then
    perform public._billing_audit(
      btrim(p_actor),
      'promote_package_version',
      null,
      jsonb_build_object(
        'reason', btrim(p_reason),
        'package_sku', v_sku,
        'version_id', v_existing,
        'fingerprint', v_fingerprint,
        'source_version_id', p_payload ->> 'source_version_id',
        'source_project_ref', p_payload ->> 'source_project_ref',
        'already_present', true
      )
    );
    return jsonb_build_object(
      'version_id', v_existing,
      'already_present', true,
      'version', public._package_version_json(v_existing)
    );
  end if;
  if exists (
    select 1 from public.billing_package_versions
    where package_id = v_package.id and status = 'draft'
  ) then
    raise exception 'a draft already exists';
  end if;
  v_active := (v_terms ->> 'active_from')::timestamptz;
  select coalesce(max(version), 0) + 1 into v_next
  from public.billing_package_versions
  where package_id = v_package.id;
  perform set_config('scalers.package_version_promote', '1', true);
  insert into public.billing_package_versions (
    package_id, version, status, monthly_price_kes, seats, minutes, sms, email, staff_wa, dids,
    inbound_kes_per_second, outbound_kes_per_second, whatsapp_kes, sms_kes, email_kes,
    annual_discount_percent, annual_price_kes, credit_kes, spend_limit_share_percent,
    trial_days, allowances_placeholder, active_from,
    promote_fingerprint
  ) values (
    v_package.id, v_next, 'draft', 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 1, 50, null, false, v_active, v_fingerprint
  )
  returning id into v_id;
  -- The editor may be off on the target. Numbers still go through the same checks.
  perform public._package_editor_apply_features(v_id, v_features);
  update public.billing_package_versions v
  set
    monthly_price_kes = public._package_editor_money(v_terms, 'monthly_price_kes'),
    seats = public._package_editor_count(v_terms, 'seats'),
    minutes = public._package_editor_count(v_terms, 'minutes'),
    sms = public._package_editor_count(v_terms, 'sms'),
    email = public._package_editor_count(v_terms, 'email'),
    staff_wa = public._package_editor_count(v_terms, 'staff_wa'),
    dids = public._package_editor_count(v_terms, 'dids'),
    inbound_kes_per_second = public._package_editor_money(v_terms, 'inbound_kes_per_second'),
    outbound_kes_per_second = public._package_editor_money(v_terms, 'outbound_kes_per_second'),
    whatsapp_kes = public._package_editor_money(v_terms, 'whatsapp_kes'),
    sms_kes = public._package_editor_money(v_terms, 'sms_kes'),
    email_kes = public._package_editor_money(v_terms, 'email_kes'),
    message_credits = case
      when v_terms -> 'message_credits' is null or jsonb_typeof(v_terms -> 'message_credits') = 'null' then null
      else public._package_editor_count(v_terms, 'message_credits')
    end,
    sms_credit_burn = coalesce(
      case
        when v_terms -> 'sms_credit_burn' is null or jsonb_typeof(v_terms -> 'sms_credit_burn') = 'null' then null
        else public._package_editor_count(v_terms, 'sms_credit_burn')
      end,
      public._package_editor_money(v_terms, 'sms_kes')
    ),
    whatsapp_credit_burn = coalesce(
      case
        when v_terms -> 'whatsapp_credit_burn' is null or jsonb_typeof(v_terms -> 'whatsapp_credit_burn') = 'null' then null
        else public._package_editor_count(v_terms, 'whatsapp_credit_burn')
      end,
      public._package_editor_money(v_terms, 'whatsapp_kes')
    ),
    email_credit_burn = coalesce(
      case
        when v_terms -> 'email_credit_burn' is null or jsonb_typeof(v_terms -> 'email_credit_burn') = 'null' then null
        else public._package_editor_count(v_terms, 'email_credit_burn')
      end,
      public._package_editor_money(v_terms, 'email_kes')
    ),
    on_demand_allowed = case
      when v_terms -> 'on_demand_allowed' is null or jsonb_typeof(v_terms -> 'on_demand_allowed') = 'null' then true
      else (v_terms ->> 'on_demand_allowed')::boolean
    end,
    annual_price_kes = case
      when v_terms ? 'annual_price_kes' and jsonb_typeof(v_terms -> 'annual_price_kes') <> 'null'
        then public._package_editor_money(v_terms, 'annual_price_kes')
      else round(
        public._package_editor_money(v_terms, 'monthly_price_kes') * 12
        * (1 - public._package_editor_money(v_terms, 'annual_discount_percent') / 100)
      )
    end,
    credit_kes = case
      when v_terms ? 'credit_kes' and jsonb_typeof(v_terms -> 'credit_kes') <> 'null'
        then public._package_editor_money(v_terms, 'credit_kes')
      else 1
    end,
    spend_limit_share_percent = case
      when v_terms ? 'spend_limit_share_percent' and jsonb_typeof(v_terms -> 'spend_limit_share_percent') <> 'null'
        then public._package_editor_money(v_terms, 'spend_limit_share_percent')
      else 50
    end,
    annual_discount_percent = public._package_editor_money(v_terms, 'annual_discount_percent'),
    allowances_placeholder = (v_terms ->> 'allowances_placeholder')::boolean,
    trial_days = case
      when v_terms -> 'trial_days' is null or jsonb_typeof(v_terms -> 'trial_days') = 'null' then null
      else (v_terms ->> 'trial_days')::integer
    end
  where v.id = v_id;
  if v_sku = 'trial' then
    if (select trial_days from public.billing_package_versions where id = v_id) is null then
      raise exception 'trial length must be 1 to 90 days';
    end if;
  elsif (select trial_days from public.billing_package_versions where id = v_id) is not null then
    raise exception 'only a trial version has a trial length';
  end if;
  update public.billing_package_versions
  set annual_discount_percent = public._package_annual_discount(monthly_price_kes, annual_price_kes)
  where id = v_id;
  if (select spend_limit_share_percent from public.billing_package_versions where id = v_id) > 100 then
    raise exception 'spend limit must be 0 to 100';
  end if;
  perform public._package_version_apply_extra_seat(v_id, v_terms);
  update public.billing_package_versions
  set status = 'published', published_at = now(), active_from = v_active
  where id = v_id;
  perform public._billing_audit(
    btrim(p_actor),
    'promote_package_version',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'package_sku', v_sku,
      'version_id', v_id,
      'fingerprint', v_fingerprint,
      'source_version_id', p_payload ->> 'source_version_id',
      'source_project_ref', p_payload ->> 'source_project_ref',
      'already_present', false,
      'after', public._package_version_json(v_id)
    )
  );
  perform set_config('scalers.package_version_promote', '0', true);
  return jsonb_build_object(
    'version_id', v_id,
    'already_present', false,
    'version', public._package_version_json(v_id)
  );
end;
$$;

-- Brand-new businesses only. handle_new_user_tenant inserts the tenant on
-- signup. Onboarding updates that row and does not create one. This trigger
-- runs after that insert. The flag defaults off, so production signup is
-- unchanged until the owner sets new_signup_trial_enabled. Existing rows are
-- not updated. Billing enforcement is not written. trial_ends_at stays null.
-- Trial expiry is a later change.
create or replace function public.tenants_a_new_signup_trial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_package uuid;
begin
  select new_signup_trial_enabled into v_enabled
  from public.billing_lifecycle_settings
  where id = 1;
  if not coalesce(v_enabled, false) then
    return new;
  end if;
  if exists (
    select 1 from public.tenant_subscriptions where tenant_id = new.id
  ) then
    return new;
  end if;
  select id into v_package from public.billing_packages where sku = 'trial';
  if v_package is null or public.billing_latest_package_version(v_package) is null then
    return new;
  end if;
  insert into public.tenant_subscriptions (tenant_id, package_id, status)
  values (new.id, v_package, 'active');
  return new;
end;
$$;

drop trigger if exists tenants_a_new_signup_trial on public.tenants;
create trigger tenants_a_new_signup_trial
  after insert on public.tenants
  for each row execute function public.tenants_a_new_signup_trial();

comment on function public.tenants_a_new_signup_trial() is
  'When new_signup_trial_enabled is true, a new business with no subscription is pinned to the latest published trial version. Enforcement stays off. Existing businesses are not updated.';

-- ---------------------------------------------------------------------------
-- 6. Grants. Service role only. Owners do not edit versions.
-- ---------------------------------------------------------------------------
revoke all on function public._package_editor_actor(text, text) from public, anon, authenticated;
revoke all on function public._package_editor_open() from public, anon, authenticated;
revoke all on function public._package_editor_count(jsonb, text) from public, anon, authenticated;
revoke all on function public._package_editor_money(jsonb, text) from public, anon, authenticated;
revoke all on function public._package_editor_apply_features(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._package_version_sha256(text) from public, anon, authenticated;
revoke all on function public._package_version_price_snapshot(uuid) from public, anon, authenticated;
revoke all on function public._package_version_current_id(uuid) from public, anon, authenticated;
revoke all on function public._package_version_needs_approval(uuid) from public, anon, authenticated;
revoke all on function public._package_version_json(uuid) from public, anon, authenticated;
revoke all on function public._package_version_has_column(text) from public, anon, authenticated;
revoke all on function public._package_annual_discount(numeric, numeric) from public, anon, authenticated;
revoke all on function public._package_version_copy_extra_seat(uuid, uuid) from public, anon, authenticated;
revoke all on function public._package_version_apply_extra_seat(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._package_version_fill_extra_seat() from public, anon, authenticated;
revoke all on function public.package_version_fingerprint(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.admin_list_package_versions() from public, anon, authenticated;
revoke all on function public.admin_draft_package_version(text, text, text) from public, anon, authenticated;
revoke all on function public.admin_update_package_version_draft(uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.admin_approve_package_version(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_publish_package_version(uuid, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.admin_archive_package_version(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_discard_package_version_draft(uuid, text, text) from public, anon, authenticated;
revoke all on function public._apply_package_version_move(public.billing_package_versions, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_move_subscribers_to_package_version(uuid, uuid[], text, text, boolean) from public, anon, authenticated;
revoke all on function public.system_move_subscribers_to_package_version(uuid, uuid[], text, text) from public, anon, authenticated;
revoke all on function public.admin_set_tenant_billing_mode(uuid, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_set_new_signup_trial(boolean, text, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_set_price_approval_threshold(numeric, text, text) from public, anon, authenticated;
revoke all on function public.admin_export_package_version(uuid) from public, anon, authenticated;
revoke all on function public.admin_import_promoted_package_version(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.tenants_a_new_signup_trial() from public, anon, authenticated;

grant execute on function public._package_editor_actor(text, text) to service_role;
grant execute on function public._package_editor_open() to service_role;
grant execute on function public._package_editor_count(jsonb, text) to service_role;
grant execute on function public._package_editor_money(jsonb, text) to service_role;
grant execute on function public._package_editor_apply_features(uuid, jsonb) to service_role;
grant execute on function public._package_version_sha256(text) to service_role;
grant execute on function public._package_version_price_snapshot(uuid) to service_role;
grant execute on function public._package_version_current_id(uuid) to service_role;
grant execute on function public._package_version_needs_approval(uuid) to service_role;
grant execute on function public._package_version_json(uuid) to service_role;
grant execute on function public.package_version_fingerprint(text, jsonb, jsonb) to service_role;
grant execute on function public.admin_list_package_versions() to service_role;
grant execute on function public.admin_draft_package_version(text, text, text) to service_role;
grant execute on function public.admin_update_package_version_draft(uuid, jsonb, text, text) to service_role;
grant execute on function public.admin_approve_package_version(uuid, text, text) to service_role;
grant execute on function public.admin_publish_package_version(uuid, timestamptz, text, text) to service_role;
grant execute on function public.admin_archive_package_version(uuid, text, text) to service_role;
grant execute on function public.admin_discard_package_version_draft(uuid, text, text) to service_role;
grant execute on function public._apply_package_version_move(public.billing_package_versions, uuid, text, text, text) to service_role;
grant execute on function public.admin_move_subscribers_to_package_version(uuid, uuid[], text, text, boolean) to service_role;
grant execute on function public.system_move_subscribers_to_package_version(uuid, uuid[], text, text) to service_role;
grant execute on function public.admin_set_tenant_billing_mode(uuid, text, text, text, text, boolean) to service_role;
grant execute on function public.admin_set_new_signup_trial(boolean, text, text, boolean) to service_role;
grant execute on function public.admin_set_price_approval_threshold(numeric, text, text) to service_role;
grant execute on function public.admin_export_package_version(uuid) to service_role;
grant execute on function public.admin_import_promoted_package_version(jsonb, text, text) to service_role;
grant execute on function public.tenants_a_new_signup_trial() to service_role;

alter table public.billing_package_version_approvals enable row level security;
revoke all on table public.billing_package_version_approvals from public, anon, authenticated;
grant all on table public.billing_package_version_approvals to service_role;
