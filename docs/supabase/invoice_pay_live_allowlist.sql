-- Invoice pay live allowlist (P17).
-- Apply once, as one transaction, after invoice_pay_checkout_review_round9.sql (P16).
-- Does not replace finalize_invoice. Does not edit P1-P16. Inserts no businesses.
-- Idempotent. Re-running replaces the functions and does not add a tenant.
-- Production (fjxcdccgyhnvnnlnovcl) does not have this file.
-- Staging (sgcdncjxauhsbunobmob) is the only apply.
--
-- Live Bachs stays closed in the app unless BACHS_LIVE_ALLOWED=true and either
-- this row is enabled or the business is on BACHS_LIVE_TENANT_ALLOWLIST.
-- Enabling a free beta business (billing enforcement off, or billing status beta)
-- is refused. A reason is required. The change is one billing_audit_log row.

create table if not exists public.billing_live_tenants (
  tenant_id uuid primary key references public.tenants (id),
  enabled boolean not null default false,
  reason text not null,
  set_by text not null,
  set_at timestamptz not null default now()
);

comment on table public.billing_live_tenants is
  'Businesses allowed to take live Bachs payments. Empty until an operator sets a row. Service role only.';

alter table public.billing_live_tenants enable row level security;

revoke all on table public.billing_live_tenants from public, anon, authenticated;
grant select, insert, update, delete on table public.billing_live_tenants to service_role;

create or replace function public.admin_set_tenant_live_payments(
  p_tenant_id uuid,
  p_enabled boolean,
  p_reason text,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enforcement text;
  v_status text;
  v_reason text;
  v_actor text;
begin
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  v_actor := nullif(btrim(coalesce(p_actor, '')), '');
  if v_reason is null then
    raise exception 'a reason is required';
  end if;
  if v_actor is null then
    raise exception 'an actor is required';
  end if;
  if p_enabled is null then
    raise exception 'enabled is required';
  end if;

  perform 1 from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'business not found';
  end if;

  select t.billing_enforcement, s.billing_status
    into v_enforcement, v_status
  from public.tenants t
  left join public.tenant_subscriptions s on s.tenant_id = t.id
  where t.id = p_tenant_id;

  if p_enabled is true and (
    coalesce(v_enforcement, 'off') = 'off'
    or coalesce(v_status, 'beta') = 'beta'
  ) then
    raise exception 'live payments stay off while the business is on beta';
  end if;

  insert into public.billing_live_tenants (tenant_id, enabled, reason, set_by, set_at)
  values (p_tenant_id, p_enabled, v_reason, v_actor, now())
  on conflict (tenant_id) do update
    set enabled = excluded.enabled,
        reason = excluded.reason,
        set_by = excluded.set_by,
        set_at = now();

  perform public._billing_audit(
    v_actor,
    'tenant_live_payments_set',
    p_tenant_id,
    jsonb_build_object(
      'enabled', p_enabled,
      'reason', v_reason,
      'billing_enforcement', v_enforcement,
      'billing_status', v_status
    )
  );

  return (
    select jsonb_build_object(
      'tenant_id', row.tenant_id,
      'enabled', row.enabled,
      'reason', row.reason,
      'set_by', row.set_by,
      'set_at', row.set_at
    )
    from public.billing_live_tenants row
    where row.tenant_id = p_tenant_id
  );
end;
$$;

comment on function public.admin_set_tenant_live_payments(uuid, boolean, text, text) is
  'Service role only. Requires a reason. Refuses to enable a beta business. Writes billing_audit_log tenant_live_payments_set.';

revoke all on function public.admin_set_tenant_live_payments(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_tenant_live_payments(uuid, boolean, text, text) to service_role;

create or replace function public.billing_live_tenant_allowed(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select enabled
    from public.billing_live_tenants
    where tenant_id = p_tenant_id
  ), false);
$$;

comment on function public.billing_live_tenant_allowed(uuid) is
  'True only when this business has an enabled live-payment row. No row is false. Service role only.';

revoke all on function public.billing_live_tenant_allowed(uuid) from public, anon, authenticated;
grant execute on function public.billing_live_tenant_allowed(uuid) to service_role;
