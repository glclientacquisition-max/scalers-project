-- Extra tables the owner billing scenarios need. Throwaway database only.
create or replace function auth.role()
returns text
language sql
stable
as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
alter table public.tenant_members add column if not exists role text;
alter table public.tenants add column if not exists sms_used_units integer not null default 0;

create table if not exists public.tenant_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  status text not null default 'pending',
  expires_at timestamptz
);

-- reserve_notify_send declares notify_sends%rowtype, which Postgres resolves at create time.
create table if not exists public.notify_sends (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  call_id uuid,
  call_sid text,
  kind text,
  channel text,
  recipient text,
  audience text,
  billed_to text,
  units integer,
  body text,
  idempotency_key text,
  overage boolean,
  status text,
  held_units integer,
  outcome text,
  failure_reason text,
  attempts integer not null default 1,
  reserved_at timestamptz,
  settled_at timestamptz,
  provider_message_id text
);

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  created_at timestamptz not null default now(),
  package_seconds_applied integer not null default 0
);

create or replace function public._wallet_apply_delta(
  p_tenant_id uuid,
  p_kind text,
  p_amount_kes numeric,
  p_reference_type text,
  p_reference_id text,
  p_note text,
  p_metadata jsonb
) returns void
language plpgsql
as $$
begin
  insert into public.wallet_ledger (tenant_id, kind, amount_kes, metadata)
  values (p_tenant_id, p_kind, p_amount_kes, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

create table if not exists public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null,
  amount_kes numeric not null,
  reference_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
