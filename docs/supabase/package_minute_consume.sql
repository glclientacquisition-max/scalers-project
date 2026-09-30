-- package_minute_consume.sql
-- Purpose: Hangup meters talk seconds into the shared package pool.
--          Included seconds are not a wallet debit.
--          Past the cap, on-demand off: keep the meter, do not debit, do not reject the call.
--          Past the cap, on-demand on, enforcement not off: debit overage seconds
--          at billing_rate_card (inbound 0.05/sec, outbound 0.10/sec). Whole seconds.
--          Beta (billing_enforcement = off): meter only.
--          On-demand SMS past the cap debits sms_kes. On-demand off still skips tenant SMS
--          and does not debit (consume_sms_units stop rule is unchanged).
-- Run after: package_catalog.sql
-- Math twin: src/billing/packageOverage.js quoteCallOverage
-- Does not replace tenants_protect_wallet_columns(). package_catalog.sql stays latest.

alter table public.calls
  add column if not exists package_seconds_applied integer not null default 0;

alter table public.calls
  drop constraint if exists calls_package_seconds_applied_check;
alter table public.calls
  add constraint calls_package_seconds_applied_check
  check (package_seconds_applied >= 0);

comment on column public.calls.package_seconds_applied is
  'Talk seconds already added to tenants.seconds_used for this call.';

alter table public.wallet_ledger drop constraint if exists wallet_ledger_kind_check;
alter table public.wallet_ledger
  add constraint wallet_ledger_kind_check check (
    kind in (
      'topup',
      'call_charge',
      'line_rental',
      'admin_adjustment',
      'migration_credit',
      'trial_credit',
      'sms_charge'
    )
  );

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
  'Meter talk seconds into the package pool. Debit only on-demand overage when enforcement is not off.';

revoke all on function public.consume_call_seconds(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.consume_call_seconds(uuid, integer, text)
  to service_role;

-- On-demand SMS debit. Stop rule matches sms_allowance.sql.
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
  'Claim tenant SMS. Beta meters. Paid stops at included unless on-demand. On-demand debits sms_kes.';

revoke all on function public.consume_sms_units(uuid, integer)
  from public, anon;
grant execute on function public.consume_sms_units(uuid, integer)
  to authenticated, service_role;
