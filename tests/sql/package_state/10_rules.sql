\set ON_ERROR_STOP 1
\pset footer off
-- tenants: A (new->upgrade->downgrade->roll), B (unassign now), C (unassign at period end), D (period change)
insert into tenants(id,business_name) values
 ('aaaaaaaa-0000-0000-0000-000000000001','A'),('aaaaaaaa-0000-0000-0000-000000000002','B'),
 ('aaaaaaaa-0000-0000-0000-000000000003','C'),('aaaaaaaa-0000-0000-0000-000000000004','D');
\echo === A starts with no package
select tenant_id is not null ok, package_state, mode_label, included_minutes from tenant_billing_state where business_name='A';
\echo === A assign starter (new)
select change_kind, minutes_included from assign_tenant_package('aaaaaaaa-0000-0000-0000-000000000001',(select id from billing_packages where sku='starter'),'month','alvin','t');
select minutes_granted from grant_tenant_package_minutes('aaaaaaaa-0000-0000-0000-000000000001',60,'goodwill','alvin','g1');
select set_config('scalers.wallet_write','1',false); update tenants set seconds_used=6000 where business_name='A'; select set_config('scalers.wallet_write','',false);
\echo === A upgrade to growth: expect 300 + ceil(500*remaining) + 60, grants and usage kept
select change_kind, minutes_included, 300 + ceil(500 * extract(epoch from (s.current_period_end-now()))/extract(epoch from (s.current_period_end-s.current_period_start)))::int + 60 as expected
from assign_tenant_package('aaaaaaaa-0000-0000-0000-000000000001',(select id from billing_packages where sku='growth')), tenant_subscriptions s where s.tenant_id='aaaaaaaa-0000-0000-0000-000000000001';
select package_sku, included_minutes, package_minutes, granted_minutes, used_seconds, remaining_minutes, sms_included from tenant_billing_state where business_name='A';
\echo === A same package (no-op) x2
select change_kind, minutes_included from assign_tenant_package('aaaaaaaa-0000-0000-0000-000000000001',(select id from billing_packages where sku='growth'));
\echo === A downgrade to starter: scheduled, nothing changes now
select change_kind, effective_at = (select current_period_end from tenant_subscriptions where tenant_id='aaaaaaaa-0000-0000-0000-000000000001') eff_is_period_end, minutes_included from assign_tenant_package('aaaaaaaa-0000-0000-0000-000000000001',(select id from billing_packages where sku='starter'));
select change_kind from assign_tenant_package('aaaaaaaa-0000-0000-0000-000000000001',(select id from billing_packages where sku='starter'));
select package_sku, pending_change, pending_package_sku, included_minutes from tenant_billing_state where business_name='A';
\echo === A re-assign growth cancels pending
select change_kind from assign_tenant_package('aaaaaaaa-0000-0000-0000-000000000001',(select id from billing_packages where sku='growth'));
select pending_change from tenant_subscriptions where tenant_id='aaaaaaaa-0000-0000-0000-000000000001';
select change_kind from assign_tenant_package('aaaaaaaa-0000-0000-0000-000000000001',(select id from billing_packages where sku='starter'));
\echo === B unassign now: grants kept for this period, sms 0, never unlimited
select change_kind from assign_tenant_package('aaaaaaaa-0000-0000-0000-000000000002',(select id from billing_packages where sku='starter'));
select minutes_granted from grant_tenant_package_minutes('aaaaaaaa-0000-0000-0000-000000000002',30,'goodwill','alvin','g1');
select package_state, minutes_included from unassign_tenant_package('aaaaaaaa-0000-0000-0000-000000000002','now','churned','alvin');
select package_state, minutes_included from unassign_tenant_package('aaaaaaaa-0000-0000-0000-000000000002','now','churned','alvin');
select package_state, package_sku, included_minutes, package_minutes, granted_minutes, sms_included, seat_included from tenant_billing_state v join tenants t on t.id=v.tenant_id where v.business_name='B';
\echo === B re-assign starter from none reuses running period clock
select change_kind, minutes_included from assign_tenant_package('aaaaaaaa-0000-0000-0000-000000000002',(select id from billing_packages where sku='starter'));
select status, ended_at is null ended_cleared from tenant_subscriptions where tenant_id='aaaaaaaa-0000-0000-0000-000000000002';
\echo === C unassign at period end (scheduled), D month->year same package (scheduled)
select change_kind from assign_tenant_package('aaaaaaaa-0000-0000-0000-000000000003',(select id from billing_packages where sku='scale'));
select package_state, effective_at is not null scheduled from unassign_tenant_package('aaaaaaaa-0000-0000-0000-000000000003','period_end','closing','alvin');
select package_state from unassign_tenant_package('aaaaaaaa-0000-0000-0000-000000000003','period_end','closing','alvin');
select change_kind from assign_tenant_package('aaaaaaaa-0000-0000-0000-000000000004',(select id from billing_packages where sku='starter'));
select change_kind from assign_tenant_package('aaaaaaaa-0000-0000-0000-000000000004',(select id from billing_packages where sku='starter'),'year');
\echo === validation
do $$ begin perform unassign_tenant_package('aaaaaaaa-0000-0000-0000-000000000003','later','closing'); exception when others then raise notice 'bad when -> %', sqlerrm; end $$;
do $$ begin perform unassign_tenant_package('aaaaaaaa-0000-0000-0000-000000000003','now','x'); exception when others then raise notice 'short note -> %', sqlerrm; end $$;
do $$ begin perform assign_tenant_package('aaaaaaaa-0000-0000-0000-000000000009',(select id from billing_packages where sku='starter')); exception when others then raise notice 'no tenant -> %', sqlerrm; end $$;
\echo === simulate period end for A, C, D (shift periods and grants back 31 days)
update tenant_minute_grants g set period_start = g.period_start - interval '31 days', period_end = g.period_end - interval '31 days';
update tenant_subscriptions s set current_period_start = now() - interval '31 days', current_period_end = now() - interval '1 minute',
  pending_effective_at = case when s.pending_change is not null then now() - interval '1 minute' end;
