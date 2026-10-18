\set ON_ERROR_STOP 1

-- Locked prices live on version 2. Version 1 stays the seeded catalogue.
insert into public.billing_package_versions (
  package_id, version, status, monthly_price_kes, seats, minutes, sms, email, staff_wa, dids,
  inbound_kes_per_second, outbound_kes_per_second, whatsapp_kes, sms_kes, email_kes,
  annual_discount_percent, allowances_placeholder, active_from, published_at, extra_seat_monthly_kes
)
select p.id, 2, 'published', x.price, x.seats, x.minutes, p.sms, p.email, p.staff_wa, p.dids,
  r.inbound_kes_per_second, r.outbound_kes_per_second, r.whatsapp_kes, r.sms_kes, r.email_kes,
  x.discount, false, now(), now(), 500
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
  v_staff uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_beta uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  v_up uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  v_block uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3';
  v_down uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4';
  v_year uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5';
  v_to_year uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6';
  v_seats uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb7';
  v_spend uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb8';
  v_beta_spend uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb9';
  v_res jsonb;
  v_quote jsonb;
  v_old uuid;
  v_new uuid;
  v_n integer;
  v_total numeric;
  v_status text;
  v_number text;
  v_allowed boolean;
  v_reason text;
  v_audits integer;
  v_starter2 uuid;
  v_growth2 uuid;
  v_scale2 uuid;
