-- Same SQL as supabase/migrations/20261027130500_admin_number_controls_v1_2.sql.
-- Admin number controls v1.2: +254709221536 is releasable like any other number.
-- Alvin, 27 Oct 2026 15:54 EAT (relayed by Scalers Chief): "yes we want it release able".
-- Run after supabase/migrations/20261027082533_admin_number_controls_v1_1.sql.
--
-- Replaces admin_restore_business_number, admin_lift_quarantine and admin_move_number with the
-- same bodies minus every `perform public._admin_did_refuse_protected(...)` call (same
-- signatures, SECURITY DEFINER, search_path public, pg_temp). Everything else in them is unchanged:
-- actor + reason (_package_editor_actor), p_confirm, digit-match holder check, audit rows.
-- Unlock, typed reason and the confirm sheet stay in the Admin app.
--
-- Then DROPS the two helpers _admin_did_is_protected(text) and _admin_did_refuse_protected(text).
-- Why drop rather than make them return false: after this file nothing calls them (checked: on
-- staging and prod only these three RPCs referenced them), and a helper that says "protected"
-- but always answers false is a trap for the next caller. plpgsql resolves calls at run time,
-- so any forgotten caller fails loudly (42883) instead of silently passing.
-- _admin_did_last9 and the other _admin_did_* helpers stay.
--
-- The win-back hold functions (#885) never carried the refusal; untouched.
-- Grants: service_role only, explicit revoke from public, anon, authenticated.
-- ASCII-only. Safe to re-run. Rollback (restores the refusal):
--   docs/supabase/admin_number_controls_v1_2_down.sql

do $$
begin
  if to_regprocedure('public._admin_did_last9(text)') is null then
    raise exception 'apply admin_number_controls_v1 (20261027081642) first';
  end if;
end;
$$;

-- 1. Restore a business's own number (no protected-line refusal) ------------
create or replace function public.admin_restore_business_number(
  p_tenant_id uuid,
  p_actor text,
  p_reason text,
  p_confirm boolean,
  p_e164 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.sautikit_did_pool%rowtype;
  v_t public.tenants%rowtype;
  v_sub record;
  v_nine text;
  v_nonpay boolean;
  v_pool_before jsonb;
  v_tenant_before jsonb;
  v_pool_after jsonb;
  v_tenant_after jsonb;
begin
  perform public._package_editor_actor(p_actor, p_reason);
  if p_confirm is distinct from true then
    raise exception 'confirm the change';
  end if;
  if p_tenant_id is null then
    raise exception 'business id required';
  end if;
  if p_e164 is not null then
    v_nine := public._admin_did_last9(p_e164);
    if v_nine is null then
      raise exception 'not a phone number: %', p_e164;
    end if;
  end if;

  -- Idempotent: the business already has this (or its) number back.
  select * into v_row from public.sautikit_did_pool
  where tenant_id = p_tenant_id
  for update;
  if found then
    if v_nine is not null and public._admin_did_last9(v_row.e164) <> v_nine then
      raise exception 'business already has another number (%)', v_row.e164;
    end if;
    select * into v_t from public.tenants where id = p_tenant_id;
    if v_row.status = 'assigned'
       and public._admin_did_last9(v_t.sautikit_virtual_number) = public._admin_did_last9(v_row.e164) then
      return jsonb_build_object(
        'ok', true, 'action', 'restore_business_number', 'noop', true,
        'e164', v_row.e164,
        'pool', public._admin_did_pool_state(v_row.id),
        'tenant', public._admin_did_tenant_state(p_tenant_id));
    end if;
    raise exception 'business already has a pool number (%, status %)', v_row.e164, v_row.status;
  end if;

  -- The number to bring back: the one named, or the latest one released from
  -- this business.
  if v_nine is not null then
    select * into v_row from public.sautikit_did_pool
    where public._admin_did_last9(e164) = v_nine
    for update;
  else
    select * into v_row from public.sautikit_did_pool
    where last_tenant_id = p_tenant_id and tenant_id is null and status = 'quarantine'
    order by quarantined_at desc nulls last
    limit 1
    for update;
  end if;
  if not found then
    raise exception 'no number in our pool to restore for this business'
      using hint = 'A number released at SautiKit is a re-buy, not a restore.';
  end if;

  if v_row.status = 'disabled' then
    raise exception 'number % is disabled; restore refused', v_row.e164;
  elsif v_row.status = 'available' then
    raise exception 'number % is already available', v_row.e164
      using hint = 'Use Assign (assign_specific_did_to_tenant).';
  elsif v_row.status <> 'quarantine' or v_row.tenant_id is not null then
    raise exception 'number % is % for another business; restore refused', v_row.e164, v_row.status;
  end if;
  if v_row.last_tenant_id is distinct from p_tenant_id then
    raise exception 'number % was released from another business; restore refused', v_row.e164;
  end if;

  select * into v_t from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'business not found';
  end if;
  if v_t.is_active is distinct from true or v_t.archived_at is not null then
    raise exception 'business is archived or inactive; restore the business first';
  end if;
  if v_t.suspended_at is not null then
    raise exception 'business is suspended by an admin; unsuspend it first';
  end if;
  if v_t.sautikit_virtual_number is not null and v_t.sautikit_virtual_number !~* '^pending:' then
    raise exception 'business already has a number (%)', v_t.sautikit_virtual_number;
  end if;

  -- Non-payment ladder (line closed for non-payment): the ladder stamps
  -- billing_suspended_at / billing_cancelled_at (cleared again on active), or
  -- refresh_line_status set line_status suspended without an admin
  -- suspension. Then the business must be billing_status active again.
  select s.billing_status, s.billing_suspended_at, s.billing_cancelled_at
  into v_sub
  from public.tenant_subscriptions s
  where s.tenant_id = p_tenant_id;
  v_nonpay := coalesce(v_sub.billing_status in ('past_due', 'grace', 'suspended', 'cancelled'), false)
    or v_sub.billing_suspended_at is not null
    or v_sub.billing_cancelled_at is not null
    or (v_t.line_status = 'suspended' and v_t.suspended_at is null);
  if v_nonpay and v_sub.billing_status is distinct from 'active' then
    raise exception 'line was closed for non-payment; the business must be paid up (billing status active) first';
  end if;

  perform public._admin_did_assert_no_other_holder(v_row.e164, array[p_tenant_id]);

  v_pool_before := public._admin_did_pool_state(v_row.id);
  v_tenant_before := public._admin_did_tenant_state(p_tenant_id);

  update public.sautikit_did_pool
  set status = 'assigned', tenant_id = p_tenant_id, assigned_at = now(),
      quarantine_until = null, quarantined_at = null, winback_hold = false
  where id = v_row.id;

  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants
  set sautikit_virtual_number = v_row.e164, line_status = 'active'
  where id = p_tenant_id;
  perform set_config('scalers.wallet_write', '', true);

  v_pool_after := public._admin_did_pool_state(v_row.id);
  v_tenant_after := public._admin_did_tenant_state(p_tenant_id);

  perform public._billing_audit(btrim(p_actor), 'admin_restore_business_number', p_tenant_id,
    jsonb_build_object(
      'e164', v_row.e164, 'reason', btrim(p_reason), 'non_payment_ladder', v_nonpay,
      'pool', jsonb_build_object('before', v_pool_before, 'after', v_pool_after),
      'tenant', jsonb_build_object('before', v_tenant_before, 'after', v_tenant_after)));

  return jsonb_build_object(
    'ok', true, 'action', 'restore_business_number', 'noop', false,
    'e164', v_row.e164, 'pool', v_pool_after, 'tenant', v_tenant_after);
end;
$$;

-- 2. Lift a quarantine early (no protected-line refusal) ---------------------
create or replace function public.admin_lift_quarantine(
  p_e164 text,
  p_actor text,
  p_reason text,
  p_confirm boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.sautikit_did_pool%rowtype;
  v_nine text;
  v_last record;
  v_pool_before jsonb;
  v_pool_after jsonb;
  v_last_state jsonb;
begin
  perform public._package_editor_actor(p_actor, p_reason);
  v_nine := public._admin_did_last9(p_e164);
  if v_nine is null then
    raise exception 'not a phone number: %', coalesce(p_e164, '');
  end if;

  select * into v_row from public.sautikit_did_pool
  where public._admin_did_last9(e164) = v_nine
  for update;
  if not found then
    raise exception 'number is not in our pool';
  end if;

  if v_row.status = 'available' and v_row.tenant_id is null then
    return jsonb_build_object(
      'ok', true, 'action', 'lift_quarantine', 'noop', true,
      'e164', v_row.e164, 'pool', public._admin_did_pool_state(v_row.id));
  end if;
  if v_row.status <> 'quarantine' or v_row.tenant_id is not null then
    raise exception 'number % is %, not in quarantine', v_row.e164, v_row.status;
  end if;

  if v_row.last_tenant_id is not null then
    select t.is_active, t.archived_at, t.sautikit_virtual_number
    into v_last
    from public.tenants t where t.id = v_row.last_tenant_id;
    if found
       and v_last.is_active is true
       and v_last.archived_at is null
       and (v_last.sautikit_virtual_number is null or v_last.sautikit_virtual_number ~* '^pending:')
       and p_confirm is distinct from true then
      raise exception 'its previous business is still active and has no line'
        using hint = 'Use restore (admin_restore_business_number) to give it back, or confirm to free the number anyway.';
    end if;
    v_last_state := public._admin_did_tenant_state(v_row.last_tenant_id);
  end if;

  v_pool_before := public._admin_did_pool_state(v_row.id);

  update public.sautikit_did_pool
  set status = 'available', tenant_id = null, assigned_at = null,
      quarantine_until = null, quarantined_at = null, winback_hold = false
  where id = v_row.id;

  v_pool_after := public._admin_did_pool_state(v_row.id);

  perform public._billing_audit(btrim(p_actor), 'admin_lift_quarantine', v_row.last_tenant_id,
    jsonb_build_object(
      'e164', v_row.e164, 'reason', btrim(p_reason), 'confirmed', coalesce(p_confirm, false),
      'pool', jsonb_build_object('before', v_pool_before, 'after', v_pool_after),
      'last_tenant', jsonb_build_object('before', v_last_state, 'after', v_last_state)));

  return jsonb_build_object(
    'ok', true, 'action', 'lift_quarantine', 'noop', false,
    'e164', v_row.e164, 'pool', v_pool_after);
end;
$$;

-- 3. Move a number (v1.1 attach parity kept; no protected-line refusal) -------
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

-- 4. Drop the protected-line helpers (no callers left) ------------------------
drop function if exists public._admin_did_refuse_protected(text);
drop function if exists public._admin_did_is_protected(text);

-- 5. Grants: service role only (PUBLIC still gets EXECUTE by default) --------
revoke all on function public.admin_restore_business_number(uuid, text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.admin_lift_quarantine(text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_move_number(text, uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_restore_business_number(uuid, text, text, boolean, text) to service_role;
grant execute on function public.admin_lift_quarantine(text, text, text, boolean) to service_role;
grant execute on function public.admin_move_number(text, uuid, uuid, text, text, boolean) to service_role;
