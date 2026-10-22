-- invoice_pay_session.sql
-- Purpose: one live Bachs checkout per invoice part. Apply after P8
--          (billing_company.sql). Does not replace finalize_invoice.
--          Does not change invoice_pay.sql, invoice_documents.sql, or
--          billing_company.sql.
-- Idempotent. Safe to re-run. Do not use CONCURRENTLY inside this script.
--
-- Production fjxcdccgyhnvnnlnovcl already has the billing SQL as of commit
-- 553f1830 (a separate release). This file is the next apply on that database.
-- Staging sgcdncjxauhsbunobmob already has this behavior from
-- invoice_pay_review_round3_session (20261018231222),
-- invoice_pay_review_round3_attempt (20261018231257),
-- invoice_pay_review_round3_live (20261018231309), and
-- invoice_pay_review_round3_recon (20261018231444), then recorded again as
-- invoice_pay_session (20261018233254).
--
-- Replaces the one-pending index so it also covers pending_unattached.
-- Adds park_invoice_pay_attempt. create_invoice_pay_attempt returns
-- unattached for that row. invoice_pay_attempt_by_checkout returns live_part.
-- settle_invoice_pay_attempt accepts pending_unattached.
-- billing_payment_reconciliation lists a failed or unattached collection
-- that was credited.

-- One live checkout row per part. pending_unattached holds a Bachs session whose
-- URL was not stored. Drop and recreate is a short lock, not a table rewrite.
-- Staging payment_attempts was empty when this landed. Do not use CONCURRENTLY
-- inside the migration transaction.
drop index if exists public.payment_attempts_one_pending_part;
create unique index payment_attempts_one_pending_part
  on public.payment_attempts (invoice_id, part_index)
  where status in ('pending', 'pending_unattached');

alter table public.payment_attempts drop constraint if exists payment_attempts_status_check;
alter table public.payment_attempts
  add constraint payment_attempts_status_check
  check (status in ('pending', 'pending_unattached', 'succeeded', 'failed', 'issue', 'cancelled', 'superseded'));

-- ---------------------------------------------------------------------------
-- Reserve the next part. Locks the invoice, keeps one live row per part
-- (pending or pending_unattached). An expired checkout stays pending and
-- returns cancel=true. The caller cancels the Bachs session, reads it, and
-- inserts another row only when that read says the session is closed.
-- pending_unattached means the session id is stored and the next click must
-- read it before any new row. A null checkout URL is still in flight.
-- A reference is single-use, including after expiry. The return id expires
-- 24 hours after the row is inserted.
-- ---------------------------------------------------------------------------
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
        'unattached', true
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
        'unattached', false
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
      'unattached', false
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
    'unattached', false
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
      'unattached', v_existing.status = 'pending_unattached'
    );
end;
$$;

revoke all on function public.create_invoice_pay_attempt(text, numeric) from public, anon, authenticated;
grant execute on function public.create_invoice_pay_attempt(text, numeric) to service_role;

-- Keep the Bachs session id when the URL attach fails. The next click reads
-- that session and reuses it or blocks. It does not insert another attempt
-- while this row is pending_unattached.
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
begin
  if nullif(btrim(p_checkout_session_id), '') is null then
    raise exception 'checkout id is required';
  end if;
  if nullif(btrim(p_checkout_url), '') is not null and p_checkout_url !~ '^https://' then
    raise exception 'checkout url refused';
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

create or replace function public.invoice_pay_attempt_by_checkout(p_checkout_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.payment_attempts%rowtype;
  v_inv public.invoices%rowtype;
  v_part record;
  v_live boolean := false;
begin
  if nullif(btrim(p_checkout_id), '') is null then
    return null;
  end if;
  select * into v_row
  from public.payment_attempts
  where checkout_session_id = p_checkout_id
  order by created_at desc
  limit 1;
  if not found then
    return null;
  end if;
  if v_row.status in ('pending', 'pending_unattached', 'failed') then
    select * into v_inv from public.invoices where id = v_row.invoice_id;
    if found and v_inv.status = 'open' then
      select * into v_part
      from public.invoice_next_pay_part(v_inv.total_kes, v_inv.amount_paid_kes);
      if v_part.part_index is not distinct from v_row.part_index
         and v_part.part_index is not null
         and round(v_part.amount_kes * 100) is not distinct from round(v_row.amount_kes * 100)
         and not exists (
           select 1
           from public.payment_attempts newer
           where newer.invoice_id = v_row.invoice_id
             and newer.part_index is not distinct from v_row.part_index
             and newer.id <> v_row.id
             and newer.status in ('pending', 'pending_unattached', 'succeeded')
             and newer.created_at >= v_row.created_at
         ) then
        v_live := true;
      end if;
    end if;
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'invoice_id', v_row.invoice_id,
    'tenant_id', v_row.tenant_id,
    'status', v_row.status,
    'amount_kes', v_row.amount_kes,
    'currency', v_row.currency,
    'part_index', v_row.part_index,
    'part_count', v_row.part_count,
    'checkout_session_id', v_row.checkout_session_id,
    'live_part', v_live
  );
end;
$$;

revoke all on function public.invoice_pay_attempt_by_checkout(text) from public, anon, authenticated;
grant execute on function public.invoice_pay_attempt_by_checkout(text) to service_role;

