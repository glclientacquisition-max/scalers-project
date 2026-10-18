-- Minimal stub of the prod tables these files touch (shape checked read-only on
-- prod/staging, 17 Oct 2026). Throwaway local Postgres only. Never Supabase.
create extension if not exists pgcrypto;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
create schema if not exists storage;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);

create table public.tenants (
  id uuid primary key default gen_random_uuid(), created_at timestamptz default now(),
  business_name text, is_active boolean default true, sautikit_virtual_number text,
  llm_system_prompt text, business_hours text, faqs jsonb,
  wallet_balance_kes numeric default 0, wallet_low_balance_kes numeric,
  billing_enforcement text default 'off', telecom_wallet_balance_kes numeric, ai_wallet_balance_usd numeric,
  beta_notes text, beta_expires_at timestamptz,
  soft_spend_limit_enabled boolean not null default false, soft_spend_limit_kes numeric,
  on_demand_usage_enabled boolean not null default false,
  wallet_low_alert_sent_at timestamptz, wallet_empty_alert_sent_at timestamptz,
  minutes_included integer not null default 0, seconds_used integer not null default 0,
  sms_included_units integer not null default 200, sms_used_units integer not null default 0
);
create table public.ops_audit_log (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  actor text not null default 'ops', action text not null, tenant_id uuid references public.tenants(id) on delete set null,
  amount_kes numeric, detail jsonb not null default '{}'::jsonb);
create table public.calls (id uuid primary key default gen_random_uuid(), created_at timestamptz default now(),
  tenant_id uuid references public.tenants(id) on delete cascade, sautikit_call_sid text unique,
  duration_seconds integer, package_seconds_applied integer default 0);
create table public.transcripts (id uuid primary key default gen_random_uuid(), call_id uuid references public.calls(id) on delete cascade, text_content text);
create table public.call_facts (id uuid primary key default gen_random_uuid(), call_id uuid references public.calls(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade);
create table public.appointments (id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id) on delete cascade,
  call_id uuid references public.calls(id) on delete set null);
create table public.wallet_ledger (id uuid primary key default gen_random_uuid(), created_at timestamptz default now(),
  tenant_id uuid references public.tenants(id) on delete cascade, kind text, amount_kes numeric, reference_type text, reference_id text);
create function public.wallet_ledger_deny_mutation() returns trigger language plpgsql as $$ begin raise exception 'wallet_ledger is append-only'; end; $$;
create trigger wallet_ledger_no_update before update on public.wallet_ledger for each row execute function public.wallet_ledger_deny_mutation();
create trigger wallet_ledger_no_delete before delete on public.wallet_ledger for each row execute function public.wallet_ledger_deny_mutation();
create table public.notify_sends (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  tenant_id uuid references public.tenants(id) on delete cascade, call_id uuid references public.calls(id) on delete set null,
  call_sid text, kind text, channel text, recipient text, audience text, billed_to text, units integer default 1, body text,
  provider_message_id text, idempotency_key text, overage boolean default false, status text default 'sent', error text);
-- Prod today: strict append-only (notify_send_ledger.sql).
create function public.notify_sends_deny_mutation() returns trigger language plpgsql as $$ begin raise exception 'notify_sends is append-only'; end; $$;
create trigger notify_sends_no_update before update on public.notify_sends for each row execute function public.notify_sends_deny_mutation();
create trigger notify_sends_no_delete before delete on public.notify_sends for each row execute function public.notify_sends_deny_mutation();
create table public.tenant_subscriptions (tenant_id uuid primary key references public.tenants(id) on delete cascade,
  package_id uuid, period text default 'month', status text default 'active', started_at timestamptz default now(),
  current_period_start timestamptz, current_period_end timestamptz, updated_at timestamptz default now());
create table public.tenant_minute_grants (id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id) on delete cascade,
  minutes integer, created_at timestamptz default now());
create table public.tenant_members (id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id) on delete cascade, user_id uuid);
create table public.sautikit_did_pool (id uuid primary key default gen_random_uuid(), e164 text unique, status text default 'available',
  tenant_id uuid references public.tenants(id) on delete set null, notes text, assigned_at timestamptz);

-- Ledger helper used by apply_line_rental (simplified: append + move balance).
create function public._wallet_apply_delta(p_tenant_id uuid, p_kind text, p_amount_kes numeric, p_reference_type text,
  p_reference_id text, p_note text, p_metadata jsonb)
returns table (wallet_balance_kes numeric, already_applied boolean) language plpgsql as $$
begin
  insert into public.wallet_ledger (tenant_id, kind, amount_kes, reference_type, reference_id)
  values (p_tenant_id, p_kind, p_amount_kes, p_reference_type, p_reference_id);
  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants t set wallet_balance_kes = coalesce(t.wallet_balance_kes, 0) + p_amount_kes where t.id = p_tenant_id;
  return query select t.wallet_balance_kes, false from public.tenants t where t.id = p_tenant_id;
end; $$;

-- Placeholder; line_rental_grace.sql replaces the body. The trigger itself exists on prod.
create function public.tenants_protect_wallet_columns() returns trigger language plpgsql as $$ begin return new; end; $$;
create trigger tenants_protect_wallet_columns before update on public.tenants
  for each row execute function public.tenants_protect_wallet_columns();