begin
  if (select v.monthly_price_kes from public.billing_package_versions v
      join public.billing_packages p on p.id = v.package_id
      where p.sku = 'starter' and v.version = 1) <> 5000 then
    raise exception 'starter v1 price moved';
  end if;
  if (select v.extra_seat_monthly_kes from public.billing_package_versions v
      join public.billing_packages p on p.id = v.package_id
      where p.sku = 'starter' and v.version = 1) <> 500 then
    raise exception 'starter v1 seat price is not 500';
  end if;

  begin
    update public.billing_package_versions v
    set extra_seat_monthly_kes = 1500
    from public.billing_packages p
    where p.id = v.package_id and p.sku = 'starter' and v.version = 1;
    raise exception 'published seat price was editable';
  exception when others then
    if sqlerrm not like '%frozen%' then
      raise;
    end if;
  end;

  select v.id into v_starter2
  from public.billing_package_versions v
  join public.billing_packages p on p.id = v.package_id
  where p.sku = 'starter' and v.version = 2;
  select v.id into v_growth2
  from public.billing_package_versions v
  join public.billing_packages p on p.id = v.package_id
  where p.sku = 'growth' and v.version = 2;
  select v.id into v_scale2
  from public.billing_package_versions v
  join public.billing_packages p on p.id = v.package_id
  where p.sku = 'scale' and v.version = 2;

  if public.billing_version_price_kes(v_starter2, 'year') <> 69720
     or public.billing_version_price_kes(v_growth2, 'year') <> 194400
     or public.billing_version_price_kes(v_scale2, 'year') <> 378000
     or public.billing_version_price_kes(v_starter2, 'month') <> 7000 then
    raise exception 'annual prices do not match the locked versions';
  end if;

  v_quote := public.billing_proration_quote(
    7000, 18000,
    '2026-10-01 00:00:00+03',
    '2026-10-31 00:00:00+03',
    '2026-10-21 12:00:00+03'
  );
  if (v_quote->>'days_in_period')::int <> 30
     or (v_quote->>'days_left')::int <> 10
     or (v_quote->>'credit_kes')::numeric <> 2333
     or (v_quote->>'charge_kes')::numeric <> 6000
     or (v_quote->>'total_kes')::numeric <> 3667 then
    raise exception 'fixed-date proration was %', v_quote;
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'owner_change_plan' and p.prosecdef
      and 'search_path=public' = any (p.proconfig)
  ) then
    raise exception 'owner_change_plan is missing security definer or search_path';
  end if;
  if has_function_privilege('anon', 'public.owner_change_plan(uuid,uuid,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.owner_change_plan(uuid,uuid,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.owner_change_plan(uuid,uuid,text,text,text)', 'execute') then
    raise exception 'owner_change_plan grants are wrong';
  end if;
  if has_function_privilege('anon', 'public.owner_set_extra_seats(uuid,uuid,integer,text)', 'execute')
     or has_function_privilege('authenticated', 'public.billing_spend_allows_charge(uuid,numeric)', 'execute') then
    raise exception 'anon or authenticated can execute a billing action';
  end if;

  perform public._test_owner_tenant(v_beta, '+254700010001', 'starter', 2, 'month', v_owner, 'owner', 1, false, false);
  v_res := public.owner_change_plan(v_beta, v_owner, 'growth', 'month', 'beta-1');
  if (v_res->>'ok')::boolean is not true or v_res->>'code' <> 'beta' then
    raise exception 'beta plan change returned %', v_res;
  end if;
  if (select count(*) from public.invoices where tenant_id = v_beta) <> 0 then
    raise exception 'beta created an invoice';
  end if;
  if (select package_id from public.tenant_subscriptions where tenant_id = v_beta)
     <> (select id from public.billing_packages where sku = 'starter') then
    raise exception 'beta package changed';
  end if;
  if (select count(*) from public.billing_audit_log
      where tenant_id = v_beta and action = 'owner_change_plan' and detail->>'code' = 'beta') <> 1 then
    raise exception 'beta action was not audited';
  end if;

  perform public._test_owner_tenant(v_up, '+254700010002', 'starter', 1, 'month', v_owner, 'owner', 1, true, true);
  select package_version_id into v_old from public.tenant_subscriptions where tenant_id = v_up;
  v_res := public.owner_change_plan(v_up, v_owner, 'growth', 'month', 'up-1');
  if v_res->>'code' <> 'upgraded' then
    raise exception 'upgrade returned %', v_res;
  end if;
  select id into v_new from public.billing_package_versions
  where package_id = (select id from public.billing_packages where sku = 'growth') and version = 2;
  if (v_res->>'credit_kes')::numeric <> public.billing_prorate_kes(
       public.billing_version_price_kes(v_old, 'month'),
       (v_res->>'days_left')::int, (v_res->>'days_in_period')::int)
     or (v_res->>'charge_kes')::numeric <> public.billing_prorate_kes(
       public.billing_version_price_kes(v_new, 'month'),
       (v_res->>'days_left')::int, (v_res->>'days_in_period')::int) then
    raise exception 'upgrade quote drifted %', v_res;
  end if;
  select status, invoice_number, total_kes into v_status, v_number, v_total
  from public.invoices where id = (v_res->>'invoice_id')::uuid;
  if v_status <> 'open' or v_number not like 'SC-%' or v_total <> (v_res->>'total_kes')::numeric then
    raise exception 'proration invoice was not opened';
  end if;
  if (select count(*) from public.invoice_lines where invoice_id = (v_res->>'invoice_id')::uuid and amount_kes < 0) <> 1
     or (select count(*) from public.invoice_lines where invoice_id = (v_res->>'invoice_id')::uuid and amount_kes > 0) <> 1 then
    raise exception 'proration invoice is missing a credit or a charge line';
  end if;
  select count(*) into v_audits from public.billing_audit_log
  where tenant_id = v_up and action = 'owner_change_plan';
  v_res := public.owner_change_plan(v_up, v_owner, 'growth', 'month', 'up-1');
  if (v_res->>'replayed')::boolean is not true or (select count(*) from public.invoices where tenant_id = v_up) <> 1 then
    raise exception 'upgrade replay wrote again';
  end if;
  if (select count(*) from public.billing_audit_log where tenant_id = v_up and action = 'owner_change_plan') <> v_audits then
    raise exception 'upgrade replay wrote another audit row';
  end if;

  insert into public.tenant_members (tenant_id, user_id, role) values (v_up, v_staff, 'staff');
  v_res := public.owner_change_plan(v_up, v_staff, 'scale', 'month', 'up-1');
  if v_res->>'code' <> 'forbidden' then
    raise exception 'staff replay returned %', v_res;
  end if;
  if (select count(*) from public.billing_audit_log
      where tenant_id = v_up and action = 'owner_change_plan' and detail->>'code' = 'forbidden') < 1 then
    raise exception 'forbidden was not audited';
  end if;

  perform public._test_owner_tenant(v_block, '+254700010003', 'growth', 2, 'month', v_owner, 'owner', 4, true, false);
  v_res := public.owner_preview_plan_change(v_block, v_owner, 'starter', 'month');
  if v_res->>'code' <> 'seats_exceed_plan' or (v_res->>'seats_used')::int <> 4 or (v_res->>'seats_included')::int <> 3 then
    raise exception 'preview seat block returned %', v_res;
  end if;
  if v_res->>'message' not like '%members and pending invites%' then
    raise exception 'seat block message was %', v_res->>'message';
  end if;
  v_res := public.owner_change_plan(v_block, v_owner, 'starter', 'month', 'block-1');
  if v_res->>'code' <> 'seats_exceed_plan'
     or (select pending_change from public.tenant_subscriptions where tenant_id = v_block) is not null then
    raise exception 'downgrade seat block wrote a pending change %', v_res;
  end if;

  insert into public.tenant_invites (tenant_id, status, expires_at)
  values (v_block, 'pending', now() + interval '2 days');
  insert into public.tenant_invites (tenant_id, status, expires_at)
  values (v_block, 'pending', now() - interval '1 day');
  if public.billing_seats_used(v_block) <> 5 then
    raise exception 'seats used ignored a pending invite or counted an expired one: %', public.billing_seats_used(v_block);
  end if;

  perform public._test_owner_tenant(v_down, '+254700010004', 'growth', 2, 'month', v_owner, 'owner', 1, true, false);
  v_res := public.owner_preview_plan_change(v_down, v_owner, 'starter', 'month');
  if v_res->>'code' <> 'scheduled' or (v_res->>'total_kes')::numeric <> 0 then
    raise exception 'downgrade preview returned %', v_res;
  end if;
  v_res := public.owner_change_plan(v_down, v_owner, 'starter', 'month', 'down-1');
  if v_res->>'code' <> 'scheduled' or v_res->>'pending_change' <> 'downgrade' then
    raise exception 'downgrade returned %', v_res;
  end if;
  if (select count(*) from public.invoices where tenant_id = v_down) <> 0 then
    raise exception 'downgrade created an invoice';
  end if;
  if (select package_id from public.tenant_subscriptions where tenant_id = v_down)
     <> (select id from public.billing_packages where sku = 'growth') then
    raise exception 'downgrade changed the package now';
  end if;
  v_res := public.owner_cancel_plan_change(v_down, v_owner, 'down-cancel');
  if v_res->>'code' <> 'change_cancelled'
     or (select pending_change from public.tenant_subscriptions where tenant_id = v_down) is not null then
    raise exception 'cancel returned %', v_res;
  end if;

  perform public._test_owner_tenant(v_year, '+254700010005', 'starter', 2, 'year', v_owner, 'owner', 1, true, false);
  v_res := public.owner_change_plan(v_year, v_owner, 'starter', 'month', 'year-month');
  if v_res->>'code' <> 'scheduled' or v_res->>'pending_change' <> 'period_change' then
    raise exception 'annual to monthly returned %', v_res;
  end if;
  if (select pending_effective_at from public.tenant_subscriptions where tenant_id = v_year)
     <> (select term_end from public.tenant_subscriptions where tenant_id = v_year) then
    raise exception 'annual to monthly does not wait for the term end';
  end if;
  if (select pending_effective_at from public.tenant_subscriptions where tenant_id = v_year)
     <= (select current_period_end from public.tenant_subscriptions where tenant_id = v_year) then
    raise exception 'annual to monthly would apply on the next usage month';
  end if;
  if (select count(*) from public.invoices where tenant_id = v_year) <> 0 then
    raise exception 'annual to monthly created an invoice';
  end if;

  perform public._test_owner_tenant(v_to_year, '+254700010006', 'starter', 2, 'month', v_owner, 'owner', 1, true, false);
  v_res := public.owner_change_plan(v_to_year, v_owner, 'starter', 'year', 'month-year');
  if v_res->>'code' <> 'upgraded'
     or (v_res->>'charge_kes')::numeric <> 69720
     or (select period from public.tenant_subscriptions where tenant_id = v_to_year) <> 'year' then
    raise exception 'monthly to annual returned %', v_res;
  end if;
  if (v_res->>'credit_kes')::numeric <> public.billing_prorate_kes(
       7000, (v_res->>'days_left')::int, (v_res->>'days_in_period')::int) then
    raise exception 'monthly to annual credit was %', v_res;
  end if;

  perform public._test_owner_tenant(v_seats, '+254700010007', 'starter', 2, 'month', v_owner, 'owner', 1, true, false);
  v_res := public.owner_set_extra_seats(v_seats, v_owner, 2, 'seats-2');
  if v_res->>'code' <> 'seats_updated' or (v_res->>'unit_kes')::numeric <> 500 then
    raise exception 'extra seats returned %', v_res;
  end if;
  if (v_res->>'amount_kes')::numeric <> public.billing_prorate_kes(
       1000, (v_res->>'days_left')::int, (v_res->>'days_in_period')::int) then
    raise exception 'seat proration was %', v_res;
  end if;
  select status, invoice_number, total_kes into v_status, v_number, v_total
  from public.invoices where id = (v_res->>'invoice_id')::uuid;
  if v_status <> 'draft' or v_number is not null or v_total < 0 then
    raise exception 'seat invoice was collected or negative';
  end if;
  if (select billing_source from public.invoices where id = (v_res->>'invoice_id')::uuid) <> 'next' then
    raise exception 'seat invoice is not the next draft';
  end if;
  if (select seat_included from public.tenants where id = v_seats) <> 5 then
    raise exception 'allowance seats were not updated';
  end if;

  for v_n in 1..3 loop
    insert into public.tenant_members (tenant_id, user_id, role)
    values (v_seats, gen_random_uuid(), 'staff');
  end loop;
  v_res := public.owner_set_extra_seats(v_seats, v_owner, 0, 'seats-0');
  if v_res->>'code' <> 'seats_in_use' or (select extra_seats from public.tenant_subscriptions where tenant_id = v_seats) <> 2 then
    raise exception 'removing seats in use returned %', v_res;
  end if;

  perform public._test_owner_tenant(v_spend, '+254700010008', 'starter', 2, 'month', v_owner, 'owner', 1, true, true);
  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants set minutes_included = 100, seconds_used = 30 where id = v_spend;
  perform set_config('scalers.wallet_write', '', true);
  if public.billing_spend_limit_kes(v_spend) <> 3500 then
    raise exception 'null spend limit was not half of 7000';
  end if;
  insert into public.wallet_ledger (tenant_id, kind, amount_kes, metadata)
  values (v_spend, 'call_charge', -3400, '{"on_demand":"true"}'::jsonb);
  if public.billing_spend_allows_charge(v_spend, 200) then
    raise exception 'spend limit allowed a charge past the cap';
  end if;
  if (select spend_limit_blocked from public.tenants where id = v_spend) is not true then
    raise exception 'spend limit did not stop on-demand';
  end if;
  if public.billing_on_demand_open(v_spend) then
    raise exception 'on-demand stayed open after the hold';
  end if;
  select count(*) into v_audits from public.billing_audit_log
  where tenant_id = v_spend and action = 'spend_limit_held';
  if v_audits <> 1 then
    raise exception 'spend hold audit count %', v_audits;
  end if;
  if public.billing_spend_allows_charge(v_spend, 1) then
    raise exception 'a second charge was allowed after the hold';
  end if;
  if (select count(*) from public.billing_audit_log where tenant_id = v_spend and action = 'spend_limit_held') <> 1 then
    raise exception 'spend hold was audited twice';
  end if;

  select a.allowed, a.reason into v_allowed, v_reason from public.tenant_escalation_allowed(v_spend) a;
  if v_allowed is not true or v_reason <> 'ok' then
    raise exception 'included minutes were blocked by the spend limit';
  end if;
  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants set seconds_used = 100 * 60 where id = v_spend;
  perform set_config('scalers.wallet_write', '', true);
  select a.allowed, a.reason into v_allowed, v_reason from public.tenant_escalation_allowed(v_spend) a;
  if v_allowed is not false or v_reason <> 'minutes_cap' then
    raise exception 'past the allowance with a spend hold returned % %', v_allowed, v_reason;
  end if;

  update public.tenant_subscriptions
  set current_period_start = current_period_start + interval '32 days'
  where tenant_id = v_spend;
  if (select spend_limit_blocked from public.tenants where id = v_spend)
     or (select spend_limit_held_period from public.tenant_subscriptions where tenant_id = v_spend) is not null then
    raise exception 'period roll did not clear the spend hold';
  end if;

  v_res := public.owner_set_spend_limit(v_spend, v_owner, 800, 'limit-800');
  if v_res->>'code' <> 'spend_limit_updated' or (v_res->>'effective_limit_kes')::numeric <> 800 then
    raise exception 'spend limit set returned %', v_res;
  end if;
  v_res := public.owner_set_spend_limit(v_spend, v_owner, 100, 'limit-100');
  if v_res->>'code' <> 'invalid_spend_limit' then
    raise exception 'small spend limit returned %', v_res;
  end if;
  v_res := public.owner_set_spend_limit(v_spend, v_owner, null, 'limit-null');
  if (v_res->>'effective_limit_kes')::numeric <> 3500
     or (select soft_spend_limit_kes from public.tenants where id = v_spend) is not null then
    raise exception 'clearing the spend limit returned %', v_res;
  end if;

  -- The package version editor adds this column. Absent above, so 50 applied.
  -- Null falls back to 50. A set share is a percent of the pinned monthly price.
  -- A stored tenant limit still wins.
  alter table public.billing_package_versions
    add column spend_limit_share_percent numeric;
  if public.billing_spend_limit_kes(v_spend) <> 3500 then
    raise exception 'a null share was not 50 percent of 7000';
  end if;
  update public.billing_package_versions
  set spend_limit_share_percent = 40
  where id = (select package_version_id from public.tenant_subscriptions where tenant_id = v_spend);
  if public.billing_spend_limit_kes(v_spend) <> 2800 then
    raise exception 'share 40 of 7000 was %', public.billing_spend_limit_kes(v_spend);
  end if;
  v_res := public.owner_set_spend_limit(v_spend, v_owner, 800, 'limit-share-800');
  if (v_res->>'effective_limit_kes')::numeric <> 800 then
    raise exception 'stored limit lost to the version share %', v_res;
  end if;
  v_res := public.owner_set_spend_limit(v_spend, v_owner, null, 'limit-share-clear');
  if (v_res->>'effective_limit_kes')::numeric <> 2800 then
    raise exception 'clearing the stored limit ignored share 40 %', v_res;
  end if;
  update public.billing_package_versions
  set spend_limit_share_percent = null
  where id = (select package_version_id from public.tenant_subscriptions where tenant_id = v_spend);
  if public.billing_spend_limit_kes(v_spend) <> 3500 then
    raise exception 'clearing the share did not fall back to 50';
  end if;

  perform public._test_owner_tenant(v_beta_spend, '+254700010009', 'starter', 2, 'month', v_owner, 'owner', 1, false, true);
  if public.billing_spend_allows_charge(v_beta_spend, 99999) is not true
     or public.billing_spend_limit_kes(v_beta_spend) is not null
     or (select spend_limit_blocked from public.tenants where id = v_beta_spend) then
    raise exception 'beta spend limit enforced';
  end if;
  v_res := public.owner_set_spend_limit(v_beta_spend, v_owner, 800, 'beta-limit');
  if v_res->>'code' <> 'beta' or (select soft_spend_limit_kes from public.tenants where id = v_beta_spend) is not null then
    raise exception 'beta spend limit write returned %', v_res;
  end if;
  v_res := public.owner_set_extra_seats(v_beta_spend, v_owner, 4, 'beta-seats');
  if v_res->>'code' <> 'beta' or (select extra_seats from public.tenant_subscriptions where tenant_id = v_beta_spend) <> 0 then
    raise exception 'beta seats returned %', v_res;
  end if;

  if position('billing_spend_allows_charge' in (select prosrc from pg_proc where proname = 'consume_call_seconds')) = 0
     or position('billing_spend_allows_charge' in (select prosrc from pg_proc where proname = 'consume_sms_units')) = 0
     or position('billing_spend_allows_charge' in (select prosrc from pg_proc where proname = 'reserve_notify_send')) = 0
     or position('billing_on_demand_open' in (select prosrc from pg_proc where proname = 'tenant_escalation_allowed')) = 0 then
    raise exception 'usage functions lost the spend hook';
  end if;
end $$;

set role anon;
do $$
begin
  begin
    perform public.owner_change_plan(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
      'growth', 'month', 'anon'
    );
    raise exception 'anon executed owner_change_plan';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;
