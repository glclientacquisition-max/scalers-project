\set ON_ERROR_STOP 1

-- Locked prices live on version 2. Version 1 stays the seeded catalogue.
insert into public.billing_package_versions (
  package_id, version, status, monthly_price_kes, seats, minutes, sms, email, staff_wa, dids,
  inbound_kes_per_second, outbound_kes_per_second, whatsapp_kes, sms_kes, email_kes,
  annual_discount_percent, annual_price_kes, allowances_placeholder, active_from, published_at, extra_seat_monthly_kes
)
select p.id, 2, 'published', x.price, x.seats, x.minutes, p.sms, p.email, p.staff_wa, p.dids,
  r.inbound_kes_per_second, r.outbound_kes_per_second, r.whatsapp_kes, r.sms_kes, r.email_kes,
  x.discount, round(x.price * 12 * (1 - x.discount / 100)), false, now(), now(), 500
from public.billing_packages p
cross join public.billing_rate_card r
join (
  values
    ('starter'::text, 7000::numeric, 3, 400, 17::numeric),
    ('growth', 18000, 8, 900, 10),
    ('scale', 35000, 20, 2500, 10)
) as x(sku, price, seats, minutes, discount) on x.sku = p.sku
where r.id = 1
  and not exists (
    select 1 from public.billing_package_versions v
    where v.package_id = p.id and v.version = 2
  );

create or replace function public._test_owner_tenant(
  p_id uuid,
  p_phone text,
  p_sku text,
  p_version integer,
  p_period text,
  p_actor uuid,
  p_role text,
  p_people integer,
  p_enforce boolean,
  p_on_demand boolean
)
returns void
language plpgsql
as $$
declare
  v_pkg uuid;
  v_ver uuid;
  i integer;
begin
  select id into v_pkg from public.billing_packages where sku = p_sku;
  select id into v_ver
  from public.billing_package_versions
  where package_id = v_pkg and version = p_version;
  insert into public.tenants (id, business_name, sautikit_virtual_number, billing_enforcement, on_demand_usage_enabled)
  values (p_id, 'Owner billing ' || p_sku, p_phone, 'off', p_on_demand);
  insert into public.tenant_subscriptions (
    tenant_id, package_id, package_version_id, period, status,
    current_period_start, current_period_end, term_start, term_end
  ) values (
    p_id, v_pkg, v_ver, p_period, 'active',
    now() - interval '20 days',
    now() + interval '10 days',
    now() - interval '20 days',
    case when p_period = 'year' then now() + interval '300 days' else now() + interval '10 days' end
  );
  insert into public.tenant_members (tenant_id, user_id, role)
  values (p_id, p_actor, p_role);
  for i in 2..greatest(p_people, 1) loop
    insert into public.tenant_members (tenant_id, user_id, role)
    values (p_id, gen_random_uuid(), 'staff');
  end loop;
  if p_enforce then
    perform set_config('scalers.wallet_write', '1', true);
    update public.tenants set billing_enforcement = 'soft' where id = p_id;
    perform set_config('scalers.wallet_write', '', true);
    perform public.transition_subscription_billing_status(p_id, 'active', 'test', 'on');
  end if;
end;
$$;

do $$
declare
  v_owner uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_up uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  v_credit uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbc4';
  v_plain uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbc7';
  v_res jsonb;
  v_id uuid;
  v_status text;
  v_number text;
  v_total numeric;
  v_legal text;
  v_receipt text;
  v_receipt_2 text;
  v_amount numeric;
  v_def text;
