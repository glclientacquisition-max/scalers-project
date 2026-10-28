-- v2 Knowledge Base item states (kb_v2), version 2026-10-28.2. Apply AFTER kb_v2.sql (2026-10-28.1).
-- From the Desk catalogue review (28 Oct): honest prices and explicit item states.
--   price_mode 'site_visit'  priced after the team visits (spoken: "after a site visit"); counts as priced for readiness
--   status 'paused'          temporarily unavailable (owner hold), spoken as "not available right now", not deleted
--   status 'not_offered'     an explicit "we don't do X", so the brain says no instead of "not sure"
--   holdable                 the item can be held/reserved for a caller (legacy product_catalog.holdable)
--   excludes_en              what the item does not include (legacy services_catalog.out_of_scope)
--   status_note              short owner note for paused items ("back next week"), max 120
-- ADDITIVE. Safe to re-run. Rollback: docs/supabase/kb_v2_item_states_down.sql. Staging first; prod only on Alvin's yes.

alter table public.kb_items add column if not exists holdable boolean not null default false;
alter table public.kb_items add column if not exists excludes_en text;
alter table public.kb_items add column if not exists status_note text;

alter table public.kb_items drop constraint if exists kb_items_price_mode;
alter table public.kb_items add constraint kb_items_price_mode
  check (price_mode in ('fixed', 'range', 'from', 'per_unit', 'quote', 'site_visit', 'free', 'none'));
alter table public.kb_items drop constraint if exists kb_items_status;
alter table public.kb_items add constraint kb_items_status check (status in ('active', 'paused', 'not_offered', 'hidden'));
alter table public.kb_items drop constraint if exists kb_items_status_note_len;
alter table public.kb_items add constraint kb_items_status_note_len check (status_note is null or char_length(status_note) <= 120);
alter table public.kb_items drop constraint if exists kb_items_excludes_len;
alter table public.kb_items add constraint kb_items_excludes_len check (excludes_en is null or char_length(excludes_en) <= 500);
alter table public.kb_item_variants drop constraint if exists kb_item_variants_price_mode;
alter table public.kb_item_variants add constraint kb_item_variants_price_mode
  check (price_mode in ('fixed', 'range', 'from', 'per_unit', 'quote', 'site_visit', 'free', 'none'));