update tenant_minute_grants g set period_start = now() - interval '31 days';
select set_config('scalers.wallet_write','1',false); update tenants set sms_used_units=7; select set_config('scalers.wallet_write','',false);
\echo --- dry run changes nothing
select t.business_name, r.applied_change, (select sku from billing_packages where id=r.package_id_after) pkg_after, r.period, r.minutes_included_after from roll_package_periods(true) r join tenants t on t.id=r.tenant_id order by 1;
select count(*) filter (where current_period_end <= now()) still_due from tenant_subscriptions;
\echo --- real roll
select t.business_name, r.applied_change, (select sku from billing_packages where id=r.package_id_after) pkg_after, r.period, r.minutes_included_after from roll_package_periods(false) r join tenants t on t.id=r.tenant_id order by 1;
\echo --- second roll is a no-op
select count(*) rerun_rows from roll_package_periods(false);
select v.business_name, v.package_state, v.package_sku, v.billing_period, v.pending_change, v.included_minutes, v.granted_minutes, v.used_seconds, v.sms_counter, (select count(*) from tenant_minute_grants g where g.tenant_id=v.tenant_id) grant_rows_kept from tenant_billing_state v order by 1;
\echo === overage owed: B metered (soft + on-demand) vs capped vs beta
select set_config('scalers.wallet_write','1',false);
update tenants set billing_enforcement='soft', on_demand_usage_enabled=true, seconds_used=300*60+100, sms_used_units=250 where business_name='B';
update tenants set billing_enforcement='hard', on_demand_usage_enabled=false, seconds_used=999999 where business_name='C';
update tenants set soft_spend_limit_enabled=true, soft_spend_limit_kes=2000 where business_name='B';
select set_config('scalers.wallet_write','',false);
select business_name, mode_label, overage_seconds, sms_overage_units, overage_owed_kes, spend_cap_kes, sms_used_source from tenant_billing_state order by 1;
\echo === audit trail
select action, detail->>'change_kind' kind, detail->>'when' w, count(*) from ops_audit_log group by 1,2,3 order by 1,2,3;
