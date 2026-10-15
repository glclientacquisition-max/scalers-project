-- DRAFT for Platform review. NOT in supabase/migrations/ and NOT applied anywhere.
-- One-transaction write for SPOKEN_CATALOGUE_ON_SAVE (src/knowledge/spokenCatalogueOnSave.js).
-- Until this exists Brain falls back to two ordered writes (history row, then live doc).
-- Optional, additive: live_version / compile_error on tenants (Brain writes them only if present).

-- Brain probes exactly these names; rename both sides together if Platform prefers a prefix.
alter table public.tenants add column if not exists live_version integer;      -- spoken catalogue version now live
alter table public.tenants add column if not exists compile_error text;        -- short code of the last failed compile, null on success

create or replace function public.save_spoken_catalogue_version(
  p_tenant_id uuid, p_version integer, p_schema_version integer, p_source_hash text,
  p_status text, p_generator text, p_doc jsonb, p_issues jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.tenant_spoken_catalogue_versions
    (tenant_id, version, schema_version, source_hash, status, generator, doc, issues)
  values (p_tenant_id, p_version, p_schema_version, p_source_hash, p_status, p_generator, p_doc, coalesce(p_issues, '[]'::jsonb));
  update public.tenant_spoken_catalogue_versions set status = 'superseded'
   where tenant_id = p_tenant_id and status = 'draft' and version < p_version;
  update public.tenants set spoken_catalogue = p_doc, live_version = p_version, compile_error = null where id = p_tenant_id;
end $$;
revoke all on function public.save_spoken_catalogue_version(uuid, integer, integer, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.save_spoken_catalogue_version(uuid, integer, integer, text, text, text, jsonb, jsonb) to service_role;
