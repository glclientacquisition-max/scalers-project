-- STAGING ONLY (scalers-staging, sgcdncjxauhsbunobmob). Never run on prod ALCR.
-- dnd_reset_owner_confirms.sql
-- Fact-confirm PR 1: put the Done and Dusted test tenant's owner-confirmed
-- facts back to "Check this" so the owner reviews them through the drawer.
-- Whole-section saves under the P0 rules confirmed them in bulk.
--
-- Every owner row for D&D steps down to source = seed with no confirm and no
-- value_hash, and gets one history row. Values on tenants are untouched.
-- Works before or after tenant_field_confirm_v2.sql (value_hash optional).
-- Idempotent: a re-run finds no owner rows. One transaction.
-- Other staging tenants: Brain runs scripts/backfillFactHashes.js instead.

begin;

do $$
declare
  v_tenant constant uuid := 'df4ad9d8-28ff-4810-b1e6-94f5495472b0';
  v_has_hash boolean;
  v_n integer;
begin
  -- Refuse anywhere but staging: the live customer is only on prod.
  if exists (select 1 from public.tenants where business_name ilike 'Aris%') then
    raise exception 'refusing: this looks like production (Aris tenant present)';
  end if;
  if not exists (
    select 1 from public.tenants
    where id = v_tenant and business_name ilike 'Done and Dusted%'
  ) then
    raise exception 'refusing: Done and Dusted staging tenant % not found', v_tenant;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tenant_field_meta'
      and column_name = 'value_hash'
  ) into v_has_hash;

  insert into public.tenant_field_history (tenant_id, field_path, actor, source, old_value, new_value)
  select
    m.tenant_id,
    m.field_path,
    'reset:dnd_fact_review',
    'seed',
    to_jsonb(m),
    to_jsonb(m) || jsonb_build_object(
      'source', 'seed',
      'source_ref', 'reset:dnd_fact_review',
      'confirmed_by', null,
      'confirmed_at', null,
      'value_hash', null
    )
  from public.tenant_field_meta m
  where m.tenant_id = v_tenant
    and m.source = 'owner';

  update public.tenant_field_meta m
     set source = 'seed',
         source_ref = 'reset:dnd_fact_review',
         confirmed_by = null,
         confirmed_at = null,
         updated_at = now()
   where m.tenant_id = v_tenant
     and m.source = 'owner';
  get diagnostics v_n = row_count;

  if v_has_hash then
    execute 'update public.tenant_field_meta set value_hash = null
             where tenant_id = $1 and source_ref = ''reset:dnd_fact_review''
               and value_hash is not null'
      using v_tenant;
  end if;

  raise notice 'D&D fact reset: % owner rows now Check this', v_n;
end;
$$;

-- Expect 0 owner rows for D&D afterwards.
select source, count(*)
from public.tenant_field_meta
where tenant_id = 'df4ad9d8-28ff-4810-b1e6-94f5495472b0'
group by source;

commit;
