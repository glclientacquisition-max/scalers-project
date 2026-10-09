-- Rows as the OLD assign_tenant_package wrote them (before package_state_rules.sql):
-- UTC month math (1 Oct EAT -> 31 Oct 00:00 EAT) and an annual row spanning 12 months.
insert into tenants(id,business_name,minutes_included) values
 ('bbbbbbbb-0000-0000-0000-000000000001','LegacyMonthly',300),
 ('bbbbbbbb-0000-0000-0000-000000000002','LegacyAnnual',300)
on conflict do nothing;
insert into tenant_subscriptions(tenant_id,package_id,period,current_period_start,current_period_end)
select 'bbbbbbbb-0000-0000-0000-000000000001', id, 'month', '2026-09-30 21:00+00', '2026-10-30 21:00+00' from billing_packages where sku='starter'
on conflict do nothing;
insert into tenant_subscriptions(tenant_id,package_id,period,current_period_start,current_period_end)
select 'bbbbbbbb-0000-0000-0000-000000000002', id, 'year', '2026-09-30 21:00+00', '2027-09-30 21:00+00' from billing_packages where sku='starter'
on conflict do nothing;
