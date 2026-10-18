-- on_demand_usage_audit.sql
-- STATUS: DRAFT, NOT APPLIED. Staging then prod, each needs Alvin's GO.
--
-- What: set_tenant_on_demand_usage (owner RPC, wallet_on_demand_alerts.sql
-- section 5) now writes one ops_audit_log row when the setting changes:
--   actor     owner's login email (auth.users), else 'user:<uid>', else the
--             JWT role ('service_role') or 'ops' for SQL Editor / cron
--   action    'set_on_demand_usage' (Admin Activity label: "Changed on-demand")
--   tenant_id the business
--   detail    { before: { on_demand_usage_enabled }, after: { on_demand_usage_enabled },
--               source: 'owner' | 'service' }
-- A save that does not change the value writes no row (no Activity noise).
-- Same signature, same return shape, same access rule as before: Desk
-- (dashboard/src/app/(desk)/wallet/actions.ts) needs no change.
--
-- Why: on-demand turns metered charges on. Esga's on-demand was found on
-- (Desk owner review, 18 Oct) and nobody could tell who switched it or when.
--
-- Run after: wallet_on_demand_alerts.sql (this replaces its section 5;
-- re-running that file brings back the version without audit, so re-run
-- this one after it), wallet_security_beta.sql (ops_audit_log).
-- ASCII-only. Re-runnable.

create or replace function public.set_tenant_on_demand_usage(
  p_tenant_id uuid,
  p_enabled boolean
)
returns table (
  on_demand_usage_enabled boolean,
  wallet_balance_kes numeric
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_enabled boolean := coalesce(p_enabled, false);
  v_before boolean;
  v_uid uuid := auth.uid();
  v_owner boolean := auth.uid() is not null and coalesce(auth.role(), '') = 'authenticated';
  v_actor text;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;

  if v_owner then
    if p_tenant_id not in (select public.current_user_tenant_ids()) then
      raise exception 'not allowed';
    end if;
  end if;

  select coalesce(t.on_demand_usage_enabled, false) into v_before
  from public.tenants t where t.id = p_tenant_id
  for update;
  if not found then
    raise exception 'tenant not found';
  end if;

  perform set_config('scalers.wallet_write', '1', true);

  update public.tenants t
  set on_demand_usage_enabled = v_enabled
  where t.id = p_tenant_id;

  if v_before is distinct from v_enabled then
    if v_uid is not null then
      select coalesce(nullif(trim(u.email), ''), 'user:' || v_uid::text) into v_actor
      from auth.users u where u.id = v_uid;
      v_actor := coalesce(v_actor, 'user:' || v_uid::text);
    else
      v_actor := coalesce(nullif(auth.role(), ''), 'ops');
    end if;

    insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
    values (
      v_actor,
      'set_on_demand_usage',
      p_tenant_id,
      null,
      jsonb_build_object(
        'before', jsonb_build_object('on_demand_usage_enabled', v_before),
        'after', jsonb_build_object('on_demand_usage_enabled', v_enabled),
        'source', case when v_owner then 'owner' else 'service' end
      )
    );
  end if;

  on_demand_usage_enabled := v_enabled;
  select coalesce(t.wallet_balance_kes, 0) into wallet_balance_kes
  from public.tenants t where t.id = p_tenant_id;
  return next;
end;
$$;

revoke all on function public.set_tenant_on_demand_usage(uuid, boolean)
  from public, anon;
grant execute on function public.set_tenant_on_demand_usage(uuid, boolean)
  to authenticated, service_role;

-- Check (read-only):
--   select created_at, actor, tenant_id, detail from public.ops_audit_log
--   where action = 'set_on_demand_usage' order by created_at desc limit 20;
-- Rollback: re-run section 5 of wallet_on_demand_alerts.sql (the version
-- without audit). Audit rows already written stay (append-only history).
