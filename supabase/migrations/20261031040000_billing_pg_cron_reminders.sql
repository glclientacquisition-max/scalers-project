-- Billing schedules move from Vercel cron to pg_cron, and invoice reminders get their machinery.
--
-- 1. Reminder policy settings on billing_lifecycle_settings. Everything is OFF until Alvin sets it:
--    reminders_enabled = false, and every day count is null (null = that step never fires).
-- 2. run_invoice_reminders(): due soon, overdue, at most 2 follow-ups, a suspend-due flag.
--    Stops once the invoice is paid (status not open, or nothing left to pay), skips paused
--    (disputed) invoices and archived businesses, and does nothing during quiet hours (EAT).
--    At most one notice per invoice per run. Every notice has a fixed idempotency key.
--    It only queues billing_notices. Sending stays behind billing_notices_send / BILLING_NOTICES_SEND.
--    Suspend day only writes an ops_audit_log flag. It never suspends a line.
-- 3. billing_reconcile_daily(): logs billing_payment_reconciliation() counts and opens one ops
--    notice when anything does not match. Read-only on the books.
-- 4. billing_call_cron_route(): pg_cron calls the Desk payment-retry route through pg_net with the
--    bearer CRON_SECRET from Vault. Missing pg_net or Vault secrets -> one ops notice, no call.
--    Vault secrets (set by Alvin, never in git): billing_cron_base_url, billing_cron_secret.
-- 5. pg_cron jobs. dashboard/vercel.json no longer schedules billing-payment-retry.

create extension if not exists pg_net with schema extensions;

-- 1. Settings -------------------------------------------------------------------------------
alter table public.billing_lifecycle_settings
  add column if not exists reminders_enabled boolean not null default false,
  add column if not exists reminder_due_soon_days integer,
  add column if not exists reminder_overdue_grace_days integer,
  add column if not exists reminder_followup_days integer,
  add column if not exists reminder_max_followups integer not null default 2,
  add column if not exists reminder_suspend_day integer,
  add column if not exists reminder_quiet_start time not null default '21:00',
  add column if not exists reminder_quiet_end time not null default '08:00';

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_lifecycle_settings_reminder_days_check') then
    alter table public.billing_lifecycle_settings add constraint billing_lifecycle_settings_reminder_days_check check (
      (reminder_due_soon_days is null or reminder_due_soon_days between 1 and 30)
      and (reminder_overdue_grace_days is null or reminder_overdue_grace_days between 0 and 60)
      and (reminder_followup_days is null or reminder_followup_days between 1 and 30)
      and reminder_max_followups between 0 and 2
      and (reminder_suspend_day is null or reminder_suspend_day between 1 and 120)
    );
  end if;
end $m$;

-- 2. Reminders ------------------------------------------------------------------------------
create or replace function public.billing_in_quiet_hours(p_at timestamptz, p_start time, p_end time)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $function$
  select case
    when p_start = p_end then false
    when p_start < p_end then (p_at at time zone 'Africa/Nairobi')::time >= p_start
                          and (p_at at time zone 'Africa/Nairobi')::time < p_end
    else (p_at at time zone 'Africa/Nairobi')::time >= p_start
      or (p_at at time zone 'Africa/Nairobi')::time < p_end
  end;
$function$;

create or replace function public.run_invoice_reminders(p_dry_run boolean default false)
returns table(invoice_id uuid, tenant_id uuid, action text, idempotency_key text)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
#variable_conflict use_column
declare
  s public.billing_lifecycle_settings%rowtype;
  inv record;
  v_key text;
  v_action text;
  v_over timestamptz;
  k integer;
