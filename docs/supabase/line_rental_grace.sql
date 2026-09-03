-- Line rental paid-through + grace window.
-- Run AFTER wallet_on_demand_alerts.sql (18d).
--
-- Model (2026-09-03):
--   - Client pays Scalers a monthly (or later annual) line fee at our rate,
--     not SautiKit's cost. Current default: WALLET_LINE_FEE_KES_PER_MONTH.
--   - Billing enforcement off = beta. Line fee is not charged. Line stays live.
--   - Paid tenants: charging line_rental extends tenants.line_paid_through.
--   - Wallet may go negative during the grace window. The line stays live.
--   - After line_paid_through + line_grace_days, ops may suspend the DID.
-- Beta: everything free. No line fee, no suspend for non-payment.

-- ---------------------------------------------------------------------------
-- 1) Columns
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists line_paid_through timestamptz;

alter table public.tenants
  add column if not exists line_grace_days integer not null default 3;

alter table public.tenants
  add column if not exists line_status text not null default 'active';

comment on column public.tenants.line_paid_through is
  'Line rental covered until this instant. Null = never charged (beta or new).';
comment on column public.tenants.line_grace_days is
  'Days after line_paid_through during which the line stays live even if wallet is negative.';
comment on column public.tenants.line_status is
  'active | grace | suspended. Suspended DIDs should be released/disabled by ops.';

alter table public.tenants
  drop constraint if exists tenants_line_status_check;
alter table public.tenants
  add constraint tenants_line_status_check
  check (line_status in ('active', 'grace', 'suspended'));

-- ---------------------------------------------------------------------------
-- 2) Protect line columns from owner writes
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
      or new.line_paid_through is distinct from old.line_paid_through
      or new.line_grace_days is distinct from old.line_grace_days
      or new.line_status is distinct from old.line_status
    then
      raise exception 'wallet/billing columns are RPC-only';
    end if;
  end if;

  return new;
end;
$$;

-- Trigger already exists from wallet_on_demand_alerts.sql; this just widens it.

-- ---------------------------------------------------------------------------
-- 3) apply_line_rental: extend paid-through, keep line live in grace
-- ---------------------------------------------------------------------------
create or replace function public.apply_line_rental(
  p_tenant_id uuid,
  p_period text default null,
  p_amount_kes numeric default 1000
)
returns table (
  charged boolean,
  amount_kes numeric,
  wallet_balance_kes numeric,
  period text,
  already_applied boolean,
  line_paid_through timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period text;
  v_amount numeric := 1000; -- fixed retail line fee; ignore client p_amount_kes
  v_enforcement text;
  v_row record;
  v_has_did boolean;
  v_paid_through timestamptz;
  v_base timestamptz;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;

  -- Keep signature but never trust caller amount.
  if p_amount_kes is not null and p_amount_kes <> 1000 then
    null;
  end if;

  v_period := coalesce(
    nullif(trim(p_period), ''),
    to_char((now() at time zone 'UTC'), 'YYYY-MM')
  );

  select coalesce(t.billing_enforcement, 'off'),
         (
           t.sautikit_virtual_number is not null
           and t.sautikit_virtual_number !~* '^pending:'
         ),
         t.line_paid_through
    into v_enforcement, v_has_did, v_paid_through
  from public.tenants t
  where t.id = p_tenant_id;

  if not found then
    raise exception 'tenant not found';
  end if;

  -- Beta: free line, no charge, paid-through untouched.
  if v_enforcement = 'off' or not v_has_did or v_amount <= 0 then
    charged := false;
    amount_kes := 0;
    period := v_period;
    already_applied := false;
    select coalesce(t.wallet_balance_kes, 0) into wallet_balance_kes
    from public.tenants t where t.id = p_tenant_id;
    line_paid_through := v_paid_through;
    return next;
    return;
  end if;

  -- Charge the line fee. Wallet may go negative; that is allowed.
  select *
    into v_row
  from public._wallet_apply_delta(
    p_tenant_id,
    'line_rental',
    -v_amount,
    'period',
    v_period,
    'Monthly line fee',
    jsonb_build_object('period', v_period)
  );

  charged := not v_row.already_applied;
  amount_kes := v_amount;
  wallet_balance_kes := v_row.wallet_balance_kes;
  period := v_period;
  already_applied := v_row.already_applied;

  -- Extend coverage from the later of now or existing paid-through.
  if charged then
    v_base := greatest(coalesce(v_paid_through, now()), now());
    v_paid_through := v_base + interval '1 month';

    perform set_config('scalers.wallet_write', '1', true);
    update public.tenants
    set
      line_paid_through = v_paid_through,
      line_status = 'active'
    where id = p_tenant_id;
  end if;

  line_paid_through := v_paid_through;
  return next;
end;
$$;

revoke all on function public.apply_line_rental(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.apply_line_rental(uuid, text, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 4) Line status view / refresh: active | grace | suspended
-- ---------------------------------------------------------------------------
create or replace function public.refresh_line_status(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant record;
  v_status text;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;

  select
    t.id,
    coalesce(t.billing_enforcement, 'off') as billing_enforcement,
    t.line_paid_through,
    coalesce(t.line_grace_days, 3) as line_grace_days,
    coalesce(t.line_status, 'active') as line_status,
    (
      t.sautikit_virtual_number is not null
      and t.sautikit_virtual_number !~* '^pending:'
    ) as has_did
  into v_tenant
  from public.tenants t
  where t.id = p_tenant_id
  for update;

  if not found then
    raise exception 'tenant not found';
  end if;

  -- Beta and DID-less tenants are always active.
  if v_tenant.billing_enforcement = 'off' or not v_tenant.has_did then
    v_status := 'active';
  elsif v_tenant.line_paid_through is null then
    v_status := 'active';
  elsif now() <= v_tenant.line_paid_through then
    v_status := 'active';
  elsif now() <= v_tenant.line_paid_through + (v_tenant.line_grace_days || ' days')::interval then
    v_status := 'grace';
  else
    v_status := 'suspended';
  end if;

  if v_status is distinct from v_tenant.line_status then
    perform set_config('scalers.wallet_write', '1', true);
    update public.tenants
    set line_status = v_status
    where id = p_tenant_id;
  end if;

  return v_status;
end;
$$;

revoke all on function public.refresh_line_status(uuid) from public, anon, authenticated;
grant execute on function public.refresh_line_status(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5) Ops: suspend a line (release DID to pool as disabled) after grace
-- ---------------------------------------------------------------------------
create or replace function public.suspend_line_for_nonpayment(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e164 text;
  v_status text;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;

  v_status := public.refresh_line_status(p_tenant_id);
  if v_status <> 'suspended' then
    raise exception 'line is not past grace (status=%)', v_status;
  end if;

  select t.sautikit_virtual_number into v_e164
  from public.tenants t
  where t.id = p_tenant_id;

  if v_e164 is null or v_e164 like 'pending:%' then
    return null;
  end if;

  -- Keep the number out of the available pool until ops decides to release.
  update public.sautikit_did_pool
  set
    status = 'disabled',
    notes = coalesce(notes, '') || ' [suspended for non-payment]'
  where e164 = v_e164;

  -- Voice ignores pending: DIDs; tenant keeps row for history.
  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants
  set
    sautikit_virtual_number = 'pending:' || p_tenant_id::text,
    line_status = 'suspended'
  where id = p_tenant_id;

  return v_e164;
end;
$$;

revoke all on function public.suspend_line_for_nonpayment(uuid) from public, anon, authenticated;
grant execute on function public.suspend_line_for_nonpayment(uuid) to service_role;
