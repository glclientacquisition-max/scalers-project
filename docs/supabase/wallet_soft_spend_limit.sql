-- Owner soft spend limit (Cursor-style opt-in monthly budget).
-- Run AFTER wallet_security_beta.sql.
-- ASCII-only (safe for Supabase SQL Editor).
--
-- Model (soft only for v1):
--   soft_spend_limit_enabled = false (default) -> no budget tracking
--   soft_spend_limit_enabled = true + soft_spend_limit_kes > 0
--     -> Wallet UI warns at 50% / 80% / 100% of month-to-date spend
--   Soft never blocks calls. Hard inbound gate remains a separate product step.
--
-- Owners opt in and set their own limit via set_tenant_soft_spend_limit.
-- Does not move money; ledger RPCs stay service_role-only.

-- ---------------------------------------------------------------------------
-- 1) Columns (opt-in, off by default)
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists soft_spend_limit_enabled boolean not null default false;

alter table public.tenants
  add column if not exists soft_spend_limit_kes numeric;

comment on column public.tenants.soft_spend_limit_enabled is
  'Owner opt-in monthly soft spend budget. false = no limit (default).';
comment on column public.tenants.soft_spend_limit_kes is
  'Monthly soft spend budget in KES when enabled. Soft = warn only; never blocks calls.';

alter table public.tenants
  drop constraint if exists tenants_soft_spend_limit_kes_check;

alter table public.tenants
  add constraint tenants_soft_spend_limit_kes_check
  check (
    soft_spend_limit_kes is null
    or soft_spend_limit_kes >= 500
  );

-- ---------------------------------------------------------------------------
-- 2) Protect columns from direct UPDATE (owners use RPC below)
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
    then
      raise exception 'wallet/billing columns are RPC-only';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) Owner RPC: opt in / set amount / turn off
-- ---------------------------------------------------------------------------
create or replace function public.set_tenant_soft_spend_limit(
  p_tenant_id uuid,
  p_enabled boolean,
  p_limit_kes numeric default null
)
returns table (
  soft_spend_limit_enabled boolean,
  soft_spend_limit_kes numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean := coalesce(p_enabled, false);
  v_limit numeric := nullif(p_limit_kes, 0);
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;

  -- Owners may only change their own workspace. Service role (ops/admin) may set any.
  if auth.uid() is not null and coalesce(auth.role(), '') = 'authenticated' then
    if p_tenant_id not in (select public.current_user_tenant_ids()) then
      raise exception 'not allowed';
    end if;
  end if;

  if v_enabled then
    if v_limit is null or v_limit < 500 then
      raise exception 'soft spend limit must be at least 500 KES when enabled';
    end if;
    if v_limit > 1000000 then
      raise exception 'soft spend limit cannot exceed 1000000 KES';
    end if;
    v_limit := round(v_limit);
  else
    v_limit := null;
  end if;

  perform set_config('scalers.wallet_write', '1', true);

  update public.tenants
  set
    soft_spend_limit_enabled = v_enabled,
    soft_spend_limit_kes = v_limit
  where id = p_tenant_id;

  if not found then
    raise exception 'tenant not found';
  end if;

  soft_spend_limit_enabled := v_enabled;
  soft_spend_limit_kes := v_limit;
  return next;
end;
$$;

revoke all on function public.set_tenant_soft_spend_limit(uuid, boolean, numeric)
  from public, anon;
grant execute on function public.set_tenant_soft_spend_limit(uuid, boolean, numeric)
  to authenticated, service_role;
