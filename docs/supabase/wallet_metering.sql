-- Wallet metering foundation (dual-wallet columns + legacy adjust RPC).
-- Run in the Supabase SQL editor after owner_rls.sql / tenant_business_profile.sql.
-- Then apply one_wallet_billing.sql (single KES wallet + ledger + call charges).
-- ASCII-only (safe for Supabase SQL Editor).

-- ---------------------------------------------------------------------------
-- Ensure metering + wallet columns exist
-- ---------------------------------------------------------------------------
alter table public.calls
  add column if not exists ai_processing_minutes numeric;

alter table public.tenants
  add column if not exists telecom_wallet_balance_kes numeric default 0;

alter table public.tenants
  add column if not exists ai_wallet_balance_usd numeric default 0;

comment on column public.calls.ai_processing_minutes is
  'Billable AI minutes for this call (usually duration_seconds / 60); written by voice engine';
comment on column public.tenants.telecom_wallet_balance_kes is
  'Owner-facing prepaid telecom wallet (KES). Beta: display only, not auto-debited.';
comment on column public.tenants.ai_wallet_balance_usd is
  'Owner-facing prepaid AI wallet (USD). Beta: display only, not auto-debited.';

-- ---------------------------------------------------------------------------
-- Super Admin: seed / adjust owner wallets (no payment provider yet)
-- ---------------------------------------------------------------------------
create or replace function public.adjust_tenant_wallet(
  p_tenant_id uuid,
  p_telecom_delta_kes numeric default 0,
  p_ai_delta_usd numeric default 0,
  p_note text default null
)
returns table (
  telecom_wallet_balance_kes numeric,
  ai_wallet_balance_usd numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_telecom numeric;
  v_ai numeric;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;

  update public.tenants
  set
    telecom_wallet_balance_kes = coalesce(telecom_wallet_balance_kes, 0) + coalesce(p_telecom_delta_kes, 0),
    ai_wallet_balance_usd = coalesce(ai_wallet_balance_usd, 0) + coalesce(p_ai_delta_usd, 0)
  where id = p_tenant_id
  returning
    tenants.telecom_wallet_balance_kes,
    tenants.ai_wallet_balance_usd
  into v_telecom, v_ai;

  if not found then
    raise exception 'tenant not found';
  end if;

  -- Optional audit breadcrumb on the tenant row notes is not available;
  -- log via raise notice for SQL editor runs.
  raise notice 'adjust_tenant_wallet tenant=% telecom=% ai=% note=%',
    p_tenant_id, v_telecom, v_ai, coalesce(p_note, '');

  telecom_wallet_balance_kes := v_telecom;
  ai_wallet_balance_usd := v_ai;
  return next;
end;
$$;

revoke all on function public.adjust_tenant_wallet(uuid, numeric, numeric, text) from public;
grant execute on function public.adjust_tenant_wallet(uuid, numeric, numeric, text) to service_role;
