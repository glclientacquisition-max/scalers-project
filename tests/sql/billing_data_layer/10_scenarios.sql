\set ON_ERROR_STOP 1

-- Versions mirror the live catalogue. Trial is the owner decision plus marked placeholders.
do $$
declare
  ver public.billing_package_versions%rowtype;
  n int;
begin
  select ver_row.* into ver
  from public.billing_package_versions ver_row
  join public.billing_packages p on p.id = ver_row.package_id
  where p.sku = 'starter' and ver_row.version = 1;
  if ver.monthly_price_kes <> 5000 or ver.minutes <> 300 or ver.sms <> 200 or ver.email <> 100
     or ver.seats <> 2 or ver.dids <> 1 or ver.staff_wa <> 200
     or ver.inbound_kes_per_second <> 0.10 or ver.outbound_kes_per_second <> 0.15
     or ver.status <> 'published' or ver.allowances_placeholder
     or ver.trial_days is not null
  then
    raise exception 'starter v1 does not mirror the catalogue';
  end if;

  select ver_row.* into ver
  from public.billing_package_versions ver_row
  join public.billing_packages p on p.id = ver_row.package_id
  where p.sku = 'growth' and ver_row.version = 1;
  if ver.monthly_price_kes <> 12000 or ver.minutes <> 800 then
    raise exception 'growth v1 does not mirror the catalogue';
  end if;

  select ver_row.* into ver
  from public.billing_package_versions ver_row
  join public.billing_packages p on p.id = ver_row.package_id
  where p.sku = 'scale' and ver_row.version = 1;
  if ver.monthly_price_kes <> 25000 or ver.minutes <> 2000 then
    raise exception 'scale v1 does not mirror the catalogue';
  end if;

  select ver_row.* into ver
  from public.billing_package_versions ver_row
  join public.billing_packages p on p.id = ver_row.package_id
  where p.sku = 'trial' and ver_row.version = 1;
  if ver.minutes <> 20 or ver.trial_days <> 14 or ver.monthly_price_kes <> 0
     or not ver.allowances_placeholder or ver.sms <> 20 or ver.email <> 30
     or ver.seats <> 2 or ver.staff_wa <> 0 or ver.dids <> 1 or ver.status <> 'published'
  then
    raise exception 'trial v1 is wrong';
  end if;
  if (select is_active from public.billing_packages where sku = 'trial') then
    raise exception 'trial package must stay off the public catalogue';
  end if;

  select count(*) into n
  from public.billing_package_version_features f
  join public.billing_package_versions v on v.id = f.package_version_id
  join public.billing_packages p on p.id = v.package_id
  where p.sku = 'starter' and v.version = 1 and f.enabled;
  if n < 9 then
    raise exception 'starter v1 features are not all on';
  end if;

  if (select voicemail_hold_days from public.billing_lifecycle_settings where id = 1) <> 7 then
    raise exception 'voicemail hold default is not 7';
  end if;
  if public.billing_quarantine_placeholder_days() <> 30 then
    raise exception 'quarantine placeholder is not 30';
  end if;

  select count(*) into n
  from public.billing_package_versions v
  join public.billing_packages p on p.id = v.package_id
  where p.sku = 'starter' and v.version = 1;
  if n <> 1 then
    raise exception 'starter v1 was duplicated by a re-run';
  end if;
end $$;

-- Published commercial columns are frozen. Draft can change, then publish, then retire.
do $$
declare
  v_id uuid;
begin
  begin
    update public.billing_package_versions v
    set monthly_price_kes = 1
    from public.billing_packages p
    where p.id = v.package_id and p.sku = 'starter' and v.version = 1;
    raise exception 'price update should have failed';
  exception when others then
    if sqlerrm not like '%frozen%' then
      raise;
    end if;
  end;

  insert into public.billing_package_versions (
    package_id, version, status, monthly_price_kes, seats, minutes, sms, email, staff_wa, dids,
    inbound_kes_per_second, outbound_kes_per_second, whatsapp_kes, sms_kes, email_kes,
    annual_discount_percent, trial_days, allowances_placeholder, active_from
  )
  select p.id, 2, 'draft', 9999, v.seats, v.minutes, v.sms, v.email, v.staff_wa, v.dids,
    v.inbound_kes_per_second, v.outbound_kes_per_second, v.whatsapp_kes, v.sms_kes, v.email_kes,
    v.annual_discount_percent, null, false, now()
  from public.billing_packages p
  join public.billing_package_versions v on v.package_id = p.id and v.version = 1
  where p.sku = 'starter'
  returning id into v_id;

  update public.billing_package_versions set monthly_price_kes = 8888 where id = v_id;
  update public.billing_package_versions
  set status = 'published', published_at = now()
  where id = v_id;
  update public.billing_package_versions
  set status = 'retired', retired_at = now()
  where id = v_id;
end $$;

-- Grandfather: legacy beta stays on v1. A new starter row pins to the latest published.
-- v2 was retired above, so publish another and check, then retire it again.
do $$
declare
  v_old int;
  v_new int;
  v_growth int;
  v_minutes int;
  v_seconds int;
  v_clock text;
  v_enf text;
  v_vm timestamptz;
