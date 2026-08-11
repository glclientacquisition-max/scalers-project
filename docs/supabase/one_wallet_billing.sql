-- One KES prepaid wallet + append-only ledger (supersedes dual-wallet display).
-- Run in Supabase SQL editor AFTER wallet_metering.sql.
-- ASCII-only (safe for Supabase SQL Editor).
--
-- See docs/ONE_WALLET_BILLING.md for constraints and apply order.

-- Drop legacy adjust RPC first — return type gains wallet_balance_kes.
drop function if exists public.adjust_tenant_wallet(uuid, numeric, numeric, text);

-- ---------------------------------------------------------------------------
-- 1) Single wallet columns on tenants
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists wallet_balance_kes numeric default 0;

alter table public.tenants
  add column if not exists wallet_low_balance_kes numeric default 200;

-- soft = debit but never block calls; hard = future inbound gate; off = meter only (no debit)
alter table public.tenants
  add column if not exists billing_enforcement text default 'soft';

comment on column public.tenants.wallet_balance_kes is
  'Owner prepaid wallet in KES (telecom + AI bundled). Cached sum of wallet_ledger.';
comment on column public.tenants.wallet_low_balance_kes is
  'UI / alert threshold in KES (default 200).';
comment on column public.tenants.billing_enforcement is
  'soft | hard | off — soft debits without blocking calls.';

-- One-time backfill from dual wallets (safe to re-run while new balance still 0).
-- FX 130 is a migration convenience for leftover AI USD seeds, not live FX.
update public.tenants
set wallet_balance_kes =
  coalesce(telecom_wallet_balance_kes, 0)
  + round(coalesce(ai_wallet_balance_usd, 0) * 130)
where coalesce(wallet_balance_kes, 0) = 0
  and (
    coalesce(telecom_wallet_balance_kes, 0) <> 0
    or coalesce(ai_wallet_balance_usd, 0) <> 0
  );

comment on column public.tenants.telecom_wallet_balance_kes is
  'DEPRECATED — use wallet_balance_kes. Kept for rollback / history.';
comment on column public.tenants.ai_wallet_balance_usd is
  'DEPRECATED — AI is bundled into KES wallet_balance_kes.';

-- ---------------------------------------------------------------------------
-- 2) Append-only ledger
-- ---------------------------------------------------------------------------
create table if not exists public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null,
  amount_kes numeric not null,
  balance_after_kes numeric not null,
  currency text not null default 'KES',
  reference_type text,
  reference_id text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  constraint wallet_ledger_kind_check check (
    kind in (
      'topup',
      'call_charge',
      'line_rental',
      'admin_adjustment',
      'migration_credit',
      'trial_credit'
    )
  ),
  constraint wallet_ledger_currency_check check (currency = 'KES')
);

create index if not exists wallet_ledger_tenant_created_idx
  on public.wallet_ledger (tenant_id, created_at desc);

-- Idempotency for call charges, monthly line fee, topups, etc.
create unique index if not exists wallet_ledger_idempotency_idx
  on public.wallet_ledger (tenant_id, kind, reference_id)
  where reference_id is not null;

comment on table public.wallet_ledger is
  'Append-only prepaid wallet ledger. Positive amount_kes = credit; negative = debit.';

-- ---------------------------------------------------------------------------
-- 3) RLS — owners can read their ledger; writes only via service_role RPCs
-- ---------------------------------------------------------------------------
alter table public.wallet_ledger enable row level security;

drop policy if exists wallet_ledger_select_member on public.wallet_ledger;
create policy wallet_ledger_select_member
  on public.wallet_ledger
  for select
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

grant select on public.wallet_ledger to authenticated;
grant all on public.wallet_ledger to service_role;

