-- package_version_editor.sql
-- Purpose: Super Admin package versions. Draft from the current version, edit
--          the draft, publish it from a date, or archive it. Published rows
--          stay frozen. Subscribers stay on their version until an admin
--          moves them. The trial is the trial package version.
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
-- write a new commercial price.
--
-- Messages are one shared allowance: message_credits. 1 credit = KSh 1 at the
-- on-demand rate. sms_credit_burn, whatsapp_credit_burn, and email_credit_burn
-- are credits per SMS segment, WhatsApp message, and email. The editor writes
-- those burns into sms_kes, whatsapp_kes, and email_kes so the stored rate
-- matches. It does not edit the old sms, email, and staff_wa included columns.
-- Seeded versions leave message_credits null. An admin sets the pool on the
-- draft. Owner defaults, still editable on a draft: SMS segment 1, WhatsApp
-- alert 2, email 1. A draft copies the burns from the version it starts from.
-- Metering still reads the old buckets until a later change.

-- ---------------------------------------------------------------------------
-- 1. Editor settings and version bookkeeping.
-- ---------------------------------------------------------------------------
alter table public.billing_lifecycle_settings
  add column if not exists price_change_approval_threshold_kes numeric,
  add column if not exists package_editor_enabled boolean not null default true;

alter table public.billing_lifecycle_settings
  drop constraint if exists billing_lifecycle_settings_threshold_check;
alter table public.billing_lifecycle_settings
  add constraint billing_lifecycle_settings_threshold_check check (
    price_change_approval_threshold_kes is null
    or price_change_approval_threshold_kes >= 0
  );

comment on column public.billing_lifecycle_settings.price_change_approval_threshold_kes is
  'Null: a publish does not need a second admin. Set: a monthly price move above this amount, or any overage rate or annual discount change, needs a second admin. Zero means any monthly price change.';

comment on column public.billing_lifecycle_settings.package_editor_enabled is
  'When false, draft, edit, publish, archive, approve, and move are refused. Import of a promoted version still runs. Staging stays true.';

alter table public.billing_package_versions
  add column if not exists copied_from_id uuid,
  add column if not exists promote_fingerprint text,
  add column if not exists notes text,
  add column if not exists price_set_by text,
  add column if not exists message_credits integer,
  add column if not exists sms_credit_burn numeric,
  add column if not exists whatsapp_credit_burn numeric,
  add column if not exists email_credit_burn numeric;

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
    raise exception 'package version is pinned; change the package to move version';
  end if;
  return new;
end;
$$;

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
    'email_kes', v.email_kes,
    'inbound_kes_per_second', v.inbound_kes_per_second,
    'monthly_price_kes', v.monthly_price_kes,
    'outbound_kes_per_second', v.outbound_kes_per_second,
    'sms_kes', v.sms_kes,
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
    'dids', (p_terms ->> 'dids')::integer,
    'email', (p_terms ->> 'email')::integer,
    'email_credit_burn', (p_terms ->> 'email_credit_burn')::numeric,
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
    'staff_wa', (p_terms ->> 'staff_wa')::integer,
    'trial_days', v_trial,
    'whatsapp_credit_burn', (p_terms ->> 'whatsapp_credit_burn')::numeric,
    'whatsapp_kes', (p_terms ->> 'whatsapp_kes')::numeric
  );
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
    'annual_price_kes', round(v.monthly_price_kes * 12 * (1 - v.annual_discount_percent / 100)),
    'seats', v.seats,
    'minutes', v.minutes,
    'message_credits', v.message_credits,
    'sms_credit_burn', v.sms_credit_burn,
    'whatsapp_credit_burn', v.whatsapp_credit_burn,
    'email_credit_burn', v.email_credit_burn,
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
    annual_discount_percent, trial_days, allowances_placeholder, active_from,
    copied_from_id, notes, price_set_by,
    message_credits, sms_credit_burn, whatsapp_credit_burn, email_credit_burn
  ) values (
    v_package.id, v_next, 'draft',
    v_source.monthly_price_kes, v_source.seats, v_source.minutes, v_source.sms, v_source.email,
    v_source.staff_wa, v_source.dids,
    v_source.inbound_kes_per_second, v_source.outbound_kes_per_second, v_source.whatsapp_kes,
    v_source.sms_kes, v_source.email_kes, v_source.annual_discount_percent,
    v_source.trial_days, v_source.allowances_placeholder, v_source.active_from,
    v_source.id, null, null,
    v_source.message_credits, v_source.sms_credit_burn, v_source.whatsapp_credit_burn, v_source.email_credit_burn
  )
  returning id into v_id;
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
  v_dids integer;
  v_inbound numeric;
  v_outbound numeric;
  v_discount numeric;
  v_trial integer;
  v_placeholder boolean;
  v_notes text;
  v_price_set_by text;
  v_price_changed boolean;
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
  v_discount := public._package_editor_money(p_patch, 'annual_discount_percent');
  if v_discount > 100 then
    raise exception 'discount must be 0 to 100';
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
  if p_patch ? 'notes' and jsonb_typeof(p_patch -> 'notes') <> 'null' then
    v_notes := nullif(btrim(p_patch ->> 'notes'), '');
    if v_notes is not null and length(v_notes) > 500 then
      raise exception 'notes must be 500 characters or less';
    end if;
  else
    v_notes := v_old.notes;
  end if;
  perform public._package_editor_apply_features(p_version_id, p_patch -> 'features');
  v_price_changed :=
    v_monthly is distinct from v_old.monthly_price_kes
    or v_inbound is distinct from v_old.inbound_kes_per_second
    or v_outbound is distinct from v_old.outbound_kes_per_second
    or v_sms_burn is distinct from v_old.sms_credit_burn
    or v_whatsapp_burn is distinct from v_old.whatsapp_credit_burn
    or v_email_burn is distinct from v_old.email_credit_burn
    or v_discount is distinct from v_old.annual_discount_percent;
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
    annual_discount_percent = v_discount,
    trial_days = v_trial,
    allowances_placeholder = v_placeholder,
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

