-- v2 Knowledge Base paste import with Replace (kb_v2), version 2026-10-28.3. Apply AFTER kb_v2_item_states.sql (2026-10-28.2).
-- Desk "Paste a list": the default stays append/upsert. Replace = the pasted list becomes the whole list for that kind:
-- rows of the same kind that are not in the paste are soft-removed (status 'hidden', kept for history and undo).
-- One function call = one transaction: a stale row (row_version conflict) or an empty Replace rolls everything back.
-- ADDITIVE (new function only). Safe to re-run. Rollback: docs/supabase/kb_v2_paste_replace_down.sql.
-- Staging first; prod only on Alvin's yes.

create or replace function public.kb_import_items(p_tenant uuid, p_kind text, p_items jsonb, p_replace boolean default false)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_res jsonb; v_hidden integer := 0; v_items jsonb := coalesce(p_items, '[]'::jsonb);
begin
  if p_tenant is null or p_kind is null or p_kind not in ('service', 'product', 'package') then
    raise exception 'kb_import_items: tenant and kind (service, product, package) required';
  end if;
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'kb_import_items: items array required';
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) e where coalesce(e->>'kind', p_kind) <> p_kind) then
    raise exception 'kb_import_items: every item must be kind %', p_kind;
  end if;
  if p_replace and jsonb_array_length(v_items) = 0 then
    raise exception 'kb_import_items: replace needs at least one item';
  end if;
  v_res := public.kb_upsert_items(p_tenant, v_items, '[]'::jsonb, false, null);
  if p_replace then
    if jsonb_array_length(coalesce(v_res->'conflicts', '[]'::jsonb)) > 0 then
      raise exception 'kb_import_items: conflict on %', v_res->'conflicts' using errcode = '40001';
    end if;
    update public.kb_items k set status = 'hidden', row_version = k.row_version + 1
    where k.tenant_id = p_tenant and k.kind = p_kind and k.status <> 'hidden'
      and not exists (select 1 from jsonb_array_elements(v_items) e where e->>'id' = k.id);
    get diagnostics v_hidden = row_count;
  end if;
  return jsonb_set(v_res, '{hidden}', to_jsonb(v_hidden));
end;
$$;

revoke all on function public.kb_import_items(uuid, text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.kb_import_items(uuid, text, jsonb, boolean) to service_role;
