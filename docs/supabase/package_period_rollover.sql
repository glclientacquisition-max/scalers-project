-- DRAFT. NOT APPLIED to staging or production. Needs Alvin's explicit yes.
--
-- Package period rollover: when a tenant_subscriptions period ends, roll
-- current_period_start / current_period_end forward by the subscription's
-- period (month or year) and zero the tenant's usage counters:
--   tenants.seconds_used, sms_used_units, email_used_units, whatsapp_used_units
-- and rebuild included units from the package (+ grants that count in the new
-- period). Pending downgrades / period changes / unassigns apply here.
--
-- Run after: package_state_rules.sql, package_catalog.sql (tenant_subscriptions, counters,
--            tenants_protect_wallet_columns), wallet_security_beta.sql
--            (ops_audit_log). Requires the pg_cron extension.
-- ASCII-only (safe for Supabase SQL Editor).
--
-- Idempotent: a row only rolls when current_period_end <= now(). After the
-- roll its end is in the future, so a second run in the same hour is a no-op.
-- A row several periods behind catches up in one run (loop), and counters are
-- zeroed once.
--
-- Today (9 Oct 2026) nothing resets these counters: assign_tenant_package
-- moves the period but leaves *_used alone, and no job exists.
--
-- Voice 80% / 100% beta notices key on current_period_start, so a new period
-- alerts again on its own.

-- ---------------------------------------------------------------------------
-- 0. Dry run (read-only). Which rows would roll right now, and to what.
-- ---------------------------------------------------------------------------
-- select
--   s.tenant_id,
--   t.business_name,
--   s.period,
--   s.status,
--   s.current_period_start,
--   s.current_period_end,
--   case when s.period = 'year' then s.current_period_end + interval '12 months'
--        else s.current_period_end + interval '1 month' end as next_period_end_if_one_step,
--   t.seconds_used, t.sms_used_units, t.email_used_units, t.whatsapp_used_units
-- from public.tenant_subscriptions s
-- join public.tenants t on t.id = s.tenant_id
-- where s.status = 'active'
--   and s.current_period_end is not null
--   and s.current_period_end <= now()
-- order by s.current_period_end;
--
-- Or, once the function below exists:
-- select * from public.roll_package_periods(true);

-- ---------------------------------------------------------------------------
-- 1. Function
--    Rolls active AND no-package (cancelled) rows: a no-package tenant still
--    needs its usage clock for on-demand billing. At the boundary it applies a
--    pending change (downgrade / period_change / unassign, see
--    package_state_rules.sql), zeroes usage, and rebuilds
--      minutes_included = package minutes (0 with no package)
--                       + billing_grant_minutes_for_period(new period)
--    so upgrade proration and expired grants drop off. Grant rows are never
--    deleted. Requires package_state_rules.sql.
-- ---------------------------------------------------------------------------
drop function if exists public.roll_package_periods(boolean);

