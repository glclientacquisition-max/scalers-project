-- v2 Knowledge Base (kb_v2), version 2026-10-28.1.
-- One item model for products and services, a versioned spoken-ready snapshot per business,
-- and a readiness record that gates which brain answers the business's calls.
-- Design: Page "v2 Knowledge Base — design for discussion" (28 Oct 2026). Contract: docs/reference/platform/KB_V2.md.
-- ADDITIVE. Safe to re-run. Rollback: docs/supabase/kb_v2_down.sql.
-- Writes: service role only (Desk server actions after the owner check, Voice compile, scripts).
-- Reads: service role; owners may SELECT their own rows (current_user_tenant_ids()).
-- Apply order: after tenant_area_picks.sql and policy_topics.sql. Staging first; prod only on Alvin's yes.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gin with schema extensions;

-- ---------------------------------------------------------------- categories
create table if not exists public.kb_categories (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  id text not null,
  name_en text not null,
  name_sw text,
  name_sw_state text not null default 'none',
  sort integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  constraint kb_categories_id_len check (char_length(id) between 1 and 80),
  constraint kb_categories_name_len check (char_length(name_en) between 1 and 120),
  constraint kb_categories_sw_state check (name_sw_state in ('none', 'suggested', 'approved', 'edited', 'rejected'))
);

-- ---------------------------------------------------------------- items (products + services, one model)
create table if not exists public.kb_items (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  id text not null,                          -- keeps today's svc_ / prd_ ids
  kind text not null,                        -- service | product | package
  name_en text not null,
  name_sw text,                              -- spoken only when name_sw_state is approved or edited
  name_sw_state text not null default 'none',
  name_sw_suggested text,                    -- AI suggestion waiting for the owner
  spoken_en text,                            -- owner override of the spoken English name
  aliases text[] not null default '{}',
  category_id text,
  description_en text,
  description_sw text,
  unit text,                                 -- job | seat | hour | sqm | seedling | kg | piece | tray | ...
  price_mode text not null default 'none',   -- fixed | range | from | per_unit | quote | free | none
  price_amount numeric(12,2),
  price_min numeric(12,2),
  price_max numeric(12,2),
  currency text not null default 'KES',
  needs_visit boolean not null default false,
  bookable boolean not null default true,
  in_stock boolean,                          -- null = not tracked
  popular boolean not null default false,    -- owner-set popular pick (Hick rule 5)
  facets jsonb not null default '{}'::jsonb, -- size, colour, use, rooms ... for narrowing (Hick rule 4)
  delivery_fee_kes integer,                  -- optional per-item override of the area fee
  status text not null default 'active',     -- active | hidden
  sort integer not null default 0,
  source text not null default 'owner',      -- owner | import | legacy
  legacy_ref text,                           -- services_catalog | product_catalog when backfilled
  row_version integer not null default 1,
  search_text text not null default '',      -- maintained by trigger: lower(name_en, name_sw, aliases, category)
  search_tsv tsvector,                       -- maintained by trigger: simple config (mixed en/sw)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  constraint kb_items_kind check (kind in ('service', 'product', 'package')),
  constraint kb_items_id_len check (char_length(id) between 1 and 80),
  constraint kb_items_name_len check (char_length(name_en) between 1 and 160),
  constraint kb_items_sw_state check (name_sw_state in ('none', 'suggested', 'approved', 'edited', 'rejected')),
  constraint kb_items_price_mode check (price_mode in ('fixed', 'range', 'from', 'per_unit', 'quote', 'free', 'none')),
  constraint kb_items_price_nonneg check (coalesce(price_amount, 0) >= 0 and coalesce(price_min, 0) >= 0 and coalesce(price_max, 0) >= 0),
  constraint kb_items_range_order check (price_min is null or price_max is null or price_min <= price_max),
  constraint kb_items_status check (status in ('active', 'hidden')),
  constraint kb_items_aliases_len check (cardinality(aliases) <= 20),
  constraint kb_items_fee_range check (delivery_fee_kes is null or (delivery_fee_kes >= 0 and delivery_fee_kes <= 100000))
);