begin
  select v.version, t.minutes_included, t.seconds_used, s.status, t.billing_enforcement, s.voicemail_until
    into v_old, v_minutes, v_seconds, v_clock, v_enf, v_vm
  from public.tenant_subscriptions s
  join public.tenants t on t.id = s.tenant_id
  join public.billing_package_versions v on v.id = s.package_version_id
  where s.tenant_id = '11111111-1111-1111-1111-111111111111';
  if v_old <> 1 or v_minutes <> 300 or v_seconds <> 10 or v_clock <> 'active'
     or v_enf <> 'off' or v_vm is not null
  then
    raise exception 'legacy beta was not grandfathered cleanly (% % % % %)', v_old, v_minutes, v_seconds, v_clock, v_enf;
  end if;
  if (select billing_status from public.tenant_subscriptions where tenant_id = '11111111-1111-1111-1111-111111111111') <> 'beta' then
    raise exception 'legacy enforcement off must backfill to beta';
  end if;
  if (select billing_status from public.tenant_subscriptions where tenant_id = '22222222-2222-2222-2222-222222222222') <> 'archived' then
    raise exception 'archived business must backfill to archived';
  end if;
  if (select billing_status from public.tenant_subscriptions where tenant_id = '33333333-3333-3333-3333-333333333333') <> 'suspended' then
    raise exception 'suspended business must backfill to suspended';
  end if;

  insert into public.billing_package_versions (
    package_id, version, status, monthly_price_kes, seats, minutes, sms, email, staff_wa, dids,
    inbound_kes_per_second, outbound_kes_per_second, whatsapp_kes, sms_kes, email_kes,
    annual_discount_percent, allowances_placeholder, active_from, published_at
  )
  select p.id, 3, 'published', 5000, v.seats, v.minutes, v.sms, v.email, v.staff_wa, v.dids,
    v.inbound_kes_per_second, v.outbound_kes_per_second, v.whatsapp_kes, v.sms_kes, v.email_kes,
    v.annual_discount_percent, false, now(), now()
  from public.billing_packages p
  join public.billing_package_versions v on v.package_id = p.id and v.version = 1
  where p.sku = 'starter';

  insert into public.tenants (
    id, business_name, sautikit_virtual_number, minutes_included, whatsapp_notification_number
  ) values (
    '99999999-9999-9999-9999-999999999999',
    'New Starter',
    'pending:99999999-9999-9999-9999-999999999999',
    300,
    '+254700000099'
  );
  insert into public.tenant_subscriptions (tenant_id, package_id, status)
  select '99999999-9999-9999-9999-999999999999', id, 'active'
  from public.billing_packages where sku = 'starter';

  select v.version into v_new
  from public.tenant_subscriptions s
  join public.billing_package_versions v on v.id = s.package_version_id
  where s.tenant_id = '99999999-9999-9999-9999-999999999999';
  if v_new <> 3 then
    raise exception 'new subscription should pin to starter v3, got %', v_new;
  end if;

  select v.version into v_old
  from public.tenant_subscriptions s
  join public.billing_package_versions v on v.id = s.package_version_id
  where s.tenant_id = '11111111-1111-1111-1111-111111111111';
  if v_old <> 1 then
    raise exception 'legacy subscription moved off v1';
  end if;

  update public.tenant_subscriptions
  set package_id = (select id from public.billing_packages where sku = 'growth')
  where tenant_id = '99999999-9999-9999-9999-999999999999';
  select v.version into v_growth
  from public.tenant_subscriptions s
  join public.billing_package_versions v on v.id = s.package_version_id
  join public.billing_packages p on p.id = s.package_id
  where s.tenant_id = '99999999-9999-9999-9999-999999999999';
  if v_growth <> 1 or (select sku from public.billing_packages p join public.tenant_subscriptions s on s.package_id = p.id where s.tenant_id = '99999999-9999-9999-9999-999999999999') <> 'growth' then
    raise exception 'package change did not pin the growth version';
  end if;

  begin
    update public.tenant_subscriptions
    set package_version_id = (select v.id from public.billing_package_versions v join public.billing_packages p on p.id = v.package_id where p.sku = 'starter' and v.version = 3)
    where tenant_id = '11111111-1111-1111-1111-111111111111';
    raise exception 'direct version change should have failed';
  exception when others then
    if sqlerrm not like '%pinned%' then
      raise;
    end if;
  end;
end $$;

-- State machine. Package clock, enforcement, line status, and minutes stay put.
do $$
declare
  v_id uuid := '11111111-1111-1111-1111-111111111111';
  v_events int;
  v_sub public.tenant_subscriptions%rowtype;
  v_tenant public.tenants%rowtype;
begin
  begin
    perform public.transition_subscription_billing_status(v_id, 'past_due', 'test', 'no');
    raise exception 'beta to past_due should have failed';
  exception when others then
    if sqlerrm not like '%a beta business is not billed%' then
      raise;
    end if;
  end;

  begin
    perform public.transition_subscription_billing_status(v_id, 'active', 'test', 'too soon');
    raise exception 'beta to active should have failed while enforcement is off';
  exception when others then
    if sqlerrm not like '%set billing mode before active%' then
      raise;
    end if;
  end;

  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants set billing_enforcement = 'soft' where id = v_id;
  perform set_config('scalers.wallet_write', '', true);

  perform public.transition_subscription_billing_status(v_id, 'active', 'test', 'turn on');
  perform public.transition_subscription_billing_status(v_id, 'past_due', 'test', 'late');
  perform public.transition_subscription_billing_status(v_id, 'grace', 'test', 'grace');
  perform public.transition_subscription_billing_status(v_id, 'suspended', 'test', 'stop');
  perform public.transition_subscription_billing_status(v_id, 'active', 'test', 'paid');

  select count(*) into v_events
  from public.subscription_events
  where tenant_id = v_id and to_status = 'active';
  perform public.transition_subscription_billing_status(v_id, 'active', 'test', 'replay');
  if (select count(*) from public.subscription_events where tenant_id = v_id and to_status = 'active') <> v_events then
    raise exception 'same-status replay wrote another event';
  end if;

  select * into v_sub from public.tenant_subscriptions where tenant_id = v_id;
  select * into v_tenant from public.tenants where id = v_id;
  if v_sub.status <> 'active' or v_tenant.billing_enforcement <> 'soft'
     or v_tenant.line_status <> 'active' or v_tenant.minutes_included <> 300
     or v_tenant.seconds_used <> 10 or v_sub.billing_status <> 'active'
     or v_sub.voicemail_until is not null
  then
    raise exception 'transition changed the package clock, enforcement, line, or minutes';
  end if;

  if (select count(*) from public.billing_notices where tenant_id = v_id and kind = 'platform_billing_past_due') <> 1 then
    raise exception 'past due notice missing';
  end if;
  if (select body from public.billing_notices where tenant_id = v_id and kind = 'platform_billing_past_due')
     not like '%Business Assistant%'
  then
    raise exception 'past due copy dropped Business Assistant';
  end if;
end $$;

-- Voicemail window: 7 days, then the configurable hold. Suspension notice stays pending.
do $$
declare
  v_id uuid := '11111111-1111-1111-1111-111111111111';
  v_until timestamptz;
  v_notice public.billing_notices%rowtype;
  v_allowed boolean;
  v_reason text;
