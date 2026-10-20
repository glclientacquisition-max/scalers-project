-- Invoice pay checkout review (P14).
-- Apply after invoice_pay_checkout_total.sql (P13).
-- Does not replace finalize_invoice. Does not edit P1-P13.
-- Production (fjxcdccgyhnvnnlnovcl) has this file. Applied 2026-10-19
-- 08:11-08:13 UTC, versions 20261019081159 through 20261019081339. Do not re-run.
--
-- A signed event is still only a trigger. Money still comes from
-- charge.amount_paid on GET /v1/checkout-sessions/{id}. This file refuses
-- to treat two failures as a quiet no-op:
--   * a receipt or charge id this checkout has not applied, when the GET
--     total does not rise by at least that event's own amount
--   * a GET total below the total already applied
-- Either one writes a single issue row, alerts staff, and blocks the next
-- checkout for that invoice until resolve_checkout_total_review. It does
-- not reverse a payment or a credit.
-- The placeholder charge id ch_<checkout id> is not a collection identity.
-- payment_events.needs_retry marks an unreadable GET for a later retry.

alter table public.payment_attempts
  add column if not exists collection_ids jsonb not null default '[]'::jsonb;

comment on column public.payment_attempts.collection_ids is
  'Receipt and charge ids already applied for this checkout. A new id whose GET does not cover its amount is a review, not a no-op.';

alter table public.payment_events
  add column if not exists needs_retry boolean not null default false;

comment on column public.payment_events.needs_retry is
  'True when the event was stored but the Bachs checkout read was unreadable. The retry job clears it after a later read.';

create index if not exists payment_events_needs_retry_idx
  on public.payment_events (provider, received_at)
  where needs_retry;

create or replace function public.mark_payment_event_retry(p_provider text, p_event_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_event_key), '') is null then
    raise exception 'provider and event key are required';
  end if;
  update public.payment_events
  set needs_retry = true
  where provider = p_provider
    and event_key = p_event_key;
end;
$$;

revoke all on function public.mark_payment_event_retry(text, text) from public, anon, authenticated;
grant execute on function public.mark_payment_event_retry(text, text) to service_role;

create or replace function public.clear_payment_event_retry(p_provider text, p_event_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_event_key), '') is null then
    raise exception 'provider and event key are required';
  end if;
  update public.payment_events
  set needs_retry = false
  where provider = p_provider
    and event_key = p_event_key;
end;
$$;

revoke all on function public.clear_payment_event_retry(text, text) from public, anon, authenticated;
grant execute on function public.clear_payment_event_retry(text, text) to service_role;

-- One issue row per review key. Does not change the invoice, the seen total,
-- or a credit. A second call with the same key returns the existing row.
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
      'reason', case when p_kind = 'decrease' then 'collected_total_decreased' else 'collected_total_short' end,
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
    'reason', case when p_kind = 'decrease' then 'collected_total_decreased' else 'collected_total_short' end,
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

create or replace function public.resolve_checkout_total_review(p_provider text, p_provider_ref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice uuid;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_provider_ref), '') is null then
    raise exception 'provider and provider ref are required';
  end if;
  if p_provider_ref not like 'checkout-total-review:%' then
    raise exception 'checkout review not found';
  end if;
  select invoice_id into v_invoice
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
end;
$$;

revoke all on function public.resolve_checkout_total_review(text, text) from public, anon, authenticated;
grant execute on function public.resolve_checkout_total_review(text, text) to service_role;

