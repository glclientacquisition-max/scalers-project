-- STAGING ONLY (scalers-staging, sgcdncjxauhsbunobmob). Never run on prod ALCR.
-- dnd_usage_counter_reconcile.sql
-- STATUS: DRAFT, NOT RUN. Needs Alvin's GO (staging write).
--
-- What: put Done and Dusted's October usage counters back. The period
-- rollover caught up its stale September period at 17 Oct 2026 22:05 EAT
-- (ops_audit_log package_period_rollover, old_end 1 Oct 00:00 EAT -> new
-- period 1 Oct - 1 Nov EAT) and ZEROED the counters, although October already
-- had usage. Admin/Desk then showed 0 minutes used despite October's calls.
-- The rollover fix in the same PR rebuilds instead of zeroing; this script
-- repairs the one tenant already hit.
--
-- Rebuild (same rule as roll_package_periods on a catch-up), for the CURRENT
-- usage period [current_period_start, current_period_end):
--   seconds_used   = sum(calls.package_seconds_applied), calls created in it
--   sms_used_units = sum(notify_sms_billable.units) in it
--                    + held_units of pending SMS reservations in it
-- minutes_included, grants, email/whatsapp counters: untouched.
-- Money: none. D&D is billing_enforcement = off (beta) on staging.
--
-- Read-only staging check, 18 Oct 2026 ~09:50 EAT:
--   seconds_used 0  -> 17,792 (calls in Oct: 378; applied seconds 17,792)
--   sms_used_units 0 -> 150   (notify_sms_billable in Oct; 0 pending)
-- Effect to expect after it: D&D sits at ~99% of 300 included minutes, so the
-- next staging call sends the 80%/100% ops email once (staging ops list).
--
-- Order: run the dry run, read it, then run the apply block. Re-running the
-- apply block after a successful run is a no-op (nothing differs, no audit row).

-- ---------------------------------------------------------------------------
-- 1. DRY RUN (read-only)
-- ---------------------------------------------------------------------------
select t.id, t.business_name, s.current_period_start, s.current_period_end,
       t.seconds_used as seconds_now,
       (select coalesce(sum(c.package_seconds_applied), 0)::integer from public.calls c
         where c.tenant_id = t.id
           and c.created_at >= s.current_period_start and c.created_at < s.current_period_end) as seconds_rebuilt,
       t.sms_used_units as sms_now,
       ((select coalesce(sum(b.units), 0) from public.notify_sms_billable b
          where b.tenant_id = t.id
            and b.created_at >= s.current_period_start and b.created_at < s.current_period_end)
      + (select coalesce(sum(n.held_units), 0) from public.notify_sends n
          where n.tenant_id = t.id and n.channel = 'sms' and n.billed_to = 'tenant' and n.status = 'pending'
            and n.created_at >= s.current_period_start and n.created_at < s.current_period_end))::integer as sms_rebuilt,
       t.minutes_included
from public.tenants t
join public.tenant_subscriptions s on s.tenant_id = t.id
where t.id = 'df4ad9d8-28ff-4810-b1e6-94f5495472b0';

-- ---------------------------------------------------------------------------
-- 2. APPLY (one transaction, one audit row). Review the dry run first.
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_tenant constant uuid := 'df4ad9d8-28ff-4810-b1e6-94f5495472b0';
  v_start timestamptz;
  v_end timestamptz;
  v_secs_before integer;
  v_sms_before integer;
  v_secs integer;
  v_sms integer;
begin
  -- Refuse anywhere but staging: the live customer is only on prod.
  if exists (select 1 from public.tenants where business_name ilike 'Aris%') then
    raise exception 'refusing: this looks like production (Aris tenant present)';
  end if;
  if not exists (
    select 1 from public.tenants
    where id = v_tenant and business_name ilike 'Done and Dusted%'
  ) then
    raise exception 'refusing: Done and Dusted staging tenant % not found', v_tenant;
  end if;

  -- Lock the tenant: a call or SMS metered meanwhile waits for this commit.
  select coalesce(t.seconds_used, 0), coalesce(t.sms_used_units, 0)
    into v_secs_before, v_sms_before
  from public.tenants t where t.id = v_tenant for update;

  select s.current_period_start, s.current_period_end into v_start, v_end
  from public.tenant_subscriptions s where s.tenant_id = v_tenant;
  if v_start is null or v_end is null or v_end <= now() then
    raise exception 'refusing: no current usage period (start %, end %); run the rollover first', v_start, v_end;
  end if;

  select coalesce(sum(c.package_seconds_applied), 0)::integer into v_secs
  from public.calls c
  where c.tenant_id = v_tenant and c.created_at >= v_start and c.created_at < v_end;

  select ((select coalesce(sum(b.units), 0) from public.notify_sms_billable b
            where b.tenant_id = v_tenant and b.created_at >= v_start and b.created_at < v_end)
        + (select coalesce(sum(n.held_units), 0) from public.notify_sends n
            where n.tenant_id = v_tenant and n.channel = 'sms' and n.billed_to = 'tenant'
              and n.status = 'pending' and n.created_at >= v_start and n.created_at < v_end))::integer
    into v_sms;

  if v_secs = v_secs_before and v_sms = v_sms_before then
    raise notice 'already reconciled: seconds % sms %; nothing written', v_secs, v_sms;
    return;
  end if;

  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants t
     set seconds_used = v_secs,
         sms_used_units = v_sms
   where t.id = v_tenant;

  insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
  values ('ops-billing', 'usage_counter_reconcile', v_tenant, null, jsonb_build_object(
    'reason', 'Period rollover caught up a stale period on 17 Oct 2026 and zeroed usage already in the new period. Rebuilt from calls and the SMS ledger.',
    'period_start', v_start,
    'period_end', v_end,
    'before', jsonb_build_object('seconds_used', v_secs_before, 'sms_used_units', v_sms_before),
    'after', jsonb_build_object('seconds_used', v_secs, 'sms_used_units', v_sms),
    'approved_by', 'Alvin Yegon'));

  raise notice 'reconciled: seconds % -> %, sms % -> %', v_secs_before, v_secs, v_sms_before, v_sms;
end $$;

-- Expect seconds_used / sms_used_units = the dry run's rebuilt values.
select seconds_used, sms_used_units from public.tenants
where id = 'df4ad9d8-28ff-4810-b1e6-94f5495472b0';

commit;   -- or rollback; if the numbers are not the dry run's

-- ---------------------------------------------------------------------------
-- Rollback after commit (restores the values from the audit row):
-- begin;
-- select set_config('scalers.wallet_write', '1', true);
-- update public.tenants t
--    set seconds_used = (a.detail->'before'->>'seconds_used')::integer,
--        sms_used_units = (a.detail->'before'->>'sms_used_units')::integer
--   from (select detail from public.ops_audit_log
--          where action = 'usage_counter_reconcile'
--            and tenant_id = 'df4ad9d8-28ff-4810-b1e6-94f5495472b0'
--          order by created_at desc limit 1) a
--  where t.id = 'df4ad9d8-28ff-4810-b1e6-94f5495472b0';
-- commit;