begin
  perform public.transition_subscription_billing_status(v_id, 'suspended', 'test', 'hold');
  select voicemail_until into v_until from public.tenant_subscriptions where tenant_id = v_id;
  if v_until < now() + interval '6 days' or v_until > now() + interval '8 days' then
    raise exception 'default voicemail window is not about 7 days';
  end if;
  select * into v_notice
  from public.billing_notices
  where tenant_id = v_id and kind = 'platform_billing_suspended'
  order by created_at desc
  limit 1;
  if v_notice.delivery_status <> 'pending' or v_notice.channel <> 'sms'
     or v_notice.billed_to <> 'platform' or v_notice.audience <> 'staff'
     or v_notice.recipient <> '+254700000001'
     or v_notice.body not like '%suspended%'
     or v_notice.body not like '%not available%'
  then
    raise exception 'suspension notice is not a pending platform outbox row';
  end if;
  select allowed, reason into v_allowed, v_reason from public.tenant_escalation_allowed(v_id);
  if v_allowed or v_reason <> 'voicemail' then
    raise exception 'suspension window should block escalation as voicemail, got % %', v_allowed, v_reason;
  end if;

  perform public.transition_subscription_billing_status(v_id, 'active', 'test', 'clear');
  perform public.set_voicemail_hold_days(3, 'test', 'shorter');
  perform public.transition_subscription_billing_status(v_id, 'suspended', 'test', 'short hold');
  select voicemail_until into v_until from public.tenant_subscriptions where tenant_id = v_id;
  if v_until < now() + interval '2 days' or v_until > now() + interval '4 days' then
    raise exception 'voicemail hold did not follow the setting';
  end if;
  perform public.set_voicemail_hold_days(7, 'test', 'restore');
  perform public.transition_subscription_billing_status(v_id, 'active', 'test', 'back');
end $$;

-- Trial end opens voicemail except when the trial becomes active.
do $$
declare
  v_active uuid := '44444444-4444-4444-4444-444444444444';
  v_stop uuid := '55555555-5555-5555-5555-555555555555';
  v_cancel uuid := '66666666-6666-6666-6666-666666666666';
  v_until timestamptz;
  v_trial uuid;
begin
  select id into v_trial from public.billing_packages where sku = 'trial';
  insert into public.tenants (id, business_name, sautikit_virtual_number, minutes_included, whatsapp_notification_number)
  values
    (v_active, 'Trial Active', 'pending:' || v_active::text, 20, '+254700000044'),
    (v_stop, 'Trial Stop', 'pending:' || v_stop::text, 20, '+254700000055'),
    (v_cancel, 'Trial Cancel', 'pending:' || v_cancel::text, 20, '+254700000066');
  insert into public.tenant_subscriptions (tenant_id, package_id, status)
  values (v_active, v_trial, 'active'), (v_stop, v_trial, 'active'), (v_cancel, v_trial, 'active');

  insert into public.tenants (
    id, business_name, sautikit_virtual_number, minutes_included
  ) values (
    '12121212-1212-1212-1212-121212121212',
    'Starter No Trial',
    'pending:12121212-1212-1212-1212-121212121212',
    300
  );
  insert into public.tenant_subscriptions (tenant_id, package_id, status)
  select '12121212-1212-1212-1212-121212121212', id, 'active'
  from public.billing_packages where sku = 'starter';
  begin
    perform public.transition_subscription_billing_status(
      '12121212-1212-1212-1212-121212121212', 'trialing', 'test', 'wrong package');
    raise exception 'starter has no trial';
  exception when others then
    if sqlerrm not like '%no trial%' then
      raise;
    end if;
  end;

  perform public.transition_subscription_billing_status(v_active, 'trialing', 'test', 'start');
  select trial_ends_at, voicemail_until into v_until, v_until
  from public.tenant_subscriptions where tenant_id = v_active;
  if (select trial_ends_at from public.tenant_subscriptions where tenant_id = v_active) < now() + interval '13 days'
     or (select trial_ends_at from public.tenant_subscriptions where tenant_id = v_active) > now() + interval '15 days'
     or (select voicemail_until from public.tenant_subscriptions where tenant_id = v_active) is not null
  then
    raise exception 'trial start did not set a 14 day end';
  end if;
  perform public.transition_subscription_billing_status(v_active, 'active', 'test', 'convert');
  if (select voicemail_until from public.tenant_subscriptions where tenant_id = v_active) is not null
     or exists (select 1 from public.billing_notices where tenant_id = v_active and kind = 'platform_billing_trial_ended')
  then
    raise exception 'trial to active must not open voicemail or a trial-ended notice';
  end if;

  perform public.transition_subscription_billing_status(v_stop, 'trialing', 'test', 'start');
  perform public.transition_subscription_billing_status(v_stop, 'suspended', 'test', 'end');
  if (select voicemail_until from public.tenant_subscriptions where tenant_id = v_stop) < now() + interval '6 days'
     or not exists (
       select 1 from public.billing_notices
       where tenant_id = v_stop and kind = 'platform_billing_trial_ended'
         and body like '%Business Assistant%' and delivery_status = 'pending'
     )
  then
    raise exception 'trial suspension did not open voicemail and a trial-ended notice';
  end if;

  perform public.transition_subscription_billing_status(v_cancel, 'trialing', 'test', 'start');
  perform public.transition_subscription_billing_status(v_cancel, 'cancelled', 'test', 'end');
  if (select voicemail_until from public.tenant_subscriptions where tenant_id = v_cancel) is null
     or not exists (
       select 1 from public.billing_notices
       where tenant_id = v_cancel and kind = 'platform_billing_trial_ended' and body like '%not available%'
     )
  then
    raise exception 'trial cancel did not open voicemail';
  end if;
end $$;

-- apply_payment replay, partial, overpay, unmatched, void, draft. Webhook inbox replay.
do $$
declare
  v_id uuid := '77777777-7777-7777-7777-777777777777';
  v_full uuid;
  v_part uuid;
  v_over uuid;
  v_void uuid;
  v_draft uuid;
  v_inv public.invoices%rowtype;
  v_pay public.payments%rowtype;
  v_again public.payments%rowtype;
  v_event public.payment_events%rowtype;
  n int;
