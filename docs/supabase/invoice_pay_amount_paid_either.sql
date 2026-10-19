-- Invoice pay amount_paid, either reading (P19).
-- Apply after invoice_pay_checkout_review_round9.sql (P16). P18 is unrelated.
-- Does not replace finalize_invoice. Does not edit P1-P18 function bodies except
-- resolve_checkout_total_review, which this file replaces.
-- Staging and production do not have this file until it is applied by hand.
-- Production already has P1-P18. Never re-run P5, P9, P11, P12, P14, P15, P16, P17, or P18.
--
-- GET charge.amount_paid is applied as a running total when it rises.
-- A new collection whose own amount is larger than that rise is not applied
-- on arrival. book adds the seen total plus that collection amount, once.
-- nothing leaves the books. A lower passed total is refused. A replay does
-- not book again. An event amount equal to the checkout price is not a
-- collection amount, so book keeps the running total.

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
  v_seen numeric;
  v_event numeric;
  v_price numeric;
  v_total numeric;
  v_checkout text;
  v_kind text;
  v_book jsonb;
  v_applied numeric := 0;
  v_excess numeric := 0;
  v_per_event boolean := false;
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
  v_seen := coalesce((v_raw->>'seen_kes')::numeric, 0);
  v_event := coalesce((v_raw->>'event_amount_kes')::numeric, 0);
  v_kind := coalesce(v_raw->>'review_kind', '');

  if v_status is distinct from 'resolved' then
    if p_choice = 'book' then
      if p_total_kes is not null and round(p_total_kes * 100) < round(v_get * 100) then
        raise exception 'collected total fell';
      end if;
      v_checkout := nullif(btrim(v_raw->>'checkout_id'), '');
      if v_checkout is null then
        raise exception 'pay attempt not found';
      end if;
      select amount_kes into v_price
      from public.payment_attempts
      where checkout_session_id = v_checkout
        and invoice_id = v_invoice
      order by created_at desc
      limit 1;
      v_per_event := v_kind = 'short_rise'
        and v_event > 0
        and (v_price is null or v_price <= 0 or round(v_event * 100) <> round(v_price * 100))
        and round(v_event * 100) > round(greatest(v_get - v_seen, 0) * 100);
      if v_per_event then
        v_total := v_seen + v_event;
      else
        v_total := coalesce(p_total_kes, v_get);
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
      if v_per_event and nullif(btrim(v_raw->>'identity'), '') is not null then
        update public.payment_attempts
        set collection_ids = case
          when coalesce(collection_ids, '[]'::jsonb) @> jsonb_build_array(btrim(v_raw->>'identity'))
            then coalesce(collection_ids, '[]'::jsonb)
          else coalesce(collection_ids, '[]'::jsonb) || jsonb_build_array(btrim(v_raw->>'identity'))
        end
        where checkout_session_id = v_checkout
          and invoice_id = v_invoice;
      end if;
    end if;
    update public.payments
    set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(
      'review_status', 'resolved',
      'resolve_choice', p_choice,
      'booked_per_event', v_per_event
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
      'get_kes', v_get,
      'per_event', v_per_event
    )
  );
end;
$$;

revoke all on function public.resolve_checkout_total_review(text, text, text, text, text, numeric) from public, anon, authenticated;
grant execute on function public.resolve_checkout_total_review(text, text, text, text, text, numeric) to service_role;
