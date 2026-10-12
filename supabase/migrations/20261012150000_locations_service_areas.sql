-- Locations: "Areas you serve" moves out of Policies into its own column.
--
-- tenants.service_areas = { version: 1, areas: [{ id, modes[], fee_mode, fee_ksh, eta,
--   min_order_ksh, source, confirmed }], delivered_by[], rider_paid,
--   reach deliver|visit|walk_in|both (default from the business type), no_premises }.
-- business_policies.coverage_areas stays and is kept in step by the dashboard for one release,
-- so the voice server's coverage check keeps working without a change.
-- ADDITIVE and safe to re-run. Also pins search_path on the payments/policies functions (#663).

-- 1. Column and check --------------------------------------------------------------
alter table public.tenants add column if not exists service_areas jsonb;

create or replace function public.service_areas_valid(v jsonb)
returns boolean language sql immutable as $$
  select v is null or jsonb_typeof(v) = 'null' or (
    jsonb_typeof(v) = 'object'
    and jsonb_typeof(coalesce(v->'areas', '[]')) = 'array'
    and jsonb_array_length(coalesce(v->'areas', '[]')) <= 40
    and not exists (
      select 1 from jsonb_array_elements(coalesce(v->'areas', '[]')) a
      where jsonb_typeof(a) <> 'object'
         or coalesce(a->>'id', '') !~ '^(county|place):[a-z0-9 ''._-]{1,80}$'
         or coalesce(a->>'fee_mode', 'ask') not in ('free', 'fixed', 'ask')
         or (a->>'fee_ksh' is not null and (a->>'fee_ksh') !~ '^\d{1,7}$')
         or (a->>'min_order_ksh' is not null and (a->>'min_order_ksh') !~ '^\d{1,7}$')
         or coalesce(length(a->>'eta'), 0) > 40
         or exists (select 1 from jsonb_array_elements_text(coalesce(a->'modes', '[]')) m where m not in ('delivery', 'visit', 'pickup')))
    and not exists (
      select 1 from jsonb_array_elements_text(coalesce(v->'delivered_by', '[]')) b where b not in ('self', 'rider', 'courier'))
    and coalesce(v->>'rider_paid', 'in_fee') in ('in_fee', 'on_arrival')
    and coalesce(v->>'reach', 'deliver') in ('deliver', 'visit', 'walk_in', 'both')
    and coalesce(jsonb_typeof(v->'no_premises'), 'boolean') in ('boolean', 'null')
  );
$$;

do $$ begin
  alter table public.tenants add constraint tenants_service_areas_valid_chk
    check (public.service_areas_valid(service_areas));
exception when duplicate_object then null; end $$;

-- 2. Backfill from Policies coverage (fee "we confirm it", unconfirmed so the owner checks once)
update public.tenants t
   set service_areas = jsonb_build_object(
     'version', 1,
     'areas', coalesce((
       select jsonb_agg(jsonb_build_object(
         'id', lower(btrim(x.id)),
         'modes', jsonb_build_array(case when t.vertical = 'home_services' then 'visit' else 'delivery' end),
         'fee_mode', 'ask', 'fee_ksh', null, 'eta', null, 'min_order_ksh', null,
         'source', 'import', 'confirmed', false) order by x.ord)
       from (select distinct on (lower(btrim(e))) e as id, ord
               from jsonb_array_elements_text(t.business_policies->'coverage_areas') with ordinality as q(e, ord)
              where lower(btrim(e)) ~ '^(county|place):[a-z0-9 ''._-]{1,80}$'
              order by lower(btrim(e)), ord
              limit 40) x), '[]'::jsonb),
     'delivered_by', '[]'::jsonb,
     'rider_paid', null,
     'reach', case t.vertical when 'home_services' then 'visit' when 'hospitality' then 'walk_in' else 'deliver' end,
     'no_premises', false)
 where t.service_areas is null
   and jsonb_typeof(t.business_policies) = 'object'
   and jsonb_typeof(t.business_policies->'coverage_areas') = 'array';

-- 2b. Rows backfilled before reach existed (staging) get it from the business type
update public.tenants t
   set service_areas = t.service_areas
     || jsonb_build_object('reach', case t.vertical when 'home_services' then 'visit' when 'hospitality' then 'walk_in' else 'deliver' end)
 where jsonb_typeof(t.service_areas) = 'object' and not (t.service_areas ? 'reach');

-- 3. Pin search_path (advisor: function_search_path_mutable) ---------------------------
alter function public.service_areas_valid(jsonb) set search_path = public;
alter function public.payments_valid(jsonb) set search_path = public;
alter function public.policy_rules_valid(jsonb) set search_path = public;
alter function public.ke_mobile_valid(text) set search_path = public;
alter function public.ke_mobile_e164(text) set search_path = public;
alter function public.payments_to_v2(jsonb) set search_path = public;
alter function public.parse_payments_text(text) set search_path = public;
