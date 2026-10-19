-- Invoice pay checkout review, round 8 (P15).
-- Apply after invoice_pay_checkout_review.sql (P14).
-- Does not replace finalize_invoice. Does not edit P1-P14.
-- Production (fjxcdccgyhnvnnlnovcl) has this file. Applied 2026-10-19
-- 08:11-08:13 UTC, versions 20261019081159 through 20261019081339. Do not re-run.
-- Do not re-run P5, P9, P11, P12, or P14 after P15.
--
-- Three corrections on top of P14:
--   * ch_<checkout id> is kept. With no real receipt or charge id, a GET
--     rise, or an unchanged GET after money was already applied, is a review.
--     A GET of 0 when nothing has been collected stays a wait.
--   * An event amount equal to the checkout price is not the collection
--     amount. A real rise is applied. A new real id with no rise, after
--     money was seen, is still a review.
--   * resolve_checkout_total_review records _billing_audit with the actor
--     and the reason. It still does not move money.

create or replace function public.open_checkout_total_review(
  p_provider text,
  p_checkout_id text,
  p_identity_key text,
  p_kind text,
  p_get_kes numeric,
  p_seen_kes numeric,
  p_event_amount_kes numeric,
  p_tenant_id uuid,
  p_invoice_id uuid,
  p_raw jsonb default '{}'::jsonb,
  p_amount_kes numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text;
  v_existing public.payments%rowtype;
  v_row public.payments%rowtype;
  v_amount numeric;
  v_notice text;
  v_reason text;
begin
  if nullif(btrim(p_provider), '') is null
     or nullif(btrim(p_checkout_id), '') is null
     or nullif(btrim(p_identity_key), '') is null then
    raise exception 'provider, checkout id, and review key are required';
  end if;
  if p_invoice_id is null then
    raise exception 'invoice not found';
  end if;
  perform 1 from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;

  v_reason := case
    when p_kind = 'decrease' then 'collected_total_decreased'
    when p_kind = 'missing_identity' then 'collected_identity_missing'
    else 'collected_total_short'
  end;

  v_ref := 'checkout-total-review:' || p_provider || ':' || p_checkout_id || ':' || p_identity_key;
  if v_ref = p_checkout_id then
    raise exception 'review ref must not be the checkout id';
  end if;

  select * into v_existing
  from public.payments
  where provider = p_provider
    and provider_ref = v_ref;
  if found then
    return jsonb_build_object(
      'review', true,
      'duplicate', true,
      'reason', v_reason,
      'noop', false,
      'applied_kes', 0,
      'excess_kes', 0,
      'amount_kes', v_existing.amount_kes,
      'partial', false,
      'provider_ref', v_ref
    );
  end if;

  v_amount := p_amount_kes;
  if v_amount is null or v_amount <= 0 then
    v_amount := greatest(coalesce(p_event_amount_kes, 0), coalesce(p_seen_kes, 0), coalesce(p_get_kes, 0), 0.01);
  end if;

  insert into public.payments (
    tenant_id, invoice_id, provider, provider_ref, amount_kes,
    match_status, bill_ref, raw, actor
  ) values (
    p_tenant_id,
    p_invoice_id,
    p_provider,
    v_ref,
    v_amount,
    'issue',
    v_ref,
    jsonb_build_object(
      'review_status', 'open',
      'review_kind', p_kind,
      'get_kes', p_get_kes,
      'seen_kes', p_seen_kes,
      'event_amount_kes', p_event_amount_kes,
      'identity', p_identity_key,
      'event', coalesce(p_raw, '{}'::jsonb)
    ),
    'bachs-webhook'
  )
  returning * into v_row;

  perform public._billing_audit(
    'bachs-webhook',
    'checkout_total_review',
    p_tenant_id,
    jsonb_build_object(
      'provider', p_provider,
      'provider_ref', v_ref,
      'checkout_id', p_checkout_id,
      'kind', p_kind,
      'get_kes', p_get_kes,
      'seen_kes', p_seen_kes,
      'event_amount_kes', p_event_amount_kes,
      'invoice_id', p_invoice_id
    )
  );

  if to_regclass('public.platform_ops_notices') is not null then
    v_notice := 'checkout_total_review:' || p_provider || ':' || v_ref;
    begin
      insert into public.platform_ops_notices (kind, detail)
      values (
        v_notice,
        'Checkout ' || p_checkout_id
          || ' needs review. Bachs read KSh ' || trim(to_char(coalesce(p_get_kes, 0), 'FM999999990.00'))
          || '. The books already show KSh ' || trim(to_char(coalesce(p_seen_kes, 0), 'FM999999990.00'))
          || '. Another checkout stays closed until this is resolved.'
      );
    exception
      when unique_violation then
        null;
    end;
  end if;

  return jsonb_build_object(
    'review', true,
    'duplicate', false,
    'reason', v_reason,
    'noop', false,
    'applied_kes', 0,
    'excess_kes', 0,
    'amount_kes', v_row.amount_kes,
    'partial', false,
    'provider_ref', v_ref
  );
end;
$$;

revoke all on function public.open_checkout_total_review(text, text, text, text, numeric, numeric, numeric, uuid, uuid, jsonb, numeric) from public, anon, authenticated;
grant execute on function public.open_checkout_total_review(text, text, text, text, numeric, numeric, numeric, uuid, uuid, jsonb, numeric) to service_role;

drop function if exists public.resolve_checkout_total_review(text, text);

create or replace function public.resolve_checkout_total_review(
  p_provider text,
  p_provider_ref text,
  p_actor text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice uuid;
  v_tenant uuid;
  v_status text;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_provider_ref), '') is null then
    raise exception 'provider and provider ref are required';
  end if;
  if nullif(btrim(p_actor), '') is null then
    raise exception 'actor is required';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'reason is required';
  end if;
  if p_provider_ref not like 'checkout-total-review:%' then
    raise exception 'checkout review not found';
  end if;
  select invoice_id, tenant_id, coalesce(raw->>'review_status', 'open')
  into v_invoice, v_tenant, v_status
  from public.payments
  where provider = p_provider
    and provider_ref = p_provider_ref
    and match_status = 'issue'
  for update;
  if not found then
    raise exception 'checkout review not found';
  end if;
  if v_invoice is not null then
    perform 1 from public.invoices where id = v_invoice for update;
  end if;
  if v_status is distinct from 'resolved' then
    update public.payments
    set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('review_status', 'resolved')
    where provider = p_provider
      and provider_ref = p_provider_ref
      and match_status = 'issue';
    if to_regclass('public.platform_ops_notices') is not null then
      update public.platform_ops_notices
      set status = 'resolved',
          resolved_at = coalesce(resolved_at, now())
      where kind = 'checkout_total_review:' || p_provider || ':' || p_provider_ref
        and status in ('open', 'acked');
    end if;
  end if;
  perform public._billing_audit(
    btrim(p_actor),
    'checkout_total_review_resolved',
    v_tenant,
    jsonb_build_object(
      'provider', p_provider,
      'provider_ref', p_provider_ref,
      'reason', btrim(p_reason),
      'invoice_id', v_invoice
    )
  );
