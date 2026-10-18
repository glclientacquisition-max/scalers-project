-- DRAFT. NOT APPLIED to staging or production. Needs Alvin's explicit yes.
--
-- Package period rollover: when a tenant_subscriptions period ends, roll
-- current_period_start / current_period_end forward by the subscription's
-- period (month or year) and zero the tenant's usage counters:
--   tenants.seconds_used, sms_used_units, email_used_units, whatsapp_used_units
-- and rebuild included units from the package (+ grants that count in the new
-- period). Pending downgrades / period changes / unassigns apply here.
--
-- Run after: admin_business_archive.sql (tenants.archived_at), package_state_rules.sql, package_catalog.sql (tenant_subscriptions, counters,
--            tenants_protect_wallet_columns), wallet_security_beta.sql
--            (ops_audit_log), package_minute_consume.sql
--            (calls.package_seconds_applied), notify_send_reserve_settle.sql
--            (notify_sends.status/held_units, notify_sms_billable).
--            Requires the pg_cron extension.
-- ASCII-only (safe for Supabase SQL Editor).
--
-- Idempotent: a row only rolls when current_period_end <= now(). After the
-- roll its end is in the future, so a second run in the same hour is a no-op.
-- A row several periods behind catches up in one run (loop).
--
-- Counters at the roll (fix 18 Oct 2026):
--   * On-time roll (the new period has no usage yet): counters start at 0.
--   * CATCH-UP (the roll jumps more than one period, or the new period already
--     has usage, e.g. the cron was off or the row was stale): the new period's
--     counters are REBUILT from the ledgers instead of zeroed:
--       seconds_used   = sum(calls.package_seconds_applied), calls created in
--                        [new_start, new_end)
--       sms_used_units = sum(notify_sms_billable.units) in [new_start, new_end)
--                        + held_units of pending SMS reservations in that window
--                        (the counter holds pending units too; see
--                        sms_counter_drift(), so drift stays 0)
--     email/whatsapp counters still start at 0 (no billed ledger for them yet).
--   Before this fix a stale row was zeroed even when the new period already
--   had usage: staging Done and Dusted rolled Sep -> Oct at 17 Oct 22:05 EAT
--   and lost 17,792 s and 150 SMS of October usage (reconcile:
--   docs/supabase/staging/dnd_usage_counter_reconcile.sql).
--   The tenant row is locked before the sums are read, so a call or SMS being
--   metered at the same moment either lands before the sum or on top of it.
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
--    Usage periods are always one calendar month (EAT); annual tenants roll
--    monthly and their billing term (term_start/term_end) moves only at its end.
--    Rolls active AND no-package (cancelled) rows: a no-package tenant still
--    needs its usage clock for on-demand billing. At the boundary it applies a
--    pending change (downgrade / period_change / unassign, see
--    package_state_rules.sql), zeroes usage, and rebuilds
--      minutes_included = package minutes (0 with no package)
--                       + billing_grant_minutes_for_period(new period)
--    so upgrade proration and expired grants drop off. Grant rows are never
--    deleted. Requires package_state_rules.sql.
--    Archived tenants (tenants.archived_at set) are skipped: no renewal, no
--    counter reset, so the last period stays as the final usage record. After
--    Unarchive the next run catches the row up to the current month.
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
  minutes_included_after integer,
  term_end_after timestamptz,
  catch_up boolean,
  seconds_used_after integer,
  sms_used_after integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_period text;
  v_package uuid;
  v_status text;
  v_change text;
  v_minutes integer;
  v_grants integer;
  v_term_start timestamptz;
  v_term_end timestamptz;
  v_steps integer;
  v_secs integer;
  v_sms integer;
  v_catch_up boolean;