create index if not exists kb_items_tenant_status_kind on public.kb_items (tenant_id, status, kind);
create index if not exists kb_items_tenant_category on public.kb_items (tenant_id, category_id);
create index if not exists kb_items_search_trgm on public.kb_items using gin (tenant_id, search_text extensions.gin_trgm_ops);
create index if not exists kb_items_search_tsv on public.kb_items using gin (tenant_id, search_tsv);

create or replace function public.kb_items_search_fill()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.search_text := lower(concat_ws(' ', new.name_en, new.name_sw, new.spoken_en, array_to_string(new.aliases, ' '), new.category_id));
  new.search_tsv := to_tsvector('simple'::regconfig, new.search_text);
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists kb_items_search_fill on public.kb_items;
create trigger kb_items_search_fill before insert or update on public.kb_items
  for each row execute function public.kb_items_search_fill();

-- ---------------------------------------------------------------- variants (1-bedroom vs 3-bedroom, tray vs single)
create table if not exists public.kb_item_variants (
  tenant_id uuid not null,
  item_id text not null,
  id text not null,
  label_en text not null,
  label_sw text,
  price_mode text not null default 'fixed',
  price_amount numeric(12,2),
  price_min numeric(12,2),
  price_max numeric(12,2),
  unit text,
  in_stock boolean,
  sort integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, item_id, id),
  foreign key (tenant_id, item_id) references public.kb_items (tenant_id, id) on delete cascade,
  constraint kb_item_variants_price_mode check (price_mode in ('fixed', 'range', 'from', 'per_unit', 'quote', 'free', 'none'))
);

-- ---------------------------------------------------------------- snapshots (compiled, spoken-ready, versioned)
create table if not exists public.kb_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version integer not null,
  schema_version integer not null default 2,
  source_hash text not null,
  status text not null,                      -- live | failed | superseded
  compiler text not null default 'rules',    -- rules | rules+ai
  doc jsonb not null,
  issues jsonb not null default '[]'::jsonb,
  item_count integer not null default 0,
  bytes integer not null default 0,
  compiled_at timestamptz not null default now(),
  unique (tenant_id, version),
  constraint kb_snapshots_status check (status in ('live', 'failed', 'superseded'))
);
create index if not exists kb_snapshots_tenant_version on public.kb_snapshots (tenant_id, version desc);

-- ---------------------------------------------------------------- readiness (Root 2)
create table if not exists public.kb_readiness (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  snapshot_version integer,
  brain text not null default 'v2',
  passed boolean not null,
  checks jsonb not null default '[]'::jsonb,
  tests jsonb not null default '[]'::jsonb,
  real_call_sid text,
  checked_by text,                           -- compile | admin | script | nightly
  checked_at timestamptz not null default now()
);
create index if not exists kb_readiness_tenant_checked on public.kb_readiness (tenant_id, checked_at desc);

-- ---------------------------------------------------------------- tenant pointers
alter table public.tenants add column if not exists kb_live_version integer;
alter table public.tenants add column if not exists kb_ready_version integer;
alter table public.tenants add column if not exists brain_target text not null default 'v2';
do $$ begin
  alter table public.tenants add constraint tenants_brain_target check (brain_target in ('v1', 'v2'));
exception when duplicate_object then null; end $$;
comment on column public.tenants.kb_live_version is 'kb_snapshots.version callers hear. A failed compile never moves it.';
comment on column public.tenants.kb_ready_version is 'Snapshot version that passed readiness. New brain answers only when equal to kb_live_version and brain_target = v2 (BRAIN_KB_GATE=on).';
comment on column public.tenants.brain_target is 'v2 = new brain once ready; v1 = keep the old brain (owner/ops hold).';

