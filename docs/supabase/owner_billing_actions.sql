-- owner_billing_actions.sql
-- Purpose: owner and admin plan changes the Desk calls. Upgrade now with
--          day-based proration, downgrade at the next renewal, monthly to
--          annual now, annual to monthly at renewal, extra seats, and the
--          spend limit. No payment provider call. No card charge.
-- Run after: billing_data_layer.sql, package_minute_consume.sql,
--            notify_send_reserve_settle.sql, package_state_rules.sql.
--            Re-apply this file after any of those are re-applied.
-- Idempotent. Safe to re-run.
--
-- DO NOT RUN on production fjxcdccgyhnvnnlnovcl until a backup and Alvin's GO.
-- Staging project is sgcdncjxauhsbunobmob.
-- The same body is docs/supabase/prod/owner_billing_actions.sql.
--
-- Prices are read from billing_package_versions. Nothing in the functions
-- hard-codes Starter, Growth, or Scale. The locked commercial numbers, for
-- reference only, are Starter 7,000/mo, Growth 18,000, Scale 35,000; annual
-- 69,720 / 194,400 / 378,000; seats 3 / 8 / 20; extra seat 500/mo.
-- Annual price = round(monthly_price_kes * 12 * (100 - annual_discount_percent) / 100)
-- to a whole shilling. 17 percent off 7,000 is 69,720. 10 percent off 18,000
-- is 194,400. 10 percent off 35,000 is 378,000. The discount lives on the
-- version row.
--
-- Day-based proration (Africa/Nairobi dates, whole shillings, half away from
-- zero via round(numeric, 0)):
--   days_in_period = end date - start date (at least 1)
--   days_left = end date - today, clamped to 0..days_in_period
--   amount = round(price_kes * days_left / days_in_period, 0)
-- An upgrade credits the unused part of the current term and charges the new
-- plan for those same days. Monthly to annual credits the unused month and
-- charges the full annual price (the new year starts today). The net is
-- charge minus credit, and never below 0. No cash refund.
--
-- Beta (billing_enforcement off, or billing_status beta) returns code beta.
-- No proration invoice, no seat line, no spend-limit hold.
--
-- Desk screens stay behind DESK_PLAN_CHANGE (exact value on). This file does
-- not read that flag. The Desk server action does, and it refuses production.

-- ---------------------------------------------------------------------------
-- 0. Columns. Pending change and the billing term already exist where
--    package_state_rules.sql has been applied. Extra seats and the spend hold
--    are new. The seat price lives on the version, default 500 (the locked
--    extra-seat price). The function reads the row.
-- ---------------------------------------------------------------------------
alter table public.billing_package_versions
  add column if not exists extra_seat_monthly_kes numeric;

alter table public.billing_package_versions
  drop constraint if exists billing_package_versions_extra_seat_check;
alter table public.billing_package_versions
  add constraint billing_package_versions_extra_seat_check
  check (extra_seat_monthly_kes is null or extra_seat_monthly_kes >= 0);

update public.billing_package_versions v
set extra_seat_monthly_kes = 500
from public.billing_packages p
where p.id = v.package_id
  and p.sku in ('starter', 'growth', 'scale')
  and v.extra_seat_monthly_kes is null;

alter table public.billing_package_versions
  alter column extra_seat_monthly_kes set default 500;

comment on column public.billing_package_versions.extra_seat_monthly_kes is
  'KSh per extra seat per month. Read by owner seat changes. Seeded at 500 for Starter, Growth, and Scale. A published row cannot change it.';

-- Freeze the seat price once the version is not a draft. Separate from
-- billing_package_versions_freeze so a later editor rewrite does not drop it.
create or replace function public.billing_package_versions_freeze_seat()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'draft' then
    return new;
  end if;
  if new.extra_seat_monthly_kes is distinct from old.extra_seat_monthly_kes then
    raise exception 'published package version is frozen';
  end if;
  return new;
end;
$$;

drop trigger if exists billing_package_versions_freeze_seat on public.billing_package_versions;
create trigger billing_package_versions_freeze_seat
  before update on public.billing_package_versions
  for each row execute function public.billing_package_versions_freeze_seat();

alter table public.tenant_subscriptions
  add column if not exists term_start timestamptz,
  add column if not exists term_end timestamptz,
  add column if not exists pending_package_id uuid,
  add column if not exists pending_period text,
  add column if not exists pending_change text,
  add column if not exists pending_effective_at timestamptz,
  add column if not exists pending_set_at timestamptz,
  add column if not exists pending_actor text,
  add column if not exists extra_seats integer not null default 0,
  add column if not exists spend_limit_held_period timestamptz;

alter table public.tenant_subscriptions
  drop constraint if exists tenant_subscriptions_extra_seats_check;
alter table public.tenant_subscriptions
  add constraint tenant_subscriptions_extra_seats_check
  check (extra_seats >= 0);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tenant_subscriptions_pending_check'
  ) then
    alter table public.tenant_subscriptions
      add constraint tenant_subscriptions_pending_check check (
        (pending_change is null
          and pending_package_id is null and pending_period is null and pending_effective_at is null)
        or (pending_change in ('downgrade', 'period_change')
          and pending_package_id is not null
          and pending_period in ('month', 'year')
          and pending_effective_at is not null)
        or (pending_change = 'unassign'
          and pending_package_id is null and pending_period is null
          and pending_effective_at is not null)
      );
  end if;
end $$;

comment on column public.tenant_subscriptions.extra_seats is
  'Seats bought on top of the pinned version. KSh price is the version extra_seat_monthly_kes.';
comment on column public.tenant_subscriptions.spend_limit_held_period is
  'Usage period start when on-demand was stopped because the spend limit was reached. Cleared when the usage period rolls.';

alter table public.tenants
  add column if not exists spend_limit_blocked boolean not null default false;

comment on column public.tenants.spend_limit_blocked is
  'True when on-demand for this usage period is stopped by the spend limit. Same effect as on-demand off for calls past the allowance, SMS, and WhatsApp updates. Inbound calls inside the allowance are not affected. Beta never sets this.';

alter table public.tenants
  add column if not exists soft_spend_limit_enabled boolean not null default false;
alter table public.tenants
  add column if not exists soft_spend_limit_kes numeric;
alter table public.tenants
  add column if not exists sms_included_units integer not null default 0;
alter table public.tenants
  add column if not exists email_included_units integer not null default 0;
alter table public.tenants
  add column if not exists whatsapp_included_units integer not null default 0;
alter table public.tenants
  add column if not exists seat_included integer not null default 0;

create or replace function public.tenants_protect_spend_limit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.spend_limit_blocked is distinct from old.spend_limit_blocked
     and current_setting('scalers.wallet_write', true) is distinct from '1'
     and current_setting('scalers.billing_write', true) is distinct from '1'
  then
    raise exception 'spend limit is rpc only';
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_protect_spend_limit on public.tenants;
create trigger tenants_protect_spend_limit
  before update on public.tenants
  for each row execute function public.tenants_protect_spend_limit();

alter table public.invoices
  add column if not exists billing_source text;

alter table public.invoices
  drop constraint if exists invoices_billing_source_check;
alter table public.invoices
  add constraint invoices_billing_source_check
  check (billing_source is null or billing_source in ('proration', 'next'));

create unique index if not exists invoices_one_next_draft
  on public.invoices (tenant_id)
  where billing_source = 'next' and status = 'draft';

comment on column public.invoices.billing_source is
  'proration: opened now for an upgrade. next: draft lines (extra seats) for the following invoice. Null on other invoices.';

create table if not exists public.billing_owner_action_keys (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  idempotency_key text not null,
  action text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, idempotency_key)
);

alter table public.billing_owner_action_keys enable row level security;
revoke all on table public.billing_owner_action_keys from public, anon, authenticated;
grant all on table public.billing_owner_action_keys to service_role;

-- ---------------------------------------------------------------------------
-- 1. Day math and prices. Whole shillings. Nairobi calendar dates.
-- ---------------------------------------------------------------------------
create or replace function public.billing_add_months(p_ts timestamptz, p_months integer)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select ((p_ts at time zone 'Africa/Nairobi') + make_interval(months => p_months)) at time zone 'Africa/Nairobi';
$$;

revoke all on function public.billing_add_months(timestamptz, integer) from public, anon;
grant execute on function public.billing_add_months(timestamptz, integer) to authenticated, service_role;

create or replace function public.billing_period_days(
  p_start timestamptz,
  p_end timestamptz,
  p_now timestamptz
)
returns table (days_in_period integer, days_left integer)
language plpgsql
immutable
set search_path = public
as $$
declare
  v_start date;
  v_end date;
  v_today date;
  v_days integer;
  v_left integer;
begin
  if p_start is null or p_end is null then
    days_in_period := 1;
    days_left := 0;
    return next;
    return;
  end if;
  v_start := (p_start at time zone 'Africa/Nairobi')::date;
  v_end := (p_end at time zone 'Africa/Nairobi')::date;
  v_today := (coalesce(p_now, now()) at time zone 'Africa/Nairobi')::date;
  v_days := v_end - v_start;
  if v_days < 1 then
    days_in_period := 1;
    days_left := 0;
    return next;
    return;
  end if;
  v_left := v_end - v_today;
  if v_left < 0 then
    v_left := 0;
  elsif v_left > v_days then
    v_left := v_days;
  end if;
  days_in_period := v_days;
  days_left := v_left;
  return next;
