\set ON_ERROR_STOP 1
\pset footer off
insert into tenant_members(tenant_id,user_id) values ('aaaaaaaa-0000-0000-0000-000000000001','99999999-0000-0000-0000-000000000001');
select minutes_granted from grant_tenant_package_minutes('aaaaaaaa-0000-0000-0000-000000000001',15,'internal ops note','alvin','g-rls');
select minutes_granted from grant_tenant_package_minutes('aaaaaaaa-0000-0000-0000-000000000002',15,'other tenant','alvin','g-rls');
set role authenticated;
select set_config('request.jwt.claim.sub','99999999-0000-0000-0000-000000000001',false);
\echo === owner of A sees only A, with grants summed
select business_name, package_state, package_sku, included_minutes, granted_minutes, mode_label from tenant_billing_state;
select tenant_id, minutes from tenant_minute_grants;
do $$ begin perform note from tenant_minute_grants; exception when others then raise notice 'grant note -> %', sqlerrm; end $$;
do $$ begin perform 1 from ops_audit_log; exception when others then raise notice 'audit -> %', sqlerrm; end $$;
do $$ begin perform assign_tenant_package('aaaaaaaa-0000-0000-0000-000000000001',(select id from billing_packages where sku='scale')); exception when others then raise notice 'owner assign -> %', sqlerrm; end $$;
do $$ begin perform unassign_tenant_package('aaaaaaaa-0000-0000-0000-000000000001','now','owner try'); exception when others then raise notice 'owner unassign -> %', sqlerrm; end $$;
select set_config('request.jwt.claim.sub','',false);
\echo === stranger sees nothing
select count(*) stranger_rows from tenant_billing_state;
reset role;
set role anon;
do $$ begin perform 1 from tenant_billing_state; exception when others then raise notice 'anon -> %', sqlerrm; end $$;
reset role;
