create extension if not exists pgcrypto;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to authenticated;
create table public.tenants (
  id uuid primary key default gen_random_uuid(), business_name text,
  wallet_balance_kes numeric default 0, wallet_low_balance_kes numeric, billing_enforcement text not null default 'off',
  telecom_wallet_balance_kes numeric, ai_wallet_balance_usd numeric, beta_notes text, beta_expires_at timestamptz,
  soft_spend_limit_enabled boolean not null default false, soft_spend_limit_kes numeric, on_demand_usage_enabled boolean not null default false,
  wallet_low_alert_sent_at timestamptz, wallet_empty_alert_sent_at timestamptz, line_paid_through date, line_grace_days int, line_status text default 'active',
  sms_included_units integer not null default 200, sms_used_units integer not null default 0,
  email_included_units integer not null default 100, email_used_units integer not null default 0, seat_included integer not null default 5);
create table public.tenant_members (id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id), user_id uuid);
create or replace function public.current_user_tenant_ids() returns setof uuid language sql stable security definer set search_path=public as $$ select tenant_id from public.tenant_members where user_id = auth.uid() $$;
grant execute on function public.current_user_tenant_ids() to authenticated, service_role;
alter table public.tenants enable row level security;
create policy tenants_select_member on public.tenants for select to authenticated using (id in (select public.current_user_tenant_ids()));
grant select on public.tenants to authenticated; grant all on public.tenants to service_role;
create table public.ops_audit_log (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  actor text not null default 'ops', action text not null, tenant_id uuid, amount_kes numeric, detail jsonb not null default '{}'::jsonb);
