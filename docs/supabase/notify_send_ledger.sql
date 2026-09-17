-- notify_send_ledger.sql
-- Purpose: append-only log of every staff/caller/ops notify that left.
--          Staff and caller SMS are tenant usage. Wallet and line-outage
--          alerts are billed_to = platform (Scalers pays).
-- Run after: contacts_and_requests.sql (tenants, calls, current_user_tenant_ids).
-- Idempotent. Does not charge. Quota: docs/supabase/sms_allowance.sql.
-- Voice writes via service_role. Owners may INSERT caller rows for their tenant
-- (desk confirm / reschedule / note). Owners SELECT their own rows.

create table if not exists public.notify_sends (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  call_id uuid references public.calls (id) on delete set null,
  call_sid text,
  kind text not null,
  channel text not null,
  recipient text,
  audience text not null,
  billed_to text not null,
  units integer not null default 1,
  body text,
  provider_message_id text,
  idempotency_key text not null,
  constraint notify_sends_channel_check check (
    channel in ('sms', 'whatsapp', 'email')
  ),
  constraint notify_sends_audience_check check (
    audience in ('staff', 'caller')
  ),
  constraint notify_sends_billed_to_check check (
    billed_to in ('tenant', 'platform')
  ),
  constraint notify_sends_units_check check (units >= 0)
);

create unique index if not exists notify_sends_idempotency_idx
  on public.notify_sends (tenant_id, idempotency_key);

create index if not exists notify_sends_tenant_created_idx
  on public.notify_sends (tenant_id, created_at desc);

create index if not exists notify_sends_tenant_billed_idx
  on public.notify_sends (tenant_id, billed_to, channel, created_at desc);

comment on table public.notify_sends is
  'Append-only notify send log. Tenant SMS = staff + caller. Platform = wallet/outage.';

alter table public.notify_sends enable row level security;

drop policy if exists notify_sends_select_member on public.notify_sends;
create policy notify_sends_select_member
  on public.notify_sends
  for select
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists notify_sends_insert_caller_member on public.notify_sends;
create policy notify_sends_insert_caller_member
  on public.notify_sends
  for insert
  to authenticated
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    and audience = 'caller'
    and billed_to = 'tenant'
    and channel = 'sms'
  );

grant select, insert on public.notify_sends to authenticated;
grant all on public.notify_sends to service_role;

create or replace function public.notify_sends_deny_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'notify_sends is append-only';
end;
$$;

drop trigger if exists notify_sends_no_update on public.notify_sends;
create trigger notify_sends_no_update
  before update on public.notify_sends
  for each row execute function public.notify_sends_deny_mutation();

drop trigger if exists notify_sends_no_delete on public.notify_sends;
create trigger notify_sends_no_delete
  before delete on public.notify_sends
  for each row execute function public.notify_sends_deny_mutation();
