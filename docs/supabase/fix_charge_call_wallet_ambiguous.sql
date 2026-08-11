-- Fix: charge_call_to_wallet ambiguous wallet_balance_kes.
-- Run AFTER one_wallet_billing.sql (and wallet_security_beta.sql if already applied).
-- ASCII-only (safe for Supabase SQL Editor).
--
-- Bug: RETURNS TABLE OUT param wallet_balance_kes shadows tenants.wallet_balance_kes.
-- Early-return paths (billing_enforcement=off, zero minutes/amount) used unqualified
-- SELECT coalesce(wallet_balance_kes, 0) and raised:
--   column reference "wallet_balance_kes" is ambiguous
-- Seen in Railway logs on every completed call for beta (enforcement=off) tenants.
--
-- Idempotent: CREATE OR REPLACE.

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
begin
  if p_call_id is null then
    raise exception 'call_id required';
  end if;

  select c.id, c.tenant_id, c.duration_seconds, c.ai_processing_minutes, t.billing_enforcement
    into v_call
  from public.calls c
  join public.tenants t on t.id = c.tenant_id
  where c.id = p_call_id;

  if not found then
    raise exception 'call not found';
  end if;

  v_enforcement := coalesce(v_call.billing_enforcement, 'soft');
  if v_enforcement = 'off' then
    charged := false;
    amount_kes := 0;
    select coalesce(t.wallet_balance_kes, 0) into wallet_balance_kes
    from public.tenants t where t.id = v_call.tenant_id;
    already_applied := false;
    return next;
    return;
  end if;

  v_minutes := coalesce(p_minutes, v_call.ai_processing_minutes, 0);
  if v_minutes is null or v_minutes <= 0 then
    charged := false;
    amount_kes := 0;
    select coalesce(t.wallet_balance_kes, 0) into wallet_balance_kes
    from public.tenants t where t.id = v_call.tenant_id;
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
    select coalesce(t.wallet_balance_kes, 0) into wallet_balance_kes
    from public.tenants t where t.id = v_call.tenant_id;
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
      'duration_seconds', v_call.duration_seconds
    )
  );

  charged := not v_row.already_applied;
  amount_kes := v_amount;
  wallet_balance_kes := v_row.wallet_balance_kes;
  already_applied := v_row.already_applied;
  return next;
end;
$$;

revoke all on function public.charge_call_to_wallet(uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.charge_call_to_wallet(uuid, numeric, numeric) to service_role;
