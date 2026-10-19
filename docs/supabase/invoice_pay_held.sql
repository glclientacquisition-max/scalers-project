-- invoice_pay_held.sql
-- Purpose: P11. Apply after P10 (billing_mode_legal_pairs.sql).
--          Does not replace finalize_invoice. Does not edit P1-P10.
-- Idempotent. Safe to re-run. No table rewrite. No tenant DML.
--
-- A succeeded checkout that has not expired holds its part. The next click
-- reads that Bachs session and does not insert another attempt while it is
-- open. release_held_pay_checkout stamps the expiry in the past and keeps
-- the session id. park_invoice_pay_attempt refuses a different session id.
-- credit_checkout_extra inserts one tenant_credits row per provider ref.
--
-- Production fjxcdccgyhnvnnlnovcl does not have this file. Staging
-- sgcdncjxauhsbunobmob is the only apply.

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
    and (checkout_expires_at is null or checkout_expires_at > now())
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


-- A stored session id is not replaced. The same id may refresh the URL.
create or replace function public.park_invoice_pay_attempt(
  p_attempt_id uuid,
  p_checkout_session_id text,
  p_checkout_url text,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
begin
  if nullif(btrim(p_checkout_session_id), '') is null then
    raise exception 'checkout id is required';
  end if;
  if nullif(btrim(p_checkout_url), '') is not null and p_checkout_url !~ '^https://' then
    raise exception 'checkout url refused';
  end if;
  select checkout_session_id into v_existing
  from public.payment_attempts
  where id = p_attempt_id
    and status in ('pending', 'pending_unattached');
  if not found then
    raise exception 'pay attempt is not pending';
  end if;
  if v_existing is not null and v_existing is distinct from btrim(p_checkout_session_id) then
    raise exception 'checkout session is already parked';
  end if;
  update public.payment_attempts
  set status = 'pending_unattached',
      checkout_session_id = btrim(p_checkout_session_id),
      checkout_url = nullif(btrim(p_checkout_url), ''),
      checkout_expires_at = p_expires_at,
      updated_at = now()
  where id = p_attempt_id
    and status in ('pending', 'pending_unattached');
  if not found then
    raise exception 'pay attempt is not pending';
  end if;
end;
$$;

revoke all on function public.park_invoice_pay_attempt(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.park_invoice_pay_attempt(uuid, text, text, timestamptz) to service_role;

-- Stamp the expiry in the past so the next create can insert the remainder.
-- The session id stays. The succeeded row is not cancelled.
create or replace function public.release_held_pay_checkout(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payment_attempts
  set checkout_expires_at = now() - interval '1 second',
      updated_at = now()
  where id = p_attempt_id
    and status = 'succeeded'
    and nullif(btrim(checkout_session_id), '') is not null;
  if not found then
    raise exception 'pay attempt is not a held checkout';
  end if;
end;
$$;

revoke all on function public.release_held_pay_checkout(uuid) from public, anon, authenticated;
grant execute on function public.release_held_pay_checkout(uuid) to service_role;

-- One credit for money collected later on a checkout that already has a payment.
-- The key is the provider ref. A retry does not insert a second row.
-- This does not change the invoice balance.
create or replace function public.credit_checkout_extra(
  p_provider text,
  p_provider_ref text,
  p_amount_kes numeric,
  p_tenant_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
  v_id uuid;
  v_payment uuid;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_provider_ref), '') is null then
    raise exception 'provider and provider ref are required';
  end if;
  if p_amount_kes is null or p_amount_kes <= 0 then
    raise exception 'payment amount must be positive';
  end if;
  v_key := 'checkout-extra:' || p_provider || ':' || p_provider_ref;
  select id into v_payment
  from public.payments
  where provider = p_provider and provider_ref = p_provider_ref and match_status is distinct from 'issue';
  insert into public.tenant_credits (tenant_id, amount_kes, reason, idempotency_key, payment_id)
  values (p_tenant_id, p_amount_kes, 'checkout_extra', v_key, v_payment)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    return;
  end if;
  perform public._billing_audit(
    'system',
    'checkout_extra_credit',
    p_tenant_id,
    jsonb_build_object(
      'provider', p_provider,
      'provider_ref', p_provider_ref,
      'amount_kes', p_amount_kes,
      'credit_id', v_id
    )
  );
  if to_regclass('public.platform_ops_notices') is not null then
    begin
      insert into public.platform_ops_notices (kind, detail)
      values (
        'checkout_extra:' || p_provider || ':' || p_provider_ref,
        'Collected an extra KSh ' || trim(to_char(p_amount_kes, 'FM999999990.00'))
          || ' on an open checkout. Credited.'
      );
    exception
      when unique_violation then
        null;
    end;
  end if;
end;
$$;

revoke all on function public.credit_checkout_extra(text, text, numeric, uuid) from public, anon, authenticated;
grant execute on function public.credit_checkout_extra(text, text, numeric, uuid) to service_role;
