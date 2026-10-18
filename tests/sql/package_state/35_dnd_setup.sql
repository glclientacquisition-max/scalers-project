\set ON_ERROR_STOP 1
-- Local copy of the staging situation for docs/supabase/staging/dnd_usage_counter_reconcile.sql:
-- October already rolled, counters zeroed, October calls and SMS in the ledgers.
insert into tenants(id,business_name) values ('df4ad9d8-28ff-4810-b1e6-94f5495472b0','Done and Dusted Cleaning Services');
select change_kind from assign_tenant_package('df4ad9d8-28ff-4810-b1e6-94f5495472b0',(select id from billing_packages where sku='starter'));
do $$
declare
  s timestamptz;
begin
  select current_period_start into s from tenant_subscriptions where tenant_id = 'df4ad9d8-28ff-4810-b1e6-94f5495472b0';
  insert into calls(tenant_id, created_at, duration_seconds, package_seconds_applied) values
   ('df4ad9d8-28ff-4810-b1e6-94f5495472b0', s + interval '1 minute', 700, 700),
   ('df4ad9d8-28ff-4810-b1e6-94f5495472b0', s + interval '2 minutes', 92, 92),
   ('df4ad9d8-28ff-4810-b1e6-94f5495472b0', s - interval '1 day', 172, 172);
  insert into notify_sends(tenant_id, created_at, kind, channel, audience, billed_to, units, idempotency_key, status, held_units) values
   ('df4ad9d8-28ff-4810-b1e6-94f5495472b0', s + interval '1 minute', 'lead', 'sms', 'staff', 'tenant', 3, 'dnd-a', 'sent', 0),
   ('df4ad9d8-28ff-4810-b1e6-94f5495472b0', s - interval '1 day', 'lead', 'sms', 'staff', 'tenant', 8, 'dnd-b', 'sent', 0);
  perform set_config('scalers.wallet_write', '1', true);
  update tenants set seconds_used = 0, sms_used_units = 0 where id = 'df4ad9d8-28ff-4810-b1e6-94f5495472b0';
end $$;
