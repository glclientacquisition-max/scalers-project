-- package_version_owner_prices.sql
-- Purpose: Publish the owner's locked prices (ex-VAT, KSh) as the next version
--          of Starter, Growth, Scale, and the trial.
-- Run after: package_version_editor.sql
-- Idempotent. A second run does not publish another version.
--
-- Staging only (sgcdncjxauhsbunobmob). DO NOT RUN on production
-- fjxcdccgyhnvnnlnovcl. This file does not move a business, does not change
-- billing_enforcement, and does not create an invoice. Current businesses stay
-- on free beta. The published versions are what a new subscription pins to.
-- It does not change billing_packages or billing_rate_card. The public
-- catalogue screen keeps reading those tables until Desk reads package versions.
--
-- Annual price is not stored. It is round(monthly * 12 * (1 - discount/100)):
-- Starter 17% is 69,720. Growth and Scale 10% are 194,400 and 378,000.
-- Call rates are stored per second at 5 decimals, matching the desk:
-- round((per_minute / 60) * 100000) / 100000.
-- Trial on-demand is locked off. Trial inbound stays the copied rate.
-- Trial seats and numbers stay the copied version (2 and 1). The old sms,
-- email, and staff_wa columns are copied and not rewritten.

create or replace function pg_temp.owner_kes_per_second(p_per_minute numeric)
returns numeric
language sql
immutable
as $$
  select round((p_per_minute / 60) * 100000) / 100000
$$;