begin
  insert into public.tenants (
    id, business_name, sautikit_virtual_number, whatsapp_notification_number, alert_email
  ) values (
    v_id, 'Payer', 'pending:' || v_id::text, '+254700000077', 'payer@example.com'
  );

  insert into public.invoices (tenant_id, status, total_kes, subtotal_kes)
  values (v_id, 'draft', 100, 100) returning id into v_full;
  select * into v_inv from public.finalize_invoice(v_full);
  if v_inv.invoice_number not like 'SC-%' or v_inv.status <> 'open' then
    raise exception 'finalize did not open the invoice';
  end if;
  if not exists (
    select 1 from public.billing_notices
    where tenant_id = v_id and kind = 'platform_billing_invoice_due'
      and idempotency_key = 'platform_billing_invoice_due:' || v_full::text
      and body like '%Business Assistant%'
      and delivery_status = 'pending' and billed_to = 'platform' and channel = 'sms'
  ) then
    raise exception 'invoice due notice missing';
  end if;
  begin
    perform public.finalize_invoice(v_full);
    raise exception 'second finalize should have failed';
  exception when others then
    if sqlerrm not like '%only a draft%' then
      raise;
    end if;
  end;

  select * into v_pay from public.apply_payment('bachs', 'full-1', 100, v_id, v_full, now(), 'test');
  select * into v_again from public.apply_payment('bachs', 'full-1', 100, v_id, v_full, now(), 'test');
  if v_pay.id <> v_again.id
     or (select count(*) from public.payments where provider = 'bachs' and provider_ref = 'full-1') <> 1
     or (select amount_paid_kes from public.invoices where id = v_full) <> 100
     or (select status from public.invoices where id = v_full) <> 'paid'
  then
    raise exception 'full payment was not idempotent';
  end if;

  insert into public.invoices (tenant_id, status, total_kes, subtotal_kes)
  values (v_id, 'draft', 100, 100) returning id into v_part;
  perform public.finalize_invoice(v_part);
  perform public.apply_payment('bachs', 'part-1', 40, v_id, v_part, now(), 'test');
  if (select status from public.invoices where id = v_part) <> 'open'
     or (select amount_paid_kes from public.invoices where id = v_part) <> 40
  then
    raise exception 'partial payment closed the invoice';
  end if;
  perform public.apply_payment('bachs', 'part-2', 60, v_id, v_part, now(), 'test');
  if (select status from public.invoices where id = v_part) <> 'paid'
     or (select amount_paid_kes from public.invoices where id = v_part) <> 100
  then
    raise exception 'second partial did not pay the invoice';
  end if;

  insert into public.invoices (tenant_id, status, total_kes, subtotal_kes)
  values (v_id, 'draft', 100, 100) returning id into v_over;
  perform public.finalize_invoice(v_over);
  perform public.apply_payment('bachs', 'over-1', 150, v_id, v_over, now(), 'test');
  perform public.apply_payment('bachs', 'over-1', 150, v_id, v_over, now(), 'test');
  select count(*) into n from public.tenant_credits where idempotency_key = 'overpay:bachs:over-1';
  if n <> 1
     or (select amount_kes from public.tenant_credits where idempotency_key = 'overpay:bachs:over-1') <> 50
     or (select status from public.invoices where id = v_over) <> 'paid'
     or (select amount_paid_kes from public.invoices where id = v_over) <> 100
  then
    raise exception 'overpay credit was not written once';
  end if;

  perform public.apply_payment('bachs', 'unmatched-1', 25, v_id, null, now(), 'test');
  if (select match_status from public.payments where provider_ref = 'unmatched-1') <> 'unmatched'
     or (select amount_paid_kes from public.invoices where id = v_over) <> 100
  then
    raise exception 'unmatched payment touched an invoice';
  end if;

  insert into public.invoices (tenant_id, status, total_kes, subtotal_kes)
  values (v_id, 'draft', 80, 80) returning id into v_void;
  perform public.finalize_invoice(v_void);
  perform set_config('scalers.billing_write', '1', true);
  update public.invoices set status = 'void' where id = v_void;
  perform set_config('scalers.billing_write', '', true);
  begin
    perform public.apply_payment('bachs', 'void-1', 80, v_id, v_void, now(), 'test');
    raise exception 'void payment should have failed';
  exception when others then
    if sqlerrm not like '%cannot be paid%' then
      raise;
    end if;
  end;

  insert into public.invoices (tenant_id, status, total_kes, subtotal_kes)
  values (v_id, 'draft', 10, 10) returning id into v_draft;
  begin
    perform public.apply_payment('bachs', 'draft-1', 10, v_id, v_draft, now(), 'test');
    raise exception 'draft payment should have failed';
  exception when others then
    if sqlerrm not like '%not payable%' then
      raise;
    end if;
  end;

  select * into v_event from public.record_payment_event('bachs', 'evt-1', '{"ok":true}'::jsonb);
  select * into v_event from public.record_payment_event('bachs', 'evt-1', '{"ok":true}'::jsonb);
  if (select count(*) from public.payment_events where event_key = 'evt-1') <> 1
     or v_event.attempts <> 2
  then
    raise exception 'webhook replay did not increment attempts';
  end if;
end $$;

-- Escalation is allowed only in good standing with usage left.
-- A billing notice is still pending while escalation is blocked.
do $$
declare
  v_beta uuid := '11111111-1111-1111-1111-111111111111';
  v_cap uuid := '88888888-8888-8888-8888-888888888888';
  v_allowed boolean;
  v_reason text;
  v_pkg uuid;
