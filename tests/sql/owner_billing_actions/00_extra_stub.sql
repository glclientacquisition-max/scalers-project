-- Extra tables the owner billing scenarios need. Throwaway database only.
alter table public.tenant_members add column if not exists role text;

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

create table if not exists public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null,
  amount_kes numeric not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
