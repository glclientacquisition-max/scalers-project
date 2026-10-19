-- invoice_documents.sql
-- Purpose: invoice numbers SCL-YYYY-000001, a nullable tax column, receipts,
--          and billing notice kinds for issued, due soon, payment received,
--          and overdue. Does not charge. Does not send.
--          Does not define finalize_invoice. billing_company.sql (P8) is the
--          last file and owns that function. Re-applying this file must not
--          replace it.
-- Run after: invoice_pay.sql
-- Idempotent. Safe to re-run.
--
-- DO NOT RUN on production fjxcdccgyhnvnnlnovcl until a backup and Alvin's GO.
-- Staging project is sgcdncjxauhsbunobmob.
--
-- VAT and KRA eTIMS are off. tax_kes stays null until that changes.
-- Drafts stay unnumbered. The counter moves only when an invoice is issued.

alter table public.invoices
  add column if not exists tax_kes numeric,
  add column if not exists credits_applied_kes numeric;

alter table public.invoices drop constraint if exists invoices_tax_kes_check;
alter table public.invoices
  add constraint invoices_tax_kes_check check (tax_kes is null or tax_kes >= 0);

alter table public.invoices drop constraint if exists invoices_credits_applied_kes_check;
alter table public.invoices
  add constraint invoices_credits_applied_kes_check
  check (credits_applied_kes is null or credits_applied_kes >= 0);

comment on column public.invoices.tax_kes is
  'Nullable. Unused while VAT and eTIMS are off. Do not show a zero tax line.';

comment on column public.invoices.credits_applied_kes is
  'Invoice credit applied before the total. Null when none was applied.';

alter table public.invoice_lines
  add column if not exists kind text;

alter table public.invoice_lines drop constraint if exists invoice_lines_kind_check;
alter table public.invoice_lines
  add constraint invoice_lines_kind_check
  check (
    kind is null
    or kind in ('plan', 'extra_minutes', 'extra_seats', 'message_credits', 'proration')
  );

-- ---------------------------------------------------------------------------
-- Receipts. One per recorded payment. Gapless number per Nairobi year.
-- ---------------------------------------------------------------------------
create table if not exists public.billing_receipt_counters (
  year integer primary key,
  last_number integer not null
);

create table if not exists public.invoice_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  payment_id uuid not null unique references public.payments (id) on delete restrict,
  receipt_number text not null unique,
  amount_kes numeric not null check (amount_kes > 0),
  method text not null,
  provider_ref text,
  paid_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists invoice_receipts_tenant_idx
  on public.invoice_receipts (tenant_id, created_at);

create index if not exists invoice_receipts_invoice_idx
  on public.invoice_receipts (invoice_id);

alter table public.invoice_receipts enable row level security;
revoke all on table public.invoice_receipts from public, anon, authenticated;
grant all on table public.invoice_receipts to service_role;
grant select on table public.invoice_receipts to authenticated;

drop policy if exists invoice_receipts_select_member on public.invoice_receipts;
create policy invoice_receipts_select_member
  on public.invoice_receipts for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

revoke all on table public.billing_receipt_counters from public, anon, authenticated;
grant all on table public.billing_receipt_counters to service_role;

-- ---------------------------------------------------------------------------
-- Notice kinds. The sender is still claim_billing_notices plus the existing
-- notify path. These rows are not a send.
-- ---------------------------------------------------------------------------
alter table public.billing_notices drop constraint if exists billing_notices_kind_check;
alter table public.billing_notices
  add constraint billing_notices_kind_check
  check (kind in (
    'platform_billing_trial_ending',
    'platform_billing_trial_ended',
    'platform_billing_invoice_due',
    'platform_billing_past_due',
    'platform_billing_suspended',
    'platform_billing_invoice_issued',
    'platform_billing_invoice_due_soon',
    'platform_billing_payment_received',
    'platform_billing_invoice_overdue'
  ));

create or replace function public.enqueue_billing_notice(
  p_tenant_id uuid,
  p_kind text,
  p_idempotency_key text,
  p_title text default null,
  p_body text default null
)
returns public.billing_notices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants%rowtype;
  v_channels jsonb;
  v_sms boolean;
  v_wa boolean;
  v_email_on boolean;
  v_phone text;
  v_email text;
  v_channel text;
  v_recipient text;
  v_status text;
  v_error text;
  v_title text;
  v_body text;
  v_row public.billing_notices%rowtype;