begin
  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants set billing_enforcement = 'off', seconds_used = 300 * 60
  where id = v_beta;
  perform set_config('scalers.wallet_write', '', true);
  -- 1111 is active with enforcement off after the state-machine block. Put it back to beta
  -- only if the transition allows active -> ... we need beta. active cannot go to beta.
  -- Use a fresh beta tenant instead.
  select id into v_pkg from public.billing_packages where sku = 'starter';
  insert into public.tenants (
    id, business_name, sautikit_virtual_number, billing_enforcement,
    minutes_included, seconds_used, on_demand_usage_enabled, whatsapp_notification_number
  ) values (
    v_cap, 'Cap Co', 'pending:' || v_cap::text, 'off', 300, 300 * 60, false, '+254700000088'
  );
  insert into public.tenant_subscriptions (tenant_id, package_id, status)
  values (v_cap, v_pkg, 'active');

  select allowed, reason into v_allowed, v_reason from public.tenant_escalation_allowed(v_cap);
  if not v_allowed or v_reason <> 'ok' then
    raise exception 'beta over cap should still escalate, got % %', v_allowed, v_reason;
  end if;

  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants set billing_enforcement = 'soft', seconds_used = 10 where id = v_cap;
  perform set_config('scalers.wallet_write', '', true);
  perform public.transition_subscription_billing_status(v_cap, 'active', 'test', 'enforce');
  select allowed, reason into v_allowed, v_reason from public.tenant_escalation_allowed(v_cap);
  if not v_allowed or v_reason <> 'ok' then
    raise exception 'enforced under cap should escalate, got % %', v_allowed, v_reason;
  end if;

  update public.tenants set seconds_used = 300 * 60 where id = v_cap;
  select allowed, reason into v_allowed, v_reason from public.tenant_escalation_allowed(v_cap);
  if v_allowed or v_reason <> 'minutes_cap' then
    raise exception 'enforced at cap should be minutes_cap, got % %', v_allowed, v_reason;
  end if;
  if exists (select 1 from public.tenant_subscriptions where tenant_id = v_cap and voicemail_until is not null) then
    raise exception 'minutes cap must not start the voicemail clock';
  end if;

  update public.tenants set on_demand_usage_enabled = true where id = v_cap;
  select allowed, reason into v_allowed, v_reason from public.tenant_escalation_allowed(v_cap);
  if not v_allowed or v_reason <> 'ok' then
    raise exception 'on-demand over cap should escalate, got % %', v_allowed, v_reason;
  end if;

  -- Trial still running, minutes left.
  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants set seconds_used = 0, on_demand_usage_enabled = false, billing_enforcement = 'soft'
  where id = '44444444-4444-4444-4444-444444444444';
  perform set_config('scalers.wallet_write', '', true);
  -- 4444 was converted to active. Build a fresh trialing row on the stop tenant's sibling.
  perform set_config('scalers.billing_transition', '1', true);
  update public.tenant_subscriptions
  set billing_status = 'trialing', trial_ends_at = now() + interval '3 days', voicemail_until = null
  where tenant_id = '44444444-4444-4444-4444-444444444444';
  perform set_config('scalers.billing_transition', '', true);
  update public.tenants
  set minutes_included = 20, seconds_used = 0, billing_enforcement = 'soft', on_demand_usage_enabled = false
  where id = '44444444-4444-4444-4444-444444444444';
  select allowed, reason into v_allowed, v_reason
  from public.tenant_escalation_allowed('44444444-4444-4444-4444-444444444444');
  if not v_allowed or v_reason <> 'ok' then
    raise exception 'trial with time and minutes should escalate, got % %', v_allowed, v_reason;
  end if;

  perform set_config('scalers.billing_transition', '1', true);
  update public.tenant_subscriptions
  set trial_ends_at = now() - interval '1 hour', voicemail_until = null
  where tenant_id = '44444444-4444-4444-4444-444444444444';
  perform set_config('scalers.billing_transition', '', true);
  select allowed, reason into v_allowed, v_reason
  from public.tenant_escalation_allowed('44444444-4444-4444-4444-444444444444');
  if v_allowed or v_reason <> 'trial_ended' then
    raise exception 'ended trial should be trial_ended, got % %', v_allowed, v_reason;
  end if;

  perform set_config('scalers.billing_transition', '1', true);
  update public.tenant_subscriptions
  set trial_ends_at = now() + interval '3 days', voicemail_until = null
  where tenant_id = '44444444-4444-4444-4444-444444444444';
  perform set_config('scalers.billing_transition', '', true);
  update public.tenants set seconds_used = 20 * 60 where id = '44444444-4444-4444-4444-444444444444';
  select allowed, reason into v_allowed, v_reason
  from public.tenant_escalation_allowed('44444444-4444-4444-4444-444444444444');
  if v_allowed or v_reason <> 'minutes_cap' then
    raise exception 'trial out of minutes should be minutes_cap, got % %', v_allowed, v_reason;
  end if;

  select allowed, reason into v_allowed, v_reason
  from public.tenant_escalation_allowed('33333333-3333-3333-3333-333333333333');
  if v_allowed or v_reason not in ('suspended', 'voicemail', 'line_not_available') then
    raise exception 'suspended line should not escalate, got % %', v_allowed, v_reason;
  end if;

  perform set_config('scalers.billing_transition', '1', true);
  update public.tenant_subscriptions
  set voicemail_until = now() - interval '1 day', billing_status = 'suspended'
  where tenant_id = '33333333-3333-3333-3333-333333333333';
  perform set_config('scalers.billing_transition', '', true);
  select allowed, reason into v_allowed, v_reason
  from public.tenant_escalation_allowed('33333333-3333-3333-3333-333333333333');
  if v_allowed or v_reason <> 'line_not_available' then
    raise exception 'voicemail window passed should be line_not_available, got % %', v_allowed, v_reason;
  end if;

  -- past_due with minutes left still escalates, and its notice is not suppressed.
  perform public.transition_subscription_billing_status(v_cap, 'past_due', 'test', 'late');
  update public.tenants set seconds_used = 10, on_demand_usage_enabled = false where id = v_cap;
  select allowed, reason into v_allowed, v_reason from public.tenant_escalation_allowed(v_cap);
  if not v_allowed or v_reason <> 'ok' then
    raise exception 'past due with minutes should escalate, got % %', v_allowed, v_reason;
  end if;

  perform public.transition_subscription_billing_status(v_cap, 'suspended', 'test', 'stop');
  select allowed, reason into v_allowed, v_reason from public.tenant_escalation_allowed(v_cap);
  if v_allowed then
    raise exception 'suspended cap tenant should not escalate';
  end if;
  if (select delivery_status from public.billing_notices
      where tenant_id = v_cap and kind = 'platform_billing_suspended'
      order by created_at desc limit 1) <> 'pending'
  then
    raise exception 'suspension billing notice must stay on the channel outbox';
  end if;
