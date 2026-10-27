-- write_receipts_prod.sql. APPLIED on prod fjxcdccgyhnvnnlnovcl 27 Oct 2026 17:37:03 EAT, version 20261027143703
-- (write_receipts_prod_w1), Alvin's yes 17:36 EAT. Rollback: write_receipts_prod_down.sql.
-- W1 (prod variant of supabase/migrations/20261014210000_write_receipts.sql @ 3fada615, applied on staging as
-- 20261014182100 write_receipts_20261014210000). Needed ONLY if prod WRITE_RECEIPTS=on: src/db.js
-- writeReceiptKeyColumn() then inserts idempotency_key into service_requests / appointments.
-- OMITS service_requests_one_open_callback_per_call_item: prod has 1 duplicate open callback
-- (Grow Tech, call ee17115a…, item "message", 12 Oct) so that unique index would fail. Not touching that data.
-- Also omits create_appointment_superseding (88d487dd); no code on the candidate calls it.
set lock_timeout = '3s';
alter table public.service_requests add column if not exists idempotency_key text;
alter table public.appointments    add column if not exists idempotency_key text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_requests_tenant_idem_key') then
    alter table public.service_requests add constraint service_requests_tenant_idem_key unique (tenant_id, idempotency_key);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'appointments_tenant_idem_key') then
    alter table public.appointments add constraint appointments_tenant_idem_key unique (tenant_id, idempotency_key);
  end if;
end $$;
create unique index if not exists appointments_one_open_per_call_service
  on public.appointments (tenant_id, call_id, lower(service_name))
  where status in ('requested', 'confirmed') and call_id is not null and idempotency_key is not null;
