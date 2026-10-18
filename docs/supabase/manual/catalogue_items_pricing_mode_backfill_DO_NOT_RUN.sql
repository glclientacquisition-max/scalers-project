-- Manual backfill: parse legacy price text into pricing_mode / price / price_max on catalogue_items.
-- Logic mirrors dashboard/src/lib/catalogPricingMode.ts (parseCataloguePriceText).
--
-- Run on staging first. Requires migration 20261018240000_catalogue_items_pricing_mode.sql.
-- DO NOT run in CI or prod without owner sign-off.

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

-- Example (commented): upsert from tenant JSON catalogues
-- insert into public.catalogue_items (tenant_id, kind, item_key, name, price, pricing_mode, price_max)
-- select t.id, 'service', coalesce(i->>'id', md5(i::text)), i->>'name',
--        coalesce(i->>'price_range', i->>'price'),
--        k.pricing_mode, k.price_max
-- from public.tenants t
-- cross join lateral jsonb_array_elements(t.services_catalog) i
-- cross join lateral public._parse_catalogue_pricing_mode(coalesce(i->>'price_range', i->>'price')) k
-- on conflict (tenant_id, kind, item_key) do update set
--   pricing_mode = excluded.pricing_mode,
--   price = excluded.price,
--   price_max = excluded.price_max;

rollback;