begin
  v_def := pg_get_functiondef('public.finalize_invoice(uuid)'::regprocedure);
  if v_def not like '%set_config(''scalers.billing_write'', ''1'', true)%'
     or v_def not like '%SCL-%'
     or v_def not like '%invoice-credit:%'
     or v_def not like '%beta tenants have no pay link%' then
    raise exception 'canonical finalize_invoice is missing a required clause';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'finalize_invoice') <> 1 then
    raise exception 'more than one finalize_invoice';
  end if;

  perform public._test_owner_tenant(v_up, '+254700010002', 'starter', 2, 'month', v_owner, 'owner', 1, true, false);
  v_res := public.owner_change_plan(v_up, v_owner, 'growth', 'month', 'proof-up');
  if v_res->>'code' <> 'upgraded' then
    raise exception 'owner_change_plan returned %', v_res;
  end if;
  select id, status, invoice_number, total_kes, issuer_legal_name
    into v_id, v_status, v_number, v_total, v_legal
  from public.invoices where tenant_id = v_up;
  if v_status <> 'open' or v_number not like 'SCL-%' or v_legal <> 'Scalers Ventures' or v_total <= 0 then
    raise exception 'plan invoice was % % % %', v_status, v_number, v_legal, v_total;
  end if;
  perform public.apply_payment('bachs', 'chk_proof_plan', v_total, v_up, v_id);
  select receipt_number, amount_kes into v_receipt, v_amount
  from public.invoice_receipts where invoice_id = v_id;
  if v_receipt not like 'RCT-%' or v_amount <> v_total
     or (select count(*) from public.invoice_receipts where invoice_id = v_id) <> 1 then
    raise exception 'plan receipt was % %', v_receipt, v_amount;
  end if;

  perform public._test_owner_tenant(v_credit, '+254700010013', 'starter', 2, 'month', v_owner, 'owner', 1, true, false);
  update public.tenant_subscriptions set extra_seats = 1 where tenant_id = v_credit;
  v_res := public.owner_set_extra_seats(v_credit, v_owner, 0, 'proof-credit');
  if v_res->>'code' <> 'seats_updated' or (v_res->>'amount_kes')::numeric >= 0 then
    raise exception 'seat removal returned %', v_res;
  end if;
  v_id := (v_res->>'invoice_id')::uuid;
  select total_kes into v_total from public.invoices where id = v_id;
  if v_total >= 0 then
    raise exception 'seat draft was not negative %', v_total;
  end if;
  perform public.finalize_invoice(v_id);
  if (select count(*) from public.tenant_credits where idempotency_key = 'invoice-credit:' || v_id::text) <> 1
     or (select amount_kes from public.tenant_credits where idempotency_key = 'invoice-credit:' || v_id::text) <> -v_total
     or (select status from public.invoices where id = v_id) <> 'paid'
     or (select total_kes from public.invoices where id = v_id) <> 0
     or (select invoice_number from public.invoices where id = v_id) not like 'SCL-%'
     or (select count(*) from public.invoice_receipts where invoice_id = v_id) <> 0 then
    raise exception 'negative draft did not become one credit and a paid zero invoice';
  end if;

  perform public._test_owner_tenant(v_plain, '+254700010017', 'starter', 2, 'month', v_owner, 'owner', 1, true, false);
  insert into public.invoices (tenant_id, subtotal_kes, total_kes)
  values (v_plain, 2320, 2320)
  returning id into v_id;
  perform public.finalize_invoice(v_id);
  select status, invoice_number into v_status, v_number from public.invoices where id = v_id;
  if v_status <> 'open' or v_number not like 'SCL-%' then
    raise exception 'plain finalize was % %', v_status, v_number;
  end if;
  perform public.apply_payment('bachs', 'chk_proof_plain', 2000, v_plain, v_id);
  select receipt_number into v_receipt from public.invoice_receipts r
  join public.payments p on p.id = r.payment_id
  where p.provider_ref = 'chk_proof_plain';
  perform public.adjust_payment_overpay('bachs', 'chk_proof_plain', 2500, v_plain);
  select r.receipt_number, r.amount_kes into v_receipt_2, v_amount
  from public.invoice_receipts r
  join public.payments p on p.id = r.payment_id
  where p.provider_ref = 'chk_proof_plain';
  if v_receipt_2 is distinct from v_receipt or v_amount <> 2500
     or (select count(*) from public.invoice_receipts r
         join public.payments p on p.id = r.payment_id
         where p.provider_ref = 'chk_proof_plain') <> 1 then
    raise exception 'overpay receipt was % %', v_receipt_2, v_amount;
  end if;
end;
$$;

select i.invoice_number, i.status, i.total_kes, i.issuer_legal_name, r.receipt_number, r.amount_kes as receipt_kes
from public.invoices i
left join public.invoice_receipts r on r.invoice_id = i.id
order by i.invoice_number nulls last, r.receipt_number;

select c.idempotency_key, c.amount_kes, c.reason
from public.tenant_credits c
order by c.idempotency_key;