create or replace function public.roll_package_periods(p_dry_run boolean default false)
returns table (
  tenant_id uuid,
  period text,
  old_period_start timestamptz,
  old_period_end timestamptz,
  new_period_start timestamptz,
  new_period_end timestamptz,
  seconds_used_before integer,
  sms_used_before integer,
  email_used_before integer,
  whatsapp_used_before integer,
  applied_change text,
  package_id_after uuid,
  minutes_included_after integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  r record;
  v_step interval;
  v_start timestamptz;
  v_end timestamptz;
  v_period text;
  v_package uuid;
  v_status text;
  v_change text;
  v_minutes integer;
  v_grants integer;
begin
  for r in
    select s.tenant_id, s.period, s.status, s.package_id,
           s.current_period_start, s.current_period_end,
           s.pending_change, s.pending_package_id, s.pending_period, s.pending_effective_at,
           t.seconds_used, t.sms_used_units, t.email_used_units, t.whatsapp_used_units
    from public.tenant_subscriptions s
    join public.tenants t on t.id = s.tenant_id
    where s.status in ('active', 'cancelled')
      and s.current_period_end is not null
      and s.current_period_end <= now()
    for update of s skip locked
  loop
    v_period := r.period;
    v_package := r.package_id;
    v_status := r.status;
    v_change := null;

    if r.pending_change is not null and r.pending_effective_at <= r.current_period_end then
      v_change := r.pending_change;
      if r.pending_change = 'unassign' then
        v_status := 'cancelled';
      else
        v_package := r.pending_package_id;
        v_period := r.pending_period;
      end if;
    end if;

    v_step := case when v_period = 'year' then interval '12 months' else interval '1 month' end;
    v_start := r.current_period_end;
    v_end := r.current_period_end + v_step;
    while v_end <= now() loop
      v_start := v_end;
      v_end := v_end + v_step;
    end loop;

    v_grants := public.billing_grant_minutes_for_period(r.tenant_id, v_start, v_end);
    if v_status = 'active' then
      select p.minutes + v_grants into v_minutes from public.billing_packages p where p.id = v_package;
    else
      v_minutes := v_grants;
    end if;

    tenant_id := r.tenant_id;
    period := v_period;
    old_period_start := r.current_period_start;
    old_period_end := r.current_period_end;
    new_period_start := v_start;
    new_period_end := v_end;
    seconds_used_before := r.seconds_used;
    sms_used_before := r.sms_used_units;
    email_used_before := r.email_used_units;
    whatsapp_used_before := r.whatsapp_used_units;
    applied_change := v_change;
    package_id_after := case when v_status = 'active' then v_package end;
    minutes_included_after := v_minutes;

    if not p_dry_run then
      update public.tenant_subscriptions s
        set current_period_start = v_start,
            current_period_end = v_end,
            period = v_period,
            package_id = v_package,
            status = v_status,
            ended_at = case when v_change = 'unassign' then r.current_period_end else s.ended_at end,
            pending_package_id = case when v_change is not null then null else s.pending_package_id end,
            pending_period = case when v_change is not null then null else s.pending_period end,
            pending_change = case when v_change is not null then null else s.pending_change end,
            pending_effective_at = case when v_change is not null then null else s.pending_effective_at end,
            pending_set_at = case when v_change is not null then null else s.pending_set_at end,
            pending_actor = case when v_change is not null then null else s.pending_actor end,
            updated_at = now()
        where s.tenant_id = r.tenant_id
          and s.current_period_end = r.current_period_end;  -- guard against a concurrent roll

      if found then
        -- Counters are wallet-protected; same flag the billing RPCs use.
        perform set_config('scalers.wallet_write', '1', true);
        update public.tenants t
          set seconds_used = 0,
              sms_used_units = 0,
              email_used_units = 0,
              whatsapp_used_units = 0
          where t.id = r.tenant_id;

        perform public._tenant_set_allowances(
          r.tenant_id,
          case when v_status = 'active' then v_package end,
          v_minutes);

        insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
        values (
          'cron',
          'package_period_rollover',
          r.tenant_id,
          null,
          jsonb_build_object(
            'period', v_period,
            'old_start', r.current_period_start,
            'old_end', r.current_period_end,
            'new_start', v_start,
            'new_end', v_end,
            'applied_change', v_change,
            'package_id', case when v_status = 'active' then v_package end,
            'minutes_included_after', v_minutes,
            'grant_minutes', v_grants,
            'seconds_used', r.seconds_used,
            'sms_used_units', r.sms_used_units,
            'email_used_units', r.email_used_units,
            'whatsapp_used_units', r.whatsapp_used_units
          )
        );
      end if;
    end if;

    return next;
  end loop;
end;
$$;

comment on function public.roll_package_periods(boolean) is
  'Roll ended tenant_subscriptions periods forward, apply pending changes, zero *_used counters, rebuild minutes_included (package + grants for the new period). p_dry_run=true reports only.';

revoke all on function public.roll_package_periods(boolean) from public, anon, authenticated;
grant execute on function public.roll_package_periods(boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 2. Schedule (hourly, at minute 5). pg_cron 1.6.4 is installed on prod
--    (checked read-only 9 Oct 2026, 11:25 EAT). Jobs run as the owner role.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'scalers-package-period-rollover',
  '5 * * * *',
  $cron$select public.roll_package_periods(false);$cron$
);

-- Check:   select jobid, jobname, schedule, active from cron.job where jobname = 'scalers-package-period-rollover';
-- History: select status, return_message, start_time from cron.job_run_details
--          where jobid = (select jobid from cron.job where jobname = 'scalers-package-period-rollover')
--          order by start_time desc limit 20;
-- Unschedule (stop the job; function stays):
--   select cron.unschedule('scalers-package-period-rollover');
-- Full rollback:
--   select cron.unschedule('scalers-package-period-rollover');
--   drop function if exists public.roll_package_periods(boolean);