end $$;

-- Quarantine: release does not make the number available. Assign skips it.
do $$
declare
  v_id uuid := 'cccccccc-cccc-cccc-cccc-ccccccccccc3';
  v_first text;
  v_second text;
begin
  insert into public.tenants (id, business_name, sautikit_virtual_number)
  values (v_id, 'Pool Co', 'pending:' || v_id::text);
  insert into public.sautikit_did_pool (e164, status, created_at)
  values ('+254700111001', 'available', now() - interval '2 minutes');
  insert into public.sautikit_did_pool (e164, status, created_at)
  values ('+254700111002', 'available', now() - interval '1 minute');

  v_first := public.assign_did_from_pool(v_id);
  if v_first <> '+254700111001' then
    raise exception 'assign did not take the oldest available number, got %', v_first;
  end if;
  update public.sautikit_did_pool
  set last_tenant_id = 'cccccccc-cccc-cccc-cccc-cccccccccc99'
  where e164 = '+254700111001';
  if public.release_did_from_business(v_id) <> '+254700111001' then
    raise exception 'release did not return the number';
  end if;
  if (select sautikit_virtual_number from public.tenants where id = v_id) not like 'pending:%' then
    raise exception 'release did not detach the business number';
  end if;
  if (select status from public.sautikit_did_pool where e164 = '+254700111001') <> 'quarantine'
     or (select quarantine_until from public.sautikit_did_pool where e164 = '+254700111001') < now() + interval '29 days'
     or (select tenant_id from public.sautikit_did_pool where e164 = '+254700111001') is not null
     or (select last_tenant_id from public.sautikit_did_pool where e164 = '+254700111001') is distinct from v_id
  then
    raise exception 'release did not quarantine the pool row for this business';
  end if;

  v_second := public.assign_did_from_pool(v_id);
  if v_second <> '+254700111002' then
    raise exception 'assign handed out a quarantined number, got %', v_second;
  end if;

  begin
    perform public.assign_specific_did_to_tenant(v_id, '+254700111001');
    raise exception 'specific assign should have refused quarantine';
  exception when others then
    if sqlerrm not like '%quarantine%' then
      raise;
    end if;
  end;

  begin
    update public.sautikit_did_pool set status = 'available' where e164 = '+254700111001';
    raise exception 'direct available update should have failed';
  exception when others then
    if sqlerrm not like '%quarantine%' then
      raise;
    end if;
  end;

  -- Unlinked pool quarantine clears tenant_id and keeps the previous business.
  update public.sautikit_did_pool
  set status = 'assigned', tenant_id = v_id, assigned_at = now(),
      quarantine_until = null, quarantined_at = null, last_tenant_id = null
  where e164 = '+254700111002';
  perform public.quarantine_pool_number('+254700111002', now() + interval '30 days', 'test', 'pool release');
  if (select tenant_id from public.sautikit_did_pool where e164 = '+254700111002') is not null
     or (select last_tenant_id from public.sautikit_did_pool where e164 = '+254700111002') is distinct from v_id
     or (select status from public.sautikit_did_pool where e164 = '+254700111002') <> 'quarantine'
  then
    raise exception 'pool quarantine should clear tenant_id and record last_tenant_id';
  end if;
end $$;

-- Quarantine exit: sweeper, pool assign, and specific assign.
do $$
declare
  v_pool uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5';
  v_specific uuid := 'ffffffff-ffff-ffff-ffff-fffffffffff6';
  v_prev uuid := 'cccccccc-cccc-cccc-cccc-cccccccccc99';
  v_got text;
  v_count integer;
begin
  insert into public.tenants (id, business_name, sautikit_virtual_number)
  values
    (v_pool, 'Exit Pool', 'pending:' || v_pool::text),
    (v_specific, 'Exit Specific', 'pending:' || v_specific::text);

  insert into public.sautikit_did_pool (
    e164, status, created_at, quarantine_until, quarantined_at, last_tenant_id
  ) values
    ('+254700111010', 'quarantine', now() - interval '10 minutes', now() - interval '1 hour', now() - interval '30 days', v_prev),
    ('+254700111011', 'quarantine', now() - interval '5 minutes', now() - interval '1 hour', now() - interval '30 days', v_prev),
    ('+254700111012', 'quarantine', now() - interval '1 minute', now() + interval '10 days', now(), v_prev);

  v_count := public.release_expired_quarantine();
  if v_count <> 2 then
    raise exception 'sweeper should release two expired rows, got %', v_count;
  end if;
  if (select status from public.sautikit_did_pool where e164 = '+254700111010') <> 'available'
     or (select quarantine_until from public.sautikit_did_pool where e164 = '+254700111010') is not null
     or (select last_tenant_id from public.sautikit_did_pool where e164 = '+254700111010') is distinct from v_prev
     or (select status from public.sautikit_did_pool where e164 = '+254700111012') <> 'quarantine'
  then
    raise exception 'sweeper should clear an expired hold and leave a future hold';
  end if;

  -- Put the two expired numbers back so pool assign must exit them itself.
  update public.sautikit_did_pool
  set status = 'quarantine',
      quarantine_until = now() - interval '1 hour',
      quarantined_at = now() - interval '30 days',
      tenant_id = null
  where e164 in ('+254700111010', '+254700111011');

  v_got := public.assign_did_from_pool(v_pool);
  if v_got <> '+254700111010' then
    raise exception 'pool assign should take the oldest expired quarantine, got %', v_got;
  end if;
  if (select status from public.sautikit_did_pool where e164 = '+254700111011') <> 'available'
     or (select quarantine_until from public.sautikit_did_pool where e164 = '+254700111011') is not null
     or (select status from public.sautikit_did_pool where e164 = '+254700111012') <> 'quarantine'
     or (select quarantine_until from public.sautikit_did_pool where e164 = '+254700111010') is not null
  then
    raise exception 'pool assign should sweep other expired rows and skip a future hold';
  end if;

  insert into public.sautikit_did_pool (
    e164, status, created_at, quarantine_until, quarantined_at, last_tenant_id
  ) values
    ('+254700111020', 'quarantine', now() - interval '3 minutes', now() - interval '2 hours', now() - interval '30 days', v_prev),
    ('+254700111021', 'quarantine', now() - interval '2 minutes', now() + interval '10 days', now(), v_prev),
    ('+254700111022', 'quarantine', now() - interval '1 minute', now() - interval '2 hours', now() - interval '30 days', v_prev);

  v_got := public.assign_specific_did_to_tenant(v_specific, '+254700111020');
  if v_got <> '+254700111020' then
    raise exception 'specific assign should take an expired quarantine row, got %', v_got;
  end if;
  if (select status from public.sautikit_did_pool where e164 = '+254700111020') <> 'assigned'
     or (select tenant_id from public.sautikit_did_pool where e164 = '+254700111020') is distinct from v_specific
     or (select quarantine_until from public.sautikit_did_pool where e164 = '+254700111020') is not null
     or (select status from public.sautikit_did_pool where e164 = '+254700111022') <> 'available'
     or (select status from public.sautikit_did_pool where e164 = '+254700111021') <> 'quarantine'
  then
    raise exception 'specific assign should clear the hold, sweep other expired rows, and leave a future hold';
  end if;

  begin
    perform public.assign_specific_did_to_tenant(v_specific, '+254700111021');
    raise exception 'specific assign should have refused the hold';
  exception when others then
    if sqlerrm not like '%quarantine%' then
      raise;
    end if;
  end;
