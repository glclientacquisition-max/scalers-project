-- tenant_field_provenance.sql
-- GIGO BI P0: provenance sidecar, audit history, completeness score, hold gate.
-- Run after: product_catalog_and_social.sql (knowledge / catalog era).
-- Do NOT apply to production ALCR until reviewed. Idempotent re-runs safe.
--
-- Open decision: bulk backfill owner vs seed for existing tenant values is NOT
-- done here (except FAQ status/source demotion). Completeness treats missing
-- meta on a populated field as transitional import weight (50%) — see
-- docs/platform/TENANT_FIELD_PROVENANCE.md.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_field_meta (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  field_path text not null,
  source text not null,
  source_ref text,
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  last_verified_at timestamptz,
  confidence numeric(4, 3),
  stale_after_days integer,
  updated_at timestamptz not null default now(),
  constraint tenant_field_meta_pkey primary key (tenant_id, field_path),
  constraint tenant_field_meta_source_check check (
    source in ('owner', 'seed', 'import', 'inferred', 'call_suggested')
  ),
  constraint tenant_field_meta_confidence_check check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  )
);

create index if not exists tenant_field_meta_tenant_idx
  on public.tenant_field_meta (tenant_id);

comment on table public.tenant_field_meta is
  'Provenance envelope per tenant field_path. Values stay on tenants columns; meta tags source.';

create table if not exists public.tenant_field_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  field_path text not null,
  actor text not null default 'system',
  source text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create index if not exists tenant_field_history_tenant_created_idx
  on public.tenant_field_history (tenant_id, created_at desc);

comment on table public.tenant_field_history is
  'Append-only audit for tenant_field_meta and envelope changes. Inserts via RPC only.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.tenant_field_meta enable row level security;
alter table public.tenant_field_history enable row level security;