-- Batch write, now with holdable / excludes_en / status_note (kept when a key is absent) and paused / not_offered rows
-- also hidden by p_hide_missing. Same signature as 2026-10-28.1.
create or replace function public.kb_upsert_items(p_tenant uuid, p_items jsonb, p_variants jsonb default '[]'::jsonb, p_hide_missing boolean default false, p_scope text default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_up integer := 0; v_hidden integer := 0; v_conflicts jsonb := '[]'::jsonb; r jsonb;
begin
  if p_tenant is null or jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'kb_upsert_items: tenant and items array required';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if (r ? 'row_version') and exists (
      select 1 from public.kb_items k where k.tenant_id = p_tenant and k.id = r->>'id' and k.row_version <> (r->>'row_version')::int
    ) then
      v_conflicts := v_conflicts || jsonb_build_array(r->>'id');
      continue;
    end if;
    insert into public.kb_items as k (tenant_id, id, kind, name_en, name_sw, name_sw_state, name_sw_suggested, spoken_en, aliases, category_id,
      description_en, description_sw, unit, price_mode, price_amount, price_min, price_max, currency, needs_visit, bookable, in_stock,
      popular, facets, delivery_fee_kes, status, sort, source, legacy_ref, holdable, excludes_en, status_note)
    values (p_tenant, r->>'id', coalesce(r->>'kind', 'service'), r->>'name_en', nullif(r->>'name_sw', ''), coalesce(r->>'name_sw_state', 'none'),
      nullif(r->>'name_sw_suggested', ''), nullif(r->>'spoken_en', ''),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(r->'aliases', '[]'::jsonb)) x where x <> ''), '{}'),
      nullif(r->>'category_id', ''), nullif(r->>'description_en', ''), nullif(r->>'description_sw', ''), nullif(r->>'unit', ''),
      coalesce(r->>'price_mode', 'none'), (r->>'price_amount')::numeric, (r->>'price_min')::numeric, (r->>'price_max')::numeric,
      coalesce(r->>'currency', 'KES'), coalesce((r->>'needs_visit')::boolean, false), coalesce((r->>'bookable')::boolean, true),
      (r->>'in_stock')::boolean, coalesce((r->>'popular')::boolean, false), coalesce(r->'facets', '{}'::jsonb),
      (r->>'delivery_fee_kes')::int, coalesce(r->>'status', 'active'), coalesce((r->>'sort')::int, 0), coalesce(r->>'source', 'owner'), nullif(r->>'legacy_ref', ''),
      coalesce((r->>'holdable')::boolean, false), nullif(r->>'excludes_en', ''), nullif(r->>'status_note', ''))
    on conflict (tenant_id, id) do update set
      kind = excluded.kind, name_en = excluded.name_en,
      name_sw = case when r ? 'name_sw' then excluded.name_sw else k.name_sw end,
      name_sw_state = case when r ? 'name_sw_state' then excluded.name_sw_state else k.name_sw_state end,
      name_sw_suggested = case when r ? 'name_sw_suggested' then excluded.name_sw_suggested else k.name_sw_suggested end,
      spoken_en = case when r ? 'spoken_en' then excluded.spoken_en else k.spoken_en end,
      aliases = case when r ? 'aliases' then excluded.aliases else k.aliases end,
      category_id = excluded.category_id, description_en = excluded.description_en,
      description_sw = case when r ? 'description_sw' then excluded.description_sw else k.description_sw end,
      unit = excluded.unit, price_mode = excluded.price_mode, price_amount = excluded.price_amount, price_min = excluded.price_min,
      price_max = excluded.price_max, currency = excluded.currency, needs_visit = excluded.needs_visit, bookable = excluded.bookable,
      in_stock = excluded.in_stock,
      popular = case when r ? 'popular' then excluded.popular else k.popular end,
      facets = case when r ? 'facets' then excluded.facets else k.facets end,
      delivery_fee_kes = case when r ? 'delivery_fee_kes' then excluded.delivery_fee_kes else k.delivery_fee_kes end,
      status = excluded.status, sort = excluded.sort,
      holdable = case when r ? 'holdable' then excluded.holdable else k.holdable end,
      excludes_en = case when r ? 'excludes_en' then excluded.excludes_en else k.excludes_en end,
      status_note = case when r ? 'status_note' then excluded.status_note else k.status_note end,
      source = case when k.source = 'owner' and excluded.source = 'legacy' then k.source else excluded.source end,
      legacy_ref = coalesce(excluded.legacy_ref, k.legacy_ref),
      row_version = k.row_version + 1;
    v_up := v_up + 1;
  end loop;
  if p_hide_missing then
    update public.kb_items k set status = 'hidden', row_version = k.row_version + 1
    where k.tenant_id = p_tenant and k.status <> 'hidden'
      and (p_scope is null or k.legacy_ref = p_scope)
      and not exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e where e->>'id' = k.id);
    get diagnostics v_hidden = row_count;
  end if;
  if jsonb_typeof(coalesce(p_variants, '[]'::jsonb)) = 'array' and jsonb_array_length(coalesce(p_variants, '[]'::jsonb)) > 0 then
    delete from public.kb_item_variants v where v.tenant_id = p_tenant
      and v.item_id in (select e->>'item_id' from jsonb_array_elements(p_variants) e);
    insert into public.kb_item_variants (tenant_id, item_id, id, label_en, label_sw, price_mode, price_amount, price_min, price_max, unit, in_stock, sort)
    select p_tenant, e->>'item_id', e->>'id', e->>'label_en', nullif(e->>'label_sw', ''), coalesce(e->>'price_mode', 'fixed'),
      (e->>'price_amount')::numeric, (e->>'price_min')::numeric, (e->>'price_max')::numeric, nullif(e->>'unit', ''), (e->>'in_stock')::boolean,
      coalesce((e->>'sort')::int, 0)
    from jsonb_array_elements(p_variants) e
    where exists (select 1 from public.kb_items k where k.tenant_id = p_tenant and k.id = e->>'item_id');
  end if;
  return jsonb_build_object('upserted', v_up, 'hidden', v_hidden, 'conflicts', v_conflicts);
end;
$$;

-- Tier 2 lookup: also returns paused / not_offered rows with their status, so the brain can say "not right now" or "no".
drop function if exists public.kb_search_items(uuid, text, integer);
create function public.kb_search_items(p_tenant uuid, p_query text, p_limit integer default 5)
returns table (id text, kind text, name_en text, category_id text, status text, score real)
language sql
stable
set search_path = ''
as $$
  select k.id, k.kind, k.name_en, k.category_id, k.status,
    greatest(extensions.word_similarity(lower(p_query), k.search_text),
             ts_rank(k.search_tsv, plainto_tsquery('simple'::regconfig, lower(p_query)))) as score
  from public.kb_items k
  where k.tenant_id = p_tenant and k.status <> 'hidden'
    and (lower(p_query) operator(extensions.<%) k.search_text or k.search_tsv @@ plainto_tsquery('simple'::regconfig, lower(p_query)))
  order by score desc, k.sort, k.id
  limit least(greatest(coalesce(p_limit, 5), 1), 50);
$$;

revoke all on function public.kb_upsert_items(uuid, jsonb, jsonb, boolean, text) from public, anon, authenticated;
revoke all on function public.kb_search_items(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.kb_upsert_items(uuid, jsonb, jsonb, boolean, text) to service_role;
grant execute on function public.kb_search_items(uuid, text, integer) to service_role;
