-- Wallet security hardening + beta program controls.
-- Run AFTER one_wallet_billing.sql.
-- ASCII-only (safe for Supabase SQL Editor).
--
-- Beta model:
--   billing_enforcement = 'off'  -> beta whitelist (meter usage, charge nothing)
--   billing_enforcement = 'soft' -> prepaid (debit, do not block calls)
--   billing_enforcement = 'hard' -> prepaid + future inbound gate
-- New workspaces default to beta ('off').

-- ---------------------------------------------------------------------------
-- 1) Beta metadata
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists beta_notes text;

alter table public.tenants
  add column if not exists beta_expires_at timestamptz;

comment on column public.tenants.billing_enforcement is
  'off = beta free (whitelist); soft = prepaid debit no block; hard = prepaid + block later';
comment on column public.tenants.beta_notes is
  'Ops note for beta whitelist reason';
comment on column public.tenants.beta_expires_at is
  'Optional end of free beta; null = open-ended';

alter table public.tenants
  alter column billing_enforcement set default 'off';

-- Whitelist existing workspaces into beta (free). Ops can graduate later.
update public.tenants
set
  billing_enforcement = 'off',
  beta_notes = coalesce(nullif(trim(beta_notes), ''), 'Beta program whitelist')
where coalesce(billing_enforcement, 'soft') in ('soft', 'hard', 'off');

-- ---------------------------------------------------------------------------
-- 2) Ops audit log (who moved money / changed billing mode)
-- ---------------------------------------------------------------------------
create table if not exists public.ops_audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor text not null default 'ops',
  action text not null,
  tenant_id uuid references public.tenants (id) on delete set null,
  amount_kes numeric,
  detail jsonb not null default '{}'::jsonb
);

create index if not exists ops_audit_log_created_idx
  on public.ops_audit_log (created_at desc);

create index if not exists ops_audit_log_tenant_idx
  on public.ops_audit_log (tenant_id, created_at desc);

alter table public.ops_audit_log enable row level security;
-- No policies for authenticated -> owners cannot read/write.
grant all on public.ops_audit_log to service_role;

-- ---------------------------------------------------------------------------
-- 3) Ledger immutability (append-only even for mistakes - reverse with new rows)
-- ---------------------------------------------------------------------------
create or replace function public.wallet_ledger_deny_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'wallet_ledger is append-only';
end;
$$;

drop trigger if exists wallet_ledger_no_update on public.wallet_ledger;
create trigger wallet_ledger_no_update
  before update on public.wallet_ledger
  for each row execute function public.wallet_ledger_deny_mutation();

drop trigger if exists wallet_ledger_no_delete on public.wallet_ledger;
create trigger wallet_ledger_no_delete
  before delete on public.wallet_ledger
  for each row execute function public.wallet_ledger_deny_mutation();

-- ---------------------------------------------------------------------------
-- 4) Block direct wallet column edits outside security definer RPCs
-- ---------------------------------------------------------------------------
create or replace function public.tenants_protect_wallet_columns()
returns trigger
language plpgsql
as $$
begin
  -- Allow security definer wallet RPCs (they run as owner/definer and set this).
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
    then
      raise exception 'wallet/billing columns are RPC-only';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tenants_protect_wallet_columns on public.tenants;
create trigger tenants_protect_wallet_columns
  before update on public.tenants
  for each row execute function public.tenants_protect_wallet_columns();

-- ---------------------------------------------------------------------------
-- 5) Patch _wallet_apply_delta to set local write flag
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
  perform set_config('scalers.wallet_write', '1', true);

  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;
  if p_kind is null or length(trim(p_kind)) = 0 then
    raise exception 'kind required';
  end if;
  if p_amount_kes is null or p_amount_kes = 0 then
    raise exception 'amount_kes must be non-zero';
  end if;

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

-- ---------------------------------------------------------------------------
-- 6) Secure adjust with actor + audit + optional idempotency key
-- ---------------------------------------------------------------------------
drop function if exists public.adjust_tenant_wallet(uuid, numeric, text);

