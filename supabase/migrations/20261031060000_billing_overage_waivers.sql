-- Waive on-demand overage on the invoice side, with no wallet.
--
-- On-demand overage for a period comes from usage:
-- billing_period_on_demand_kes() reads the metered charge lines and does not
-- write them. A waiver is an append-only row in billing_overage_waivers for
-- the business's current period. The invoice build subtracts the waivers
-- through billing_period_overage_due_kes(). The waiver never edits an invoice
-- or an invoice line, issued or draft, and never touches
-- tenants.wallet_balance_kes, wallet_ledger, trial_credit or tenant_credits.
-- When a draft or open invoice covers the period, its id is stored on the
-- waiver as a link only.
--
-- This replaces the wallet-based waive_tenant_overage for Admin Billing
-- (#577 removed that one). The old function is left in place, and nothing
-- in the app calls it.

create table if not exists public.billing_overage_waivers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  amount_kes numeric(12,2) not null,
  on_demand_kes numeric(12,2) not null,
  reason text not null,
  actor text not null,
  idempotency_key text not null,
  invoice_id uuid,  -- link only; no FK so a draft invoice can still be deleted
  created_at timestamptz not null default now(),
  constraint billing_overage_waivers_key unique (idempotency_key),
  constraint billing_overage_waivers_amount_check check (amount_kes > 0),
  constraint billing_overage_waivers_reason_check check (length(btrim(reason)) >= 3),
  constraint billing_overage_waivers_period_check check (period_end > period_start)
);

create index if not exists billing_overage_waivers_tenant_period_idx
  on public.billing_overage_waivers (tenant_id, period_start, period_end);

alter table public.billing_overage_waivers enable row level security;
revoke all on table public.billing_overage_waivers from public, anon, authenticated;
grant select on table public.billing_overage_waivers to service_role;

-- Append-only. The only delete allowed is the tenant-delete purge, which sets scalers.billing_purge.
create or replace function public.billing_overage_waivers_append_only()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' and current_setting('scalers.billing_purge', true) = '1' then
    return old;
  end if;
  raise exception 'billing_overage_waivers is append-only';
end;
$$;

drop trigger if exists billing_overage_waivers_append_only on public.billing_overage_waivers;
create trigger billing_overage_waivers_append_only
  before update or delete on public.billing_overage_waivers
  for each row execute function public.billing_overage_waivers_append_only();

-- What the invoice build bills for the current period's on-demand usage, after waivers.
create or replace function public.billing_period_overage_due_kes(p_tenant_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_waived numeric;
begin
  select s.current_period_start, s.current_period_end into v_start, v_end
  from public.tenant_subscriptions s where s.tenant_id = p_tenant_id;
  select coalesce(sum(w.amount_kes), 0) into v_waived
  from public.billing_overage_waivers w
  where w.tenant_id = p_tenant_id
    and w.period_start = v_start
    and w.period_end = v_end;
  return greatest(round(public.billing_period_on_demand_kes(p_tenant_id) - coalesce(v_waived, 0), 2), 0);
end;
$$;

create or replace function public.waive_period_overage(
  p_tenant_id uuid,
  p_reason text,
  p_actor text,
  p_idempotency_key text
)
returns table (
  waiver_id uuid,
  waived_kes numeric,
  period_start timestamptz,
  period_end timestamptz,
  invoice_id uuid,
  replay boolean
)
language plpgsql
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_w public.billing_overage_waivers%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_on_demand numeric;
  v_already numeric;
  v_amount numeric;
  v_invoice uuid;
begin
  if p_tenant_id is null then
    raise exception 'tenant required';
  end if;
  if length(v_reason) < 3 then
    raise exception 'reason required (min 3 chars)';
  end if;
  if v_actor is null then
    raise exception 'actor required';
  end if;
  if v_key is null then
    raise exception 'idempotency key required';
  end if;

  -- One waive per business at a time.
  select s.current_period_start, s.current_period_end into v_start, v_end
  from public.tenant_subscriptions s
  where s.tenant_id = p_tenant_id
  for update;
  if not found or v_start is null or v_end is null then
    raise exception 'no current billing period for this business';
  end if;

  select * into v_w from public.billing_overage_waivers w where w.idempotency_key = v_key;
  if found then
    if v_w.tenant_id <> p_tenant_id then
      raise exception 'idempotency key belongs to another business';
    end if;
    waiver_id := v_w.id; waived_kes := v_w.amount_kes;
    period_start := v_w.period_start; period_end := v_w.period_end;
    invoice_id := v_w.invoice_id; replay := true;
    return next;
    return;
  end if;

  v_on_demand := round(coalesce(public.billing_period_on_demand_kes(p_tenant_id), 0), 2);
  select coalesce(sum(w.amount_kes), 0) into v_already
  from public.billing_overage_waivers w
  where w.tenant_id = p_tenant_id and w.period_start = v_start and w.period_end = v_end;
  v_amount := greatest(v_on_demand - v_already, 0);

  if v_amount <= 0 then
    waiver_id := null; waived_kes := 0;
    period_start := v_start; period_end := v_end;
    invoice_id := null; replay := false;
    return next;
    return;
  end if;

  -- Link the invoice that covers this period, if there is one. It is never edited.
  select i.id into v_invoice
  from public.invoices i
  where i.tenant_id = p_tenant_id
    and i.status in ('draft', 'open')
    and i.period_start < v_end and i.period_end > v_start
  order by i.created_at desc
  limit 1;

  insert into public.billing_overage_waivers
    (tenant_id, period_start, period_end, amount_kes, on_demand_kes, reason, actor, idempotency_key, invoice_id)
  values
    (p_tenant_id, v_start, v_end, v_amount, v_on_demand, v_reason, v_actor, v_key, v_invoice)
  returning * into v_w;

  insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
  values (
    v_actor,
    'overage_waived',
    p_tenant_id,
    v_amount,
    jsonb_build_object(
      'reason', v_reason,
      'waiver_id', v_w.id,
      'waived_kes', v_amount,
      'on_demand_kes', v_on_demand,
      'already_waived_kes', v_already,
      'period_start', v_start,
      'period_end', v_end,
      'invoice_id', v_invoice,
      'idempotency_key', v_key
    )
  );

  waiver_id := v_w.id; waived_kes := v_amount;
  period_start := v_start; period_end := v_end;
  invoice_id := v_invoice; replay := false;
  return next;
end;
$$;

revoke all on function public.waive_period_overage(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.waive_period_overage(uuid, text, text, text) to service_role;
revoke all on function public.billing_period_overage_due_kes(uuid) from public, anon, authenticated;
grant execute on function public.billing_period_overage_due_kes(uuid) to service_role;
revoke all on function public.billing_overage_waivers_append_only() from public, anon, authenticated;
