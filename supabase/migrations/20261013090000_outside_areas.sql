-- Locations: "Do you go outside these areas?" No (default) | Yes, anywhere in Kenya.
-- tenants.service_areas gains anywhere_kenya (boolean) and outside_fee_ksh (whole KSh or null:
-- the team quotes it). The dashboard mirrors it to business_policies.coverage_outside
-- = { anywhere_kenya: true, fee_ksh } for the voice server, like coverage_areas.
-- ADDITIVE: widens the check only; no data changes. Safe to re-run.

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
    and coalesce(jsonb_typeof(v->'anywhere_kenya'), 'boolean') in ('boolean', 'null')
    and (v->'outside_fee_ksh' is null or jsonb_typeof(v->'outside_fee_ksh') = 'null'
         or (v->>'outside_fee_ksh') ~ '^\d{1,7}$')
  );
$$;
