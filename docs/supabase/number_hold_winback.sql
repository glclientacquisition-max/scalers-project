-- Number hold and win-back (plan section 11).
-- STATUS: APPLIED to staging (sgcdncjxauhsbunobmob) 23 Oct 2026 00:15 EAT, migration 20261022211546
--   number_hold_winback. PROD (fjxcdccgyhnvnnlnovcl): PENDING, waits for Alvin's explicit yes.
--   Settings after apply: staging was set to On, 14 days, KSh 1,000 fee on 24 Oct 2026 11:50 EAT through
--   admin_set_number_hold_settings (audited). Alvin chose the same for prod (27 Oct 2026); the fee is set
--   by that RPC after this file runs, not by a column default (the column default stays null = none).
-- Apply only with Alvin's explicit go, staging first, as one transaction, after billing_data_layer.sql,
-- billing_payment_runtime_flags.sql and package_version_editor.sql (for _package_editor_actor).
-- Service role only. Idempotent column adds and function replace. Undo: number_hold_winback_down.sql.
--
-- What it adds
--   * billing_lifecycle_settings.hold_winback_enabled (default true), reactivation_fee_kes (default null =
--     none; no amount is set here), number_hold_days (default 14).
--   * sautikit_did_pool.winback_hold: a quarantine row held for its previous business (last_tenant_id).
--   * A guard: while a win-back hold runs, the number can only be assigned back to last_tenant_id.
--   * admin_set_number_hold_settings: switch, fee and default length, with actor, reason, confirm, audit.
--   * admin_hold_number_for_winback: turns a released (quarantine) number into a win-back hold.
--   * admin_end_number_hold: ends a hold early; the number becomes available now.
--   * admin_restore_held_number: restores a held number to its previous business only, which must be on a
--     package again (billing_status active). Reactivation fee billing is NOT here: it is a line on the
--     package invoice (Invoicing slice), and the fee stays none until Alvin sets an amount.
--   * number_on_winback_hold(e164): read for Voice, so a held number plays the line-unavailable message.
-- Fresh codes are checked by the server action before any of these run (slice 6); SQL records the actor.

-- 1. Settings ---------------------------------------------------------------
alter table public.billing_lifecycle_settings
  add column if not exists hold_winback_enabled boolean not null default true,
  add column if not exists reactivation_fee_kes numeric(12, 2),
  add column if not exists number_hold_days integer not null default 14;

alter table public.billing_lifecycle_settings
  drop constraint if exists billing_lifecycle_settings_reactivation_fee_check;
alter table public.billing_lifecycle_settings
  add constraint billing_lifecycle_settings_reactivation_fee_check
    check (reactivation_fee_kes is null or reactivation_fee_kes > 0);

alter table public.billing_lifecycle_settings
  drop constraint if exists billing_lifecycle_settings_number_hold_days_check;
alter table public.billing_lifecycle_settings
  add constraint billing_lifecycle_settings_number_hold_days_check
    check (number_hold_days between 1 and 90);

comment on column public.billing_lifecycle_settings.hold_winback_enabled is
  'Super Admin: number hold and win-back on or off. Off: release goes to the pool after the normal wait; owner self-recovery hidden; running holds run to their end.';
comment on column public.billing_lifecycle_settings.reactivation_fee_kes is
  'Super Admin: reactivation fee in KSh, billed as a line on the win-back package invoice. Null = none (default).';
comment on column public.billing_lifecycle_settings.number_hold_days is
  'Super Admin: default win-back hold length in days (14). Editable per release.';

-- 2. Pool flag and guard ----------------------------------------------------
alter table public.sautikit_did_pool
  add column if not exists winback_hold boolean not null default false;

comment on column public.sautikit_did_pool.winback_hold is
  'True while a quarantine row is held for last_tenant_id to win back. Only that business can take it until quarantine_until.';

create or replace function public.sautikit_did_pool_winback_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and old.status = 'quarantine'
     and old.winback_hold
     and old.quarantine_until is not null
     and old.quarantine_until > now()
     and new.status = 'assigned'
     and new.tenant_id is distinct from old.last_tenant_id
  then
    raise exception 'number is held for its previous business until %', old.quarantine_until;
  end if;
  if new.status <> 'quarantine' then
    new.winback_hold := false;
  end if;
  return new;
