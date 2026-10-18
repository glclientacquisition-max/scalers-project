-- billing_company.sql
-- Purpose: one editable letterhead for invoices and receipts. finalize_invoice
--          copies it onto the invoice at issue time. Later edits do not
--          change invoices that are already issued.
-- Run after: invoice_documents.sql
-- Idempotent. Safe to re-run. The seed does not overwrite a later edit.
--
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

  v_year := extract(year from (now() at time zone 'Africa/Nairobi'))::integer;
  insert into public.billing_invoice_counters (year, last_number)
  values (v_year, 0)
  on conflict (year) do nothing;
  update public.billing_invoice_counters
  set last_number = last_number + 1
  where year = v_year
  returning last_number into v_n;
  v_number := 'SCL-' || v_year::text || '-' || lpad(v_n::text, 6, '0');

  update public.invoices
  set status = 'open',
      invoice_number = v_number,
      issued_at = coalesce(issued_at, now()),
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

  if not found then
    raise exception 'invoice not found';
  end if;

  v_body := 'Your Business Assistant invoice ' || v_number
    || ' for KSh ' || trim(to_char(v_inv.total_kes, 'FM999999990.00')) || ' is ready.';
  perform public.enqueue_billing_notice(
    v_inv.tenant_id,
    'platform_billing_invoice_issued',
    'platform_billing_invoice_issued:' || v_inv.id::text,
    'Invoice ' || v_number,
    v_body
  );
  return v_inv;
end;
$$;

comment on function public.finalize_invoice(uuid) is
  'Assigns SCL-YYYY-000001 for the Africa/Nairobi year and copies billing_company onto the invoice. Drafts stay unnumbered. Queues the issued notice once. Does not charge and does not send.';

revoke all on function public.finalize_invoice(uuid) from public, anon, authenticated;
grant execute on function public.finalize_invoice(uuid) to service_role;

alter table public.billing_company enable row level security;
revoke all on table public.billing_company from public, anon, authenticated;
grant select, update on table public.billing_company to service_role;
