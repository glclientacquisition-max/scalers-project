-- DRAFT for Platform review. NOT in supabase/migrations/ and NOT applied anywhere.
-- One-transaction write for SPOKEN_CATALOGUE_ON_SAVE (src/knowledge/spokenCatalogueOnSave.js).
-- Until this exists Brain falls back to ordered writes (history row, then live doc).
--
-- Go-live decision (Alvin): a compile on owner Save GOES LIVE. Every successful compile writes
-- tenants.spoken_catalogue and tenants.live_version. The output is grounded (names/prices only
-- from the tenant's own rows; owner edits carried while their row is unchanged). The version row
-- itself stays status 'draft' (generator 'rules' or 'ai+rules') until an owner approves it in
-- Desk; approval is a review mark, not a gate on going live.
-- ADDITIVE and safe to re-run.

set lock_timeout = '3s';

alter table public.tenants add column if not exists live_version integer;  -- spoken catalogue version now live

alter table public.tenant_spoken_catalogue_versions add column if not exists compile_error text;
do $$ begin
  alter table public.tenant_spoken_catalogue_versions
    add constraint tenant_spoken_catalogue_versions_compile_error_len check (compile_error is null or length(compile_error) <= 200);
exception when duplicate_object then null; end $$;

-- At most one approved version per tenant.
create unique index if not exists tenant_spoken_catalogue_versions_one_approved
  on public.tenant_spoken_catalogue_versions (tenant_id) where status = 'approved';

create or replace function public.save_spoken_catalogue_version(
  p_tenant_id uuid, p_version integer, p_schema_version integer, p_source_hash text,
  p_status text, p_generator text, p_doc jsonb, p_issues jsonb, p_compile_error text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'tenant % not found', p_tenant_id using errcode = 'P0002';
  end if;
  if p_status = 'approved' then
    update public.tenant_spoken_catalogue_versions set status = 'superseded'
     where tenant_id = p_tenant_id and status = 'approved';
  end if;
  insert into public.tenant_spoken_catalogue_versions
    (tenant_id, version, schema_version, source_hash, status, generator, doc, issues, compile_error)
  values (p_tenant_id, p_version, p_schema_version, p_source_hash, p_status, p_generator, p_doc,
          coalesce(p_issues, '[]'::jsonb), left(p_compile_error, 200));
  update public.tenant_spoken_catalogue_versions set status = 'superseded'
   where tenant_id = p_tenant_id and status = 'draft' and version < p_version;
  -- goes live on every successful compile (see header)
  update public.tenants set spoken_catalogue = p_doc, live_version = p_version where id = p_tenant_id;
end $$;
revoke all on function public.save_spoken_catalogue_version(uuid, integer, integer, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_spoken_catalogue_version(uuid, integer, integer, text, text, text, jsonb, jsonb, text) to service_role;
