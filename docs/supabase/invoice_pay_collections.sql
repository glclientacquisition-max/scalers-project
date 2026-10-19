-- invoice_pay_collections.sql
-- Purpose: P12. Apply after P11 (invoice_pay_held.sql).
--          Does not replace finalize_invoice. Does not edit P1-P11.
-- Idempotent as a function replace. Do not re-run it. Later files replaced these functions.
--
-- A succeeded checkout stays held until Bachs has been read and the session
-- is closed, even after checkout_expires_at. release_held_pay_checkout sets
-- checkout_closed_at so the next click can insert the remainder.
--
-- reconcile_checkout_collection keys a payment on Bachs' collection id
-- (M-Pesa receipt, else charge or payment id, else the checkout id when that
-- is all Bachs sent). The amount is the authoritative total for that id.
-- The delta above what is already stored is applied to the invoice up to the
-- amount due. Only the excess is a credit, keyed per collection and total,
-- so a replay is a no-op.
--
-- Production fjxcdccgyhnvnnlnovcl has this file. Applied 2026-10-19
-- 08:11-08:13 UTC, versions 20261019081159 through 20261019081339.
-- Do not re-run. Staging sgcdncjxauhsbunobmob: invoice_pay_collections 20261019015637.

alter table public.payment_attempts
  add column if not exists checkout_closed_at timestamptz;

comment on column public.payment_attempts.checkout_closed_at is
  'Set when a read of the succeeded checkout says the Bachs session is closed. Until then the part stays held, including after checkout_expires_at.';

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

-- A closed read frees the part. The session id stays. The succeeded row is not cancelled.
create or replace function public.release_held_pay_checkout(p_attempt_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.payment_attempts
  set checkout_closed_at = now(),
      checkout_expires_at = now() - interval '1 second',
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

-- One payment row per collection id. A higher authoritative total applies only
-- the delta. A replay or a lower report does nothing.
create or replace function public.reconcile_checkout_collection(
  p_provider text,
  p_provider_ref text,
  p_checkout_id text,
  p_amount_kes numeric,
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
  v_existing public.payments%rowtype;
  v_row public.payments%rowtype;
  v_next_cents bigint;
  v_prev_cents bigint;
  v_delta numeric;
  v_due numeric;
  v_apply numeric;
  v_excess numeric;
  v_paid numeric;
  v_match text;
  v_key text;
  v_credit uuid;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_provider_ref), '') is null then
    raise exception 'provider and provider ref are required';
  end if;
  if p_amount_kes is null or p_amount_kes <= 0 then
    raise exception 'payment amount must be positive';
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

  v_next_cents := round(p_amount_kes * 100);
  select * into v_existing
  from public.payments
  where provider = p_provider
    and provider_ref = p_provider_ref
    and match_status is distinct from 'issue'
  for update;
  v_prev_cents := case when found then round(v_existing.amount_kes * 100) else 0 end;
  if v_next_cents <= v_prev_cents then
    return jsonb_build_object(
      'noop', true,
      'applied_kes', 0,
      'excess_kes', 0,
      'amount_kes', coalesce(v_existing.amount_kes, 0)
    );
  end if;

  v_delta := (v_next_cents - v_prev_cents) / 100.0;
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

  if found then
    update public.payments
    set amount_kes = p_amount_kes,
        match_status = v_match,
        bill_ref = coalesce(nullif(btrim(p_checkout_id), ''), bill_ref),
        raw = coalesce(p_raw, raw),
        settled_amount_minor = coalesce(p_settled_amount_minor, settled_amount_minor),
        settled_currency = coalesce(p_settled_currency, settled_currency),
        fee_minor = coalesce(p_fee_minor, fee_minor)
    where id = v_existing.id
    returning * into v_row;
  else
    insert into public.payments (
      tenant_id, invoice_id, provider, provider_ref, amount_kes,
      settled_amount_minor, settled_currency, fee_minor,
      match_status, bill_ref, paid_at, raw, actor
    ) values (
      p_tenant_id, p_invoice_id, p_provider, p_provider_ref, p_amount_kes,
      p_settled_amount_minor, p_settled_currency, p_fee_minor,
      v_match, nullif(btrim(p_checkout_id), ''), now(),
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
    v_key := 'collection-excess:' || p_provider || ':' || p_provider_ref || ':' || v_next_cents::text;
    insert into public.tenant_credits (tenant_id, amount_kes, reason, idempotency_key, payment_id)
    values (p_tenant_id, v_excess, 'collection_excess', v_key, v_row.id)
    on conflict (idempotency_key) do nothing
    returning id into v_credit;
    if v_credit is not null then
      perform public._billing_audit(
        'system',
        'collection_excess_credit',
        p_tenant_id,
        jsonb_build_object(
          'provider', p_provider,
          'provider_ref', p_provider_ref,
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
    'amount_kes', p_amount_kes
  );
end;
$$;

revoke all on function public.reconcile_checkout_collection(text, text, text, numeric, uuid, uuid, jsonb, integer, text, integer) from public, anon, authenticated;
grant execute on function public.reconcile_checkout_collection(text, text, text, numeric, uuid, uuid, jsonb, integer, text, integer) to service_role;