end;
$$;

revoke all on function public.billing_period_days(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_period_days(timestamptz, timestamptz, timestamptz) to service_role;

create or replace function public.billing_prorate_kes(
  p_price_kes numeric,
  p_days_left integer,
  p_days_in_period integer
)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(p_price_kes, 0) <= 0 or coalesce(p_days_in_period, 0) <= 0 or coalesce(p_days_left, 0) <= 0
      then 0
    else round(
      p_price_kes * least(p_days_left, p_days_in_period)::numeric / p_days_in_period::numeric,
      0
    )
  end
$$;

comment on function public.billing_prorate_kes(numeric, integer, integer) is
  'Day-based KSh proration, whole shillings, half away from zero. price * days_left / days_in_period.';

revoke all on function public.billing_prorate_kes(numeric, integer, integer) from public, anon, authenticated;
grant execute on function public.billing_prorate_kes(numeric, integer, integer) to service_role;

create or replace function public.billing_version_price_kes(
  p_version_id uuid,
  p_period text
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.billing_package_versions%rowtype;
  v_period text := lower(trim(coalesce(p_period, 'month')));
begin
  select * into v from public.billing_package_versions where id = p_version_id;
  if not found then
    return null;
  end if;
  if v_period = 'year' then
    return round(v.monthly_price_kes * 12 * (100 - v.annual_discount_percent) / 100, 0);
  end if;
  return round(v.monthly_price_kes, 0);
end;
$$;

comment on function public.billing_version_price_kes(uuid, text) is
  'Month: the version monthly price. Year: monthly * 12 * (100 - annual_discount_percent) / 100, whole shillings.';

revoke all on function public.billing_version_price_kes(uuid, text) from public, anon, authenticated;
grant execute on function public.billing_version_price_kes(uuid, text) to service_role;

create or replace function public.billing_proration_quote(
  p_current_price_kes numeric,
  p_new_price_kes numeric,
  p_start timestamptz,
  p_end timestamptz,
  p_now timestamptz
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_days integer;
  v_left integer;
  v_credit numeric;
  v_charge numeric;
begin
  select d.days_in_period, d.days_left into v_days, v_left
  from public.billing_period_days(p_start, p_end, p_now) d;
  v_credit := public.billing_prorate_kes(p_current_price_kes, v_left, v_days);
  v_charge := public.billing_prorate_kes(p_new_price_kes, v_left, v_days);
  return jsonb_build_object(
    'credit_kes', v_credit,
    'charge_kes', v_charge,
    'total_kes', greatest(v_charge - v_credit, 0),
    'days_left', v_left,
    'days_in_period', v_days
  );
end;
$$;

revoke all on function public.billing_proration_quote(numeric, numeric, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.billing_proration_quote(numeric, numeric, timestamptz, timestamptz, timestamptz) to service_role;

-- Members plus pending invites that have not expired. Owner counts.
-- Uses tenant_seats_used when that function is installed.
create or replace function public.billing_seats_used(p_tenant uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if to_regprocedure('public.tenant_seats_used(uuid)') is not null then
    execute 'select public.tenant_seats_used($1)' into v_n using p_tenant;
    return coalesce(v_n, 0);
  end if;
  if to_regclass('public.tenant_invites') is null then
    select count(*)::integer into v_n from public.tenant_members where tenant_id = p_tenant;
    return coalesce(v_n, 0);
  end if;
  select (
    (select count(*) from public.tenant_members where tenant_id = p_tenant)
    + (select count(*) from public.tenant_invites
        where tenant_id = p_tenant and status = 'pending' and expires_at > now())
  )::integer into v_n;
  return coalesce(v_n, 0);
end;
$$;

revoke all on function public.billing_seats_used(uuid) from public, anon, authenticated;
grant execute on function public.billing_seats_used(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Idempotency, actor, audit.
-- ---------------------------------------------------------------------------
create or replace function public._owner_billing_gate(
  p_tenant_id uuid,
  p_actor uuid,
  p_idempotency_key text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_row public.billing_owner_action_keys%rowtype;
  v_role text;
begin
  if p_tenant_id is null then
    return jsonb_build_object('stop', true, 'result', jsonb_build_object(
      'ok', false, 'code', 'not_found', 'replayed', false,
      'message', 'Business not found.'
    ));
  end if;
  if v_key is null then
    return jsonb_build_object('stop', true, 'result', jsonb_build_object(
      'ok', false, 'code', 'idempotency_key_required', 'replayed', false,
      'message', 'Send an idempotency key with this change.'
    ));
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    return jsonb_build_object('stop', true, 'result', jsonb_build_object(
      'ok', false, 'code', 'not_found', 'replayed', false,
      'message', 'Business not found.'
    ));
  end if;

  select m.role into v_role
  from public.tenant_members m
  where m.tenant_id = p_tenant_id and m.user_id = p_actor;
  if v_role is null or v_role not in ('owner', 'admin') then
    perform public._billing_audit(
      coalesce(p_actor::text, 'owner'),
      p_action,
      p_tenant_id,
      jsonb_build_object('ok', false, 'code', 'forbidden', 'replayed', false,
        'message', 'Only an owner or an admin can change the plan.')
    );
    return jsonb_build_object('stop', true, 'result', jsonb_build_object(
      'ok', false, 'code', 'forbidden', 'replayed', false,
      'message', 'Only an owner or an admin can change the plan.'
    ));
  end if;

  select * into v_row
  from public.billing_owner_action_keys
  where tenant_id = p_tenant_id and idempotency_key = v_key;
  if found then
    if v_row.action is distinct from p_action then
      perform public._billing_audit(
        coalesce(p_actor::text, 'owner'),
        p_action,
        p_tenant_id,
        jsonb_build_object('ok', false, 'code', 'idempotency_conflict', 'replayed', false,
          'message', 'This idempotency key was already used for a different change.')
      );
      return jsonb_build_object('stop', true, 'result', jsonb_build_object(
        'ok', false, 'code', 'idempotency_conflict', 'replayed', false,
        'message', 'This idempotency key was already used for a different change.'
      ));
    end if;
    return jsonb_build_object(
      'stop', true,
      'result', v_row.result || jsonb_build_object('replayed', true)
    );
  end if;

  return jsonb_build_object('stop', false, 'key', v_key);
end;
$$;

revoke all on function public._owner_billing_gate(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public._owner_billing_gate(uuid, uuid, text, text) to service_role;

create or replace function public._owner_billing_finish(
  p_tenant_id uuid,
  p_actor uuid,
  p_key text,
  p_action text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb := p_result || jsonb_build_object('replayed', false);
begin
  perform public._billing_audit(
    coalesce(p_actor::text, 'owner'),
    p_action,
    p_tenant_id,
    v_result
  );
  insert into public.billing_owner_action_keys (tenant_id, idempotency_key, action, result)
  values (p_tenant_id, p_key, p_action, v_result);
  return v_result;
end;
$$;

revoke all on function public._owner_billing_finish(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public._owner_billing_finish(uuid, uuid, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Plan change.
--    annual -> monthly waits for the renewal (term end).
--    monthly -> annual applies now.
--    Same interval: a higher monthly price, or the same price with more
--    minutes, applies now. Anything else waits. No refund.
--    A change is refused when members plus pending invites exceed the
--    target version's seats. That includes a downgrade and a move onto a
--    plan that does not fit the people already on the business.
-- ---------------------------------------------------------------------------
create or replace function public._owner_plan_target(p_sku text)
returns table (
  package_id uuid,
  version_id uuid,
  sku text,
  package_name text,
  monthly_price_kes numeric,
  minutes integer,
  seats integer,
  sms integer,
  email integer,
  staff_wa integer,
  annual_discount_percent numeric,
  extra_seat_monthly_kes numeric,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select p.id, v.id, p.sku, p.name, v.monthly_price_kes, v.minutes, v.seats,
         v.sms, v.email, v.staff_wa, v.annual_discount_percent, v.extra_seat_monthly_kes,
         p.is_active
  from public.billing_packages p
  join public.billing_package_versions v on v.id = public.billing_latest_package_version(p.id)
  where p.sku = lower(btrim(coalesce(p_sku, '')));
end;
$$;

revoke all on function public._owner_plan_target(text) from public, anon, authenticated;
grant execute on function public._owner_plan_target(text) to service_role;

create or replace function public.owner_preview_plan_change(
  p_tenant_id uuid,
  p_actor uuid,
  p_package_sku text,
  p_period text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_tenant public.tenants%rowtype;
  v_sub public.tenant_subscriptions%rowtype;
  v_cur public.billing_package_versions%rowtype;
  v_tgt record;
  v_period text := lower(btrim(coalesce(p_period, '')));
  v_now text;
  v_used integer;
  v_quote jsonb;
  v_cur_price numeric;
  v_new_price numeric;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_tenant_id is null or not exists (select 1 from public.tenants where id = p_tenant_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Business not found.');
  end if;
  select m.role into v_role from public.tenant_members m
  where m.tenant_id = p_tenant_id and m.user_id = p_actor;
  if v_role is null or v_role not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'forbidden',
      'message', 'Only an owner or an admin can change the plan.');
  end if;
  if v_period not in ('month', 'year') then
    return jsonb_build_object('ok', false, 'code', 'invalid_period',
      'message', 'Period must be month or year.');
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  select * into v_sub from public.tenant_subscriptions where tenant_id = p_tenant_id;
  if not found or v_sub.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'no_package',
      'message', 'This business has no plan.');
  end if;
  if coalesce(v_tenant.billing_enforcement, 'off') = 'off' or v_sub.billing_status = 'beta' then
    return jsonb_build_object('ok', true, 'code', 'beta',
      'message', 'Billing is off for this business. Nothing would change.');
  end if;
  if v_sub.billing_status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'not_active',
      'message', 'The plan can change when billing is active.');
  end if;

  select * into v_tgt from public._owner_plan_target(p_package_sku);
  if v_tgt.package_id is null then
    return jsonb_build_object('ok', false, 'code', 'package_not_found',
      'message', 'That plan is not available.');
  end if;
  if not v_tgt.is_active or v_tgt.sku = 'trial' then
    return jsonb_build_object('ok', false, 'code', 'not_for_sale',
      'message', 'That plan is not for sale.');
  end if;
  if v_sub.package_id = v_tgt.package_id and v_sub.period = v_period then
    return jsonb_build_object('ok', true, 'code', 'same',
      'message', 'This business is already on that plan.');
  end if;

  v_used := public.billing_seats_used(p_tenant_id);
  if v_used > v_tgt.seats then
    return jsonb_build_object(
      'ok', false, 'code', 'seats_exceed_plan',
      'seats_included', v_tgt.seats, 'seats_used', v_used,
      'message', v_tgt.package_name || ' has ' || v_tgt.seats::text
        || ' seats. This business has ' || v_used::text
        || ' (members and pending invites).'
    );
  end if;

  select * into v_cur from public.billing_package_versions where id = v_sub.package_version_id;
  v_now := case
    when v_sub.period = 'year' and v_period = 'month' then 'renewal'
    when v_sub.period = 'month' and v_period = 'year' then 'now'
    when v_tgt.monthly_price_kes > v_cur.monthly_price_kes
      or (v_tgt.monthly_price_kes = v_cur.monthly_price_kes and v_tgt.minutes > v_cur.minutes
          and v_tgt.package_id is distinct from v_sub.package_id) then 'now'
    else 'renewal'
  end;

  if v_now = 'renewal' then
    return jsonb_build_object(
      'ok', true, 'code', 'scheduled', 'when', 'renewal',
      'package_sku', v_tgt.sku, 'period', v_period,
      'effective_at', coalesce(v_sub.term_end, v_sub.current_period_end),
      'credit_kes', 0, 'charge_kes', 0, 'total_kes', 0,
      'message', 'This change starts at the next renewal. Nothing is charged today.'
    );
  end if;

  if v_sub.period = 'month' and v_period = 'year' then
    v_start := v_sub.current_period_start;
    v_end := v_sub.current_period_end;
    v_cur_price := public.billing_version_price_kes(v_cur.id, 'month')
      + round(coalesce(v_cur.extra_seat_monthly_kes, 0) * coalesce(v_sub.extra_seats, 0), 0);
    v_new_price := public.billing_version_price_kes(v_tgt.version_id, 'year')
      + round(coalesce(v_tgt.extra_seat_monthly_kes, 0) * coalesce(v_sub.extra_seats, 0) * 12
        * (100 - v_tgt.annual_discount_percent) / 100, 0);
    -- Full new year, so the charge is not scaled by the leftover month.
    v_quote := public.billing_proration_quote(v_cur_price, 0, v_start, v_end, now());
    v_quote := v_quote || jsonb_build_object(
      'charge_kes', v_new_price,
      'total_kes', greatest(v_new_price - (v_quote->>'credit_kes')::numeric, 0)
    );
  else
    v_start := coalesce(v_sub.term_start, v_sub.current_period_start);
    v_end := coalesce(v_sub.term_end, v_sub.current_period_end);
    v_cur_price := public.billing_version_price_kes(v_cur.id, v_sub.period)
      + case when v_sub.period = 'year'
        then round(coalesce(v_cur.extra_seat_monthly_kes, 0) * coalesce(v_sub.extra_seats, 0) * 12
          * (100 - v_cur.annual_discount_percent) / 100, 0)
        else round(coalesce(v_cur.extra_seat_monthly_kes, 0) * coalesce(v_sub.extra_seats, 0), 0)
      end;
    v_new_price := public.billing_version_price_kes(v_tgt.version_id, v_period)
      + case when v_period = 'year'
        then round(coalesce(v_tgt.extra_seat_monthly_kes, 0) * coalesce(v_sub.extra_seats, 0) * 12
          * (100 - v_tgt.annual_discount_percent) / 100, 0)
        else round(coalesce(v_tgt.extra_seat_monthly_kes, 0) * coalesce(v_sub.extra_seats, 0), 0)
      end;
    v_quote := public.billing_proration_quote(v_cur_price, v_new_price, v_start, v_end, now());
  end if;

  return v_quote || jsonb_build_object(
    'ok', true, 'code', 'upgraded', 'when', 'now',
    'package_sku', v_tgt.sku, 'period', v_period,
    'message', 'The unused part of this period is credited. The new plan is charged for the rest.'
  );
end;
$$;

revoke all on function public.owner_preview_plan_change(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.owner_preview_plan_change(uuid, uuid, text, text) to service_role;

create or replace function public._owner_apply_allowances(
  p_tenant_id uuid,
  p_version_id uuid,
  p_extra_seats integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.billing_package_versions%rowtype;
begin
  select * into v from public.billing_package_versions where id = p_version_id;
  if not found then
    raise exception 'package version not found';
  end if;
  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants
  set minutes_included = v.minutes,
      sms_included_units = v.sms,
      email_included_units = v.email,
      whatsapp_included_units = v.staff_wa,
      seat_included = v.seats + greatest(coalesce(p_extra_seats, 0), 0)
  where id = p_tenant_id;
end;
$$;

revoke all on function public._owner_apply_allowances(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public._owner_apply_allowances(uuid, uuid, integer) to service_role;

create or replace function public._owner_open_proration_invoice(
  p_tenant_id uuid,
  p_credit numeric,
  p_charge numeric,
  p_credit_desc text,
  p_charge_desc text,
  p_start timestamptz,
  p_end timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_net numeric := greatest(coalesce(p_charge, 0) - coalesce(p_credit, 0), 0);
  v_inv public.invoices%rowtype;
begin
  if coalesce(p_credit, 0) = 0 and coalesce(p_charge, 0) = 0 then
    return null;
  end if;
  insert into public.invoices (
    tenant_id, status, currency, subtotal_kes, total_kes,
    period_start, period_end, billing_source
  ) values (
    p_tenant_id, 'draft', 'KES', v_net, v_net,
    p_start, p_end, 'proration'
  ) returning id into v_id;

  if coalesce(p_credit, 0) > 0 then
    insert into public.invoice_lines (
      invoice_id, tenant_id, description, quantity, unit_amount_kes, amount_kes, sort_order
    ) values (
      v_id, p_tenant_id, p_credit_desc, 1, -p_credit, -p_credit, 1
    );
  end if;
  if coalesce(p_charge, 0) > 0 then
    insert into public.invoice_lines (
      invoice_id, tenant_id, description, quantity, unit_amount_kes, amount_kes, sort_order
    ) values (
      v_id, p_tenant_id, p_charge_desc, 1, p_charge, p_charge, 2
    );
  end if;

  v_inv := public.finalize_invoice(v_id);
  return v_inv.id;
end;
$$;

revoke all on function public._owner_open_proration_invoice(uuid, numeric, numeric, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public._owner_open_proration_invoice(uuid, numeric, numeric, text, text, timestamptz, timestamptz) to service_role;

create or replace function public.owner_change_plan(
  p_tenant_id uuid,
  p_actor uuid,
  p_package_sku text,
  p_period text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gate jsonb;
  v_key text;
  v_tenant public.tenants%rowtype;
  v_sub public.tenant_subscriptions%rowtype;
  v_cur public.billing_package_versions%rowtype;
  v_tgt record;
  v_period text := lower(btrim(coalesce(p_period, '')));
  v_when text;
  v_pending text;
  v_effective timestamptz;
  v_used integer;
  v_quote jsonb;
  v_cur_price numeric;
  v_new_price numeric;
  v_start timestamptz;
  v_end timestamptz;
  v_invoice uuid;
  v_result jsonb;
  v_cur_name text;
begin
  v_gate := public._owner_billing_gate(p_tenant_id, p_actor, p_idempotency_key, 'owner_change_plan');
  if (v_gate->>'stop')::boolean then
    return v_gate->'result';
  end if;
  v_key := v_gate->>'key';

  if v_period not in ('month', 'year') then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_change_plan',
      jsonb_build_object('ok', false, 'code', 'invalid_period',
        'message', 'Period must be month or year.'));
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  select * into v_sub from public.tenant_subscriptions where tenant_id = p_tenant_id for update;
  if not found or v_sub.status <> 'active' then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_change_plan',
      jsonb_build_object('ok', false, 'code', 'no_package',
        'message', 'This business has no plan.'));
  end if;
  if coalesce(v_tenant.billing_enforcement, 'off') = 'off' or v_sub.billing_status = 'beta' then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_change_plan',
      jsonb_build_object('ok', true, 'code', 'beta',
        'message', 'Billing is off for this business. Nothing was changed.'));
  end if;
  if v_sub.billing_status <> 'active' then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_change_plan',
      jsonb_build_object('ok', false, 'code', 'not_active',
        'message', 'The plan can change when billing is active.'));
  end if;

  select * into v_tgt from public._owner_plan_target(p_package_sku);
  if v_tgt.package_id is null then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_change_plan',
      jsonb_build_object('ok', false, 'code', 'package_not_found',
        'message', 'That plan is not available.'));
  end if;
  if not v_tgt.is_active or v_tgt.sku = 'trial' then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_change_plan',
      jsonb_build_object('ok', false, 'code', 'not_for_sale',
        'message', 'That plan is not for sale.'));
  end if;
  if v_sub.package_id = v_tgt.package_id and v_sub.period = v_period then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_change_plan',
      jsonb_build_object('ok', true, 'code', 'same', 'package_sku', v_tgt.sku, 'period', v_period,
        'message', 'This business is already on that plan.'));
  end if;

  select * into v_cur from public.billing_package_versions where id = v_sub.package_version_id;
  select p.name into v_cur_name from public.billing_packages p where p.id = v_sub.package_id;

  v_used := public.billing_seats_used(p_tenant_id);
  if v_used > v_tgt.seats then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_change_plan',
      jsonb_build_object(
        'ok', false, 'code', 'seats_exceed_plan',
        'seats_included', v_tgt.seats, 'seats_used', v_used,
        'message', v_tgt.package_name || ' has ' || v_tgt.seats::text
          || ' seats. This business has ' || v_used::text
          || ' (members and pending invites).'
      ));
  end if;

  if v_sub.period = 'year' and v_period = 'month' then
    v_when := 'renewal';
    v_pending := case when v_sub.package_id is distinct from v_tgt.package_id then 'downgrade' else 'period_change' end;
  elsif v_sub.period = 'month' and v_period = 'year' then
    v_when := 'now';
    v_pending := null;
  elsif v_tgt.monthly_price_kes > v_cur.monthly_price_kes
     or (v_tgt.monthly_price_kes = v_cur.monthly_price_kes and v_tgt.minutes > v_cur.minutes
         and v_tgt.package_id is distinct from v_sub.package_id) then
    v_when := 'now';
    v_pending := null;
  else
    v_when := 'renewal';
    v_pending := 'downgrade';
  end if;

  if v_when = 'renewal' then
    v_effective := coalesce(v_sub.term_end, v_sub.current_period_end);
    if v_effective is null then
      return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_change_plan',
        jsonb_build_object('ok', false, 'code', 'no_renewal',
          'message', 'This plan has no renewal date yet.'));
    end if;
    update public.tenant_subscriptions
    set pending_package_id = v_tgt.package_id,
        pending_period = v_period,
        pending_change = v_pending,
        pending_effective_at = v_effective,
        pending_set_at = now(),
        pending_actor = p_actor::text,
        updated_at = now()
    where tenant_id = p_tenant_id;
    v_result := jsonb_build_object(
      'ok', true, 'code', 'scheduled', 'package_sku', v_tgt.sku, 'period', v_period,
      'pending_change', v_pending, 'effective_at', v_effective,
      'credit_kes', 0, 'charge_kes', 0, 'total_kes', 0,
      'message', 'This change starts at the next renewal. Nothing is charged today. You can cancel it before then.'
    );
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_change_plan', v_result);
  end if;

  if v_sub.period = 'month' and v_period = 'year' then
    v_start := v_sub.current_period_start;
    v_end := v_sub.current_period_end;
    v_cur_price := public.billing_version_price_kes(v_cur.id, 'month')
      + round(coalesce(v_cur.extra_seat_monthly_kes, 0) * coalesce(v_sub.extra_seats, 0), 0);
    v_new_price := public.billing_version_price_kes(v_tgt.version_id, 'year')
      + round(coalesce(v_tgt.extra_seat_monthly_kes, 0) * coalesce(v_sub.extra_seats, 0) * 12
        * (100 - v_tgt.annual_discount_percent) / 100, 0);
    v_quote := public.billing_proration_quote(v_cur_price, 0, v_start, v_end, now());
    v_quote := v_quote || jsonb_build_object(
      'charge_kes', v_new_price,
      'total_kes', greatest(v_new_price - (v_quote->>'credit_kes')::numeric, 0)
    );
  else
    v_start := coalesce(v_sub.term_start, v_sub.current_period_start);
    v_end := coalesce(v_sub.term_end, v_sub.current_period_end);
    v_cur_price := public.billing_version_price_kes(v_cur.id, v_sub.period)
      + case when v_sub.period = 'year'
        then round(coalesce(v_cur.extra_seat_monthly_kes, 0) * coalesce(v_sub.extra_seats, 0) * 12
          * (100 - v_cur.annual_discount_percent) / 100, 0)
        else round(coalesce(v_cur.extra_seat_monthly_kes, 0) * coalesce(v_sub.extra_seats, 0), 0)
      end;
    v_new_price := public.billing_version_price_kes(v_tgt.version_id, v_period)
      + case when v_period = 'year'
        then round(coalesce(v_tgt.extra_seat_monthly_kes, 0) * coalesce(v_sub.extra_seats, 0) * 12
          * (100 - v_tgt.annual_discount_percent) / 100, 0)
        else round(coalesce(v_tgt.extra_seat_monthly_kes, 0) * coalesce(v_sub.extra_seats, 0), 0)
      end;
    v_quote := public.billing_proration_quote(v_cur_price, v_new_price, v_start, v_end, now());
  end if;

  update public.tenant_subscriptions
  set package_id = v_tgt.package_id,
      package_version_id = v_tgt.version_id,
      period = v_period,
      term_start = case when v_period = 'year' and v_sub.period = 'month' then now() else coalesce(term_start, current_period_start) end,
      term_end = case
        when v_period = 'year' and v_sub.period = 'month' then public.billing_add_months(now(), 12)
        else coalesce(term_end, current_period_end)
      end,
      pending_package_id = null,
      pending_period = null,
      pending_change = null,
      pending_effective_at = null,
      pending_set_at = null,
      pending_actor = null,
      updated_at = now()
  where tenant_id = p_tenant_id;

  perform public._owner_apply_allowances(p_tenant_id, v_tgt.version_id, v_sub.extra_seats);

  v_invoice := public._owner_open_proration_invoice(
    p_tenant_id,
    (v_quote->>'credit_kes')::numeric,
    (v_quote->>'charge_kes')::numeric,
    'Credit for unused ' || coalesce(v_cur_name, 'plan') || ' ('
      || (v_quote->>'days_left') || ' of ' || (v_quote->>'days_in_period') || ' days)',
    case
      when v_period = 'year' and v_sub.period = 'month'
        then v_tgt.package_name || ', yearly'
      else v_tgt.package_name || ' for the rest of this period ('
        || (v_quote->>'days_left') || ' of ' || (v_quote->>'days_in_period') || ' days)'
    end,
    v_start,
    v_end
  );

  v_result := v_quote || jsonb_build_object(
    'ok', true, 'code', 'upgraded', 'package_sku', v_tgt.sku, 'period', v_period,
    'invoice_id', v_invoice,
    'message', 'The unused part of this period is credited. The new plan is charged for the rest.'
  );
  return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_change_plan', v_result);
end;
$$;

comment on function public.owner_change_plan(uuid, uuid, text, text, text) is
  'Owner or admin plan change. Beta returns beta and writes nothing but the audit. Upgrade and monthly to annual open a proration invoice. Downgrade and annual to monthly wait for the renewal.';

revoke all on function public.owner_change_plan(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.owner_change_plan(uuid, uuid, text, text, text) to service_role;

create or replace function public.owner_cancel_plan_change(
  p_tenant_id uuid,
  p_actor uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gate jsonb;
  v_key text;
  v_sub public.tenant_subscriptions%rowtype;
  v_tenant public.tenants%rowtype;
begin
  v_gate := public._owner_billing_gate(p_tenant_id, p_actor, p_idempotency_key, 'owner_cancel_plan_change');
  if (v_gate->>'stop')::boolean then
    return v_gate->'result';
  end if;
  v_key := v_gate->>'key';

  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  select * into v_sub from public.tenant_subscriptions where tenant_id = p_tenant_id for update;
  if coalesce(v_tenant.billing_enforcement, 'off') = 'off' or v_sub.billing_status = 'beta' then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_cancel_plan_change',
      jsonb_build_object('ok', true, 'code', 'beta',
        'message', 'Billing is off for this business. Nothing was changed.'));
  end if;
  if v_sub.pending_change is null then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_cancel_plan_change',
      jsonb_build_object('ok', true, 'code', 'nothing_scheduled',
        'message', 'There is no scheduled change to cancel.'));
  end if;

  update public.tenant_subscriptions
  set pending_package_id = null,
      pending_period = null,
      pending_change = null,
      pending_effective_at = null,
      pending_set_at = null,
      pending_actor = null,
      updated_at = now()
  where tenant_id = p_tenant_id;

  return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_cancel_plan_change',
    jsonb_build_object('ok', true, 'code', 'change_cancelled',
      'message', 'The scheduled change was cancelled. The current plan stays.'));
end;
$$;

revoke all on function public.owner_cancel_plan_change(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.owner_cancel_plan_change(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Extra seats. Prorated onto the next invoice (a draft, not collected).
-- ---------------------------------------------------------------------------
create or replace function public._owner_next_invoice_line(
  p_tenant_id uuid,
  p_description text,
  p_amount numeric,
  p_start timestamptz,
  p_end timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_sum numeric;
begin
  select id into v_id
  from public.invoices
  where tenant_id = p_tenant_id and billing_source = 'next' and status = 'draft'
  for update;
  if v_id is null then
    insert into public.invoices (
      tenant_id, status, currency, subtotal_kes, total_kes,
      period_start, period_end, billing_source
    ) values (
      p_tenant_id, 'draft', 'KES', 0, 0, p_start, p_end, 'next'
    ) returning id into v_id;
  end if;
  insert into public.invoice_lines (
    invoice_id, tenant_id, description, quantity, unit_amount_kes, amount_kes, sort_order
  ) values (
    v_id, p_tenant_id, p_description, 1, p_amount, p_amount,
    (select coalesce(max(sort_order), 0) + 1 from public.invoice_lines where invoice_id = v_id)
  );
  select coalesce(sum(amount_kes), 0) into v_sum from public.invoice_lines where invoice_id = v_id;
  update public.invoices
  set subtotal_kes = greatest(v_sum, 0),
      total_kes = greatest(v_sum, 0),
      updated_at = now()
  where id = v_id;
  return v_id;
end;
$$;

revoke all on function public._owner_next_invoice_line(uuid, text, numeric, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public._owner_next_invoice_line(uuid, text, numeric, timestamptz, timestamptz) to service_role;

create or replace function public.owner_set_extra_seats(
  p_tenant_id uuid,
  p_actor uuid,
  p_extra_seats integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gate jsonb;
  v_key text;
  v_tenant public.tenants%rowtype;
  v_sub public.tenant_subscriptions%rowtype;
  v_ver public.billing_package_versions%rowtype;
  v_extra integer := p_extra_seats;
  v_delta integer;
  v_used integer;
  v_days integer;
  v_left integer;
  v_unit numeric;
  v_amount numeric;
  v_start timestamptz;
  v_end timestamptz;
  v_invoice uuid;
  v_name text;
begin
  v_gate := public._owner_billing_gate(p_tenant_id, p_actor, p_idempotency_key, 'owner_set_extra_seats');
  if (v_gate->>'stop')::boolean then
    return v_gate->'result';
  end if;
  v_key := v_gate->>'key';

  if v_extra is null or v_extra < 0 or v_extra > 100 then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_set_extra_seats',
      jsonb_build_object('ok', false, 'code', 'invalid_seats',
        'message', 'Extra seats must be a whole number from 0 to 100.'));
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  select * into v_sub from public.tenant_subscriptions where tenant_id = p_tenant_id for update;
  if not found or v_sub.status <> 'active' then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_set_extra_seats',
      jsonb_build_object('ok', false, 'code', 'no_package',
        'message', 'This business has no plan.'));
  end if;
  if coalesce(v_tenant.billing_enforcement, 'off') = 'off' or v_sub.billing_status = 'beta' then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_set_extra_seats',
      jsonb_build_object('ok', true, 'code', 'beta',
        'message', 'Billing is off for this business. Nothing was changed.'));
  end if;
  if v_sub.billing_status <> 'active' then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_set_extra_seats',
      jsonb_build_object('ok', false, 'code', 'not_active',
        'message', 'Seats can change when billing is active.'));
  end if;

  select * into v_ver from public.billing_package_versions where id = v_sub.package_version_id;
  select p.name into v_name from public.billing_packages p where p.id = v_sub.package_id;
  if v_ver.extra_seat_monthly_kes is null then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_set_extra_seats',
      jsonb_build_object('ok', false, 'code', 'seat_price_missing',
        'message', 'This plan has no extra-seat price.'));
  end if;

  v_delta := v_extra - coalesce(v_sub.extra_seats, 0);
  v_used := public.billing_seats_used(p_tenant_id);
  if v_used > v_ver.seats + v_extra then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_set_extra_seats',
      jsonb_build_object(
        'ok', false, 'code', 'seats_in_use',
        'seats_included', v_ver.seats + v_extra, 'seats_used', v_used,
        'message', 'This business has ' || v_used::text
          || ' people (members and pending invites). Keep at least that many seats.'
      ));
  end if;
  if v_delta = 0 then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_set_extra_seats',
      jsonb_build_object('ok', true, 'code', 'same', 'extra_seats', v_extra,
        'message', 'Extra seats are already ' || v_extra::text || '.'));
  end if;

  v_start := coalesce(v_sub.term_start, v_sub.current_period_start);
  v_end := coalesce(v_sub.term_end, v_sub.current_period_end);
  select d.days_in_period, d.days_left into v_days, v_left
  from public.billing_period_days(v_start, v_end, now()) d;

  if v_sub.period = 'year' then
    v_unit := round(v_ver.extra_seat_monthly_kes * 12 * (100 - v_ver.annual_discount_percent) / 100, 0);
  else
    v_unit := round(v_ver.extra_seat_monthly_kes, 0);
  end if;
  v_amount := public.billing_prorate_kes(v_unit * v_delta, v_left, v_days);
  -- A removal prorates a negative price. billing_prorate_kes ignores negatives,
  -- so apply the sign here.
  if v_delta < 0 then
    v_amount := -public.billing_prorate_kes(v_unit * abs(v_delta), v_left, v_days);
  end if;

  update public.tenant_subscriptions
  set extra_seats = v_extra, updated_at = now()
  where tenant_id = p_tenant_id;
  perform public._owner_apply_allowances(p_tenant_id, v_ver.id, v_extra);

  if v_amount <> 0 then
    v_invoice := public._owner_next_invoice_line(
      p_tenant_id,
      case when v_delta > 0
        then 'Extra seats (' || v_delta::text || ') for ' || v_left::text || ' of ' || v_days::text || ' days'
        else 'Removed seats (' || abs(v_delta)::text || ') for ' || v_left::text || ' of ' || v_days::text || ' days'
      end,
      v_amount,
      v_sub.current_period_end,
      public.billing_add_months(v_sub.current_period_end, 1)
    );
  end if;

  return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_set_extra_seats',
    jsonb_build_object(
      'ok', true, 'code', 'seats_updated', 'extra_seats', v_extra, 'delta', v_delta,
      'unit_kes', v_unit, 'amount_kes', v_amount, 'invoice_id', v_invoice,
      'days_left', v_left, 'days_in_period', v_days,
      'seat_price_kes', v_ver.extra_seat_monthly_kes, 'package_name', v_name,
      'message', 'Extra seats are on the next invoice. Nothing is collected today.'
    ));
end;
$$;

comment on function public.owner_set_extra_seats(uuid, uuid, integer, text) is
  'Sets the extra-seat count. Price is the pinned version extra_seat_monthly_kes. The prorated amount is a draft line on the next invoice.';

revoke all on function public.owner_set_extra_seats(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.owner_set_extra_seats(uuid, uuid, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Spend limit. Null soft_spend_limit_kes means the pinned monthly price
--    times spend_limit_share_percent. That column is added by the package
--    version editor. When it is absent or null, the share is 50. Enforcement
--    off never blocks. A stored soft_spend_limit_kes still wins.
-- ---------------------------------------------------------------------------
create or replace function public.billing_spend_limit_kes(p_tenant_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants%rowtype;
  v_monthly numeric;
  v_share numeric := 50;
begin
  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then
    return null;
  end if;
  if coalesce(v_tenant.billing_enforcement, 'off') = 'off' then
    return null;
  end if;
  if v_tenant.soft_spend_limit_kes is not null then
    return round(v_tenant.soft_spend_limit_kes, 0);
  end if;
  if exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.billing_package_versions'::regclass
      and attname = 'spend_limit_share_percent'
      and attnum > 0
      and not attisdropped
  ) then
    execute
      'select v.monthly_price_kes, v.spend_limit_share_percent
         from public.tenant_subscriptions s
         join public.billing_package_versions v on v.id = s.package_version_id
        where s.tenant_id = $1'
      into v_monthly, v_share
      using p_tenant_id;
    v_share := coalesce(v_share, 50);
  else
    select v.monthly_price_kes into v_monthly
    from public.tenant_subscriptions s
    join public.billing_package_versions v on v.id = s.package_version_id
    where s.tenant_id = p_tenant_id;
  end if;
  if v_monthly is null then
    return null;
  end if;
  return round(v_monthly * v_share / 100, 0);
end;
$$;

comment on function public.billing_spend_limit_kes(uuid) is
  'On-demand spend cap for the usage period. The stored column when set, otherwise the pinned monthly price times spend_limit_share_percent. The share is 50 when that column is absent or null. Null when billing is off.';

revoke all on function public.billing_spend_limit_kes(uuid) from public, anon, authenticated;
grant execute on function public.billing_spend_limit_kes(uuid) to service_role;

create or replace function public.billing_period_on_demand_kes(p_tenant_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_sum numeric;
begin
  if to_regclass('public.wallet_ledger') is null then
    return 0;
  end if;
  select s.current_period_start, s.current_period_end
    into v_start, v_end
  from public.tenant_subscriptions s
  where s.tenant_id = p_tenant_id;
  select coalesce(sum(-wl.amount_kes), 0) into v_sum
  from public.wallet_ledger wl
  where wl.tenant_id = p_tenant_id
    and wl.amount_kes < 0
    and wl.kind in ('call_charge', 'sms_charge')
    and coalesce(wl.metadata->>'on_demand', '') = 'true'
    and (v_start is null or wl.created_at >= v_start)
    and (v_end is null or wl.created_at < v_end);
  return coalesce(v_sum, 0);
end;
$$;

revoke all on function public.billing_period_on_demand_kes(uuid) from public, anon, authenticated;
grant execute on function public.billing_period_on_demand_kes(uuid) to service_role;

create or replace function public._billing_mark_spend_blocked(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_changed boolean := false;
begin
  select current_period_start into v_start
  from public.tenant_subscriptions where tenant_id = p_tenant_id;
  update public.tenant_subscriptions
  set spend_limit_held_period = v_start
  where tenant_id = p_tenant_id
    and spend_limit_held_period is distinct from v_start;
  if found then
    v_changed := true;
  end if;
  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants
  set spend_limit_blocked = true
  where id = p_tenant_id and spend_limit_blocked is distinct from true;
  if found then
    v_changed := true;
  end if;
  if v_changed then
    perform public._billing_audit(
      'system',
      'spend_limit_held',
      p_tenant_id,
      jsonb_build_object('period_start', v_start, 'spent_kes', public.billing_period_on_demand_kes(p_tenant_id))
    );
  end if;
end;
$$;

revoke all on function public._billing_mark_spend_blocked(uuid) from public, anon, authenticated;
grant execute on function public._billing_mark_spend_blocked(uuid) to service_role;

create or replace function public.billing_on_demand_open(p_tenant_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants%rowtype;
  v_held timestamptz;
  v_start timestamptz;
  v_limit numeric;
  v_spent numeric;
begin
  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then
    return false;
  end if;
  if coalesce(v_tenant.billing_enforcement, 'off') = 'off' then
    return coalesce(v_tenant.on_demand_usage_enabled, false);
  end if;
  if not coalesce(v_tenant.on_demand_usage_enabled, false) then
    return false;
  end if;
  select spend_limit_held_period, current_period_start into v_held, v_start
  from public.tenant_subscriptions where tenant_id = p_tenant_id;
  if v_held is not null and v_start is not null and v_held = v_start then
    return false;
  end if;
  if v_tenant.spend_limit_blocked and v_held is not null and v_held = v_start then
    return false;
  end if;
  v_limit := public.billing_spend_limit_kes(p_tenant_id);
  if v_limit is null then
    return true;
  end if;
  v_spent := public.billing_period_on_demand_kes(p_tenant_id);
  if v_spent >= v_limit then
    return false;
  end if;
  return true;
end;
$$;

comment on function public.billing_on_demand_open(uuid) is
  'Whether another on-demand charge is allowed. Beta returns the on-demand flag and does not enforce. A reached spend limit returns false, same as on-demand off.';

revoke all on function public.billing_on_demand_open(uuid) from public, anon, authenticated;
grant execute on function public.billing_on_demand_open(uuid) to service_role;

create or replace function public.billing_spend_allows_charge(
  p_tenant_id uuid,
  p_amount numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants%rowtype;
  v_limit numeric;
  v_spent numeric;
begin
  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then
    return false;
  end if;
  if coalesce(v_tenant.billing_enforcement, 'off') = 'off' then
    return true;
  end if;
  if coalesce(p_amount, 0) <= 0 then
    return true;
  end if;
  if not public.billing_on_demand_open(p_tenant_id) then
    if coalesce(v_tenant.on_demand_usage_enabled, false) then
      perform public._billing_mark_spend_blocked(p_tenant_id);
    end if;
    return false;
  end if;
  v_limit := public.billing_spend_limit_kes(p_tenant_id);
  if v_limit is null then
    return true;
  end if;
  v_spent := public.billing_period_on_demand_kes(p_tenant_id);
  if v_spent + p_amount > v_limit then
    perform public._billing_mark_spend_blocked(p_tenant_id);
    return false;
  end if;
  return true;
end;
$$;

comment on function public.billing_spend_allows_charge(uuid, numeric) is
  'False when this on-demand amount would pass the period spend limit. Sets spend_limit_blocked. Beta always allows (the caller still does not debit).';

revoke all on function public.billing_spend_allows_charge(uuid, numeric) from public, anon, authenticated;
grant execute on function public.billing_spend_allows_charge(uuid, numeric) to service_role;

create or replace function public.owner_set_spend_limit(
  p_tenant_id uuid,
  p_actor uuid,
  p_limit_kes numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gate jsonb;
  v_key text;
  v_tenant public.tenants%rowtype;
  v_sub public.tenant_subscriptions%rowtype;
  v_limit numeric := p_limit_kes;
begin
  v_gate := public._owner_billing_gate(p_tenant_id, p_actor, p_idempotency_key, 'owner_set_spend_limit');
  if (v_gate->>'stop')::boolean then
    return v_gate->'result';
  end if;
  v_key := v_gate->>'key';

  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  select * into v_sub from public.tenant_subscriptions where tenant_id = p_tenant_id;
  if coalesce(v_tenant.billing_enforcement, 'off') = 'off' or v_sub.billing_status = 'beta' then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_set_spend_limit',
      jsonb_build_object('ok', true, 'code', 'beta',
        'message', 'Billing is off for this business. Nothing was changed.'));
  end if;

  if v_limit is not null and v_limit <> 0 then
    v_limit := round(v_limit, 0);
    if v_limit < 500 or v_limit > 1000000 then
      return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_set_spend_limit',
        jsonb_build_object('ok', false, 'code', 'invalid_spend_limit',
          'message', 'The spend limit must be between KSh 500 and KSh 1,000,000.'));
    end if;
  else
    v_limit := null;
  end if;

  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants
  set soft_spend_limit_enabled = v_limit is not null,
      soft_spend_limit_kes = v_limit
  where id = p_tenant_id;

  return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_set_spend_limit',
    jsonb_build_object(
      'ok', true, 'code', 'spend_limit_updated',
      'soft_spend_limit_kes', v_limit,
      'effective_limit_kes', public.billing_spend_limit_kes(p_tenant_id),
      'message', case
        when v_limit is null then 'The spend limit follows the plan.'
        else 'The spend limit is saved.'
      end
    ));
end;
$$;

revoke all on function public.owner_set_spend_limit(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.owner_set_spend_limit(uuid, uuid, numeric, text) to service_role;

-- Clear the hold when the usage period rolls.
create or replace function public.tenant_subscriptions_clear_spend_hold()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.current_period_start is distinct from old.current_period_start then
    new.spend_limit_held_period := null;
    perform set_config('scalers.wallet_write', '1', true);
    update public.tenants
    set spend_limit_blocked = false
    where id = new.tenant_id and spend_limit_blocked;
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_subscriptions_clear_spend_hold on public.tenant_subscriptions;
create trigger tenant_subscriptions_clear_spend_hold
  before update on public.tenant_subscriptions
  for each row execute function public.tenant_subscriptions_clear_spend_hold();

-- PATCHED_FUNCTIONS_BELOW

-- ---------------------------------------------------------------------------
-- 6. Usage hooks. These replace the bodies in package_minute_consume.sql,
--    notify_send_reserve_settle.sql, and billing_data_layer.sql. Re-apply
--    this file after any of those, or the spend-limit stop is dropped.
--    Signature of tenant_escalation_allowed stays (uuid) -> (allowed, reason).
-- ---------------------------------------------------------------------------

create or replace function public.consume_call_seconds(
  p_call_id uuid,
  p_seconds integer,
  p_direction text default 'inbound'
)
returns table (
  metered boolean,
  reason text,
  seconds_applied integer,
  overage_seconds integer,
  amount_kes numeric,
  seconds_used integer,
  minutes_included integer,
  already_applied boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_call record;
  v_tenant record;
  v_total integer := greatest(coalesce(p_seconds, 0), 0);
  v_applied integer;
  v_delta integer;
  v_included_seconds integer;
  v_used integer;
  v_room integer;
  v_overage integer;
  v_enforcement text;
  v_ondemand boolean;
  v_rate numeric := 0;
  v_amount numeric := 0;
  v_reason text := 'included';
  v_new_applied integer;
begin
  if p_call_id is null then
    raise exception 'call_id required';
  end if;

  select
    c.id,
    c.tenant_id,
    coalesce(c.package_seconds_applied, 0) as package_seconds_applied
    into v_call
  from public.calls c
  where c.id = p_call_id
  for update;

  if not found then
    raise exception 'call not found';
  end if;

  v_applied := coalesce(v_call.package_seconds_applied, 0);
  v_delta := v_total - v_applied;
  if v_delta <= 0 then
    metered := true;
    reason := 'already_applied';
    seconds_applied := v_applied;
    overage_seconds := 0;
    amount_kes := 0;
    seconds_used := null;
    minutes_included := null;
    already_applied := true;
    return next;
    return;
  end if;

  select
    coalesce(t.billing_enforcement, 'off') as billing_enforcement,
    coalesce(t.on_demand_usage_enabled, false) as on_demand_usage_enabled,
    coalesce(t.minutes_included, 0) as minutes_included,
    coalesce(t.seconds_used, 0) as seconds_used
    into v_tenant
  from public.tenants t
  where t.id = v_call.tenant_id
  for update;

  if not found then
    raise exception 'tenant not found';
  end if;

  v_enforcement := v_tenant.billing_enforcement;
  v_ondemand := v_tenant.on_demand_usage_enabled;
  v_included_seconds := v_tenant.minutes_included * 60;
  v_used := v_tenant.seconds_used;
  v_room := greatest(v_included_seconds - v_used, 0);
  v_overage := greatest(v_delta - v_room, 0);
  v_new_applied := v_applied + v_delta;

  if v_overage > 0 then
    v_reason := 'cap';
  end if;

  -- branch: beta meter no debit
  if v_enforcement = 'off' then
    v_reason := 'beta';
    v_amount := 0;
  elsif v_overage > 0 and v_ondemand then
    -- branch: on_demand debit overage seconds
    v_reason := 'on_demand';
    select case
      when lower(coalesce(p_direction, 'inbound')) = 'outbound'
        then r.outbound_kes_per_second
      else r.inbound_kes_per_second
    end
      into v_rate
    from public.billing_rate_card r
    where r.id = 1;
    v_rate := coalesce(v_rate, 0);
    if v_rate < 0 then
      v_rate := 0;
    end if;
    v_amount := round(v_overage * v_rate, 2);
    if v_amount < 0 then
      v_amount := 0;
    end if;
  else
    -- branch: cap meter no debit (and included)
    v_amount := 0;
  end if;

  -- Spend limit: meter the seconds already on this call, but do not debit
  -- once the period on-demand total would pass the limit. The next call is
  -- refused by spend_limit_blocked, the same way on-demand off refuses.
  if v_reason = 'on_demand' and v_amount > 0
     and not public.billing_spend_allows_charge(v_call.tenant_id, v_amount) then
    v_amount := 0;
    v_reason := 'spend_limit';
  end if;

  -- A legacy charge_call_to_wallet row already took money for this call id.
  if v_amount > 0 and exists (
    select 1
    from public.wallet_ledger wl
    where wl.tenant_id = v_call.tenant_id
      and wl.kind = 'call_charge'
      and wl.reference_id = p_call_id::text
  ) then
    v_amount := 0;
    v_reason := 'legacy_charged';
  end if;

  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants
    set seconds_used = v_used + v_delta
    where id = v_call.tenant_id;
  update public.calls
    set package_seconds_applied = v_new_applied
    where id = p_call_id;

  if v_amount > 0 then
    perform public._wallet_apply_delta(
      v_call.tenant_id,
      'call_charge',
      -v_amount,
      'call',
      p_call_id::text || ':' || v_new_applied::text,
      'Overage seconds',
      jsonb_build_object(
        'overage_seconds', v_overage,
        'direction', case
          when lower(coalesce(p_direction, 'inbound')) = 'outbound' then 'outbound'
          else 'inbound'
        end,
        'kes_per_second', v_rate,
        'on_demand', true
      )
    );
  end if;

  metered := true;
  reason := v_reason;
  seconds_applied := v_new_applied;
  overage_seconds := v_overage;
  amount_kes := v_amount;
  seconds_used := v_used + v_delta;
  minutes_included := v_tenant.minutes_included;
  already_applied := false;
  return next;
end;
$$;

comment on function public.consume_call_seconds(uuid, integer, text) is
  'Meter talk seconds into the package pool. Debit on-demand overage only when enforcement is not off and the spend limit still has room.';

revoke all on function public.consume_call_seconds(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.consume_call_seconds(uuid, integer, text)
  to service_role;

create or replace function public.consume_sms_units(
  p_tenant_id uuid,
  p_units integer
)
returns table (
  allowed boolean,
  reason text,
  overage boolean,
  sms_used_units integer,
  sms_included_units integer,
  remaining integer,
  on_demand_usage_enabled boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant record;
  v_units integer := greatest(coalesce(p_units, 1), 1);
  v_enforcement text;
  v_ondemand boolean;
  v_included integer;
  v_used integer;
  v_overage_units integer;
  v_rate numeric := 0;
  v_amount numeric := 0;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;

  if auth.uid() is not null and coalesce(auth.role(), '') = 'authenticated' then
    if p_tenant_id not in (select public.current_user_tenant_ids()) then
      raise exception 'not allowed';
    end if;
  end if;

  select
    t.billing_enforcement,
    coalesce(t.on_demand_usage_enabled, false) as on_demand_usage_enabled,
    coalesce(t.sms_included_units, 200) as sms_included_units,
    coalesce(t.sms_used_units, 0) as sms_used_units
    into v_tenant
  from public.tenants t
  where t.id = p_tenant_id
  for update;

  if not found then
    raise exception 'tenant not found';
  end if;

  v_enforcement := coalesce(v_tenant.billing_enforcement, 'off');
  v_ondemand := v_tenant.on_demand_usage_enabled;
  v_included := v_tenant.sms_included_units;
  v_used := v_tenant.sms_used_units;

  -- branch: beta meter no debit
  if v_enforcement = 'off' then
    perform set_config('scalers.wallet_write', '1', true);
    update public.tenants
      set sms_used_units = v_used + v_units
      where id = p_tenant_id;
    allowed := true;
    reason := 'beta';
    overage := false;
    sms_used_units := v_used + v_units;
    sms_included_units := v_included;
    remaining := v_included - (v_used + v_units);
    on_demand_usage_enabled := v_ondemand;
    return next;
    return;
  end if;

  if v_used + v_units <= v_included then
    perform set_config('scalers.wallet_write', '1', true);
    update public.tenants
      set sms_used_units = v_used + v_units
      where id = p_tenant_id;
    allowed := true;
    reason := 'included';
    overage := false;
    sms_used_units := v_used + v_units;
    sms_included_units := v_included;
    remaining := v_included - (v_used + v_units);
    on_demand_usage_enabled := v_ondemand;
    return next;
    return;
  end if;

  if v_ondemand then
    v_overage_units := least(v_units, greatest(0, (v_used + v_units) - v_included));
    if to_regclass('public.billing_rate_card') is not null then
      select r.sms_kes into v_rate
      from public.billing_rate_card r
      where r.id = 1;
    end if;
    v_rate := coalesce(v_rate, 0);
    if v_rate < 0 then
      v_rate := 0;
    end if;
    v_amount := round(v_overage_units * v_rate, 2);
    if not public.billing_spend_allows_charge(p_tenant_id, v_amount) then
      allowed := false;
      reason := 'spend_limit';
      overage := false;
      sms_used_units := v_used;
      sms_included_units := v_included;
      remaining := v_included - v_used;
      on_demand_usage_enabled := v_ondemand;
      return next;
      return;
    end if;
    perform set_config('scalers.wallet_write', '1', true);
    update public.tenants
      set sms_used_units = v_used + v_units
      where id = p_tenant_id;
    -- branch: sms on_demand debit
    if v_amount > 0 then
      perform public._wallet_apply_delta(
        p_tenant_id,
        'sms_charge',
        -v_amount,
        'sms',
        p_tenant_id::text || ':' || (v_used + v_units)::text,
        'Overage SMS',
        jsonb_build_object(
          'units', v_overage_units,
          'sms_kes', v_rate,
          'on_demand', true
        )
      );
    end if;
    allowed := true;
    reason := 'on_demand';
    overage := true;
    sms_used_units := v_used + v_units;
    sms_included_units := v_included;
    remaining := v_included - (v_used + v_units);
    on_demand_usage_enabled := v_ondemand;
    return next;
    return;
  end if;

  -- branch: sms cap no debit
  allowed := false;
  reason := 'sms_allowance_exhausted';
  overage := false;
  sms_used_units := v_used;
  sms_included_units := v_included;
  remaining := v_included - v_used;
  on_demand_usage_enabled := v_ondemand;
  return next;
end;
$$;

comment on function public.consume_sms_units(uuid, integer) is
  'Claim tenant SMS. Beta meters. Paid stops at included unless on-demand. On-demand debits sms_kes unless the spend limit would be exceeded.';

revoke all on function public.consume_sms_units(uuid, integer)
  from public, anon;
grant execute on function public.consume_sms_units(uuid, integer)
  to authenticated, service_role;

create or replace function public.reserve_notify_send(
  p_tenant_id uuid,
  p_idempotency_key text,
  p_kind text,
  p_channel text,
  p_recipient text default null,
  p_body text default null,
  p_units integer default null,
  p_call_id uuid default null,
  p_call_sid text default null,
  p_audience text default null,
  p_billed_to text default null,
  p_strict boolean default false
)
returns table (
  send_id uuid,
  allowed boolean,
  replayed boolean,
  status text,
  outcome text,
  reason text,
  overage boolean,
  units integer,
  held_units integer,
  sms_used_units integer,
  sms_included_units integer,
  remaining integer,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_kind text := nullif(trim(coalesce(p_kind, '')), '');
  v_channel text := lower(trim(coalesce(p_channel, '')));
  v_billed text;
  v_aud text;
  v_units integer;
  v_metered boolean;
  v_t record;
  v_enf text := 'off';
  v_od boolean := false;
  v_inc integer := null;
  v_used integer := null;
  v_row public.notify_sends%rowtype;
  v_found boolean := false;
  v_allowed boolean;
  v_outcome text;
  v_reason text;
  v_status text;
  v_held integer := 0;
  v_id uuid;
  v_attempts integer := 1;
  v_over integer := 0;
  v_rate numeric := 0;
begin
  if v_key is null then raise exception 'idempotency_key required'; end if;
  if v_kind is null then raise exception 'kind required'; end if;
  if v_channel not in ('sms', 'whatsapp', 'email') then
    raise exception 'channel must be sms, whatsapp or email';
  end if;

  v_billed := coalesce(nullif(p_billed_to, ''),
                       case when p_tenant_id is null then 'platform' else 'tenant' end);
  v_aud := coalesce(nullif(p_audience, ''),
                    case when p_tenant_id is null then 'platform' else 'staff' end);
  if p_tenant_id is null and v_billed <> 'platform' then
    raise exception 'tenant_id required for tenant-billed sends';
  end if;
  v_units := case when v_channel = 'sms' then greatest(coalesce(p_units, 1), 1) else 1 end;
  v_metered := p_tenant_id is not null and v_billed = 'tenant' and v_channel = 'sms';

  -- Desk (authenticated) may only reserve caller SMS for its own tenant.
  if auth.uid() is not null and coalesce(auth.role(), '') = 'authenticated' then
    if p_tenant_id is null
      or p_tenant_id not in (select public.current_user_tenant_ids())
      or v_aud <> 'caller' or v_billed <> 'tenant' or v_channel <> 'sms'
    then
      raise exception 'not allowed';
    end if;
  end if;

  -- Serialize: tenant row lock (also guards the counter); platform rows by key.
  if p_tenant_id is not null then
    select t.billing_enforcement,
           coalesce(t.on_demand_usage_enabled, false) as od,
           coalesce(t.sms_included_units, 200) as inc,
           coalesce(t.sms_used_units, 0) as used
      into v_t
    from public.tenants t
    where t.id = p_tenant_id
    for update;
    if not found then raise exception 'tenant not found'; end if;
    v_enf := coalesce(v_t.billing_enforcement, 'off');
    v_od := v_t.od;
    v_inc := v_t.inc;
    v_used := v_t.used;
    -- Only an overage SMS consults the spend limit. Included units stay.
    if v_od and v_metered and (v_used + v_units) > v_inc then
      v_over := least(v_units, greatest(0, (v_used + v_units) - v_inc));
      v_rate := 0;
      if to_regclass('public.billing_rate_card') is not null then
        select r.sms_kes into v_rate from public.billing_rate_card r where r.id = 1;
      end if;
      v_rate := coalesce(v_rate, 0);
      if v_rate < 0 then
        v_rate := 0;
      end if;
      if not public.billing_spend_allows_charge(p_tenant_id, round(v_over * v_rate, 2)) then
        v_od := false;
      end if;
    elsif v_od and not public.billing_on_demand_open(p_tenant_id) then
      v_od := false;
    end if;
  else
    perform pg_advisory_xact_lock(hashtext('notify_sends:' || v_key));
  end if;

  select * into v_row
  from public.notify_sends n
  where n.tenant_id is not distinct from p_tenant_id
    and n.idempotency_key = v_key
  for update;
  v_found := found;

  if v_found and v_row.status in ('pending', 'sent') then
    send_id := v_row.id;
    allowed := false;
    replayed := true;
    status := v_row.status;
    outcome := v_row.outcome;
    reason := case when v_row.status = 'sent' then 'already_sent' else 'in_flight' end;
    overage := coalesce(v_row.overage, false);
    units := v_row.units;
    held_units := v_row.held_units;
    sms_used_units := v_used;
    sms_included_units := v_inc;
    remaining := case when v_inc is null then null else v_inc - v_used end;
    attempts := v_row.attempts;
    return next;
    return;
  end if;

  -- Allowance decision (same rules as consume_sms_units + p_strict handoff rule).
  if not v_metered then
    v_allowed := true;
    v_outcome := case when v_billed = 'platform' then 'platform' else 'not_metered' end;
    v_reason := v_outcome;
  elsif v_used + v_units <= v_inc then
    v_allowed := true; v_outcome := 'included'; v_reason := 'included';
  elsif v_od then
    v_allowed := true; v_outcome := 'on_demand'; v_reason := 'on_demand';
  elsif v_enf = 'off' and not coalesce(p_strict, false) then
    v_allowed := true; v_outcome := 'beta'; v_reason := 'beta';
  else
    v_allowed := false; v_outcome := 'refused'; v_reason := 'sms_allowance_exhausted';
  end if;

  v_status := case when v_allowed then 'pending' else 'refused' end;
  v_held := case when v_allowed and v_metered then v_units else 0 end;

  -- Row first, counter second: a lost race never counts without a row.
  if v_found then
    perform set_config('scalers.notify_settle', '1', true);
    update public.notify_sends n
      set status = v_status,
          channel = v_channel,
          recipient = nullif(trim(coalesce(p_recipient, '')), ''),
          body = left(coalesce(p_body, ''), 2000),
          units = v_units,
          held_units = v_held,
          outcome = v_outcome,
          overage = (v_outcome = 'on_demand'),
          provider_message_id = null,
          failure_reason = case when v_allowed then null else v_reason end,
          attempts = n.attempts + 1,
          reserved_at = now(),
          settled_at = case when v_allowed then null else now() end
      where n.id = v_row.id
      returning n.id, n.attempts into v_id, v_attempts;
    perform set_config('scalers.notify_settle', '0', true);
  else
    insert into public.notify_sends as n (
      tenant_id, call_id, call_sid, kind, channel, recipient, audience, billed_to,
      units, body, idempotency_key, overage, status, held_units, outcome,
      failure_reason, attempts, reserved_at, settled_at
    ) values (
      p_tenant_id, p_call_id, nullif(trim(coalesce(p_call_sid, '')), ''), v_kind, v_channel,
      nullif(trim(coalesce(p_recipient, '')), ''), v_aud, v_billed,
      v_units, left(coalesce(p_body, ''), 2000), v_key, (v_outcome = 'on_demand'),
      v_status, v_held, v_outcome,
      case when v_allowed then null else v_reason end, 1, now(),
      case when v_allowed then null else now() end
    )
    on conflict do nothing
    returning n.id, n.attempts into v_id, v_attempts;

    if v_id is null then
      -- A legacy direct insert won the race: treat as already sent, count nothing.
      send_id := null; allowed := false; replayed := true; status := 'sent';
      outcome := null; reason := 'already_sent'; overage := false;
      units := v_units; held_units := 0; sms_used_units := v_used;
      sms_included_units := v_inc;
      remaining := case when v_inc is null then null else v_inc - v_used end;
      attempts := 1;
      return next;
      return;
    end if;
  end if;

  if v_held > 0 then
    perform set_config('scalers.wallet_write', '1', true);
    update public.tenants t set sms_used_units = v_used + v_held where t.id = p_tenant_id;
    perform set_config('scalers.wallet_write', '0', true);
    v_used := v_used + v_held;
  end if;

  send_id := v_id;
  allowed := v_allowed;
  replayed := false;
  status := v_status;
  outcome := v_outcome;
  reason := v_reason;
  overage := (v_outcome = 'on_demand');
  units := v_units;
  held_units := v_held;
  sms_used_units := v_used;
  sms_included_units := v_inc;
  remaining := case when v_inc is null then null else v_inc - v_used end;
  attempts := v_attempts;
  return next;
end;
$$;

comment on function public.reserve_notify_send(uuid, text, text, text, text, text, integer, uuid, text, text, text, boolean) is
  'Reserve one notify send: pending notify_sends row + SMS units in one transaction. Idempotent by key; failed/refused keys re-arm. Overage SMS stops when the spend limit would be exceeded.';

revoke all on function public.reserve_notify_send(uuid, text, text, text, text, text, integer, uuid, text, text, text, boolean)
  from public, anon;
grant execute on function public.reserve_notify_send(uuid, text, text, text, text, text, integer, uuid, text, text, text, boolean)
  to authenticated, service_role;

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
  if coalesce(v_tenant.on_demand_usage_enabled, false)
     and public.billing_on_demand_open(p_tenant_id) then
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
  'Whether SMS and WhatsApp escalation of voicemails and call updates is allowed. False means the owner dashboard Inbox only. A reached spend limit is the same as on-demand off. Inbound answering inside the allowance is not this function. Billing notices are not gated by it.';

revoke all on function public.tenant_escalation_allowed(uuid) from public, anon, authenticated;
grant execute on function public.tenant_escalation_allowed(uuid) to service_role;
