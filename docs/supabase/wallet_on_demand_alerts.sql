-- Prepaid low-balance live alerts + owner opt-in on-demand usage.
-- Run AFTER wallet_security_beta.sql (and wallet_soft_spend_limit.sql if applied).
-- ASCII-only (safe for Supabase SQL Editor).
--
-- Product (Cursor-like for prepaid KES):
--   1) Automatic live alerts when prepaid is running low or empty
--      (WhatsApp/email via voice engine). No owner soft-limit setup required.
--   2) On-demand usage is OFF by default. When prepaid balance <= 0:
--        on_demand_usage_enabled = false -> stop further call charges until top-up
--        on_demand_usage_enabled = true  -> keep charging (overdraft / on-demand)
--   Soft inbound call blocking remains a separate hard-enforcement step.

-- ---------------------------------------------------------------------------
-- 1) Columns
-- ---------------------------------------------------------------------------
-- Soft-spend columns may already exist from wallet_soft_spend_limit.sql; keep trigger-safe.
alter table public.tenants
  add column if not exists soft_spend_limit_enabled boolean not null default false;

alter table public.tenants
  add column if not exists soft_spend_limit_kes numeric;

alter table public.tenants
  add column if not exists on_demand_usage_enabled boolean not null default false;

alter table public.tenants
  add column if not exists wallet_low_alert_sent_at timestamptz;

alter table public.tenants
  add column if not exists wallet_empty_alert_sent_at timestamptz;

comment on column public.tenants.on_demand_usage_enabled is
  'Owner opt-in: when prepaid balance <= 0, continue charging (on-demand/overdraft). Default false.';
comment on column public.tenants.wallet_low_alert_sent_at is
  'Last automatic low-balance live alert; cleared when balance recovers above threshold.';
comment on column public.tenants.wallet_empty_alert_sent_at is
  'Last automatic empty-prepaid live alert; cleared when balance recovers above 0.';

-- ---------------------------------------------------------------------------
-- 2) Protect new billing preference / alert stamp columns
-- ---------------------------------------------------------------------------
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
    then
      raise exception 'wallet/billing columns are RPC-only';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) charge_call_to_wallet: respect on-demand when prepaid already empty
