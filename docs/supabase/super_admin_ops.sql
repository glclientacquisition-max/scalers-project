-- Super Admin ops helpers (run after did_number_pool.sql)
-- - release_did_from_business: return DID to pool as available
-- - remove_business_and_release_did: delete a business + its calls, free the DID

create or replace function public.release_did_from_business(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e164 text;
begin
  if p_tenant_id is null then
    raise exception 'business id required';
  end if;

  select sautikit_virtual_number into v_e164
  from public.tenants
  where id = p_tenant_id;

  if v_e164 is null then
    raise exception 'business not found';
  end if;

  -- Free pool row(s) for this business.
  update public.sautikit_did_pool
  set
    status = 'available',
    tenant_id = null,
    assigned_at = null
  where tenant_id = p_tenant_id
     or (e164 = v_e164 and v_e164 not like 'pending:%');

  -- Business waits for a new number.
  update public.tenants
  set sautikit_virtual_number = 'pending:' || p_tenant_id::text
  where id = p_tenant_id;

  if v_e164 like 'pending:%' then
    return null;
  end if;
  return v_e164;
end;
$$;

create or replace function public.remove_business_and_release_did(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e164 text;
  v_released text;
begin
  if p_tenant_id is null then
    raise exception 'business id required';
  end if;

  select sautikit_virtual_number into v_e164
  from public.tenants
  where id = p_tenant_id;

  if v_e164 is null then
    raise exception 'business not found';
  end if;

  -- Release DID first (while tenant row still exists for FK clarity).
  v_released := public.release_did_from_business(p_tenant_id);

  -- Clear pool FK before tenant delete (release already nulls tenant_id).
  update public.sautikit_did_pool
  set tenant_id = null
  where tenant_id = p_tenant_id;

  delete from public.tenant_members where tenant_id = p_tenant_id;

  delete from public.transcripts
  where call_id in (select id from public.calls where tenant_id = p_tenant_id);

  delete from public.calls where tenant_id = p_tenant_id;

  delete from public.tenants where id = p_tenant_id;

  return coalesce(v_released, v_e164);
end;
$$;

-- One-shot: remove Jirani Home Services demo and free +254709221536
-- (safe to re-run; no-op if already gone)
do $$
declare
  v_id uuid;
begin
  select id into v_id
  from public.tenants
  where business_name ilike 'Jirani Home Services'
  order by created_at asc
  limit 1;

  if v_id is not null then
    perform public.remove_business_and_release_did(v_id);
  end if;

  -- Ensure smoke DID is available even if tenant row was already gone.
  insert into public.sautikit_did_pool (e164, status, notes)
  values ('+254709221536', 'available', 'Released from Jirani demo — ready for next business')
  on conflict (e164) do update
  set
    status = 'available',
    tenant_id = null,
    assigned_at = null,
    notes = coalesce(public.sautikit_did_pool.notes, excluded.notes);
end;
$$;