end $$;

-- Claim reclaims a stale sending row. Settle does not downgrade sent.
do $$
declare
  v_id uuid := '12121212-1212-1212-1212-121212121288';
  v_fresh public.billing_notices%rowtype;
  v_stale public.billing_notices%rowtype;
  v_claimed public.billing_notices%rowtype;
  v_sent public.billing_notices%rowtype;
  v_again public.billing_notices%rowtype;
  v_send uuid := '12121212-1212-1212-1212-121212121201';
  v_other uuid := '12121212-1212-1212-1212-121212121202';
  v_key text;
  n integer;
begin
  loop
    select count(*) into n from public.claim_billing_notices(100);
    exit when n = 0;
  end loop;

  insert into public.tenants (
    id, business_name, sautikit_virtual_number, whatsapp_notification_number
  ) values (
    v_id, 'Notice Probe', 'pending:' || v_id::text, '+254700000188'
  );

  select * into v_stale from public.enqueue_billing_notice(
    v_id, 'platform_billing_past_due', 'platform_billing_past_due:stale', 'Payment past due',
    'Your Business Assistant payment is past due. The line stays on until it is suspended.');
  select * into v_fresh from public.enqueue_billing_notice(
    v_id, 'platform_billing_invoice_due', 'platform_billing_invoice_due:fresh', 'Invoice due',
    'Your Business Assistant invoice SC-1 for KES 10 is due.');
  v_key := v_stale.idempotency_key;

  perform set_config('scalers.billing_notice_delivery', '1', true);
  update public.billing_notices
  set delivery_status = 'sending', claimed_at = now() - interval '16 minutes'
  where id = v_stale.id;
  update public.billing_notices
  set delivery_status = 'sending', claimed_at = now()
  where id = v_fresh.id;

  select * into v_claimed from public.claim_billing_notices(20)
  where id = v_stale.id;
  if v_claimed.id is null or v_claimed.delivery_status <> 'sending'
     or v_claimed.claimed_at < now() - interval '1 minute'
     or v_claimed.idempotency_key is distinct from v_key
  then
    raise exception 'stale sending notice was not reclaimed';
  end if;
  if (select claimed_at from public.billing_notices where id = v_fresh.id) < now() - interval '1 minute'
     or (select delivery_status from public.billing_notices where id = v_fresh.id) <> 'sending'
  then
    raise exception 'a fresh sending notice must not be reclaimed';
  end if;

  select * into v_sent from public.settle_billing_notice(v_stale.id, 'sent', v_send, null);
  if v_sent.delivery_status <> 'sent' or v_sent.notify_send_id is distinct from v_send then
    raise exception 'settle did not record sent';
  end if;
  select * into v_again from public.settle_billing_notice(v_stale.id, 'failed', v_other, 'later crash');
  if v_again.delivery_status <> 'sent'
     or v_again.notify_send_id is distinct from v_send
     or v_again.last_error is not null
     or v_again.idempotency_key is distinct from v_key
  then
    raise exception 'settle downgraded a sent notice';
  end if;
end $$;

-- No destination still leaves a dashboard row. All-off channels still pick SMS.
do $$
declare
  v_none uuid := 'dddddddd-dddd-dddd-dddd-ddddddddddd4';
  v_row public.billing_notices%rowtype;
begin
  insert into public.tenants (
    id, business_name, sautikit_virtual_number, whatsapp_notification_number, alert_email,
    notify_channels
  ) values (
    v_none, 'No Destination', 'pending:' || v_none::text, 'pending:none', null,
    '{"sms":false,"whatsapp":false,"email":false}'::jsonb
  );
  select * into v_row from public.enqueue_billing_notice(
    v_none, 'platform_billing_trial_ending', 'platform_billing_trial_ending:' || v_none::text, null, null);
  if v_row.delivery_status <> 'skipped' or v_row.last_error <> 'no recipient'
     or v_row.title <> 'Trial ending' or v_row.body not like '%Business Assistant%'
  then
    raise exception 'missing destination should skip and stay visible';
  end if;

  update public.tenants
  set whatsapp_notification_number = '+254700000099'
  where id = v_none;
  select * into v_row from public.enqueue_billing_notice(
    v_none, 'platform_billing_trial_ending', 'platform_billing_trial_ending:' || v_none::text || ':2', null, null);
  if v_row.channel <> 'sms' or v_row.recipient <> '+254700000099' or v_row.delivery_status <> 'pending' then
    raise exception 'all-off channels should still fall back to SMS';
  end if;
end $$;

-- RLS: own invoices, subscription, and notices. No other tenant. No anon. No owner writes.
do $$
declare
  v_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';
  v_user_a uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa11';
  v_user_b uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb22';
  v_pkg uuid;
  v_inv_a uuid;
  v_notice_a uuid;
  v_notice_b uuid;
  n int;
