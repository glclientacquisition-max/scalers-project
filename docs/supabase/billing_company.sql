-- billing_company.sql
-- Purpose: one editable letterhead for invoices and receipts. This file is
--          P8, the last billing file. It owns finalize_invoice. The function
--          copies the letterhead onto the invoice at issue time, numbers
--          SCL-YYYY-NNNNNN, sets scalers.billing_write around that write,
--          refuses a beta tenant, and turns a negative draft into one
--          tenant_credits row plus a paid zero invoice. Later letterhead
--          edits do not change invoices that are already issued.
-- Run after: invoice_documents.sql, and after owner_billing_actions.sql when
--            that file is applied. Re-apply this file last if another file
--            replaces finalize_invoice.
-- Idempotent. Safe to re-run. The seed does not overwrite a later edit.
-- DO NOT RUN on production fjxcdccgyhnvnnlnovcl until a backup and Alvin's GO.
-- Staging project is sgcdncjxauhsbunobmob.
--
-- Address, city, and KRA PIN stay null until the owner sets them. Blank
-- values are stored as null and omitted from the document.
--
-- Change the letterhead in the SQL editor. The next issued invoice picks it up.
--
--   update public.billing_company
--   set address = '...', city = '...', kra_pin = '...', updated_at = now()
--   where id = 1;
--
-- legal_name, product, phone, and email use the same update.

create table if not exists public.billing_company (
  id smallint primary key default 1 check (id = 1),
  legal_name text not null check (length(btrim(legal_name)) > 0),
  product text not null default 'Business Assistant' check (length(btrim(product)) > 0),
  phone text,
  email text,
  address text,
  city text,
  kra_pin text,
  updated_at timestamptz not null default now()
);

comment on table public.billing_company is
  'Singleton letterhead (id = 1). Edited in the SQL editor. Copied onto each invoice when it is issued.';

insert into public.billing_company (id, legal_name, product, phone, email)
values (1, 'Scalers Ventures', 'Business Assistant', '+254119774470', 'support@scalers.co.ke')
on conflict (id) do nothing;

alter table public.invoices
  add column if not exists issuer_legal_name text,
  add column if not exists issuer_product text,
  add column if not exists issuer_phone text,
  add column if not exists issuer_email text,
  add column if not exists issuer_address text,
  add column if not exists issuer_city text,
  add column if not exists issuer_kra_pin text;

comment on column public.invoices.issuer_legal_name is
  'Letterhead copied from billing_company when the invoice is issued. Null on a draft.';

-- A seat removal is a negative draft total. The data-layer checks would hide
-- that credit. Issue turns it into tenant_credits and a paid zero invoice.
do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.invoices'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ~ 'subtotal_kes >=|total_kes >='
  loop
    execute format('alter table public.invoices drop constraint %I', r.conname);
  end loop;
end $$;

create or replace function public.finalize_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
  v_co public.billing_company%rowtype;
  v_year integer;
  v_n integer;
  v_number text;
  v_body text;
  v_credit boolean;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status <> 'draft' then
    raise exception 'only a draft invoice can be finalized';
  end if;
  if exists (
    select 1 from public.tenant_subscriptions s
    where s.tenant_id = v_inv.tenant_id
      and s.billing_status = 'beta'
  ) then
    raise exception 'beta tenants have no pay link';
  end if;

  select * into v_co from public.billing_company where id = 1;
  if not found then
    raise exception 'billing company is not set';
  end if;
  if nullif(btrim(v_co.legal_name), '') is null then
    raise exception 'billing company is not set';
  end if;

  v_credit := coalesce(v_inv.total_kes, 0) < 0;
  if v_credit then
    insert into public.tenant_credits (tenant_id, amount_kes, reason, idempotency_key)
    values (
      v_inv.tenant_id,
      -v_inv.total_kes,
      'invoice_credit',
      'invoice-credit:' || v_inv.id::text
    )
    on conflict (idempotency_key) do nothing;
  end if;

  v_year := extract(year from (now() at time zone 'Africa/Nairobi'))::integer;
  insert into public.billing_invoice_counters (year, last_number)
  values (v_year, 0)
  on conflict (year) do nothing;
  update public.billing_invoice_counters
  set last_number = last_number + 1
  where year = v_year
  returning last_number into v_n;
  v_number := 'SCL-' || v_year::text || '-' || lpad(v_n::text, 6, '0');

  perform set_config('scalers.billing_write', '1', true);
  update public.invoices
  set status = case when v_credit then 'paid' else 'open' end,
      invoice_number = v_number,
      issued_at = coalesce(issued_at, now()),
      subtotal_kes = case when v_credit then 0 else subtotal_kes end,
      total_kes = case when v_credit then 0 else total_kes end,
      paid_at = case when v_credit then coalesce(paid_at, now()) else paid_at end,
      issuer_legal_name = nullif(btrim(v_co.legal_name), ''),
      issuer_product = coalesce(nullif(btrim(v_co.product), ''), 'Business Assistant'),
      issuer_phone = nullif(btrim(v_co.phone), ''),
      issuer_email = nullif(btrim(v_co.email), ''),
      issuer_address = nullif(btrim(v_co.address), ''),
      issuer_city = nullif(btrim(v_co.city), ''),
      issuer_kra_pin = nullif(btrim(v_co.kra_pin), ''),
      updated_at = now()
  where id = p_invoice_id
  returning * into v_inv;
  perform set_config('scalers.billing_write', '', true);

  if not found then
    raise exception 'invoice not found';
  end if;

  if not v_credit then
    v_body := 'Your Business Assistant invoice ' || v_number
      || ' for KSh ' || trim(to_char(v_inv.total_kes, 'FM999999990.00')) || ' is ready.';
    perform public.enqueue_billing_notice(
      v_inv.tenant_id,
      'platform_billing_invoice_issued',
      'platform_billing_invoice_issued:' || v_inv.id::text,
      'Invoice ' || v_number,
      v_body
    );
  end if;
  return v_inv;
end;
$$;

comment on function public.finalize_invoice(uuid) is
  'Canonical issue function. Assigns SCL-YYYY-NNNNNN, copies billing_company, and sets scalers.billing_write around the number and status write. Refuses a beta tenant. A negative draft becomes one tenant_credits row (invoice-credit:<id>) and a paid zero invoice, with no notice. A positive draft queues the issued notice once. Does not charge and does not send.';

revoke all on function public.finalize_invoice(uuid) from public, anon, authenticated;
grant execute on function public.finalize_invoice(uuid) to service_role;

alter table public.billing_company enable row level security;
revoke all on table public.billing_company from public, anon, authenticated;
grant select, update on table public.billing_company to service_role;
