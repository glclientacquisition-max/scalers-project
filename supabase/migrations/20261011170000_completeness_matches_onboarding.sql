-- Completeness that matches what onboarding saves (Oct 2026 live test: a fully onboarded
-- home-services workspace showed Assistant 33%, Catalogue 50%, Identity 25%).
--  * One confirmed priced item = full catalogue (products and services).
--  * Identity ignores a line number that is still pending (ours to assign).
--  * Assistant accepts the tone confirmation onboarding writes (and onboarding now attests tools).
--  * Home services: policies are call-out / cancellation / guarantee, not returns + delivery.
-- Applied to staging (sgcdncjxauhsbunobmob) 11 Oct 2026. Not applied to production.

create or replace function public._tenant_number_assigned(p_number text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(trim(p_number), '') <> '' and coalesce(trim(p_number), '') !~* '^pending';
$$;

create or replace function public._tenant_catalog_service_score(p_tenant_id uuid, p_catalog jsonb, p_is_home boolean)
 returns numeric
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_item jsonb;
  v_idx integer := 0;
  v_ok integer := 0;
  v_scored numeric := 0;
begin
  if not p_is_home then
    return 0;
  end if;
  for v_item in select value from jsonb_array_elements(coalesce(p_catalog, '[]'::jsonb)) loop
    v_idx := v_idx + 1;
    if coalesce(trim(v_item ->> 'name'), '') = '' then
      continue;
    end if;
    if (coalesce(trim(v_item ->> 'price'), '') <> ''
          or coalesce(trim(v_item ->> 'price_range'), '') <> ''
          or coalesce(trim(v_item ->> 'pricing_mode'), '') <> '')
       and ((v_item ? 'site_visit_required')
          or coalesce(trim(v_item ->> 'site_visit_required'), '') in ('true', 'false', 'yes', 'no')) then
      v_ok := v_ok + 1;
      v_scored := v_scored + public._tenant_field_score(p_tenant_id, 'catalog.service.' || v_idx::text || '.name', true);
    end if;
  end loop;
  -- One confirmed, priced service is a complete catalogue (owner decision, Oct 2026).
  if v_ok >= 1 then
    return least(100, (v_scored / v_ok) * 100);
  end if;
  return 0;
end;
$function$;

CREATE OR REPLACE FUNCTION public._tenant_catalog_product_score(p_tenant_id uuid, p_catalog jsonb, p_is_retail boolean)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item jsonb;
  v_idx integer := 0;
  v_named integer := 0;
  v_scored numeric := 0;
  v_categories text[] := '{}'::text[];
  v_cat text;
  v_path text;
  v_sku text;
begin
  if not p_is_retail then
    return 0;
  end if;

  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_catalog, '[]'::jsonb))
  loop
    v_idx := v_idx + 1;
    if coalesce(trim(v_item ->> 'name'), '') = '' then
      continue;
    end if;
    v_named := v_named + 1;
    v_sku := coalesce(nullif(trim(v_item ->> 'sku'), ''), v_idx::text);
    v_path := 'catalog.product.' || v_sku || '.name';
    v_scored := v_scored + public._tenant_field_score(
      p_tenant_id,
      v_path,
      true
    );
    v_cat := lower(trim(coalesce(v_item ->> 'category', '')));
    if v_cat <> '' and not v_cat = any (v_categories) then
      v_categories := array_append(v_categories, v_cat);
    end if;
  end loop;

  if v_named >= 10 then
    return least(100, (v_scored / greatest(v_named, 1)) * 100);
  end if;
  if array_length(v_categories, 1) >= 3 and v_named >= 1 then
    return least(100, (v_scored / greatest(v_named, 1)) * 100 * 0.85);
  end if;
  -- One confirmed, priced item is a complete catalogue (owner decision, Oct 2026).
  if v_named >= 1 then
    return least(100, (v_scored / greatest(v_named, 1)) * 100);
  end if;
  return 0;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tenant_completeness_score(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t public.tenants;
  v_vertical text;
  v_is_retail boolean;
  v_is_home boolean;
  v_identity numeric := 0;
  v_catalog numeric := 0;
  v_hours numeric := 0;
  v_locations numeric := 0;
  v_payments numeric := 0;
  v_policies numeric := 0;
  v_faqs numeric := 0;
  v_team numeric := 0;
  v_assistant numeric := 0;
  v_bulletin numeric := 0;
  v_overall numeric := 0;
  v_ready boolean := false;
  v_any_owner boolean := false;
  v_gaps jsonb := '[]'::jsonb;
  v_domains jsonb;
  v_faq_n integer;
begin
  if p_tenant_id is null then
    raise exception 'tenant required';
  end if;

  select * into t from public.tenants where id = p_tenant_id;
  if not found then
    raise exception 'tenant not found';
  end if;

  v_vertical := lower(coalesce(t.vertical, 'general'));
  v_is_retail := v_vertical in ('retail', 'shop');
  v_is_home := v_vertical in ('home_services', 'home');

  -- Identity: the line number is ours to assign, so a pending number is not counted against the owner.
  v_identity := (
    public._tenant_field_score(p_tenant_id, 'identity.business_name', coalesce(trim(t.business_name), '') <> '')
    + public._tenant_field_score(p_tenant_id, 'identity.vertical', coalesce(trim(t.vertical), '') <> '')
    + greatest(
        public._tenant_field_score(p_tenant_id, 'identity.language',
          coalesce(array_length(t.voice_languages, 1), 0) > 0 or coalesce(trim(t.agent_name), '') <> ''),
        public._tenant_field_score(p_tenant_id, 'assistant.agent_name', coalesce(trim(t.agent_name), '') <> '')
      )
    + case when public._tenant_number_assigned(t.sautikit_virtual_number)
        then public._tenant_field_score(p_tenant_id, 'identity.primary_phone', true) else 0 end
  ) / (case when public._tenant_number_assigned(t.sautikit_virtual_number) then 4.0 else 3.0 end) * 100;

  v_catalog := greatest(
    public._tenant_catalog_product_score(p_tenant_id, t.product_catalog, v_is_retail),
    public._tenant_catalog_service_score(p_tenant_id, t.services_catalog, v_is_home)
  );
  if not v_is_retail and not v_is_home then
    v_catalog := greatest(
      public._tenant_catalog_product_score(p_tenant_id, t.product_catalog, true),
      public._tenant_catalog_service_score(p_tenant_id, t.services_catalog, true)
    ) * 0.5;
  end if;

  v_hours := public._tenant_field_score(
    p_tenant_id,
    'hours.weekly_grid',
    public._tenant_has_structured_hours(t.hours_schedule)
      or coalesce(trim(t.business_hours), '') <> ''
  ) * 100;

  v_locations := public._tenant_field_score(
    p_tenant_id,
    'locations.branches',
    jsonb_array_length(coalesce(t.business_locations, '[]'::jsonb)) > 0
      or coalesce(trim(t.business_policies ->> 'coverage_areas'), '') <> ''
      or (
        jsonb_typeof(t.business_policies -> 'coverage_areas') = 'array'
        and jsonb_array_length(t.business_policies -> 'coverage_areas') > 0
      )
  ) * 100;

  v_payments := (
    public._tenant_field_score(
      p_tenant_id,
      'policies.payment',
      coalesce(trim(t.business_policies ->> 'payment'), '') <> ''
        or coalesce(trim(t.business_policies ->> 'deposit'), '') <> ''
    )
    + public._tenant_field_score(
        p_tenant_id,
        'payments.methods',
        coalesce(trim(t.business_policies ->> 'payment'), '') <> ''
      )
  ) / 2.0 * 100;

  if v_is_home then
    -- Home services: no returns or delivery. Call-out, cancellation or guarantee terms.
    v_policies := greatest(
      public._tenant_field_score(p_tenant_id, 'policies.other', coalesce(trim(t.business_policies ->> 'other'), '') <> ''),
      public._tenant_field_score(p_tenant_id, 'policies.cancellation', coalesce(trim(t.business_policies ->> 'cancellation'), '') <> ''),
      public._tenant_field_score(p_tenant_id, 'policies.warranty', coalesce(trim(t.business_policies ->> 'warranty'), '') <> '')
    ) * 100;
  else
  v_policies := (
    public._tenant_field_score(
      p_tenant_id,
      'policies.returns',
      coalesce(trim(t.business_policies ->> 'returns'), '') <> ''
    )
    + public._tenant_field_score(
        p_tenant_id,
        'policies.delivery',
        coalesce(trim(t.business_policies ->> 'delivery'), '') <> ''
    )
    + public._tenant_field_score(
        p_tenant_id,
        'policies.other',
        coalesce(trim(t.business_policies ->> 'other'), '') <> ''
          or coalesce(trim(t.business_policies ->> 'warranty'), '') <> ''
      )
  ) / 3.0 * 100;
  end if;

  v_faq_n := public._tenant_faq_confirmed_count(t.faqs);
  v_faqs := least(100, (v_faq_n::numeric / 3.0) * 100);

  v_team := greatest(
    public._tenant_field_score(
      p_tenant_id,
      'team.notify.whatsapp',
      coalesce(trim(t.whatsapp_notification_number), '') <> ''
    ),
    public._tenant_field_score(
      p_tenant_id,
      'team.notify.email',
      coalesce(trim(t.alert_email), '') <> ''
    )
  ) * 100;

  v_assistant := (
    public._tenant_field_score(p_tenant_id, 'assistant.agent_name', coalesce(trim(t.agent_name), '') <> '')
    + greatest(
        public._tenant_field_score(p_tenant_id, 'assistant.language', coalesce(trim(t.agent_tone), '') <> '' or t.agent_tools is not null),
        public._tenant_field_score(p_tenant_id, 'assistant.tone', coalesce(trim(t.agent_tone), '') <> '')
      )
    + public._tenant_field_score(p_tenant_id, 'assistant.tools', t.agent_tools is not null)
  ) / 3.0 * 100;

  v_bulletin := public._tenant_field_score(
    p_tenant_id,
    'bulletin.items',
    jsonb_array_length(coalesce(t.daily_bulletin, '[]'::jsonb)) > 0
  ) * 100;

  v_overall := (
    v_identity + v_catalog + v_hours + v_locations + v_payments
    + v_policies + v_faqs + v_team + v_assistant + v_bulletin
  ) / 10.0;

  select exists (
    select 1
    from public.tenant_field_meta m
    where m.tenant_id = p_tenant_id
      and m.source = 'owner'
  ) into v_any_owner;

  v_ready :=
    v_overall >= 70
    and v_any_owner
    and v_faq_n >= 3
    and v_team >= 50
    and v_catalog >= 40
    and exists (
      select 1
      from public.tenant_field_meta m
      where m.tenant_id = p_tenant_id
        and m.source = 'owner'
        and m.field_path like 'team.notify.%'
    )
    and public._tenant_has_verified_notify(t);

  if v_catalog < 40 then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'domain', 'catalog',
      'action', 'Add products or services with owner-confirmed names and prices.'
    ));
  end if;
  if v_faq_n < 3 then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'domain', 'faqs',
      'action', 'Confirm at least three FAQs with owner source (not seed).'
    ));
  end if;
  if not public._tenant_has_verified_notify(t) then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'domain', 'team_notify',
      'action', 'Set a WhatsApp or email alert and confirm notify routing.'
    ));
  end if;
  if v_payments < 50 then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'domain', 'payments',
      'action', 'Add how customers pay (M-Pesa till, paybill, or cash).'
    ));
  end if;

  v_domains := jsonb_build_object(
    'identity', round(v_identity),
    'catalog', round(v_catalog),
    'hours', round(v_hours),
    'locations', round(v_locations),
    'payments', round(v_payments),
    'policies', round(v_policies),
    'faqs', round(v_faqs),
    'team_notify', round(v_team),
    'assistant', round(v_assistant),
    'bulletin', round(v_bulletin)
  );

  return jsonb_build_object(
    'overall', round(v_overall),
    'domains', v_domains,
    'ready_badge', v_ready,
    'next_gaps', v_gaps
  );
end;
$function$;
