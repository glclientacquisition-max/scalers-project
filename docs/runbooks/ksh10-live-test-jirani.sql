-- KSh 10 live payment test for the one production business whose name matches Jirani.
-- A person runs this in the production SQL editor. This file is not a migration.
-- Do not run it from CI or from an agent. Do not apply P19. Do not re-run
-- P5, P9, P11, P12, P14, P15, P16, P17, or P18.
--
-- Three separate transactions. Run ENABLE, then ISSUE, then (after the M-Pesa
-- prompt) RESTORE. Stop on the first error. Each block is safe to run again.
--
-- Looks up business_name ilike '%jirani%' and stops if that is not exactly one row.
-- Refuses the Aris line +254709221536. Does not change package version, minutes,
-- or monthly price. Does not delete an invoice, a payment, or a credit.
--
-- admin_set_tenant_billing_mode is the only writer that turns enforcement on.
-- It refuses to run while package_editor_enabled is false, so a closed editor
-- is opened with admin_set_package_editor_enabled and closed again in the same
-- transaction. Both functions write billing_audit_log.
--
-- Before opening the pay URL, set BACHS_MODE=live and BACHS_LIVE_ALLOWED to
-- exactly true on scalers-project for this window only. Leave BILLING_NOTICES_SEND
-- unset. Roll those switches back after RESTORE. This file does not set env.
-- One M-Pesa collection. Do not send a second collection on that checkout.
-- VAT and KRA eTIMS stay off. tax_kes stays null.

-- ---------------------------------------------------------------------------
-- ENABLE. Off beta, enforcement on, live payments on.
-- ---------------------------------------------------------------------------
do $$
declare
  v_actor text := 'ksh10-live-test';
  v_reason text := 'KSh 10 live payment test on Jirani';
  v_n integer;
  v_id uuid;
  v_name text;
  v_did text;
  v_status text;
  v_enf text;
  v_target text;
  v_editor boolean;
  v_live integer;
begin
  select count(*) into v_n
  from public.tenants
  where business_name ilike '%jirani%';
  if v_n <> 1 then
    raise exception 'expected one business named Jirani, found %', v_n;
  end if;

  select id, business_name, sautikit_virtual_number
    into v_id, v_name, v_did
  from public.tenants
  where business_name ilike '%jirani%';

  if regexp_replace(coalesce(v_did, ''), '[^0-9]', '', 'g') = '254709221536' then
    raise exception 'refusing the Aris line';
  end if;

  select count(*) into v_live
  from public.calls
  where tenant_id = v_id
    and coalesce(lower(status), 'in_progress') not in ('complete', 'completed', 'failed', 'no_answer');
  if v_live <> 0 then
    raise exception 'Jirani has % live call(s). Stop.', v_live;
  end if;

  raise notice 'jirani % id % line %', v_name, v_id, v_did;
  raise notice 'counts invoices=% lines=% payments=% attempts=% events=% credits=% receipts=% live_tenants=% platform_live_calls=%',
    (select count(*) from public.invoices),
    (select count(*) from public.invoice_lines),
    (select count(*) from public.payments),
    (select count(*) from public.payment_attempts),
    (select count(*) from public.payment_events),
    (select count(*) from public.tenant_credits),
    (select count(*) from public.invoice_receipts),
    (select count(*) from public.billing_live_tenants),
    (select count(*) from public.calls
      where coalesce(lower(status), 'in_progress') not in ('complete', 'completed', 'failed', 'no_answer'));
  raise notice 'jirani invoices=% payments=% attempts=% credits=%',
    (select count(*) from public.invoices where tenant_id = v_id),
    (select count(*) from public.payments where tenant_id = v_id),
    (select count(*) from public.payment_attempts where tenant_id = v_id),
    (select count(*) from public.tenant_credits where tenant_id = v_id);

  select s.billing_status, t.billing_enforcement
    into v_status, v_enf
  from public.tenants t
  join public.tenant_subscriptions s on s.tenant_id = t.id
  where t.id = v_id;
  if v_status is null then
    raise exception 'business not found';
  end if;
  if v_status not in ('beta', 'active') then
    raise exception 'Jirani billing status is %. Stop.', v_status;
  end if;
  if v_status = 'active' and coalesce(v_enf, 'off') = 'off' then
    raise exception 'Jirani is active with enforcement off. Stop.';
  end if;

  v_target := case when v_enf = 'hard' then 'hard' else 'soft' end;

  select package_editor_enabled into v_editor
  from public.billing_lifecycle_settings
  where id = 1;
  if v_editor is null then
    raise exception 'billing settings are missing';
  end if;
  if v_editor is not true then
    perform public.admin_set_package_editor_enabled(true, v_actor, v_reason, true);
  end if;

  perform public.admin_set_tenant_billing_mode(
    v_id, 'active', v_target, v_actor, v_reason, true
  );

  if v_editor is not true then
    perform public.admin_set_package_editor_enabled(false, v_actor, v_reason, true);
  end if;

  -- reason, then actor.
  perform public.admin_set_tenant_live_payments(v_id, true, v_reason, v_actor);

  raise notice 'enabled % enforcement % live payments on', v_name, v_target;
