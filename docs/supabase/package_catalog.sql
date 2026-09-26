-- package_catalog.sql
-- Purpose: Super Admin package SKUs, overage rate card, tenant subscription.
--          Control plane only. Voice consume_minutes is a later apply.
-- Run after: package_entitlements.sql
-- Owners cannot write these tables. Service role only.

create table if not exists public.billing_rate_card (
  id integer primary key default 1 check (id = 1),
  inbound_kes_per_second numeric not null default 0.05,
  outbound_kes_per_second numeric not null default 0.10,
  whatsapp_kes numeric not null default 2,
  sms_kes numeric not null default 1,
  email_kes numeric not null default 1,
  annual_discount_percent numeric not null default 17,
  updated_at timestamptz not null default now(),
  constraint billing_rate_card_inbound_check check (inbound_kes_per_second >= 0),
  constraint billing_rate_card_outbound_check check (outbound_kes_per_second >= 0),
  constraint billing_rate_card_wa_check check (whatsapp_kes >= 0),
  constraint billing_rate_card_sms_check check (sms_kes >= 0),
  constraint billing_rate_card_email_check check (email_kes >= 0),
  constraint billing_rate_card_discount_check check (
    annual_discount_percent >= 0 and annual_discount_percent <= 100
  )
);

insert into public.billing_rate_card (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.billing_packages (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  monthly_price_kes numeric not null default 0,
  seats integer not null default 2,
  minutes integer not null default 300,
  sms integer not null default 200,
  email integer not null default 100,
  staff_wa integer not null default 200,
  dids integer not null default 1,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint billing_packages_sku_check check (sku ~ '^[a-z][a-z0-9_-]{1,31}$'),
  constraint billing_packages_price_check check (monthly_price_kes >= 0),
  constraint billing_packages_seats_check check (seats >= 0),
  constraint billing_packages_minutes_check check (minutes >= 0),
  constraint billing_packages_sms_check check (sms >= 0),
  constraint billing_packages_email_check check (email >= 0),
  constraint billing_packages_wa_check check (staff_wa >= 0),
  constraint billing_packages_dids_check check (dids >= 0)
);

insert into public.billing_packages (
  sku, name, monthly_price_kes, seats, minutes, sms, email, staff_wa, dids, sort_order
)
values
  ('starter', 'Starter', 0, 2, 300, 200, 100, 200, 1, 10),
  ('growth', 'Growth', 0, 5, 800, 500, 250, 500, 1, 20),
  ('scale', 'Scale', 0, 10, 2000, 1500, 500, 1000, 1, 30)
on conflict (sku) do nothing;

create table if not exists public.tenant_subscriptions (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  package_id uuid not null references public.billing_packages (id),
  period text not null default 'month',
  started_at timestamptz not null default now(),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  status text not null default 'active',
  updated_at timestamptz not null default now(),
  constraint tenant_subscriptions_period_check check (period in ('month', 'year')),
  constraint tenant_subscriptions_status_check check (status in ('active', 'cancelled'))
);

alter table public.tenants
  add column if not exists minutes_included integer not null default 0;

alter table public.tenants
  add column if not exists seconds_used integer not null default 0;

alter table public.tenants
  add column if not exists whatsapp_included_units integer not null default 0;

alter table public.tenants
  add column if not exists whatsapp_used_units integer not null default 0;

alter table public.tenants
  drop constraint if exists tenants_minutes_included_check;
alter table public.tenants
  add constraint tenants_minutes_included_check check (minutes_included >= 0);

alter table public.tenants
  drop constraint if exists tenants_seconds_used_check;
alter table public.tenants
  add constraint tenants_seconds_used_check check (seconds_used >= 0);

alter table public.tenants
  drop constraint if exists tenants_whatsapp_included_units_check;
alter table public.tenants
  add constraint tenants_whatsapp_included_units_check check (whatsapp_included_units >= 0);

alter table public.tenants
  drop constraint if exists tenants_whatsapp_used_units_check;
alter table public.tenants
  add constraint tenants_whatsapp_used_units_check check (whatsapp_used_units >= 0);

comment on column public.tenants.minutes_included is
  'Included receptionist minutes per package period.';
comment on column public.tenants.seconds_used is
  'Consumed talk seconds this period. Inbound and transfer share this pool.';
comment on column public.tenants.whatsapp_included_units is
  'Included staff WhatsApp utility sends per period.';
comment on column public.tenants.whatsapp_used_units is
  'Consumed staff WhatsApp utility sends this period.';

create or replace function public.tenants_protect_wallet_columns()
returns trigger
language plpgsql
as $$
begin
  if current_setting('scalers.wallet_write', true) = '1' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.wallet_balance_kes is distinct from old.wallet_balance_kes
      or new.wallet_low_balance_kes is distinct from old.wallet_low_balance_kes
      or new.billing_enforcement is distinct from old.billing_enforcement
      or new.telecom_wallet_balance_kes is distinct from old.telecom_wallet_balance_kes
      or new.ai_wallet_balance_usd is distinct from old.ai_wallet_balance_usd
      or new.beta_notes is distinct from old.beta_notes
      or new.beta_expires_at is distinct from old.beta_expires_at
      or new.soft_spend_limit_enabled is distinct from old.soft_spend_limit_enabled
      or new.soft_spend_limit_kes is distinct from old.soft_spend_limit_kes
      or new.on_demand_usage_enabled is distinct from old.on_demand_usage_enabled
      or new.wallet_low_alert_sent_at is distinct from old.wallet_low_alert_sent_at
      or new.wallet_empty_alert_sent_at is distinct from old.wallet_empty_alert_sent_at
      or new.line_paid_through is distinct from old.line_paid_through
      or new.line_grace_days is distinct from old.line_grace_days
      or new.line_status is distinct from old.line_status
      or new.sms_included_units is distinct from old.sms_included_units
      or new.sms_used_units is distinct from old.sms_used_units
      or new.email_included_units is distinct from old.email_included_units
      or new.email_used_units is distinct from old.email_used_units
      or new.seat_included is distinct from old.seat_included
      or new.minutes_included is distinct from old.minutes_included
      or new.seconds_used is distinct from old.seconds_used
      or new.whatsapp_included_units is distinct from old.whatsapp_included_units
      or new.whatsapp_used_units is distinct from old.whatsapp_used_units
    then
      raise exception 'wallet/billing columns are RPC-only';
    end if;
  end if;

  return new;
end;
$$;

drop function if exists public.assign_tenant_package(uuid, uuid, text);

create or replace function public.assign_tenant_package(
  p_tenant_id uuid,
  p_package_id uuid,
  p_period text default 'month'
)
returns table (
  assigned_tenant_id uuid,
  assigned_package_id uuid,
  assigned_period text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pack public.billing_packages%rowtype;
  v_period text := lower(trim(coalesce(p_period, 'month')));
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_tenant_id is null or p_package_id is null then
    raise exception 'tenant and package required';
  end if;
  if v_period not in ('month', 'year') then
    raise exception 'period must be month or year';
  end if;

  select * into v_pack from public.billing_packages where id = p_package_id;
  if not found then
    raise exception 'package not found';
  end if;

  v_start := (date_trunc('month', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi');
  if v_period = 'year' then
    v_end := v_start + interval '12 months';
  else
    v_end := v_start + interval '1 month';
  end if;

  insert into public.tenant_subscriptions (
    tenant_id, package_id, period, started_at,
    current_period_start, current_period_end, status, updated_at
  )
  values (
    p_tenant_id, p_package_id, v_period, now(),
    v_start, v_end, 'active', now()
  )
  on conflict (tenant_id) do update set
    package_id = excluded.package_id,
    period = excluded.period,
    current_period_start = excluded.current_period_start,
    current_period_end = excluded.current_period_end,
    status = 'active',
    updated_at = now();

  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants
    set
      seat_included = v_pack.seats,
      minutes_included = v_pack.minutes,
      sms_included_units = v_pack.sms,
      email_included_units = v_pack.email,
      whatsapp_included_units = v_pack.staff_wa
    where id = p_tenant_id;

  assigned_tenant_id := p_tenant_id;
  assigned_package_id := p_package_id;
  assigned_period := v_period;
  return next;
end;
$$;

revoke all on table public.billing_rate_card from public, anon, authenticated;
revoke all on table public.billing_packages from public, anon, authenticated;
revoke all on table public.tenant_subscriptions from public, anon, authenticated;
grant all on table public.billing_rate_card to service_role;
grant all on table public.billing_packages to service_role;
grant all on table public.tenant_subscriptions to service_role;

revoke all on function public.assign_tenant_package(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.assign_tenant_package(uuid, uuid, text) to service_role;

alter table public.billing_rate_card enable row level security;
alter table public.billing_packages enable row level security;
alter table public.tenant_subscriptions enable row level security;