begin
  if p_tenant_id is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'tenant and idempotency key are required';
  end if;
  if p_kind not in (
    'platform_billing_trial_ending',
    'platform_billing_trial_ended',
    'platform_billing_invoice_due',
    'platform_billing_past_due',
    'platform_billing_suspended',
    'platform_billing_invoice_issued',
    'platform_billing_invoice_due_soon',
    'platform_billing_payment_received',
    'platform_billing_invoice_overdue'
  ) then
    raise exception 'unknown billing notice kind';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then
    raise exception 'business not found';
  end if;

  v_title := nullif(btrim(p_title), '');
  v_body := nullif(btrim(p_body), '');
  if p_kind = 'platform_billing_trial_ending' and v_title is null then
    v_title := 'Trial ending';
    v_body := 'Your Business Assistant trial is ending soon. The line stays on until the trial ends.';
  end if;
  if v_title is null or v_body is null then
    raise exception 'notice title and body are required';
  end if;

  v_channels := coalesce(v_tenant.notify_channels, '{"sms":true,"whatsapp":true,"email":true}'::jsonb);
  v_sms := coalesce((v_channels->>'sms')::boolean, true);
  v_wa := coalesce((v_channels->>'whatsapp')::boolean, true);
  v_email_on := coalesce((v_channels->>'email')::boolean, true);
  if not v_sms and not v_wa and not v_email_on then
    v_sms := true;
  end if;

  v_phone := nullif(btrim(v_tenant.whatsapp_notification_number), '');
  if v_phone like 'pending:%' then
    v_phone := null;
  end if;
  v_email := nullif(btrim(v_tenant.alert_email), '');

  v_channel := null;
  v_recipient := null;
  v_status := 'pending';
  v_error := null;
  -- Invoice mail prefers email. Other notices keep SMS, then WhatsApp, then email.
  if p_kind in (
    'platform_billing_invoice_issued',
    'platform_billing_invoice_due_soon',
    'platform_billing_payment_received',
    'platform_billing_invoice_overdue'
  ) and v_email_on and v_email is not null then
    v_channel := 'email';
    v_recipient := v_email;
  elsif v_sms and v_phone is not null then
    v_channel := 'sms';
    v_recipient := v_phone;
  elsif v_wa and v_phone is not null then
    v_channel := 'whatsapp';
    v_recipient := v_phone;
  elsif v_email_on and v_email is not null then
    v_channel := 'email';
    v_recipient := v_email;
  else
    v_status := 'skipped';
    v_error := 'no recipient';
  end if;

  insert into public.billing_notices (
    tenant_id, kind, title, body, channel, recipient, fallback,
    audience, billed_to, delivery_status, idempotency_key, last_error
  ) values (
    p_tenant_id, p_kind, v_title, v_body, v_channel, v_recipient,
    jsonb_build_object(
      'order', jsonb_build_array('sms', 'whatsapp', 'email'),
      'sms', v_phone,
      'whatsapp', v_phone,
      'email', v_email
    ),
    'staff', 'platform', v_status, p_idempotency_key, v_error
  )
  on conflict (tenant_id, idempotency_key) do nothing;

  select * into v_row
  from public.billing_notices
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  return v_row;
end;
$$;

comment on function public.enqueue_billing_notice(uuid, text, text, text, text) is
  'Queues one billing notice for the existing sender. Invoice mail prefers email. Does not send. Platform billed.';

-- finalize_invoice lives in billing_company.sql. This file does not replace it.

create or replace function public.enqueue_invoice_due_soon(p_invoice_id uuid)
returns public.billing_notices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
  v_body text;
begin
  select * into v_inv from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status <> 'open' then
    raise exception 'only an open invoice can be reminded';
  end if;
  v_body := 'Your Business Assistant invoice ' || coalesce(v_inv.invoice_number, '')
    || ' for KSh ' || trim(to_char(v_inv.total_kes, 'FM999999990.00')) || ' is due soon.';
  return public.enqueue_billing_notice(
    v_inv.tenant_id,
    'platform_billing_invoice_due_soon',
    'platform_billing_invoice_due_soon:' || v_inv.id::text,
    'Invoice due soon',
    v_body
  );
end;
$$;