end;
$$;

revoke all on function public.resolve_checkout_total_review(text, text, text, text) from public, anon, authenticated;
grant execute on function public.resolve_checkout_total_review(text, text, text, text) to service_role;

-- Applies the cumulative total, or opens one review and leaves the books.
-- A placeholder charge id is not a real collection. A session-price event
-- amount does not block a real rise.
create or replace function public.settle_checkout_reading(
  p_provider text,
  p_checkout_id text,
  p_total_kes numeric,
  p_tenant_id uuid,
  p_invoice_id uuid,
  p_identity text default null,
  p_event_amount_kes numeric default null,
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
  v_attempt public.payment_attempts%rowtype;
  v_have_attempt boolean;
  v_identity text;
  v_real boolean;
  v_ids jsonb;
  v_next_cents bigint;
  v_seen_cents bigint;
  v_event_cents bigint;
  v_price_cents bigint;
  v_amount_is_price boolean;
  v_rise bigint;
  v_known boolean;
  v_applied jsonb;
  v_key text;
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
  perform 1 from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
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

  v_identity := nullif(btrim(p_identity), '');
  v_real := v_identity is not null and v_identity is distinct from ('ch_' || p_checkout_id);
  v_ids := coalesce(v_attempt.collection_ids, '[]'::jsonb);
  v_next_cents := round(p_total_kes * 100);
  v_seen_cents := round(coalesce(v_attempt.collected_total_seen_kes, 0) * 100);
  v_event_cents := null;
  if p_event_amount_kes is not null and p_event_amount_kes > 0 then
    v_event_cents := round(p_event_amount_kes * 100);
  end if;
  v_price_cents := round(coalesce(v_attempt.amount_kes, 0) * 100);
  v_amount_is_price := v_event_cents is not null and v_price_cents > 0 and v_event_cents = v_price_cents;
  v_rise := v_next_cents - v_seen_cents;
  v_known := v_real and not (v_ids @> jsonb_build_array(v_identity));

  if v_next_cents < v_seen_cents then
    return public.open_checkout_total_review(
      p_provider,
      p_checkout_id,
      'lower:' || v_seen_cents::text || ':' || v_next_cents::text,
      'decrease',
      p_total_kes,
      coalesce(v_attempt.collected_total_seen_kes, 0),
      p_event_amount_kes,
      p_tenant_id,
      p_invoice_id,
      p_raw,
      (v_seen_cents - v_next_cents) / 100.0
    );
  end if;

  if not v_real and (v_rise > 0 or (v_rise = 0 and v_seen_cents > 0)) then
    v_key := coalesce(v_identity, 'missing') || ':' || v_seen_cents::text || ':' || v_next_cents::text;
    return public.open_checkout_total_review(
      p_provider,
      p_checkout_id,
      v_key,
      'missing_identity',
      p_total_kes,
      coalesce(v_attempt.collected_total_seen_kes, 0),
      p_event_amount_kes,
      p_tenant_id,
      p_invoice_id,
      p_raw,
      case when v_rise > 0 then v_rise / 100.0 else coalesce(v_attempt.collected_total_seen_kes, p_total_kes) end
    );
  end if;

  if v_known and v_event_cents is not null and not v_amount_is_price and v_rise < v_event_cents then
    return public.open_checkout_total_review(
      p_provider,
      p_checkout_id,
      v_identity,
      'short_rise',
      p_total_kes,
      coalesce(v_attempt.collected_total_seen_kes, 0),
      p_event_amount_kes,
      p_tenant_id,
      p_invoice_id,
      p_raw,
      p_event_amount_kes
    );
  end if;

  if v_known and (v_event_cents is null or v_amount_is_price) and v_rise = 0 and v_seen_cents > 0 then
    return public.open_checkout_total_review(
      p_provider,
      p_checkout_id,
      v_identity,
      'short_rise',
      p_total_kes,
      coalesce(v_attempt.collected_total_seen_kes, 0),
      p_event_amount_kes,
      p_tenant_id,
      p_invoice_id,
      p_raw,
      coalesce(v_attempt.collected_total_seen_kes, p_total_kes)
    );
  end if;

  if v_next_cents = 0 or v_next_cents <= v_seen_cents then
    return jsonb_build_object(
      'noop', true,
      'review', false,
      'wait', v_next_cents = 0,
      'applied_kes', 0,
      'excess_kes', 0,
      'amount_kes', coalesce(v_attempt.collected_total_seen_kes, 0),
      'partial', false
    );
  end if;

  v_applied := public.reconcile_checkout_total(
    p_provider,
    p_checkout_id,
    p_total_kes,
    p_tenant_id,
    p_invoice_id,
    p_raw,
    p_settled_amount_minor,
    p_settled_currency,
    p_fee_minor
  );

  if v_real then
    update public.payment_attempts
    set collection_ids = case
      when coalesce(collection_ids, '[]'::jsonb) @> jsonb_build_array(v_identity)
        then coalesce(collection_ids, '[]'::jsonb)
      else coalesce(collection_ids, '[]'::jsonb) || jsonb_build_array(v_identity)
    end
    where id = v_attempt.id;
  end if;

  return v_applied || jsonb_build_object('review', false, 'duplicate', false);
end;
$$;

revoke all on function public.settle_checkout_reading(text, text, numeric, uuid, uuid, text, numeric, jsonb, integer, text, integer) from public, anon, authenticated;
grant execute on function public.settle_checkout_reading(text, text, numeric, uuid, uuid, text, numeric, jsonb, integer, text, integer) to service_role;