create or replace function pg_temp.seed_owner_price(
  p_sku text,
  p_monthly numeric,
  p_discount numeric,
  p_seats integer,
  p_minutes integer,
  p_dids integer,
  p_credits integer,
  p_inbound_per_minute numeric,
  p_on_demand boolean,
  p_trial_days integer,
  p_notes text
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_package_id uuid;
  v_existing uuid;
  v_draft uuid;
  v_row public.billing_package_versions%rowtype;
  v_seats integer;
  v_dids integer;
  v_inbound numeric;
  v_outbound numeric;
  v_features jsonb;
  v_patch jsonb;
  v_reason text := 'Staging seed of the owner price table. Does not move a business.';
begin
  select id into v_package_id from public.billing_packages where sku = p_sku;
  if v_package_id is null then
    raise exception 'package not found';
  end if;
  if exists (
    select 1 from public.billing_package_versions
    where package_id = v_package_id and status = 'draft'
  ) then
    raise exception 'a draft is already open; the price seed does not publish it';
  end if;

  select v.id into v_existing
  from public.billing_package_versions v
  where v.package_id = v_package_id
    and v.status = 'published'
    and v.monthly_price_kes = p_monthly
    and v.message_credits = p_credits
    and v.minutes = p_minutes
    and v.seats = p_seats
  order by v.version desc
  limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  v_draft := (public.admin_draft_package_version(p_sku, 'package-seed', v_reason) ->> 'version_id')::uuid;
  select * into v_row from public.billing_package_versions where id = v_draft;
  v_seats := coalesce(p_seats, v_row.seats);
  v_dids := coalesce(p_dids, v_row.dids);
  if p_inbound_per_minute is null then
    v_inbound := v_row.inbound_kes_per_second;
  else
    v_inbound := pg_temp.owner_kes_per_second(p_inbound_per_minute);
  end if;
  v_outbound := pg_temp.owner_kes_per_second(34);
  if p_sku = 'trial' and (v_row.seats is distinct from 2 or v_row.dids is distinct from 1) then
    raise exception 'trial seats or numbers changed from the copied version; the owner table did not set them';
  end if;
  if p_sku = 'trial' and v_inbound is distinct from 0.10 then
    raise exception 'trial inbound changed from the copied rate; the owner table did not set it';
  end if;

  select jsonb_agg(
    jsonb_build_object('key', f.feature_key, 'enabled', f.enabled)
    order by f.feature_key
  )
  into v_features
  from public.billing_package_version_features f
  where f.package_version_id = v_draft;

  v_patch := jsonb_build_object(
    'monthly_price_kes', p_monthly,
    'seats', v_seats,
    'minutes', p_minutes,
    'message_credits', p_credits,
    'sms_credit_burn', 1,
    'whatsapp_credit_burn', 2,
    'email_credit_burn', 1,
    'dids', v_dids,
    'inbound_kes_per_second', v_inbound,
    'outbound_kes_per_second', v_outbound,
    'annual_discount_percent', p_discount,
    'allowances_placeholder', false,
    'on_demand_allowed', p_on_demand,
    'notes', p_notes,
    'features', v_features
  );
  if p_trial_days is null then
    v_patch := v_patch || jsonb_build_object('trial_days', 'null'::jsonb);
  else
    v_patch := v_patch || jsonb_build_object('trial_days', p_trial_days);
  end if;

  perform public.admin_update_package_version_draft(v_draft, v_patch, 'package-seed', v_reason);
  perform public.admin_publish_package_version(v_draft, now(), 'package-seed', v_reason);
  return v_draft;
end;
$$;

do $$
declare
  v_id uuid;
  v_row public.billing_package_versions%rowtype;
  v_source public.billing_package_versions%rowtype;
  v_sku text;
  v_annual numeric;
  v_expect_annual numeric;
  v_expect_inbound numeric;
  v_expect_outbound numeric;
  v_invoice_count integer;
begin
  if not coalesce(
    (select package_editor_enabled from public.billing_lifecycle_settings where id = 1),
    false
  ) then
    raise exception 'package editor is off; price seed refused';
  end if;
  if (select price_change_approval_threshold_kes from public.billing_lifecycle_settings where id = 1) is not null then
    raise exception 'price approval is on; seed does not approve itself';
  end if;
  if round(7000 * 12 * (1 - 17::numeric / 100)) <> 69720
     or round(18000 * 12 * (1 - 10::numeric / 100)) <> 194400
     or round(35000 * 12 * (1 - 10::numeric / 100)) <> 378000
     or pg_temp.owner_kes_per_second(26) <> 0.43333
     or pg_temp.owner_kes_per_second(25) <> 0.41667
     or pg_temp.owner_kes_per_second(24) <> 0.40000
     or pg_temp.owner_kes_per_second(34) <> 0.56667
  then
    raise exception 'owner price math does not match the locked table';
  end if;

  create temp table owner_price_seed_pins on commit drop as
  select tenant_id, package_version_id
  from public.tenant_subscriptions;

  create temp table owner_price_seed_beta on commit drop as
  select
    t.id as tenant_id,
    t.billing_enforcement,
    s.billing_status,
    s.package_id,
    s.package_version_id
  from public.tenants t
  left join public.tenant_subscriptions s on s.tenant_id = t.id;

  select count(*) into v_invoice_count from public.invoices;

  create temp table owner_price_seed_ids (
    sku text primary key,
    version_id uuid not null
  ) on commit drop;

  v_id := pg_temp.seed_owner_price(
    'starter', 7000, 17, 3, 300, 1, 1000, 26, true, null::integer,
    'Owner price table, ex-VAT.'
  );
  insert into owner_price_seed_ids values ('starter', v_id);
  v_id := pg_temp.seed_owner_price(
    'growth', 18000, 10, 8, 800, 1, 2500, 25, true, null::integer,
    'Owner price table, ex-VAT.'
  );
  insert into owner_price_seed_ids values ('growth', v_id);
  v_id := pg_temp.seed_owner_price(
    'scale', 35000, 10, 20, 1600, 1, 5500, 24, true, null::integer,
    'Owner price table, ex-VAT.'
  );
  insert into owner_price_seed_ids values ('scale', v_id);
  v_id := pg_temp.seed_owner_price(
    'trial', 0, 0, 2, 20, 1, 70, null, false, 14,
    'Owner price table, ex-VAT. On-demand locked off.'
  );
  insert into owner_price_seed_ids values ('trial', v_id);

  v_expect_outbound := pg_temp.owner_kes_per_second(34);
  for v_sku, v_expect_annual, v_expect_inbound in
    select * from (values
      ('starter'::text, 69720::numeric, pg_temp.owner_kes_per_second(26)),
      ('growth', 194400::numeric, pg_temp.owner_kes_per_second(25)),
      ('scale', 378000::numeric, pg_temp.owner_kes_per_second(24)),
      ('trial', 0::numeric, 0.10::numeric)
    ) as t(sku, annual, inbound)
  loop
    select v.* into v_row
    from public.billing_package_versions v
    join owner_price_seed_ids i on i.version_id = v.id
    where i.sku = v_sku;
    select * into v_source from public.billing_package_versions where id = v_row.copied_from_id;
    v_annual := round(v_row.monthly_price_kes * 12 * (1 - v_row.annual_discount_percent / 100));
    if v_row.status <> 'published'
       or v_annual <> v_expect_annual
       or v_row.inbound_kes_per_second is distinct from v_expect_inbound
       or v_row.outbound_kes_per_second is distinct from v_expect_outbound
       or v_row.sms_credit_burn is distinct from 1
       or v_row.whatsapp_credit_burn is distinct from 2
       or v_row.email_credit_burn is distinct from 1
       or v_row.sms_kes is distinct from 1
       or v_row.whatsapp_kes is distinct from 2
       or v_row.email_kes is distinct from 1
       or v_row.allowances_placeholder
       or v_row.dids <> 1
       or v_source.id is null
       or v_row.sms is distinct from v_source.sms
       or v_row.email is distinct from v_source.email
       or v_row.staff_wa is distinct from v_source.staff_wa
    then
      raise exception 'owner price version for % does not match the locked table', v_sku;
    end if;
    if exists (
      select feature_key, enabled
      from public.billing_package_version_features
      where package_version_id = v_row.id
      except
      select feature_key, enabled
      from public.billing_package_version_features
      where package_version_id = v_source.id
    ) or exists (
      select feature_key, enabled
      from public.billing_package_version_features
      where package_version_id = v_source.id
      except
      select feature_key, enabled
      from public.billing_package_version_features
      where package_version_id = v_row.id
    ) then
      raise exception 'owner price seed changed features for %', v_sku;
    end if;
    if public.billing_latest_package_version(v_row.package_id) is distinct from v_row.id then
      raise exception 'new signups would not pin to the owner price version for %', v_sku;
    end if;
    if exists (
      select 1 from public.tenant_subscriptions
      where package_version_id = v_row.id
    ) then
      raise exception 'owner price seed pinned a business on %', v_sku;
    end if;
  end loop;

  if (select on_demand_allowed from public.billing_package_versions v
      join owner_price_seed_ids i on i.version_id = v.id where i.sku = 'trial')
     or not (select on_demand_allowed from public.billing_package_versions v
      join owner_price_seed_ids i on i.version_id = v.id where i.sku = 'starter')
     or (select trial_days from public.billing_package_versions v
      join owner_price_seed_ids i on i.version_id = v.id where i.sku = 'trial') <> 14
     or (select trial_days from public.billing_package_versions v
      join owner_price_seed_ids i on i.version_id = v.id where i.sku = 'starter') is not null
     or (select message_credits from public.billing_package_versions v
      join owner_price_seed_ids i on i.version_id = v.id where i.sku = 'starter') <> 1000
     or (select message_credits from public.billing_package_versions v
      join owner_price_seed_ids i on i.version_id = v.id where i.sku = 'growth') <> 2500
     or (select message_credits from public.billing_package_versions v
      join owner_price_seed_ids i on i.version_id = v.id where i.sku = 'scale') <> 5500
     or (select message_credits from public.billing_package_versions v
      join owner_price_seed_ids i on i.version_id = v.id where i.sku = 'trial') <> 70
     or (select seats from public.billing_package_versions v
      join owner_price_seed_ids i on i.version_id = v.id where i.sku = 'scale') <> 20
     or (select minutes from public.billing_package_versions v
      join owner_price_seed_ids i on i.version_id = v.id where i.sku = 'scale') <> 1600
  then
    raise exception 'owner price allowances do not match the locked table';
  end if;

  -- Version 1 stays the previous published row.
  if exists (
    select 1
    from public.billing_package_versions v
    join public.billing_packages p on p.id = v.package_id
    where v.version = 1
      and (
        v.message_credits is not null
        or not v.on_demand_allowed
        or (p.sku = 'starter' and (v.monthly_price_kes <> 5000 or v.minutes <> 300 or v.seats <> 2))
        or (p.sku = 'growth' and (v.monthly_price_kes <> 12000 or v.minutes <> 800 or v.seats <> 5))
        or (p.sku = 'scale' and (v.monthly_price_kes <> 25000 or v.minutes <> 2000 or v.seats <> 10))
        or (p.sku = 'trial' and (
          v.monthly_price_kes <> 0 or v.minutes <> 20 or v.trial_days <> 14
          or not v.allowances_placeholder or v.sms <> 20 or v.email <> 30
        ))
      )
  ) then
    raise exception 'owner price seed rewrote version 1';
  end if;

  if exists (
    select 1
    from public.tenant_subscriptions s
    join owner_price_seed_pins pin on pin.tenant_id = s.tenant_id
    where s.package_version_id is distinct from pin.package_version_id
  ) or (select count(*) from public.tenant_subscriptions) <> (select count(*) from owner_price_seed_pins)
  then
    raise exception 'owner price seed moved a business';
  end if;

  if exists (
    select 1
    from public.tenants t
    left join public.tenant_subscriptions s on s.tenant_id = t.id
    join owner_price_seed_beta b on b.tenant_id = t.id
    where t.billing_enforcement is distinct from b.billing_enforcement
       or s.billing_status is distinct from b.billing_status
       or s.package_id is distinct from b.package_id
       or s.package_version_id is distinct from b.package_version_id
  ) or (select count(*) from public.tenants) <> (select count(*) from owner_price_seed_beta)
     or (select count(*) from public.invoices) is distinct from v_invoice_count
  then
    raise exception 'owner price seed changed billing mode or created an invoice';
  end if;

  if exists (select 1 from public.billing_package_versions where status = 'draft') then
    raise exception 'owner price seed left a draft';
  end if;
  if (select count(*) from public.billing_audit_log
      where actor = 'package-seed' and action = 'publish_package_version') <> 4
     or (select count(*) from public.billing_audit_log
      where actor = 'package-seed' and action = 'move_package_version') <> 0
  then
    raise exception 'owner price seed published the wrong number of versions';
  end if;

  if not exists (
    select 1 from public.billing_packages
    where sku = 'starter' and monthly_price_kes = 5000 and seats = 2 and minutes = 300 and dids = 1
  ) or not exists (
    select 1 from public.billing_packages
    where sku = 'growth' and monthly_price_kes = 12000 and seats = 5 and minutes = 800 and dids = 1
  ) or not exists (
    select 1 from public.billing_packages
    where sku = 'scale' and monthly_price_kes = 25000 and seats = 10 and minutes = 2000 and dids = 1
  ) or not exists (
    select 1 from public.billing_packages
    where sku = 'trial' and monthly_price_kes = 0 and is_active = false and seats = 2 and dids = 1
  ) or not exists (
    select 1 from public.billing_rate_card
    where id = 1
      and inbound_kes_per_second = 0.10
      and outbound_kes_per_second = 0.15
      and whatsapp_kes = 2
      and sms_kes = 1
      and email_kes = 1
      and annual_discount_percent = 17
  ) then
    raise exception 'owner price seed changed the live catalogue';
  end if;
  if coalesce((select new_signup_trial_enabled from public.billing_lifecycle_settings where id = 1), true) then
    raise exception 'owner price seed turned on new signup trial';
  end if;
end $$;
