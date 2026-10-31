-- Billing audit item 6: fault-tolerant package period rollover.
--
-- Same function as prod (public.roll_package_periods, md5 4206e30b... on
-- fjxcdccgyhnvnnlnovcl), with each tenant's roll inside its own
-- BEGIN ... EXCEPTION block. A tenant that fails is rolled back to its
-- savepoint, written to ops_audit_log as package_period_rollover_failed,
-- and alerted once through platform_ops_notices kind
-- package_rollover_failed:<tenant_id>. The other tenants still roll.
-- A later successful roll resolves that tenant's notice. Failed tenants are
-- not in the result set. The return shape is unchanged and grants are kept
-- (CREATE OR REPLACE). The scalers-package-period-rollover cron job is not
-- changed.

CREATE OR REPLACE FUNCTION public.roll_package_periods(p_dry_run boolean DEFAULT false)
 RETURNS TABLE(tenant_id uuid, period text, old_period_start timestamp with time zone, old_period_end timestamp with time zone, new_period_start timestamp with time zone, new_period_end timestamp with time zone, seconds_used_before integer, sms_used_before integer, email_used_before integer, whatsapp_used_before integer, applied_change text, package_id_after uuid, minutes_included_after integer, term_end_after timestamp with time zone, catch_up boolean, seconds_used_after integer, sms_used_after integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_ok boolean;
  v_err_state text;
  v_err_msg text;
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
    -- One tenant's failure must not stop the rest (billing audit item 6). The block is a
    -- savepoint: this tenant's partial writes roll back, it is logged and
    -- alerted, and the loop moves on. It is picked up again next hour.
    v_ok := true;
    begin
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

          -- A tenant that failed before and now rolls clears its own alert.
          if to_regclass('public.platform_ops_notices') is not null then
            update public.platform_ops_notices
              set status = 'resolved', resolved_at = coalesce(resolved_at, now())
              where kind = 'package_rollover_failed:' || r.tenant_id::text
                and status in ('open', 'acked');
          end if;

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

    exception when others then
      v_ok := false;
      get stacked diagnostics v_err_state = returned_sqlstate, v_err_msg = message_text;
      raise warning 'roll_package_periods: tenant % failed (%): %', r.tenant_id, v_err_state, v_err_msg;
      if not p_dry_run then
        begin
          insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
          values (
            'cron',
            'package_period_rollover_failed',
            r.tenant_id,
            null,
            jsonb_build_object(
              'sqlstate', v_err_state,
              'error', left(v_err_msg, 500),
              'old_end', r.current_period_end
            )
          );
          if to_regclass('public.platform_ops_notices') is not null then
            begin
              insert into public.platform_ops_notices (kind, detail)
              values (
                'package_rollover_failed:' || r.tenant_id::text,
                'Package period rollover failed for business ' || r.tenant_id::text
                  || ' (' || v_err_state || '): ' || left(v_err_msg, 300)
                  || '. Other businesses rolled. It retries every hour until it rolls.'
              );
            exception when unique_violation then
              null;  -- already open for this business
            end;
          end if;
        exception when others then
          raise warning 'roll_package_periods: could not log failure for tenant %: %', r.tenant_id, sqlerrm;
        end;
      end if;
    end;

    if v_ok then
      return next;
    end if;
  end loop;
end;
$function$;