end;
$$;

-- ---------------------------------------------------------------------------
-- ISSUE. One open KSh 10 invoice and one pay link. Does not change the plan.
-- The raw token is in the notice once. Save it before closing the editor.
-- ---------------------------------------------------------------------------
do $$
declare
  v_actor text := 'ksh10-live-test';
  v_reason text := 'KSh 10 live payment test on Jirani';
  v_n integer;
  v_id uuid;
  v_did text;
  v_status text;
  v_enf text;
  v_version uuid;
  v_minutes integer;
  v_price numeric;
  v_invoice uuid;
  v_inv_status text;
  v_number text;
  v_total numeric;
  v_matches integer;
  v_row public.invoices;
  v_token text;
begin
  select count(*) into v_n
  from public.tenants
  where business_name ilike '%jirani%';
  if v_n <> 1 then
    raise exception 'expected one business named Jirani, found %', v_n;
  end if;

  select id, sautikit_virtual_number into v_id, v_did
  from public.tenants
  where business_name ilike '%jirani%';

  if regexp_replace(coalesce(v_did, ''), '[^0-9]', '', 'g') = '254709221536' then
    raise exception 'refusing the Aris line';
  end if;

  select s.billing_status, t.billing_enforcement, s.package_version_id, t.minutes_included
    into v_status, v_enf, v_version, v_minutes
  from public.tenants t
  join public.tenant_subscriptions s on s.tenant_id = t.id
  where t.id = v_id;
  if coalesce(v_enf, 'off') = 'off' or coalesce(v_status, 'beta') = 'beta' then
    raise exception 'Jirani is still on beta. Run ENABLE first.';
  end if;

  select monthly_price_kes into v_price
  from public.billing_package_versions
  where id = v_version;

  select count(*) into v_matches
  from public.invoices i
  join public.invoice_lines l on l.invoice_id = i.id
  where i.tenant_id = v_id
    and l.description = 'KSh 10 live payment test'
    and i.billing_source is null
    and i.status in ('draft', 'open', 'paid');
  if v_matches > 1 then
    raise exception 'more than one KSh 10 test invoice. Stop.';
  end if;

  if v_matches = 1 then
    select i.id, i.status, i.invoice_number, i.total_kes
      into v_invoice, v_inv_status, v_number, v_total
    from public.invoices i
    join public.invoice_lines l on l.invoice_id = i.id
    where i.tenant_id = v_id
      and l.description = 'KSh 10 live payment test'
      and i.billing_source is null
      and i.status in ('draft', 'open', 'paid');
    if v_total is distinct from 10 then
      raise exception 'test invoice total is not KSh 10';
    end if;
    if v_inv_status = 'paid' then
      raise exception 'test invoice % is already paid. Stop.', v_number;
    end if;
    if exists (
      select 1 from public.invoice_pay_tokens
      where invoice_id = v_invoice and revoked_at is null
    ) then
      raise exception 'pay link already issued for %. The token was shown once. Stop.', v_number;
    end if;
  else
    -- billing_source stays null. 'next' would take the one draft slot. 'proration' is a plan change.
    insert into public.invoices (
      tenant_id, status, currency, subtotal_kes, total_kes, billing_source, tax_kes
    ) values (
      v_id, 'draft', 'KES', 10, 10, null, null
    ) returning id into v_invoice;

    insert into public.invoice_lines (
      invoice_id, tenant_id, description, quantity, unit_amount_kes, amount_kes, sort_order
    ) values (
      v_invoice, v_id, 'KSh 10 live payment test', 1, 10, 10, 1
    );
    v_inv_status := 'draft';
  end if;

  if v_inv_status = 'draft' then
    v_row := public.finalize_invoice(v_invoice);
  else
    select * into v_row from public.invoices where id = v_invoice;
  end if;
  if v_row.status <> 'open' or v_row.total_kes <> 10 or v_row.tax_kes is not null then
    raise exception 'test invoice did not open at KSh 10';
  end if;

  select minted.token into v_token
  from public.mint_invoice_pay_token(v_row.id, false) as minted;
  if v_token is null or v_token !~ '^pay_' then
    raise exception 'pay link was not issued';
  end if;

  if (select package_version_id from public.tenant_subscriptions where tenant_id = v_id) is distinct from v_version
     or (select minutes_included from public.tenants where id = v_id) is distinct from v_minutes
     or (select monthly_price_kes from public.billing_package_versions where id = v_version) is distinct from v_price
  then
    raise exception 'a test invoice must not change the plan';
  end if;

  perform public._billing_audit(
    v_actor,
    'ksh10_live_test_invoice',
    v_id,
    jsonb_build_object(
      'reason', v_reason,
      'invoice_id', v_row.id,
      'invoice_number', v_row.invoice_number,
      'total_kes', v_row.total_kes
    )
  );

  raise notice 'invoice %', v_row.invoice_number;
  raise notice 'pay url https://app.scalers.co.ke/pay/%', v_token;
  raise notice 'one M-Pesa collection of KSh 10. Do not send a second collection.';
