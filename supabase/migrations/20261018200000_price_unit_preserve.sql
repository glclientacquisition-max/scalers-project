-- Price units (#685). Forward only. Do not edit 20261011200000_structured_data_foundation.sql.
--
-- parse_price_ksh used to store unit null for every row. Tapping Yes in Settings
-- then replaced the owner's price text with a label that had no unit
-- ("KSh 40 per sq ft" became "KSh 40"). The Business Assistant reads price /
-- price_range, so callers heard the short line.
--
-- This replaces parse_price_ksh so a later parse keeps a taxonomy unit or the
-- owner's own unit phrase (unit_label). It also repairs catalogues already stored:
--   * fill pricing.unit / pricing.unit_label from the surviving text
--   * put parsed_from back into price / price_range when that text was shortened
--     and every amount in the short line is still in parsed_from
--
-- A row whose catalog .name path already has tenant_field_meta.value_hash is left
-- unchanged when the only edit would be the unit. Filling the unit would make
-- FACT_HASH_MODE drop the row until someone confirms it again. Restoring a
-- shortened price line does change the fact value; with FACT_HASH_MODE=on that
-- row stays out of the grounded catalogue until the owner taps Yes (the desk
-- re-stamps). Prod has the flag unset. Spoken prices use the text field.
--
-- Staging first. Needs a backup before prod. Safe to re-run (second run changes
-- nothing). Does not write tenant_field_meta.

begin;

create or replace function public._price_sig_tokens(p text)
returns text[]
language plpgsql
immutable
set search_path = public
as $$
declare
  t text := lower(coalesce(p, ''));
  parts text[];
  tok text;
  out text[] := '{}';
  n numeric;
begin
  t := replace(t, '/=', ' ');
  t := regexp_replace(t, '(\d),(\d)', '\1\2', 'g');
  t := regexp_replace(t, '(\d),(\d)', '\1\2', 'g');
  parts := regexp_split_to_array(t, '[^a-z0-9.]+');
  if parts is null then return out; end if;
  foreach tok in array parts loop
    if tok is null or tok = '' or tok = '.' then continue; end if;
    -- Same glue list as PRICE_FILLER in dashboard/src/lib/structuredData.ts.
    if tok in ('ksh', 'kes', 'kshs', 'sh', 'shs', 'flat', 'only', 'the', 'per', 'a', 'an', 'to') then continue; end if;
    n := null;
    if tok ~ '^[0-9]+(\.[0-9]+)?k$' then
      n := round((regexp_replace(tok, 'k$', ''))::numeric * 1000);
    elsif tok ~ '^[0-9]+(\.[0-9]+)?m$' then
      n := round((regexp_replace(tok, 'm$', ''))::numeric * 1000000);
    elsif tok ~ '^[0-9]+(\.[0-9]+)?$' then
      n := round(tok::numeric);
    end if;
    if n is not null and n >= 0 and n <= 100000000 then
      out := array_append(out, trunc(n)::bigint::text);
    else
      out := array_append(out, tok);
    end if;
  end loop;
  return out;
end $$;

create or replace function public._price_text_covers(label text, src text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select not exists (
    select 1 from unnest(public._price_sig_tokens(src)) s
    where s <> all (public._price_sig_tokens(label))
  );
$$;

create or replace function public._price_amounts_kept(live text, src text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select not exists (
    select 1 from unnest(public._price_sig_tokens(live)) s
    where s ~ '^[0-9]+$'
      and s <> all (public._price_sig_tokens(src))
  );
$$;

create or replace function public._catalogue_name_path(kind text, item jsonb, idx int)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when kind = 'service' then 'catalog.service.' || coalesce(
      case when btrim(coalesce(item->>'id', '')) ~ '^[A-Za-z0-9_-]{1,64}$'
            and btrim(item->>'id') !~ '^[0-9]+$'
           then btrim(item->>'id') end,
      idx::text) || '.name'
    else 'catalog.product.' || coalesce(nullif(btrim(coalesce(item->>'sku', '')), ''), idx::text) || '.name'
  end;
$$;

-- Free-text price -> typed price jsonb. Mirror of parsePriceText, including the unit.
create or replace function public.parse_price_ksh(p text)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  t text := lower(coalesce(p, ''));
  c text;
  lo numeric; hi numeric; m text[];
  is_from boolean;
  unit_id text;
  unit_label text;
begin
  unit_id := case
    when t ~ '\m(per|a)\s+(kg|kilos?)\M' or t ~ '/\s*(kg|kilos?)\M' then 'kg'
    when t ~ '\m(per|a)\s+(hr|hours?)\M' then 'hour'
    when t ~ '\m(per|a)\s+visits?\M' then 'visit'
    when t ~ '\m(per|a)\s+rooms?\M' then 'room'
    when t ~ '\m(per|a)\s+(sqm|m2|square metres?|square meters?|sq\s*m)\M' or t ~ '/\s*(sqm|m2)\M' then 'sqm'
    when t ~ '\m(per|a)\s+(litre|liter|ltr)s?\M' then 'litre'
    when t ~ '\m(per|a)\s+(metres?|meters?)\M' or t ~ '\m(per|a)\s+m\M' then 'metre'
    when t ~ '\m(per|a)\s+(packs?|packets?|box|boxes)\M' then 'pack'
    when t ~ '\m(per|a)\s+(seats?|seaters?)\M' then 'seat'
    when t ~ '\m(per|a)\s+jobs?\M' then 'job'
    when t ~ '\m(each|pcs?|pieces?)\M' then 'item'
    else null
  end;
  if unit_id is null then
    m := regexp_match(t, '\m(?:per|a)\s+([a-z][a-z0-9]*(?:\s+[a-z][a-z0-9]*){0,3})');
    if m is null then m := regexp_match(t, '/\s*([a-z][a-z0-9]{0,16})'); end if;
    if m is not null then
      unit_label := regexp_replace(m[1], '\s+per\s+.*$', '');
      if unit_label !~ '^[a-z][a-z ]{0,31}$' then unit_label := null; end if;
    end if;
  end if;

  if btrim(t) = '' or t ~ '^\s*(ask|call|varies|depends|tbd|on request)' then
    return jsonb_build_object('mode', 'ask', 'amount_ksh', null, 'min_ksh', null, 'max_ksh', null,
      'unit', unit_id, 'unit_label', unit_label,
      'in_stock', null, 'source', 'parsed', 'confirmed', false, 'parsed_from', nullif(btrim(p), ''));
  end if;
  c := regexp_replace(t, 'kshs?\.?|kes|/=', ' ', 'g');
  c := regexp_replace(c, '(\d),(\d{3})', '\1\2', 'g');
  c := regexp_replace(c, '(\d),(\d{3})', '\1\2', 'g');
  is_from := t ~ '\m(from|starting|kuanzia)\M'
    or (t ~ '\mmin(imum)?\M' and t !~ '\mmin(imum)?\s+[0-9]+\s*(hours?|hrs?|days?|months?|mins?|minutes?)\M');
  m := regexp_match(c, '([0-9]+(?:\.[0-9]+)?)\s*(k?)\s*(?:-|–|to)\s*([0-9]+(?:\.[0-9]+)?)\s*(k?)(?![a-z])');
  if m is not null then
    lo := m[1]::numeric * case when m[2] = 'k' then 1000 else 1 end;
    hi := m[3]::numeric * case when m[4] = 'k' then 1000 else 1 end;
    if hi >= lo then
      return jsonb_build_object('mode', 'range', 'amount_ksh', round(lo), 'min_ksh', round(lo), 'max_ksh', round(hi),
        'unit', unit_id, 'unit_label', unit_label,
        'in_stock', null, 'source', 'parsed', 'confirmed', false, 'parsed_from', btrim(p));
    end if;
  end if;
  m := regexp_match(c, '([0-9]+(?:\.[0-9]+)?)\s*(k(?![a-z]))?');
  if m is null then
    return jsonb_build_object('mode', 'ask', 'amount_ksh', null, 'min_ksh', null, 'max_ksh', null,
      'unit', unit_id, 'unit_label', unit_label,
      'in_stock', null, 'source', 'parsed', 'confirmed', false, 'parsed_from', btrim(p));
  end if;
  lo := m[1]::numeric * case when m[2] = 'k' then 1000 else 1 end;
  if lo > 100000000 then lo := null; end if;
  return jsonb_build_object('mode', case when lo is null then 'ask' when is_from then 'from' else 'fixed' end,
    'amount_ksh', round(lo), 'min_ksh', case when is_from then round(lo) end, 'max_ksh', null,
    'unit', unit_id, 'unit_label', unit_label,
    'in_stock', null, 'source', 'parsed', 'confirmed', false, 'parsed_from', btrim(p));
end $$;

create or replace function public._repair_catalogue_price_item(p_tenant uuid, kind text, item jsonb, idx int)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  pricing jsonb;
  live text;
  src text;
  next_text text;
  parsed jsonb;
  next_pricing jsonb;
  text_key text := case when kind = 'product' then 'price' else 'price_range' end;
  locked boolean := false;
begin
  if item is null or jsonb_typeof(item) <> 'object' then return item; end if;
  pricing := item->'pricing';
  if pricing is null or jsonb_typeof(pricing) <> 'object' then return item; end if;
  live := btrim(coalesce(item->>text_key, ''));
  src := btrim(coalesce(pricing->>'parsed_from', ''));
  if src = '' then src := live; end if;
  next_text := live;
  if live <> '' and src <> '' and live <> src
     and not public._price_text_covers(live, src)
     and public._price_amounts_kept(live, src) then
    next_text := src;
  end if;
  if to_regclass('public.tenant_field_meta') is not null then
    select exists (
      select 1 from public.tenant_field_meta m
      where m.tenant_id = p_tenant
        and m.field_path = public._catalogue_name_path(kind, item, idx)
        and coalesce(m.value_hash, '') <> ''
    ) into locked;
  end if;
  -- A hashed row stays put unless the price line itself was shortened.
  if locked and next_text is not distinct from live then return item; end if;
  parsed := public.parse_price_ksh(case when next_text <> '' then next_text else src end);
  next_pricing := pricing;
  if coalesce(pricing->>'unit', '') = '' and coalesce(parsed->>'unit', '') <> '' then
    next_pricing := next_pricing || jsonb_build_object('unit', parsed->>'unit');
  elsif coalesce(pricing->>'unit', '') = '' and coalesce(pricing->>'unit_label', '') = ''
        and coalesce(parsed->>'unit_label', '') <> '' then
    next_pricing := next_pricing || jsonb_build_object('unit_label', parsed->>'unit_label');
  end if;
  if next_text is not distinct from live and next_pricing is not distinct from pricing then
    return item;
  end if;
  if next_text is distinct from live then
    item := item || jsonb_build_object(text_key, next_text);
  end if;
  if next_pricing is distinct from pricing then
    item := item || jsonb_build_object('pricing', next_pricing);
  end if;
  return item;
end $$;

revoke all on function public._price_sig_tokens(text) from public, anon, authenticated;
revoke all on function public._price_text_covers(text, text) from public, anon, authenticated;
revoke all on function public._price_amounts_kept(text, text) from public, anon, authenticated;
revoke all on function public._catalogue_name_path(text, jsonb, int) from public, anon, authenticated;
revoke all on function public._repair_catalogue_price_item(uuid, text, jsonb, int) from public, anon, authenticated;
grant execute on function public._price_sig_tokens(text) to service_role;
grant execute on function public._price_text_covers(text, text) to service_role;
grant execute on function public._price_amounts_kept(text, text) to service_role;
grant execute on function public._catalogue_name_path(text, jsonb, int) to service_role;
grant execute on function public._repair_catalogue_price_item(uuid, text, jsonb, int) to service_role;

update public.tenants t
   set product_catalog = (
     select coalesce(jsonb_agg(public._repair_catalogue_price_item(t.id, 'product', i, ord::int) order by ord), '[]'::jsonb)
     from jsonb_array_elements(t.product_catalog) with ordinality as x(i, ord))
 where jsonb_typeof(t.product_catalog) = 'array'
   and exists (
     select 1 from jsonb_array_elements(t.product_catalog) with ordinality as x(i, ord)
     where public._repair_catalogue_price_item(t.id, 'product', i, ord::int) is distinct from i);

update public.tenants t
   set services_catalog = (
     select coalesce(jsonb_agg(public._repair_catalogue_price_item(t.id, 'service', i, ord::int) order by ord), '[]'::jsonb)
     from jsonb_array_elements(t.services_catalog) with ordinality as x(i, ord))
 where jsonb_typeof(t.services_catalog) = 'array'
   and exists (
     select 1 from jsonb_array_elements(t.services_catalog) with ordinality as x(i, ord)
     where public._repair_catalogue_price_item(t.id, 'service', i, ord::int) is distinct from i);

commit;
