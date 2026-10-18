-- Archive billing stop (ops-billing hook for Super Admin Archive, PR #737).
--
-- archive_tenant_billing(p_tenant_id, p_actor, p_reason)
--   Called right after Admin archives a business (tenants.archived_at is set).
--   One call, one transaction, safe to repeat:
--     1. billing_enforcement -> 'off'  (charge_call_to_wallet, consume_call_seconds
--        and apply_line_rental all charge nothing when the mode is off).
--     2. on_demand_usage_enabled -> false (no overage, even if a call slips through).
--     3. Line / number rental stops: apply_line_rental is a no-op while the mode is
--        off, and the guard trigger below keeps the mode off while archived.
--        line_paid_through and line_status are left as they are (history).
--     4. Package renewal / period rollover: roll_package_periods (PR #631/#650,
--        package_period_rollover.sql) skips rows whose tenant has archived_at set,
--        so the last period's counters stay frozen as the final usage record.
--        Nothing to change on tenant_subscriptions here; it is kept as is.
--     5. Invoices: no invoice table exists yet (checked prod and staging,
--        17 Oct 2026). HOOK: when invoicing lands, invoice runs must skip
--        tenants.archived_at is not null, and this function must move the
--        tenant's open invoices to held (or void) in the same transaction and add
--        their ids to the audit detail. Billing is packages + on-demand only.
--     6. One ops_audit_log row (action archive_tenant_billing) with the settings
--        from before, so an admin can see what was switched off. A repeat call for
--        the same archive writes nothing new.
--
-- unarchive_tenant_billing(p_tenant_id, p_actor, p_reason)
--   Called after Admin unarchives (archived_at is null again). Turns NOTHING back
--   on: billing mode stays off and on-demand stays off until an admin chooses.
--   It lifts the archive guard (implicitly, archived_at is null), lets the
--   rollover catch the subscription up to the current month on its next run,
--   writes one ops_audit_log row (unarchive_tenant_billing) and returns the
--   pre-archive settings so the Admin screen can offer them. Safe to repeat.
--
-- tenants_archived_billing_guard (trigger)
--   While tenants.archived_at is set, refuses any change that turns billing mode
--   on or on-demand on, whichever RPC tries it (set_tenant_billing_mode,
--   set_tenant_on_demand_usage, a script). Unarchive first.
--
-- Depends on: admin_business_archive.sql (archived_at), wallet_security_beta.sql
-- (ops_audit_log, billing_enforcement), wallet_on_demand_alerts.sql
-- (on_demand_usage_enabled, tenants_protect_wallet_columns).
-- Additive and safe to re-run. Staging first; prod only with Alvin's GO.

-- ---------------------------------------------------------------------------
-- 1. Guard: an archived business cannot be switched back to charging.
-- ---------------------------------------------------------------------------
create or replace function public.tenants_archived_billing_guard()
returns trigger
language plpgsql
as $$
begin
  if new.archived_at is null then
    return new;
  end if;
  if coalesce(new.billing_enforcement, 'off') <> 'off'
     and new.billing_enforcement is distinct from old.billing_enforcement then
    raise exception 'This business is archived. Unarchive it before turning billing on.'
      using errcode = 'P0001';
  end if;
  if coalesce(new.on_demand_usage_enabled, false)
     and new.on_demand_usage_enabled is distinct from old.on_demand_usage_enabled then
    raise exception 'This business is archived. Unarchive it before turning on-demand on.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_archived_billing_guard on public.tenants;
create trigger tenants_archived_billing_guard
  before update of billing_enforcement, on_demand_usage_enabled on public.tenants
  for each row execute function public.tenants_archived_billing_guard();

-- ---------------------------------------------------------------------------
-- 2. archive_tenant_billing
-- ---------------------------------------------------------------------------
create or replace function public.archive_tenant_billing(
  p_tenant_id uuid,
  p_actor text,
  p_reason text default null
)
returns table (
  changed boolean,
  audited boolean,
  billing_before text,
  billing_after text,
  on_demand_before boolean,
  on_demand_after boolean,
  archived_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_t record;
  v_sub jsonb;
  v_changed boolean;
  v_dup boolean;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;
  if coalesce(trim(p_actor), '') = '' then
    raise exception 'actor required';
  end if;

  select t.id, t.archived_at,
         coalesce(t.billing_enforcement, 'off') as billing_enforcement,
         coalesce(t.on_demand_usage_enabled, false) as on_demand,
         t.beta_expires_at, t.line_paid_through, t.line_status
    into v_t
  from public.tenants t
  where t.id = p_tenant_id
  for update;

  if not found then
    raise exception 'This business no longer exists.';
  end if;
  if v_t.archived_at is null then
    raise exception 'Archive the business before stopping its billing.';
  end if;

  v_changed := v_t.billing_enforcement <> 'off' or v_t.on_demand;

  if v_changed then
    perform set_config('scalers.wallet_write', '1', true);
    update public.tenants t
       set billing_enforcement = 'off',
           on_demand_usage_enabled = false
     where t.id = p_tenant_id;
    perform set_config('scalers.wallet_write', '0', true);
  end if;

  -- One audit row per archive (keyed on archived_at). Re-runs add nothing.
  select exists (
    select 1 from (
      select l.action, l.detail
      from public.ops_audit_log l
      where l.tenant_id = p_tenant_id
        and l.action in ('archive_tenant_billing', 'unarchive_tenant_billing')
      order by l.created_at desc, l.id desc
      limit 1
    ) last
    where last.action = 'archive_tenant_billing'
      and (last.detail->>'archived_at')::timestamptz = v_t.archived_at
  ) into v_dup;

  if not v_dup then
    if to_regclass('public.tenant_subscriptions') is not null then
      execute 'select to_jsonb(s) from public.tenant_subscriptions s where s.tenant_id = $1'
        into v_sub using p_tenant_id;
    end if;
    insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
    values (
      trim(p_actor),
      'archive_tenant_billing',
      p_tenant_id,
      null,
      jsonb_build_object(
        'archived_at', v_t.archived_at,
        'reason', nullif(trim(coalesce(p_reason, '')), ''),
        'before', jsonb_build_object(
          'billing_enforcement', v_t.billing_enforcement,
          'on_demand_usage_enabled', v_t.on_demand,
          'beta_expires_at', v_t.beta_expires_at,
          'line_paid_through', v_t.line_paid_through,
          'line_status', v_t.line_status,
          'subscription', case when v_sub is null then null else jsonb_build_object(
            'status', v_sub->>'status',
            'package_id', v_sub->>'package_id',
            'period', v_sub->>'period',
            'current_period_start', v_sub->>'current_period_start',
            'current_period_end', v_sub->>'current_period_end') end
        ),
        'after', jsonb_build_object('billing_enforcement', 'off', 'on_demand_usage_enabled', false),
        'line_rental', 'stopped (billing off)',
        'rollover', 'skipped while archived',
        'invoices', 'none (no invoice table)'
      )
    );
  end if;

  changed := v_changed;
  audited := not v_dup;
  billing_before := v_t.billing_enforcement;
  billing_after := 'off';
  on_demand_before := v_t.on_demand;
  on_demand_after := false;
  archived_at := v_t.archived_at;
  return next;
end;
$$;

revoke all on function public.archive_tenant_billing(uuid, text, text) from public, anon, authenticated;
grant execute on function public.archive_tenant_billing(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. unarchive_tenant_billing (reverse; restores nothing by itself)
-- ---------------------------------------------------------------------------
create or replace function public.unarchive_tenant_billing(
  p_tenant_id uuid,
  p_actor text,
  p_reason text default null
)
returns table (
  audited boolean,
  billing_enforcement text,
  on_demand_enabled boolean,
  pre_archive_billing text,
  pre_archive_on_demand boolean,
  period_lapsed boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_t record;
  v_last record;
  v_before jsonb;
  v_lapsed boolean := false;
  v_found boolean;
  v_was_archived boolean := false;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;
  if coalesce(trim(p_actor), '') = '' then
    raise exception 'actor required';
  end if;

  select t.id, t.archived_at,
         coalesce(t.billing_enforcement, 'off') as billing_enforcement,
         coalesce(t.on_demand_usage_enabled, false) as on_demand
    into v_t
  from public.tenants t
  where t.id = p_tenant_id
  for update;

  if not found then
    raise exception 'This business no longer exists.';
  end if;
  if v_t.archived_at is not null then
    raise exception 'Unarchive the business before resuming its billing.';
  end if;

  select l.action, l.detail
    into v_last
  from public.ops_audit_log l
  where l.tenant_id = p_tenant_id
    and l.action in ('archive_tenant_billing', 'unarchive_tenant_billing')
  order by l.created_at desc, l.id desc
  limit 1;
  v_found := found;

  if v_found then
    v_was_archived := v_last.action = 'archive_tenant_billing';
    v_before := case when v_was_archived then v_last.detail->'before'
                     else v_last.detail->'pre_archive' end;
  end if;

  if to_regclass('public.tenant_subscriptions') is not null then
    execute 'select coalesce(bool_or(s.current_period_end <= now()), false)
               from public.tenant_subscriptions s where s.tenant_id = $1'
      into v_lapsed using p_tenant_id;
  end if;

  -- Only the first call after an archive writes a row. Re-runs add nothing.
  audited := v_was_archived;
  if audited then
    insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
    values (
      trim(p_actor),
      'unarchive_tenant_billing',
      p_tenant_id,
      null,
      jsonb_build_object(
        'reason', nullif(trim(coalesce(p_reason, '')), ''),
        'archived_at', v_last.detail->'archived_at',
        'pre_archive', v_before,
        'now', jsonb_build_object(
          'billing_enforcement', v_t.billing_enforcement,
          'on_demand_usage_enabled', v_t.on_demand),
        'restored', '[]'::jsonb,
        'period_lapsed', v_lapsed,
        'note', 'Billing mode and on-demand stay as they are until an admin turns them on.'
      )
    );
  end if;

  billing_enforcement := v_t.billing_enforcement;
  on_demand_enabled := v_t.on_demand;
  pre_archive_billing := v_before->>'billing_enforcement';
  pre_archive_on_demand := (v_before->>'on_demand_usage_enabled')::boolean;
  period_lapsed := v_lapsed;
  return next;
end;
$$;

revoke all on function public.unarchive_tenant_billing(uuid, text, text) from public, anon, authenticated;
grant execute on function public.unarchive_tenant_billing(uuid, text, text) to service_role;
