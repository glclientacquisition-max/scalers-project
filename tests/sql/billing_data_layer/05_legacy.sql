-- Rows that exist before the data layer, so backfill and grandfathering are real.
insert into public.tenants (
  id, business_name, sautikit_virtual_number, billing_enforcement,
  minutes_included, seconds_used, line_status, whatsapp_notification_number, alert_email
) values
  (
    '11111111-1111-1111-1111-111111111111',
    'Legacy Beta',
    'pending:11111111-1111-1111-1111-111111111111',
    'off', 300, 10, 'active', '+254700000001', 'legacy@example.com'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Archived Co',
    'pending:22222222-2222-2222-2222-222222222222',
    'off', 300, 0, 'active', '+254700000002', 'archived@example.com'
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'Suspended Co',
    'pending:33333333-3333-3333-3333-333333333333',
    'off', 300, 0, 'active', '+254700000003', 'suspended@example.com'
  );

update public.tenants set archived_at = now() where id = '22222222-2222-2222-2222-222222222222';
update public.tenants set suspended_at = now(), line_status = 'suspended'
where id = '33333333-3333-3333-3333-333333333333';

insert into public.tenant_subscriptions (tenant_id, package_id, status)
select t.id, p.id, 'active'
from public.tenants t
cross join public.billing_packages p
where p.sku = 'starter'
  and t.id in (
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333'
  );