-- ---------------------------------------------------------------------------
-- Internal helper: apply a signed delta and insert a ledger row (row-locks tenant)
-- ---------------------------------------------------------------------------
create or replace function public._wallet_apply_delta(
  p_tenant_id uuid,
  p_kind text,
  p_amount_kes numeric,
  p_reference_type text default null,
  p_reference_id text default null,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  ledger_id uuid,
  wallet_balance_kes numeric,
  already_applied boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance numeric;
  v_id uuid;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;
  if p_kind is null or length(trim(p_kind)) = 0 then
    raise exception 'kind required';
  end if;
  if p_amount_kes is null or p_amount_kes = 0 then
    raise exception 'amount_kes must be non-zero';
  end if;

  -- Idempotent short-circuit
  if p_reference_id is not null then
    select wl.id, wl.balance_after_kes
      into v_id, v_balance
    from public.wallet_ledger wl
    where wl.tenant_id = p_tenant_id
      and wl.kind = p_kind
      and wl.reference_id = p_reference_id
    limit 1;

    if found then
      ledger_id := v_id;
      wallet_balance_kes := v_balance;
      already_applied := true;
      return next;
      return;
    end if;
  end if;

  select t.wallet_balance_kes
    into v_balance
  from public.tenants t
  where t.id = p_tenant_id
  for update;

  if not found then
    raise exception 'tenant not found';
  end if;

  v_balance := coalesce(v_balance, 0) + p_amount_kes;

  update public.tenants
  set
    wallet_balance_kes = v_balance,
    -- Keep deprecated columns roughly in sync for any leftover readers.
    telecom_wallet_balance_kes = v_balance,
    ai_wallet_balance_usd = 0
  where id = p_tenant_id;

  insert into public.wallet_ledger (
    tenant_id,
    kind,
    amount_kes,
    balance_after_kes,
    currency,
    reference_type,
    reference_id,
    note,
    metadata
  ) values (
    p_tenant_id,
    p_kind,
    p_amount_kes,
    v_balance,
    'KES',
    p_reference_type,
    p_reference_id,
    p_note,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  ledger_id := v_id;
  wallet_balance_kes := v_balance;
  already_applied := false;
  return next;
end;
$$;

revoke all on function public._wallet_apply_delta(uuid, text, numeric, text, text, text, jsonb) from public;
grant execute on function public._wallet_apply_delta(uuid, text, numeric, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4) Super Admin adjust / seed (replaces dual-delta RPC)
-- ---------------------------------------------------------------------------
create or replace function public.adjust_tenant_wallet(
  p_tenant_id uuid,
  p_delta_kes numeric default 0,
  p_note text default null
)
returns table (
  wallet_balance_kes numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  if coalesce(p_delta_kes, 0) = 0 then
    raise exception 'delta_kes must be non-zero';
  end if;

  select *
    into v_row
  from public._wallet_apply_delta(
    p_tenant_id,
    'admin_adjustment',
    p_delta_kes,
    'admin',
    null, -- admin adjusts are not idempotent by reference
    p_note,
    jsonb_build_object('source', 'super_admin')
  );

  wallet_balance_kes := v_row.wallet_balance_kes;
  return next;
end;
$$;

revoke all on function public.adjust_tenant_wallet(uuid, numeric, text) from public;
grant execute on function public.adjust_tenant_wallet(uuid, numeric, text) to service_role;

-- Backward-compatible wrapper for old dashboard payloads (telecom + ai deltas).
-- AI USD is converted at migration FX 130 and folded into KES.
create or replace function public.adjust_tenant_wallet(
  p_tenant_id uuid,
  p_telecom_delta_kes numeric default 0,
  p_ai_delta_usd numeric default 0,
  p_note text default null
)
returns table (
  telecom_wallet_balance_kes numeric,
  ai_wallet_balance_usd numeric,
  wallet_balance_kes numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta numeric;
  v_row record;
begin
  v_delta := coalesce(p_telecom_delta_kes, 0) + round(coalesce(p_ai_delta_usd, 0) * 130);
  if v_delta = 0 then
    raise exception 'combined wallet delta must be non-zero';
  end if;

  select *
    into v_row
  from public._wallet_apply_delta(
    p_tenant_id,
    'admin_adjustment',
    v_delta,
    'admin',
    null,
    p_note,
    jsonb_build_object(
      'source', 'super_admin_legacy',
      'telecom_delta_kes', coalesce(p_telecom_delta_kes, 0),
      'ai_delta_usd', coalesce(p_ai_delta_usd, 0)
    )
  );

  telecom_wallet_balance_kes := v_row.wallet_balance_kes;
  ai_wallet_balance_usd := 0;
  wallet_balance_kes := v_row.wallet_balance_kes;
  return next;
end;
$$;

revoke all on function public.adjust_tenant_wallet(uuid, numeric, numeric, text) from public;
grant execute on function public.adjust_tenant_wallet(uuid, numeric, numeric, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5) Charge a completed call (idempotent per call id)
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
    -- Qualify tenants column: OUT param wallet_balance_kes shadows bare name.
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

revoke all on function public.charge_call_to_wallet(uuid, numeric, numeric) from public;
grant execute on function public.charge_call_to_wallet(uuid, numeric, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- 6) Monthly line rental (lazy, idempotent per tenant + YYYY-MM)
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
  already_applied boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period text;
  v_amount numeric;
  v_enforcement text;
  v_row record;
  v_has_did boolean;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;

  -- Owners may apply their own monthly fee (lazy from Wallet page).
  if auth.uid() is not null and coalesce(auth.role(), '') = 'authenticated' then
    if p_tenant_id not in (select public.current_user_tenant_ids()) then
      raise exception 'not allowed';
    end if;
  end if;

  v_period := coalesce(
    nullif(trim(p_period), ''),
    to_char((now() at time zone 'UTC'), 'YYYY-MM')
  );
  v_amount := coalesce(p_amount_kes, 1000);

  select coalesce(billing_enforcement, 'soft'),
         (
           sautikit_virtual_number is not null
           and sautikit_virtual_number !~* '^pending:'
         )
    into v_enforcement, v_has_did
  from public.tenants
  where id = p_tenant_id;

  if not found then
    raise exception 'tenant not found';
  end if;

  if v_enforcement = 'off' or not v_has_did or v_amount <= 0 then
    charged := false;
    amount_kes := 0;
    period := v_period;
    already_applied := false;
    select coalesce(t.wallet_balance_kes, 0) into wallet_balance_kes
    from public.tenants t where t.id = p_tenant_id;
    return next;
    return;
  end if;

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
  return next;
end;
$$;

revoke all on function public.apply_line_rental(uuid, text, numeric) from public;
grant execute on function public.apply_line_rental(uuid, text, numeric) to service_role;
grant execute on function public.apply_line_rental(uuid, text, numeric) to authenticated;