end;
$$;

drop trigger if exists sautikit_did_pool_winback_guard on public.sautikit_did_pool;
create trigger sautikit_did_pool_winback_guard
  before update on public.sautikit_did_pool
  for each row execute function public.sautikit_did_pool_winback_guard();

-- 3. Settings writer --------------------------------------------------------
create or replace function public.admin_set_number_hold_settings(
  p_enabled boolean,
  p_fee_kes numeric,
  p_clear_fee boolean,
  p_days integer,
  p_actor text,
  p_reason text,
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  perform public._package_editor_actor(p_actor, p_reason);
  if p_confirm is distinct from true then
    raise exception 'confirm the change';
  end if;
  if p_fee_kes is not null and p_fee_kes <= 0 then
    raise exception 'reactivation fee must be above zero, or cleared for none';
  end if;
  if p_days is not null and (p_days < 1 or p_days > 90) then
    raise exception 'hold length must be 1 to 90 days';
  end if;

  select jsonb_build_object('hold_winback_enabled', hold_winback_enabled, 'reactivation_fee_kes', reactivation_fee_kes, 'number_hold_days', number_hold_days)
  into v_before from public.billing_lifecycle_settings where id = 1 for update;
  if not found then
    raise exception 'billing settings are missing';
  end if;

  update public.billing_lifecycle_settings
  set hold_winback_enabled = coalesce(p_enabled, hold_winback_enabled),
      reactivation_fee_kes = case when p_clear_fee then null else coalesce(p_fee_kes, reactivation_fee_kes) end,
      number_hold_days = coalesce(p_days, number_hold_days),
      updated_at = now()
  where id = 1;

  select jsonb_build_object('hold_winback_enabled', hold_winback_enabled, 'reactivation_fee_kes', reactivation_fee_kes, 'number_hold_days', number_hold_days)
  into v_after from public.billing_lifecycle_settings where id = 1;

  perform public._billing_audit(btrim(p_actor), 'set_number_hold_settings', null,
    jsonb_build_object('before', v_before, 'after', v_after, 'reason', btrim(p_reason)));
  return v_after;
end;
$$;

-- 4. Start a win-back hold on a released number ----------------------------
create or replace function public.admin_hold_number_for_winback(
  p_e164 text,
  p_days integer,
  p_actor text,
  p_reason text,
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.sautikit_did_pool%rowtype;
  v_on boolean;
  v_days integer;
  v_until timestamptz;
begin
  perform public._package_editor_actor(p_actor, p_reason);
  if p_confirm is distinct from true then
    raise exception 'confirm the change';
  end if;
  select hold_winback_enabled, number_hold_days into v_on, v_days from public.billing_lifecycle_settings where id = 1;
  if v_on is distinct from true then
    raise exception 'hold and win-back is off';
  end if;
  v_days := coalesce(p_days, v_days, 14);
  if v_days < 1 or v_days > 90 then
    raise exception 'hold length must be 1 to 90 days';
  end if;

  select * into v_row from public.sautikit_did_pool where e164 = nullif(btrim(p_e164), '') for update;
  if not found then
    raise exception 'number is not in the pool';
  end if;
  if v_row.status <> 'quarantine' or v_row.last_tenant_id is null then
    raise exception 'only a released number with a previous business can be held';
  end if;

  v_until := now() + make_interval(days => v_days);
  update public.sautikit_did_pool
  set winback_hold = true, quarantine_until = v_until, quarantined_at = coalesce(quarantined_at, now())
  where e164 = v_row.e164;

  perform public._billing_audit(btrim(p_actor), 'hold_number_for_winback', v_row.last_tenant_id,
    jsonb_build_object('e164', v_row.e164, 'until', v_until, 'days', v_days, 'reason', btrim(p_reason)));
  return jsonb_build_object('e164', v_row.e164, 'tenant_id', v_row.last_tenant_id, 'until', v_until);
end;
$$;

-- 5. End a hold early ------------------------------------------------------
create or replace function public.admin_end_number_hold(
  p_e164 text,
  p_actor text,
  p_reason text,
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.sautikit_did_pool%rowtype;
begin
  perform public._package_editor_actor(p_actor, p_reason);
  if p_confirm is distinct from true then
    raise exception 'confirm the change';
  end if;
  select * into v_row from public.sautikit_did_pool where e164 = nullif(btrim(p_e164), '') for update;
  if not found then
    raise exception 'number is not in the pool';
  end if;
  if v_row.status <> 'quarantine' or not v_row.winback_hold then
    raise exception 'number is not on hold';
  end if;

  update public.sautikit_did_pool
  set status = 'available', tenant_id = null, assigned_at = null,
      quarantine_until = null, quarantined_at = null, winback_hold = false
  where e164 = v_row.e164;

  perform public._billing_audit(btrim(p_actor), 'end_number_hold', v_row.last_tenant_id,
    jsonb_build_object('e164', v_row.e164, 'was_until', v_row.quarantine_until, 'reason', btrim(p_reason)));
  return jsonb_build_object('e164', v_row.e164, 'status', 'available');
end;
$$;

-- 6. Restore to the previous business only ---------------------------------
create or replace function public.admin_restore_held_number(
  p_e164 text,
  p_tenant_id uuid,
  p_actor text,
  p_reason text,
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.sautikit_did_pool%rowtype;
  v_current text;
  v_status text;
  v_version uuid;
begin
  perform public._package_editor_actor(p_actor, p_reason);
  if p_confirm is distinct from true then
    raise exception 'confirm the change';
  end if;
  select * into v_row from public.sautikit_did_pool where e164 = nullif(btrim(p_e164), '') for update;
  if not found then
    raise exception 'number is not in the pool';
  end if;
  if v_row.status <> 'quarantine' or not v_row.winback_hold or v_row.quarantine_until <= now() then
    raise exception 'number is not on a win-back hold';
  end if;
  if p_tenant_id is null or v_row.last_tenant_id is distinct from p_tenant_id then
    raise exception 'a held number can only go back to its previous business';
  end if;

  select sautikit_virtual_number into v_current from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'business not found';
  end if;
  if v_current is not null and v_current not like 'pending:%' then
    raise exception 'business already has a number';
  end if;

  select billing_status, package_version_id into v_status, v_version
  from public.tenant_subscriptions where tenant_id = p_tenant_id;
  if v_version is null or v_status is distinct from 'active' then
    raise exception 'business must be on a paid package before the number is restored';
  end if;

  update public.sautikit_did_pool
  set status = 'assigned', tenant_id = p_tenant_id, assigned_at = now(),
      quarantine_until = null, quarantined_at = null, winback_hold = false
  where e164 = v_row.e164;
  update public.tenants set sautikit_virtual_number = v_row.e164 where id = p_tenant_id;

  perform public._billing_audit(btrim(p_actor), 'restore_held_number', p_tenant_id,
    jsonb_build_object('e164', v_row.e164, 'was_until', v_row.quarantine_until, 'before', v_current, 'reason', btrim(p_reason)));
  return jsonb_build_object('e164', v_row.e164, 'tenant_id', p_tenant_id, 'status', 'assigned');
end;
$$;

-- 7. Read for Voice --------------------------------------------------------
create or replace function public.number_on_winback_hold(p_e164 text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sautikit_did_pool
    where e164 = nullif(btrim(p_e164), '')
      and status = 'quarantine' and winback_hold
      and quarantine_until > now()
  );
$$;

-- 8. Grants: service role only ---------------------------------------------
revoke all on function public.admin_set_number_hold_settings(boolean, numeric, boolean, integer, text, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_hold_number_for_winback(text, integer, text, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_end_number_hold(text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.admin_restore_held_number(text, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.number_on_winback_hold(text) from public, anon, authenticated;
revoke all on function public.sautikit_did_pool_winback_guard() from public, anon, authenticated;
grant execute on function public.admin_set_number_hold_settings(boolean, numeric, boolean, integer, text, text, boolean) to service_role;
grant execute on function public.admin_hold_number_for_winback(text, integer, text, text, boolean) to service_role;
grant execute on function public.admin_end_number_hold(text, text, text, boolean) to service_role;
grant execute on function public.admin_restore_held_number(text, uuid, text, text, boolean) to service_role;
grant execute on function public.number_on_winback_hold(text) to service_role;