end;
$$;

-- ---------------------------------------------------------------------------
-- RESTORE. Live payments off, then beta with enforcement off.
-- Leaves the KSh 10 invoice and any booked payment where they are.
-- ---------------------------------------------------------------------------
do $$
declare
  v_actor text := 'ksh10-live-test';
  v_reason text := 'Restore Jirani after the KSh 10 live payment test';
  v_n integer;
  v_id uuid;
  v_name text;
  v_did text;
  v_editor boolean;
begin
  select count(*) into v_n
  from public.tenants
  where business_name ilike '%jirani%';
  if v_n <> 1 then
    raise exception 'expected one business named Jirani, found %', v_n;
  end if;

  select id, business_name, sautikit_virtual_number
    into v_id, v_name, v_did
  from public.tenants
  where business_name ilike '%jirani%';

  if regexp_replace(coalesce(v_did, ''), '[^0-9]', '', 'g') = '254709221536' then
    raise exception 'refusing the Aris line';
  end if;

  perform public.admin_set_tenant_live_payments(v_id, false, v_reason, v_actor);

  select package_editor_enabled into v_editor
  from public.billing_lifecycle_settings
  where id = 1;
  if v_editor is null then
    raise exception 'billing settings are missing';
  end if;
  if v_editor is not true then
    perform public.admin_set_package_editor_enabled(true, v_actor, v_reason, true);
  end if;

  perform public.admin_set_tenant_billing_mode(
    v_id, 'beta', 'off', v_actor, v_reason, true
  );

  if v_editor is not true then
    perform public.admin_set_package_editor_enabled(false, v_actor, v_reason, true);
  end if;

  if (select billing_status from public.tenant_subscriptions where tenant_id = v_id) is distinct from 'beta'
     or (select billing_enforcement from public.tenants where id = v_id) is distinct from 'off'
     or coalesce((select enabled from public.billing_live_tenants where tenant_id = v_id), false) is true
  then
    raise exception 'Jirani did not return to beta with live payments off';
  end if;

  raise notice 'restored % to beta, enforcement off, live payments off', v_name;
  raise notice 'counts invoices=% payments=% attempts=% credits=% receipts=%',
    (select count(*) from public.invoices),
    (select count(*) from public.payments),
    (select count(*) from public.payment_attempts),
    (select count(*) from public.tenant_credits),
    (select count(*) from public.invoice_receipts);
end;
$$;