-- Applies the cumulative total, or opens one review and leaves the books.
-- A rise that covers a new collection still applies. A replay of the same
-- identity and the same total is a no-op. A lower total does not reverse.
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
  v_ids jsonb;
  v_next_cents bigint;
  v_seen_cents bigint;
  v_event_cents bigint;
  v_rise bigint;
  v_known boolean;
  v_applied jsonb;
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
  if v_identity = 'ch_' || p_checkout_id then
    v_identity := null;
  end if;
  v_ids := coalesce(v_attempt.collection_ids, '[]'::jsonb);
  v_next_cents := round(p_total_kes * 100);
  v_seen_cents := round(coalesce(v_attempt.collected_total_seen_kes, 0) * 100);
  v_event_cents := null;
  if p_event_amount_kes is not null and p_event_amount_kes > 0 then
    v_event_cents := round(p_event_amount_kes * 100);
  end if;
  v_rise := v_next_cents - v_seen_cents;
  v_known := v_identity is not null and not (v_ids @> jsonb_build_array(v_identity));

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

  if v_known and v_event_cents is not null and v_rise < v_event_cents then
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

  if v_known and v_event_cents is null and v_rise = 0 and v_seen_cents > 0 then
    return public.open_checkout_total_review(
      p_provider,
      p_checkout_id,
      v_identity,
      'short_rise',
      p_total_kes,
      coalesce(v_attempt.collected_total_seen_kes, 0),
      null,
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

  if v_identity is not null then
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

-- Same hold as P12, plus a block while a checkout-total review is open.
-- A pending or held row for the current part is still returned. The next
-- insert is what stays closed until the review is resolved.
create or replace function public.create_invoice_pay_attempt(p_token text, p_amount_kes numeric)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_lookup jsonb;
  v_invoice uuid;
  v_tenant uuid;
  v_part record;
  v_existing public.payment_attempts%rowtype;
  v_row public.payment_attempts%rowtype;
  v_inv_lock public.invoices%rowtype;
  v_return text;
begin
  v_lookup := public.pay_invoice_by_token(p_token);
  if coalesce((v_lookup->>'found')::boolean, false) is not true
     or v_lookup->>'state' is distinct from 'payable' then
    raise exception 'invoice cannot be paid';
  end if;
  v_invoice := (v_lookup->>'invoice_id')::uuid;
  v_tenant := (v_lookup->>'tenant_id')::uuid;

  select * into v_inv_lock from public.invoices where id = v_invoice for update;
  if not found then
    raise exception 'invoice not found';
  end if;

  select * into v_part
  from public.invoice_next_pay_part(
    (v_lookup->>'total_kes')::numeric,
    (v_lookup->>'amount_paid_kes')::numeric
  );
  if v_part.part_index is null then
    raise exception 'invoice has nothing left to pay';
  end if;
  if round(p_amount_kes * 100) is distinct from round(v_part.amount_kes * 100) then
    raise exception 'pay amount does not match the next part';
  end if;
  if v_part.amount_kes > 150000 then
    raise exception 'part is above the M-Pesa limit';
  end if;

  select * into v_existing
  from public.payment_attempts
  where invoice_id = v_invoice
    and status in ('pending', 'pending_unattached')
    and part_index = v_part.part_index
  order by created_at desc
  limit 1;
  if found then
    if v_existing.status = 'pending_unattached' then
      return jsonb_build_object(
        'id', v_existing.id,
        'checkout_session_id', v_existing.checkout_session_id,
        'checkout_url', v_existing.checkout_url,
        'amount_kes', v_existing.amount_kes,
        'part_index', v_existing.part_index,
        'part_count', v_existing.part_count,
        'return_id', v_existing.return_id,
        'reused', false,
        'in_flight', false,
        'cancel', false,
        'unattached', true,
        'held', false
      );
    end if;
    if v_existing.checkout_expires_at is not null and v_existing.checkout_expires_at <= now() then
      return jsonb_build_object(
        'id', v_existing.id,
        'checkout_session_id', v_existing.checkout_session_id,
        'checkout_url', v_existing.checkout_url,
        'amount_kes', v_existing.amount_kes,
        'part_index', v_existing.part_index,
        'part_count', v_existing.part_count,
        'return_id', v_existing.return_id,
        'reused', false,
        'in_flight', false,
        'cancel', true,
        'unattached', false,
        'held', false
      );
    end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'checkout_session_id', v_existing.checkout_session_id,
      'checkout_url', v_existing.checkout_url,
      'amount_kes', v_existing.amount_kes,
      'part_index', v_existing.part_index,
      'part_count', v_existing.part_count,
      'return_id', v_existing.return_id,
      'reused', true,
      'in_flight', v_existing.checkout_url is null or v_existing.checkout_session_id is null,
      'cancel', false,
      'unattached', false,
      'held', false
    );
  end if;

  select * into v_existing
  from public.payment_attempts
  where invoice_id = v_invoice
    and status = 'succeeded'
    and part_index = v_part.part_index
    and nullif(btrim(checkout_session_id), '') is not null
    and checkout_closed_at is null
  order by created_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'id', v_existing.id,
      'checkout_session_id', v_existing.checkout_session_id,
      'checkout_url', v_existing.checkout_url,
      'amount_kes', v_existing.amount_kes,
      'part_index', v_existing.part_index,
      'part_count', v_existing.part_count,
      'return_id', v_existing.return_id,
      'reused', false,
      'in_flight', false,
      'cancel', false,
      'unattached', false,
      'held', true
    );
  end if;

  if exists (
    select 1
    from public.payments
    where invoice_id = v_invoice
      and match_status = 'issue'
      and provider_ref like 'checkout-total-review:%'
      and coalesce(raw->>'review_status', 'open') is distinct from 'resolved'
  ) then
    raise exception 'checkout total needs review';
  end if;

  v_return := 'ret_' || rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.payment_attempts (
    tenant_id, invoice_id, provider, status, amount_kes, currency, part_index, part_count,
    return_id, return_expires_at, client_reference
  ) values (
    v_tenant, v_invoice, 'bachs', 'pending', v_part.amount_kes, 'KES', v_part.part_index, v_part.part_count,
    v_return, now() + interval '24 hours', null
  )
  returning * into v_row;

  update public.payment_attempts
  set client_reference = v_row.id::text
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'checkout_session_id', v_row.checkout_session_id,
    'checkout_url', v_row.checkout_url,
    'amount_kes', v_row.amount_kes,
    'part_index', v_row.part_index,
    'part_count', v_row.part_count,
    'return_id', v_row.return_id,
    'reused', false,
    'in_flight', false,
    'cancel', false,
    'unattached', false,
    'held', false
  );
exception
  when unique_violation then
    select * into v_existing
    from public.payment_attempts
    where invoice_id = v_invoice
      and status in ('pending', 'pending_unattached')
      and part_index = v_part.part_index
    order by created_at desc
    limit 1;
    if not found then
      raise;
    end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'checkout_session_id', v_existing.checkout_session_id,
      'checkout_url', v_existing.checkout_url,
      'amount_kes', v_existing.amount_kes,
      'part_index', v_existing.part_index,
      'part_count', v_existing.part_count,
      'return_id', v_existing.return_id,
      'reused', v_existing.status = 'pending',
      'in_flight', v_existing.status = 'pending' and (v_existing.checkout_url is null or v_existing.checkout_session_id is null),
      'cancel', false,
      'unattached', v_existing.status = 'pending_unattached',
      'held', false
    );
end;
$$;

revoke all on function public.create_invoice_pay_attempt(text, numeric) from public, anon, authenticated;
grant execute on function public.create_invoice_pay_attempt(text, numeric) to service_role;