-- ---------------------------------------------------------------- RLS
alter table public.kb_categories enable row level security;
alter table public.kb_items enable row level security;
alter table public.kb_item_variants enable row level security;
alter table public.kb_snapshots enable row level security;
alter table public.kb_readiness enable row level security;
revoke all on public.kb_categories, public.kb_items, public.kb_item_variants, public.kb_snapshots, public.kb_readiness from anon, authenticated;
grant select on public.kb_categories, public.kb_items, public.kb_item_variants, public.kb_snapshots, public.kb_readiness to authenticated;
grant all on public.kb_categories, public.kb_items, public.kb_item_variants, public.kb_snapshots, public.kb_readiness to service_role;

drop policy if exists kb_categories_select_member on public.kb_categories;
create policy kb_categories_select_member on public.kb_categories for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
drop policy if exists kb_items_select_member on public.kb_items;
create policy kb_items_select_member on public.kb_items for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
drop policy if exists kb_item_variants_select_member on public.kb_item_variants;
create policy kb_item_variants_select_member on public.kb_item_variants for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
drop policy if exists kb_snapshots_select_member on public.kb_snapshots;
create policy kb_snapshots_select_member on public.kb_snapshots for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
drop policy if exists kb_readiness_select_member on public.kb_readiness;
create policy kb_readiness_select_member on public.kb_readiness for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

-- ---------------------------------------------------------------- RPCs (service role only)
-- One batch write per save. p_items: [{id, kind, name_en, ...}]; p_variants: [{item_id, id, ...}].
-- p_hide_missing: rows of this tenant whose id is not in p_items (and source = p_scope when given) become hidden.
-- Optimistic concurrency: an item with row_version set must match the stored row_version, else it is skipped and reported.
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
      popular, facets, delivery_fee_kes, status, sort, source, legacy_ref)
    values (p_tenant, r->>'id', coalesce(r->>'kind', 'service'), r->>'name_en', nullif(r->>'name_sw', ''), coalesce(r->>'name_sw_state', 'none'),
      nullif(r->>'name_sw_suggested', ''), nullif(r->>'spoken_en', ''),
      coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(r->'aliases', '[]'::jsonb)) x where x <> ''), '{}'),
      nullif(r->>'category_id', ''), nullif(r->>'description_en', ''), nullif(r->>'description_sw', ''), nullif(r->>'unit', ''),
      coalesce(r->>'price_mode', 'none'), (r->>'price_amount')::numeric, (r->>'price_min')::numeric, (r->>'price_max')::numeric,
      coalesce(r->>'currency', 'KES'), coalesce((r->>'needs_visit')::boolean, false), coalesce((r->>'bookable')::boolean, true),
      (r->>'in_stock')::boolean, coalesce((r->>'popular')::boolean, false), coalesce(r->'facets', '{}'::jsonb),
      (r->>'delivery_fee_kes')::int, coalesce(r->>'status', 'active'), coalesce((r->>'sort')::int, 0), coalesce(r->>'source', 'owner'), nullif(r->>'legacy_ref', ''))
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
      source = case when k.source = 'owner' and excluded.source = 'legacy' then k.source else excluded.source end,
      legacy_ref = coalesce(excluded.legacy_ref, k.legacy_ref),
      row_version = k.row_version + 1;
    v_up := v_up + 1;
  end loop;
  if p_hide_missing then
    update public.kb_items k set status = 'hidden', row_version = k.row_version + 1
    where k.tenant_id = p_tenant and k.status = 'active'
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

