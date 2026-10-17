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