create or replace function public.adjust_tenant_wallet(
  p_tenant_id uuid,
  p_delta_kes numeric default 0,
  p_note text default null,
  p_actor text default 'ops',
  p_idempotency_key text default null
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
  v_actor text := coalesce(nullif(trim(p_actor), ''), 'ops');
  v_note text := nullif(trim(p_note), '');
begin
  if coalesce(p_delta_kes, 0) = 0 then
    raise exception 'delta_kes must be non-zero';
  end if;
  if abs(p_delta_kes) > 500000 then
    raise exception 'delta_kes exceeds max single credit/debit (500000)';
  end if;
  if v_note is null or length(v_note) < 3 then
    raise exception 'note required (min 3 chars)';
  end if;

  select *
    into v_row
  from public._wallet_apply_delta(
    p_tenant_id,
    'admin_adjustment',
    p_delta_kes,
    'admin',
    nullif(trim(p_idempotency_key), ''),
    v_note,
    jsonb_build_object('source', 'super_admin', 'actor', v_actor)
  );

  insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
  values (
    v_actor,
    'adjust_wallet',
    p_tenant_id,
    p_delta_kes,
    jsonb_build_object(
      'note', v_note,
      'balance_after', v_row.wallet_balance_kes,
      'already_applied', v_row.already_applied,
      'idempotency_key', p_idempotency_key
    )
  );

  wallet_balance_kes := v_row.wallet_balance_kes;
  return next;
end;
$$;

-- Keep legacy 4-arg wrapper (folded into KES) with note required via inner call.
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
  select * into v_row
  from public.adjust_tenant_wallet(p_tenant_id, v_delta, p_note, 'ops_legacy', null);

  telecom_wallet_balance_kes := v_row.wallet_balance_kes;
  ai_wallet_balance_usd := 0;
  wallet_balance_kes := v_row.wallet_balance_kes;
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Set billing mode (beta whitelist / prepaid)
-- ---------------------------------------------------------------------------
create or replace function public.set_tenant_billing_mode(
  p_tenant_id uuid,
  p_mode text,
  p_actor text default 'ops',
  p_note text default null,
  p_beta_expires_at timestamptz default null,
  p_waive_negative_balance boolean default false
)
returns table (
  billing_enforcement text,
  wallet_balance_kes numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := lower(trim(p_mode));
  v_actor text := coalesce(nullif(trim(p_actor), ''), 'ops');
  v_bal numeric;
  v_note text := coalesce(nullif(trim(p_note), ''), 'Billing mode change');
begin
  perform set_config('scalers.wallet_write', '1', true);

  if v_mode not in ('off', 'soft', 'hard') then
    raise exception 'mode must be off|soft|hard';
  end if;

  update public.tenants
  set
    billing_enforcement = v_mode,
    beta_notes = case
      when v_mode = 'off' then v_note
      else beta_notes
    end,
    beta_expires_at = case
      when v_mode = 'off' then p_beta_expires_at
      else null
    end
  where id = p_tenant_id
  returning tenants.wallet_balance_kes into v_bal;

  if not found then
    raise exception 'tenant not found';
  end if;

  -- Optional: when moving to beta, wipe debt so soft-charged beta debt disappears.
  if p_waive_negative_balance and coalesce(v_bal, 0) < 0 then
    perform public._wallet_apply_delta(
      p_tenant_id,
      'trial_credit',
      abs(v_bal),
      'beta_waive',
      'waive:' || p_tenant_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS'),
      'Beta whitelist - waived negative balance',
      jsonb_build_object('actor', v_actor)
    );
    select t.wallet_balance_kes into v_bal from public.tenants t where t.id = p_tenant_id;
  end if;

  insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
  values (
    v_actor,
    'set_billing_mode',
    p_tenant_id,
    null,
    jsonb_build_object(
      'mode', v_mode,
      'note', v_note,
      'beta_expires_at', p_beta_expires_at,
      'waive_negative', p_waive_negative_balance,
      'balance_after', v_bal
    )
  );

  billing_enforcement := v_mode;
  wallet_balance_kes := coalesce(v_bal, 0);
  return next;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) Line rental: ignore client amount (prevent fee evasion); service_role only
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
  v_amount numeric := 1000; -- fixed retail line fee; ignore client p_amount_kes
  v_enforcement text;
  v_row record;
  v_has_did boolean;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;

  -- Keep signature but never trust caller amount.
  if p_amount_kes is not null and p_amount_kes <> 1000 then
    -- silently ignore; fixed rate card
    null;
  end if;

  v_period := coalesce(
    nullif(trim(p_period), ''),
    to_char((now() at time zone 'UTC'), 'YYYY-MM')
  );

  select coalesce(billing_enforcement, 'off'),
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

-- ---------------------------------------------------------------------------
-- 9) Column-level UPDATE grants - owners cannot touch wallet fields
-- ---------------------------------------------------------------------------
revoke update on public.tenants from authenticated;
grant update (
  business_name,
  whatsapp_notification_number,
  alert_email,
  llm_system_prompt,
  business_hours,
  hours_schedule,
  after_hours_mode,
  services_offered,
  services_catalog,
  agent_name,
  agent_tone,
  team_directory,
  faqs,
  unknown_answer_fallback,
  daily_bulletin,
  voice_languages,
  voice_language_other,
  escalation_enabled,
  agent_tools
) on public.tenants to authenticated;

