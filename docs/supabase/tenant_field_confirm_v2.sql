-- tenant_field_confirm_v2.sql
-- GIGO confirm v2: value_hash on tenant_field_meta, batch owner confirm, reopen.
-- Run after: tenant_field_provenance.sql. Idempotent; safe to re-run.
-- Staging first. Do NOT apply to production ALCR without Alvin's OK.
--
-- value_hash = sha256 hex (64 lowercase chars) of the canonical fact value
-- (Brain: dashboard/src/lib/factHash.ts, src/conversation/factHash.js),
-- hashed from the SAVED tenants row. Null or empty means unconfirmed when
-- FACT_HASH_MODE=on. With the flag off, readers keep the P0 rules and ignore it.
--
-- Apply order for a database that already has P0:
--   1. this file
--   2. services_catalog_stable_ids.sql (ids before hashes: a service row's hash
--      includes its id)
--   3. Brain: node scripts/backfillFactHashes.js (owner rows with no value_hash)

-- ---------------------------------------------------------------------------
-- Column
-- ---------------------------------------------------------------------------
alter table public.tenant_field_meta
  add column if not exists value_hash text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tenant_field_meta_value_hash_check'
      and conrelid = 'public.tenant_field_meta'::regclass
  ) then
    alter table public.tenant_field_meta
      add constraint tenant_field_meta_value_hash_check
      check (value_hash is null or value_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$$;

comment on column public.tenant_field_meta.value_hash is
  'Confirm v2: sha256 hex of the canonical fact value the owner confirmed. Null = unconfirmed (FACT_HASH_MODE=on).';

-- ---------------------------------------------------------------------------
-- RPC: confirm_tenant_fields (batch, all or nothing)
-- ---------------------------------------------------------------------------
-- One statement upserts every path and appends one history row per path, so
-- either all of it lands or none of it does. Rejects: no tenant, non-member,
-- no user, null arrays, arrays of different length, more than 500 paths, a
-- blank or duplicate path, and a null or malformed hash.
create or replace function public.confirm_tenant_fields(
  p_tenant_id uuid,
  p_paths text[],
  p_hashes text[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n integer;
  v_count integer;
begin
  perform public._tenant_assert_member(p_tenant_id);
  if v_uid is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'user required';
  end if;
  if p_paths is null or p_hashes is null then
    raise exception 'paths and hashes required';
  end if;
  if coalesce(array_ndims(p_paths), 1) <> 1 or coalesce(array_ndims(p_hashes), 1) <> 1 then
    raise exception 'paths and hashes must be flat arrays';
  end if;

  v_n := coalesce(cardinality(p_paths), 0);
  if v_n <> coalesce(cardinality(p_hashes), 0) then
    raise exception 'paths and hashes differ in length';
  end if;
  if v_n = 0 then
    return 0;
  end if;
  if v_n > 500 then
    raise exception 'too many paths (max 500)';
  end if;

  if exists (
    select 1 from unnest(p_paths) as u(path)
    where u.path is null or trim(u.path) = ''
  ) then
    raise exception 'field_path required';
  end if;
  if exists (
    select 1 from unnest(p_hashes) as u(hash)
    where u.hash is null or u.hash !~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'value_hash must be 64 lowercase hex characters';
  end if;
  if (select count(distinct trim(u.path)) from unnest(p_paths) as u(path)) <> v_n then
    raise exception 'duplicate field_path';
  end if;

  with input as (
    select trim(u.path) as field_path, u.hash as value_hash
    from unnest(p_paths, p_hashes) as u(path, hash)
  ),
  prev as (
    select m.*
    from public.tenant_field_meta m
    join input i on i.field_path = m.field_path
    where m.tenant_id = p_tenant_id
  ),
  up as (
    insert into public.tenant_field_meta as m (
      tenant_id,
      field_path,
      source,
      confirmed_by,
      confirmed_at,
      last_verified_at,
      value_hash,
      updated_at
    )
    select p_tenant_id, i.field_path, 'owner', v_uid, now(), now(), i.value_hash, now()
    from input i
    on conflict (tenant_id, field_path) do update
      set source = 'owner',
          confirmed_by = excluded.confirmed_by,
          confirmed_at = excluded.confirmed_at,
          last_verified_at = excluded.last_verified_at,
          value_hash = excluded.value_hash,
          updated_at = now()
    returning m.*
  )
  insert into public.tenant_field_history (
    tenant_id,
    field_path,
    actor,
    source,
    old_value,
    new_value
  )
  select
    p_tenant_id,
    up.field_path,
    'desk',
    'owner',
    to_jsonb(prev),
    to_jsonb(up)
  from up
  left join prev on prev.field_path = up.field_path;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.confirm_tenant_fields(uuid, text[], text[]) from public;
revoke all on function public.confirm_tenant_fields(uuid, text[], text[]) from anon;
grant execute on function public.confirm_tenant_fields(uuid, text[], text[]) to authenticated, service_role;

comment on function public.confirm_tenant_fields(uuid, text[], text[]) is
  'Confirm v2: owner-confirm up to 500 paths with value hashes in one all-or-nothing batch, with history.';

-- ---------------------------------------------------------------------------
-- RPC: reopen_tenant_field
-- ---------------------------------------------------------------------------
-- Clears the confirm on one path (value cleared, or a row the owner should
-- review again). The source steps down from owner to seed so P0 readers also
-- read it as "Check this". No row: nothing to reopen, returns null.
create or replace function public.reopen_tenant_field(
  p_tenant_id uuid,
  p_field_path text
)
returns public.tenant_field_meta
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text := trim(coalesce(p_field_path, ''));
  v_prev public.tenant_field_meta;
  v_row public.tenant_field_meta;
begin
  perform public._tenant_assert_member(p_tenant_id);
  if v_path = '' then
    raise exception 'field_path required';
  end if;

  select * into v_prev
  from public.tenant_field_meta m
  where m.tenant_id = p_tenant_id
    and m.field_path = v_path
  for update;
  if not found then
    return null;
  end if;

  update public.tenant_field_meta m
     set source = case when m.source = 'owner' then 'seed' else m.source end,
         source_ref = case when m.source = 'owner' then 'reopen:desk' else m.source_ref end,
         confirmed_by = null,
         confirmed_at = null,
         value_hash = null,
         updated_at = now()
   where m.tenant_id = p_tenant_id
     and m.field_path = v_path
  returning * into v_row;

  perform public._tenant_append_field_history(
    p_tenant_id,
    v_path,
    'desk',
    v_row.source,
    to_jsonb(v_prev),
    to_jsonb(v_row)
  );

  return v_row;
end;
$$;

revoke all on function public.reopen_tenant_field(uuid, text) from public;
revoke all on function public.reopen_tenant_field(uuid, text) from anon;
grant execute on function public.reopen_tenant_field(uuid, text) to authenticated, service_role;

comment on function public.reopen_tenant_field(uuid, text) is
  'Confirm v2: clear owner confirm and value_hash on one path (owner steps down to seed), with history.';
