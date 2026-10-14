-- Write receipts: one idempotency key per logical write on a call.
-- Ship-only file. NOT applied anywhere by this PR; apply on staging first
-- (Platform, with a go), then prod only with Alvin's explicit yes.
--
-- Why a full unique (tenant_id, idempotency_key) and not WHERE-partial:
-- PostgREST/supabase-js upsert(onConflict) cannot target a partial index
-- predicate. NULLs are distinct in Postgres, so legacy rows (key NULL) never
-- collide: this behaves as "unique where idempotency_key is not null".
-- The extra partial index below enforces one OPEN callback per call+item.

alter table public.service_requests add column if not exists idempotency_key text;
alter table public.appointments    add column if not exists idempotency_key text;

-- Pre-check (run before the constraints; must return 0 rows):
--   select tenant_id, idempotency_key, count(*) from public.service_requests
--    where idempotency_key is not null group by 1,2 having count(*) > 1;
--   select tenant_id, call_id, lower(item), count(*) from public.service_requests
--    where request_type = 'callback' and status = 'open' and call_id is not null
--    group by 1,2,3 having count(*) > 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_requests_tenant_idem_key') then
    alter table public.service_requests
      add constraint service_requests_tenant_idem_key unique (tenant_id, idempotency_key);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'appointments_tenant_idem_key') then
    alter table public.appointments
      add constraint appointments_tenant_idem_key unique (tenant_id, idempotency_key);
  end if;
end $$;

create unique index if not exists service_requests_one_open_callback_per_call_item
  on public.service_requests (tenant_id, call_id, lower(coalesce(item, '')))
  where request_type = 'callback' and status = 'open' and call_id is not null;

create unique index if not exists appointments_one_open_per_call_service
  on public.appointments (tenant_id, call_id, lower(service_name))
  where status in ('requested', 'confirmed') and call_id is not null
    and idempotency_key is not null;

-- Rollback:
--   drop index if exists public.appointments_one_open_per_call_service;
--   drop index if exists public.service_requests_one_open_callback_per_call_item;
--   alter table public.appointments drop constraint if exists appointments_tenant_idem_key;
--   alter table public.service_requests drop constraint if exists service_requests_tenant_idem_key;
--   alter table public.appointments drop column if exists idempotency_key;
--   alter table public.service_requests drop column if exists idempotency_key;