-- ---------------------------------------------------------------------------
-- 10) Revoke dangerous EXECUTE from PUBLIC / anon / authenticated
-- ---------------------------------------------------------------------------
revoke all on function public._wallet_apply_delta(uuid, text, numeric, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public._wallet_apply_delta(uuid, text, numeric, text, text, text, jsonb) to service_role;

revoke all on function public.adjust_tenant_wallet(uuid, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.adjust_tenant_wallet(uuid, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.adjust_tenant_wallet(uuid, numeric, text, text, text) to service_role;
grant execute on function public.adjust_tenant_wallet(uuid, numeric, numeric, text) to service_role;

revoke all on function public.charge_call_to_wallet(uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function public.charge_call_to_wallet(uuid, numeric, numeric) to service_role;

revoke all on function public.apply_line_rental(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.apply_line_rental(uuid, text, numeric) to service_role;

revoke all on function public.set_tenant_billing_mode(uuid, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.set_tenant_billing_mode(uuid, text, text, text, timestamptz, boolean) to service_role;

-- DID / destroy RPCs (defense in depth)
do $$
begin
  if to_regprocedure('public.assign_did_from_pool(uuid)') is not null then
    execute 'revoke all on function public.assign_did_from_pool(uuid) from public, anon, authenticated';
    execute 'grant execute on function public.assign_did_from_pool(uuid) to service_role';
  end if;
  if to_regprocedure('public.assign_specific_did_to_tenant(uuid, text)') is not null then
    execute 'revoke all on function public.assign_specific_did_to_tenant(uuid, text) from public, anon, authenticated';
    execute 'grant execute on function public.assign_specific_did_to_tenant(uuid, text) to service_role';
  end if;
  if to_regprocedure('public.release_did_from_business(uuid)') is not null then
    execute 'revoke all on function public.release_did_from_business(uuid) from public, anon, authenticated';
    execute 'grant execute on function public.release_did_from_business(uuid) to service_role';
  end if;
  if to_regprocedure('public.remove_business_and_release_did(uuid)') is not null then
    execute 'revoke all on function public.remove_business_and_release_did(uuid) from public, anon, authenticated';
    execute 'grant execute on function public.remove_business_and_release_did(uuid) to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 11) Waive debts for newly whitelisted beta workspaces
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select id
    from public.tenants
    where coalesce(billing_enforcement, 'off') = 'off'
      and coalesce(wallet_balance_kes, 0) < 0
  loop
    perform public.set_tenant_billing_mode(
      r.id,
      'off',
      'migration',
      'Beta program whitelist',
      null,
      true
    );
  end loop;
end $$;