create or replace function public.admin_move_subscribers_to_package_version(
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
  v_sku text;
  v_tenant uuid;
  v_sub public.tenant_subscriptions%rowtype;
  v_moved integer := 0;
  v_status text;
  v_minutes integer;
  v_enforcement text;
begin
  perform public._package_editor_open();
  perform public._package_editor_actor(p_actor, p_reason);
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
  select sku into v_sku from public.billing_packages where id = v_version.package_id;
  foreach v_tenant in array p_tenant_ids
  loop
    select * into v_sub from public.tenant_subscriptions where tenant_id = v_tenant for update;
    if not found then
      raise exception 'business not found';
    end if;
    if v_sub.package_id is distinct from v_version.package_id then
      raise exception 'that business is not on this package';
    end if;
    v_status := v_sub.billing_status;
    select minutes_included, billing_enforcement into v_minutes, v_enforcement
    from public.tenants where id = v_tenant;
    perform set_config('scalers.billing_version_move', '1', true);
    update public.tenant_subscriptions
    set package_version_id = p_version_id
    where tenant_id = v_tenant;
    if (select billing_status from public.tenant_subscriptions where tenant_id = v_tenant) is distinct from v_status
       or (select minutes_included from public.tenants where id = v_tenant) is distinct from v_minutes
       or (select billing_enforcement from public.tenants where id = v_tenant) is distinct from v_enforcement
    then
      raise exception 'a version move must not change billing status or minutes';
    end if;
    perform public._billing_audit(
      btrim(p_actor),
      'move_package_version',
      v_tenant,
      jsonb_build_object(
        'reason', btrim(p_reason),
        'package_sku', v_sku,
        'version', v_version.version,
        'version_id', p_version_id,
        'before', jsonb_build_object('package_version_id', v_sub.package_version_id),
        'after', jsonb_build_object('package_version_id', p_version_id)
      )
    );
    v_moved := v_moved + 1;
  end loop;
  perform set_config('scalers.billing_version_move', '0', true);
  return jsonb_build_object(
    'version_id', p_version_id,
    'moved', v_moved,
    'version', public._package_version_json(p_version_id)
  );
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
    'dids', v.dids,
    'email', v.email,
    'email_credit_burn', v.email_credit_burn,
    'email_kes', v.email_kes,
    'inbound_kes_per_second', v.inbound_kes_per_second,
    'message_credits', v.message_credits,
    'minutes', v.minutes,
    'monthly_price_kes', v.monthly_price_kes,
    'outbound_kes_per_second', v.outbound_kes_per_second,
    'seats', v.seats,
    'sms', v.sms,
    'sms_credit_burn', v.sms_credit_burn,
    'sms_kes', v.sms_kes,
    'staff_wa', v.staff_wa,
    'trial_days', v.trial_days,
    'whatsapp_credit_burn', v.whatsapp_credit_burn,
    'whatsapp_kes', v.whatsapp_kes
  );
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
    annual_discount_percent, trial_days, allowances_placeholder, active_from,
    promote_fingerprint
  ) values (
    v_package.id, v_next, 'draft', 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, null, false, v_active, v_fingerprint
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
  if (select annual_discount_percent from public.billing_package_versions where id = v_id) > 100 then
    raise exception 'discount must be 0 to 100';
  end if;
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
revoke all on function public.package_version_fingerprint(text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.admin_list_package_versions() from public, anon, authenticated;
revoke all on function public.admin_draft_package_version(text, text, text) from public, anon, authenticated;
revoke all on function public.admin_update_package_version_draft(uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.admin_approve_package_version(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_publish_package_version(uuid, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.admin_archive_package_version(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_discard_package_version_draft(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_move_subscribers_to_package_version(uuid, uuid[], text, text) from public, anon, authenticated;
revoke all on function public.admin_set_price_approval_threshold(numeric, text, text) from public, anon, authenticated;
revoke all on function public.admin_export_package_version(uuid) from public, anon, authenticated;
revoke all on function public.admin_import_promoted_package_version(jsonb, text, text) from public, anon, authenticated;

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
grant execute on function public.admin_move_subscribers_to_package_version(uuid, uuid[], text, text) to service_role;
grant execute on function public.admin_set_price_approval_threshold(numeric, text, text) to service_role;
grant execute on function public.admin_export_package_version(uuid) to service_role;
grant execute on function public.admin_import_promoted_package_version(jsonb, text, text) to service_role;

alter table public.billing_package_version_approvals enable row level security;
revoke all on table public.billing_package_version_approvals from public, anon, authenticated;
grant all on table public.billing_package_version_approvals to service_role;
