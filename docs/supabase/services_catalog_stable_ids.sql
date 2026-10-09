-- services_catalog_stable_ids.sql
-- GIGO confirm v2: give every services_catalog row a stable, opaque id
-- (svc_ + 16 hex) and move its provenance from the position path
-- catalog.service.<n>.name to catalog.service.<id>.name.
-- One-time and idempotent: rows that already have a valid non-numeric id are
-- kept; a re-run finds nothing to do. Duplicate ids inside one catalogue: the
-- first keeps it, later rows get a new id.
-- Run after: tenant_field_confirm_v2.sql. Run before Brain's
-- scripts/backfillFactHashes.js (a service row's hash includes its id).
-- Staging first. Do NOT apply to production ALCR without Alvin's OK.
--
-- Desk assigns ids on every catalogue save from now on
-- (dashboard/src/lib/serviceIds.ts); this covers rows saved before that.

do $$
declare
  t record;
  r record;
  v_rows jsonb;
  v_renamed integer := 0;
  v_tenants integer := 0;
begin
  for t in
    select id, services_catalog
    from public.tenants
    where jsonb_typeof(services_catalog) = 'array'
      and jsonb_array_length(services_catalog) > 0
    for update
  loop
    create temporary table if not exists _svc_ids (
      ord integer primary key,
      old_valid boolean not null,
      new_id text,
      elem jsonb
    ) on commit drop;
    truncate _svc_ids;

    insert into _svc_ids (ord, old_valid, new_id, elem)
    select
      e.ord::integer,
      e.valid and e.dup_rank = 1,
      case
        when e.valid and e.dup_rank = 1 then e.elem->>'id'
        when jsonb_typeof(e.elem) = 'object'
          then 'svc_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
        else null
      end,
      e.elem
    from (
      select
        x.elem,
        x.ord,
        x.valid,
        row_number() over (
          partition by case when x.valid then x.elem->>'id' else x.ord::text end
          order by x.ord
        ) as dup_rank
      from (
        select
          a.elem,
          a.ord,
          (
            jsonb_typeof(a.elem) = 'object'
            and coalesce(a.elem->>'id', '') ~ '^[A-Za-z0-9_-]{1,64}$'
            and coalesce(a.elem->>'id', '') !~ '^[0-9]+$'
          ) as valid
        from jsonb_array_elements(t.services_catalog) with ordinality as a(elem, ord)
      ) x
    ) e;

    if not exists (
      select 1 from _svc_ids where not old_valid and new_id is not null
    ) then
      continue;
    end if;

    select jsonb_agg(
      case
        when s.new_id is null or s.old_valid then s.elem
        else s.elem || jsonb_build_object('id', s.new_id)
      end
      order by s.ord
    )
    into v_rows
    from _svc_ids s;

    update public.tenants set services_catalog = v_rows where id = t.id;
    v_tenants := v_tenants + 1;

    for r in
      select s.ord, s.new_id
      from _svc_ids s
      where not s.old_valid and s.new_id is not null
    loop
      if exists (
        select 1 from public.tenant_field_meta m
        where m.tenant_id = t.id
          and m.field_path = 'catalog.service.' || r.ord || '.name'
      ) and not exists (
        select 1 from public.tenant_field_meta m
        where m.tenant_id = t.id
          and m.field_path = 'catalog.service.' || r.new_id || '.name'
      ) then
        update public.tenant_field_meta m
           set field_path = 'catalog.service.' || r.new_id || '.name',
               value_hash = null,
               updated_at = now()
         where m.tenant_id = t.id
           and m.field_path = 'catalog.service.' || r.ord || '.name';
        perform public._tenant_append_field_history(
          t.id,
          'catalog.service.' || r.new_id || '.name',
          'backfill:service_ids',
          null,
          jsonb_build_object('field_path', 'catalog.service.' || r.ord || '.name'),
          jsonb_build_object('field_path', 'catalog.service.' || r.new_id || '.name')
        );
        v_renamed := v_renamed + 1;
      end if;
    end loop;
  end loop;

  raise notice 'services_catalog_stable_ids: % tenants updated, % provenance paths moved',
    v_tenants, v_renamed;
end;
$$;
