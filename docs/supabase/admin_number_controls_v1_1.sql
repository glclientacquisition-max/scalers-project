-- Admin number controls v1.1: attach-column parity for admin_move_number.
-- Same SQL as docs/supabase/admin_number_controls_v1_1.sql.
-- Run after supabase/migrations/20261027081642_admin_number_controls_v1.sql.
--
-- Why: assign_specific_did_to_tenant (live definition on staging, same as
-- docs/supabase/billing_data_layer.sql) writes, on attach:
--   pool:    status, tenant_id, assigned_at, quarantine_until, quarantined_at
--   tenants: sautikit_virtual_number
-- admin_restore_business_number already writes all of these (plus
-- winback_hold, and line_status per Ops). admin_move_number (target side)
-- wrote only tenant_id, assigned_at, last_tenant_id on the pool row; its
-- precondition (status assigned) made the others no-ops in practice, but this
-- makes the write explicit: status = 'assigned', quarantine_until = null,
-- quarantined_at = null, winback_hold = false. The tenant side already
-- matches (sautikit_virtual_number only; no billing or line_status change).
--
-- Replaces admin_move_number only; same signature, same grants.
-- ADDITIVE. ASCII-only. Safe to re-run. Rollback: re-run
-- supabase/migrations/20261027081642_admin_number_controls_v1.sql section 4
-- (or docs/supabase/admin_number_controls_v1_down.sql to drop everything).

create or replace function public.admin_move_number(
  p_e164 text,
  p_from_tenant uuid,
  p_to_tenant uuid,
  p_actor text,
  p_reason text,
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.sautikit_did_pool%rowtype;
  v_nine text;
  v_from public.tenants%rowtype;
  v_to public.tenants%rowtype;
  v_pool_before jsonb;
  v_from_before jsonb;
  v_to_before jsonb;
  v_pool_after jsonb;
  v_from_after jsonb;
  v_to_after jsonb;
  v_detail jsonb;
begin
  perform public._package_editor_actor(p_actor, p_reason);
  if p_confirm is distinct from true then
    raise exception 'confirm the change';
  end if;
  if p_from_tenant is null or p_to_tenant is null then
    raise exception 'both businesses are required';
  end if;
  if p_from_tenant = p_to_tenant then
    raise exception 'pick a different business to move the number to';
  end if;
  perform public._admin_did_refuse_protected(p_e164);
  v_nine := public._admin_did_last9(p_e164);
  if v_nine is null then
    raise exception 'not a phone number: %', coalesce(p_e164, '');
  end if;

  -- Lock order: pool row, then both businesses by id.
  select * into v_row from public.sautikit_did_pool
  where public._admin_did_last9(e164) = v_nine
  for update;
  if not found then
    raise exception 'number is not in our pool';
  end if;
  perform public._admin_did_refuse_protected(v_row.e164);

  perform 1 from public.tenants where id in (p_from_tenant, p_to_tenant) order by id for update;
  select * into v_from from public.tenants where id = p_from_tenant;
  if not found then
    raise exception 'business to move from not found';
  end if;
  select * into v_to from public.tenants where id = p_to_tenant;
  if not found then
    raise exception 'business to move to not found';
  end if;

  -- Idempotent: already moved.
  if v_row.status = 'assigned' and v_row.tenant_id = p_to_tenant
     and public._admin_did_last9(v_to.sautikit_virtual_number) = v_nine then
    return jsonb_build_object(
      'ok', true, 'action', 'move_number', 'noop', true, 'e164', v_row.e164,
      'pool', public._admin_did_pool_state(v_row.id),
      'from_tenant', public._admin_did_tenant_state(p_from_tenant),
      'to_tenant', public._admin_did_tenant_state(p_to_tenant));
  end if;

  if v_row.status <> 'assigned' or v_row.tenant_id is distinct from p_from_tenant
     or public._admin_did_last9(v_from.sautikit_virtual_number) is distinct from v_nine then
    raise exception 'number % is not the live number of the business to move from', v_row.e164;
  end if;
  if v_from.is_active is distinct from true or v_from.archived_at is not null then
    raise exception 'business to move from is archived or inactive';
  end if;
  if v_to.is_active is distinct from true or v_to.archived_at is not null then
    raise exception 'business to move to is archived or inactive';
  end if;
  if v_to.sautikit_virtual_number is not null and v_to.sautikit_virtual_number !~* '^pending:' then
    raise exception 'business to move to already has a number (%); no swaps', v_to.sautikit_virtual_number
      using hint = 'Release its number first.';
  end if;
  if exists (select 1 from public.sautikit_did_pool where tenant_id = p_to_tenant) then
    raise exception 'business to move to already holds a pool number; no swaps';
  end if;
  perform public._admin_did_assert_no_other_holder(v_row.e164, array[p_from_tenant, p_to_tenant]);

  v_pool_before := public._admin_did_pool_state(v_row.id);
  v_from_before := public._admin_did_tenant_state(p_from_tenant);
  v_to_before := public._admin_did_tenant_state(p_to_tenant);

  -- From first (frees the unique key), then to. line_status is left as is:
  -- 'pending:' is the no-line marker (line_status allows active|grace|suspended).
  update public.tenants
  set sautikit_virtual_number = 'pending:' || p_from_tenant::text
  where id = p_from_tenant;
  update public.tenants
  set sautikit_virtual_number = v_row.e164
  where id = p_to_tenant;
  -- Same attach columns as assign_specific_did_to_tenant (status, tenant_id,
  -- assigned_at, quarantine_until, quarantined_at), plus winback_hold like
  -- restore, plus last_tenant_id = the previous holder.
  update public.sautikit_did_pool
  set status = 'assigned', tenant_id = p_to_tenant, assigned_at = now(),
      quarantine_until = null, quarantined_at = null, winback_hold = false,
      last_tenant_id = p_from_tenant
  where id = v_row.id;

  v_pool_after := public._admin_did_pool_state(v_row.id);
  v_from_after := public._admin_did_tenant_state(p_from_tenant);
  v_to_after := public._admin_did_tenant_state(p_to_tenant);

  v_detail := jsonb_build_object(
    'e164', v_row.e164, 'reason', btrim(p_reason),
    'from_tenant_id', p_from_tenant, 'to_tenant_id', p_to_tenant,
    'pool', jsonb_build_object('before', v_pool_before, 'after', v_pool_after),
    'from_tenant', jsonb_build_object('before', v_from_before, 'after', v_from_after),
    'to_tenant', jsonb_build_object('before', v_to_before, 'after', v_to_after));
  -- One row per business so each business's audit view shows the move.
  perform public._billing_audit(btrim(p_actor), 'admin_move_number', p_from_tenant, v_detail || jsonb_build_object('side', 'from'));
  perform public._billing_audit(btrim(p_actor), 'admin_move_number', p_to_tenant, v_detail || jsonb_build_object('side', 'to'));

  return jsonb_build_object(
    'ok', true, 'action', 'move_number', 'noop', false, 'e164', v_row.e164,
    'pool', v_pool_after, 'from_tenant', v_from_after, 'to_tenant', v_to_after);
end;
$$;

revoke all on function public.admin_move_number(text, uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_move_number(text, uuid, uuid, text, text, boolean) to service_role;

comment on function public.admin_move_number(text, uuid, uuid, text, text, boolean) is
  'Super Admin: move a live number from one business to another (target has no number). No quarantine, no billing change. DB-only. Pool attach columns match assign_specific_did_to_tenant.';