begin
  select * into s from public.billing_lifecycle_settings where id = 1;
  if not found or not s.reminders_enabled then
    return;
  end if;
  if public.billing_in_quiet_hours(now(), s.reminder_quiet_start, s.reminder_quiet_end) then
    return;
  end if;

  for inv in
    select i.id, i.tenant_id, i.invoice_number, i.total_kes, i.amount_paid_kes, i.due_at
    from public.invoices i
    join public.tenants t on t.id = i.tenant_id
    where i.status = 'open'
      and i.due_at is not null
      and i.reminders_paused_at is null
      and coalesce(i.total_kes, 0) - coalesce(i.amount_paid_kes, 0) > 0
      and t.archived_at is null
    order by i.due_at
  loop
    v_key := null;
    v_action := null;

    -- Suspend day: a flag for ops only, once per invoice. No line is suspended here.
    if s.reminder_suspend_day is not null
       and now() >= inv.due_at + make_interval(days => s.reminder_suspend_day)
       and not exists (select 1 from public.ops_audit_log o
                       where o.action = 'invoice_suspend_due' and o.detail->>'invoice_id' = inv.id::text) then
      if not p_dry_run then
        insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
        values ('cron', 'invoice_suspend_due', inv.tenant_id,
                coalesce(inv.total_kes, 0) - coalesce(inv.amount_paid_kes, 0),
                jsonb_build_object('invoice_id', inv.id, 'invoice_number', inv.invoice_number,
                                   'due_at', inv.due_at, 'suspend_day', s.reminder_suspend_day,
                                   'note', 'policy flag only; nothing was suspended'));
      end if;
      invoice_id := inv.id; tenant_id := inv.tenant_id; action := 'suspend_due'; idempotency_key := null;
      return next;
    end if;

    if s.reminder_overdue_grace_days is not null
       and now() >= inv.due_at + make_interval(days => s.reminder_overdue_grace_days) then
      v_over := inv.due_at + make_interval(days => s.reminder_overdue_grace_days);
      if not exists (select 1 from public.billing_notices n where n.tenant_id = inv.tenant_id
                     and n.idempotency_key = 'platform_billing_invoice_overdue:' || inv.id::text) then
        v_action := 'overdue';
        v_key := 'platform_billing_invoice_overdue:' || inv.id::text;
      elsif s.reminder_followup_days is not null then
        -- Earliest follow-up that is due and not yet queued; at most reminder_max_followups (<= 2).
        for k in 1 .. s.reminder_max_followups loop
          exit when now() < v_over + make_interval(days => k * s.reminder_followup_days);
          if not exists (select 1 from public.billing_notices n where n.tenant_id = inv.tenant_id
                         and n.idempotency_key = 'platform_billing_invoice_overdue:' || inv.id::text || ':f' || k) then
            v_action := 'followup_' || k;
            v_key := 'platform_billing_invoice_overdue:' || inv.id::text || ':f' || k;
            exit;
          end if;
        end loop;
      end if;
    elsif s.reminder_due_soon_days is not null
       and now() >= inv.due_at - make_interval(days => s.reminder_due_soon_days)
       and now() < inv.due_at
       and not exists (select 1 from public.billing_notices n where n.tenant_id = inv.tenant_id
                       and n.idempotency_key = 'platform_billing_invoice_due_soon:' || inv.id::text) then
      v_action := 'due_soon';
      v_key := 'platform_billing_invoice_due_soon:' || inv.id::text;
    end if;

    continue when v_action is null;

    if not p_dry_run then
      if v_action = 'due_soon' then
        perform public.enqueue_invoice_due_soon(inv.id);
      elsif v_action = 'overdue' then
        perform public.enqueue_invoice_overdue(inv.id);
      else
        perform public.enqueue_billing_notice(
          inv.tenant_id,
          'platform_billing_invoice_overdue',
          v_key,
          'Invoice still overdue',
          'Your Business Assistant invoice ' || coalesce(inv.invoice_number, '')
            || ' for KSh ' || trim(to_char(coalesce(inv.total_kes, 0) - coalesce(inv.amount_paid_kes, 0), 'FM999999990.00'))
            || ' is still overdue.');
      end if;
    end if;
    invoice_id := inv.id; tenant_id := inv.tenant_id; action := v_action; idempotency_key := v_key;
    return next;
  end loop;
end;
$function$;

revoke all on function public.billing_in_quiet_hours(timestamptz, time, time) from public, anon, authenticated;
revoke all on function public.run_invoice_reminders(boolean) from public, anon, authenticated;
grant execute on function public.run_invoice_reminders(boolean) to service_role;

-- 3. Reconcile ------------------------------------------------------------------------------
create or replace function public.billing_reconcile_daily()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_counts jsonb;
  v_bad integer;
begin
  select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb),
         coalesce(sum(n) filter (where kind is distinct from 'matched'), 0)
    into v_counts, v_bad
  from (select r.kind, count(*) n from public.billing_payment_reconciliation() r group by r.kind) x;

  insert into public.ops_audit_log (actor, action, detail)
  values ('cron', 'billing_reconcile_daily', jsonb_build_object('counts', v_counts, 'mismatches', v_bad));

  if v_bad > 0 and to_regclass('public.platform_ops_notices') is not null then
    begin
      insert into public.platform_ops_notices (kind, detail)
      values ('billing_reconcile_mismatch',
              'Payment reconcile found ' || v_bad || ' row(s) that do not match: ' || v_counts::text);
    exception when unique_violation then null;
    end;
  end if;
  return v_counts;
end;
$function$;

revoke all on function public.billing_reconcile_daily() from public, anon, authenticated;

-- 4. Route caller ---------------------------------------------------------------------------
create or replace function public.billing_call_cron_route(p_path text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_base text;
  v_secret text;
  v_id bigint;
begin
  if p_path not in ('/api/cron/billing-payment-retry', '/api/cron/billing-reconcile') then
    raise exception 'route not allowed';
  end if;
  if to_regnamespace('net') is not null then
    select decrypted_secret into v_base from vault.decrypted_secrets where name = 'billing_cron_base_url';
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'billing_cron_secret';
  end if;
  if v_base is null or v_secret is null then
    if to_regclass('public.platform_ops_notices') is not null then
      begin
        insert into public.platform_ops_notices (kind, detail)
        values ('billing_cron_unconfigured',
                'pg_cron could not call ' || p_path || ': pg_net or the Vault secrets billing_cron_base_url / billing_cron_secret are missing.');
      exception when unique_violation then null;
      end;
    end if;
    return null;
  end if;
  execute 'select net.http_get(url := $1, headers := $2, timeout_milliseconds := 30000)'
    into v_id
    using rtrim(v_base, '/') || p_path,
          jsonb_build_object('Authorization', 'Bearer ' || v_secret);
  return v_id;
end;
$function$;

revoke all on function public.billing_call_cron_route(text) from public, anon, authenticated;

-- 5. Jobs -----------------------------------------------------------------------------------
do $m$ begin
  if exists (select 1 from cron.job where jobname = 'billing-payment-retry') then perform cron.unschedule('billing-payment-retry'); end if;
  perform cron.schedule('billing-payment-retry', '7 * * * *', $c$select public.billing_call_cron_route('/api/cron/billing-payment-retry');$c$);
  if exists (select 1 from cron.job where jobname = 'billing-invoice-reminders') then perform cron.unschedule('billing-invoice-reminders'); end if;
  perform cron.schedule('billing-invoice-reminders', '15 * * * *', $c$select count(*) from public.run_invoice_reminders(false);$c$);
  if exists (select 1 from cron.job where jobname = 'billing-reconcile-daily') then perform cron.unschedule('billing-reconcile-daily'); end if;
  perform cron.schedule('billing-reconcile-daily', '40 3 * * *', $c$select public.billing_reconcile_daily();$c$);
end $m$;