-- Publish one compiled snapshot. Live: version N becomes live, the previous live row superseded, tenants.kb_live_version = N,
-- all in one transaction. Failed: stored for Desk to show; the live pointer does not move. Returns the new version.
create or replace function public.kb_publish_snapshot(p_tenant uuid, p_doc jsonb, p_source_hash text, p_issues jsonb, p_status text, p_compiler text default 'rules')
returns integer
language plpgsql
set search_path = ''
as $$
declare v integer;
begin
  if p_status not in ('live', 'failed') then raise exception 'kb_publish_snapshot: status live or failed'; end if;
  perform 1 from public.tenants t where t.id = p_tenant for update;
  if not found then raise exception 'kb_publish_snapshot: unknown tenant'; end if;
  select coalesce(max(s.version), 0) + 1 into v from public.kb_snapshots s where s.tenant_id = p_tenant;
  if p_status = 'live' then
    update public.kb_snapshots s set status = 'superseded' where s.tenant_id = p_tenant and s.status = 'live';
  end if;
  insert into public.kb_snapshots (tenant_id, version, schema_version, source_hash, status, compiler, doc, issues, item_count, bytes)
  values (p_tenant, v, coalesce((p_doc->>'schema')::int, 2), p_source_hash, p_status, coalesce(p_compiler, 'rules'), p_doc, coalesce(p_issues, '[]'::jsonb),
    coalesce(jsonb_array_length(p_doc->'items'), 0), octet_length(p_doc::text));
  if p_status = 'live' then
    update public.tenants t set kb_live_version = v where t.id = p_tenant;
  end if;
  -- keep the live row and the last 10 others
  delete from public.kb_snapshots s where s.tenant_id = p_tenant and s.status <> 'live'
    and s.version < v - 10;
  return v;
end;
$$;

-- Tier 2 lookup (businesses above 10,000 active items): trigram + full-text over one tenant's items.
create or replace function public.kb_search_items(p_tenant uuid, p_query text, p_limit integer default 5)
returns table (id text, kind text, name_en text, category_id text, score real)
language sql
stable
set search_path = ''
as $$
  select k.id, k.kind, k.name_en, k.category_id,
    greatest(extensions.word_similarity(lower(p_query), k.search_text),
             ts_rank(k.search_tsv, plainto_tsquery('simple'::regconfig, lower(p_query)))) as score
  from public.kb_items k
  where k.tenant_id = p_tenant and k.status = 'active'
    and (lower(p_query) operator(extensions.<%) k.search_text or k.search_tsv @@ plainto_tsquery('simple'::regconfig, lower(p_query)))
  order by score desc, k.sort, k.id
  limit least(greatest(coalesce(p_limit, 5), 1), 50);
$$;

-- Readiness result: one row per run; on a pass for the live version, tenants.kb_ready_version moves to it.
create or replace function public.kb_record_readiness(p_tenant uuid, p_version integer, p_passed boolean, p_checks jsonb, p_tests jsonb, p_by text default 'script', p_call_sid text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare rid uuid;
begin
  insert into public.kb_readiness (tenant_id, snapshot_version, passed, checks, tests, checked_by, real_call_sid)
  values (p_tenant, p_version, p_passed, coalesce(p_checks, '[]'::jsonb), coalesce(p_tests, '[]'::jsonb), p_by, p_call_sid)
  returning id into rid;
  if p_passed then
    update public.tenants t set kb_ready_version = p_version where t.id = p_tenant and t.kb_live_version = p_version;
  end if;
  return rid;
end;
$$;

revoke all on function public.kb_upsert_items(uuid, jsonb, jsonb, boolean, text) from public, anon, authenticated;
revoke all on function public.kb_publish_snapshot(uuid, jsonb, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.kb_search_items(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.kb_record_readiness(uuid, integer, boolean, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.kb_items_search_fill() from public, anon, authenticated;
grant execute on function public.kb_upsert_items(uuid, jsonb, jsonb, boolean, text) to service_role;
grant execute on function public.kb_publish_snapshot(uuid, jsonb, text, jsonb, text, text) to service_role;
grant execute on function public.kb_search_items(uuid, text, integer) to service_role;
grant execute on function public.kb_record_readiness(uuid, integer, boolean, jsonb, jsonb, text, text) to service_role;
