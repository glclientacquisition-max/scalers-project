-- sms_allowance.sql
-- Purpose: Cursor-like included SMS, then stop at zero unless on-demand.
--          Same tenants.on_demand_usage_enabled as prepaid minutes.
-- Run after: notify_send_ledger.sql, line_rental_grace.sql (protect trigger).
-- Beta (billing_enforcement = off): meter only, never block.
-- Paid: included units first. At cap, on-demand off -> skip tenant SMS
-- (WhatsApp/email/desk note still try). Platform wallet/outage SMS never gated.

alter table public.tenants
  add column if not exists sms_included_units integer not null default 200;

alter table public.tenants
  add column if not exists sms_used_units integer not null default 0;

comment on column public.tenants.sms_included_units is
  'Included tenant SMS segments per pack. Packages later replace this default.';
comment on column public.tenants.sms_used_units is
  'Consumed tenant SMS segments. Incremented by consume_sms_units.';

alter table public.tenants
  drop constraint if exists tenants_sms_included_units_check;
alter table public.tenants
  add constraint tenants_sms_included_units_check
  check (sms_included_units >= 0);

alter table public.tenants
  drop constraint if exists tenants_sms_used_units_check;
alter table public.tenants
  add constraint tenants_sms_used_units_check
  check (sms_used_units >= 0);

alter table public.notify_sends
  add column if not exists overage boolean not null default false;

comment on column public.notify_sends.overage is
  'True when this send used on-demand beyond sms_included_units.';

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
    then
      raise exception 'wallet/billing columns are RPC-only';
    end if;
  end if;

  return new;
end;
$$;

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
    perform set_config('scalers.wallet_write', '1', true);
    update public.tenants
      set sms_used_units = v_used + v_units
      where id = p_tenant_id;
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
  'Claim tenant SMS segments. Beta meters. Paid stops at included unless on-demand.';

revoke all on function public.consume_sms_units(uuid, integer)
  from public, anon;
grant execute on function public.consume_sms_units(uuid, integer)
  to authenticated, service_role;
