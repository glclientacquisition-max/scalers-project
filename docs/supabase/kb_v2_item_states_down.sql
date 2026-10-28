-- Rollback for kb_v2_item_states.sql (2026-10-28.2): back to the 2026-10-28.1 shape.
-- Rows using the new states are folded back first (paused/not_offered -> hidden, site_visit -> quote + needs_visit).
update public.kb_items set status = 'hidden' where status in ('paused', 'not_offered');
update public.kb_items set price_mode = 'quote', needs_visit = true where price_mode = 'site_visit';
update public.kb_item_variants set price_mode = 'quote' where price_mode = 'site_visit';
alter table public.kb_items drop constraint if exists kb_items_price_mode;
alter table public.kb_items add constraint kb_items_price_mode check (price_mode in ('fixed', 'range', 'from', 'per_unit', 'quote', 'free', 'none'));
alter table public.kb_items drop constraint if exists kb_items_status;
alter table public.kb_items add constraint kb_items_status check (status in ('active', 'hidden'));
alter table public.kb_item_variants drop constraint if exists kb_item_variants_price_mode;
alter table public.kb_item_variants add constraint kb_item_variants_price_mode check (price_mode in ('fixed', 'range', 'from', 'per_unit', 'quote', 'free', 'none'));
drop function if exists public.kb_search_items(uuid, text, integer);
create function public.kb_search_items(p_tenant uuid, p_query text, p_limit integer default 5)
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
-- Restore the 2026-10-28.1 kb_upsert_items by re-running its block from kb_v2.sql (create or replace), then:
alter table public.kb_items drop constraint if exists kb_items_status_note_len;
alter table public.kb_items drop constraint if exists kb_items_excludes_len;
alter table public.kb_items drop column if exists status_note;
alter table public.kb_items drop column if exists excludes_en;
alter table public.kb_items drop column if exists holdable;
revoke all on function public.kb_search_items(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.kb_search_items(uuid, text, integer) to service_role;
