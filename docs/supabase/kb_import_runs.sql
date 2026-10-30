-- Add many import log + 10-minute undo (Desk PR 9), version 2026-10-30.1. Apply AFTER kb_v2_paste_replace.sql.
-- kb_import_runs: one row per committed Add many import. before_rows holds the full kb_items rows the import touched
-- (as they were before), new_ids the rows it created, after_versions the row_version each touched row had right after.
-- kb_undo_import: one transaction. Only within 10 minutes, only once, and only if nobody changed those rows since.
-- ADDITIVE (new table + function). Safe to re-run. Rollback: docs/supabase/kb_import_runs_down.sql.
-- Staging first; prod only on Alvin's yes.

create table if not exists public.kb_import_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid,
  source text not null default 'paste' check (source in ('paste', 'file', 'photo', 'url')),
  mode text not null default 'append' check (mode in ('append', 'replace')),
  kind text not null check (kind in ('service', 'product', 'package')),
  counts jsonb not null default '{}'::jsonb,
  new_ids text[] not null default '{}',
  before_rows jsonb not null default '[]'::jsonb,
  after_versions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);
create index if not exists kb_import_runs_tenant_created_idx on public.kb_import_runs (tenant_id, created_at desc);
alter table public.kb_import_runs enable row level security;
revoke all on table public.kb_import_runs from public, anon, authenticated;
grant all on table public.kb_import_runs to service_role;

create or replace function public.kb_undo_import(p_tenant uuid, p_run uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r public.kb_import_runs%rowtype; v_restored integer := 0; v_removed integer := 0;
begin
  select * into r from public.kb_import_runs where id = p_run and tenant_id = p_tenant for update;
  if not found then raise exception 'kb_undo_import: not found' using errcode = 'P0002'; end if;
  if r.undone_at is not null then return jsonb_build_object('already', true); end if;
  if r.created_at < now() - interval '10 minutes' then
    raise exception 'kb_undo_import: expired' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_each_text(r.after_versions) v
    left join public.kb_items k on k.tenant_id = p_tenant and k.id = v.key
    where k.id is null or k.row_version <> v.value::integer
  ) then
    raise exception 'kb_undo_import: changed since' using errcode = '40001';
  end if;
  delete from public.kb_items k where k.tenant_id = p_tenant and k.id = any(r.new_ids);
  get diagnostics v_removed = row_count;
  update public.kb_items k set
    kind = b.kind, name_en = b.name_en, name_sw = b.name_sw, name_sw_state = b.name_sw_state,
    name_sw_suggested = b.name_sw_suggested, spoken_en = b.spoken_en, aliases = b.aliases, category_id = b.category_id,
    description_en = b.description_en, description_sw = b.description_sw, unit = b.unit, price_mode = b.price_mode,
    price_amount = b.price_amount, price_min = b.price_min, price_max = b.price_max, currency = b.currency,
    needs_visit = b.needs_visit, bookable = b.bookable, in_stock = b.in_stock, popular = b.popular, facets = b.facets,
    delivery_fee_kes = b.delivery_fee_kes, status = b.status, sort = b.sort, source = b.source, legacy_ref = b.legacy_ref,
    holdable = b.holdable, excludes_en = b.excludes_en, status_note = b.status_note,
    row_version = k.row_version + 1, updated_at = now()
  from jsonb_populate_recordset(null::public.kb_items, r.before_rows) b
  where k.tenant_id = p_tenant and k.id = b.id;
  get diagnostics v_restored = row_count;
  update public.kb_import_runs set undone_at = now() where id = r.id;
  return jsonb_build_object('restored', v_restored, 'removed', v_removed);
end;
$$;

revoke all on function public.kb_undo_import(uuid, uuid) from public, anon, authenticated;
grant execute on function public.kb_undo_import(uuid, uuid) to service_role;
