\set ON_ERROR_STOP 1
\pset footer off
-- Ops-Billing 18 Oct: rollover catch-up rebuild, on-demand audit, Activity before/after.
-- Every check raises on failure (ON_ERROR_STOP), so a passing run prints only notices.

-- R1 stale by several periods with usage, R2 stale by one period with usage (the D&D case),
-- R3 on-time roll, R4 on-time roll with a pending reservation from the OLD period only.
insert into tenants(id,business_name) values
 ('cccccccc-0000-0000-0000-000000000001','R1'),('cccccccc-0000-0000-0000-000000000002','R2'),
 ('cccccccc-0000-0000-0000-000000000003','R3'),('cccccccc-0000-0000-0000-000000000004','R4');
select a.change_kind from generate_series(1,4) n,
  lateral assign_tenant_package(('cccccccc-0000-0000-0000-00000000000'||n)::uuid, (select id from billing_packages where sku='starter')) a;

do $$
declare
  m0 timestamptz := date_trunc('month', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi'; -- this month, EAT
begin
  -- R1: period ended 2 months before this month started -> roll jumps 3 periods.
  update tenant_subscriptions set current_period_start = billing_add_months(m0,-3), current_period_end = billing_add_months(m0,-2),
    term_start = billing_add_months(m0,-3), term_end = billing_add_months(m0,-2)
  where tenant_id = 'cccccccc-0000-0000-0000-000000000001';
  -- R2: period ended at the start of this month (one step), but this month already has usage.
  update tenant_subscriptions set current_period_start = billing_add_months(m0,-1), current_period_end = m0,
    term_start = billing_add_months(m0,-1), term_end = m0
  where tenant_id = 'cccccccc-0000-0000-0000-000000000002';
  -- R3/R4: period ended a minute ago, nothing in the new period yet.
  update tenant_subscriptions set current_period_start = now() - interval '31 days', current_period_end = now() - interval '1 minute',
    term_start = now() - interval '31 days', term_end = now() - interval '1 minute'
  where tenant_id in ('cccccccc-0000-0000-0000-000000000003','cccccccc-0000-0000-0000-000000000004');

  -- Calls: in the new period (count) and before it (must not count).
  insert into calls(tenant_id, created_at, duration_seconds, package_seconds_applied) values
   ('cccccccc-0000-0000-0000-000000000001', m0 + interval '1 hour', 120, 120),
   ('cccccccc-0000-0000-0000-000000000001', greatest(m0 + interval '2 hours', now() - interval '5 minutes'), 61, 61),
   ('cccccccc-0000-0000-0000-000000000001', billing_add_months(m0,-1) + interval '3 days', 900, 900),
   ('cccccccc-0000-0000-0000-000000000002', m0 + interval '30 minutes', 300, 300),
   ('cccccccc-0000-0000-0000-000000000002', m0 - interval '1 hour', 999, 999),
   ('cccccccc-0000-0000-0000-000000000003', now() - interval '2 days', 400, 400),
   ('cccccccc-0000-0000-0000-000000000004', now() - interval '2 days', 50, 50);

  -- SMS ledger: sent (count), pending in window (count held), failed (never), platform (never), old period (never).
  insert into notify_sends(tenant_id, created_at, kind, channel, audience, billed_to, units, idempotency_key, status, held_units) values
   ('cccccccc-0000-0000-0000-000000000001', m0 + interval '1 hour', 'lead', 'sms', 'staff', 'tenant', 2, 'r1-a', 'sent', 0),
   ('cccccccc-0000-0000-0000-000000000001', m0 + interval '2 hours', 'lead', 'sms', 'staff', 'tenant', 1, 'r1-b', 'sent', 0),
   ('cccccccc-0000-0000-0000-000000000001', now() - interval '1 minute', 'lead', 'sms', 'staff', 'tenant', 3, 'r1-c', 'pending', 3),
   ('cccccccc-0000-0000-0000-000000000001', m0 + interval '3 hours', 'lead', 'sms', 'staff', 'tenant', 4, 'r1-d', 'failed', 0),
   ('cccccccc-0000-0000-0000-000000000001', m0 + interval '3 hours', 'lead', 'whatsapp', 'staff', 'tenant', 1, 'r1-e', 'sent', 0),
   ('cccccccc-0000-0000-0000-000000000001', billing_add_months(m0,-1) + interval '3 days', 'lead', 'sms', 'staff', 'tenant', 7, 'r1-f', 'sent', 0),
   ('cccccccc-0000-0000-0000-000000000002', m0 + interval '30 minutes', 'lead', 'sms', 'staff', 'tenant', 5, 'r2-a', 'sent', 0),
   ('cccccccc-0000-0000-0000-000000000003', now() - interval '2 days', 'lead', 'sms', 'staff', 'tenant', 9, 'r3-a', 'sent', 0),
   ('cccccccc-0000-0000-0000-000000000004', now() - interval '2 days', 'lead', 'sms', 'staff', 'tenant', 1, 'r4-a', 'pending', 1);

  -- Stale counters (what the old period left behind).
  perform set_config('scalers.wallet_write', '1', true);
  update tenants set seconds_used = 99999, sms_used_units = 613, email_used_units = 4
  where id::text like 'cccccccc-%';
end $$;

\echo === dry run reports the rebuild and changes nothing
select t.business_name, r.catch_up, r.seconds_used_after, r.sms_used_after
from roll_package_periods(true) r join tenants t on t.id = r.tenant_id where t.business_name like 'R_' order by 1;
do $$ begin
  if exists (select 1 from tenants where id::text like 'cccccccc-%' and seconds_used <> 99999) then
    raise exception 'FAIL: dry run changed counters';
  end if;
end $$;

\echo === real roll
select t.business_name, r.catch_up, r.seconds_used_after, r.sms_used_after, r.new_period_start <= now() and r.new_period_end > now() as current
from roll_package_periods(false) r join tenants t on t.id = r.tenant_id where t.business_name like 'R_' order by 1;

do $$
declare
  v record;
begin
  -- R1 stale catch-up with usage: 120 + 61 seconds; SMS 2 + 1 sent + 3 pending.
  select seconds_used, sms_used_units, email_used_units into v from tenants where business_name = 'R1';
  if v.seconds_used <> 181 or v.sms_used_units <> 6 or v.email_used_units <> 0 then
    raise exception 'FAIL R1 stale catch-up: got seconds %, sms %, email %', v.seconds_used, v.sms_used_units, v.email_used_units;
  end if;
  -- R2 one-step catch-up (new period already had usage).
  select seconds_used, sms_used_units into v from tenants where business_name = 'R2';
  if v.seconds_used <> 300 or v.sms_used_units <> 5 then
    raise exception 'FAIL R2 catch-up with usage: got seconds %, sms %', v.seconds_used, v.sms_used_units;
  end if;
  -- R3/R4 on-time roll: zero (old-period calls, SMS and pending holds stay in the old period).
  if exists (select 1 from tenants where business_name in ('R3','R4') and (seconds_used <> 0 or sms_used_units <> 0)) then
    raise exception 'FAIL on-time roll did not zero';
  end if;
  -- Audit rows say which path ran.
  if (select count(*) from ops_audit_log where action = 'package_period_rollover'
        and tenant_id in ('cccccccc-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002')
        and detail->>'counters_source' = 'rebuilt_from_ledger' and (detail->>'catch_up')::boolean) <> 2 then
    raise exception 'FAIL catch-up audit rows';
  end if;
  if (select (detail->>'periods_rolled')::int from ops_audit_log where action = 'package_period_rollover'
        and tenant_id = 'cccccccc-0000-0000-0000-000000000001') <> 3 then
    raise exception 'FAIL R1 periods_rolled';
  end if;
  if (select count(*) from ops_audit_log where action = 'package_period_rollover'
        and tenant_id in ('cccccccc-0000-0000-0000-000000000003','cccccccc-0000-0000-0000-000000000004')
        and detail->>'counters_source' = 'zero') <> 2 then
    raise exception 'FAIL on-time audit rows';
  end if;
  -- Every rolled row is now current.
  if exists (select 1 from tenant_subscriptions s join tenants t on t.id = s.tenant_id
             where t.business_name like 'R_' and not (s.current_period_start <= now() and s.current_period_end > now())) then
    raise exception 'FAIL period not current after roll';
  end if;
  raise notice 'rollover catch-up: ok';
end $$;

\echo === re-run changes nothing (no rows, counters and audit unchanged)
do $$
declare
  n int; a int; s1 int; s2 int;
begin
  select sum(seconds_used + sms_used_units) into s1 from tenants where id::text like 'cccccccc-%';
  select count(*) into a from ops_audit_log;
  select count(*) into n from roll_package_periods(false);
  select sum(seconds_used + sms_used_units) into s2 from tenants where id::text like 'cccccccc-%';
  if n <> 0 or s1 <> s2 or (select count(*) from ops_audit_log) <> a then
    raise exception 'FAIL re-run: rows %, counters % -> %', n, s1, s2;
  end if;
  raise notice 'rollover re-run: ok';
end $$;

\echo === on-demand audit: service call, owner call, no-op save
insert into auth.users(id, email) values ('99999999-0000-0000-0000-0000000000aa', 'owner-r3@example.test');
insert into tenant_members(tenant_id, user_id) values ('cccccccc-0000-0000-0000-000000000003', '99999999-0000-0000-0000-0000000000aa');
select on_demand_usage_enabled from set_tenant_on_demand_usage('cccccccc-0000-0000-0000-000000000003', true);
select on_demand_usage_enabled from set_tenant_on_demand_usage('cccccccc-0000-0000-0000-000000000003', true);  -- no change, no row
begin;
select set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-0000000000aa', true),
       set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select on_demand_usage_enabled from set_tenant_on_demand_usage('cccccccc-0000-0000-0000-000000000003', false);
do $$ begin
  perform set_tenant_on_demand_usage('cccccccc-0000-0000-0000-000000000001', true);
  raise exception 'FAIL: owner changed another business';
exception when others then
  if sqlerrm not like '%not allowed%' then raise; end if;
  raise notice 'owner of other business -> %', sqlerrm;
end $$;
commit;
do $$
declare r record; n int;
begin
  select count(*) into n from ops_audit_log where action = 'set_on_demand_usage';
  if n <> 2 then raise exception 'FAIL on-demand audit rows: % (want 2)', n; end if;
  select * into r from ops_audit_log where action = 'set_on_demand_usage' order by created_at, (detail->>'source') desc limit 1;
  if r.actor <> 'ops' or r.tenant_id <> 'cccccccc-0000-0000-0000-000000000003'
     or r.detail->'before'->>'on_demand_usage_enabled' <> 'false' or r.detail->'after'->>'on_demand_usage_enabled' <> 'true'
     or r.detail->>'source' <> 'service' then
    raise exception 'FAIL service row: % %', r.actor, r.detail;
  end if;
  select * into r from ops_audit_log where action = 'set_on_demand_usage' and detail->>'source' = 'owner';
  if r.actor <> 'owner-r3@example.test' or r.detail->'before'->>'on_demand_usage_enabled' <> 'true'
     or r.detail->'after'->>'on_demand_usage_enabled' <> 'false' then
    raise exception 'FAIL owner row: % %', r.actor, r.detail;
  end if;
  if (select on_demand_usage_enabled from tenants where business_name = 'R3') then
    raise exception 'FAIL on-demand value not saved';
  end if;
  raise notice 'on-demand audit: ok';
end $$;

\echo === Activity detail.before / detail.after on assign and unassign
insert into tenants(id,business_name) values ('cccccccc-0000-0000-0000-000000000005','R5');
select change_kind from assign_tenant_package('cccccccc-0000-0000-0000-000000000005',(select id from billing_packages where sku='starter'),'month','alvin@scalers.co.ke','first');
select change_kind from assign_tenant_package('cccccccc-0000-0000-0000-000000000005',(select id from billing_packages where sku='growth'),'month','alvin@scalers.co.ke','upgrade');
select change_kind from assign_tenant_package('cccccccc-0000-0000-0000-000000000005',(select id from billing_packages where sku='starter'),'month','alvin@scalers.co.ke','downgrade');
select package_state from unassign_tenant_package('cccccccc-0000-0000-0000-000000000005','period_end','closing','alvin@scalers.co.ke');
select package_state from unassign_tenant_package('cccccccc-0000-0000-0000-000000000005','now','closed now','alvin@scalers.co.ke');
select action, detail->>'change_kind' kind, detail->>'when' w, detail->'before'->>'package_sku' b_sku, detail->'before'->>'status' b_status,
       detail->'after'->>'package_sku' a_sku, detail->'after'->>'package_name' a_name, detail->'after'->>'status' a_status, detail->>'scheduled' sched
from ops_audit_log where tenant_id = 'cccccccc-0000-0000-0000-000000000005' order by created_at, id;
do $$
declare
  keys text[] := array['package_sku','package_name','period','period_start','period_end','status'];
  r record; k text; sub tenant_subscriptions%rowtype;
begin
  select * into sub from tenant_subscriptions where tenant_id = 'cccccccc-0000-0000-0000-000000000005';
  for r in select * from ops_audit_log where tenant_id = 'cccccccc-0000-0000-0000-000000000005' loop
    foreach k in array keys loop
      if not (r.detail->'before') ? k or not (r.detail->'after') ? k then
        raise exception 'FAIL % row missing before/after key %: %', r.action, k, r.detail;
      end if;
    end loop;
  end loop;
  -- new: none -> starter; existing fields kept
  select * into r from ops_audit_log where tenant_id = sub.tenant_id and detail->>'change_kind' = 'new';
  if r.detail->'before'->>'status' <> 'none' or r.detail->'after'->>'package_sku' <> 'starter'
     or r.detail->'after'->>'package_name' is null or r.detail->'after'->>'status' <> 'active'
     or r.detail->>'package_sku' <> 'starter' or r.detail->>'minutes_included_after' is null or r.detail->>'note' <> 'first' then
    raise exception 'FAIL new row: %', r.detail;
  end if;
  select * into r from ops_audit_log where tenant_id = sub.tenant_id and detail->>'change_kind' = 'upgrade';
  if r.detail->'before'->>'package_sku' <> 'starter' or r.detail->'after'->>'package_sku' <> 'growth'
     or (r.detail->>'scheduled')::boolean then
    raise exception 'FAIL upgrade row: %', r.detail;
  end if;
  -- scheduled downgrade: after = starter from the effective date
  select * into r from ops_audit_log where tenant_id = sub.tenant_id and detail->>'change_kind' = 'downgrade_scheduled';
  if r.detail->'before'->>'package_sku' <> 'growth' or r.detail->'after'->>'package_sku' <> 'starter'
     or not (r.detail->>'scheduled')::boolean
     or (r.detail->'after'->>'period_start')::timestamptz <> (r.detail->>'effective_at')::timestamptz then
    raise exception 'FAIL downgrade row: %', r.detail;
  end if;
  select * into r from ops_audit_log where tenant_id = sub.tenant_id and action = 'unassign_package' and detail->>'when' = 'period_end';
  if r.detail->'before'->>'status' <> 'active' or r.detail->'after'->>'status' <> 'none'
     or r.detail->'after'->>'package_sku' is not null or not (r.detail->>'scheduled')::boolean then
    raise exception 'FAIL unassign period_end row: %', r.detail;
  end if;
  select * into r from ops_audit_log where tenant_id = sub.tenant_id and action = 'unassign_package' and detail->>'when' = 'now';
  if r.detail->'before'->>'package_sku' <> 'growth' or r.detail->'after'->>'status' <> 'none'
     or r.detail->>'grant_minutes_kept' is null
     or (r.detail->'after'->>'period_end')::timestamptz <> sub.current_period_end then
    raise exception 'FAIL unassign now row: %', r.detail;
  end if;
  raise notice 'activity before/after: ok';
end $$;
