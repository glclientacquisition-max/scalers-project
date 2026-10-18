-- DO NOT RUN automatically. Manual backfill only after review and backup.
-- Parses tenants.product_catalog and tenants.services_catalog JSON into
-- catalogue_items.price_kind / price_min / price_max (see dashboard/src/lib/catalogPriceKind.ts).
--
-- Run on staging first. Requires migration 20261018240000_catalogue_items_price_kind.sql.

begin;

-- Mirror of parseCataloguePriceText / parse_price_ksh subset.
create or replace function public._parse_catalogue_price_kind(p text)
returns table (price_kind text, price_min numeric, price_max numeric)
language plpgsql immutable as $$
declare
  t text := lower(btrim(coalesce(p, '')));
  c text;
  lo numeric; hi numeric; m text[];
  is_from boolean;
begin
  if t = '' or t ~ '^\s*(ask|call|varies|depends|tbd|on request|quote)' then
    return query select 'quote'::text, null::numeric, null::numeric;
    return;
  end if;
  c := regexp_replace(t, 'kshs?\.?|kes|/=', ' ', 'g');
  c := regexp_replace(c, '(\d),(\d{3})', '\1\2', 'g');
  is_from := t ~ '\m(from|starting|kuanzia)\M' or (t ~ '\mmin\M' and not t ~ '\mmin(?:imum)?\s+\d+\s*(?:hours?|hrs?|days?)\M');
  m := regexp_match(c, '(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)');
  if m is not null then
    lo := m[1]::numeric; hi := m[2]::numeric;
    if hi >= lo then
      return query select 'range'::text, lo, hi;
      return;
    end if;
  end if;
  m := regexp_match(c, '(\d+(?:\.\d+)?)');
  if m is null then
    return query select 'quote'::text, null::numeric, null::numeric;
    return;
  end if;
  lo := m[1]::numeric;
  if is_from then
    return query select 'from'::text, lo, null::numeric;
  else
    return query select 'fixed'::text, lo, null::numeric;
  end if;
end $$;

-- Example upsert (products). Adjust before running.
-- insert into public.catalogue_items (tenant_id, kind, item_key, name, price, price_kind, price_min, price_max)
-- select t.id, 'product', coalesce(nullif(btrim(i->>'id'), ''), nullif(btrim(i->>'sku'), ''), lower(btrim(i->>'name'))),
--        left(btrim(i->>'name'), 200), nullif(btrim(i->>'price'), ''),
--        k.price_kind, k.price_min, k.price_max
--   from public.tenants t
--   cross join lateral jsonb_array_elements(t.product_catalog) i
--   cross join lateral public._parse_catalogue_price_kind(coalesce(i->>'price', i->>'price_range')) k
--  where btrim(coalesce(i->>'name', '')) <> ''
-- on conflict (tenant_id, kind, item_key) do update set
--   name = excluded.name,
--   price = excluded.price,
--   price_kind = excluded.price_kind,
--   price_min = excluded.price_min,
--   price_max = excluded.price_max,
--   updated_at = now();

rollback;