begin
  select id into v_pkg from public.billing_packages where sku = 'growth';
  insert into public.tenants (id, business_name, sautikit_virtual_number, whatsapp_notification_number)
  values
    (v_a, 'Owner A', 'pending:' || v_a::text, '+2547000000a1'),
    (v_b, 'Owner B', 'pending:' || v_b::text, '+2547000000b2');
  insert into public.tenant_subscriptions (tenant_id, package_id, status)
  values (v_a, v_pkg, 'active'), (v_b, v_pkg, 'active');
  insert into public.tenant_members (tenant_id, user_id) values (v_a, v_user_a), (v_b, v_user_b);

  insert into public.invoices (tenant_id, status, total_kes, subtotal_kes)
  values (v_a, 'draft', 50, 50) returning id into v_inv_a;
  perform public.finalize_invoice(v_inv_a);
  insert into public.invoice_lines (invoice_id, tenant_id, description, amount_kes)
  values (v_inv_a, v_a, 'Business Assistant', 50);
  insert into public.invoices (tenant_id, status, total_kes, subtotal_kes)
  values (v_b, 'draft', 70, 70);
  perform public.finalize_invoice((select id from public.invoices where tenant_id = v_b limit 1));

  select id into v_notice_a from public.billing_notices where tenant_id = v_a limit 1;
  select id into v_notice_b from public.billing_notices where tenant_id = v_b limit 1;

  perform set_config('request.jwt.claim.sub', v_user_a::text, false);
  set role authenticated;

  select count(*) into n from public.invoices;
  if n <> 1 then
    raise exception 'owner A should see one invoice, saw %', n;
  end if;
  select count(*) into n from public.invoice_lines;
  if n <> 1 then
    raise exception 'owner A should see one invoice line, saw %', n;
  end if;
  select count(*) into n from public.billing_notices;
  if n <> 1 then
    raise exception 'owner A should see one notice, saw %', n;
  end if;
  select count(*) into n from public.tenant_subscriptions;
  if n <> 1 then
    raise exception 'owner A should see one subscription, saw %', n;
  end if;
  select count(*) into n from public.billing_subscription_read where tenant_id = v_b;
  if n <> 0 then
    raise exception 'owner A saw another subscription read model';
  end if;

  begin
    insert into public.invoices (tenant_id, total_kes) values (v_a, 1);
    raise exception 'owner insert should have failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.billing_notices (
      tenant_id, kind, title, body, idempotency_key
    ) values (
      v_a, 'platform_billing_past_due', 'x', 'x', 'owner-write'
    );
    raise exception 'owner notice insert should have failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    update public.tenant_subscriptions set billing_status = 'active' where tenant_id = v_a;
    raise exception 'owner billing status update should have failed';
  exception when insufficient_privilege then
    null;
  end;

  perform public.mark_billing_notice_read(v_notice_a);
  begin
    perform public.mark_billing_notice_read(v_notice_b);
    raise exception 'owner A marked B read';
  exception when others then
    if sqlerrm not like '%notice not found%' then
      raise;
    end if;
  end;
  begin
    perform public.tenant_escalation_allowed(v_a);
    raise exception 'owner should not execute escalation check';
  exception when insufficient_privilege then
    null;
  end;

  reset role;
  if (select read_at from public.billing_notices where id = v_notice_a) is null then
    raise exception 'mark-read did not stick';
  end if;
  if (select delivery_status from public.billing_notices where id = v_notice_a) <> 'pending' then
    raise exception 'mark-read changed delivery';
  end if;

  set role anon;
  begin
    perform 1 from public.invoices;
    raise exception 'anon select should have failed';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.tenant_escalation_allowed(v_a);
    raise exception 'anon escalation should have failed';
  exception when insufficient_privilege then
    null;
  end;
  reset role;
end $$;

-- A business delete still cascades notices and status events. Payments block it.
-- Audit rows stay.
do $$
declare
  v_id uuid := '12121212-1212-1212-1212-121212121299';
  v_pkg uuid;
  v_audit int;
begin
  select id into v_pkg from public.billing_packages where sku = 'starter';
  insert into public.tenants (
    id, business_name, sautikit_virtual_number, whatsapp_notification_number
  ) values (
    v_id, 'Delete Probe', 'pending:12121212-1212-1212-1212-121212121299', '+254700000299'
  );
  insert into public.tenant_subscriptions (tenant_id, package_id, status)
  values (v_id, v_pkg, 'active');
  perform public.transition_subscription_billing_status(v_id, 'cancelled', 'test', 'purge probe');
  perform public.enqueue_billing_notice(v_id, 'platform_billing_trial_ending', 'purge-notice');
  if (select count(*) from public.subscription_events where tenant_id = v_id) < 1
     or (select count(*) from public.billing_notices where tenant_id = v_id) < 1
  then
    raise exception 'purge probe wrote no status event or notice';
  end if;
  insert into public.invoices (tenant_id, status, total_kes, subtotal_kes)
  values (v_id, 'draft', 10, 10);
  perform public.apply_payment('bachs', 'purge-block', 10, v_id, null, now(), 'test');
  begin
    delete from public.tenants where id = v_id;
    raise exception 'payment should have blocked business delete';
  exception when others then
    if sqlerrm like '%payment should have blocked%' then
      raise;
    end if;
  end;
  delete from public.payments where tenant_id = v_id;
  select count(*) into v_audit from public.billing_audit_log where tenant_id = v_id;
  if v_audit < 1 then
    raise exception 'purge probe wrote no audit row';
  end if;
  delete from public.tenants where id = v_id;
  if exists (select 1 from public.tenants where id = v_id)
     or exists (select 1 from public.subscription_events where tenant_id = v_id)
     or exists (select 1 from public.billing_notices where tenant_id = v_id)
     or exists (select 1 from public.invoices where tenant_id = v_id)
  then
    raise exception 'business delete left billing children';
  end if;
  if (select count(*) from public.billing_audit_log where tenant_id = v_id) <> v_audit then
    raise exception 'business delete removed audit rows';
  end if;
end $$;
