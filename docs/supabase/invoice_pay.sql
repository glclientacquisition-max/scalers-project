-- invoice_pay.sql
-- Purpose: pay links for an open invoice, split M-Pesa parts, and a report of
--          payments that are stuck or disagree. Does not call Bachs.
--          Does not mark an invoice paid by itself. apply_payment still does that.
-- Run after: billing_data_layer.sql
-- Idempotent. Safe to re-run.
--
-- DO NOT RUN on production fjxcdccgyhnvnnlnovcl until a backup and Alvin's GO.
-- Staging project is sgcdncjxauhsbunobmob. This file is the production script.
--
-- A pay token is random. Only its sha256 hex is stored. pgcrypto lives in
-- extensions on Supabase and in public under PGlite, so the token functions
-- search both. Rotating revokes the
-- previous token. Beta tenants (billing_enforcement off) cannot be minted a link.
--
-- M-Pesa's cap is KSh 150,000 per transaction. invoice_kes_parts splits a larger
-- total into parts that each stay under that cap and sum to the total.
-- A part is applied with apply_payment. The invoice is paid when the total is met.
-- A payment that does not match goes through record_payment_issue and does not
-- increase amount_paid.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Pay tokens. One active link per invoice.
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_pay_tokens (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists invoice_pay_tokens_hash_uidx
  on public.invoice_pay_tokens (token_hash);

create unique index if not exists invoice_pay_tokens_one_active
  on public.invoice_pay_tokens (invoice_id)
  where revoked_at is null;

alter table public.payment_attempts
  add column if not exists part_index integer,
  add column if not exists part_count integer,
  add column if not exists currency text not null default 'KES',
  add column if not exists provider_amount numeric,
  add column if not exists provider_currency text,
  add column if not exists fee_amount numeric,
  add column if not exists fee_currency text,
  add column if not exists checkout_url text,
  add column if not exists checkout_expires_at timestamptz,
  add column if not exists client_reference text,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists raw jsonb not null default '{}'::jsonb;

alter table public.payment_attempts drop constraint if exists payment_attempts_status_check;
alter table public.payment_attempts
  add constraint payment_attempts_status_check
  check (status in ('pending', 'succeeded', 'failed', 'issue', 'cancelled'));

create index if not exists payment_attempts_invoice_idx
  on public.payment_attempts (invoice_id, created_at);

create index if not exists payment_attempts_pending_idx
  on public.payment_attempts (created_at)
  where status = 'pending';

do $$
declare
  v_name text;
begin
  select c.conname into v_name
  from pg_constraint c
  where c.conrelid = 'public.payments'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%match_status%';
  if v_name is not null then
    execute format('alter table public.payments drop constraint %I', v_name);
  end if;
end $$;

alter table public.payments
  add constraint payments_match_status_check
  check (match_status in ('matched', 'partial', 'over', 'unmatched', 'issue'));

alter table public.invoice_pay_tokens enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.payments enable row level security;

revoke all on table public.invoice_pay_tokens from public, anon, authenticated;
grant all on table public.invoice_pay_tokens to service_role;

-- ---------------------------------------------------------------------------
-- Split. Same cents rule as dashboard/src/lib/invoicePay/money.js.
-- ---------------------------------------------------------------------------
create or replace function public.invoice_kes_parts(p_total numeric)
returns numeric[]
language plpgsql
immutable
as $$
declare
  v_cents bigint;
  v_limit bigint := 15000000;
  v_n integer;
  v_base bigint;
  v_rem bigint;
  v_i integer;
  v_part bigint;
  v_parts numeric[] := '{}';
begin
  if p_total is null or p_total <= 0 then
    return v_parts;
  end if;
  v_cents := round(p_total * 100)::bigint;
  if v_cents <= 0 then
    return v_parts;
  end if;
  if v_cents <= v_limit then
    return array[(v_cents::numeric / 100)];
  end if;
  v_n := ceil(v_cents::numeric / v_limit)::integer;
  v_base := v_cents / v_n;
  v_rem := v_cents % v_n;
  for v_i in 1..v_n loop
    v_part := v_base;
    if v_rem > 0 then
      v_part := v_part + 1;
      v_rem := v_rem - 1;
    end if;
    v_parts := v_parts || (v_part::numeric / 100);
  end loop;
  return v_parts;
end;
$$;

create or replace function public.invoice_next_pay_part(p_total numeric, p_paid numeric)
returns table (part_index integer, part_count integer, amount_kes numeric)
language plpgsql
immutable
as $$
declare
  v_parts numeric[];
  v_paid bigint;
  v_cursor bigint := 0;
  v_size bigint;
  v_i integer;
begin
  v_parts := public.invoice_kes_parts(p_total);
  part_count := coalesce(array_length(v_parts, 1), 0);
  if part_count = 0 then
    return;
  end if;
  v_paid := round(coalesce(p_paid, 0) * 100)::bigint;
  for v_i in 1..part_count loop
    v_size := round(v_parts[v_i] * 100)::bigint;
    if v_paid < v_cursor + v_size then
      part_index := v_i;
      amount_kes := ((v_cursor + v_size - v_paid)::numeric / 100);
      return next;
      return;
    end if;
    v_cursor := v_cursor + v_size;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Mint or rotate. The raw token is returned once and is not stored.
-- ---------------------------------------------------------------------------
create or replace function public.mint_invoice_pay_token(
  p_invoice_id uuid,
  p_rotate boolean default false
)
returns table (token text, expires_at timestamptz, invoice_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_inv public.invoices%rowtype;
  v_tenant public.tenants%rowtype;
  v_token text;
  v_hash text;
  v_expires timestamptz;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status <> 'open' then
    raise exception 'only an open invoice can have a pay link';
  end if;
  if v_inv.amount_paid_kes >= v_inv.total_kes then
    raise exception 'invoice has nothing left to pay';
  end if;

  select * into v_tenant from public.tenants where id = v_inv.tenant_id;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_tenant.archived_at is not null then
    raise exception 'archived businesses have no pay link';
  end if;
  if coalesce(v_tenant.billing_enforcement, 'off') = 'off' then
    raise exception 'beta tenants have no pay link';
  end if;

  if coalesce(p_rotate, false) then
    update public.invoice_pay_tokens
    set revoked_at = now()
    where invoice_pay_tokens.invoice_id = p_invoice_id
      and revoked_at is null;
  elsif exists (
    select 1 from public.invoice_pay_tokens t
    where t.invoice_id = p_invoice_id and t.revoked_at is null
  ) then
    raise exception 'pay link already exists';
  end if;

  v_token := 'pay_' || rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');
  v_expires := now() + interval '7 days';

  insert into public.invoice_pay_tokens (invoice_id, tenant_id, token_hash, expires_at)
  values (p_invoice_id, v_inv.tenant_id, v_hash, v_expires);

  perform public._billing_audit(
    'system',
    'mint_invoice_pay_token',
    v_inv.tenant_id,
    jsonb_build_object(
      'invoice_id', p_invoice_id,
      'expires_at', v_expires,
      'rotated', coalesce(p_rotate, false)
    )
  );

  token := v_token;
  expires_at := v_expires;
  invoice_id := p_invoice_id;
  return next;
end;
$$;

comment on function public.mint_invoice_pay_token(uuid, boolean) is
  'Mints an unguessable pay token, stores only the sha256 hex, and expires it after 7 days. Rotate revokes the active token first. Refuses billing_enforcement off. Does not charge.';

revoke all on function public.mint_invoice_pay_token(uuid, boolean) from public, anon, authenticated;
grant execute on function public.mint_invoice_pay_token(uuid, boolean) to service_role;

revoke all on function public.invoice_kes_parts(numeric) from public, anon, authenticated;
grant execute on function public.invoice_kes_parts(numeric) to service_role;

revoke all on function public.invoice_next_pay_part(numeric, numeric) from public, anon, authenticated;
grant execute on function public.invoice_next_pay_part(numeric, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- Public read for the server. Not granted to anon. The page calls this.
-- ---------------------------------------------------------------------------
create or replace function public.pay_invoice_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_token public.invoice_pay_tokens%rowtype;
  v_inv public.invoices%rowtype;
  v_name text;
  v_enf text;
  v_email text;
  v_phone text;
  v_state text;
begin
  if nullif(btrim(p_token), '') is null then
    return jsonb_build_object('found', false);
  end if;
  v_hash := encode(digest(btrim(p_token), 'sha256'), 'hex');
  select * into v_token from public.invoice_pay_tokens where token_hash = v_hash;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  select * into v_inv from public.invoices where id = v_token.invoice_id;
  select business_name, coalesce(billing_enforcement, 'off'),
         nullif(btrim(alert_email), ''),
         case
           when nullif(btrim(whatsapp_notification_number), '') like 'pending:%' then null
           else nullif(btrim(whatsapp_notification_number), '')
         end
    into v_name, v_enf, v_email, v_phone
  from public.tenants where id = v_token.tenant_id;

  if v_inv.status = 'paid' then
    v_state := 'paid';
  elsif v_inv.status = 'void' then
    v_state := 'void';
  elsif v_token.revoked_at is not null or v_token.expires_at <= now() then
    v_state := 'expired';
  elsif v_enf = 'off' then
    v_state := 'unavailable';
  elsif v_inv.status = 'open' then
    v_state := 'payable';
  else
    v_state := 'closed';
  end if;

  return jsonb_build_object(
    'found', true,
    'state', v_state,
    'business_name', v_name,
    'invoice_number', v_inv.invoice_number,
    'invoice_id', v_inv.id,
    'tenant_id', v_inv.tenant_id,
    'subtotal_kes', v_inv.subtotal_kes,
    'total_kes', v_inv.total_kes,
    'amount_paid_kes', v_inv.amount_paid_kes,
    'due_at', v_inv.due_at,
    'enforcement', v_enf,
    'owner_name', v_name,
    'owner_email', v_email,
    'owner_phone', v_phone
  );
end;
$$;

comment on function public.pay_invoice_by_token(text) is
  'Resolves a pay token to invoice facts. Service role only. Does not charge.';

revoke all on function public.pay_invoice_by_token(text) from public, anon, authenticated;
grant execute on function public.pay_invoice_by_token(text) to service_role;

-- ---------------------------------------------------------------------------
-- Reserve the next part. Reuses a checkout only while checkout_expires_at
-- is still in the future. A new attempt gets a new id, and that id is the
-- Bachs reference. A reference is single-use, including after expiry.
-- ---------------------------------------------------------------------------
create or replace function public.create_invoice_pay_attempt(p_token text, p_amount_kes numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lookup jsonb;
  v_invoice uuid;
  v_tenant uuid;
  v_part record;
  v_existing public.payment_attempts%rowtype;
  v_row public.payment_attempts%rowtype;
begin
  v_lookup := public.pay_invoice_by_token(p_token);
  if coalesce((v_lookup->>'found')::boolean, false) is not true
     or v_lookup->>'state' is distinct from 'payable' then
    raise exception 'invoice cannot be paid';
  end if;
  v_invoice := (v_lookup->>'invoice_id')::uuid;
  v_tenant := (v_lookup->>'tenant_id')::uuid;

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
    and status = 'pending'
    and part_index = v_part.part_index
    and checkout_url is not null
    and checkout_expires_at is not null
    and checkout_expires_at > now()
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
      'reused', true
    );
  end if;

  insert into public.payment_attempts (
    tenant_id, invoice_id, provider, status, amount_kes, currency, part_index, part_count
  ) values (
    v_tenant, v_invoice, 'bachs', 'pending', v_part.amount_kes, 'KES', v_part.part_index, v_part.part_count
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
    'reused', false
  );
end;
$$;

revoke all on function public.create_invoice_pay_attempt(text, numeric) from public, anon, authenticated;
grant execute on function public.create_invoice_pay_attempt(text, numeric) to service_role;

drop function if exists public.attach_invoice_pay_checkout(uuid, text, text);

create or replace function public.attach_invoice_pay_checkout(
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
  if nullif(btrim(p_checkout_session_id), '') is null or nullif(btrim(p_checkout_url), '') is null then
    raise exception 'checkout id and url are required';
  end if;
  if p_checkout_url !~ '^https?://' then
    raise exception 'checkout url refused';
  end if;
  if p_expires_at is null then
    raise exception 'checkout expiry is required';
  end if;
  update public.payment_attempts
  set checkout_session_id = p_checkout_session_id,
      checkout_url = p_checkout_url,
      checkout_expires_at = p_expires_at,
      updated_at = now()
  where id = p_attempt_id
    and status = 'pending';
  if not found then
    raise exception 'pay attempt is not pending';
  end if;
end;
$$;

revoke all on function public.attach_invoice_pay_checkout(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.attach_invoice_pay_checkout(uuid, text, text, timestamptz) to service_role;

create or replace function public.invoice_pay_attempt_by_checkout(p_checkout_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.payment_attempts%rowtype;
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
  return jsonb_build_object(
    'id', v_row.id,
    'invoice_id', v_row.invoice_id,
    'tenant_id', v_row.tenant_id,
    'status', v_row.status,
    'amount_kes', v_row.amount_kes,
    'currency', v_row.currency,
    'part_index', v_row.part_index,
    'part_count', v_row.part_count,
    'checkout_session_id', v_row.checkout_session_id
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
  if p_status not in ('pending', 'succeeded', 'failed', 'issue', 'cancelled') then
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
-- Mismatch. Records the payment and does not change the invoice.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment_issue(
  p_provider text,
  p_provider_ref text,
  p_amount_kes numeric,
  p_tenant_id uuid default null,
  p_invoice_id uuid default null,
  p_raw jsonb default '{}'::jsonb,
  p_settled_amount_minor integer default null,
  p_settled_currency text default null,
  p_fee_minor integer default null,
  p_reason text default 'mismatch'
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.payments%rowtype;
  v_row public.payments%rowtype;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_provider_ref), '') is null then
    raise exception 'provider and provider ref are required';
  end if;

  select * into v_existing
  from public.payments
  where provider = p_provider and provider_ref = p_provider_ref;
  if found then
    return v_existing;
  end if;

  perform public._billing_audit(
    'bachs-webhook',
    'payment_issue',
    p_tenant_id,
    jsonb_build_object(
      'provider', p_provider,
      'provider_ref', p_provider_ref,
      'amount_kes', p_amount_kes,
      'reason', p_reason,
      'invoice_id', p_invoice_id,
      'settled_currency', p_settled_currency
    )
  );

  if p_amount_kes is null or p_amount_kes <= 0 then
    return null;
  end if;

  insert into public.payments (
    tenant_id, invoice_id, provider, provider_ref, amount_kes,
    settled_amount_minor, settled_currency, fee_minor,
    match_status, bill_ref, raw, actor
  ) values (
    p_tenant_id, p_invoice_id, p_provider, p_provider_ref, p_amount_kes,
    p_settled_amount_minor, p_settled_currency, p_fee_minor,
    'issue', p_provider_ref, coalesce(p_raw, '{}'::jsonb), 'bachs-webhook'
  )
  returning * into v_row;
  return v_row;
end;
$$;

comment on function public.record_payment_issue(text, text, numeric, uuid, uuid, jsonb, integer, text, integer, text) is
  'Idempotent on (provider, provider_ref). Does not increase amount_paid and does not mark the invoice paid.';

revoke all on function public.record_payment_issue(text, text, numeric, uuid, uuid, jsonb, integer, text, integer, text) from public, anon, authenticated;
grant execute on function public.record_payment_issue(text, text, numeric, uuid, uuid, jsonb, integer, text, integer, text) to service_role;

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
    and not exists (
      select 1 from public.payments p
      where p.invoice_id = i.id
        and p.match_status in ('matched', 'partial', 'over')
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
  where lower(coalesce(p.raw #>> '{data,status}', '')) = 'overpaid';
$$;

comment on function public.billing_payment_reconciliation() is
  'Report only. Does not update attempts, payments, or invoices.';

revoke all on function public.billing_payment_reconciliation() from public, anon, authenticated;
grant execute on function public.billing_payment_reconciliation() to service_role;