create or replace function public.settle_invoice_pay_attempt(
  p_attempt_id uuid,
  p_status text,
  p_provider_amount numeric default null,
  p_provider_currency text default null,
  p_fee_amount numeric default null,
  p_fee_currency text default null,
  p_raw jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('pending', 'pending_unattached', 'succeeded', 'failed', 'issue', 'cancelled', 'superseded') then
    raise exception 'unknown attempt status';
  end if;
  update public.payment_attempts
  set status = p_status,
      provider_amount = p_provider_amount,
      provider_currency = p_provider_currency,
      fee_amount = p_fee_amount,
      fee_currency = p_fee_currency,
      raw = coalesce(p_raw, '{}'::jsonb),
      updated_at = now()
  where id = p_attempt_id;
end;
$$;

revoke all on function public.settle_invoice_pay_attempt(uuid, text, numeric, text, numeric, text, jsonb) from public, anon, authenticated;
grant execute on function public.settle_invoice_pay_attempt(uuid, text, numeric, text, numeric, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Report only. Pending over 30 minutes, and rows whose status disagrees.
-- ---------------------------------------------------------------------------
create or replace function public.billing_payment_reconciliation()
returns table (kind text, attempt_id uuid, invoice_id uuid, payment_id uuid, detail text)
language sql
stable
security definer
set search_path = public
as $$
  select
    'pending_timeout'::text,
    a.id,
    a.invoice_id,
    null::uuid,
    'Pending for more than 30 minutes'::text
  from public.payment_attempts a
  where a.status = 'pending'
    and a.created_at < now() - interval '30 minutes'
  union all
  select
    'status_disagreement',
    a.id,
    a.invoice_id,
    null::uuid,
    'Attempt succeeded with no payment'
  from public.payment_attempts a
  where a.status = 'succeeded'
    and a.checkout_session_id is not null
    and not exists (
      select 1 from public.payments p
      where p.provider_ref = a.checkout_session_id
         or p.bill_ref = a.checkout_session_id
    )
  union all
  select
    'status_disagreement',
    a.id,
    a.invoice_id,
    p.id,
    'Payment recorded while the attempt is still pending'
  from public.payment_attempts a
  join public.payments p
    on p.provider_ref = a.checkout_session_id
    or p.bill_ref = a.checkout_session_id
  where a.status = 'pending'
    and a.checkout_session_id is not null
  union all
  select
    'status_disagreement',
    null::uuid,
    i.id,
    null::uuid,
    'Invoice paid without a matched payment'
  from public.invoices i
  where i.status = 'paid'
    and i.total_kes > 0
    and not exists (
      select 1 from public.payments p
      where p.invoice_id = i.id
        and p.match_status in ('matched', 'partial', 'over')
    )
    and not exists (
      select 1 from public.tenant_credits c
      where c.idempotency_key = 'invoice-credit:' || i.id::text
    )
  union all
  select
    'status_disagreement',
    null::uuid,
    i.id,
    null::uuid,
    'Invoice open but the amount paid covers the total'
  from public.invoices i
  where i.status = 'open'
    and i.total_kes > 0
    and i.amount_paid_kes >= i.total_kes
  union all
  select
    'issue',
    a.id,
    a.invoice_id,
    p.id,
    'Payment needs a check'
  from public.payment_attempts a
  left join public.payments p on p.provider_ref = a.checkout_session_id
  where a.status = 'issue'
  union all
  select
    'issue',
    null::uuid,
    p.invoice_id,
    p.id,
    'Payment needs a check'
  from public.payments p
  where p.match_status = 'issue'
    and not exists (
      select 1 from public.payment_attempts a
      where a.status = 'issue'
        and a.checkout_session_id = p.provider_ref
    )
  union all
  select
    'overpaid',
    a.id,
    a.invoice_id,
    p.id,
    'Payer sent more than the checkout'
  from public.payment_attempts a
  join public.payments p
    on p.provider_ref = a.checkout_session_id
  where lower(coalesce(p.raw #>> '{data,status}', '')) = 'overpaid'
  union all
  select
    'credited_cancelled',
    a.id,
    a.invoice_id,
    p.id,
    'Collected on a cancelled checkout and credited'
  from public.payment_attempts a
  join public.payments p
    on p.provider = a.provider
   and p.provider_ref = a.checkout_session_id
  join public.tenant_credits c
    on c.idempotency_key = 'cancelled:' || p.provider || ':' || p.provider_ref
  where a.status in ('cancelled', 'superseded', 'failed', 'pending_unattached')
  union all
  select
    'status_disagreement',
    a.id,
    a.invoice_id,
    p.id,
    'Collected on a cancelled checkout with no credit'
  from public.payment_attempts a
  join public.payments p
    on p.provider = a.provider
   and p.provider_ref = a.checkout_session_id
  where a.status in ('cancelled', 'superseded', 'failed', 'pending_unattached')
    and p.match_status = 'issue'
    and p.amount_kes > 0
    and not exists (
      select 1 from public.tenant_credits c
      where c.idempotency_key = 'cancelled:' || p.provider || ':' || p.provider_ref
    );
$$;

comment on function public.billing_payment_reconciliation() is
  'Report only. Does not update attempts, payments, or invoices.';

revoke all on function public.billing_payment_reconciliation() from public, anon, authenticated;
grant execute on function public.billing_payment_reconciliation() to service_role;