drop policy if exists tenant_field_meta_select_member on public.tenant_field_meta;
create policy tenant_field_meta_select_member
  on public.tenant_field_meta
  for select
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists tenant_field_meta_insert_member on public.tenant_field_meta;
create policy tenant_field_meta_insert_member
  on public.tenant_field_meta
  for insert
  to authenticated
  with check (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists tenant_field_meta_update_member on public.tenant_field_meta;
create policy tenant_field_meta_update_member
  on public.tenant_field_meta
  for update
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists tenant_field_history_select_member on public.tenant_field_history;
create policy tenant_field_history_select_member
  on public.tenant_field_history
  for select
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

-- No authenticated INSERT on history (RPC only). service_role bypasses RLS.

grant select on public.tenant_field_meta to authenticated;
grant insert, update on public.tenant_field_meta to authenticated;
grant select on public.tenant_field_history to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public._tenant_field_source_weight(p_source text)
returns numeric
language sql
immutable
as $$
  select case coalesce(lower(trim(p_source)), '')
    when 'owner' then 1.0
    when 'import' then 0.5
    else 0.0
  end;
$$;

create or replace function public._tenant_field_meta_source(
  p_tenant_id uuid,
  p_field_path text
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.source
  from public.tenant_field_meta m
  where m.tenant_id = p_tenant_id
    and m.field_path = p_field_path
  limit 1;
$$;

create or replace function public._tenant_field_score(
  p_tenant_id uuid,
  p_field_path text,
  p_has_value boolean
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_source text;
begin
  if not coalesce(p_has_value, false) then
    return 0;
  end if;

  select m.source into v_source
  from public.tenant_field_meta m
  where m.tenant_id = p_tenant_id
    and m.field_path = p_field_path
  limit 1;

  if v_source is null then
    -- Transitional: legacy rows without meta (backfill TBD).
    return 0.5;
  end if;

  return public._tenant_field_source_weight(v_source);
end;
$$;

create or replace function public._tenant_assert_member(p_tenant_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_tenant_id is null then
    raise exception 'tenant required';
  end if;
  if auth.uid() is not null
     and not exists (
       select 1
       from public.tenant_members tm
       where tm.tenant_id = p_tenant_id
         and tm.user_id = auth.uid()
     ) then
    raise exception 'forbidden';
  end if;
end;
$$;

create or replace function public._tenant_append_field_history(
  p_tenant_id uuid,
  p_field_path text,
  p_actor text,
  p_source text,
  p_old_value jsonb,
  p_new_value jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tenant_field_history (
    tenant_id,
    field_path,
    actor,
    source,
    old_value,
    new_value
  ) values (
    p_tenant_id,
    p_field_path,
    coalesce(nullif(trim(p_actor), ''), 'system'),
    p_source,
    p_old_value,
    p_new_value
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: upsert_tenant_field_meta
-- ---------------------------------------------------------------------------
create or replace function public.upsert_tenant_field_meta(
  p_tenant_id uuid,
  p_field_path text,
  p_source text,
  p_source_ref text default null,
  p_confidence numeric default null,
  p_stale_after_days integer default null,
  p_actor text default 'system',
  p_old_value jsonb default null,
  p_new_value jsonb default null
)
returns public.tenant_field_meta
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text := trim(coalesce(p_field_path, ''));
  v_source text := lower(trim(coalesce(p_source, '')));
  v_row public.tenant_field_meta;
  v_prev public.tenant_field_meta;
begin
  perform public._tenant_assert_member(p_tenant_id);

  if v_path = '' then
    raise exception 'field_path required';
  end if;
  if v_source not in ('owner', 'seed', 'import', 'inferred', 'call_suggested') then
    raise exception 'invalid source';
  end if;

  select * into v_prev
  from public.tenant_field_meta m
  where m.tenant_id = p_tenant_id
    and m.field_path = v_path;

  insert into public.tenant_field_meta as m (
    tenant_id,
    field_path,
    source,
    source_ref,
    confidence,
    stale_after_days,
    updated_at
  ) values (
    p_tenant_id,
    v_path,
    v_source,
    nullif(trim(coalesce(p_source_ref, '')), ''),
    p_confidence,
    p_stale_after_days,
    now()
  )
  on conflict (tenant_id, field_path) do update
    set source = excluded.source,
        source_ref = coalesce(excluded.source_ref, m.source_ref),
        confidence = coalesce(excluded.confidence, m.confidence),
        stale_after_days = coalesce(excluded.stale_after_days, m.stale_after_days),
        updated_at = now()
  returning * into v_row;

  if v_prev is null
     or v_prev.source is distinct from v_row.source
     or v_prev.source_ref is distinct from v_row.source_ref then
    perform public._tenant_append_field_history(
      p_tenant_id,
      v_path,
      p_actor,
      v_row.source,
      coalesce(p_old_value, to_jsonb(v_prev)),
      coalesce(p_new_value, to_jsonb(v_row))
    );
  end if;

  return v_row;
end;
$$;

revoke all on function public.upsert_tenant_field_meta(uuid, text, text, text, numeric, integer, text, jsonb, jsonb) from public;
grant execute on function public.upsert_tenant_field_meta(uuid, text, text, text, numeric, integer, text, jsonb, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RPC: confirm_tenant_field
-- ---------------------------------------------------------------------------
create or replace function public.confirm_tenant_field(
  p_tenant_id uuid,
  p_field_path text,
  p_user_id uuid default null
)
returns public.tenant_field_meta
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_path text := trim(coalesce(p_field_path, ''));
  v_row public.tenant_field_meta;
begin
  perform public._tenant_assert_member(p_tenant_id);
  if v_path = '' then
    raise exception 'field_path required';
  end if;
  if v_uid is null then
    raise exception 'user required';
  end if;

  insert into public.tenant_field_meta as m (
    tenant_id,
    field_path,
    source,
    confirmed_by,
    confirmed_at,
    last_verified_at,
    updated_at
  ) values (
    p_tenant_id,
    v_path,
    'owner',
    v_uid,
    now(),
    now(),
    now()
  )
  on conflict (tenant_id, field_path) do update
    set source = 'owner',
        confirmed_by = v_uid,
        confirmed_at = now(),
        last_verified_at = now(),
        updated_at = now()
  returning * into v_row;

  perform public._tenant_append_field_history(
    p_tenant_id,
    v_path,
    v_uid::text,
    'owner',
    null,
    to_jsonb(v_row)
  );

  return v_row;
end;
$$;

revoke all on function public.confirm_tenant_field(uuid, text, uuid) from public;
grant execute on function public.confirm_tenant_field(uuid, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- FAQ demotion: never implicit golden; default seed + suggested
-- ---------------------------------------------------------------------------
update public.tenants t
set faqs = sub.next_faqs
from (
  select
    tt.id,
    coalesce(
      (
        select jsonb_agg(
          case
            when elem ? 'status' and elem ? 'source' then
              case
                when lower(coalesce(elem->>'status', '')) in ('golden', 'confirmed')
                     and lower(coalesce(elem->>'source', 'seed')) <> 'owner' then
                  elem
                    || jsonb_build_object('status', 'suggested')
                    || jsonb_build_object('source', coalesce(nullif(elem->>'source', ''), 'seed'))
                else elem
              end
            else
              elem
                || jsonb_build_object('status', 'suggested')
                || jsonb_build_object('source', 'seed')
          end
          order by ord
        )
        from jsonb_array_elements(coalesce(tt.faqs, '[]'::jsonb)) with ordinality as x(elem, ord)
      ),
      '[]'::jsonb
    ) as next_faqs
  from public.tenants tt
  where jsonb_array_length(coalesce(tt.faqs, '[]'::jsonb)) > 0
) sub
where t.id = sub.id
  and t.faqs is distinct from sub.next_faqs;

-- ---------------------------------------------------------------------------
-- Completeness + hold gate internals
-- ---------------------------------------------------------------------------
create or replace function public._tenant_has_structured_hours(p_schedule jsonb)
returns boolean
language sql
immutable
as $$
  select exists (
    select 1
    from jsonb_each(coalesce(p_schedule -> 'days', '{}'::jsonb)) d(key, val)
    where val ? 'open'
  );
$$;

create or replace function public._tenant_catalog_product_score(
  p_tenant_id uuid,
  p_catalog jsonb,
  p_is_retail boolean
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
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
  if v_named >= 1 then
    return least(60, (v_scored / greatest(v_named, 1)) * 60);
  end if;
  return 0;
end;
$$;

create or replace function public._tenant_catalog_service_score(
  p_tenant_id uuid,
  p_catalog jsonb,
  p_is_home boolean
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_idx integer := 0;
  v_ok integer := 0;
  v_scored numeric := 0;
  v_has_pricing boolean;
  v_has_site boolean;
begin
  if not p_is_home then
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
    v_has_pricing :=
      coalesce(trim(v_item ->> 'price'), '') <> ''
      or coalesce(trim(v_item ->> 'pricing_mode'), '') <> '';
    v_has_site :=
      (v_item ? 'site_visit_required')
      or coalesce(trim(v_item ->> 'site_visit_required'), '') in ('true', 'false', 'yes', 'no');
    if v_has_pricing and v_has_site then
      v_ok := v_ok + 1;
      v_scored := v_scored + public._tenant_field_score(
        p_tenant_id,
        'catalog.service.' || v_idx::text || '.name',
        true
      );
    end if;
  end loop;

  if v_ok >= 3 then
    return least(100, (v_scored / v_ok) * 100);
  end if;
  if v_ok >= 1 then
    return least(50, (v_scored / v_ok) * 50);
  end if;
  return 0;
end;
$$;

create or replace function public._tenant_faq_confirmed_count(p_faqs jsonb)
returns integer
language sql
immutable
as $$
  select count(*)::integer
  from jsonb_array_elements(coalesce(p_faqs, '[]'::jsonb)) elem
  where coalesce(trim(elem ->> 'question'), '') <> ''
    and coalesce(trim(elem ->> 'answer'), '') <> ''
    and lower(coalesce(elem ->> 'status', '')) in ('confirmed', 'golden')
    and lower(coalesce(elem ->> 'source', '')) = 'owner';
$$;

create or replace function public._tenant_has_verified_notify(t public.tenants)
returns boolean
language plpgsql
stable
as $$
declare
  v_channels jsonb := coalesce(t.notify_channels, '{}'::jsonb);
  v_whatsapp_ok boolean := false;
  v_sms_ok boolean := false;
  v_email_ok boolean := false;
begin
  if coalesce(trim(t.whatsapp_notification_number), '') <> '' then
    v_whatsapp_ok := coalesce((v_channels ->> 'whatsapp')::boolean, true);
  end if;
  if coalesce(trim(t.alert_email), '') <> '' then
    v_email_ok := coalesce((v_channels ->> 'email')::boolean, true);
  end if;
  v_sms_ok :=
    coalesce(trim(t.whatsapp_notification_number), '') <> ''
    and coalesce((v_channels ->> 'sms')::boolean, true);

  if exists (
    select 1
    from public.tenant_field_meta m
    where m.tenant_id = t.id
      and m.field_path = 'team.notify.whatsapp'
      and m.source = 'owner'
  ) then
    return true;
  end if;

  return v_whatsapp_ok or v_email_ok or v_sms_ok;
end;
$$;

create or replace function public._tenant_holds_allowed(p_tenant_id uuid, p_policies jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_meta text;
  v_holds jsonb;
  v_allowed text;
begin
  select m.source into v_meta
  from public.tenant_field_meta m
  where m.tenant_id = p_tenant_id
    and m.field_path = 'policies.holds.allowed'
  limit 1;

  v_holds := coalesce(p_policies -> 'holds', p_policies -> 'other' -> 'holds', '{}'::jsonb);
  v_allowed := lower(trim(coalesce(v_holds ->> 'allowed', p_policies ->> 'holds_allowed', '')));

  if v_allowed in ('yes', 'true', '1') then
    return true;
  end if;
  if v_allowed in ('no', 'false', '0') then
    return false;
  end if;

  if v_meta = 'owner' then
    return true;
  end if;

  return false;
end;
$$;

create or replace function public._tenant_owner_holdable_product(
  p_tenant_id uuid,
  p_catalog jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_idx integer := 0;
  v_sku text;
  v_holdable boolean;
  v_source text;
begin
  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_catalog, '[]'::jsonb))
  loop
    v_idx := v_idx + 1;
    if coalesce(trim(v_item ->> 'name'), '') = '' then
      continue;
    end if;
    v_holdable :=
      lower(coalesce(v_item ->> 'holdable', 'false')) in ('true', 'yes', '1')
      or (v_item -> 'holdable') = 'true'::jsonb;
    if not v_holdable then
      continue;
    end if;
    v_sku := coalesce(nullif(trim(v_item ->> 'sku'), ''), v_idx::text);
    select m.source into v_source
    from public.tenant_field_meta m
    where m.tenant_id = p_tenant_id
      and m.field_path = 'catalog.product.' || v_sku || '.name'
    limit 1;
    if v_source = 'owner' then
      return true;
    end if;
    if v_source is null then
      -- Legacy catalog without meta: not hold-gate eligible (seed-safe).
      continue;
    end if;
  end loop;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: tenant_completeness_score
-- ---------------------------------------------------------------------------
create or replace function public.tenant_completeness_score(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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

  v_identity := (
    public._tenant_field_score(p_tenant_id, 'identity.business_name', coalesce(trim(t.business_name), '') <> '')
    + public._tenant_field_score(p_tenant_id, 'identity.vertical', coalesce(trim(t.vertical), '') <> '')
    + public._tenant_field_score(p_tenant_id, 'identity.primary_phone', coalesce(trim(t.sautikit_virtual_number), '') <> '')
    + public._tenant_field_score(
        p_tenant_id,
        'identity.language',
        coalesce(array_length(t.voice_languages, 1), 0) > 0
          or coalesce(trim(t.agent_name), '') <> ''
      )
  ) / 4.0 * 100;

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
      or jsonb_array_length(coalesce(t.business_policies -> 'coverage_areas', '[]'::jsonb)) > 0
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

  v_faq_n := public._tenant_faq_confirmed_count(t.faqs);
  v_faqs := least(100, (v_faq_n::numeric / 3.0) * 100);

  v_team := public._tenant_field_score(
    p_tenant_id,
    'team.notify',
    public._tenant_has_verified_notify(t)
  ) * 100;

  v_assistant := (
    public._tenant_field_score(p_tenant_id, 'assistant.agent_name', coalesce(trim(t.agent_name), '') <> '')
    + public._tenant_field_score(p_tenant_id, 'assistant.language', coalesce(trim(t.agent_tone), '') <> '' or t.agent_tools is not null)
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
    and v_faq_n >= 1
    and public._tenant_has_verified_notify(t)
    and v_catalog >= 40
    and not exists (
      select 1
      from public.tenant_field_meta m
      where m.tenant_id = p_tenant_id
        and m.source = 'seed'
        and m.field_path like 'identity.%'
    );

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
$$;

revoke all on function public.tenant_completeness_score(uuid) from public;
grant execute on function public.tenant_completeness_score(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RPC: tenant_hold_gate
-- ---------------------------------------------------------------------------
create or replace function public.tenant_hold_gate(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t public.tenants;
  v_reasons text[] := '{}'::text[];
  v_allowed boolean := false;
begin
  if p_tenant_id is null then
    raise exception 'tenant required';
  end if;

  select * into t from public.tenants where id = p_tenant_id;
  if not found then
    raise exception 'tenant not found';
  end if;

  if not public._tenant_holds_allowed(p_tenant_id, t.business_policies) then
    v_reasons := array_append(v_reasons, 'Holds are not enabled in policies.');
  end if;

  if not public._tenant_owner_holdable_product(p_tenant_id, t.product_catalog) then
    v_reasons := array_append(
      v_reasons,
      'Need at least one holdable product with owner provenance in the catalog.'
    );
  end if;

  if not public._tenant_has_verified_notify(t) then
    v_reasons := array_append(
      v_reasons,
      'Need a verified notify target (WhatsApp or email alerts).'
    );
  end if;

  v_allowed := coalesce(array_length(v_reasons, 1), 0) = 0;

  return jsonb_build_object(
    'allowed', v_allowed,
    'reasons', to_jsonb(v_reasons)
  );
end;
$$;

revoke all on function public.tenant_hold_gate(uuid) from public;
grant execute on function public.tenant_hold_gate(uuid) to authenticated, service_role;

comment on function public.tenant_completeness_score(uuid) is
  'GIGO P0: 10-domain completeness (0-100), ready_badge, next_gaps. Seeds score 0 via meta.';
comment on function public.tenant_hold_gate(uuid) is
  'GIGO P0: outcome gate for place_hold — policies, owner holdable SKU, notify target.';
