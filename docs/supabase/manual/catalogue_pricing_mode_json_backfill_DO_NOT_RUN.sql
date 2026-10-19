-- Manual backfill: add pricing_mode / price / price_max to catalogue rows inside tenant JSON.
-- Source of truth today: public.tenants.services_catalog and public.tenants.product_catalog (jsonb arrays).
-- There is no public.catalogue_items table in applied migrations (verified 2026-10-18).
--
-- Logic mirrors dashboard/src/lib/catalogPricingMode.ts (parseCataloguePriceText).
-- DO NOT run in CI or prod without owner sign-off. Run on staging first.

begin;

create or replace function public._parse_catalogue_pricing_mode(p text)
returns table (pricing_mode text, price numeric, price_max numeric)
language plpgsql
immutable
as $$
declare
  t text := trim(coalesce(p, ''));
  lo numeric;
  hi numeric;
begin
  if t = '' or lower(t) in ('ask', 'n/a', 'tbd') then
    return query select 'quote'::text, null::numeric, null::numeric;
    return;
  end if;
  if lower(t) ~ '^from\s+' then
    lo := nullif(regexp_replace(substring(lower(t) from 'from\s+([\d,]+)'), ',', '', 'g'), '')::numeric;
    if lo is not null and lo > 0 then
      return query select 'from'::text, lo, null::numeric;
      return;
    end if;
  end if;
  if t ~ '^\s*[\d,]+\s*[-–]\s*[\d,]+\s*$' then
    lo := nullif(regexp_replace(split_part(t, '-', 1), ',', '', 'g'), '')::numeric;
    hi := nullif(regexp_replace(split_part(t, '-', 2), ',', '', 'g'), '')::numeric;
    if lo is not null and hi is not null and lo > 0 and hi >= lo then
      return query select 'range'::text, lo, hi;
      return;
    end if;
  end if;
  lo := nullif(regexp_replace(regexp_replace(t, '[^\d,]', '', 'g'), ',', '', 'g'), '')::numeric;
  if lo is not null and lo > 0 then
    return query select 'fixed'::text, lo, null::numeric;
    return;
  end if;
  return query select 'quote'::text, null::numeric, null::numeric;
end;
$$;

-- Example (commented): services — only rows missing pricing_mode
-- update public.tenants t
-- set services_catalog = sub.arr
-- from (
--   select t2.id,
--     coalesce(jsonb_agg(
--       case
--         when coalesce(trim(i->>'pricing_mode'), '') <> '' then i
--         else i || jsonb_strip_nulls(jsonb_build_object(
--           'pricing_mode', k.pricing_mode,
--           'price', k.price,
--           'price_max', k.price_max
--         ))
--       end
--     ), '[]'::jsonb) as arr
--   from public.tenants t2
--   cross join lateral jsonb_array_elements(
--     case when jsonb_typeof(t2.services_catalog) = 'array' then t2.services_catalog else '[]' end
--   ) i
--   cross join lateral public._parse_catalogue_pricing_mode(coalesce(i->>'price_range', i->>'price', '')) k
--   group by t2.id
-- ) sub
-- where sub.id = t.id;

-- Example (commented): products — sets pricing_mode and price_mode
-- update public.tenants t
-- set product_catalog = sub.arr
-- from (
--   select t2.id,
--     coalesce(jsonb_agg(
--       case
--         when coalesce(trim(i->>'pricing_mode'), trim(i->>'price_mode'), '') <> '' then i
--         else i || jsonb_strip_nulls(jsonb_build_object(
--           'pricing_mode', k.pricing_mode,
--           'price_mode', k.pricing_mode,
--           'price', k.price,
--           'price_max', k.price_max
--         ))
--       end
--     ), '[]'::jsonb) as arr
--   from public.tenants t2
--   cross join lateral jsonb_array_elements(
--     case when jsonb_typeof(t2.product_catalog) = 'array' then t2.product_catalog else '[]' end
--   ) i
--   cross join lateral public._parse_catalogue_pricing_mode(coalesce(i->>'price', i->>'price_range', '')) k
--   group by t2.id
-- ) sub
-- where sub.id = t.id;

rollback;