revoke all on function public.enqueue_invoice_due_soon(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_invoice_due_soon(uuid) to service_role;

create or replace function public.enqueue_invoice_overdue(p_invoice_id uuid)
returns public.billing_notices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
  v_body text;
begin
  select * into v_inv from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status <> 'open' then
    raise exception 'only an open invoice can be reminded';
  end if;
  v_body := 'Your Business Assistant invoice ' || coalesce(v_inv.invoice_number, '')
    || ' for KSh ' || trim(to_char(v_inv.total_kes, 'FM999999990.00')) || ' is overdue.';
  return public.enqueue_billing_notice(
    v_inv.tenant_id,
    'platform_billing_invoice_overdue',
    'platform_billing_invoice_overdue:' || v_inv.id::text,
    'Invoice overdue',
    v_body
  );
end;
$$;

revoke all on function public.enqueue_invoice_overdue(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_invoice_overdue(uuid) to service_role;

create or replace function public.issue_invoice_receipt(p_payment_id uuid)
returns public.invoice_receipts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay public.payments%rowtype;
  v_existing public.invoice_receipts%rowtype;
  v_year integer;
  v_n integer;
  v_number text;
  v_method text;
  v_row public.invoice_receipts%rowtype;
  v_body text;
begin
  select * into v_pay from public.payments where id = p_payment_id;
  if not found then
    raise exception 'payment not found';
  end if;
  if v_pay.match_status not in ('matched', 'partial', 'over') or v_pay.invoice_id is null then
    raise exception 'payment is not a recorded invoice payment';
  end if;

  select * into v_existing from public.invoice_receipts where payment_id = p_payment_id;
  if found then
    if v_existing.amount_kes is distinct from v_pay.amount_kes then
      update public.invoice_receipts
      set amount_kes = v_pay.amount_kes
      where id = v_existing.id
      returning * into v_existing;
    end if;
    return v_existing;
  end if;

  v_year := extract(year from (coalesce(v_pay.paid_at, now()) at time zone 'Africa/Nairobi'))::integer;
  insert into public.billing_receipt_counters (year, last_number)
  values (v_year, 0)
  on conflict (year) do nothing;
  update public.billing_receipt_counters
  set last_number = last_number + 1
  where year = v_year
  returning last_number into v_n;
  v_number := 'RCT-' || v_year::text || '-' || lpad(v_n::text, 6, '0');
  v_method := case when v_pay.provider = 'bachs' then 'M-Pesa' else v_pay.provider end;

  insert into public.invoice_receipts (
    tenant_id, invoice_id, payment_id, receipt_number, amount_kes, method, provider_ref, paid_at
  ) values (
    v_pay.tenant_id, v_pay.invoice_id, v_pay.id, v_number, v_pay.amount_kes,
    v_method, coalesce(v_pay.bill_ref, v_pay.provider_ref), coalesce(v_pay.paid_at, now())
  )
  returning * into v_row;

  v_body := 'Your Business Assistant payment of KSh '
    || trim(to_char(v_row.amount_kes, 'FM999999990.00'))
    || ' is received. Receipt ' || v_row.receipt_number
    || '. Reference ' || coalesce(v_row.provider_ref, '') || '.';
  perform public.enqueue_billing_notice(
    v_row.tenant_id,
    'platform_billing_payment_received',
    'platform_billing_payment_received:' || v_row.id::text,
    'Payment received',
    v_body
  );
  return v_row;
end;
$$;

comment on function public.issue_invoice_receipt(uuid) is
  'Issues RCT-YYYY-000001 once per payment and queues the payment received notice. A later amount change updates that same receipt and does not mint a second number. The first notice stays (notices are append-only). Does not send.';

revoke all on function public.issue_invoice_receipt(uuid) from public, anon, authenticated;
grant execute on function public.issue_invoice_receipt(uuid) to service_role;

create or replace function public.payments_issue_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.match_status in ('matched', 'partial', 'over')
     and new.invoice_id is not null
     and new.amount_kes > 0
  then
    perform public.issue_invoice_receipt(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.payments_issue_receipt() from public, anon, authenticated;
grant execute on function public.payments_issue_receipt() to service_role;

drop trigger if exists payments_issue_receipt on public.payments;
create trigger payments_issue_receipt
  after insert on public.payments
  for each row execute function public.payments_issue_receipt();

drop trigger if exists payments_issue_receipt_update on public.payments;
create trigger payments_issue_receipt_update
  after update of amount_kes on public.payments
  for each row
  when (
    new.amount_kes is distinct from old.amount_kes
    and new.match_status in ('matched', 'partial', 'over')
    and new.invoice_id is not null
    and new.amount_kes > 0
  )
  execute function public.payments_issue_receipt();
