-- Invoice pay checkout review, round 9 (P16).
-- Apply after invoice_pay_checkout_review_round8.sql (P15).
-- Does not replace finalize_invoice.
-- Replaces open_checkout_total_review (same arguments) so the review stores checkout_id.
-- Replaces resolve_checkout_total_review. Does not edit any other P1-P15 function body.
-- Production (fjxcdccgyhnvnnlnovcl) has this file. Applied 2026-10-19
-- 08:11-08:13 UTC, versions 20261019081159 through 20261019081339. Do not re-run.
-- Do not re-run P5, P9, P11, P12, P14, or P15 after P16.
-- P15 restores a resolve that does not book. P14 restores the two-argument resolve
-- and the older settle. P12 restores create_invoice_pay_attempt without the review
-- hold. P11 and P9 restore older session functions. P5 restores older pay functions.
--
-- A placeholder or blank collection id is still not applied when it arrives.
-- Resolve no longer lifts that hold by itself.
-- book reads the stored GET, or p_total_kes when staff pass a fresher total,
-- and applies the rise through reconcile_checkout_total up to the amount due.
-- The excess is one checkout_total credit. nothing leaves the books.
-- A replay does not book again. Every successful call writes _billing_audit.

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
      'checkout_id', p_checkout_id,
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
drop function if exists public.resolve_checkout_total_review(text, text, text, text);

create or replace function public.resolve_checkout_total_review(
  p_provider text,
  p_provider_ref text,
  p_actor text,
  p_reason text,
  p_choice text,
  p_total_kes numeric default null
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
  v_raw jsonb;
  v_get numeric;
  v_total numeric;
  v_checkout text;
  v_book jsonb;
  v_applied numeric := 0;
  v_excess numeric := 0;
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
  if p_choice is distinct from 'book' and p_choice is distinct from 'nothing' then
    raise exception 'resolve choice is required';
  end if;
  if p_provider_ref not like 'checkout-total-review:%' then
    raise exception 'checkout review not found';
  end if;
  select invoice_id, tenant_id, coalesce(raw->>'review_status', 'open'), coalesce(raw, '{}'::jsonb)
  into v_invoice, v_tenant, v_status, v_raw
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

  v_get := coalesce((v_raw->>'get_kes')::numeric, 0);

  if v_status is distinct from 'resolved' then
    if p_choice = 'book' then
      if p_total_kes is not null and round(p_total_kes * 100) < round(v_get * 100) then
        raise exception 'collected total fell';
      end if;
      v_total := coalesce(p_total_kes, v_get);
      v_checkout := nullif(btrim(v_raw->>'checkout_id'), '');
      if v_checkout is null then
        raise exception 'pay attempt not found';
      end if;
      v_book := public.reconcile_checkout_total(
        p_provider,
        v_checkout,
        v_total,
        v_tenant,
        v_invoice,
        coalesce(v_raw->'event', '{}'::jsonb)
      );
      v_applied := coalesce((v_book->>'applied_kes')::numeric, 0);
      v_excess := coalesce((v_book->>'excess_kes')::numeric, 0);
    end if;
    update public.payments
    set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(
      'review_status', 'resolved',
      'resolve_choice', p_choice
    )
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
      'invoice_id', v_invoice,
      'choice', p_choice,
      'applied_kes', v_applied,
      'excess_kes', v_excess,
      'get_kes', v_get
    )
  );
end;
$$;

revoke all on function public.resolve_checkout_total_review(text, text, text, text, text, numeric) from public, anon, authenticated;
grant execute on function public.resolve_checkout_total_review(text, text, text, text, text, numeric) to service_role;
