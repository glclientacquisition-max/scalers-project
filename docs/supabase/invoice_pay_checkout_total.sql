-- Invoice pay checkout total (P13).
-- Apply after invoice_pay_collections.sql (P12). Staging only until Alvin's GO.
-- Does not replace finalize_invoice. Does not edit P1–P12.
-- Production (fjxcdccgyhnvnnlnovcl) does not have this file.
--
-- The webhook is only a trigger. This function applies Bachs' cumulative
-- collected total for one checkout. collected_total_seen_kes is that total
-- the last time it was applied. The delta is new total minus seen. It is
-- applied to the invoice up to the amount due. The excess is one credit
-- keyed by the checkout and the cumulative cents, so a replay is a no-op.
-- Event ids are not summed.

alter table public.payment_attempts
  add column if not exists collected_total_seen_kes numeric;

comment on column public.payment_attempts.collected_total_seen_kes is
  'Bachs cumulative collected total already applied for this checkout. A replay at or below this total is a no-op.';

create or replace function public.reconcile_checkout_total(
  p_provider text,
  p_checkout_id text,
  p_total_kes numeric,
  p_tenant_id uuid,
  p_invoice_id uuid,
  p_raw jsonb default '{}'::jsonb,
  p_settled_amount_minor integer default null,
  p_settled_currency text default null,
  p_fee_minor integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_existing public.payments%rowtype;
  v_row public.payments%rowtype;
  v_have_attempt boolean;
  v_have_payment boolean;
  v_next_cents bigint;
  v_seen_cents bigint;
  v_delta numeric;
  v_due numeric;
  v_apply numeric;
  v_excess numeric;
  v_paid numeric;
  v_match text;
  v_key text;
  v_credit uuid;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_checkout_id), '') is null then
    raise exception 'provider and checkout id are required';
  end if;
  if p_total_kes is null or p_total_kes < 0 then
    raise exception 'collected total must be zero or positive';
  end if;
  if p_invoice_id is null then
    raise exception 'invoice not found';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status in ('void', 'uncollectible') then
    raise exception 'invoice cannot be paid';
  end if;
  if v_inv.status = 'draft' then
    raise exception 'draft invoices are not payable';
  end if;
  if p_tenant_id is not null and p_tenant_id is distinct from v_inv.tenant_id then
    raise exception 'payment tenant does not match the invoice';
  end if;
  p_tenant_id := v_inv.tenant_id;

  if p_total_kes = 0 then
    return jsonb_build_object(
      'noop', true,
      'applied_kes', 0,
      'excess_kes', 0,
      'amount_kes', 0,
      'partial', false
    );
  end if;

  select * into v_attempt
  from public.payment_attempts
  where checkout_session_id = p_checkout_id
    and invoice_id = p_invoice_id
  order by created_at desc
  limit 1
  for update;
  v_have_attempt := found;
  if not v_have_attempt then
    raise exception 'pay attempt not found';
  end if;

  v_next_cents := round(p_total_kes * 100);
  v_seen_cents := round(coalesce(v_attempt.collected_total_seen_kes, 0) * 100);
  if v_next_cents <= v_seen_cents then
    return jsonb_build_object(
      'noop', true,
      'applied_kes', 0,
      'excess_kes', 0,
      'amount_kes', coalesce(v_attempt.collected_total_seen_kes, 0),
      'partial', false
    );
  end if;

  v_delta := (v_next_cents - v_seen_cents) / 100.0;
  v_due := greatest(v_inv.total_kes - v_inv.amount_paid_kes, 0);
  v_apply := least(v_delta, v_due);
  v_excess := v_delta - v_apply;
  v_paid := v_inv.amount_paid_kes + v_apply;
  if v_excess > 0 then
    v_match := 'over';
  elsif v_paid >= v_inv.total_kes then
    v_match := 'matched';
  else
    v_match := 'partial';
  end if;

  update public.payment_attempts
  set collected_total_seen_kes = p_total_kes
  where id = v_attempt.id;

  select * into v_existing
  from public.payments
  where provider = p_provider
    and provider_ref = p_checkout_id
  for update;
  v_have_payment := found;

  if v_have_payment then
    update public.payments
    set amount_kes = p_total_kes,
        match_status = v_match,
        bill_ref = p_checkout_id,
        raw = coalesce(p_raw, raw),
        settled_amount_minor = coalesce(p_settled_amount_minor, settled_amount_minor),
        settled_currency = coalesce(p_settled_currency, settled_currency),
        fee_minor = coalesce(p_fee_minor, fee_minor),
        invoice_id = p_invoice_id
    where id = v_existing.id
    returning * into v_row;
  else
    insert into public.payments (
      tenant_id, invoice_id, provider, provider_ref, amount_kes,
      settled_amount_minor, settled_currency, fee_minor,
      match_status, bill_ref, paid_at, raw, actor
    ) values (
      p_tenant_id, p_invoice_id, p_provider, p_checkout_id, p_total_kes,
      p_settled_amount_minor, p_settled_currency, p_fee_minor,
      v_match, p_checkout_id, now(),
      coalesce(p_raw, '{}'::jsonb), 'bachs-webhook'
    )
    returning * into v_row;
  end if;

  if v_apply > 0 then
    perform set_config('scalers.billing_write', '1', true);
    if v_paid >= v_inv.total_kes then
      update public.invoices
      set amount_paid_kes = total_kes,
          status = 'paid',
          paid_at = coalesce(paid_at, now()),
          updated_at = now()
      where id = p_invoice_id;
    else
      update public.invoices
      set amount_paid_kes = amount_paid_kes + v_apply,
          updated_at = now()
      where id = p_invoice_id;
    end if;
  end if;

  if v_excess > 0 then
    v_key := 'checkout-total:' || p_provider || ':' || p_checkout_id || ':' || v_next_cents::text;
    insert into public.tenant_credits (tenant_id, amount_kes, reason, idempotency_key, payment_id)
    values (p_tenant_id, v_excess, 'checkout_total', v_key, v_row.id)
    on conflict (idempotency_key) do nothing
    returning id into v_credit;
    if v_credit is not null then
      perform public._billing_audit(
        'system',
        'checkout_total_credit',
        p_tenant_id,
        jsonb_build_object(
          'provider', p_provider,
          'checkout_id', p_checkout_id,
          'amount_kes', v_excess,
          'credit_id', v_credit
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'noop', false,
    'applied_kes', v_apply,
    'excess_kes', v_excess,
    'amount_kes', p_total_kes,
    'partial', v_excess = 0 and v_paid < v_inv.total_kes
  );
end;
$$;

revoke all on function public.reconcile_checkout_total(text, text, numeric, uuid, uuid, jsonb, integer, text, integer) from public, anon, authenticated;
grant execute on function public.reconcile_checkout_total(text, text, numeric, uuid, uuid, jsonb, integer, text, integer) to service_role;