-- ---------------------------------------------------------------------------
create or replace function public.charge_call_to_wallet(
  p_call_id uuid,
  p_minutes numeric,
  p_rate_kes_per_min numeric default 15
)
returns table (
  charged boolean,
  amount_kes numeric,
  wallet_balance_kes numeric,
  already_applied boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_call record;
  v_minutes numeric;
  v_rate numeric;
  v_amount numeric;
  v_row record;
  v_enforcement text;
  v_balance numeric;
  v_ondemand boolean;
begin
  if p_call_id is null then
    raise exception 'call_id required';
  end if;

  select
    c.id,
    c.tenant_id,
    c.duration_seconds,
    c.ai_processing_minutes,
    t.billing_enforcement,
    coalesce(t.wallet_balance_kes, 0) as wallet_balance_kes,
    coalesce(t.on_demand_usage_enabled, false) as on_demand_usage_enabled
    into v_call
  from public.calls c
  join public.tenants t on t.id = c.tenant_id
  where c.id = p_call_id;

  if not found then
    raise exception 'call not found';
  end if;

  v_enforcement := coalesce(v_call.billing_enforcement, 'soft');
  v_balance := coalesce(v_call.wallet_balance_kes, 0);
  v_ondemand := coalesce(v_call.on_demand_usage_enabled, false);

  if v_enforcement = 'off' then
    charged := false;
    amount_kes := 0;
    wallet_balance_kes := v_balance;
    already_applied := false;
    return next;
    return;
  end if;

  -- Prepaid already empty and owner has not opted into on-demand: do not charge further.
  if v_balance <= 0 and not v_ondemand then
    charged := false;
    amount_kes := 0;
    wallet_balance_kes := v_balance;
    already_applied := false;
    return next;
    return;
  end if;

  v_minutes := coalesce(p_minutes, v_call.ai_processing_minutes, 0);
  if v_minutes is null or v_minutes <= 0 then
    charged := false;
    amount_kes := 0;
    wallet_balance_kes := v_balance;
    already_applied := false;
    return next;
    return;
  end if;

  v_rate := coalesce(p_rate_kes_per_min, 15);
  if v_rate < 0 then
    raise exception 'rate must be >= 0';
  end if;

  v_amount := round(v_minutes * v_rate);
  if v_amount <= 0 then
    charged := false;
    amount_kes := 0;
    wallet_balance_kes := v_balance;
    already_applied := false;
    return next;
    return;
  end if;

  select *
    into v_row
  from public._wallet_apply_delta(
    v_call.tenant_id,
    'call_charge',
    -v_amount,
    'call',
    p_call_id::text,
    'Receptionist minutes',
    jsonb_build_object(
      'minutes', v_minutes,
      'rate_kes_per_min', v_rate,
      'duration_seconds', v_call.duration_seconds,
      'on_demand', (v_balance <= 0 and v_ondemand)
    )
  );

  charged := not v_row.already_applied;
  amount_kes := v_amount;
  wallet_balance_kes := v_row.wallet_balance_kes;
  already_applied := v_row.already_applied;
  return next;
end;
$$;

revoke all on function public.charge_call_to_wallet(uuid, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.charge_call_to_wallet(uuid, numeric, numeric)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4) Claim automatic low / empty alerts (idempotent until balance recovers)
-- ---------------------------------------------------------------------------
create or replace function public.claim_wallet_balance_alerts(p_tenant_id uuid)
returns table (
  should_alert_low boolean,
  should_alert_empty boolean,
  wallet_balance_kes numeric,
  low_threshold_kes numeric,
  on_demand_usage_enabled boolean,
  billing_enforcement text,
  business_name text,
  whatsapp_notification_number text,
  alert_email text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant record;
  v_balance numeric;
  v_low numeric;
  v_alert_low boolean := false;
  v_alert_empty boolean := false;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;

  select
    t.id,
    t.business_name,
    t.whatsapp_notification_number,
    t.alert_email,
    coalesce(t.billing_enforcement, 'off') as billing_enforcement,
    coalesce(t.wallet_balance_kes, 0) as wallet_balance_kes,
    coalesce(t.wallet_low_balance_kes, 200) as wallet_low_balance_kes,
    coalesce(t.on_demand_usage_enabled, false) as on_demand_usage_enabled,
    t.wallet_low_alert_sent_at,
    t.wallet_empty_alert_sent_at
  into v_tenant
  from public.tenants t
  where t.id = p_tenant_id
  for update;

  if not found then
    raise exception 'tenant not found';
  end if;

  v_balance := coalesce(v_tenant.wallet_balance_kes, 0);
  v_low := greatest(coalesce(v_tenant.wallet_low_balance_kes, 200), 0);

  -- Beta whitelist: meter only, no prepaid alerts.
  if v_tenant.billing_enforcement = 'off' then
    should_alert_low := false;
    should_alert_empty := false;
    wallet_balance_kes := v_balance;
    low_threshold_kes := v_low;
    on_demand_usage_enabled := v_tenant.on_demand_usage_enabled;
    billing_enforcement := v_tenant.billing_enforcement;
    business_name := v_tenant.business_name;
    whatsapp_notification_number := v_tenant.whatsapp_notification_number;
    alert_email := v_tenant.alert_email;
    return next;
    return;
  end if;

  perform set_config('scalers.wallet_write', '1', true);

  -- Recovered above low threshold: allow a future low alert.
  if v_balance >= v_low and v_tenant.wallet_low_alert_sent_at is not null then
    update public.tenants
    set wallet_low_alert_sent_at = null
    where id = p_tenant_id;
    v_tenant.wallet_low_alert_sent_at := null;
  end if;

  -- Recovered above zero: allow a future empty alert.
  if v_balance > 0 and v_tenant.wallet_empty_alert_sent_at is not null then
    update public.tenants
    set wallet_empty_alert_sent_at = null
    where id = p_tenant_id;
    v_tenant.wallet_empty_alert_sent_at := null;
  end if;

  if v_balance <= 0 and v_tenant.wallet_empty_alert_sent_at is null then
    update public.tenants
    set wallet_empty_alert_sent_at = now()
    where id = p_tenant_id;
    v_alert_empty := true;
  elsif v_balance > 0 and v_balance < v_low and v_tenant.wallet_low_alert_sent_at is null then
    update public.tenants
    set wallet_low_alert_sent_at = now()
    where id = p_tenant_id;
    v_alert_low := true;
  end if;

  should_alert_low := v_alert_low;
  should_alert_empty := v_alert_empty;
  wallet_balance_kes := v_balance;
  low_threshold_kes := v_low;
  on_demand_usage_enabled := v_tenant.on_demand_usage_enabled;
  billing_enforcement := v_tenant.billing_enforcement;
  business_name := v_tenant.business_name;
  whatsapp_notification_number := v_tenant.whatsapp_notification_number;
  alert_email := v_tenant.alert_email;
  return next;
end;
$$;

revoke all on function public.claim_wallet_balance_alerts(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_wallet_balance_alerts(uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5) Owner RPC: opt in / out of on-demand usage
-- ---------------------------------------------------------------------------
create or replace function public.set_tenant_on_demand_usage(
  p_tenant_id uuid,
  p_enabled boolean
)
returns table (
  on_demand_usage_enabled boolean,
  wallet_balance_kes numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean := coalesce(p_enabled, false);
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;

  if auth.uid() is not null and coalesce(auth.role(), '') = 'authenticated' then
    if p_tenant_id not in (select public.current_user_tenant_ids()) then
      raise exception 'not allowed';
    end if;
  end if;

  perform set_config('scalers.wallet_write', '1', true);

  update public.tenants
  set on_demand_usage_enabled = v_enabled
  where id = p_tenant_id;

  if not found then
    raise exception 'tenant not found';
  end if;

  on_demand_usage_enabled := v_enabled;
  select coalesce(t.wallet_balance_kes, 0) into wallet_balance_kes
  from public.tenants t where t.id = p_tenant_id;
  return next;
end;
$$;

revoke all on function public.set_tenant_on_demand_usage(uuid, boolean)
  from public, anon;
grant execute on function public.set_tenant_on_demand_usage(uuid, boolean)
  to authenticated, service_role;
