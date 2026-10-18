-- Throwaway tables for billing_data_layer.sql. Never point this at Supabase.
create extension if not exists pgcrypto;

do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;

create schema if not exists auth;
create or replace function auth.uid()
returns uuid
language sql
stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  sautikit_virtual_number text not null,
  whatsapp_notification_number text,
  alert_email text,
  notify_channels jsonb not null default '{"sms":true,"whatsapp":true,"email":true}'::jsonb,
  billing_enforcement text not null default 'off',
  on_demand_usage_enabled boolean not null default false,
  line_status text not null default 'active',
  minutes_included integer not null default 0,
  seconds_used integer not null default 0,
  suspended_at timestamptz,
  archived_at timestamptz,
  is_active boolean not null default true
);

create table public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete cascade,
  user_id uuid
);

create or replace function public.current_user_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$ select tenant_id from public.tenant_members where user_id = auth.uid() $$;

grant execute on function public.current_user_tenant_ids() to authenticated, service_role;

alter table public.tenants enable row level security;
drop policy if exists tenants_select_member on public.tenants;
create policy tenants_select_member on public.tenants
  for select to authenticated
  using (id in (select public.current_user_tenant_ids()));
grant select on public.tenants to authenticated;
grant all on public.tenants to service_role;

-- Mirrors the wallet protect trigger just enough that tests set enforcement
-- through scalers.wallet_write, and a transition that touches it would fail.
create or replace function public.tenants_protect_wallet_columns()
returns trigger
language plpgsql
as $$
begin
  if new.billing_enforcement is distinct from old.billing_enforcement
     and current_setting('scalers.wallet_write', true) is distinct from '1'
  then
    raise exception 'wallet column is rpc only';
  end if;
  return new;
end;
$$;

drop trigger if exists tenants_protect_wallet_columns on public.tenants;
create trigger tenants_protect_wallet_columns
  before update on public.tenants
  for each row execute function public.tenants_protect_wallet_columns();

create table public.ops_audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor text not null default 'ops',
  action text not null,
  tenant_id uuid,
  amount_kes numeric,
  detail jsonb not null default '{}'::jsonb
);

create table public.billing_rate_card (
  id integer primary key default 1 check (id = 1),
  inbound_kes_per_second numeric not null default 0.10,
  outbound_kes_per_second numeric not null default 0.15,
  whatsapp_kes numeric not null default 2,
  sms_kes numeric not null default 1,
  email_kes numeric not null default 1,
  annual_discount_percent numeric not null default 17,
  updated_at timestamptz not null default now()
);

insert into public.billing_rate_card (id) values (1);

create table public.billing_packages (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  monthly_price_kes numeric not null default 0,
  seats integer not null default 2,
  minutes integer not null default 300,
  sms integer not null default 200,
  email integer not null default 100,
  staff_wa integer not null default 200,
  dids integer not null default 1,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.billing_packages (
  sku, name, monthly_price_kes, seats, minutes, sms, email, staff_wa, dids, sort_order
) values
  ('starter', 'Starter', 5000, 2, 300, 200, 100, 200, 1, 10),
  ('growth', 'Growth', 12000, 5, 800, 500, 250, 500, 1, 20),
  ('scale', 'Scale', 25000, 10, 2000, 1500, 500, 1000, 1, 30);

create table public.tenant_subscriptions (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  package_id uuid not null references public.billing_packages (id),
  period text not null default 'month',
  started_at timestamptz not null default now(),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  status text not null default 'active',
  updated_at timestamptz not null default now(),
  constraint tenant_subscriptions_status_check check (status in ('active', 'cancelled'))
);

create table public.sautikit_did_pool (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  e164 text not null unique,
  sautikit_number_id text,
  status text not null default 'available'
    check (status in ('available', 'assigned', 'reserved', 'disabled')),
  tenant_id uuid unique references public.tenants (id) on delete set null,
  assigned_at timestamptz,
  notes text
);
