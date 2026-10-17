-- Super Admin: Suspend / Restore a business line (reversible pause).
--
-- Suspend reuses tenants.line_status = 'suspended' (line_rental_grace.sql,
-- check: active | grace | suspended). The voice gate (#651,
-- src/sautikit/inactiveTenantGate.js rowSuspended) already plays "line
-- unavailable" for it before Stream and before any call row, so a rejected
-- call creates no session, no minutes and no charge.
--
-- suspended_at / suspended_by only say WHO paused the line and WHEN. They do
-- not gate calls (line_status does). They also tell an admin pause apart from a
-- non-payment suspension (suspend_line_for_nonpayment), which this RPC refuses
-- to lift: billing owns that one.
--
-- Data, package, minutes and billing mode are untouched.
-- line_status is RPC-only (tenants_protect_wallet_columns), hence this function.
--
-- Depends on: line_rental_grace.sql (line_status), admin_business_archive.sql.
-- Additive and safe to re-run. Staging first; prod only with Alvin's GO.

alter table public.tenants
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_by text;

comment on column public.tenants.suspended_at is
  'When a Super Admin suspended the line (line_status = suspended). null = not admin-suspended.';
comment on column public.tenants.suspended_by is
  'Signed-in Super Admin username that suspended the line.';

create or replace function public.admin_set_business_suspended(
  p_tenant_id uuid,
  p_suspended boolean,
  p_actor text
)
returns table (line_status text, suspended_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;
  if coalesce(trim(p_actor), '') = '' then
    raise exception 'actor required';
  end if;

  select t.id, coalesce(t.line_status, 'active') as line_status, t.suspended_at
    into v_row
  from public.tenants t
  where t.id = p_tenant_id
  for update;

  if not found then
    raise exception 'This business no longer exists.';
  end if;

  perform set_config('scalers.wallet_write', '1', true);

  if p_suspended then
    if v_row.line_status = 'suspended' then
      raise exception 'Already suspended.';
    end if;
    update public.tenants t
       set line_status = 'suspended',
           suspended_at = now(),
           suspended_by = trim(p_actor)
     where t.id = p_tenant_id;
  else
    if v_row.line_status <> 'suspended' then
      raise exception 'This line is not suspended.';
    end if;
    if v_row.suspended_at is null then
      raise exception 'Suspended for non-payment. It comes back when the bill is paid.';
    end if;
    update public.tenants t
       set line_status = 'active',
           suspended_at = null,
           suspended_by = null
     where t.id = p_tenant_id;
    -- Let the line-rental rules decide active vs grace (beta stays active).
    if to_regprocedure('public.refresh_line_status(uuid)') is not null then
      perform public.refresh_line_status(p_tenant_id);
    end if;
  end if;

  return query
    select t.line_status, t.suspended_at
    from public.tenants t
    where t.id = p_tenant_id;
end;
$$;

revoke all on function public.admin_set_business_suspended(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.admin_set_business_suspended(uuid, boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- Line-rental rules must not lift an admin suspension (ops-billing, #737).
--
-- refresh_line_status (line_rental_grace.sql) recomputes active | grace |
-- suspended from billing mode and line_paid_through. Before this patch it would
-- turn an admin-suspended line back to 'active' (beta, or rental paid). Now it
-- keeps 'suspended' while tenants.suspended_at is set; only
-- admin_set_business_suspended(..., false) clears suspended_at and then calls
-- refresh_line_status to pick active vs grace.
--
-- suspend_line_for_nonpayment also refuses an admin-suspended line: it would
-- otherwise see 'suspended', disable the DID and park the number as pending:,
-- so an admin Restore would bring the line back with no number.
--
-- Both are replaced only where line_rental_grace.sql is already applied
-- (staging has them; prod does not, checked 17 Oct 2026). This file never
-- creates them on a project that lacks them.
-- ---------------------------------------------------------------------------
do $patch$
begin
  if to_regprocedure('public.refresh_line_status(uuid)') is not null then
    execute $fn$
create or replace function public.refresh_line_status(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_tenant record;
  v_status text;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;

  select
    t.id,
    coalesce(t.billing_enforcement, 'off') as billing_enforcement,
    t.line_paid_through,
    coalesce(t.line_grace_days, 3) as line_grace_days,
    coalesce(t.line_status, 'active') as line_status,
    t.suspended_at,
    (
      t.sautikit_virtual_number is not null
      and t.sautikit_virtual_number !~* '^pending:'
    ) as has_did
  into v_tenant
  from public.tenants t
  where t.id = p_tenant_id
  for update;

  if not found then
    raise exception 'tenant not found';
  end if;

  -- An admin suspension wins over every rental rule until an admin restores it.
  if v_tenant.suspended_at is not null then
    v_status := 'suspended';
  -- Beta and DID-less tenants are always active.
  elsif v_tenant.billing_enforcement = 'off' or not v_tenant.has_did then
    v_status := 'active';
  elsif v_tenant.line_paid_through is null then
    v_status := 'active';
  elsif now() <= v_tenant.line_paid_through then
    v_status := 'active';
  elsif now() <= v_tenant.line_paid_through + (v_tenant.line_grace_days || ' days')::interval then
    v_status := 'grace';
  else
    v_status := 'suspended';
  end if;

  if v_status is distinct from v_tenant.line_status then
    perform set_config('scalers.wallet_write', '1', true);
    update public.tenants
    set line_status = v_status
    where id = p_tenant_id;
  end if;

  return v_status;
end;
$body$;
$fn$;
    execute 'revoke all on function public.refresh_line_status(uuid) from public, anon, authenticated';
    execute 'grant execute on function public.refresh_line_status(uuid) to service_role';
  end if;

  if to_regprocedure('public.suspend_line_for_nonpayment(uuid)') is not null then
    execute $fn$
create or replace function public.suspend_line_for_nonpayment(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_e164 text;
  v_status text;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;

  if exists (select 1 from public.tenants t where t.id = p_tenant_id and t.suspended_at is not null) then
    raise exception 'Suspended by an admin. Restore the line before a non-payment suspension.';
  end if;

  v_status := public.refresh_line_status(p_tenant_id);
  if v_status <> 'suspended' then
    raise exception 'line is not past grace (status=%)', v_status;
  end if;

  select t.sautikit_virtual_number into v_e164
  from public.tenants t
  where t.id = p_tenant_id;

  if v_e164 is null or v_e164 like 'pending:%' then
    return null;
  end if;

  -- Keep the number out of the available pool until ops decides to release.
  update public.sautikit_did_pool
  set
    status = 'disabled',
    notes = coalesce(notes, '') || ' [suspended for non-payment]'
  where e164 = v_e164;

  -- Voice ignores pending: DIDs; tenant keeps row for history.
  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants
  set
    sautikit_virtual_number = 'pending:' || p_tenant_id::text,
    line_status = 'suspended'
  where id = p_tenant_id;

  return v_e164;
end;
$body$;
$fn$;
    execute 'revoke all on function public.suspend_line_for_nonpayment(uuid) from public, anon, authenticated';
    execute 'grant execute on function public.suspend_line_for_nonpayment(uuid) to service_role';
  end if;
end;
$patch$;
