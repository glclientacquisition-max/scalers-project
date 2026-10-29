-- Rollback for write_receipts_prod.sql (prod 20261027143703). Drops the idempotency_key columns (any keys written are lost).
drop index if exists public.appointments_one_open_per_call_service;
alter table public.appointments drop constraint if exists appointments_tenant_idem_key;
alter table public.service_requests drop constraint if exists service_requests_tenant_idem_key;
alter table public.appointments drop column if exists idempotency_key;
alter table public.service_requests drop column if exists idempotency_key;
