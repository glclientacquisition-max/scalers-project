-- Cut over staging tenant_area_picks from v0 (one row per tenant, picks jsonb) to row-shaped picks.
-- Idempotent: safe to re-run. Single transaction. Does not drop v0 (renamed to tenant_area_picks_v0).
-- Field mapping matches dashboard/src/lib/areaPicksV0ToRows.ts (parity-tested).
--
-- v0 picks jsonb (Desk areaPicks.server save): { "version": 1, "tree_version": "...", "picks": [ ... ] }
--   node     -> node
--   serve    -> serve (default true; JSON false only)
--   fee_kes  -> fee_kes (else fee_ksh); null when serve false or non-positive
--   note     -> note (trim, max 200); null when serve false
-- Parent row: confirmed_at, tree_version (or picks.tree_version), moved_from, updated_by, updated_at
--
-- Rollback: docs/supabase/tenant_area_picks_to_rows_down.sql

begin;

do $guard$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tenant_area_picks'
      and column_name = 'picks'
  ) and not exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'tenant_area_picks_v0'
  ) then
    alter table public.tenant_area_picks rename to tenant_area_picks_v0;
    if exists (select 1 from pg_class where relname='tenant_area_picks_pkey' and relnamespace='public'::regnamespace) then
      alter index public.tenant_area_picks_pkey rename to tenant_area_picks_v0_pkey;
    end if;
  end if;
end $guard$;

create table if not exists public.tenant_area_picks (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  node text not null,
  serve boolean not null default true,
  fee_kes integer,
  note text,
  confirmed_at timestamptz,
  tree_version text not null,
  moved_from jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, node),
  constraint tenant_area_picks_fee_range check (fee_kes is null or (fee_kes > 0 and fee_kes <= 100000)),
  constraint tenant_area_picks_note_len check (note is null or char_length(note) <= 200)
);

comment on table public.tenant_area_picks is
  'Owner include/exclude picks on the Kenya area tree. Nearest pick wins. One row per node per tenant.';

alter table public.tenant_area_picks enable row level security;
revoke all on public.tenant_area_picks from anon, authenticated;

insert into public.tenant_area_picks (
  tenant_id,
  node,
  serve,
  fee_kes,
  note,
  confirmed_at,
  tree_version,
  moved_from,
  updated_by,
  updated_at
)
select
  v.tenant_id,
  trim(elem ->> 'node') as node,
  case when elem -> 'serve' = 'false'::jsonb then false else true end as serve,
  case
    when elem -> 'serve' = 'false'::jsonb then null
    else (
      select f.fee
      from (
        select
          case
            when fee_n is null or fee_n <= 0 then null::integer
            else least(100000, round(fee_n)::integer)
          end as fee
        from (
          select nullif(
            regexp_replace(
              coalesce(elem ->> 'fee_kes', elem ->> 'fee_ksh', ''),
              '[, ]',
              '',
              'g'
            ),
            ''
          )::numeric as fee_n
        ) x
      ) f
    )
  end as fee_kes,
  case
    when elem -> 'serve' = 'false'::jsonb then null
    else nullif(left(regexp_replace(coalesce(elem ->> 'note', ''), '\s+', ' ', 'g'), 200), '')
  end as note,
  v.confirmed_at,
  coalesce(
    nullif(trim(v.tree_version), ''),
    nullif(trim(v.picks ->> 'tree_version'), ''),
    'ke-areas-2026-10-24.1'
  ) as tree_version,
  v.moved_from,
  v.updated_by,
  coalesce(v.updated_at, now()) as updated_at
from public.tenant_area_picks_v0 v
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(v.picks -> 'picks') = 'array' then v.picks -> 'picks'
    when jsonb_typeof(v.picks) = 'array' then v.picks
    else '[]'::jsonb
  end
) as elem
where trim(coalesce(elem ->> 'node', '')) <> ''
on conflict (tenant_id, node) do nothing;

commit;