begin
  for r in
    select s.tenant_id, s.period, s.status, s.package_id,
           s.current_period_start, s.current_period_end, s.term_start, s.term_end,
           s.pending_change, s.pending_package_id, s.pending_period, s.pending_effective_at,
           t.seconds_used, t.sms_used_units, t.email_used_units, t.whatsapp_used_units
    from public.tenant_subscriptions s
    join public.tenants t on t.id = s.tenant_id
    where s.status in ('active', 'cancelled')
      and t.archived_at is null  -- archived: no renewal; counters stay as the final usage (archive_tenant_billing, #737)
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

    -- Usage always rolls one calendar month (EAT), for monthly and annual terms.
    v_start := r.current_period_end;
    v_end := public.billing_add_months(v_start, 1);
    v_steps := 1;
    while v_end <= now() loop
      v_start := v_end;
      v_end := public.billing_add_months(v_start, 1);
      v_steps := v_steps + 1;
    end loop;

    -- Usage already in the new period (catch-up). Lock the tenant first so a
    -- concurrent consume_call_seconds / reserve_notify_send serialises with us.
    if not p_dry_run then
      perform 1 from public.tenants t where t.id = r.tenant_id for update;
    end if;
    select coalesce(sum(c.package_seconds_applied), 0)::integer into v_secs
    from public.calls c
    where c.tenant_id = r.tenant_id
      and c.created_at >= v_start and c.created_at < v_end;
    select (coalesce((select sum(b.units) from public.notify_sms_billable b
                      where b.tenant_id = r.tenant_id
                        and b.created_at >= v_start and b.created_at < v_end), 0)
          + coalesce((select sum(n.held_units) from public.notify_sends n
                      where n.tenant_id = r.tenant_id
                        and n.channel = 'sms' and n.billed_to = 'tenant' and n.status = 'pending'
                        and n.created_at >= v_start and n.created_at < v_end), 0))::integer
      into v_sms;
    v_catch_up := v_steps > 1 or v_secs > 0 or v_sms > 0;
    if not v_catch_up then
      v_secs := 0;
      v_sms := 0;
    end if;

    -- Billing term: a term switch starts a new term with the new usage month;
    -- otherwise the term moves only once it has ended.
    if v_change = 'period_change' or r.term_end is null then
      v_term_start := v_start;
      v_term_end := public.billing_add_months(v_start, case when v_period = 'year' then 12 else 1 end);
    else
      v_term_start := r.term_start;
      v_term_end := r.term_end;
      while v_term_end <= v_start loop
        v_term_start := v_term_end;
        v_term_end := public.billing_add_months(v_term_start, case when v_period = 'year' then 12 else 1 end);
      end loop;
    end if;

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
    term_end_after := v_term_end;
    catch_up := v_catch_up;
    seconds_used_after := v_secs;
    sms_used_after := v_sms;

    if not p_dry_run then
      update public.tenant_subscriptions s
        set current_period_start = v_start,
            current_period_end = v_end,
            period = v_period,
            term_start = v_term_start,
            term_end = v_term_end,
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
        -- On time: 0. Catch-up: rebuilt from calls + the SMS ledger (header).
        update public.tenants t
          set seconds_used = v_secs,
              sms_used_units = v_sms,
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
            'term_start', v_term_start,
            'term_end', v_term_end,
            'applied_change', v_change,
            'package_id', case when v_status = 'active' then v_package end,
            'minutes_included_after', v_minutes,
            'grant_minutes', v_grants,
            'seconds_used', r.seconds_used,
            'sms_used_units', r.sms_used_units,
            'email_used_units', r.email_used_units,
            'whatsapp_used_units', r.whatsapp_used_units,
            'catch_up', v_catch_up,
            'periods_rolled', v_steps,
            'counters_source', case when v_catch_up then 'rebuilt_from_ledger' else 'zero' end,
            'seconds_used_after', v_secs,
            'sms_used_units_after', v_sms
          )
        );
      end if;
    end if;

    return next;
  end loop;
end;
$$;

comment on function public.roll_package_periods(boolean) is
  'Roll ended tenant_subscriptions periods forward, apply pending changes, reset *_used counters (0 on time; rebuilt from calls + notify_sms_billable on a catch-up), rebuild minutes_included (package + grants for the new period). p_dry_run=true reports only.';

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
