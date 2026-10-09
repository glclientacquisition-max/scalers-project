-- Admin Billing ops: waive on-demand overage (ledger). Grant: see fix_grant_package_minutes.sql.
-- Apply after package_catalog.sql and wallet_security_beta.sql.
-- Service role only; mirrors assign_tenant_package wallet_write bypass.

-- grant_tenant_package_minutes lives in fix_grant_package_minutes.sql (apply it
-- after this file). The old body here raised 42702 "minutes_included is
-- ambiguous" on every call and must not be re-applied.

create or replace function public.waive_tenant_overage(
  p_tenant_id uuid,
  p_note text,
  p_actor text default 'ops',
  p_idempotency_key text default null
)
returns table (
  tenant_id uuid,
  wallet_balance_kes numeric,
  waived_kes numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := coalesce(nullif(trim(p_actor), ''), 'ops');
  v_note text := trim(coalesce(p_note, ''));
  v_key text := nullif(trim(p_idempotency_key), '');
  v_bal numeric;
  v_waived numeric := 0;
  v_row record;
begin
  if p_tenant_id is null then
    raise exception 'tenant required';
  end if;
  if v_note is null or length(v_note) < 3 then
    raise exception 'note required (min 3 chars)';
  end if;

  select t.wallet_balance_kes into v_bal from public.tenants t where t.id = p_tenant_id;
  if not found then
    raise exception 'tenant not found';
  end if;

  if coalesce(v_bal, 0) >= 0 then
    tenant_id := p_tenant_id;
    wallet_balance_kes := coalesce(v_bal, 0);
    waived_kes := 0;
    return next;
    return;
  end if;

  if v_key is not null then
    if exists (
      select 1
      from public.ops_audit_log o
      where o.tenant_id = p_tenant_id
        and o.action = 'waive_overage'
        and o.detail->>'idempotency_key' = v_key
    ) then
      select t.wallet_balance_kes into v_bal from public.tenants t where t.id = p_tenant_id;
      tenant_id := p_tenant_id;
      wallet_balance_kes := coalesce(v_bal, 0);
      waived_kes := 0;
      return next;
      return;
    end if;
  end if;

  v_waived := abs(v_bal);
  select * into v_row
  from public._wallet_apply_delta(
    p_tenant_id,
    'trial_credit',
    v_waived,
    'waive_overage',
    coalesce(v_key, 'waive:' || p_tenant_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS')),
    v_note,
    jsonb_build_object('actor', v_actor, 'source', 'admin_billing')
  );

  insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
  values (
    v_actor,
    'waive_overage',
    p_tenant_id,
    v_waived,
    jsonb_build_object(
      'note', v_note,
      'waived_kes', v_waived,
      'balance_after', v_row.wallet_balance_kes,
      'idempotency_key', v_key
    )
  );

  tenant_id := p_tenant_id;
  wallet_balance_kes := v_row.wallet_balance_kes;
  waived_kes := v_waived;
  return next;
end;
$$;

revoke all on function public.waive_tenant_overage(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.waive_tenant_overage(uuid, text, text, text) to service_role;
