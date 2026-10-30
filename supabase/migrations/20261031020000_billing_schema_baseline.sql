-- Billing schema baseline, generated from production catalogs on 2026-10-31.
-- Reproduces the live billing tables, constraints, indexes, functions, views, triggers, RLS, policies,
-- grants and billing pg_cron jobs. Every statement is create-if-missing, create-or-replace or
-- drop-then-create, so applying it to a database that already matches production changes nothing.
-- Regenerate: scripts/billing-schema/generate.sql. Drift check: scripts/billing-schema/README.md.

set check_function_bodies = off;

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.billing_audit_log (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  actor text not null,
  action text not null,
  tenant_id uuid,
  detail jsonb default '{}'::jsonb not null
);

create table if not exists public.billing_company (
  id smallint default 1 not null,
  legal_name text not null,
  product text default 'Business Assistant'::text not null,
  phone text,
  email text,
  address text,
  city text,
  kra_pin text,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.billing_features (
  key text not null,
  label text not null
);

create table if not exists public.billing_invoice_counters (
  year integer not null,
  last_number integer not null
);

create table if not exists public.billing_lifecycle_settings (
  id integer default 1 not null,
  voicemail_hold_days integer default 7 not null,
  shadow_invoices boolean default true not null,
  updated_at timestamp with time zone default now() not null,
  price_change_approval_threshold_kes numeric,
  package_editor_enabled boolean default true not null,
  new_signup_trial_enabled boolean default false not null,
  bachs_payments_mode text default 'off'::text not null,
  live_payments_master boolean default false not null,
  billing_notices_send boolean default false not null,
  desk_plan_change_enabled boolean default false not null,
  hold_winback_enabled boolean default true not null,
  reactivation_fee_kes numeric(12,2),
  number_hold_days integer default 14 not null
);

create table if not exists public.billing_live_tenants (
  tenant_id uuid not null,
  enabled boolean default false not null,
  reason text not null,
  set_by text not null,
  set_at timestamp with time zone default now() not null
);

create table if not exists public.billing_notices (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  kind text not null,
  title text not null,
  body text not null,
  channel text,
  recipient text,
  fallback jsonb default '{}'::jsonb not null,
  audience text default 'staff'::text not null,
  billed_to text default 'platform'::text not null,
  delivery_status text default 'pending'::text not null,
  idempotency_key text not null,
  notify_send_id uuid,
  last_error text,
  read_at timestamp with time zone,
  claimed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.billing_owner_action_keys (
  tenant_id uuid not null,
  idempotency_key text not null,
  action text not null,
  result jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.billing_package_version_approvals (
  id uuid default gen_random_uuid() not null,
  package_version_id uuid not null,
  requested_by text not null,
  approver text,
  status text not null,
  reason text not null,
  price_snapshot jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.billing_package_version_features (
  package_version_id uuid not null,
  feature_key text not null,
  enabled boolean default true not null
);

create table if not exists public.billing_package_versions (
  id uuid default gen_random_uuid() not null,
  package_id uuid not null,
  version integer not null,
  status text default 'draft'::text not null,
  monthly_price_kes numeric not null,
  seats integer not null,
  minutes integer not null,
  sms integer not null,
  email integer not null,
  staff_wa integer not null,
  dids integer not null,
  inbound_kes_per_second numeric not null,
  outbound_kes_per_second numeric not null,
  whatsapp_kes numeric not null,
  sms_kes numeric not null,
  email_kes numeric not null,
  annual_discount_percent numeric not null,
  trial_days integer,
  allowances_placeholder boolean default false not null,
  active_from timestamp with time zone default now() not null,
  published_at timestamp with time zone,
  retired_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  extra_seat_monthly_kes numeric default 500,
  copied_from_id uuid,
  promote_fingerprint text,
  notes text,
  price_set_by text,
  message_credits integer,
  sms_credit_burn numeric,
  whatsapp_credit_burn numeric,
  email_credit_burn numeric,
  on_demand_allowed boolean default true not null,
  annual_price_kes numeric not null,
  credit_kes numeric default 1 not null,
  spend_limit_share_percent numeric default 50 not null
);

create table if not exists public.billing_packages (
  id uuid default gen_random_uuid() not null,
  sku text not null,
  name text not null,
  monthly_price_kes numeric default 0 not null,
  seats integer default 2 not null,
  minutes integer default 300 not null,
  sms integer default 200 not null,
  email integer default 100 not null,
  staff_wa integer default 200 not null,
  dids integer default 1 not null,
  sort_order integer default 0 not null,
  is_active boolean default true not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.billing_rate_card (
  id integer default 1 not null,
  inbound_kes_per_second numeric default 0.05 not null,
  outbound_kes_per_second numeric default 0.10 not null,
  whatsapp_kes numeric default 2 not null,
  sms_kes numeric default 1 not null,
  email_kes numeric default 1 not null,
  annual_discount_percent numeric default 17 not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.billing_receipt_counters (
  year integer not null,
  last_number integer not null
);

create table if not exists public.invoice_lines (
  id uuid default gen_random_uuid() not null,
  invoice_id uuid not null,
  tenant_id uuid not null,
  description text not null,
  quantity numeric default 1 not null,
  unit_amount_kes numeric default 0 not null,
  amount_kes numeric default 0 not null,
  sort_order integer default 0 not null,
  kind text
);

create table if not exists public.invoice_pay_tokens (
  id uuid default gen_random_uuid() not null,
  invoice_id uuid not null,
  tenant_id uuid not null,
  token_hash text not null,
  expires_at timestamp with time zone not null,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.invoice_receipts (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  invoice_id uuid not null,
  payment_id uuid not null,
  receipt_number text not null,
  amount_kes numeric not null,
  method text not null,
  provider_ref text,
  paid_at timestamp with time zone not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.invoices (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  invoice_number text,
  status text default 'draft'::text not null,
  currency text default 'KES'::text not null,
  subtotal_kes numeric default 0 not null,
  total_kes numeric default 0 not null,
  amount_paid_kes numeric default 0 not null,
  due_at timestamp with time zone,
  issued_at timestamp with time zone,
  paid_at timestamp with time zone,
  period_start timestamp with time zone,
  period_end timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  billing_source text,
  tax_kes numeric,
  credits_applied_kes numeric,
  issuer_legal_name text,
  issuer_product text,
  issuer_phone text,
  issuer_email text,
  issuer_address text,
  issuer_city text,
  issuer_kra_pin text,
  reminders_paused_at timestamp with time zone
);

create table if not exists public.ops_audit_log (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  actor text default 'ops'::text not null,
  action text not null,
  tenant_id uuid,
  amount_kes numeric,
  detail jsonb default '{}'::jsonb not null
);

create table if not exists public.payment_attempts (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid,
  invoice_id uuid,
  provider text not null,
  checkout_session_id text,
  status text default 'pending'::text not null,
  amount_kes numeric,
  created_at timestamp with time zone default now() not null,
  part_index integer,
  part_count integer,
  currency text default 'KES'::text not null,
  provider_amount numeric,
  provider_currency text,
  fee_amount numeric,
  fee_currency text,
  checkout_url text,
  checkout_expires_at timestamp with time zone,
  client_reference text,
  raw jsonb default '{}'::jsonb not null,
  return_id text,
  return_expires_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null,
  checkout_closed_at timestamp with time zone,
  collected_total_seen_kes numeric,
  collection_ids jsonb default '[]'::jsonb not null
);

create table if not exists public.payment_events (
  id uuid default gen_random_uuid() not null,
  provider text not null,
  event_key text not null,
  payload jsonb default '{}'::jsonb not null,
  attempts integer default 1 not null,
  received_at timestamp with time zone default now() not null,
  needs_retry boolean default false not null
);

create table if not exists public.payments (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid,
  invoice_id uuid,
  provider text not null,
  provider_ref text not null,
  amount_kes numeric not null,
  settled_amount_minor integer,
  settled_currency text,
  fx_rate numeric,
  fee_minor integer,
  match_status text not null,
  payer_msisdn_masked text,
  bill_ref text,
  paid_at timestamp with time zone default now() not null,
  raw jsonb default '{}'::jsonb not null,
  actor text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.sms_counter_reconciliations (
  id bigint generated always as identity not null,
  created_at timestamp with time zone default now() not null,
  tenant_id uuid not null,
  period_start timestamp with time zone,
  counter_before integer not null,
  ledger_sent_units integer not null,
  pending_held_units integer not null,
  counter_after integer not null,
  note text not null
);

create table if not exists public.subscription_events (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  from_status text,
  to_status text not null,
  actor text default 'system'::text not null,
  reason text,
  detail jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.tenant_credits (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  amount_kes numeric not null,
  reason text not null,
  idempotency_key text not null,
  payment_id uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.tenant_minute_grants (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  minutes integer not null,
  period_start timestamp with time zone not null,
  period_end timestamp with time zone,
  note text not null,
  actor text default 'ops'::text not null,
  idempotency_key text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.tenant_subscriptions (
  tenant_id uuid not null,
  package_id uuid not null,
  period text default 'month'::text not null,
  started_at timestamp with time zone default now() not null,
  current_period_start timestamp with time zone default now() not null,
  current_period_end timestamp with time zone,
  status text default 'active'::text not null,
  updated_at timestamp with time zone default now() not null,
  term_start timestamp with time zone default now() not null,
  term_end timestamp with time zone,
  ended_at timestamp with time zone,
  pending_package_id uuid,
  pending_period text,
  pending_change text,
  pending_effective_at timestamp with time zone,
  pending_set_at timestamp with time zone,
  pending_actor text,
  package_version_id uuid,
  billing_status text default 'beta'::text not null,
  trial_ends_at timestamp with time zone,
  past_due_at timestamp with time zone,
  grace_started_at timestamp with time zone,
  billing_suspended_at timestamp with time zone,
  billing_cancelled_at timestamp with time zone,
  billing_archived_at timestamp with time zone,
  billing_status_changed_at timestamp with time zone,
  paid_through date,
  collection_method text,
  voicemail_until timestamp with time zone,
  extra_seats integer default 0 not null,
  spend_limit_held_period timestamp with time zone
);

create table if not exists public.voice_wallet_alert_state (
  threshold_minor bigint not null,
  crossed boolean default false not null,
  crossed_at timestamp with time zone,
  rearmed_at timestamp with time zone,
  last_balance_minor bigint,
  last_source text,
  observed_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.wallet_ledger (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  tenant_id uuid not null,
  kind text not null,
  amount_kes numeric not null,
  balance_after_kes numeric not null,
  currency text default 'KES'::text not null,
  reference_type text,
  reference_id text,
  note text,
  metadata jsonb default '{}'::jsonb not null
);

-- ============================================================
-- Columns (no-op when the table already matches)
-- ============================================================

alter table public.billing_audit_log add column if not exists action text not null;

alter table public.billing_audit_log add column if not exists actor text not null;

alter table public.billing_audit_log add column if not exists created_at timestamp with time zone default now() not null;

alter table public.billing_audit_log add column if not exists detail jsonb default '{}'::jsonb not null;

alter table public.billing_audit_log add column if not exists id uuid default gen_random_uuid() not null;

alter table public.billing_audit_log add column if not exists tenant_id uuid;

alter table public.billing_company add column if not exists address text;

alter table public.billing_company add column if not exists city text;

alter table public.billing_company add column if not exists email text;

alter table public.billing_company add column if not exists id smallint default 1 not null;

alter table public.billing_company add column if not exists kra_pin text;

alter table public.billing_company add column if not exists legal_name text not null;

alter table public.billing_company add column if not exists phone text;

alter table public.billing_company add column if not exists product text default 'Business Assistant'::text not null;

alter table public.billing_company add column if not exists updated_at timestamp with time zone default now() not null;

alter table public.billing_features add column if not exists key text not null;

alter table public.billing_features add column if not exists label text not null;

alter table public.billing_invoice_counters add column if not exists last_number integer not null;

alter table public.billing_invoice_counters add column if not exists year integer not null;

alter table public.billing_lifecycle_settings add column if not exists bachs_payments_mode text default 'off'::text not null;

alter table public.billing_lifecycle_settings add column if not exists billing_notices_send boolean default false not null;

alter table public.billing_lifecycle_settings add column if not exists desk_plan_change_enabled boolean default false not null;

alter table public.billing_lifecycle_settings add column if not exists hold_winback_enabled boolean default true not null;

alter table public.billing_lifecycle_settings add column if not exists id integer default 1 not null;

alter table public.billing_lifecycle_settings add column if not exists live_payments_master boolean default false not null;

alter table public.billing_lifecycle_settings add column if not exists new_signup_trial_enabled boolean default false not null;

alter table public.billing_lifecycle_settings add column if not exists number_hold_days integer default 14 not null;

alter table public.billing_lifecycle_settings add column if not exists package_editor_enabled boolean default true not null;

alter table public.billing_lifecycle_settings add column if not exists price_change_approval_threshold_kes numeric;

alter table public.billing_lifecycle_settings add column if not exists reactivation_fee_kes numeric(12,2);

alter table public.billing_lifecycle_settings add column if not exists shadow_invoices boolean default true not null;

alter table public.billing_lifecycle_settings add column if not exists updated_at timestamp with time zone default now() not null;

alter table public.billing_lifecycle_settings add column if not exists voicemail_hold_days integer default 7 not null;

alter table public.billing_live_tenants add column if not exists enabled boolean default false not null;

alter table public.billing_live_tenants add column if not exists reason text not null;

alter table public.billing_live_tenants add column if not exists set_at timestamp with time zone default now() not null;

alter table public.billing_live_tenants add column if not exists set_by text not null;

alter table public.billing_live_tenants add column if not exists tenant_id uuid not null;

alter table public.billing_notices add column if not exists audience text default 'staff'::text not null;

alter table public.billing_notices add column if not exists billed_to text default 'platform'::text not null;

alter table public.billing_notices add column if not exists body text not null;

alter table public.billing_notices add column if not exists channel text;

alter table public.billing_notices add column if not exists claimed_at timestamp with time zone;

alter table public.billing_notices add column if not exists created_at timestamp with time zone default now() not null;

alter table public.billing_notices add column if not exists delivery_status text default 'pending'::text not null;

alter table public.billing_notices add column if not exists fallback jsonb default '{}'::jsonb not null;

alter table public.billing_notices add column if not exists id uuid default gen_random_uuid() not null;

alter table public.billing_notices add column if not exists idempotency_key text not null;

alter table public.billing_notices add column if not exists kind text not null;

alter table public.billing_notices add column if not exists last_error text;

alter table public.billing_notices add column if not exists notify_send_id uuid;

alter table public.billing_notices add column if not exists read_at timestamp with time zone;

alter table public.billing_notices add column if not exists recipient text;

alter table public.billing_notices add column if not exists tenant_id uuid not null;

alter table public.billing_notices add column if not exists title text not null;

alter table public.billing_owner_action_keys add column if not exists action text not null;

alter table public.billing_owner_action_keys add column if not exists created_at timestamp with time zone default now() not null;

alter table public.billing_owner_action_keys add column if not exists idempotency_key text not null;

alter table public.billing_owner_action_keys add column if not exists result jsonb not null;

alter table public.billing_owner_action_keys add column if not exists tenant_id uuid not null;

alter table public.billing_package_version_approvals add column if not exists approver text;

alter table public.billing_package_version_approvals add column if not exists created_at timestamp with time zone default now() not null;

alter table public.billing_package_version_approvals add column if not exists id uuid default gen_random_uuid() not null;

alter table public.billing_package_version_approvals add column if not exists package_version_id uuid not null;

alter table public.billing_package_version_approvals add column if not exists price_snapshot jsonb not null;

alter table public.billing_package_version_approvals add column if not exists reason text not null;

alter table public.billing_package_version_approvals add column if not exists requested_by text not null;

alter table public.billing_package_version_approvals add column if not exists status text not null;

alter table public.billing_package_version_features add column if not exists enabled boolean default true not null;

alter table public.billing_package_version_features add column if not exists feature_key text not null;

alter table public.billing_package_version_features add column if not exists package_version_id uuid not null;

alter table public.billing_package_versions add column if not exists active_from timestamp with time zone default now() not null;

alter table public.billing_package_versions add column if not exists allowances_placeholder boolean default false not null;

alter table public.billing_package_versions add column if not exists annual_discount_percent numeric not null;

alter table public.billing_package_versions add column if not exists annual_price_kes numeric not null;

alter table public.billing_package_versions add column if not exists copied_from_id uuid;

alter table public.billing_package_versions add column if not exists created_at timestamp with time zone default now() not null;

alter table public.billing_package_versions add column if not exists credit_kes numeric default 1 not null;

alter table public.billing_package_versions add column if not exists dids integer not null;

alter table public.billing_package_versions add column if not exists email integer not null;

alter table public.billing_package_versions add column if not exists email_credit_burn numeric;

alter table public.billing_package_versions add column if not exists email_kes numeric not null;

alter table public.billing_package_versions add column if not exists extra_seat_monthly_kes numeric default 500;

alter table public.billing_package_versions add column if not exists id uuid default gen_random_uuid() not null;

alter table public.billing_package_versions add column if not exists inbound_kes_per_second numeric not null;

alter table public.billing_package_versions add column if not exists message_credits integer;

alter table public.billing_package_versions add column if not exists minutes integer not null;

alter table public.billing_package_versions add column if not exists monthly_price_kes numeric not null;

alter table public.billing_package_versions add column if not exists notes text;

alter table public.billing_package_versions add column if not exists on_demand_allowed boolean default true not null;

alter table public.billing_package_versions add column if not exists outbound_kes_per_second numeric not null;

alter table public.billing_package_versions add column if not exists package_id uuid not null;

alter table public.billing_package_versions add column if not exists price_set_by text;

alter table public.billing_package_versions add column if not exists promote_fingerprint text;

alter table public.billing_package_versions add column if not exists published_at timestamp with time zone;

alter table public.billing_package_versions add column if not exists retired_at timestamp with time zone;

alter table public.billing_package_versions add column if not exists seats integer not null;

alter table public.billing_package_versions add column if not exists sms integer not null;

alter table public.billing_package_versions add column if not exists sms_credit_burn numeric;

alter table public.billing_package_versions add column if not exists sms_kes numeric not null;

alter table public.billing_package_versions add column if not exists spend_limit_share_percent numeric default 50 not null;

alter table public.billing_package_versions add column if not exists staff_wa integer not null;

alter table public.billing_package_versions add column if not exists status text default 'draft'::text not null;

alter table public.billing_package_versions add column if not exists trial_days integer;

alter table public.billing_package_versions add column if not exists version integer not null;

alter table public.billing_package_versions add column if not exists whatsapp_credit_burn numeric;

alter table public.billing_package_versions add column if not exists whatsapp_kes numeric not null;

alter table public.billing_packages add column if not exists dids integer default 1 not null;

alter table public.billing_packages add column if not exists email integer default 100 not null;

alter table public.billing_packages add column if not exists id uuid default gen_random_uuid() not null;

alter table public.billing_packages add column if not exists is_active boolean default true not null;

alter table public.billing_packages add column if not exists minutes integer default 300 not null;

alter table public.billing_packages add column if not exists monthly_price_kes numeric default 0 not null;

alter table public.billing_packages add column if not exists name text not null;

alter table public.billing_packages add column if not exists seats integer default 2 not null;

alter table public.billing_packages add column if not exists sku text not null;

alter table public.billing_packages add column if not exists sms integer default 200 not null;

alter table public.billing_packages add column if not exists sort_order integer default 0 not null;

alter table public.billing_packages add column if not exists staff_wa integer default 200 not null;

alter table public.billing_packages add column if not exists updated_at timestamp with time zone default now() not null;

alter table public.billing_rate_card add column if not exists annual_discount_percent numeric default 17 not null;

alter table public.billing_rate_card add column if not exists email_kes numeric default 1 not null;

alter table public.billing_rate_card add column if not exists id integer default 1 not null;

alter table public.billing_rate_card add column if not exists inbound_kes_per_second numeric default 0.05 not null;

alter table public.billing_rate_card add column if not exists outbound_kes_per_second numeric default 0.10 not null;

alter table public.billing_rate_card add column if not exists sms_kes numeric default 1 not null;

alter table public.billing_rate_card add column if not exists updated_at timestamp with time zone default now() not null;

alter table public.billing_rate_card add column if not exists whatsapp_kes numeric default 2 not null;

alter table public.billing_receipt_counters add column if not exists last_number integer not null;

alter table public.billing_receipt_counters add column if not exists year integer not null;

alter table public.invoice_lines add column if not exists amount_kes numeric default 0 not null;

alter table public.invoice_lines add column if not exists description text not null;

alter table public.invoice_lines add column if not exists id uuid default gen_random_uuid() not null;

alter table public.invoice_lines add column if not exists invoice_id uuid not null;

alter table public.invoice_lines add column if not exists kind text;

alter table public.invoice_lines add column if not exists quantity numeric default 1 not null;

alter table public.invoice_lines add column if not exists sort_order integer default 0 not null;

alter table public.invoice_lines add column if not exists tenant_id uuid not null;

alter table public.invoice_lines add column if not exists unit_amount_kes numeric default 0 not null;

alter table public.invoice_pay_tokens add column if not exists created_at timestamp with time zone default now() not null;

alter table public.invoice_pay_tokens add column if not exists expires_at timestamp with time zone not null;

alter table public.invoice_pay_tokens add column if not exists id uuid default gen_random_uuid() not null;

alter table public.invoice_pay_tokens add column if not exists invoice_id uuid not null;

alter table public.invoice_pay_tokens add column if not exists revoked_at timestamp with time zone;

alter table public.invoice_pay_tokens add column if not exists tenant_id uuid not null;

alter table public.invoice_pay_tokens add column if not exists token_hash text not null;

alter table public.invoice_receipts add column if not exists amount_kes numeric not null;

alter table public.invoice_receipts add column if not exists created_at timestamp with time zone default now() not null;

alter table public.invoice_receipts add column if not exists id uuid default gen_random_uuid() not null;

alter table public.invoice_receipts add column if not exists invoice_id uuid not null;

alter table public.invoice_receipts add column if not exists method text not null;

alter table public.invoice_receipts add column if not exists paid_at timestamp with time zone not null;

alter table public.invoice_receipts add column if not exists payment_id uuid not null;

alter table public.invoice_receipts add column if not exists provider_ref text;

alter table public.invoice_receipts add column if not exists receipt_number text not null;

alter table public.invoice_receipts add column if not exists tenant_id uuid not null;

alter table public.invoices add column if not exists amount_paid_kes numeric default 0 not null;

alter table public.invoices add column if not exists billing_source text;

alter table public.invoices add column if not exists created_at timestamp with time zone default now() not null;

alter table public.invoices add column if not exists credits_applied_kes numeric;

alter table public.invoices add column if not exists currency text default 'KES'::text not null;

alter table public.invoices add column if not exists due_at timestamp with time zone;

alter table public.invoices add column if not exists id uuid default gen_random_uuid() not null;

alter table public.invoices add column if not exists invoice_number text;

alter table public.invoices add column if not exists issued_at timestamp with time zone;

alter table public.invoices add column if not exists issuer_address text;

alter table public.invoices add column if not exists issuer_city text;

alter table public.invoices add column if not exists issuer_email text;

alter table public.invoices add column if not exists issuer_kra_pin text;

alter table public.invoices add column if not exists issuer_legal_name text;

alter table public.invoices add column if not exists issuer_phone text;

alter table public.invoices add column if not exists issuer_product text;

alter table public.invoices add column if not exists paid_at timestamp with time zone;

alter table public.invoices add column if not exists period_end timestamp with time zone;

alter table public.invoices add column if not exists period_start timestamp with time zone;

alter table public.invoices add column if not exists reminders_paused_at timestamp with time zone;

alter table public.invoices add column if not exists status text default 'draft'::text not null;

alter table public.invoices add column if not exists subtotal_kes numeric default 0 not null;

alter table public.invoices add column if not exists tax_kes numeric;

alter table public.invoices add column if not exists tenant_id uuid not null;

alter table public.invoices add column if not exists total_kes numeric default 0 not null;

alter table public.invoices add column if not exists updated_at timestamp with time zone default now() not null;

alter table public.ops_audit_log add column if not exists action text not null;

alter table public.ops_audit_log add column if not exists actor text default 'ops'::text not null;

alter table public.ops_audit_log add column if not exists amount_kes numeric;

alter table public.ops_audit_log add column if not exists created_at timestamp with time zone default now() not null;

alter table public.ops_audit_log add column if not exists detail jsonb default '{}'::jsonb not null;

alter table public.ops_audit_log add column if not exists id uuid default gen_random_uuid() not null;

alter table public.ops_audit_log add column if not exists tenant_id uuid;

alter table public.payment_attempts add column if not exists amount_kes numeric;

alter table public.payment_attempts add column if not exists checkout_closed_at timestamp with time zone;

alter table public.payment_attempts add column if not exists checkout_expires_at timestamp with time zone;

alter table public.payment_attempts add column if not exists checkout_session_id text;

alter table public.payment_attempts add column if not exists checkout_url text;

alter table public.payment_attempts add column if not exists client_reference text;

alter table public.payment_attempts add column if not exists collected_total_seen_kes numeric;

alter table public.payment_attempts add column if not exists collection_ids jsonb default '[]'::jsonb not null;

alter table public.payment_attempts add column if not exists created_at timestamp with time zone default now() not null;

alter table public.payment_attempts add column if not exists currency text default 'KES'::text not null;

alter table public.payment_attempts add column if not exists fee_amount numeric;

alter table public.payment_attempts add column if not exists fee_currency text;

alter table public.payment_attempts add column if not exists id uuid default gen_random_uuid() not null;

alter table public.payment_attempts add column if not exists invoice_id uuid;

alter table public.payment_attempts add column if not exists part_count integer;

alter table public.payment_attempts add column if not exists part_index integer;

alter table public.payment_attempts add column if not exists provider text not null;

alter table public.payment_attempts add column if not exists provider_amount numeric;

alter table public.payment_attempts add column if not exists provider_currency text;

alter table public.payment_attempts add column if not exists raw jsonb default '{}'::jsonb not null;

alter table public.payment_attempts add column if not exists return_expires_at timestamp with time zone;

alter table public.payment_attempts add column if not exists return_id text;

alter table public.payment_attempts add column if not exists status text default 'pending'::text not null;

alter table public.payment_attempts add column if not exists tenant_id uuid;

alter table public.payment_attempts add column if not exists updated_at timestamp with time zone default now() not null;

alter table public.payment_events add column if not exists attempts integer default 1 not null;

alter table public.payment_events add column if not exists event_key text not null;

alter table public.payment_events add column if not exists id uuid default gen_random_uuid() not null;

alter table public.payment_events add column if not exists needs_retry boolean default false not null;

alter table public.payment_events add column if not exists payload jsonb default '{}'::jsonb not null;

alter table public.payment_events add column if not exists provider text not null;

alter table public.payment_events add column if not exists received_at timestamp with time zone default now() not null;

alter table public.payments add column if not exists actor text;

alter table public.payments add column if not exists amount_kes numeric not null;

alter table public.payments add column if not exists bill_ref text;

alter table public.payments add column if not exists created_at timestamp with time zone default now() not null;

alter table public.payments add column if not exists fee_minor integer;

alter table public.payments add column if not exists fx_rate numeric;

alter table public.payments add column if not exists id uuid default gen_random_uuid() not null;

alter table public.payments add column if not exists invoice_id uuid;

alter table public.payments add column if not exists match_status text not null;

alter table public.payments add column if not exists paid_at timestamp with time zone default now() not null;

alter table public.payments add column if not exists payer_msisdn_masked text;

alter table public.payments add column if not exists provider text not null;

alter table public.payments add column if not exists provider_ref text not null;

alter table public.payments add column if not exists raw jsonb default '{}'::jsonb not null;

alter table public.payments add column if not exists settled_amount_minor integer;

alter table public.payments add column if not exists settled_currency text;

alter table public.payments add column if not exists tenant_id uuid;

alter table public.sms_counter_reconciliations add column if not exists counter_after integer not null;

alter table public.sms_counter_reconciliations add column if not exists counter_before integer not null;

alter table public.sms_counter_reconciliations add column if not exists created_at timestamp with time zone default now() not null;

alter table public.sms_counter_reconciliations add column if not exists id bigint generated always as identity not null;

alter table public.sms_counter_reconciliations add column if not exists ledger_sent_units integer not null;

alter table public.sms_counter_reconciliations add column if not exists note text not null;

alter table public.sms_counter_reconciliations add column if not exists pending_held_units integer not null;

alter table public.sms_counter_reconciliations add column if not exists period_start timestamp with time zone;

alter table public.sms_counter_reconciliations add column if not exists tenant_id uuid not null;

alter table public.subscription_events add column if not exists actor text default 'system'::text not null;

alter table public.subscription_events add column if not exists created_at timestamp with time zone default now() not null;

alter table public.subscription_events add column if not exists detail jsonb default '{}'::jsonb not null;

alter table public.subscription_events add column if not exists from_status text;

alter table public.subscription_events add column if not exists id uuid default gen_random_uuid() not null;

alter table public.subscription_events add column if not exists reason text;

alter table public.subscription_events add column if not exists tenant_id uuid not null;

alter table public.subscription_events add column if not exists to_status text not null;

alter table public.tenant_credits add column if not exists amount_kes numeric not null;

alter table public.tenant_credits add column if not exists created_at timestamp with time zone default now() not null;

alter table public.tenant_credits add column if not exists id uuid default gen_random_uuid() not null;

alter table public.tenant_credits add column if not exists idempotency_key text not null;

alter table public.tenant_credits add column if not exists payment_id uuid;

alter table public.tenant_credits add column if not exists reason text not null;

alter table public.tenant_credits add column if not exists tenant_id uuid not null;

alter table public.tenant_minute_grants add column if not exists actor text default 'ops'::text not null;

alter table public.tenant_minute_grants add column if not exists created_at timestamp with time zone default now() not null;

alter table public.tenant_minute_grants add column if not exists id uuid default gen_random_uuid() not null;

alter table public.tenant_minute_grants add column if not exists idempotency_key text;

alter table public.tenant_minute_grants add column if not exists minutes integer not null;

alter table public.tenant_minute_grants add column if not exists note text not null;

alter table public.tenant_minute_grants add column if not exists period_end timestamp with time zone;

alter table public.tenant_minute_grants add column if not exists period_start timestamp with time zone not null;

alter table public.tenant_minute_grants add column if not exists tenant_id uuid not null;

alter table public.tenant_subscriptions add column if not exists billing_archived_at timestamp with time zone;

alter table public.tenant_subscriptions add column if not exists billing_cancelled_at timestamp with time zone;

alter table public.tenant_subscriptions add column if not exists billing_status text default 'beta'::text not null;

alter table public.tenant_subscriptions add column if not exists billing_status_changed_at timestamp with time zone;

alter table public.tenant_subscriptions add column if not exists billing_suspended_at timestamp with time zone;

alter table public.tenant_subscriptions add column if not exists collection_method text;

alter table public.tenant_subscriptions add column if not exists current_period_end timestamp with time zone;

alter table public.tenant_subscriptions add column if not exists current_period_start timestamp with time zone default now() not null;

alter table public.tenant_subscriptions add column if not exists ended_at timestamp with time zone;

alter table public.tenant_subscriptions add column if not exists extra_seats integer default 0 not null;

alter table public.tenant_subscriptions add column if not exists grace_started_at timestamp with time zone;

alter table public.tenant_subscriptions add column if not exists package_id uuid not null;

alter table public.tenant_subscriptions add column if not exists package_version_id uuid;

alter table public.tenant_subscriptions add column if not exists paid_through date;

alter table public.tenant_subscriptions add column if not exists past_due_at timestamp with time zone;

alter table public.tenant_subscriptions add column if not exists pending_actor text;

alter table public.tenant_subscriptions add column if not exists pending_change text;

alter table public.tenant_subscriptions add column if not exists pending_effective_at timestamp with time zone;

alter table public.tenant_subscriptions add column if not exists pending_package_id uuid;

alter table public.tenant_subscriptions add column if not exists pending_period text;

alter table public.tenant_subscriptions add column if not exists pending_set_at timestamp with time zone;

alter table public.tenant_subscriptions add column if not exists period text default 'month'::text not null;

alter table public.tenant_subscriptions add column if not exists spend_limit_held_period timestamp with time zone;

alter table public.tenant_subscriptions add column if not exists started_at timestamp with time zone default now() not null;

alter table public.tenant_subscriptions add column if not exists status text default 'active'::text not null;

alter table public.tenant_subscriptions add column if not exists tenant_id uuid not null;

alter table public.tenant_subscriptions add column if not exists term_end timestamp with time zone;

alter table public.tenant_subscriptions add column if not exists term_start timestamp with time zone default now() not null;

alter table public.tenant_subscriptions add column if not exists trial_ends_at timestamp with time zone;

alter table public.tenant_subscriptions add column if not exists updated_at timestamp with time zone default now() not null;

alter table public.tenant_subscriptions add column if not exists voicemail_until timestamp with time zone;

alter table public.voice_wallet_alert_state add column if not exists crossed boolean default false not null;

alter table public.voice_wallet_alert_state add column if not exists crossed_at timestamp with time zone;

alter table public.voice_wallet_alert_state add column if not exists last_balance_minor bigint;

alter table public.voice_wallet_alert_state add column if not exists last_source text;

alter table public.voice_wallet_alert_state add column if not exists observed_at timestamp with time zone;

alter table public.voice_wallet_alert_state add column if not exists rearmed_at timestamp with time zone;

alter table public.voice_wallet_alert_state add column if not exists threshold_minor bigint not null;

alter table public.voice_wallet_alert_state add column if not exists updated_at timestamp with time zone default now() not null;

alter table public.wallet_ledger add column if not exists amount_kes numeric not null;

alter table public.wallet_ledger add column if not exists balance_after_kes numeric not null;

alter table public.wallet_ledger add column if not exists created_at timestamp with time zone default now() not null;

alter table public.wallet_ledger add column if not exists currency text default 'KES'::text not null;

alter table public.wallet_ledger add column if not exists id uuid default gen_random_uuid() not null;

alter table public.wallet_ledger add column if not exists kind text not null;

alter table public.wallet_ledger add column if not exists metadata jsonb default '{}'::jsonb not null;

alter table public.wallet_ledger add column if not exists note text;

alter table public.wallet_ledger add column if not exists reference_id text;

alter table public.wallet_ledger add column if not exists reference_type text;

alter table public.wallet_ledger add column if not exists tenant_id uuid not null;

-- ============================================================
-- Primary keys, unique and exclusion constraints
-- ============================================================

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_audit_log_pkey' and conrelid = 'public.billing_audit_log'::regclass) then
    alter table public.billing_audit_log add constraint billing_audit_log_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_company_pkey' and conrelid = 'public.billing_company'::regclass) then
    alter table public.billing_company add constraint billing_company_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_features_pkey' and conrelid = 'public.billing_features'::regclass) then
    alter table public.billing_features add constraint billing_features_pkey PRIMARY KEY (key);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_invoice_counters_pkey' and conrelid = 'public.billing_invoice_counters'::regclass) then
    alter table public.billing_invoice_counters add constraint billing_invoice_counters_pkey PRIMARY KEY (year);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_lifecycle_settings_pkey' and conrelid = 'public.billing_lifecycle_settings'::regclass) then
    alter table public.billing_lifecycle_settings add constraint billing_lifecycle_settings_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_live_tenants_pkey' and conrelid = 'public.billing_live_tenants'::regclass) then
    alter table public.billing_live_tenants add constraint billing_live_tenants_pkey PRIMARY KEY (tenant_id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_notices_pkey' and conrelid = 'public.billing_notices'::regclass) then
    alter table public.billing_notices add constraint billing_notices_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_notices_tenant_id_idempotency_key_key' and conrelid = 'public.billing_notices'::regclass) then
    alter table public.billing_notices add constraint billing_notices_tenant_id_idempotency_key_key UNIQUE (tenant_id, idempotency_key);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_owner_action_keys_pkey' and conrelid = 'public.billing_owner_action_keys'::regclass) then
    alter table public.billing_owner_action_keys add constraint billing_owner_action_keys_pkey PRIMARY KEY (tenant_id, idempotency_key);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_version_approvals_pkey' and conrelid = 'public.billing_package_version_approvals'::regclass) then
    alter table public.billing_package_version_approvals add constraint billing_package_version_approvals_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_version_features_pkey' and conrelid = 'public.billing_package_version_features'::regclass) then
    alter table public.billing_package_version_features add constraint billing_package_version_features_pkey PRIMARY KEY (package_version_id, feature_key);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_package_id_version_key' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_package_id_version_key UNIQUE (package_id, version);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_pkey' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_packages_pkey' and conrelid = 'public.billing_packages'::regclass) then
    alter table public.billing_packages add constraint billing_packages_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_packages_sku_key' and conrelid = 'public.billing_packages'::regclass) then
    alter table public.billing_packages add constraint billing_packages_sku_key UNIQUE (sku);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_rate_card_pkey' and conrelid = 'public.billing_rate_card'::regclass) then
    alter table public.billing_rate_card add constraint billing_rate_card_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_receipt_counters_pkey' and conrelid = 'public.billing_receipt_counters'::regclass) then
    alter table public.billing_receipt_counters add constraint billing_receipt_counters_pkey PRIMARY KEY (year);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_lines_pkey' and conrelid = 'public.invoice_lines'::regclass) then
    alter table public.invoice_lines add constraint invoice_lines_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_pay_tokens_pkey' and conrelid = 'public.invoice_pay_tokens'::regclass) then
    alter table public.invoice_pay_tokens add constraint invoice_pay_tokens_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_receipts_payment_id_key' and conrelid = 'public.invoice_receipts'::regclass) then
    alter table public.invoice_receipts add constraint invoice_receipts_payment_id_key UNIQUE (payment_id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_receipts_pkey' and conrelid = 'public.invoice_receipts'::regclass) then
    alter table public.invoice_receipts add constraint invoice_receipts_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_receipts_receipt_number_key' and conrelid = 'public.invoice_receipts'::regclass) then
    alter table public.invoice_receipts add constraint invoice_receipts_receipt_number_key UNIQUE (receipt_number);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_invoice_number_key' and conrelid = 'public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_invoice_number_key UNIQUE (invoice_number);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_pkey' and conrelid = 'public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'ops_audit_log_pkey' and conrelid = 'public.ops_audit_log'::regclass) then
    alter table public.ops_audit_log add constraint ops_audit_log_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'payment_attempts_pkey' and conrelid = 'public.payment_attempts'::regclass) then
    alter table public.payment_attempts add constraint payment_attempts_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'payment_events_pkey' and conrelid = 'public.payment_events'::regclass) then
    alter table public.payment_events add constraint payment_events_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'payment_events_provider_event_key_key' and conrelid = 'public.payment_events'::regclass) then
    alter table public.payment_events add constraint payment_events_provider_event_key_key UNIQUE (provider, event_key);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_pkey' and conrelid = 'public.payments'::regclass) then
    alter table public.payments add constraint payments_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_provider_provider_ref_key' and conrelid = 'public.payments'::regclass) then
    alter table public.payments add constraint payments_provider_provider_ref_key UNIQUE (provider, provider_ref);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'sms_counter_reconciliations_pkey' and conrelid = 'public.sms_counter_reconciliations'::regclass) then
    alter table public.sms_counter_reconciliations add constraint sms_counter_reconciliations_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_events_pkey' and conrelid = 'public.subscription_events'::regclass) then
    alter table public.subscription_events add constraint subscription_events_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_credits_idempotency_key_key' and conrelid = 'public.tenant_credits'::regclass) then
    alter table public.tenant_credits add constraint tenant_credits_idempotency_key_key UNIQUE (idempotency_key);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_credits_pkey' and conrelid = 'public.tenant_credits'::regclass) then
    alter table public.tenant_credits add constraint tenant_credits_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_minute_grants_pkey' and conrelid = 'public.tenant_minute_grants'::regclass) then
    alter table public.tenant_minute_grants add constraint tenant_minute_grants_pkey PRIMARY KEY (id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_minute_grants_tenant_key_uniq' and conrelid = 'public.tenant_minute_grants'::regclass) then
    alter table public.tenant_minute_grants add constraint tenant_minute_grants_tenant_key_uniq UNIQUE (tenant_id, idempotency_key);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_subscriptions_pkey' and conrelid = 'public.tenant_subscriptions'::regclass) then
    alter table public.tenant_subscriptions add constraint tenant_subscriptions_pkey PRIMARY KEY (tenant_id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'voice_wallet_alert_state_pkey' and conrelid = 'public.voice_wallet_alert_state'::regclass) then
    alter table public.voice_wallet_alert_state add constraint voice_wallet_alert_state_pkey PRIMARY KEY (threshold_minor);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'wallet_ledger_pkey' and conrelid = 'public.wallet_ledger'::regclass) then
    alter table public.wallet_ledger add constraint wallet_ledger_pkey PRIMARY KEY (id);
  end if;
end $m$;

-- ============================================================
-- Foreign keys
-- ============================================================

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_live_tenants_tenant_id_fkey' and conrelid = 'public.billing_live_tenants'::regclass) then
    alter table public.billing_live_tenants add constraint billing_live_tenants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_notices_tenant_id_fkey' and conrelid = 'public.billing_notices'::regclass) then
    alter table public.billing_notices add constraint billing_notices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_owner_action_keys_tenant_id_fkey' and conrelid = 'public.billing_owner_action_keys'::regclass) then
    alter table public.billing_owner_action_keys add constraint billing_owner_action_keys_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_version_approvals_package_version_id_fkey' and conrelid = 'public.billing_package_version_approvals'::regclass) then
    alter table public.billing_package_version_approvals add constraint billing_package_version_approvals_package_version_id_fkey FOREIGN KEY (package_version_id) REFERENCES billing_package_versions(id) ON DELETE CASCADE;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_version_features_feature_key_fkey' and conrelid = 'public.billing_package_version_features'::regclass) then
    alter table public.billing_package_version_features add constraint billing_package_version_features_feature_key_fkey FOREIGN KEY (feature_key) REFERENCES billing_features(key);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_version_features_package_version_id_fkey' and conrelid = 'public.billing_package_version_features'::regclass) then
    alter table public.billing_package_version_features add constraint billing_package_version_features_package_version_id_fkey FOREIGN KEY (package_version_id) REFERENCES billing_package_versions(id) ON DELETE CASCADE;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_copied_from_fk' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_copied_from_fk FOREIGN KEY (copied_from_id) REFERENCES billing_package_versions(id) ON DELETE SET NULL;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_package_id_fkey' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_package_id_fkey FOREIGN KEY (package_id) REFERENCES billing_packages(id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_lines_invoice_id_fkey' and conrelid = 'public.invoice_lines'::regclass) then
    alter table public.invoice_lines add constraint invoice_lines_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_lines_tenant_id_fkey' and conrelid = 'public.invoice_lines'::regclass) then
    alter table public.invoice_lines add constraint invoice_lines_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_pay_tokens_invoice_id_fkey' and conrelid = 'public.invoice_pay_tokens'::regclass) then
    alter table public.invoice_pay_tokens add constraint invoice_pay_tokens_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_pay_tokens_tenant_id_fkey' and conrelid = 'public.invoice_pay_tokens'::regclass) then
    alter table public.invoice_pay_tokens add constraint invoice_pay_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_receipts_invoice_id_fkey' and conrelid = 'public.invoice_receipts'::regclass) then
    alter table public.invoice_receipts add constraint invoice_receipts_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_receipts_payment_id_fkey' and conrelid = 'public.invoice_receipts'::regclass) then
    alter table public.invoice_receipts add constraint invoice_receipts_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_receipts_tenant_id_fkey' and conrelid = 'public.invoice_receipts'::regclass) then
    alter table public.invoice_receipts add constraint invoice_receipts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_tenant_id_fkey' and conrelid = 'public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'ops_audit_log_tenant_id_fkey' and conrelid = 'public.ops_audit_log'::regclass) then
    alter table public.ops_audit_log add constraint ops_audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'payment_attempts_invoice_id_fkey' and conrelid = 'public.payment_attempts'::regclass) then
    alter table public.payment_attempts add constraint payment_attempts_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'payment_attempts_tenant_id_fkey' and conrelid = 'public.payment_attempts'::regclass) then
    alter table public.payment_attempts add constraint payment_attempts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_invoice_id_fkey' and conrelid = 'public.payments'::regclass) then
    alter table public.payments add constraint payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_tenant_id_fkey' and conrelid = 'public.payments'::regclass) then
    alter table public.payments add constraint payments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'sms_counter_reconciliations_tenant_id_fkey' and conrelid = 'public.sms_counter_reconciliations'::regclass) then
    alter table public.sms_counter_reconciliations add constraint sms_counter_reconciliations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_events_tenant_id_fkey' and conrelid = 'public.subscription_events'::regclass) then
    alter table public.subscription_events add constraint subscription_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_credits_payment_id_fkey' and conrelid = 'public.tenant_credits'::regclass) then
    alter table public.tenant_credits add constraint tenant_credits_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_credits_tenant_id_fkey' and conrelid = 'public.tenant_credits'::regclass) then
    alter table public.tenant_credits add constraint tenant_credits_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_minute_grants_tenant_id_fkey' and conrelid = 'public.tenant_minute_grants'::regclass) then
    alter table public.tenant_minute_grants add constraint tenant_minute_grants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_subscriptions_package_id_fkey' and conrelid = 'public.tenant_subscriptions'::regclass) then
    alter table public.tenant_subscriptions add constraint tenant_subscriptions_package_id_fkey FOREIGN KEY (package_id) REFERENCES billing_packages(id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_subscriptions_package_version_id_fkey' and conrelid = 'public.tenant_subscriptions'::regclass) then
    alter table public.tenant_subscriptions add constraint tenant_subscriptions_package_version_id_fkey FOREIGN KEY (package_version_id) REFERENCES billing_package_versions(id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_subscriptions_pending_package_id_fkey' and conrelid = 'public.tenant_subscriptions'::regclass) then
    alter table public.tenant_subscriptions add constraint tenant_subscriptions_pending_package_id_fkey FOREIGN KEY (pending_package_id) REFERENCES billing_packages(id);
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_subscriptions_tenant_id_fkey' and conrelid = 'public.tenant_subscriptions'::regclass) then
    alter table public.tenant_subscriptions add constraint tenant_subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'wallet_ledger_tenant_id_fkey' and conrelid = 'public.wallet_ledger'::regclass) then
    alter table public.wallet_ledger add constraint wallet_ledger_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
  end if;
end $m$;

-- ============================================================
-- Indexes
-- ============================================================

create index if not exists billing_audit_log_tenant_idx ON public.billing_audit_log USING btree (tenant_id, created_at);

create index if not exists billing_notices_pending_idx ON public.billing_notices USING btree (created_at) WHERE (delivery_status = 'pending'::text);

create index if not exists billing_notices_sending_idx ON public.billing_notices USING btree (claimed_at) WHERE (delivery_status = 'sending'::text);

create index if not exists billing_notices_tenant_idx ON public.billing_notices USING btree (tenant_id, created_at);

create index if not exists billing_package_version_approvals_version_idx ON public.billing_package_version_approvals USING btree (package_version_id, created_at);

create UNIQUE index if not exists billing_package_versions_fingerprint_idx ON public.billing_package_versions USING btree (package_id, promote_fingerprint) WHERE (promote_fingerprint IS NOT NULL);

create index if not exists invoice_lines_invoice_idx ON public.invoice_lines USING btree (invoice_id);

create index if not exists invoice_lines_tenant_idx ON public.invoice_lines USING btree (tenant_id);

create UNIQUE index if not exists invoice_pay_tokens_hash_uidx ON public.invoice_pay_tokens USING btree (token_hash);

create UNIQUE index if not exists invoice_pay_tokens_one_active ON public.invoice_pay_tokens USING btree (invoice_id) WHERE (revoked_at IS NULL);

create index if not exists invoice_receipts_invoice_idx ON public.invoice_receipts USING btree (invoice_id);

create index if not exists invoice_receipts_tenant_idx ON public.invoice_receipts USING btree (tenant_id, created_at);

create UNIQUE index if not exists invoices_one_next_draft ON public.invoices USING btree (tenant_id) WHERE ((billing_source = 'next'::text) AND (status = 'draft'::text));

create index if not exists invoices_tenant_idx ON public.invoices USING btree (tenant_id, created_at);

create index if not exists ops_audit_log_created_idx ON public.ops_audit_log USING btree (created_at DESC);

create index if not exists ops_audit_log_tenant_idx ON public.ops_audit_log USING btree (tenant_id, created_at DESC);

create UNIQUE index if not exists payment_attempts_checkout_uidx ON public.payment_attempts USING btree (checkout_session_id) WHERE (checkout_session_id IS NOT NULL);

create index if not exists payment_attempts_invoice_idx ON public.payment_attempts USING btree (invoice_id, created_at);

create UNIQUE index if not exists payment_attempts_one_pending_part ON public.payment_attempts USING btree (invoice_id, part_index) WHERE (status = ANY (ARRAY['pending'::text, 'pending_unattached'::text]));

create index if not exists payment_attempts_pending_idx ON public.payment_attempts USING btree (created_at) WHERE (status = 'pending'::text);

create UNIQUE index if not exists payment_attempts_return_uidx ON public.payment_attempts USING btree (return_id) WHERE (return_id IS NOT NULL);

create index if not exists payment_events_needs_retry_idx ON public.payment_events USING btree (provider, received_at) WHERE needs_retry;

create index if not exists payments_invoice_idx ON public.payments USING btree (invoice_id);

create index if not exists payments_tenant_idx ON public.payments USING btree (tenant_id, created_at);

create index if not exists subscription_events_tenant_idx ON public.subscription_events USING btree (tenant_id, created_at);

create index if not exists tenant_credits_tenant_idx ON public.tenant_credits USING btree (tenant_id);

create index if not exists tenant_minute_grants_tenant_period_idx ON public.tenant_minute_grants USING btree (tenant_id, period_start);

create UNIQUE index if not exists wallet_ledger_idempotency_idx ON public.wallet_ledger USING btree (tenant_id, kind, reference_id) WHERE (reference_id IS NOT NULL);

create index if not exists wallet_ledger_tenant_created_idx ON public.wallet_ledger USING btree (tenant_id, created_at DESC);

-- ============================================================
-- Functions
-- ============================================================

CREATE OR REPLACE FUNCTION public._apply_package_version_move(p_version billing_package_versions, p_tenant uuid, p_actor text, p_reason text, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sub public.tenant_subscriptions%rowtype;
  v_from_sku text;
  v_from_version integer;
  v_to_sku text;
  v_status_before text;
  v_status_after text;
  v_enf_before text;
  v_enf_after text;
  v_minutes_before integer;
  v_minutes_after integer;
begin
  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'business not found';
  end if;
  v_sub := null;
  select * into v_sub from public.tenant_subscriptions where tenant_id = p_tenant for update;
  select sku into v_to_sku from public.billing_packages where id = p_version.package_id;
  select minutes_included, billing_enforcement
    into v_minutes_before, v_enf_before
  from public.tenants where id = p_tenant;
  if v_sub.tenant_id is not null then
    v_status_before := v_sub.billing_status;
    select p.sku, v.version into v_from_sku, v_from_version
    from public.billing_packages p
    join public.billing_package_versions v on v.id = v_sub.package_version_id
    where p.id = v_sub.package_id;
  end if;

  perform set_config('scalers.billing_admin_move', '1', true);
  perform set_config('scalers.billing_version_move', '1', true);
  perform set_config('scalers.wallet_write', '1', true);
  if v_sub.tenant_id is null then
    insert into public.tenant_subscriptions (
      tenant_id, package_id, package_version_id, status, billing_status
    ) values (
      p_tenant, p_version.package_id, p_version.id, 'active', 'beta'
    );
    v_status_before := null;
  else
    update public.tenant_subscriptions
    set
      package_id = p_version.package_id,
      package_version_id = p_version.id,
      updated_at = now()
    where tenant_id = p_tenant;
  end if;
  update public.tenants
  set minutes_included = p_version.minutes
  where id = p_tenant;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tenants' and column_name = 'seat_included'
  ) then
    execute 'update public.tenants set seat_included = $1 where id = $2'
      using p_version.seats, p_tenant;
  end if;

  select billing_status into v_status_after
  from public.tenant_subscriptions where tenant_id = p_tenant;
  select minutes_included, billing_enforcement
    into v_minutes_after, v_enf_after
  from public.tenants where id = p_tenant;
  if v_sub.tenant_id is not null and (
       v_status_after is distinct from v_status_before
       or v_enf_after is distinct from v_enf_before
     )
  then
    raise exception 'a version move must not change billing status or enforcement';
  end if;
  if v_enf_after is distinct from v_enf_before then
    raise exception 'a version move must not change billing status or enforcement';
  end if;

  perform public._billing_audit(
    btrim(p_actor),
    'move_package_version',
    p_tenant,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'source', p_source,
      'confirm', p_source = 'admin',
      'from_version_id', v_sub.package_version_id,
      'from_version', v_from_version,
      'from_sku', v_from_sku,
      'to_version_id', p_version.id,
      'to_version', p_version.version,
      'to_sku', v_to_sku,
      'billing_status_before', v_status_before,
      'billing_status_after', v_status_after,
      'billing_enforcement_before', v_enf_before,
      'billing_enforcement_after', v_enf_after,
      'minutes_before', v_minutes_before,
      'minutes_after', v_minutes_after,
      'moved_at', now()
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public._billing_audit(p_actor text, p_action text, p_tenant_id uuid, p_detail jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.billing_audit_log (actor, action, tenant_id, detail)
  values (coalesce(nullif(btrim(p_actor), ''), 'system'), p_action, p_tenant_id, coalesce(p_detail, '{}'::jsonb));
  insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
  values (coalesce(nullif(btrim(p_actor), ''), 'system'), p_action, p_tenant_id, null, coalesce(p_detail, '{}'::jsonb));
end;
$function$
;

CREATE OR REPLACE FUNCTION public._billing_mark_spend_blocked(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_start timestamptz;
  v_changed boolean := false;
begin
  select current_period_start into v_start
  from public.tenant_subscriptions where tenant_id = p_tenant_id;
  update public.tenant_subscriptions
  set spend_limit_held_period = v_start
  where tenant_id = p_tenant_id
    and spend_limit_held_period is distinct from v_start;
  if found then
    v_changed := true;
  end if;
  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants
  set spend_limit_blocked = true
  where id = p_tenant_id and spend_limit_blocked is distinct from true;
  if found then
    v_changed := true;
  end if;
  if v_changed then
    perform public._billing_audit(
      'system',
      'spend_limit_held',
      p_tenant_id,
      jsonb_build_object('period_start', v_start, 'spent_kes', public.billing_period_on_demand_kes(p_tenant_id))
    );
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._billing_package_snapshot(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select public._billing_package_snapshot_of(
              s.package_id, s.period, s.current_period_start, s.current_period_end, s.status)
     from public.tenant_subscriptions s where s.tenant_id = p_tenant_id),
    public._billing_package_snapshot_of(null, null, null, null, 'none'));
$function$
;

CREATE OR REPLACE FUNCTION public._billing_package_snapshot_of(p_package_id uuid, p_period text, p_start timestamp with time zone, p_end timestamp with time zone, p_status text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'package_sku', case when p_status = 'active' then p.sku end,
    'package_name', case when p_status = 'active' then p.name end,
    'period', case when p_status = 'active' then p_period end,
    'period_start', p_start,
    'period_end', p_end,
    'status', case when p_status = 'active' then 'active' else 'none' end)
  from (select 1) one
  left join public.billing_packages p on p.id = p_package_id;
$function$
;

CREATE OR REPLACE FUNCTION public._owner_billing_finish(p_tenant_id uuid, p_actor uuid, p_key text, p_action text, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb := p_result || jsonb_build_object('replayed', false);
begin
  perform public._billing_audit(
    coalesce(p_actor::text, 'owner'),
    p_action,
    p_tenant_id,
    v_result
  );
  insert into public.billing_owner_action_keys (tenant_id, idempotency_key, action, result)
  values (p_tenant_id, p_key, p_action, v_result);
  return v_result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._owner_billing_gate(p_tenant_id uuid, p_actor uuid, p_idempotency_key text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_row public.billing_owner_action_keys%rowtype;
  v_role text;
begin
  if p_tenant_id is null then
    return jsonb_build_object('stop', true, 'result', jsonb_build_object(
      'ok', false, 'code', 'not_found', 'replayed', false,
      'message', 'Business not found.'
    ));
  end if;
  if v_key is null then
    return jsonb_build_object('stop', true, 'result', jsonb_build_object(
      'ok', false, 'code', 'idempotency_key_required', 'replayed', false,
      'message', 'Send an idempotency key with this change.'
    ));
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    return jsonb_build_object('stop', true, 'result', jsonb_build_object(
      'ok', false, 'code', 'not_found', 'replayed', false,
      'message', 'Business not found.'
    ));
  end if;

  select m.role into v_role
  from public.tenant_members m
  where m.tenant_id = p_tenant_id and m.user_id = p_actor;
  if v_role is null or v_role not in ('owner', 'admin') then
    perform public._billing_audit(
      coalesce(p_actor::text, 'owner'),
      p_action,
      p_tenant_id,
      jsonb_build_object('ok', false, 'code', 'forbidden', 'replayed', false,
        'message', 'Only an owner or an admin can change the plan.')
    );
    return jsonb_build_object('stop', true, 'result', jsonb_build_object(
      'ok', false, 'code', 'forbidden', 'replayed', false,
      'message', 'Only an owner or an admin can change the plan.'
    ));
  end if;

  select * into v_row
  from public.billing_owner_action_keys
  where tenant_id = p_tenant_id and idempotency_key = v_key;
  if found then
    if v_row.action is distinct from p_action then
      perform public._billing_audit(
        coalesce(p_actor::text, 'owner'),
        p_action,
        p_tenant_id,
        jsonb_build_object('ok', false, 'code', 'idempotency_conflict', 'replayed', false,
          'message', 'This idempotency key was already used for a different change.')
      );
      return jsonb_build_object('stop', true, 'result', jsonb_build_object(
        'ok', false, 'code', 'idempotency_conflict', 'replayed', false,
        'message', 'This idempotency key was already used for a different change.'
      ));
    end if;
    return jsonb_build_object(
      'stop', true,
      'result', v_row.result || jsonb_build_object('replayed', true)
    );
  end if;

  return jsonb_build_object('stop', false, 'key', v_key);
end;
$function$
;

CREATE OR REPLACE FUNCTION public._owner_next_invoice_line(p_tenant_id uuid, p_description text, p_amount numeric, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_sum numeric;
begin
  select id into v_id
  from public.invoices
  where tenant_id = p_tenant_id and billing_source = 'next' and status = 'draft'
  for update;
  if v_id is null then
    insert into public.invoices (
      tenant_id, status, currency, subtotal_kes, total_kes,
      period_start, period_end, billing_source
    ) values (
      p_tenant_id, 'draft', 'KES', 0, 0, p_start, p_end, 'next'
    ) returning id into v_id;
  end if;
  insert into public.invoice_lines (
    invoice_id, tenant_id, description, quantity, unit_amount_kes, amount_kes, sort_order
  ) values (
    v_id, p_tenant_id, p_description, 1, p_amount, p_amount,
    (select coalesce(max(sort_order), 0) + 1 from public.invoice_lines where invoice_id = v_id)
  );
  select coalesce(sum(amount_kes), 0) into v_sum from public.invoice_lines where invoice_id = v_id;
  update public.invoices
  set subtotal_kes = v_sum,
      total_kes = v_sum,
      updated_at = now()
  where id = v_id;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._owner_open_proration_invoice(p_tenant_id uuid, p_credit numeric, p_charge numeric, p_credit_desc text, p_charge_desc text, p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_net numeric := greatest(coalesce(p_charge, 0) - coalesce(p_credit, 0), 0);
  v_inv public.invoices%rowtype;
begin
  if coalesce(p_credit, 0) = 0 and coalesce(p_charge, 0) = 0 then
    return null;
  end if;
  insert into public.invoices (
    tenant_id, status, currency, subtotal_kes, total_kes,
    period_start, period_end, billing_source
  ) values (
    p_tenant_id, 'draft', 'KES', v_net, v_net,
    p_start, p_end, 'proration'
  ) returning id into v_id;

  if coalesce(p_credit, 0) > 0 then
    insert into public.invoice_lines (
      invoice_id, tenant_id, description, quantity, unit_amount_kes, amount_kes, sort_order
    ) values (
      v_id, p_tenant_id, p_credit_desc, 1, -p_credit, -p_credit, 1
    );
  end if;
  if coalesce(p_charge, 0) > 0 then
    insert into public.invoice_lines (
      invoice_id, tenant_id, description, quantity, unit_amount_kes, amount_kes, sort_order
    ) values (
      v_id, p_tenant_id, p_charge_desc, 1, p_charge, p_charge, 2
    );
  end if;

  v_inv := public.finalize_invoice(v_id);
  return v_inv.id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._package_annual_discount(p_monthly numeric, p_annual numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
begin
  if p_monthly is null or p_monthly < 0 or p_annual is null or p_annual < 0 then
    raise exception 'package numbers must be zero or more';
  end if;
  if p_monthly = 0 then
    if p_annual <> 0 then
      raise exception 'annual price is above twelve months';
    end if;
    return 0;
  end if;
  if p_annual > p_monthly * 12 then
    raise exception 'annual price is above twelve months';
  end if;
  return round((1 - (p_annual / (p_monthly * 12))) * 100, 2);
end;
$function$
;

CREATE OR REPLACE FUNCTION public._package_editor_actor(p_actor text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  if nullif(btrim(coalesce(p_actor, '')), '') is null or length(btrim(p_actor)) > 80 then
    raise exception 'say who is making this change';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null or length(btrim(p_reason)) > 500 then
    raise exception 'a reason is required';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._package_editor_apply_features(p_version_id uuid, p_features jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_item jsonb;
  v_key text;
  v_seen text[] := '{}';
  v_catalog integer;
begin
  if p_features is null or jsonb_typeof(p_features) <> 'array' then
    raise exception 'features are required';
  end if;
  select count(*) into v_catalog from public.billing_features;
  if jsonb_array_length(p_features) <> v_catalog then
    raise exception 'every feature is required';
  end if;
  for v_item in select value from jsonb_array_elements(p_features)
  loop
    v_key := v_item ->> 'key';
    if v_key is null or not exists (select 1 from public.billing_features where key = v_key) then
      raise exception 'unknown feature';
    end if;
    if v_key = any (v_seen) then
      raise exception 'feature listed twice';
    end if;
    if v_item -> 'enabled' is null or jsonb_typeof(v_item -> 'enabled') <> 'boolean' then
      raise exception 'features are required';
    end if;
    v_seen := array_append(v_seen, v_key);
  end loop;
  if coalesce(array_length(v_seen, 1), 0) <> v_catalog then
    raise exception 'every feature is required';
  end if;
  delete from public.billing_package_version_features where package_version_id = p_version_id;
  insert into public.billing_package_version_features (package_version_id, feature_key, enabled)
  select p_version_id, f ->> 'key', (f ->> 'enabled')::boolean
  from jsonb_array_elements(p_features) f;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._package_editor_count(p_patch jsonb, p_key text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v numeric;
begin
  if p_patch is null or p_patch -> p_key is null or jsonb_typeof(p_patch -> p_key) = 'null' then
    raise exception 'package numbers must be zero or more';
  end if;
  if jsonb_typeof(p_patch -> p_key) <> 'number' then
    raise exception 'package numbers must be zero or more';
  end if;
  v := (p_patch ->> p_key)::numeric;
  if v < 0 or v <> trunc(v) or v > 1000000 then
    raise exception 'package numbers must be zero or more';
  end if;
  return v::integer;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._package_editor_money(p_patch jsonb, p_key text)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v numeric;
begin
  if p_patch is null or p_patch -> p_key is null or jsonb_typeof(p_patch -> p_key) = 'null' then
    raise exception 'package numbers must be zero or more';
  end if;
  if jsonb_typeof(p_patch -> p_key) <> 'number' then
    raise exception 'package numbers must be zero or more';
  end if;
  v := (p_patch ->> p_key)::numeric;
  if v < 0 or v > 100000000 then
    raise exception 'package numbers must be zero or more';
  end if;
  return v;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._package_editor_open()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  if not coalesce(
    (select package_editor_enabled from public.billing_lifecycle_settings where id = 1),
    false
  ) then
    raise exception 'package editor is off on this database';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._package_version_apply_extra_seat(p_id uuid, p_patch jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
declare
  v_old numeric;
  v_new numeric;
begin
  if not public._package_version_has_column('extra_seat_monthly_kes') then
    return false;
  end if;
  if p_patch is null or not (p_patch ? 'extra_seat_monthly_kes') then
    return false;
  end if;
  execute 'select extra_seat_monthly_kes from public.billing_package_versions where id = $1'
    into v_old
    using p_id;
  if jsonb_typeof(p_patch -> 'extra_seat_monthly_kes') = 'null' then
    if v_old is null then
      return false;
    end if;
    execute 'update public.billing_package_versions set extra_seat_monthly_kes = null where id = $1'
      using p_id;
    return true;
  end if;
  if jsonb_typeof(p_patch -> 'extra_seat_monthly_kes') <> 'number' then
    raise exception 'package numbers must be zero or more';
  end if;
  v_new := (p_patch ->> 'extra_seat_monthly_kes')::numeric;
  if v_new < 0 or v_new > 100000000 then
    raise exception 'package numbers must be zero or more';
  end if;
  if v_old is not distinct from v_new then
    return false;
  end if;
  execute 'update public.billing_package_versions set extra_seat_monthly_kes = $1 where id = $2'
    using v_new, p_id;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._package_version_copy_extra_seat(p_target uuid, p_source uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  if not public._package_version_has_column('extra_seat_monthly_kes') then
    return;
  end if;
  execute $sql$
    update public.billing_package_versions d
    set extra_seat_monthly_kes = case
      when s.extra_seat_monthly_kes is null and p.sku <> 'trial' and d.status = 'draft' then 500
      else s.extra_seat_monthly_kes
    end
    from public.billing_package_versions s
    join public.billing_packages p on p.id = s.package_id
    where d.id = $1 and s.id = $2
  $sql$
  using p_target, p_source;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._package_version_current_id(p_package_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(
    public.billing_latest_package_version(p_package_id),
    (
      select v.id
      from public.billing_package_versions v
      where v.package_id = p_package_id
        and v.status = 'published'
      order by v.version desc
      limit 1
    )
  )
$function$
;

CREATE OR REPLACE FUNCTION public._package_version_fill_extra_seat()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  if not public._package_version_has_column('extra_seat_monthly_kes') then
    return;
  end if;
  execute $sql$
    update public.billing_package_versions v
    set extra_seat_monthly_kes = 500
    from public.billing_packages p
    where v.package_id = p.id
      and p.sku <> 'trial'
      and v.status = 'draft'
      and v.extra_seat_monthly_kes is null
  $sql$;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._package_version_has_column(p_column text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'billing_package_versions'
      and column_name = p_column
  )
$function$
;

CREATE OR REPLACE FUNCTION public._package_version_json(p_version_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select jsonb_build_object(
    'id', v.id,
    'package_id', v.package_id,
    'sku', p.sku,
    'name', p.name,
    'version', v.version,
    'status', v.status,
    'monthly_price_kes', v.monthly_price_kes,
    'annual_price_kes', v.annual_price_kes,
    'seats', v.seats,
    'minutes', v.minutes,
    'message_credits', v.message_credits,
    'sms_credit_burn', v.sms_credit_burn,
    'whatsapp_credit_burn', v.whatsapp_credit_burn,
    'email_credit_burn', v.email_credit_burn,
    'on_demand_allowed', v.on_demand_allowed,
    'sms', v.sms,
    'email', v.email,
    'staff_wa', v.staff_wa,
    'dids', v.dids,
    'inbound_kes_per_second', v.inbound_kes_per_second,
    'outbound_kes_per_second', v.outbound_kes_per_second,
    'whatsapp_kes', v.whatsapp_kes,
    'sms_kes', v.sms_kes,
    'email_kes', v.email_kes,
    'annual_discount_percent', v.annual_discount_percent,
    'credit_kes', v.credit_kes,
    'spend_limit_share_percent', v.spend_limit_share_percent,
    'extra_seat_monthly_kes', to_jsonb(v) -> 'extra_seat_monthly_kes',
    'trial_days', v.trial_days,
    'allowances_placeholder', v.allowances_placeholder,
    'active_from', v.active_from,
    'published_at', v.published_at,
    'retired_at', v.retired_at,
    'copied_from_id', v.copied_from_id,
    'promote_fingerprint', v.promote_fingerprint,
    'notes', v.notes,
    'price_set_by', v.price_set_by,
    'subscriber_count', (
      select count(*)::integer
      from public.tenant_subscriptions s
      where s.package_version_id = v.id
    ),
    'features', coalesce((
      select jsonb_agg(
        jsonb_build_object('key', f.feature_key, 'label', cat.label, 'enabled', f.enabled)
        order by f.feature_key
      )
      from public.billing_package_version_features f
      join public.billing_features cat on cat.key = f.feature_key
      where f.package_version_id = v.id
    ), '[]'::jsonb),
    'approval', (
      select jsonb_build_object(
        'status', a.status,
        'requested_by', a.requested_by,
        'approver', a.approver,
        'created_at', a.created_at
      )
      from public.billing_package_version_approvals a
      where a.package_version_id = v.id
        and a.price_snapshot = public._package_version_price_snapshot(v.id)
      order by a.created_at desc
      limit 1
    ),
    'needs_approval', public._package_version_needs_approval(v.id)
  )
  from public.billing_package_versions v
  join public.billing_packages p on p.id = v.package_id
  where v.id = p_version_id
$function$
;

CREATE OR REPLACE FUNCTION public._package_version_needs_approval(p_version_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_draft public.billing_package_versions%rowtype;
  v_current public.billing_package_versions%rowtype;
  v_threshold numeric;
begin
  select * into v_draft from public.billing_package_versions where id = p_version_id;
  if not found or v_draft.status <> 'draft' then
    return false;
  end if;
  select price_change_approval_threshold_kes into v_threshold
  from public.billing_lifecycle_settings
  where id = 1;
  if v_threshold is null then
    return false;
  end if;
  select * into v_current
  from public.billing_package_versions
  where id = public._package_version_current_id(v_draft.package_id);
  if not found then
    return abs(v_draft.monthly_price_kes) > v_threshold;
  end if;
  if abs(v_draft.monthly_price_kes - v_current.monthly_price_kes) > v_threshold then
    return true;
  end if;
  if v_draft.inbound_kes_per_second is distinct from v_current.inbound_kes_per_second
     or v_draft.outbound_kes_per_second is distinct from v_current.outbound_kes_per_second
     or v_draft.whatsapp_kes is distinct from v_current.whatsapp_kes
     or v_draft.sms_kes is distinct from v_current.sms_kes
     or v_draft.email_kes is distinct from v_current.email_kes
     or v_draft.sms_credit_burn is distinct from v_current.sms_credit_burn
     or v_draft.whatsapp_credit_burn is distinct from v_current.whatsapp_credit_burn
     or v_draft.email_credit_burn is distinct from v_current.email_credit_burn
     or v_draft.annual_discount_percent is distinct from v_current.annual_discount_percent
     or v_draft.annual_price_kes is distinct from v_current.annual_price_kes
     or v_draft.credit_kes is distinct from v_current.credit_kes
     or v_draft.spend_limit_share_percent is distinct from v_current.spend_limit_share_percent
     or (to_jsonb(v_draft) -> 'extra_seat_monthly_kes') is distinct from (to_jsonb(v_current) -> 'extra_seat_monthly_kes')
  then
    return true;
  end if;
  return false;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._package_version_price_snapshot(p_version_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select jsonb_build_object(
    'annual_discount_percent', v.annual_discount_percent,
    'annual_price_kes', v.annual_price_kes,
    'credit_kes', v.credit_kes,
    'email_kes', v.email_kes,
    'extra_seat_monthly_kes', to_jsonb(v) -> 'extra_seat_monthly_kes',
    'inbound_kes_per_second', v.inbound_kes_per_second,
    'monthly_price_kes', v.monthly_price_kes,
    'outbound_kes_per_second', v.outbound_kes_per_second,
    'sms_kes', v.sms_kes,
    'spend_limit_share_percent', v.spend_limit_share_percent,
    'whatsapp_kes', v.whatsapp_kes,
    'sms_credit_burn', v.sms_credit_burn,
    'whatsapp_credit_burn', v.whatsapp_credit_burn,
    'email_credit_burn', v.email_credit_burn
  )
  from public.billing_package_versions v
  where v.id = p_version_id
$function$
;

CREATE OR REPLACE FUNCTION public._package_version_sha256(p_text text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_hash text;
begin
  begin
    execute 'select encode(public.digest(convert_to($1, ''utf8''), ''sha256''), ''hex'')'
      into v_hash
      using p_text;
    return v_hash;
  exception when undefined_function then
    execute 'select encode(extensions.digest(convert_to($1, ''utf8''), ''sha256''), ''hex'')'
      into v_hash
      using p_text;
    return v_hash;
  end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._wallet_apply_delta(p_tenant_id uuid, p_kind text, p_amount_kes numeric, p_reference_type text DEFAULT NULL::text, p_reference_id text DEFAULT NULL::text, p_note text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(ledger_id uuid, wallet_balance_kes numeric, already_applied boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_balance numeric;
  v_id uuid;
begin
  perform set_config('scalers.wallet_write', '1', true);
  if p_tenant_id is null then raise exception 'tenant_id required'; end if;
  if p_kind is null or length(trim(p_kind)) = 0 then raise exception 'kind required'; end if;
  if p_amount_kes is null or p_amount_kes = 0 then raise exception 'amount_kes must be non-zero'; end if;
  if p_reference_id is not null then
    select wl.id, wl.balance_after_kes into v_id, v_balance
    from public.wallet_ledger wl
    where wl.tenant_id = p_tenant_id and wl.kind = p_kind and wl.reference_id = p_reference_id
    limit 1;
    if found then
      ledger_id := v_id; wallet_balance_kes := v_balance; already_applied := true; return next; return;
    end if;
  end if;
  select t.wallet_balance_kes into v_balance from public.tenants t where t.id = p_tenant_id for update;
  if not found then raise exception 'tenant not found'; end if;
  v_balance := coalesce(v_balance, 0) + p_amount_kes;
  update public.tenants set wallet_balance_kes = v_balance, telecom_wallet_balance_kes = v_balance, ai_wallet_balance_usd = 0 where id = p_tenant_id;
  insert into public.wallet_ledger (tenant_id, kind, amount_kes, balance_after_kes, currency, reference_type, reference_id, note, metadata)
  values (p_tenant_id, p_kind, p_amount_kes, v_balance, 'KES', p_reference_type, p_reference_id, p_note, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  ledger_id := v_id; wallet_balance_kes := v_balance; already_applied := false; return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.adjust_payment_overpay(p_provider text, p_provider_ref text, p_amount_kes numeric, p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.payments%rowtype;
  v_delta numeric;
begin
  if p_amount_kes is null or p_amount_kes <= 0 then
    raise exception 'payment amount must be positive';
  end if;
  select * into v_row
  from public.payments
  where provider = p_provider and provider_ref = p_provider_ref
  for update;
  if not found or v_row.match_status = 'issue' then
    raise exception 'payment not found';
  end if;
  if p_amount_kes <= v_row.amount_kes then
    return;
  end if;
  v_delta := p_amount_kes - v_row.amount_kes;
  update public.payments
  set amount_kes = p_amount_kes,
      match_status = 'over'
  where id = v_row.id;
  perform set_config('scalers.billing_write', '1', true);
  insert into public.tenant_credits (tenant_id, amount_kes, reason, idempotency_key, payment_id)
  values (
    coalesce(p_tenant_id, v_row.tenant_id),
    v_delta,
    'overpay',
    'overpay:' || p_provider || ':' || p_provider_ref || ':' || p_amount_kes::text,
    v_row.id
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.adjust_tenant_wallet(p_tenant_id uuid, p_telecom_delta_kes numeric DEFAULT 0, p_ai_delta_usd numeric DEFAULT 0, p_note text DEFAULT NULL::text)
 RETURNS TABLE(telecom_wallet_balance_kes numeric, ai_wallet_balance_usd numeric, wallet_balance_kes numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_delta numeric; v_row record;
begin
  v_delta := coalesce(p_telecom_delta_kes, 0) + round(coalesce(p_ai_delta_usd, 0) * 130);
  select * into v_row from public.adjust_tenant_wallet(p_tenant_id, v_delta, p_note, 'ops_legacy', null);
  telecom_wallet_balance_kes := v_row.wallet_balance_kes; ai_wallet_balance_usd := 0; wallet_balance_kes := v_row.wallet_balance_kes; return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.adjust_tenant_wallet(p_tenant_id uuid, p_delta_kes numeric DEFAULT 0, p_note text DEFAULT NULL::text, p_actor text DEFAULT 'ops'::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS TABLE(wallet_balance_kes numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row record;
  v_actor text := coalesce(nullif(trim(p_actor), ''), 'ops');
  v_note text := nullif(trim(p_note), '');
begin
  if coalesce(p_delta_kes, 0) = 0 then raise exception 'delta_kes must be non-zero'; end if;
  if abs(p_delta_kes) > 500000 then raise exception 'delta_kes exceeds max single credit/debit (500000)'; end if;
  if v_note is null or length(v_note) < 3 then raise exception 'note required (min 3 chars)'; end if;
  select * into v_row from public._wallet_apply_delta(
    p_tenant_id, 'admin_adjustment', p_delta_kes, 'admin', nullif(trim(p_idempotency_key), ''), v_note,
    jsonb_build_object('source', 'super_admin', 'actor', v_actor)
  );
  insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
  values (v_actor, 'adjust_wallet', p_tenant_id, p_delta_kes,
    jsonb_build_object('note', v_note, 'balance_after', v_row.wallet_balance_kes, 'already_applied', v_row.already_applied, 'idempotency_key', p_idempotency_key));
  wallet_balance_kes := v_row.wallet_balance_kes; return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_approve_package_version(p_version_id uuid, p_actor text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.billing_package_versions%rowtype;
  v_sku text;
  v_snapshot jsonb;
begin
  perform public._package_editor_open();
  perform public._package_editor_actor(p_actor, p_reason);
  select * into v_row from public.billing_package_versions where id = p_version_id;
  if not found or v_row.status <> 'draft' then
    raise exception 'this package version is not a draft';
  end if;
  if not public._package_version_needs_approval(p_version_id) then
    raise exception 'this draft does not need a second admin';
  end if;
  if v_row.price_set_by is not null
     and lower(btrim(p_actor)) = lower(btrim(v_row.price_set_by))
  then
    raise exception 'you cannot approve your own price change';
  end if;
  select sku into v_sku from public.billing_packages where id = v_row.package_id;
  v_snapshot := public._package_version_price_snapshot(p_version_id);
  insert into public.billing_package_version_approvals (
    package_version_id, requested_by, approver, status, reason, price_snapshot
  ) values (
    p_version_id,
    coalesce(v_row.price_set_by, btrim(p_actor)),
    btrim(p_actor),
    'approved',
    btrim(p_reason),
    v_snapshot
  );
  perform public._billing_audit(
    btrim(p_actor),
    'approve_package_version',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'package_sku', v_sku,
      'version', v_row.version,
      'version_id', p_version_id,
      'requested_by', v_row.price_set_by,
      'approver', btrim(p_actor),
      'price_snapshot', v_snapshot
    )
  );
  return jsonb_build_object('version_id', p_version_id, 'version', public._package_version_json(p_version_id));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_archive_package_version(p_version_id uuid, p_actor text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.billing_package_versions%rowtype;
  v_sku text;
  v_before jsonb;
  v_published integer;
begin
  perform public._package_editor_open();
  perform public._package_editor_actor(p_actor, p_reason);
  select * into v_row from public.billing_package_versions where id = p_version_id for update;
  if not found or v_row.status <> 'published' then
    raise exception 'only a published version can be archived';
  end if;
  select count(*) into v_published
  from public.billing_package_versions
  where package_id = v_row.package_id and status = 'published';
  if v_published < 2 then
    raise exception 'cannot archive the only published version';
  end if;
  select sku into v_sku from public.billing_packages where id = v_row.package_id;
  v_before := public._package_version_json(p_version_id);
  update public.billing_package_versions
  set status = 'retired', retired_at = now()
  where id = p_version_id;
  perform public._billing_audit(
    btrim(p_actor),
    'archive_package_version',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'package_sku', v_sku,
      'version', v_row.version,
      'version_id', p_version_id,
      'before', v_before,
      'after', public._package_version_json(p_version_id)
    )
  );
  return jsonb_build_object('version_id', p_version_id, 'version', public._package_version_json(p_version_id));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_discard_package_version_draft(p_version_id uuid, p_actor text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.billing_package_versions%rowtype;
  v_sku text;
  v_before jsonb;
  v_pins integer;
begin
  perform public._package_editor_open();
  perform public._package_editor_actor(p_actor, p_reason);
  select * into v_row from public.billing_package_versions where id = p_version_id;
  if not found or v_row.status <> 'draft' then
    raise exception 'this package version is not a draft';
  end if;
  select count(*) into v_pins
  from public.tenant_subscriptions
  where package_version_id = p_version_id;
  if v_pins > 0 then
    raise exception 'a business is still on this version';
  end if;
  select sku into v_sku from public.billing_packages where id = v_row.package_id;
  v_before := public._package_version_json(p_version_id);
  perform public._billing_audit(
    btrim(p_actor),
    'discard_package_version_draft',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'package_sku', v_sku,
      'version', v_row.version,
      'version_id', p_version_id,
      'before', v_before
    )
  );
  delete from public.billing_package_versions where id = p_version_id and status = 'draft';
  return jsonb_build_object('version_id', p_version_id, 'discarded', true);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_draft_package_version(p_sku text, p_actor text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_package public.billing_packages%rowtype;
  v_source public.billing_package_versions%rowtype;
  v_id uuid;
  v_next integer;
begin
  perform public._package_editor_open();
  perform public._package_editor_actor(p_actor, p_reason);
  select * into v_package from public.billing_packages where sku = btrim(p_sku);
  if not found then
    raise exception 'package not found';
  end if;
  if exists (
    select 1 from public.billing_package_versions
    where package_id = v_package.id and status = 'draft'
  ) then
    raise exception 'a draft already exists';
  end if;
  select * into v_source
  from public.billing_package_versions
  where id = public._package_version_current_id(v_package.id);
  if not found then
    raise exception 'no published package version for this package';
  end if;
  select coalesce(max(version), 0) + 1 into v_next
  from public.billing_package_versions
  where package_id = v_package.id;
  insert into public.billing_package_versions (
    package_id, version, status, monthly_price_kes, seats, minutes, sms, email, staff_wa, dids,
    inbound_kes_per_second, outbound_kes_per_second, whatsapp_kes, sms_kes, email_kes,
    annual_discount_percent, annual_price_kes, credit_kes, spend_limit_share_percent,
    trial_days, allowances_placeholder, active_from,
    copied_from_id, notes, price_set_by,
    message_credits, sms_credit_burn, whatsapp_credit_burn, email_credit_burn,
    on_demand_allowed
  ) values (
    v_package.id, v_next, 'draft',
    v_source.monthly_price_kes, v_source.seats, v_source.minutes, v_source.sms, v_source.email,
    v_source.staff_wa, v_source.dids,
    v_source.inbound_kes_per_second, v_source.outbound_kes_per_second, v_source.whatsapp_kes,
    v_source.sms_kes, v_source.email_kes, v_source.annual_discount_percent,
    v_source.annual_price_kes, v_source.credit_kes, v_source.spend_limit_share_percent,
    v_source.trial_days, v_source.allowances_placeholder, v_source.active_from,
    v_source.id, null, null,
    v_source.message_credits, v_source.sms_credit_burn, v_source.whatsapp_credit_burn, v_source.email_credit_burn,
    v_source.on_demand_allowed
  )
  returning id into v_id;
  perform public._package_version_copy_extra_seat(v_id, v_source.id);
  insert into public.billing_package_version_features (package_version_id, feature_key, enabled)
  select v_id, f.feature_key, f.enabled
  from public.billing_package_version_features f
  where f.package_version_id = v_source.id;
  perform public._billing_audit(
    btrim(p_actor),
    'draft_package_version',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'package_sku', v_package.sku,
      'version', v_next,
      'version_id', v_id,
      'copied_from_id', v_source.id,
      'before', public._package_version_json(v_source.id),
      'after', public._package_version_json(v_id)
    )
  );
  return jsonb_build_object('version_id', v_id, 'version', public._package_version_json(v_id));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_export_package_version(p_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.billing_package_versions%rowtype;
  v_sku text;
  v_terms jsonb;
  v_features jsonb;
  v_fingerprint text;
begin
  select * into v from public.billing_package_versions where id = p_version_id;
  if not found or v.status <> 'published' then
    raise exception 'only a published version can be promoted';
  end if;
  select sku into v_sku from public.billing_packages where id = v.package_id;
  v_features := coalesce((
    select jsonb_agg(jsonb_build_object('enabled', f.enabled, 'key', f.feature_key) order by f.feature_key)
    from public.billing_package_version_features f
    where f.package_version_id = v.id
  ), '[]'::jsonb);
  v_terms := jsonb_build_object(
    'active_from', to_char(v.active_from at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'allowances_placeholder', v.allowances_placeholder,
    'annual_discount_percent', v.annual_discount_percent,
    'annual_price_kes', v.annual_price_kes,
    'credit_kes', v.credit_kes,
    'dids', v.dids,
    'email', v.email,
    'email_credit_burn', v.email_credit_burn,
    'email_kes', v.email_kes,
    'on_demand_allowed', v.on_demand_allowed,
    'inbound_kes_per_second', v.inbound_kes_per_second,
    'message_credits', v.message_credits,
    'minutes', v.minutes,
    'monthly_price_kes', v.monthly_price_kes,
    'outbound_kes_per_second', v.outbound_kes_per_second,
    'seats', v.seats,
    'sms', v.sms,
    'sms_credit_burn', v.sms_credit_burn,
    'sms_kes', v.sms_kes,
    'spend_limit_share_percent', v.spend_limit_share_percent,
    'staff_wa', v.staff_wa,
    'trial_days', v.trial_days,
    'whatsapp_credit_burn', v.whatsapp_credit_burn,
    'whatsapp_kes', v.whatsapp_kes
  );
  if public._package_version_has_column('extra_seat_monthly_kes') then
    v_terms := v_terms || jsonb_build_object(
      'extra_seat_monthly_kes', to_jsonb(v) -> 'extra_seat_monthly_kes'
    );
  end if;
  v_fingerprint := public.package_version_fingerprint(v_sku, v_terms, v_features);
  return jsonb_build_object(
    'format', 'scalers.package_version.v1',
    'sku', v_sku,
    'source_version', v.version,
    'source_version_id', v.id,
    'fingerprint', v_fingerprint,
    'terms', v_terms,
    'features', v_features
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_import_promoted_package_version(p_payload jsonb, p_actor text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sku text;
  v_package public.billing_packages%rowtype;
  v_terms jsonb;
  v_features jsonb;
  v_fingerprint text;
  v_existing uuid;
  v_id uuid;
  v_next integer;
  v_active timestamptz;
begin
  perform public._package_editor_actor(p_actor, p_reason);
  if p_payload is null or p_payload ->> 'format' is distinct from 'scalers.package_version.v1' then
    raise exception 'promote file is not a package version';
  end if;
  v_sku := btrim(p_payload ->> 'sku');
  v_terms := p_payload -> 'terms';
  v_features := p_payload -> 'features';
  select * into v_package from public.billing_packages where sku = v_sku;
  if not found then
    raise exception 'package not found';
  end if;
  v_fingerprint := public.package_version_fingerprint(v_sku, v_terms, v_features);
  if nullif(p_payload ->> 'fingerprint', '') is not null
     and p_payload ->> 'fingerprint' is distinct from v_fingerprint
  then
    raise exception 'promote file does not match its fingerprint';
  end if;
  select id into v_existing
  from public.billing_package_versions
  where package_id = v_package.id
    and promote_fingerprint = v_fingerprint
  limit 1;
  if v_existing is not null then
    perform public._billing_audit(
      btrim(p_actor),
      'promote_package_version',
      null,
      jsonb_build_object(
        'reason', btrim(p_reason),
        'package_sku', v_sku,
        'version_id', v_existing,
        'fingerprint', v_fingerprint,
        'source_version_id', p_payload ->> 'source_version_id',
        'source_project_ref', p_payload ->> 'source_project_ref',
        'already_present', true
      )
    );
    return jsonb_build_object(
      'version_id', v_existing,
      'already_present', true,
      'version', public._package_version_json(v_existing)
    );
  end if;
  if exists (
    select 1 from public.billing_package_versions
    where package_id = v_package.id and status = 'draft'
  ) then
    raise exception 'a draft already exists';
  end if;
  v_active := (v_terms ->> 'active_from')::timestamptz;
  select coalesce(max(version), 0) + 1 into v_next
  from public.billing_package_versions
  where package_id = v_package.id;
  perform set_config('scalers.package_version_promote', '1', true);
  insert into public.billing_package_versions (
    package_id, version, status, monthly_price_kes, seats, minutes, sms, email, staff_wa, dids,
    inbound_kes_per_second, outbound_kes_per_second, whatsapp_kes, sms_kes, email_kes,
    annual_discount_percent, annual_price_kes, credit_kes, spend_limit_share_percent,
    trial_days, allowances_placeholder, active_from,
    promote_fingerprint
  ) values (
    v_package.id, v_next, 'draft', 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 1, 50, null, false, v_active, v_fingerprint
  )
  returning id into v_id;
  -- The editor may be off on the target. Numbers still go through the same checks.
  perform public._package_editor_apply_features(v_id, v_features);
  update public.billing_package_versions v
  set
    monthly_price_kes = public._package_editor_money(v_terms, 'monthly_price_kes'),
    seats = public._package_editor_count(v_terms, 'seats'),
    minutes = public._package_editor_count(v_terms, 'minutes'),
    sms = public._package_editor_count(v_terms, 'sms'),
    email = public._package_editor_count(v_terms, 'email'),
    staff_wa = public._package_editor_count(v_terms, 'staff_wa'),
    dids = public._package_editor_count(v_terms, 'dids'),
    inbound_kes_per_second = public._package_editor_money(v_terms, 'inbound_kes_per_second'),
    outbound_kes_per_second = public._package_editor_money(v_terms, 'outbound_kes_per_second'),
    whatsapp_kes = public._package_editor_money(v_terms, 'whatsapp_kes'),
    sms_kes = public._package_editor_money(v_terms, 'sms_kes'),
    email_kes = public._package_editor_money(v_terms, 'email_kes'),
    message_credits = case
      when v_terms -> 'message_credits' is null or jsonb_typeof(v_terms -> 'message_credits') = 'null' then null
      else public._package_editor_count(v_terms, 'message_credits')
    end,
    sms_credit_burn = coalesce(
      case
        when v_terms -> 'sms_credit_burn' is null or jsonb_typeof(v_terms -> 'sms_credit_burn') = 'null' then null
        else public._package_editor_count(v_terms, 'sms_credit_burn')
      end,
      public._package_editor_money(v_terms, 'sms_kes')
    ),
    whatsapp_credit_burn = coalesce(
      case
        when v_terms -> 'whatsapp_credit_burn' is null or jsonb_typeof(v_terms -> 'whatsapp_credit_burn') = 'null' then null
        else public._package_editor_count(v_terms, 'whatsapp_credit_burn')
      end,
      public._package_editor_money(v_terms, 'whatsapp_kes')
    ),
    email_credit_burn = coalesce(
      case
        when v_terms -> 'email_credit_burn' is null or jsonb_typeof(v_terms -> 'email_credit_burn') = 'null' then null
        else public._package_editor_count(v_terms, 'email_credit_burn')
      end,
      public._package_editor_money(v_terms, 'email_kes')
    ),
    on_demand_allowed = case
      when v_terms -> 'on_demand_allowed' is null or jsonb_typeof(v_terms -> 'on_demand_allowed') = 'null' then true
      else (v_terms ->> 'on_demand_allowed')::boolean
    end,
    annual_price_kes = case
      when v_terms ? 'annual_price_kes' and jsonb_typeof(v_terms -> 'annual_price_kes') <> 'null'
        then public._package_editor_money(v_terms, 'annual_price_kes')
      else round(
        public._package_editor_money(v_terms, 'monthly_price_kes') * 12
        * (1 - public._package_editor_money(v_terms, 'annual_discount_percent') / 100)
      )
    end,
    credit_kes = case
      when v_terms ? 'credit_kes' and jsonb_typeof(v_terms -> 'credit_kes') <> 'null'
        then public._package_editor_money(v_terms, 'credit_kes')
      else 1
    end,
    spend_limit_share_percent = case
      when v_terms ? 'spend_limit_share_percent' and jsonb_typeof(v_terms -> 'spend_limit_share_percent') <> 'null'
        then public._package_editor_money(v_terms, 'spend_limit_share_percent')
      else 50
    end,
    annual_discount_percent = public._package_editor_money(v_terms, 'annual_discount_percent'),
    allowances_placeholder = (v_terms ->> 'allowances_placeholder')::boolean,
    trial_days = case
      when v_terms -> 'trial_days' is null or jsonb_typeof(v_terms -> 'trial_days') = 'null' then null
      else (v_terms ->> 'trial_days')::integer
    end
  where v.id = v_id;
  if v_sku = 'trial' then
    if (select trial_days from public.billing_package_versions where id = v_id) is null then
      raise exception 'trial length must be 1 to 90 days';
    end if;
  elsif (select trial_days from public.billing_package_versions where id = v_id) is not null then
    raise exception 'only a trial version has a trial length';
  end if;
  update public.billing_package_versions
  set annual_discount_percent = public._package_annual_discount(monthly_price_kes, annual_price_kes)
  where id = v_id;
  if (select spend_limit_share_percent from public.billing_package_versions where id = v_id) > 100 then
    raise exception 'spend limit must be 0 to 100';
  end if;
  perform public._package_version_apply_extra_seat(v_id, v_terms);
  update public.billing_package_versions
  set status = 'published', published_at = now(), active_from = v_active
  where id = v_id;
  perform public._billing_audit(
    btrim(p_actor),
    'promote_package_version',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'package_sku', v_sku,
      'version_id', v_id,
      'fingerprint', v_fingerprint,
      'source_version_id', p_payload ->> 'source_version_id',
      'source_project_ref', p_payload ->> 'source_project_ref',
      'already_present', false,
      'after', public._package_version_json(v_id)
    )
  );
  perform set_config('scalers.package_version_promote', '0', true);
  return jsonb_build_object(
    'version_id', v_id,
    'already_present', false,
    'version', public._package_version_json(v_id)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_issue_credit_note(p_invoice_id uuid, p_actor text, p_reason text)
 RETURNS TABLE(invoice_id uuid, credit_kes numeric, status_after text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inv public.invoices%rowtype;
  v_actor text := nullif(btrim(p_actor), '');
  v_reason text := btrim(coalesce(p_reason, ''));
  v_balance numeric;
  v_key text;
begin
  if p_invoice_id is null then
    raise exception 'invoice required';
  end if;
  if v_actor is null then
    raise exception 'actor required';
  end if;
  if length(v_reason) < 3 then
    raise exception 'reason required (min 3 chars)';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status <> 'open' then
    raise exception 'credit notes are for open invoices only';
  end if;

  v_balance := greatest(coalesce(v_inv.total_kes, 0) - coalesce(v_inv.amount_paid_kes, 0), 0);
  if v_balance <= 0 then
    raise exception 'nothing left to credit on this invoice';
  end if;

  v_key := 'credit-note:' || v_inv.id::text;
  insert into public.tenant_credits (tenant_id, amount_kes, reason, idempotency_key)
  values (v_inv.tenant_id, v_balance, 'credit_note:' || coalesce(v_inv.invoice_number, v_inv.id::text), v_key)
  on conflict (idempotency_key) do nothing;

  perform set_config('scalers.billing_write', '1', true);
  update public.invoices
  set status = 'void'
  where id = v_inv.id;
  perform set_config('scalers.billing_write', '', true);

  insert into public.ops_audit_log (actor, action, tenant_id, detail)
  values (
    v_actor,
    'credit_note',
    v_inv.tenant_id,
    jsonb_build_object(
      'invoice_id', v_inv.id,
      'invoice_number', v_inv.invoice_number,
      'reason', v_reason,
      'credit_kes', v_balance,
      'after', 'void'
    )
  );

  invoice_id := v_inv.id;
  credit_kes := v_balance;
  status_after := 'void';
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_list_package_versions()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'price_change_approval_threshold_kes', s.price_change_approval_threshold_kes,
    'package_editor_enabled', s.package_editor_enabled,
    'new_signup_trial_enabled', s.new_signup_trial_enabled,
    'extra_seat_supported', public._package_version_has_column('extra_seat_monthly_kes'),
    'features', coalesce((
      select jsonb_agg(jsonb_build_object('key', f.key, 'label', f.label) order by f.key)
      from public.billing_features f
    ), '[]'::jsonb),
    'packages', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'sku', p.sku,
          'name', p.name,
          'is_active', p.is_active,
          'versions', coalesce((
            select jsonb_agg(public._package_version_json(v.id) order by v.version)
            from public.billing_package_versions v
            where v.package_id = p.id
          ), '[]'::jsonb)
        )
        order by p.sort_order, p.sku
      )
      from public.billing_packages p
    ), '[]'::jsonb)
  )
  from public.billing_lifecycle_settings s
  where s.id = 1
$function$
;

CREATE OR REPLACE FUNCTION public.admin_move_subscribers_to_package_version(p_version_id uuid, p_tenant_ids uuid[], p_actor text, p_reason text, p_confirm boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_version public.billing_package_versions%rowtype;
  v_tenant uuid;
  v_moved integer := 0;
  v_invoices integer;
begin
  perform public._package_editor_open();
  perform public._package_editor_actor(p_actor, p_reason);
  if p_confirm is distinct from true then
    raise exception 'confirm the move';
  end if;
  if p_tenant_ids is null or coalesce(array_length(p_tenant_ids, 1), 0) < 1 then
    raise exception 'choose at least one business';
  end if;
  if array_length(p_tenant_ids, 1) > 200 then
    raise exception 'too many businesses in one move';
  end if;
  select * into v_version from public.billing_package_versions where id = p_version_id;
  if not found or v_version.status <> 'published' then
    raise exception 'move businesses onto a published version';
  end if;
  select count(*) into v_invoices from public.invoices;
  foreach v_tenant in array p_tenant_ids
  loop
    perform public._apply_package_version_move(v_version, v_tenant, p_actor, p_reason, 'admin');
    v_moved := v_moved + 1;
  end loop;
  if (select count(*) from public.invoices) is distinct from v_invoices then
    raise exception 'a version move must not create an invoice';
  end if;
  perform set_config('scalers.billing_admin_move', '0', true);
  perform set_config('scalers.billing_version_move', '0', true);
  perform set_config('scalers.wallet_write', '0', true);
  return jsonb_build_object(
    'version_id', p_version_id,
    'moved', v_moved,
    'version', public._package_version_json(p_version_id)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_publish_package_version(p_version_id uuid, p_active_from timestamp with time zone, p_actor text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.billing_package_versions%rowtype;
  v_sku text;
  v_before jsonb;
  v_snapshot jsonb;
  v_staying integer;
begin
  if current_setting('scalers.package_version_promote', true) is distinct from '1' then
    perform public._package_editor_open();
  end if;
  perform public._package_editor_actor(p_actor, p_reason);
  if p_active_from is null then
    raise exception 'active from is required';
  end if;
  select * into v_row from public.billing_package_versions where id = p_version_id for update;
  if not found or v_row.status <> 'draft' then
    raise exception 'this package version is not a draft';
  end if;
  if current_setting('scalers.package_version_promote', true) is distinct from '1'
     and v_row.message_credits is null
  then
    raise exception 'message credits are required';
  end if;
  select sku into v_sku from public.billing_packages where id = v_row.package_id;
  v_before := public._package_version_json(p_version_id);
  if current_setting('scalers.package_version_promote', true) is distinct from '1'
     and public._package_version_needs_approval(p_version_id)
  then
    v_snapshot := public._package_version_price_snapshot(p_version_id);
    if not exists (
      select 1
      from public.billing_package_version_approvals a
      where a.package_version_id = p_version_id
        and a.status = 'approved'
        and a.price_snapshot = v_snapshot
        and lower(a.approver) <> lower(btrim(p_actor))
        and (
          v_row.price_set_by is null
          or lower(a.approver) <> lower(btrim(v_row.price_set_by))
        )
    ) then
      raise exception 'price change needs a second admin';
    end if;
  end if;
  update public.billing_package_versions
  set status = 'published', published_at = now(), active_from = p_active_from
  where id = p_version_id;
  select count(*) into v_staying
  from public.tenant_subscriptions s
  where s.package_id = v_row.package_id
    and s.package_version_id is distinct from p_version_id;
  perform public._billing_audit(
    btrim(p_actor),
    'publish_package_version',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'package_sku', v_sku,
      'version', v_row.version,
      'version_id', p_version_id,
      'active_from', p_active_from,
      'subscribers_staying', v_staying,
      'before', v_before,
      'after', public._package_version_json(p_version_id)
    )
  );
  return jsonb_build_object(
    'version_id', p_version_id,
    'subscribers_staying', v_staying,
    'version', public._package_version_json(p_version_id)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_billing_runtime_switch(p_switch text, p_mode text, p_enabled boolean, p_actor text, p_reason text, p_confirm boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_before jsonb;
  v_after jsonb;
  v_key text;
begin
  perform public._package_editor_actor(p_actor, p_reason);
  if p_confirm is distinct from true then
    raise exception 'confirm the change';
  end if;

  v_key := lower(btrim(coalesce(p_switch, '')));
  if v_key not in ('bachs_mode', 'live_master', 'billing_notices', 'desk_plan_change') then
    raise exception 'unknown switch';
  end if;

  select jsonb_build_object(
    'bachs_payments_mode', bachs_payments_mode,
    'live_payments_master', live_payments_master,
    'billing_notices_send', billing_notices_send,
    'desk_plan_change_enabled', desk_plan_change_enabled
  )
  into v_before
  from public.billing_lifecycle_settings
  where id = 1;
  if not found then
    raise exception 'billing settings are missing';
  end if;

  if v_key = 'bachs_mode' then
    if p_mode is null or lower(btrim(p_mode)) not in ('off', 'sandbox', 'live') then
      raise exception 'payments mode must be off, sandbox, or live';
    end if;
    update public.billing_lifecycle_settings
    set bachs_payments_mode = lower(btrim(p_mode)),
        updated_at = now()
    where id = 1;
  elsif v_key = 'live_master' then
    if p_enabled is null then
      raise exception 'live payments must be on or off';
    end if;
    update public.billing_lifecycle_settings
    set live_payments_master = p_enabled,
        updated_at = now()
    where id = 1;
  elsif v_key = 'billing_notices' then
    if p_enabled is null then
      raise exception 'billing notices must be on or off';
    end if;
    update public.billing_lifecycle_settings
    set billing_notices_send = p_enabled,
        updated_at = now()
    where id = 1;
  else
    if p_enabled is null then
      raise exception 'plan changes must be on or off';
    end if;
    update public.billing_lifecycle_settings
    set desk_plan_change_enabled = p_enabled,
        updated_at = now()
    where id = 1;
  end if;

  select jsonb_build_object(
    'bachs_payments_mode', bachs_payments_mode,
    'live_payments_master', live_payments_master,
    'billing_notices_send', billing_notices_send,
    'desk_plan_change_enabled', desk_plan_change_enabled
  )
  into v_after
  from public.billing_lifecycle_settings
  where id = 1;

  perform public._billing_audit(
    btrim(p_actor),
    'set_billing_runtime_switch',
    null,
    jsonb_build_object(
      'switch', v_key,
      'reason', btrim(p_reason),
      'confirm', true,
      'before', v_before,
      'after', v_after,
      'changed_at', now()
    )
  );

  return v_after;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_invoice_dispute(p_invoice_id uuid, p_paused boolean, p_actor text, p_reason text)
 RETURNS TABLE(invoice_id uuid, reminders_paused_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inv public.invoices%rowtype;
  v_actor text := nullif(btrim(p_actor), '');
  v_reason text := btrim(coalesce(p_reason, ''));
  v_at timestamptz;
begin
  if p_invoice_id is null then
    raise exception 'invoice required';
  end if;
  if v_actor is null then
    raise exception 'actor required';
  end if;
  if length(v_reason) < 3 then
    raise exception 'reason required (min 3 chars)';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status <> 'open' then
    raise exception 'only an open invoice can be marked disputed';
  end if;

  v_at := case when p_paused then coalesce(v_inv.reminders_paused_at, now()) else null end;

  -- reminders_paused_at is not frozen by invoices_freeze (status/number only for drafts;
  -- other columns still hit the freeze on non-draft). Use billing_write.
  perform set_config('scalers.billing_write', '1', true);
  update public.invoices
  set reminders_paused_at = v_at
  where id = v_inv.id;
  perform set_config('scalers.billing_write', '', true);

  insert into public.ops_audit_log (actor, action, tenant_id, detail)
  values (
    v_actor,
    case when p_paused then 'dispute_invoice' else 'clear_invoice_dispute' end,
    v_inv.tenant_id,
    jsonb_build_object(
      'invoice_id', v_inv.id,
      'invoice_number', v_inv.invoice_number,
      'reason', v_reason,
      'reminders_paused_at', v_at
    )
  );

  invoice_id := v_inv.id;
  reminders_paused_at := v_at;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_package_editor_enabled(p_enabled boolean, p_actor text, p_reason text, p_confirm boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_before boolean;
begin
  perform public._package_editor_actor(p_actor, p_reason);
  if p_confirm is distinct from true then
    raise exception 'confirm the package editor setting';
  end if;
  if p_enabled is null then
    raise exception 'package editor must be on or off';
  end if;

  select package_editor_enabled into v_before
  from public.billing_lifecycle_settings
  where id = 1;
  if not found then
    raise exception 'billing settings are missing';
  end if;

  update public.billing_lifecycle_settings
  set package_editor_enabled = p_enabled,
      updated_at = now()
  where id = 1;

  perform public._billing_audit(
    btrim(p_actor),
    'set_package_editor_enabled',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'confirm', true,
      'before', v_before,
      'after', p_enabled,
      'changed_at', now()
    )
  );

  return jsonb_build_object('package_editor_enabled', p_enabled);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_tenant_billing_mode(p_tenant_id uuid, p_billing_status text, p_enforcement text, p_actor text, p_reason text, p_confirm boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_before_status text;
  v_after_status text;
  v_before_enf text;
  v_after_enf text;
  v_version uuid;
  v_minutes integer;
  v_invoices integer;
begin
  perform public._package_editor_open();
  perform public._package_editor_actor(p_actor, p_reason);
  if p_confirm is distinct from true then
    raise exception 'confirm the billing change';
  end if;
  if p_billing_status not in ('beta', 'active') then
    raise exception 'billing status must be beta or active';
  end if;
  if p_enforcement not in ('off', 'soft', 'hard') then
    raise exception 'billing enforcement must be off, soft, or hard';
  end if;
  if p_billing_status = 'beta' and p_enforcement is distinct from 'off' then
    raise exception 'billing stays off while the business is on beta';
  end if;
  if not (
    (p_billing_status = 'beta' and p_enforcement = 'off')
    or (p_billing_status = 'active' and p_enforcement in ('soft', 'hard'))
  ) then
    raise exception 'billing mode must be beta with enforcement off, or active with enforcement soft or hard';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'business not found';
  end if;
  select billing_status, package_version_id into v_before_status, v_version
  from public.tenant_subscriptions where tenant_id = p_tenant_id for update;
  if v_before_status is null then
    raise exception 'business not found';
  end if;
  if v_before_status not in ('beta', 'active') and v_before_status is distinct from p_billing_status then
    raise exception 'billing status is not beta or active';
  end if;
  select billing_enforcement, minutes_included into v_before_enf, v_minutes
  from public.tenants where id = p_tenant_id;
  select count(*) into v_invoices from public.invoices;

  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants
  set billing_enforcement = p_enforcement
  where id = p_tenant_id;

  if v_before_status is distinct from p_billing_status then
    perform set_config('scalers.billing_transition', '1', true);
    update public.tenant_subscriptions
    set billing_status = p_billing_status, billing_status_changed_at = now()
    where tenant_id = p_tenant_id;
  end if;

  select billing_status into v_after_status
  from public.tenant_subscriptions where tenant_id = p_tenant_id;
  select billing_enforcement into v_after_enf from public.tenants where id = p_tenant_id;
  if (select package_version_id from public.tenant_subscriptions where tenant_id = p_tenant_id) is distinct from v_version
     or (select minutes_included from public.tenants where id = p_tenant_id) is distinct from v_minutes
     or (select count(*) from public.invoices) is distinct from v_invoices
  then
    raise exception 'a billing change must not change the plan';
  end if;
  perform public._billing_audit(
    btrim(p_actor),
    'set_tenant_billing_mode',
    p_tenant_id,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'confirm', true,
      'billing_status_before', v_before_status,
      'billing_status_after', v_after_status,
      'billing_enforcement_before', v_before_enf,
      'billing_enforcement_after', v_after_enf,
      'package_version_id', v_version,
      'changed_at', now()
    )
  );
  perform set_config('scalers.wallet_write', '0', true);
  perform set_config('scalers.billing_transition', '0', true);
  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'billing_status', v_after_status,
    'billing_enforcement', v_after_enf
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_tenant_live_payments(p_tenant_id uuid, p_enabled boolean, p_reason text, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_enforcement text;
  v_status text;
  v_reason text;
  v_actor text;
begin
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  v_actor := nullif(btrim(coalesce(p_actor, '')), '');
  if v_reason is null then
    raise exception 'a reason is required';
  end if;
  if v_actor is null then
    raise exception 'an actor is required';
  end if;
  if p_enabled is null then
    raise exception 'enabled is required';
  end if;

  perform 1 from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'business not found';
  end if;

  select t.billing_enforcement, s.billing_status
    into v_enforcement, v_status
  from public.tenants t
  left join public.tenant_subscriptions s on s.tenant_id = t.id
  where t.id = p_tenant_id;

  if p_enabled is true and (
    coalesce(v_enforcement, 'off') = 'off'
    or coalesce(v_status, 'beta') = 'beta'
  ) then
    raise exception 'live payments stay off while the business is on beta';
  end if;

  insert into public.billing_live_tenants (tenant_id, enabled, reason, set_by, set_at)
  values (p_tenant_id, p_enabled, v_reason, v_actor, now())
  on conflict (tenant_id) do update
    set enabled = excluded.enabled,
        reason = excluded.reason,
        set_by = excluded.set_by,
        set_at = now();

  perform public._billing_audit(
    v_actor,
    'tenant_live_payments_set',
    p_tenant_id,
    jsonb_build_object(
      'enabled', p_enabled,
      'reason', v_reason,
      'billing_enforcement', v_enforcement,
      'billing_status', v_status
    )
  );

  return (
    select jsonb_build_object(
      'tenant_id', row.tenant_id,
      'enabled', row.enabled,
      'reason', row.reason,
      'set_by', row.set_by,
      'set_at', row.set_at
    )
    from public.billing_live_tenants row
    where row.tenant_id = p_tenant_id
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_update_package_version_draft(p_version_id uuid, p_patch jsonb, p_actor text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old public.billing_package_versions%rowtype;
  v_sku text;
  v_before jsonb;
  v_monthly numeric;
  v_seats integer;
  v_minutes integer;
  v_message_credits integer;
  v_sms_burn integer;
  v_whatsapp_burn integer;
  v_email_burn integer;
  v_on_demand boolean;
  v_dids integer;
  v_inbound numeric;
  v_outbound numeric;
  v_annual numeric;
  v_discount numeric;
  v_credit numeric;
  v_share numeric;
  v_trial integer;
  v_placeholder boolean;
  v_notes text;
  v_price_set_by text;
  v_price_changed boolean;
  v_extra_changed boolean;
begin
  perform public._package_editor_open();
  perform public._package_editor_actor(p_actor, p_reason);
  select * into v_old from public.billing_package_versions where id = p_version_id;
  if not found or v_old.status <> 'draft' then
    raise exception 'this package version is not a draft';
  end if;
  select sku into v_sku from public.billing_packages where id = v_old.package_id;
  v_before := public._package_version_json(p_version_id);
  v_monthly := public._package_editor_money(p_patch, 'monthly_price_kes');
  v_seats := public._package_editor_count(p_patch, 'seats');
  v_minutes := public._package_editor_count(p_patch, 'minutes');
  v_message_credits := public._package_editor_count(p_patch, 'message_credits');
  v_sms_burn := public._package_editor_count(p_patch, 'sms_credit_burn');
  v_whatsapp_burn := public._package_editor_count(p_patch, 'whatsapp_credit_burn');
  v_email_burn := public._package_editor_count(p_patch, 'email_credit_burn');
  v_dids := public._package_editor_count(p_patch, 'dids');
  v_inbound := public._package_editor_money(p_patch, 'inbound_kes_per_second');
  v_outbound := public._package_editor_money(p_patch, 'outbound_kes_per_second');
  v_annual := public._package_editor_money(p_patch, 'annual_price_kes');
  v_discount := public._package_annual_discount(v_monthly, v_annual);
  v_credit := public._package_editor_money(p_patch, 'credit_kes');
  v_share := public._package_editor_money(p_patch, 'spend_limit_share_percent');
  if v_share > 100 then
    raise exception 'spend limit must be 0 to 100';
  end if;
  if p_patch -> 'trial_days' is null then
    raise exception 'trial length is required';
  end if;
  if jsonb_typeof(p_patch -> 'trial_days') = 'null' then
    v_trial := null;
  else
    v_trial := public._package_editor_count(p_patch, 'trial_days');
  end if;
  if v_sku = 'trial' then
    if v_trial is null or v_trial < 1 or v_trial > 90 then
      raise exception 'trial length must be 1 to 90 days';
    end if;
  elsif v_trial is not null then
    raise exception 'only a trial version has a trial length';
  end if;
  if p_patch -> 'allowances_placeholder' is null
     or jsonb_typeof(p_patch -> 'allowances_placeholder') <> 'boolean'
  then
    raise exception 'allowances placeholder is required';
  end if;
  v_placeholder := (p_patch ->> 'allowances_placeholder')::boolean;
  if p_patch -> 'on_demand_allowed' is null
     or jsonb_typeof(p_patch -> 'on_demand_allowed') <> 'boolean'
  then
    raise exception 'on-demand setting is required';
  end if;
  v_on_demand := (p_patch ->> 'on_demand_allowed')::boolean;
  if p_patch ? 'notes' and jsonb_typeof(p_patch -> 'notes') <> 'null' then
    v_notes := nullif(btrim(p_patch ->> 'notes'), '');
    if v_notes is not null and length(v_notes) > 500 then
      raise exception 'notes must be 500 characters or less';
    end if;
  else
    v_notes := v_old.notes;
  end if;
  perform public._package_editor_apply_features(p_version_id, p_patch -> 'features');
  v_extra_changed := public._package_version_apply_extra_seat(p_version_id, p_patch);
  v_price_changed :=
    v_monthly is distinct from v_old.monthly_price_kes
    or v_inbound is distinct from v_old.inbound_kes_per_second
    or v_outbound is distinct from v_old.outbound_kes_per_second
    or v_sms_burn is distinct from v_old.sms_credit_burn
    or v_whatsapp_burn is distinct from v_old.whatsapp_credit_burn
    or v_email_burn is distinct from v_old.email_credit_burn
    or v_annual is distinct from v_old.annual_price_kes
    or v_discount is distinct from v_old.annual_discount_percent
    or v_credit is distinct from v_old.credit_kes
    or v_share is distinct from v_old.spend_limit_share_percent
    or v_extra_changed;
  if v_price_changed then
    v_price_set_by := btrim(p_actor);
  else
    v_price_set_by := v_old.price_set_by;
  end if;
  update public.billing_package_versions
  set
    monthly_price_kes = v_monthly,
    seats = v_seats,
    minutes = v_minutes,
    message_credits = v_message_credits,
    sms_credit_burn = v_sms_burn,
    whatsapp_credit_burn = v_whatsapp_burn,
    email_credit_burn = v_email_burn,
    dids = v_dids,
    inbound_kes_per_second = v_inbound,
    outbound_kes_per_second = v_outbound,
    whatsapp_kes = v_whatsapp_burn,
    sms_kes = v_sms_burn,
    email_kes = v_email_burn,
    annual_price_kes = v_annual,
    annual_discount_percent = v_discount,
    credit_kes = v_credit,
    spend_limit_share_percent = v_share,
    trial_days = v_trial,
    allowances_placeholder = v_placeholder,
    on_demand_allowed = v_on_demand,
    notes = v_notes,
    price_set_by = v_price_set_by
  where id = p_version_id;
  perform public._billing_audit(
    btrim(p_actor),
    'update_package_version_draft',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'package_sku', v_sku,
      'version', v_old.version,
      'version_id', p_version_id,
      'before', v_before,
      'after', public._package_version_json(p_version_id)
    )
  );
  return jsonb_build_object('version_id', p_version_id, 'version', public._package_version_json(p_version_id));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_void_invoice(p_invoice_id uuid, p_actor text, p_reason text)
 RETURNS TABLE(invoice_id uuid, status_before text, status_after text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inv public.invoices%rowtype;
  v_actor text := nullif(btrim(p_actor), '');
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_invoice_id is null then
    raise exception 'invoice required';
  end if;
  if v_actor is null then
    raise exception 'actor required';
  end if;
  if length(v_reason) < 3 then
    raise exception 'reason required (min 3 chars)';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status in ('void', 'uncollectible') then
    invoice_id := v_inv.id;
    status_before := v_inv.status;
    status_after := v_inv.status;
    return next;
    return;
  end if;
  if v_inv.status not in ('open', 'draft') then
    raise exception 'only open or draft invoices can be voided';
  end if;

  perform set_config('scalers.billing_write', '1', true);
  update public.invoices
  set status = 'void'
  where id = v_inv.id;
  perform set_config('scalers.billing_write', '', true);

  insert into public.ops_audit_log (actor, action, tenant_id, detail)
  values (
    v_actor,
    'void_invoice',
    v_inv.tenant_id,
    jsonb_build_object(
      'invoice_id', v_inv.id,
      'invoice_number', v_inv.invoice_number,
      'reason', v_reason,
      'before', v_inv.status,
      'after', 'void'
    )
  );

  invoice_id := v_inv.id;
  status_before := v_inv.status;
  status_after := 'void';
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_payment(p_provider text, p_provider_ref text, p_amount_kes numeric, p_tenant_id uuid DEFAULT NULL::uuid, p_invoice_id uuid DEFAULT NULL::uuid, p_paid_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_actor text DEFAULT 'system'::text, p_raw jsonb DEFAULT '{}'::jsonb, p_settled_amount_minor integer DEFAULT NULL::integer, p_settled_currency text DEFAULT NULL::text, p_fx_rate numeric DEFAULT NULL::numeric, p_fee_minor integer DEFAULT NULL::integer, p_payer_msisdn_masked text DEFAULT NULL::text, p_bill_ref text DEFAULT NULL::text)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing public.payments%rowtype;
  v_inv public.invoices%rowtype;
  v_paid numeric;
  v_match text;
  v_row public.payments%rowtype;
  v_excess numeric;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_provider_ref), '') is null then
    raise exception 'provider and provider ref are required';
  end if;
  if p_amount_kes is null or p_amount_kes <= 0 then
    raise exception 'payment amount must be positive';
  end if;

  select * into v_existing
  from public.payments
  where provider = p_provider and provider_ref = p_provider_ref
  for update;
  if found and v_existing.match_status is distinct from 'issue' then
    return v_existing;
  end if;
  if found and v_existing.match_status = 'issue' then
    delete from public.payments where id = v_existing.id;
  end if;

  if p_invoice_id is not null then
    select * into v_inv from public.invoices where id = p_invoice_id for update;
    if not found then
      raise exception 'invoice not found';
    end if;
    if v_inv.status in ('void', 'uncollectible') then
      raise exception 'invoice cannot be paid';
    end if;
    if v_inv.status = 'draft' then
      raise exception 'draft invoices are not payable';
    end if;
    if p_tenant_id is not null and p_tenant_id is distinct from v_inv.tenant_id then
      raise exception 'payment tenant does not match the invoice';
    end if;
    p_tenant_id := v_inv.tenant_id;
    v_paid := v_inv.amount_paid_kes + p_amount_kes;
    if v_paid < v_inv.total_kes then
      v_match := 'partial';
    elsif v_paid = v_inv.total_kes then
      v_match := 'matched';
    else
      v_match := 'over';
    end if;
  else
    v_match := 'unmatched';
  end if;

  insert into public.payments (
    tenant_id, invoice_id, provider, provider_ref, amount_kes,
    settled_amount_minor, settled_currency, fx_rate, fee_minor,
    match_status, payer_msisdn_masked, bill_ref, paid_at, raw, actor
  ) values (
    p_tenant_id, p_invoice_id, p_provider, p_provider_ref, p_amount_kes,
    p_settled_amount_minor, p_settled_currency, p_fx_rate, p_fee_minor,
    v_match, p_payer_msisdn_masked, p_bill_ref, coalesce(p_paid_at, now()),
    coalesce(p_raw, '{}'::jsonb), p_actor
  )
  returning * into v_row;

  if p_invoice_id is not null then
    perform set_config('scalers.billing_write', '1', true);
    if v_match = 'over' then
      v_excess := v_paid - v_inv.total_kes;
      update public.invoices
      set amount_paid_kes = total_kes,
          status = 'paid',
          paid_at = coalesce(paid_at, coalesce(p_paid_at, now())),
          updated_at = now()
      where id = p_invoice_id;
      insert into public.tenant_credits (tenant_id, amount_kes, reason, idempotency_key, payment_id)
      values (
        p_tenant_id,
        v_excess,
        'overpay',
        'overpay:' || p_provider || ':' || p_provider_ref,
        v_row.id
      );
    elsif v_match = 'matched' then
      update public.invoices
      set amount_paid_kes = total_kes,
          status = 'paid',
          paid_at = coalesce(paid_at, coalesce(p_paid_at, now())),
          updated_at = now()
      where id = p_invoice_id;
    else
      update public.invoices
      set amount_paid_kes = amount_paid_kes + p_amount_kes,
          updated_at = now()
      where id = p_invoice_id;
    end if;
  end if;

  perform public._billing_audit(
    p_actor,
    'apply_payment',
    p_tenant_id,
    jsonb_build_object(
      'provider', p_provider,
      'provider_ref', p_provider_ref,
      'amount_kes', p_amount_kes,
      'match_status', v_match,
      'invoice_id', p_invoice_id
    )
  );
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.archive_tenant_billing(p_tenant_id uuid, p_actor text, p_reason text DEFAULT NULL::text)
 RETURNS TABLE(changed boolean, audited boolean, billing_before text, billing_after text, on_demand_before boolean, on_demand_after boolean, archived_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_t record;
  v_sub jsonb;
  v_changed boolean;
  v_dup boolean;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;
  if coalesce(trim(p_actor), '') = '' then
    raise exception 'actor required';
  end if;

  select t.id, t.archived_at,
         coalesce(t.billing_enforcement, 'off') as billing_enforcement,
         coalesce(t.on_demand_usage_enabled, false) as on_demand,
         t.beta_expires_at, t.line_paid_through, t.line_status
    into v_t
  from public.tenants t
  where t.id = p_tenant_id
  for update;

  if not found then
    raise exception 'This business no longer exists.';
  end if;
  if v_t.archived_at is null then
    raise exception 'Archive the business before stopping its billing.';
  end if;

  v_changed := v_t.billing_enforcement <> 'off' or v_t.on_demand;

  if v_changed then
    perform set_config('scalers.wallet_write', '1', true);
    update public.tenants t
       set billing_enforcement = 'off',
           on_demand_usage_enabled = false
     where t.id = p_tenant_id;
    perform set_config('scalers.wallet_write', '0', true);
  end if;

  -- One audit row per archive (keyed on archived_at). Re-runs add nothing.
  select exists (
    select 1 from (
      select l.action, l.detail
      from public.ops_audit_log l
      where l.tenant_id = p_tenant_id
        and l.action in ('archive_tenant_billing', 'unarchive_tenant_billing')
      order by l.created_at desc, l.id desc
      limit 1
    ) last
    where last.action = 'archive_tenant_billing'
      and (last.detail->>'archived_at')::timestamptz = v_t.archived_at
  ) into v_dup;

  if not v_dup then
    if to_regclass('public.tenant_subscriptions') is not null then
      execute 'select to_jsonb(s) from public.tenant_subscriptions s where s.tenant_id = $1'
        into v_sub using p_tenant_id;
    end if;
    insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
    values (
      trim(p_actor),
      'archive_tenant_billing',
      p_tenant_id,
      null,
      jsonb_build_object(
        'archived_at', v_t.archived_at,
        'reason', nullif(trim(coalesce(p_reason, '')), ''),
        'before', jsonb_build_object(
          'billing_enforcement', v_t.billing_enforcement,
          'on_demand_usage_enabled', v_t.on_demand,
          'beta_expires_at', v_t.beta_expires_at,
          'line_paid_through', v_t.line_paid_through,
          'line_status', v_t.line_status,
          'subscription', case when v_sub is null then null else jsonb_build_object(
            'status', v_sub->>'status',
            'package_id', v_sub->>'package_id',
            'period', v_sub->>'period',
            'current_period_start', v_sub->>'current_period_start',
            'current_period_end', v_sub->>'current_period_end') end
        ),
        'after', jsonb_build_object('billing_enforcement', 'off', 'on_demand_usage_enabled', false),
        'line_rental', 'stopped (billing off)',
        'rollover', 'skipped while archived',
        'invoices', 'none (no invoice table)'
      )
    );
  end if;

  changed := v_changed;
  audited := not v_dup;
  billing_before := v_t.billing_enforcement;
  billing_after := 'off';
  on_demand_before := v_t.on_demand;
  on_demand_after := false;
  archived_at := v_t.archived_at;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_tenant_package(p_tenant_id uuid, p_package_id uuid, p_period text DEFAULT 'month'::text, p_actor text DEFAULT 'ops'::text, p_note text DEFAULT NULL::text)
 RETURNS TABLE(assigned_tenant_id uuid, assigned_package_id uuid, assigned_period text, change_kind text, effective_at timestamp with time zone, minutes_included integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_actor text := coalesce(nullif(trim(p_actor), ''), 'ops');
  v_period text := lower(trim(coalesce(p_period, 'month')));
  v_pack public.billing_packages%rowtype;
  v_cur public.billing_packages%rowtype;
  v_sub record;
  v_has_sub boolean;
  v_tenant_minutes integer;
  v_start timestamptz;
  v_end timestamptz;
  v_grants integer;
  v_base integer;
  v_frac numeric;
  v_kind text;
  v_effective timestamptz := now();
  v_after integer;
  v_upgrade boolean;
  v_repeat boolean := false;
  v_before jsonb;
  v_after_snap jsonb;
begin
  if p_tenant_id is null or p_package_id is null then
    raise exception 'tenant and package required';
  end if;
  if v_period not in ('month', 'year') then
    raise exception 'period must be month or year';
  end if;

  select t.minutes_included into v_tenant_minutes
  from public.tenants t where t.id = p_tenant_id for update;
  if not found then
    raise exception 'tenant not found';
  end if;

  select * into v_pack from public.billing_packages p where p.id = p_package_id;
  if not found then
    raise exception 'package not found';
  end if;

  select s.* into v_sub
  from public.tenant_subscriptions s where s.tenant_id = p_tenant_id for update;
  v_has_sub := found;
  v_before := public._billing_package_snapshot(p_tenant_id);

  if not v_has_sub or v_sub.status <> 'active' then
    -- Rule 5: start from no package.
    if not v_pack.is_active then
      raise exception 'package is not available';
    end if;
    -- Usage period is always the calendar month (or the running monthly
    -- clock of a cancelled row). A new billing term starts with it.
    if v_has_sub and v_sub.current_period_end is not null and v_sub.current_period_end > now() then
      v_start := v_sub.current_period_start;
      v_end := v_sub.current_period_end;
    else
      v_start := date_trunc('month', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi';
      v_end := public.billing_add_months(v_start, 1);
    end if;

    insert into public.tenant_subscriptions as s (
      tenant_id, package_id, period, started_at, current_period_start, current_period_end,
      term_start, term_end, status, updated_at, ended_at,
      pending_package_id, pending_period, pending_change, pending_effective_at, pending_set_at, pending_actor
    ) values (
      p_tenant_id, p_package_id, v_period, now(), v_start, v_end,
      v_start, public.billing_add_months(v_start, case when v_period = 'year' then 12 else 1 end),
      'active', now(), null, null, null, null, null, null, null
    )
    on conflict (tenant_id) do update set
      package_id = excluded.package_id,
      period = excluded.period,
      started_at = excluded.started_at,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      term_start = excluded.term_start,
      term_end = excluded.term_end,
      status = 'active',
      updated_at = now(),
      ended_at = null,
      pending_package_id = null, pending_period = null, pending_change = null,
      pending_effective_at = null, pending_set_at = null, pending_actor = null;

    v_grants := public.billing_grant_minutes_for_period(p_tenant_id, v_start, v_end);
    perform public._tenant_set_allowances(p_tenant_id, p_package_id, v_pack.minutes + v_grants);
    v_kind := 'new';

  elsif v_sub.package_id = p_package_id and v_sub.period = v_period then
    -- Same package: no-op, but cancel any pending change (rule 4).
    v_kind := case when v_sub.pending_change is null then 'same' else 'pending_cancelled' end;
    update public.tenant_subscriptions s
      set pending_package_id = null, pending_period = null, pending_change = null,
          pending_effective_at = null, pending_set_at = null, pending_actor = null,
          updated_at = case when v_sub.pending_change is null then s.updated_at else now() end
    where s.tenant_id = p_tenant_id;

  else
    select * into v_cur from public.billing_packages p where p.id = v_sub.package_id;
    v_upgrade := v_sub.package_id <> p_package_id and (
      v_pack.monthly_price_kes > v_cur.monthly_price_kes
      or (v_pack.monthly_price_kes = v_cur.monthly_price_kes and v_pack.minutes > v_cur.minutes)
    );

    if v_upgrade then
      if not v_pack.is_active then
        raise exception 'package is not available';
      end if;
      -- Rule 3: upgrade now, keep period/usage/grants, prorate the difference.
      v_grants := public.billing_grant_minutes_for_period(
        p_tenant_id, v_sub.current_period_start, v_sub.current_period_end);
      v_base := greatest(coalesce(v_tenant_minutes, 0) - v_grants, 0);
      if v_sub.current_period_end is null or v_sub.current_period_end <= v_sub.current_period_start then
        v_frac := 1;
      else
        v_frac := extract(epoch from (v_sub.current_period_end - now()))
                / extract(epoch from (v_sub.current_period_end - v_sub.current_period_start));
        v_frac := least(greatest(v_frac, 0), 1);
      end if;
      v_base := v_base + ceil(greatest(v_pack.minutes - v_cur.minutes, 0) * v_frac)::integer;

      update public.tenant_subscriptions s
        set package_id = p_package_id,
            updated_at = now(),
            -- A different period on an upgrade is scheduled (rule 4).
            pending_package_id = case when v_period <> v_sub.period then p_package_id end,
            pending_period = case when v_period <> v_sub.period then v_period end,
            pending_change = case when v_period <> v_sub.period then 'period_change' end,
            pending_effective_at = case when v_period <> v_sub.period then v_sub.current_period_end end,
            pending_set_at = case when v_period <> v_sub.period then now() end,
            pending_actor = case when v_period <> v_sub.period then v_actor end
      where s.tenant_id = p_tenant_id;

      perform public._tenant_set_allowances(p_tenant_id, p_package_id, v_base + v_grants);
      v_kind := 'upgrade';
    else
      -- Rule 4: downgrade or period change waits for the next period.
      if v_sub.current_period_end is null then
        raise exception 'subscription has no period end; cannot schedule';
      end if;
      v_kind := case when v_sub.package_id = p_package_id then 'period_change_scheduled' else 'downgrade_scheduled' end;
      -- Rule 10: term switch at the next usage month; downgrade at term end.
      v_effective := case
        when v_sub.package_id = p_package_id then v_sub.current_period_end
        else greatest(coalesce(v_sub.term_end, v_sub.current_period_end), v_sub.current_period_end) end;
      if v_sub.pending_package_id is not distinct from p_package_id
         and v_sub.pending_period is not distinct from v_period then
        v_repeat := true;  -- same change already scheduled: no write, no audit
      end if;
      update public.tenant_subscriptions s
        set pending_package_id = p_package_id,
            pending_period = v_period,
            pending_change = case when v_sub.package_id = p_package_id then 'period_change' else 'downgrade' end,
            pending_effective_at = v_effective,
            pending_set_at = now(),
            pending_actor = v_actor,
            updated_at = now()
      where s.tenant_id = p_tenant_id
        and not v_repeat;
    end if;
  end if;

  select t.minutes_included into v_after from public.tenants t where t.id = p_tenant_id;

  if v_kind <> 'same' and not v_repeat then
    -- after = the state this change produces: now, or at effective_at when scheduled.
    if v_kind in ('downgrade_scheduled', 'period_change_scheduled') then
      v_after_snap := public._billing_package_snapshot_of(
        p_package_id, v_period, v_effective, public.billing_add_months(v_effective, 1), 'active');
    else
      v_after_snap := public._billing_package_snapshot(p_tenant_id);
    end if;
    insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
    values (v_actor, 'assign_package', p_tenant_id, null, jsonb_build_object(
      'before', v_before,
      'after', v_after_snap,
      'scheduled', v_kind in ('downgrade_scheduled', 'period_change_scheduled'),
      'change_kind', v_kind,
      'package_id', p_package_id,
      'package_sku', v_pack.sku,
      'from_package_id', case when v_has_sub then v_sub.package_id end,
      'from_status', case when v_has_sub then v_sub.status end,
      'period', v_period,
      'effective_at', v_effective,
      'minutes_included_before', v_tenant_minutes,
      'minutes_included_after', v_after,
      'note', nullif(trim(coalesce(p_note, '')), '')
    ));
  end if;

  assigned_tenant_id := p_tenant_id;
  assigned_package_id := p_package_id;
  assigned_period := v_period;
  change_kind := v_kind;
  effective_at := v_effective;
  minutes_included := v_after;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.attach_invoice_pay_checkout(p_attempt_id uuid, p_checkout_session_id text, p_checkout_url text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if nullif(btrim(p_checkout_session_id), '') is null or nullif(btrim(p_checkout_url), '') is null then
    raise exception 'checkout id and url are required';
  end if;
  if p_checkout_url !~ '^https://' then
    raise exception 'checkout url refused';
  end if;
  if p_expires_at is null then
    raise exception 'checkout expiry is required';
  end if;
  update public.payment_attempts
  set checkout_session_id = p_checkout_session_id,
      checkout_url = p_checkout_url,
      checkout_expires_at = p_expires_at,
      updated_at = now()
  where id = p_attempt_id
    and status = 'pending';
  if not found then
    raise exception 'pay attempt is not pending';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.billing_add_months(p_ts timestamp with time zone, p_months integer)
 RETURNS timestamp with time zone
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select ((p_ts at time zone 'Africa/Nairobi') + make_interval(months => p_months)) at time zone 'Africa/Nairobi';
$function$
;

CREATE OR REPLACE FUNCTION public.billing_audit_log_freeze()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- remove_business_and_release_did deletes the tenant. Cascade may remove
  -- status events. The audit table itself stays, and so does a direct delete.
  if tg_op = 'DELETE'
     and tg_table_name = 'subscription_events'
     and current_setting('scalers.billing_purge', true) = '1'
  then
    return old;
  end if;
  raise exception 'billing audit is append-only';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.billing_grant_minutes_for_period(p_tenant_id uuid, p_period_start timestamp with time zone, p_period_end timestamp with time zone)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Rule: a grant counts only in the billing period it was made in, so unused
  -- grant minutes expire at that period's end.
  -- To carry grants forward instead, widen this predicate (for example
  -- g.period_start < p_period_end and g.period_end > p_period_start - interval '1 month').
  select coalesce(sum(g.minutes), 0)::integer
  from public.tenant_minute_grants g
  where g.tenant_id = p_tenant_id
    and g.period_start >= p_period_start
    and (p_period_end is null or g.period_start < p_period_end);
$function$
;

CREATE OR REPLACE FUNCTION public.billing_latest_package_version(p_package_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select v.id
  from public.billing_package_versions v
  where v.package_id = p_package_id
    and v.status = 'published'
    and v.active_from <= now()
  order by v.active_from desc, v.version desc
  limit 1
$function$
;

CREATE OR REPLACE FUNCTION public.billing_live_tenant_allowed(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((
    select enabled
    from public.billing_live_tenants
    where tenant_id = p_tenant_id
  ), false);
$function$
;

CREATE OR REPLACE FUNCTION public.billing_notice_when(p_ts timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select to_char(p_ts at time zone 'Africa/Nairobi', 'DD Mon YYYY, HH24:MI') || ' EAT'
$function$
;

CREATE OR REPLACE FUNCTION public.billing_notices_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_delivery boolean := current_setting('scalers.billing_notice_delivery', true) = '1';
  v_read boolean := current_setting('scalers.billing_notice_read', true) = '1';
begin
  if tg_op = 'DELETE' then
    if current_setting('scalers.billing_purge', true) = '1' then
      return old;
    end if;
    raise exception 'billing notices are append-only';
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.kind is distinct from old.kind
     or new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.channel is distinct from old.channel
     or new.recipient is distinct from old.recipient
     or new.fallback is distinct from old.fallback
     or new.audience is distinct from old.audience
     or new.billed_to is distinct from old.billed_to
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at
  then
    raise exception 'billing notices are append-only';
  end if;
  if new.read_at is distinct from old.read_at and not v_read then
    raise exception 'read_at is owner mark-read only';
  end if;
  if (new.delivery_status is distinct from old.delivery_status
      or new.notify_send_id is distinct from old.notify_send_id
      or new.last_error is distinct from old.last_error
      or new.claimed_at is distinct from old.claimed_at)
     and not v_delivery
  then
    raise exception 'delivery fields are the sender only';
  end if;
  if v_read and not v_delivery then
    if new.delivery_status is distinct from old.delivery_status
       or new.notify_send_id is distinct from old.notify_send_id
       or new.last_error is distinct from old.last_error
       or new.claimed_at is distinct from old.claimed_at
    then
      raise exception 'mark-read cannot change delivery';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.billing_on_demand_open(p_tenant_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant public.tenants%rowtype;
  v_held timestamptz;
  v_start timestamptz;
  v_limit numeric;
  v_spent numeric;
begin
  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then
    return false;
  end if;
  if coalesce(v_tenant.billing_enforcement, 'off') = 'off' then
    return coalesce(v_tenant.on_demand_usage_enabled, false);
  end if;
  if not coalesce(v_tenant.on_demand_usage_enabled, false) then
    return false;
  end if;
  select spend_limit_held_period, current_period_start into v_held, v_start
  from public.tenant_subscriptions where tenant_id = p_tenant_id;
  if v_held is not null and v_start is not null and v_held = v_start then
    return false;
  end if;
  if v_tenant.spend_limit_blocked and v_held is not null and v_held = v_start then
    return false;
  end if;
  v_limit := public.billing_spend_limit_kes(p_tenant_id);
  if v_limit is null then
    return true;
  end if;
  v_spent := public.billing_period_on_demand_kes(p_tenant_id);
  if v_spent >= v_limit then
    return false;
  end if;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.billing_package_version_approvals_freeze()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'UPDATE' then
    raise exception 'package version approval is append-only';
  end if;
  if exists (
    select 1
    from public.billing_package_versions v
    where v.id = old.package_version_id
      and v.status <> 'draft'
  ) then
    raise exception 'package version approval is append-only';
  end if;
  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.billing_package_version_features_freeze()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_status text;
  v_version uuid;
begin
  v_version := case when tg_op = 'DELETE' then old.package_version_id else new.package_version_id end;
  select status into v_status
  from public.billing_package_versions
  where id = v_version;
  if v_status is null or v_status = 'draft' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' and exists (
    select 1
    from public.billing_package_version_features f
    where f.package_version_id = new.package_version_id
      and f.feature_key = new.feature_key
      and f.enabled = new.enabled
  ) then
    return new;
  end if;
  raise exception 'published package version is frozen';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.billing_package_versions_freeze()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if old.status = 'draft' then
    return new;
  end if;
  if new.package_id is distinct from old.package_id
     or new.version is distinct from old.version
     or new.monthly_price_kes is distinct from old.monthly_price_kes
     or new.seats is distinct from old.seats
     or new.minutes is distinct from old.minutes
     or new.sms is distinct from old.sms
     or new.email is distinct from old.email
     or new.staff_wa is distinct from old.staff_wa
     or new.dids is distinct from old.dids
     or new.inbound_kes_per_second is distinct from old.inbound_kes_per_second
     or new.outbound_kes_per_second is distinct from old.outbound_kes_per_second
     or new.whatsapp_kes is distinct from old.whatsapp_kes
     or new.sms_kes is distinct from old.sms_kes
     or new.email_kes is distinct from old.email_kes
     or new.annual_discount_percent is distinct from old.annual_discount_percent
     or new.annual_price_kes is distinct from old.annual_price_kes
     or new.credit_kes is distinct from old.credit_kes
     or new.spend_limit_share_percent is distinct from old.spend_limit_share_percent
     or (to_jsonb(new) -> 'extra_seat_monthly_kes') is distinct from (to_jsonb(old) -> 'extra_seat_monthly_kes')
     or new.trial_days is distinct from old.trial_days
     or new.allowances_placeholder is distinct from old.allowances_placeholder
     or new.active_from is distinct from old.active_from
     or new.published_at is distinct from old.published_at
     or new.created_at is distinct from old.created_at
     or new.copied_from_id is distinct from old.copied_from_id
     or new.promote_fingerprint is distinct from old.promote_fingerprint
     or new.notes is distinct from old.notes
     or new.price_set_by is distinct from old.price_set_by
     or new.message_credits is distinct from old.message_credits
     or new.sms_credit_burn is distinct from old.sms_credit_burn
     or new.whatsapp_credit_burn is distinct from old.whatsapp_credit_burn
     or new.email_credit_burn is distinct from old.email_credit_burn
     or new.on_demand_allowed is distinct from old.on_demand_allowed
  then
    raise exception 'published package version is frozen';
  end if;
  if old.status = 'published' and new.status = 'retired' then
    return new;
  end if;
  if old.status = new.status and new.retired_at is not distinct from old.retired_at then
    return new;
  end if;
  raise exception 'package version status can only move from published to retired';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.billing_package_versions_freeze_seat()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if old.status = 'draft' then
    return new;
  end if;
  if new.extra_seat_monthly_kes is distinct from old.extra_seat_monthly_kes then
    raise exception 'published package version is frozen';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.billing_payment_reconciliation()
 RETURNS TABLE(kind text, attempt_id uuid, invoice_id uuid, payment_id uuid, detail text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    'pending_timeout'::text,
    a.id,
    a.invoice_id,
    null::uuid,
    'Pending for more than 30 minutes'::text
  from public.payment_attempts a
  where a.status = 'pending'
    and a.created_at < now() - interval '30 minutes'
  union all
  select
    'status_disagreement',
    a.id,
    a.invoice_id,
    null::uuid,
    'Attempt succeeded with no payment'
  from public.payment_attempts a
  where a.status = 'succeeded'
    and a.checkout_session_id is not null
    and not exists (
      select 1 from public.payments p
      where p.provider_ref = a.checkout_session_id
         or p.bill_ref = a.checkout_session_id
    )
  union all
  select
    'status_disagreement',
    a.id,
    a.invoice_id,
    p.id,
    'Payment recorded while the attempt is still pending'
  from public.payment_attempts a
  join public.payments p
    on p.provider_ref = a.checkout_session_id
    or p.bill_ref = a.checkout_session_id
  where a.status = 'pending'
    and a.checkout_session_id is not null
  union all
  select
    'status_disagreement',
    null::uuid,
    i.id,
    null::uuid,
    'Invoice paid without a matched payment'
  from public.invoices i
  where i.status = 'paid'
    and i.total_kes > 0
    and not exists (
      select 1 from public.payments p
      where p.invoice_id = i.id
        and p.match_status in ('matched', 'partial', 'over')
    )
    and not exists (
      select 1 from public.tenant_credits c
      where c.idempotency_key = 'invoice-credit:' || i.id::text
    )
  union all
  select
    'status_disagreement',
    null::uuid,
    i.id,
    null::uuid,
    'Invoice open but the amount paid covers the total'
  from public.invoices i
  where i.status = 'open'
    and i.total_kes > 0
    and i.amount_paid_kes >= i.total_kes
  union all
  select
    'issue',
    a.id,
    a.invoice_id,
    p.id,
    'Payment needs a check'
  from public.payment_attempts a
  left join public.payments p on p.provider_ref = a.checkout_session_id
  where a.status = 'issue'
  union all
  select
    'issue',
    null::uuid,
    p.invoice_id,
    p.id,
    'Payment needs a check'
  from public.payments p
  where p.match_status = 'issue'
    and not exists (
      select 1 from public.payment_attempts a
      where a.status = 'issue'
        and a.checkout_session_id = p.provider_ref
    )
  union all
  select
    'overpaid',
    a.id,
    a.invoice_id,
    p.id,
    'Payer sent more than the checkout'
  from public.payment_attempts a
  join public.payments p
    on p.provider_ref = a.checkout_session_id
  where lower(coalesce(p.raw #>> '{data,status}', '')) = 'overpaid'
  union all
  select
    'credited_cancelled',
    a.id,
    a.invoice_id,
    p.id,
    'Collected on a cancelled checkout and credited'
  from public.payment_attempts a
  join public.payments p
    on p.provider = a.provider
   and p.provider_ref = a.checkout_session_id
  join public.tenant_credits c
    on c.idempotency_key = 'cancelled:' || p.provider || ':' || p.provider_ref
  where a.status in ('cancelled', 'superseded', 'failed', 'pending_unattached')
  union all
  select
    'status_disagreement',
    a.id,
    a.invoice_id,
    p.id,
    'Collected on a cancelled checkout with no credit'
  from public.payment_attempts a
  join public.payments p
    on p.provider = a.provider
   and p.provider_ref = a.checkout_session_id
  where a.status in ('cancelled', 'superseded', 'failed', 'pending_unattached')
    and p.match_status = 'issue'
    and p.amount_kes > 0
    and not exists (
      select 1 from public.tenant_credits c
      where c.idempotency_key = 'cancelled:' || p.provider || ':' || p.provider_ref
    );
$function$
;

CREATE OR REPLACE FUNCTION public.billing_period_days(p_start timestamp with time zone, p_end timestamp with time zone, p_now timestamp with time zone)
 RETURNS TABLE(days_in_period integer, days_left integer)
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v_start date;
  v_end date;
  v_today date;
  v_days integer;
  v_left integer;
begin
  if p_start is null or p_end is null then
    days_in_period := 1;
    days_left := 0;
    return next;
    return;
  end if;
  v_start := (p_start at time zone 'Africa/Nairobi')::date;
  v_end := (p_end at time zone 'Africa/Nairobi')::date;
  v_today := (coalesce(p_now, now()) at time zone 'Africa/Nairobi')::date;
  v_days := v_end - v_start;
  if v_days < 1 then
    days_in_period := 1;
    days_left := 0;
    return next;
    return;
  end if;
  v_left := v_end - v_today;
  if v_left < 0 then
    v_left := 0;
  elsif v_left > v_days then
    v_left := v_days;
  end if;
  days_in_period := v_days;
  days_left := v_left;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.billing_period_on_demand_kes(p_tenant_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_sum numeric;
begin
  if to_regclass('public.wallet_ledger') is null then
    return 0;
  end if;
  select s.current_period_start, s.current_period_end
    into v_start, v_end
  from public.tenant_subscriptions s
  where s.tenant_id = p_tenant_id;
  select coalesce(sum(-wl.amount_kes), 0) into v_sum
  from public.wallet_ledger wl
  where wl.tenant_id = p_tenant_id
    and wl.amount_kes < 0
    and wl.kind in ('call_charge', 'sms_charge')
    and coalesce(wl.metadata->>'on_demand', '') = 'true'
    and (v_start is null or wl.created_at >= v_start)
    and (v_end is null or wl.created_at < v_end);
  return coalesce(v_sum, 0);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.billing_prorate_kes(p_price_kes numeric, p_days_left integer, p_days_in_period integer)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when coalesce(p_price_kes, 0) <= 0 or coalesce(p_days_in_period, 0) <= 0 or coalesce(p_days_left, 0) <= 0
      then 0
    else round(
      p_price_kes * least(p_days_left, p_days_in_period)::numeric / p_days_in_period::numeric,
      0
    )
  end
$function$
;

CREATE OR REPLACE FUNCTION public.billing_proration_quote(p_current_price_kes numeric, p_new_price_kes numeric, p_start timestamp with time zone, p_end timestamp with time zone, p_now timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_days integer;
  v_left integer;
  v_credit numeric;
  v_charge numeric;
begin
  select d.days_in_period, d.days_left into v_days, v_left
  from public.billing_period_days(p_start, p_end, p_now) d;
  v_credit := public.billing_prorate_kes(p_current_price_kes, v_left, v_days);
  v_charge := public.billing_prorate_kes(p_new_price_kes, v_left, v_days);
  return jsonb_build_object(
    'credit_kes', v_credit,
    'charge_kes', v_charge,
    'total_kes', greatest(v_charge - v_credit, 0),
    'days_left', v_left,
    'days_in_period', v_days
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.billing_quarantine_placeholder_days()
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$ select 30 $function$
;

CREATE OR REPLACE FUNCTION public.billing_seats_used(p_tenant uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_n integer;
begin
  if to_regprocedure('public.tenant_seats_used(uuid)') is not null then
    execute 'select public.tenant_seats_used($1)' into v_n using p_tenant;
    return coalesce(v_n, 0);
  end if;
  if to_regclass('public.tenant_invites') is null then
    select count(*)::integer into v_n from public.tenant_members where tenant_id = p_tenant;
    return coalesce(v_n, 0);
  end if;
  select (
    (select count(*) from public.tenant_members where tenant_id = p_tenant)
    + (select count(*) from public.tenant_invites
        where tenant_id = p_tenant and status = 'pending' and expires_at > now())
  )::integer into v_n;
  return coalesce(v_n, 0);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.billing_spend_allows_charge(p_tenant_id uuid, p_amount numeric)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant public.tenants%rowtype;
  v_limit numeric;
  v_spent numeric;
begin
  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then
    return false;
  end if;
  if coalesce(v_tenant.billing_enforcement, 'off') = 'off' then
    return true;
  end if;
  if coalesce(p_amount, 0) <= 0 then
    return true;
  end if;
  if not public.billing_on_demand_open(p_tenant_id) then
    if coalesce(v_tenant.on_demand_usage_enabled, false) then
      perform public._billing_mark_spend_blocked(p_tenant_id);
    end if;
    return false;
  end if;
  v_limit := public.billing_spend_limit_kes(p_tenant_id);
  if v_limit is null then
    return true;
  end if;
  v_spent := public.billing_period_on_demand_kes(p_tenant_id);
  if v_spent + p_amount > v_limit then
    perform public._billing_mark_spend_blocked(p_tenant_id);
    return false;
  end if;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.billing_spend_limit_kes(p_tenant_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant public.tenants%rowtype;
  v_monthly numeric;
  v_share numeric := 50;
begin
  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then
    return null;
  end if;
  if coalesce(v_tenant.billing_enforcement, 'off') = 'off' then
    return null;
  end if;
  if exists (
    select 1 from public.tenant_subscriptions s
    where s.tenant_id = p_tenant_id and s.billing_status = 'beta'
  ) then
    return null;
  end if;
  if v_tenant.soft_spend_limit_kes is not null then
    return round(v_tenant.soft_spend_limit_kes, 0);
  end if;
  if exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.billing_package_versions'::regclass
      and attname = 'spend_limit_share_percent'
      and attnum > 0
      and not attisdropped
  ) then
    execute
      'select v.monthly_price_kes, v.spend_limit_share_percent
         from public.tenant_subscriptions s
         join public.billing_package_versions v on v.id = s.package_version_id
        where s.tenant_id = $1'
      into v_monthly, v_share
      using p_tenant_id;
    v_share := coalesce(v_share, 50);
  else
    select v.monthly_price_kes into v_monthly
    from public.tenant_subscriptions s
    join public.billing_package_versions v on v.id = s.package_version_id
    where s.tenant_id = p_tenant_id;
  end if;
  if v_monthly is null then
    return null;
  end if;
  return round(v_monthly * v_share / 100, 0);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.billing_version_price_kes(p_version_id uuid, p_period text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.billing_package_versions%rowtype;
  v_period text := lower(trim(coalesce(p_period, 'month')));
begin
  select * into v from public.billing_package_versions where id = p_version_id;
  if not found then
    return null;
  end if;
  if v_period = 'year' then
    return round(v.monthly_price_kes * 12 * (100 - v.annual_discount_percent) / 100, 0);
  end if;
  return round(v.monthly_price_kes, 0);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.charge_call_to_wallet(p_call_id uuid, p_minutes numeric, p_rate_kes_per_min numeric DEFAULT 15)
 RETURNS TABLE(charged boolean, amount_kes numeric, wallet_balance_kes numeric, already_applied boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_call record;
  v_minutes numeric;
  v_rate numeric;
  v_amount numeric;
  v_row record;
  v_enforcement text;
  v_balance numeric;
  v_ondemand boolean;
begin
  if p_call_id is null then
    raise exception 'call_id required';
  end if;

  select
    c.id,
    c.tenant_id,
    c.duration_seconds,
    c.ai_processing_minutes,
    t.billing_enforcement,
    coalesce(t.wallet_balance_kes, 0) as wallet_balance_kes,
    coalesce(t.on_demand_usage_enabled, false) as on_demand_usage_enabled
    into v_call
  from public.calls c
  join public.tenants t on t.id = c.tenant_id
  where c.id = p_call_id;

  if not found then
    raise exception 'call not found';
  end if;

  v_enforcement := coalesce(v_call.billing_enforcement, 'soft');
  v_balance := coalesce(v_call.wallet_balance_kes, 0);
  v_ondemand := coalesce(v_call.on_demand_usage_enabled, false);

  if v_enforcement = 'off' then
    charged := false;
    amount_kes := 0;
    wallet_balance_kes := v_balance;
    already_applied := false;
    return next;
    return;
  end if;

  if v_balance <= 0 and not v_ondemand then
    charged := false;
    amount_kes := 0;
    wallet_balance_kes := v_balance;
    already_applied := false;
    return next;
    return;
  end if;

  v_minutes := coalesce(p_minutes, v_call.ai_processing_minutes, 0);
  if v_minutes is null or v_minutes <= 0 then
    charged := false;
    amount_kes := 0;
    wallet_balance_kes := v_balance;
    already_applied := false;
    return next;
    return;
  end if;

  v_rate := coalesce(p_rate_kes_per_min, 15);
  if v_rate < 0 then
    raise exception 'rate must be >= 0';
  end if;

  v_amount := round(v_minutes * v_rate);
  if v_amount <= 0 then
    charged := false;
    amount_kes := 0;
    wallet_balance_kes := v_balance;
    already_applied := false;
    return next;
    return;
  end if;

  select *
    into v_row
  from public._wallet_apply_delta(
    v_call.tenant_id,
    'call_charge',
    -v_amount,
    'call',
    p_call_id::text,
    'Receptionist minutes',
    jsonb_build_object(
      'minutes', v_minutes,
      'rate_kes_per_min', v_rate,
      'duration_seconds', v_call.duration_seconds,
      'on_demand', (v_balance <= 0 and v_ondemand)
    )
  );

  charged := not v_row.already_applied;
  amount_kes := v_amount;
  wallet_balance_kes := v_row.wallet_balance_kes;
  already_applied := v_row.already_applied;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_billing_notices(p_limit integer DEFAULT 20)
 RETURNS SETOF billing_notices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    p_limit := 20;
  end if;
  perform set_config('scalers.billing_notice_delivery', '1', true);
  return query
  update public.billing_notices n
  set delivery_status = 'sending',
      claimed_at = now()
  where n.id in (
    select id
    from public.billing_notices
    where delivery_status = 'pending'
       or (
         delivery_status = 'sending'
         and (claimed_at is null or claimed_at < now() - interval '15 minutes')
       )
    order by created_at
    for update skip locked
    limit p_limit
  )
  returning n.*;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.claim_wallet_balance_alerts(p_tenant_id uuid)
 RETURNS TABLE(should_alert_low boolean, should_alert_empty boolean, wallet_balance_kes numeric, low_threshold_kes numeric, on_demand_usage_enabled boolean, billing_enforcement text, business_name text, whatsapp_notification_number text, alert_email text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant record;
  v_balance numeric;
  v_low numeric;
  v_alert_low boolean := false;
  v_alert_empty boolean := false;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;

  select
    t.id,
    t.business_name,
    t.whatsapp_notification_number,
    t.alert_email,
    coalesce(t.billing_enforcement, 'off') as billing_enforcement,
    coalesce(t.wallet_balance_kes, 0) as wallet_balance_kes,
    coalesce(t.wallet_low_balance_kes, 200) as wallet_low_balance_kes,
    coalesce(t.on_demand_usage_enabled, false) as on_demand_usage_enabled,
    t.wallet_low_alert_sent_at,
    t.wallet_empty_alert_sent_at
  into v_tenant
  from public.tenants t
  where t.id = p_tenant_id
  for update;

  if not found then
    raise exception 'tenant not found';
  end if;

  v_balance := coalesce(v_tenant.wallet_balance_kes, 0);
  v_low := greatest(coalesce(v_tenant.wallet_low_balance_kes, 200), 0);

  if v_tenant.billing_enforcement = 'off' then
    should_alert_low := false;
    should_alert_empty := false;
    wallet_balance_kes := v_balance;
    low_threshold_kes := v_low;
    on_demand_usage_enabled := v_tenant.on_demand_usage_enabled;
    billing_enforcement := v_tenant.billing_enforcement;
    business_name := v_tenant.business_name;
    whatsapp_notification_number := v_tenant.whatsapp_notification_number;
    alert_email := v_tenant.alert_email;
    return next;
    return;
  end if;

  perform set_config('scalers.wallet_write', '1', true);

  if v_balance >= v_low and v_tenant.wallet_low_alert_sent_at is not null then
    update public.tenants set wallet_low_alert_sent_at = null where id = p_tenant_id;
    v_tenant.wallet_low_alert_sent_at := null;
  end if;

  if v_balance > 0 and v_tenant.wallet_empty_alert_sent_at is not null then
    update public.tenants set wallet_empty_alert_sent_at = null where id = p_tenant_id;
    v_tenant.wallet_empty_alert_sent_at := null;
  end if;

  if v_balance <= 0 and v_tenant.wallet_empty_alert_sent_at is null then
    update public.tenants set wallet_empty_alert_sent_at = now() where id = p_tenant_id;
    v_alert_empty := true;
  elsif v_balance > 0 and v_balance < v_low and v_tenant.wallet_low_alert_sent_at is null then
    update public.tenants set wallet_low_alert_sent_at = now() where id = p_tenant_id;
    v_alert_low := true;
  end if;

  should_alert_low := v_alert_low;
  should_alert_empty := v_alert_empty;
  wallet_balance_kes := v_balance;
  low_threshold_kes := v_low;
  on_demand_usage_enabled := v_tenant.on_demand_usage_enabled;
  billing_enforcement := v_tenant.billing_enforcement;
  business_name := v_tenant.business_name;
  whatsapp_notification_number := v_tenant.whatsapp_notification_number;
  alert_email := v_tenant.alert_email;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clear_payment_event_retry(p_provider text, p_event_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_event_key), '') is null then
    raise exception 'provider and event key are required';
  end if;
  update public.payment_events
  set needs_retry = false
  where provider = p_provider
    and event_key = p_event_key;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_invoice_pay_attempt(p_token text, p_amount_kes numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_lookup jsonb;
  v_invoice uuid;
  v_tenant uuid;
  v_part record;
  v_existing public.payment_attempts%rowtype;
  v_row public.payment_attempts%rowtype;
  v_inv_lock public.invoices%rowtype;
  v_return text;
begin
  v_lookup := public.pay_invoice_by_token(p_token);
  if coalesce((v_lookup->>'found')::boolean, false) is not true
     or v_lookup->>'state' is distinct from 'payable' then
    raise exception 'invoice cannot be paid';
  end if;
  v_invoice := (v_lookup->>'invoice_id')::uuid;
  v_tenant := (v_lookup->>'tenant_id')::uuid;

  select * into v_inv_lock from public.invoices where id = v_invoice for update;
  if not found then
    raise exception 'invoice not found';
  end if;

  select * into v_part
  from public.invoice_next_pay_part(
    (v_lookup->>'total_kes')::numeric,
    (v_lookup->>'amount_paid_kes')::numeric
  );
  if v_part.part_index is null then
    raise exception 'invoice has nothing left to pay';
  end if;
  if round(p_amount_kes * 100) is distinct from round(v_part.amount_kes * 100) then
    raise exception 'pay amount does not match the next part';
  end if;
  if v_part.amount_kes > 150000 then
    raise exception 'part is above the M-Pesa limit';
  end if;

  select * into v_existing
  from public.payment_attempts
  where invoice_id = v_invoice
    and status in ('pending', 'pending_unattached')
    and part_index = v_part.part_index
  order by created_at desc
  limit 1;
  if found then
    if v_existing.status = 'pending_unattached' then
      return jsonb_build_object(
        'id', v_existing.id,
        'checkout_session_id', v_existing.checkout_session_id,
        'checkout_url', v_existing.checkout_url,
        'amount_kes', v_existing.amount_kes,
        'part_index', v_existing.part_index,
        'part_count', v_existing.part_count,
        'return_id', v_existing.return_id,
        'reused', false,
        'in_flight', false,
        'cancel', false,
        'unattached', true,
        'held', false
      );
    end if;
    if v_existing.checkout_expires_at is not null and v_existing.checkout_expires_at <= now() then
      return jsonb_build_object(
        'id', v_existing.id,
        'checkout_session_id', v_existing.checkout_session_id,
        'checkout_url', v_existing.checkout_url,
        'amount_kes', v_existing.amount_kes,
        'part_index', v_existing.part_index,
        'part_count', v_existing.part_count,
        'return_id', v_existing.return_id,
        'reused', false,
        'in_flight', false,
        'cancel', true,
        'unattached', false,
        'held', false
      );
    end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'checkout_session_id', v_existing.checkout_session_id,
      'checkout_url', v_existing.checkout_url,
      'amount_kes', v_existing.amount_kes,
      'part_index', v_existing.part_index,
      'part_count', v_existing.part_count,
      'return_id', v_existing.return_id,
      'reused', true,
      'in_flight', v_existing.checkout_url is null or v_existing.checkout_session_id is null,
      'cancel', false,
      'unattached', false,
      'held', false
    );
  end if;

  select * into v_existing
  from public.payment_attempts
  where invoice_id = v_invoice
    and status = 'succeeded'
    and part_index = v_part.part_index
    and nullif(btrim(checkout_session_id), '') is not null
    and checkout_closed_at is null
  order by created_at desc
  limit 1;
  if found then
    return jsonb_build_object(
      'id', v_existing.id,
      'checkout_session_id', v_existing.checkout_session_id,
      'checkout_url', v_existing.checkout_url,
      'amount_kes', v_existing.amount_kes,
      'part_index', v_existing.part_index,
      'part_count', v_existing.part_count,
      'return_id', v_existing.return_id,
      'reused', false,
      'in_flight', false,
      'cancel', false,
      'unattached', false,
      'held', true
    );
  end if;

  if exists (
    select 1
    from public.payments
    where invoice_id = v_invoice
      and match_status = 'issue'
      and provider_ref like 'checkout-total-review:%'
      and coalesce(raw->>'review_status', 'open') is distinct from 'resolved'
  ) then
    raise exception 'checkout total needs review';
  end if;

  v_return := 'ret_' || rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.payment_attempts (
    tenant_id, invoice_id, provider, status, amount_kes, currency, part_index, part_count,
    return_id, return_expires_at, client_reference
  ) values (
    v_tenant, v_invoice, 'bachs', 'pending', v_part.amount_kes, 'KES', v_part.part_index, v_part.part_count,
    v_return, now() + interval '24 hours', null
  )
  returning * into v_row;

  update public.payment_attempts
  set client_reference = v_row.id::text
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'checkout_session_id', v_row.checkout_session_id,
    'checkout_url', v_row.checkout_url,
    'amount_kes', v_row.amount_kes,
    'part_index', v_row.part_index,
    'part_count', v_row.part_count,
    'return_id', v_row.return_id,
    'reused', false,
    'in_flight', false,
    'cancel', false,
    'unattached', false,
    'held', false
  );
exception
  when unique_violation then
    select * into v_existing
    from public.payment_attempts
    where invoice_id = v_invoice
      and status in ('pending', 'pending_unattached')
      and part_index = v_part.part_index
    order by created_at desc
    limit 1;
    if not found then
      raise;
    end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'checkout_session_id', v_existing.checkout_session_id,
      'checkout_url', v_existing.checkout_url,
      'amount_kes', v_existing.amount_kes,
      'part_index', v_existing.part_index,
      'part_count', v_existing.part_count,
      'return_id', v_existing.return_id,
      'reused', v_existing.status = 'pending',
      'in_flight', v_existing.status = 'pending' and (v_existing.checkout_url is null or v_existing.checkout_session_id is null),
      'cancel', false,
      'unattached', v_existing.status = 'pending_unattached',
      'held', false
    );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.credit_cancelled_collection(p_provider text, p_provider_ref text, p_amount_kes numeric, p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key text;
  v_id uuid;
  v_payment uuid;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_provider_ref), '') is null then
    raise exception 'provider and provider ref are required';
  end if;
  if p_amount_kes is null or p_amount_kes <= 0 then
    raise exception 'payment amount must be positive';
  end if;
  v_key := 'cancelled:' || p_provider || ':' || p_provider_ref;
  select id into v_payment
  from public.payments
  where provider = p_provider and provider_ref = p_provider_ref;
  insert into public.tenant_credits (tenant_id, amount_kes, reason, idempotency_key, payment_id)
  values (p_tenant_id, p_amount_kes, 'cancelled_checkout', v_key, v_payment)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    return;
  end if;
  perform public._billing_audit(
    'system',
    'cancelled_checkout_credit',
    p_tenant_id,
    jsonb_build_object(
      'provider', p_provider,
      'provider_ref', p_provider_ref,
      'amount_kes', p_amount_kes,
      'credit_id', v_id
    )
  );
  if to_regclass('public.platform_ops_notices') is not null then
    begin
      insert into public.platform_ops_notices (kind, detail)
      values (
        'cancelled_checkout:' || p_provider || ':' || p_provider_ref,
        'Collected KSh ' || trim(to_char(p_amount_kes, 'FM999999990.00'))
          || ' on a cancelled checkout. Credited.'
      );
    exception
      when unique_violation then
        null;
    end;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.credit_checkout_extra(p_provider text, p_provider_ref text, p_amount_kes numeric, p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key text;
  v_id uuid;
  v_payment uuid;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_provider_ref), '') is null then
    raise exception 'provider and provider ref are required';
  end if;
  if p_amount_kes is null or p_amount_kes <= 0 then
    raise exception 'payment amount must be positive';
  end if;
  v_key := 'checkout-extra:' || p_provider || ':' || p_provider_ref;
  select id into v_payment
  from public.payments
  where provider = p_provider and provider_ref = p_provider_ref and match_status is distinct from 'issue';
  insert into public.tenant_credits (tenant_id, amount_kes, reason, idempotency_key, payment_id)
  values (p_tenant_id, p_amount_kes, 'checkout_extra', v_key, v_payment)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  if v_id is null then
    return;
  end if;
  perform public._billing_audit(
    'system',
    'checkout_extra_credit',
    p_tenant_id,
    jsonb_build_object(
      'provider', p_provider,
      'provider_ref', p_provider_ref,
      'amount_kes', p_amount_kes,
      'credit_id', v_id
    )
  );
  if to_regclass('public.platform_ops_notices') is not null then
    begin
      insert into public.platform_ops_notices (kind, detail)
      values (
        'checkout_extra:' || p_provider || ':' || p_provider_ref,
        'Collected an extra KSh ' || trim(to_char(p_amount_kes, 'FM999999990.00'))
          || ' on an open checkout. Credited.'
      );
    exception
      when unique_violation then
        null;
    end;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_billing_notice(p_tenant_id uuid, p_kind text, p_idempotency_key text, p_title text DEFAULT NULL::text, p_body text DEFAULT NULL::text)
 RETURNS billing_notices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant public.tenants%rowtype;
  v_channels jsonb;
  v_sms boolean;
  v_wa boolean;
  v_email_on boolean;
  v_phone text;
  v_email text;
  v_channel text;
  v_recipient text;
  v_status text;
  v_error text;
  v_title text;
  v_body text;
  v_row public.billing_notices%rowtype;
begin
  if p_tenant_id is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'tenant and idempotency key are required';
  end if;
  if p_kind not in (
    'platform_billing_trial_ending',
    'platform_billing_trial_ended',
    'platform_billing_invoice_due',
    'platform_billing_past_due',
    'platform_billing_suspended',
    'platform_billing_invoice_issued',
    'platform_billing_invoice_due_soon',
    'platform_billing_payment_received',
    'platform_billing_invoice_overdue'
  ) then
    raise exception 'unknown billing notice kind';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then
    raise exception 'business not found';
  end if;

  v_title := nullif(btrim(p_title), '');
  v_body := nullif(btrim(p_body), '');
  if p_kind = 'platform_billing_trial_ending' and v_title is null then
    v_title := 'Trial ending';
    v_body := 'Your Business Assistant trial is ending soon. The line stays on until the trial ends.';
  end if;
  if v_title is null or v_body is null then
    raise exception 'notice title and body are required';
  end if;

  v_channels := coalesce(v_tenant.notify_channels, '{"sms":true,"whatsapp":true,"email":true}'::jsonb);
  v_sms := coalesce((v_channels->>'sms')::boolean, true);
  v_wa := coalesce((v_channels->>'whatsapp')::boolean, true);
  v_email_on := coalesce((v_channels->>'email')::boolean, true);
  if not v_sms and not v_wa and not v_email_on then
    v_sms := true;
  end if;

  v_phone := nullif(btrim(v_tenant.whatsapp_notification_number), '');
  if v_phone like 'pending:%' then
    v_phone := null;
  end if;
  v_email := nullif(btrim(v_tenant.alert_email), '');

  v_channel := null;
  v_recipient := null;
  v_status := 'pending';
  v_error := null;
  -- Invoice mail prefers email. Other notices keep SMS, then WhatsApp, then email.
  if p_kind in (
    'platform_billing_invoice_issued',
    'platform_billing_invoice_due_soon',
    'platform_billing_payment_received',
    'platform_billing_invoice_overdue'
  ) and v_email_on and v_email is not null then
    v_channel := 'email';
    v_recipient := v_email;
  elsif v_sms and v_phone is not null then
    v_channel := 'sms';
    v_recipient := v_phone;
  elsif v_wa and v_phone is not null then
    v_channel := 'whatsapp';
    v_recipient := v_phone;
  elsif v_email_on and v_email is not null then
    v_channel := 'email';
    v_recipient := v_email;
  else
    v_status := 'skipped';
    v_error := 'no recipient';
  end if;

  insert into public.billing_notices (
    tenant_id, kind, title, body, channel, recipient, fallback,
    audience, billed_to, delivery_status, idempotency_key, last_error
  ) values (
    p_tenant_id, p_kind, v_title, v_body, v_channel, v_recipient,
    jsonb_build_object(
      'order', jsonb_build_array('sms', 'whatsapp', 'email'),
      'sms', v_phone,
      'whatsapp', v_phone,
      'email', v_email
    ),
    'staff', 'platform', v_status, p_idempotency_key, v_error
  )
  on conflict (tenant_id, idempotency_key) do nothing;

  select * into v_row
  from public.billing_notices
  where tenant_id = p_tenant_id and idempotency_key = p_idempotency_key;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_invoice_due_soon(p_invoice_id uuid)
 RETURNS billing_notices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inv public.invoices%rowtype;
  v_body text;
begin
  select * into v_inv from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status <> 'open' then
    raise exception 'only an open invoice can be reminded';
  end if;
  if v_inv.reminders_paused_at is not null then
    raise exception 'reminders paused (disputed)';
  end if;
  v_body := 'Your Business Assistant invoice ' || coalesce(v_inv.invoice_number, '')
    || ' for KSh ' || trim(to_char(v_inv.total_kes, 'FM999999990.00')) || ' is due soon.';
  return public.enqueue_billing_notice(
    v_inv.tenant_id,
    'platform_billing_invoice_due_soon',
    'platform_billing_invoice_due_soon:' || v_inv.id::text,
    'Invoice due soon',
    v_body
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enqueue_invoice_overdue(p_invoice_id uuid)
 RETURNS billing_notices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inv public.invoices%rowtype;
  v_body text;
begin
  select * into v_inv from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status <> 'open' then
    raise exception 'only an open invoice can be reminded';
  end if;
  if v_inv.reminders_paused_at is not null then
    raise exception 'reminders paused (disputed)';
  end if;
  v_body := 'Your Business Assistant invoice ' || coalesce(v_inv.invoice_number, '')
    || ' for KSh ' || trim(to_char(v_inv.total_kes, 'FM999999990.00')) || ' is overdue.';
  return public.enqueue_billing_notice(
    v_inv.tenant_id,
    'platform_billing_invoice_overdue',
    'platform_billing_invoice_overdue:' || v_inv.id::text,
    'Invoice overdue',
    v_body
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.finalize_invoice(p_invoice_id uuid)
 RETURNS invoices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inv public.invoices%rowtype;
  v_co public.billing_company%rowtype;
  v_year integer;
  v_n integer;
  v_number text;
  v_body text;
  v_credit boolean;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status <> 'draft' then
    raise exception 'only a draft invoice can be finalized';
  end if;
  if exists (
    select 1 from public.tenant_subscriptions s
    where s.tenant_id = v_inv.tenant_id
      and s.billing_status = 'beta'
  ) then
    raise exception 'beta tenants have no pay link';
  end if;

  select * into v_co from public.billing_company where id = 1;
  if not found then
    raise exception 'billing company is not set';
  end if;
  if nullif(btrim(v_co.legal_name), '') is null then
    raise exception 'billing company is not set';
  end if;

  v_credit := coalesce(v_inv.total_kes, 0) < 0;
  if v_credit then
    insert into public.tenant_credits (tenant_id, amount_kes, reason, idempotency_key)
    values (
      v_inv.tenant_id,
      -v_inv.total_kes,
      'invoice_credit',
      'invoice-credit:' || v_inv.id::text
    )
    on conflict (idempotency_key) do nothing;
  end if;

  v_year := extract(year from (now() at time zone 'Africa/Nairobi'))::integer;
  insert into public.billing_invoice_counters (year, last_number)
  values (v_year, 0)
  on conflict (year) do nothing;
  update public.billing_invoice_counters
  set last_number = last_number + 1
  where year = v_year
  returning last_number into v_n;
  v_number := 'SCL-' || v_year::text || '-' || lpad(v_n::text, 6, '0');

  perform set_config('scalers.billing_write', '1', true);
  update public.invoices
  set status = case when v_credit then 'paid' else 'open' end,
      invoice_number = v_number,
      issued_at = coalesce(issued_at, now()),
      subtotal_kes = case when v_credit then 0 else subtotal_kes end,
      total_kes = case when v_credit then 0 else total_kes end,
      paid_at = case when v_credit then coalesce(paid_at, now()) else paid_at end,
      issuer_legal_name = nullif(btrim(v_co.legal_name), ''),
      issuer_product = coalesce(nullif(btrim(v_co.product), ''), 'Business Assistant'),
      issuer_phone = nullif(btrim(v_co.phone), ''),
      issuer_email = nullif(btrim(v_co.email), ''),
      issuer_address = nullif(btrim(v_co.address), ''),
      issuer_city = nullif(btrim(v_co.city), ''),
      issuer_kra_pin = nullif(btrim(v_co.kra_pin), ''),
      updated_at = now()
  where id = p_invoice_id
  returning * into v_inv;
  perform set_config('scalers.billing_write', '', true);

  if not found then
    raise exception 'invoice not found';
  end if;

  if not v_credit then
    v_body := 'Your Business Assistant invoice ' || v_number
      || ' for KSh ' || trim(to_char(v_inv.total_kes, 'FM999999990.00')) || ' is ready.';
    perform public.enqueue_billing_notice(
      v_inv.tenant_id,
      'platform_billing_invoice_issued',
      'platform_billing_invoice_issued:' || v_inv.id::text,
      'Invoice ' || v_number,
      v_body
    );
  end if;
  return v_inv;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.grant_tenant_package_minutes(p_tenant_id uuid, p_minutes integer, p_note text, p_actor text DEFAULT 'ops'::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS TABLE(tenant_id uuid, minutes_included integer, minutes_granted integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_actor text := coalesce(nullif(trim(p_actor), ''), 'ops');
  v_note text := trim(coalesce(p_note, ''));
  v_minutes integer := coalesce(p_minutes, 0);
  v_key text := nullif(trim(p_idempotency_key), '');
  v_after integer;
  v_start timestamptz;
  v_end timestamptz;
  v_grant_id uuid;
begin
  if p_tenant_id is null then
    raise exception 'tenant required';
  end if;
  if v_minutes <= 0 or v_minutes > 100000 then
    raise exception 'minutes must be between 1 and 100000';
  end if;
  if length(v_note) < 3 then
    raise exception 'note required (min 3 chars)';
  end if;

  -- Lock the tenant so concurrent grants (double click, retry) serialize.
  select t.minutes_included into v_after
  from public.tenants t
  where t.id = p_tenant_id
  for update;
  if not found then
    raise exception 'tenant not found';
  end if;

  select s.current_period_start, s.current_period_end
    into v_start, v_end
  from public.tenant_subscriptions s
  where s.tenant_id = p_tenant_id;
  if v_start is null then
    v_start := date_trunc('month', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi';
    v_end := (date_trunc('month', now() at time zone 'Africa/Nairobi') + interval '1 month') at time zone 'Africa/Nairobi';
  end if;

  insert into public.tenant_minute_grants as g
    (tenant_id, minutes, period_start, period_end, note, actor, idempotency_key)
  values (p_tenant_id, v_minutes, v_start, v_end, v_note, v_actor, v_key)
  on conflict on constraint tenant_minute_grants_tenant_key_uniq do nothing
  returning g.id into v_grant_id;

  if v_grant_id is null then
    -- Replay of an idempotency key already used for this tenant.
    tenant_id := p_tenant_id;
    minutes_included := coalesce(v_after, 0);
    minutes_granted := 0;
    return next;
    return;
  end if;

  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants as t
    set minutes_included = coalesce(t.minutes_included, 0) + v_minutes
  where t.id = p_tenant_id
  returning t.minutes_included into v_after;
  perform set_config('scalers.wallet_write', '', true);

  insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
  values (
    v_actor,
    'grant_package_minutes',
    p_tenant_id,
    null,
    jsonb_build_object(
      'grant_id', v_grant_id,
      'note', v_note,
      'minutes_granted', v_minutes,
      'minutes_included_after', v_after,
      'period_start', v_start,
      'period_end', v_end,
      'idempotency_key', v_key
    )
  );

  tenant_id := p_tenant_id;
  minutes_included := v_after;
  minutes_granted := v_minutes;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.invoice_kes_parts(p_total numeric)
 RETURNS numeric[]
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_cents bigint;
  v_limit bigint := 15000000;
  v_n integer;
  v_base bigint;
  v_rem bigint;
  v_i integer;
  v_part bigint;
  v_parts numeric[] := '{}';
begin
  if p_total is null or p_total <= 0 then
    return v_parts;
  end if;
  v_cents := round(p_total * 100)::bigint;
  if v_cents <= 0 then
    return v_parts;
  end if;
  if v_cents <= v_limit then
    return array[(v_cents::numeric / 100)];
  end if;
  v_n := ceil(v_cents::numeric / v_limit)::integer;
  v_base := v_cents / v_n;
  v_rem := v_cents % v_n;
  for v_i in 1..v_n loop
    v_part := v_base;
    if v_rem > 0 then
      v_part := v_part + 1;
      v_rem := v_rem - 1;
    end if;
    v_parts := v_parts || (v_part::numeric / 100);
  end loop;
  return v_parts;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.invoice_lines_freeze()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_status text;
  v_invoice uuid;
begin
  if tg_op = 'DELETE' and current_setting('scalers.billing_purge', true) = '1' then
    return old;
  end if;
  if current_setting('scalers.billing_write', true) = '1' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  v_invoice := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  select status into v_status from public.invoices where id = v_invoice;
  if v_status = 'draft' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception 'invoice lines are frozen';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.invoice_lines_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.tenant_id is null then
    select tenant_id into new.tenant_id from public.invoices where id = new.invoice_id;
  end if;
  if new.tenant_id is null then
    raise exception 'invoice line needs a tenant';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.invoice_next_pay_part(p_total numeric, p_paid numeric)
 RETURNS TABLE(part_index integer, part_count integer, amount_kes numeric)
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_parts numeric[];
  v_paid bigint;
  v_cursor bigint := 0;
  v_size bigint;
  v_i integer;
begin
  v_parts := public.invoice_kes_parts(p_total);
  part_count := coalesce(array_length(v_parts, 1), 0);
  if part_count = 0 then
    return;
  end if;
  v_paid := round(coalesce(p_paid, 0) * 100)::bigint;
  for v_i in 1..part_count loop
    v_size := round(v_parts[v_i] * 100)::bigint;
    if v_paid < v_cursor + v_size then
      part_index := v_i;
      amount_kes := ((v_cursor + v_size - v_paid)::numeric / 100);
      return next;
      return;
    end if;
    v_cursor := v_cursor + v_size;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.invoice_pay_attempt_by_checkout(p_checkout_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.payment_attempts%rowtype;
  v_inv public.invoices%rowtype;
  v_part record;
  v_live boolean := false;
begin
  if nullif(btrim(p_checkout_id), '') is null then
    return null;
  end if;
  select * into v_row
  from public.payment_attempts
  where checkout_session_id = p_checkout_id
  order by created_at desc
  limit 1;
  if not found then
    return null;
  end if;
  if v_row.status in ('pending', 'pending_unattached', 'failed') then
    select * into v_inv from public.invoices where id = v_row.invoice_id;
    if found and v_inv.status = 'open' then
      select * into v_part
      from public.invoice_next_pay_part(v_inv.total_kes, v_inv.amount_paid_kes);
      if v_part.part_index is not distinct from v_row.part_index
         and v_part.part_index is not null
         and round(v_part.amount_kes * 100) is not distinct from round(v_row.amount_kes * 100)
         and not exists (
           select 1
           from public.payment_attempts newer
           where newer.invoice_id = v_row.invoice_id
             and newer.part_index is not distinct from v_row.part_index
             and newer.id <> v_row.id
             and newer.status in ('pending', 'pending_unattached', 'succeeded')
             and newer.created_at >= v_row.created_at
         ) then
        v_live := true;
      end if;
    end if;
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'invoice_id', v_row.invoice_id,
    'tenant_id', v_row.tenant_id,
    'status', v_row.status,
    'amount_kes', v_row.amount_kes,
    'currency', v_row.currency,
    'part_index', v_row.part_index,
    'part_count', v_row.part_count,
    'checkout_session_id', v_row.checkout_session_id,
    'live_part', v_live
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.invoices_freeze()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'DELETE' and current_setting('scalers.billing_purge', true) = '1' then
    return old;
  end if;
  if current_setting('scalers.billing_write', true) = '1' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'draft' then
    if new.invoice_number is not null or new.status is distinct from 'draft' then
      raise exception 'invoice number and status are set only by finalize_invoice';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' and old.status = 'draft' then
    return old;
  end if;
  raise exception 'invoice % is frozen', coalesce(old.invoice_number, old.id::text);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.issue_invoice_receipt(p_payment_id uuid)
 RETURNS invoice_receipts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pay public.payments%rowtype;
  v_existing public.invoice_receipts%rowtype;
  v_year integer;
  v_n integer;
  v_number text;
  v_method text;
  v_row public.invoice_receipts%rowtype;
  v_body text;
begin
  select * into v_pay from public.payments where id = p_payment_id;
  if not found then
    raise exception 'payment not found';
  end if;
  if v_pay.match_status not in ('matched', 'partial', 'over') or v_pay.invoice_id is null then
    raise exception 'payment is not a recorded invoice payment';
  end if;

  select * into v_existing from public.invoice_receipts where payment_id = p_payment_id;
  if found then
    if v_existing.amount_kes is distinct from v_pay.amount_kes then
      update public.invoice_receipts
      set amount_kes = v_pay.amount_kes
      where id = v_existing.id
      returning * into v_existing;
    end if;
    return v_existing;
  end if;

  v_year := extract(year from (coalesce(v_pay.paid_at, now()) at time zone 'Africa/Nairobi'))::integer;
  insert into public.billing_receipt_counters (year, last_number)
  values (v_year, 0)
  on conflict (year) do nothing;
  update public.billing_receipt_counters
  set last_number = last_number + 1
  where year = v_year
  returning last_number into v_n;
  v_number := 'RCT-' || v_year::text || '-' || lpad(v_n::text, 6, '0');
  v_method := case when v_pay.provider = 'bachs' then 'M-Pesa' else v_pay.provider end;

  insert into public.invoice_receipts (
    tenant_id, invoice_id, payment_id, receipt_number, amount_kes, method, provider_ref, paid_at
  ) values (
    v_pay.tenant_id, v_pay.invoice_id, v_pay.id, v_number, v_pay.amount_kes,
    v_method, coalesce(v_pay.bill_ref, v_pay.provider_ref), coalesce(v_pay.paid_at, now())
  )
  returning * into v_row;

  v_body := 'Your Business Assistant payment of KSh '
    || trim(to_char(v_row.amount_kes, 'FM999999990.00'))
    || ' is received. Receipt ' || v_row.receipt_number
    || '. Reference ' || coalesce(v_row.provider_ref, '') || '.';
  perform public.enqueue_billing_notice(
    v_row.tenant_id,
    'platform_billing_payment_received',
    'platform_billing_payment_received:' || v_row.id::text,
    'Payment received',
    v_body
  );
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_billing_notice_read(p_id uuid)
 RETURNS billing_notices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.billing_notices%rowtype;
begin
  select * into v_row
  from public.billing_notices
  where id = p_id
    and tenant_id in (select public.current_user_tenant_ids());
  if not found then
    raise exception 'notice not found';
  end if;
  perform set_config('scalers.billing_notice_read', '1', true);
  update public.billing_notices
  set read_at = coalesce(read_at, now())
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_payment_event_retry(p_provider text, p_event_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_event_key), '') is null then
    raise exception 'provider and event key are required';
  end if;
  update public.payment_events
  set needs_retry = true
  where provider = p_provider
    and event_key = p_event_key;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mint_invoice_pay_token(p_invoice_id uuid, p_rotate boolean DEFAULT false)
 RETURNS TABLE(token text, expires_at timestamp with time zone, invoice_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_inv public.invoices%rowtype;
  v_tenant public.tenants%rowtype;
  v_token text;
  v_hash text;
  v_expires timestamptz;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status <> 'open' then
    raise exception 'only an open invoice can have a pay link';
  end if;
  if v_inv.amount_paid_kes >= v_inv.total_kes then
    raise exception 'invoice has nothing left to pay';
  end if;

  select * into v_tenant from public.tenants where id = v_inv.tenant_id;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_tenant.archived_at is not null then
    raise exception 'archived businesses have no pay link';
  end if;
  if coalesce(v_tenant.billing_enforcement, 'off') = 'off' then
    raise exception 'beta tenants have no pay link';
  end if;
  if exists (
    select 1 from public.tenant_subscriptions s
    where s.tenant_id = v_inv.tenant_id
      and s.billing_status = 'beta'
  ) then
    raise exception 'beta tenants have no pay link';
  end if;

  if coalesce(p_rotate, false) then
    update public.invoice_pay_tokens
    set revoked_at = now()
    where invoice_pay_tokens.invoice_id = p_invoice_id
      and revoked_at is null;
  elsif exists (
    select 1 from public.invoice_pay_tokens t
    where t.invoice_id = p_invoice_id and t.revoked_at is null
  ) then
    raise exception 'pay link already exists';
  end if;

  v_token := 'pay_' || rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');
  v_expires := now() + interval '7 days';

  insert into public.invoice_pay_tokens (invoice_id, tenant_id, token_hash, expires_at)
  values (p_invoice_id, v_inv.tenant_id, v_hash, v_expires);

  perform public._billing_audit(
    'system',
    'mint_invoice_pay_token',
    v_inv.tenant_id,
    jsonb_build_object(
      'invoice_id', p_invoice_id,
      'expires_at', v_expires,
      'rotated', coalesce(p_rotate, false)
    )
  );

  token := v_token;
  expires_at := v_expires;
  invoice_id := p_invoice_id;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.open_checkout_total_review(p_provider text, p_checkout_id text, p_identity_key text, p_kind text, p_get_kes numeric, p_seen_kes numeric, p_event_amount_kes numeric, p_tenant_id uuid, p_invoice_id uuid, p_raw jsonb DEFAULT '{}'::jsonb, p_amount_kes numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ref text;
  v_existing public.payments%rowtype;
  v_row public.payments%rowtype;
  v_amount numeric;
  v_notice text;
  v_reason text;
begin
  if nullif(btrim(p_provider), '') is null
     or nullif(btrim(p_checkout_id), '') is null
     or nullif(btrim(p_identity_key), '') is null then
    raise exception 'provider, checkout id, and review key are required';
  end if;
  if p_invoice_id is null then
    raise exception 'invoice not found';
  end if;
  perform 1 from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;

  v_reason := case
    when p_kind = 'decrease' then 'collected_total_decreased'
    when p_kind = 'missing_identity' then 'collected_identity_missing'
    else 'collected_total_short'
  end;

  v_ref := 'checkout-total-review:' || p_provider || ':' || p_checkout_id || ':' || p_identity_key;
  if v_ref = p_checkout_id then
    raise exception 'review ref must not be the checkout id';
  end if;

  select * into v_existing
  from public.payments
  where provider = p_provider
    and provider_ref = v_ref;
  if found then
    return jsonb_build_object(
      'review', true,
      'duplicate', true,
      'reason', v_reason,
      'noop', false,
      'applied_kes', 0,
      'excess_kes', 0,
      'amount_kes', v_existing.amount_kes,
      'partial', false,
      'provider_ref', v_ref
    );
  end if;

  v_amount := p_amount_kes;
  if v_amount is null or v_amount <= 0 then
    v_amount := greatest(coalesce(p_event_amount_kes, 0), coalesce(p_seen_kes, 0), coalesce(p_get_kes, 0), 0.01);
  end if;

  insert into public.payments (
    tenant_id, invoice_id, provider, provider_ref, amount_kes,
    match_status, bill_ref, raw, actor
  ) values (
    p_tenant_id,
    p_invoice_id,
    p_provider,
    v_ref,
    v_amount,
    'issue',
    v_ref,
    jsonb_build_object(
      'review_status', 'open',
      'review_kind', p_kind,
      'get_kes', p_get_kes,
      'seen_kes', p_seen_kes,
      'event_amount_kes', p_event_amount_kes,
      'checkout_id', p_checkout_id,
      'identity', p_identity_key,
      'event', coalesce(p_raw, '{}'::jsonb)
    ),
    'bachs-webhook'
  )
  returning * into v_row;

  perform public._billing_audit(
    'bachs-webhook',
    'checkout_total_review',
    p_tenant_id,
    jsonb_build_object(
      'provider', p_provider,
      'provider_ref', v_ref,
      'checkout_id', p_checkout_id,
      'kind', p_kind,
      'get_kes', p_get_kes,
      'seen_kes', p_seen_kes,
      'event_amount_kes', p_event_amount_kes,
      'invoice_id', p_invoice_id
    )
  );

  if to_regclass('public.platform_ops_notices') is not null then
    v_notice := 'checkout_total_review:' || p_provider || ':' || v_ref;
    begin
      insert into public.platform_ops_notices (kind, detail)
      values (
        v_notice,
        'Checkout ' || p_checkout_id
          || ' needs review. Bachs read KSh ' || trim(to_char(coalesce(p_get_kes, 0), 'FM999999990.00'))
          || '. The books already show KSh ' || trim(to_char(coalesce(p_seen_kes, 0), 'FM999999990.00'))
          || '. Another checkout stays closed until this is resolved.'
      );
    exception
      when unique_violation then
        null;
    end;
  end if;

  return jsonb_build_object(
    'review', true,
    'duplicate', false,
    'reason', v_reason,
    'noop', false,
    'applied_kes', 0,
    'excess_kes', 0,
    'amount_kes', v_row.amount_kes,
    'partial', false,
    'provider_ref', v_ref
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.owner_set_spend_limit(p_tenant_id uuid, p_actor uuid, p_limit_kes numeric, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_gate jsonb;
  v_key text;
  v_tenant public.tenants%rowtype;
  v_sub public.tenant_subscriptions%rowtype;
  v_limit numeric := p_limit_kes;
begin
  v_gate := public._owner_billing_gate(p_tenant_id, p_actor, p_idempotency_key, 'owner_set_spend_limit');
  if (v_gate->>'stop')::boolean then
    return v_gate->'result';
  end if;
  v_key := v_gate->>'key';

  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  select * into v_sub from public.tenant_subscriptions where tenant_id = p_tenant_id;
  if coalesce(v_tenant.billing_enforcement, 'off') = 'off' or v_sub.billing_status = 'beta' then
    return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_set_spend_limit',
      jsonb_build_object('ok', true, 'code', 'beta',
        'message', 'Billing is off for this business. Nothing was changed.'));
  end if;

  if v_limit is not null and v_limit <> 0 then
    v_limit := round(v_limit, 0);
    if v_limit < 500 or v_limit > 1000000 then
      return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_set_spend_limit',
        jsonb_build_object('ok', false, 'code', 'invalid_spend_limit',
          'message', 'The spend limit must be between KSh 500 and KSh 1,000,000.'));
    end if;
  else
    v_limit := null;
  end if;

  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants
  set soft_spend_limit_enabled = v_limit is not null,
      soft_spend_limit_kes = v_limit
  where id = p_tenant_id;

  return public._owner_billing_finish(p_tenant_id, p_actor, v_key, 'owner_set_spend_limit',
    jsonb_build_object(
      'ok', true, 'code', 'spend_limit_updated',
      'soft_spend_limit_kes', v_limit,
      'effective_limit_kes', public.billing_spend_limit_kes(p_tenant_id),
      'message', case
        when v_limit is null then 'The spend limit follows the plan.'
        else 'The spend limit is saved.'
      end
    ));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.package_version_fingerprint(p_sku text, p_terms jsonb, p_features jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_active timestamptz;
  v_payload jsonb;
  v_trial integer;
begin
  if nullif(btrim(coalesce(p_sku, '')), '') is null then
    raise exception 'package not found';
  end if;
  if p_terms is null or p_terms -> 'active_from' is null or jsonb_typeof(p_terms -> 'active_from') = 'null' then
    raise exception 'active from is required';
  end if;
  v_active := (p_terms ->> 'active_from')::timestamptz;
  if p_terms -> 'trial_days' is null or jsonb_typeof(p_terms -> 'trial_days') = 'null' then
    v_trial := null;
  else
    v_trial := (p_terms ->> 'trial_days')::integer;
  end if;
  v_payload := jsonb_build_object(
    'active_from', to_char(v_active at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'allowances_placeholder', (p_terms ->> 'allowances_placeholder')::boolean,
    'annual_discount_percent', (p_terms ->> 'annual_discount_percent')::numeric,
    'annual_price_kes', case
      when p_terms ? 'annual_price_kes' and jsonb_typeof(p_terms -> 'annual_price_kes') <> 'null'
        then (p_terms ->> 'annual_price_kes')::numeric
      else round(
        (p_terms ->> 'monthly_price_kes')::numeric * 12
        * (1 - (p_terms ->> 'annual_discount_percent')::numeric / 100)
      )
    end,
    'credit_kes', coalesce((p_terms ->> 'credit_kes')::numeric, 1),
    'dids', (p_terms ->> 'dids')::integer,
    'email', (p_terms ->> 'email')::integer,
    'email_credit_burn', (p_terms ->> 'email_credit_burn')::numeric,
    'on_demand_allowed', coalesce((p_terms ->> 'on_demand_allowed')::boolean, true),
    'email_kes', (p_terms ->> 'email_kes')::numeric,
    'features', coalesce((
      select jsonb_agg(jsonb_build_object('enabled', s.enabled, 'key', s.feature_key) order by s.feature_key)
      from (
        select f ->> 'key' as feature_key, (f ->> 'enabled')::boolean as enabled
        from jsonb_array_elements(coalesce(p_features, '[]'::jsonb)) f
      ) s
    ), '[]'::jsonb),
    'inbound_kes_per_second', (p_terms ->> 'inbound_kes_per_second')::numeric,
    'message_credits', case
      when p_terms -> 'message_credits' is null or jsonb_typeof(p_terms -> 'message_credits') = 'null' then null
      else (p_terms ->> 'message_credits')::integer
    end,
    'minutes', (p_terms ->> 'minutes')::integer,
    'monthly_price_kes', (p_terms ->> 'monthly_price_kes')::numeric,
    'outbound_kes_per_second', (p_terms ->> 'outbound_kes_per_second')::numeric,
    'seats', (p_terms ->> 'seats')::integer,
    'sku', p_sku,
    'sms', (p_terms ->> 'sms')::integer,
    'sms_credit_burn', (p_terms ->> 'sms_credit_burn')::numeric,
    'sms_kes', (p_terms ->> 'sms_kes')::numeric,
    'spend_limit_share_percent', coalesce((p_terms ->> 'spend_limit_share_percent')::numeric, 50),
    'staff_wa', (p_terms ->> 'staff_wa')::integer,
    'trial_days', v_trial,
    'whatsapp_credit_burn', (p_terms ->> 'whatsapp_credit_burn')::numeric,
    'whatsapp_kes', (p_terms ->> 'whatsapp_kes')::numeric
  );
  if p_terms ? 'extra_seat_monthly_kes' then
    v_payload := v_payload || jsonb_build_object(
      'extra_seat_monthly_kes', p_terms -> 'extra_seat_monthly_kes'
    );
  end if;
  return public._package_version_sha256(v_payload::text);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.park_invoice_pay_attempt(p_attempt_id uuid, p_checkout_session_id text, p_checkout_url text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing text;
begin
  if nullif(btrim(p_checkout_session_id), '') is null then
    raise exception 'checkout id is required';
  end if;
  if nullif(btrim(p_checkout_url), '') is not null and p_checkout_url !~ '^https://' then
    raise exception 'checkout url refused';
  end if;
  select checkout_session_id into v_existing
  from public.payment_attempts
  where id = p_attempt_id
    and status in ('pending', 'pending_unattached');
  if not found then
    raise exception 'pay attempt is not pending';
  end if;
  if v_existing is not null and v_existing is distinct from btrim(p_checkout_session_id) then
    raise exception 'checkout session is already parked';
  end if;
  update public.payment_attempts
  set status = 'pending_unattached',
      checkout_session_id = btrim(p_checkout_session_id),
      checkout_url = nullif(btrim(p_checkout_url), ''),
      checkout_expires_at = p_expires_at,
      updated_at = now()
  where id = p_attempt_id
    and status in ('pending', 'pending_unattached');
  if not found then
    raise exception 'pay attempt is not pending';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pay_invoice_by_return(p_return_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_inv public.invoices%rowtype;
  v_name text;
  v_enf text;
  v_billing_status text;
  v_state text;
begin
  if nullif(btrim(p_return_id), '') is null then
    return jsonb_build_object('found', false);
  end if;
  select * into v_attempt
  from public.payment_attempts
  where return_id = btrim(p_return_id);
  if not found then
    return jsonb_build_object('found', false);
  end if;
  if v_attempt.return_expires_at is null or v_attempt.return_expires_at <= now() then
    return jsonb_build_object(
      'found', true,
      'state', 'expired',
      'invoice_id', v_attempt.invoice_id,
      'tenant_id', v_attempt.tenant_id
    );
  end if;
  select * into v_inv from public.invoices where id = v_attempt.invoice_id;
  select business_name, coalesce(billing_enforcement, 'off')
    into v_name, v_enf
  from public.tenants where id = v_attempt.tenant_id;
  select s.billing_status into v_billing_status
  from public.tenant_subscriptions s
  where s.tenant_id = v_attempt.tenant_id;
  if v_inv.status = 'paid' then
    v_state := 'paid';
  elsif v_inv.status = 'void' then
    v_state := 'void';
  elsif v_enf = 'off' or v_billing_status = 'beta' then
    v_state := 'unavailable';
  elsif v_inv.status = 'open' then
    v_state := 'payable';
  else
    v_state := 'closed';
  end if;
  return jsonb_build_object(
    'found', true,
    'state', v_state,
    'business_name', v_name,
    'invoice_number', v_inv.invoice_number,
    'invoice_id', v_inv.id,
    'tenant_id', v_inv.tenant_id,
    'total_kes', v_inv.total_kes,
    'amount_paid_kes', v_inv.amount_paid_kes,
    'due_at', v_inv.due_at,
    'checkout_session_id', v_attempt.checkout_session_id,
    'attempt_status', v_attempt.status
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pay_invoice_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_hash text;
  v_token public.invoice_pay_tokens%rowtype;
  v_inv public.invoices%rowtype;
  v_name text;
  v_enf text;
  v_email text;
  v_phone text;
  v_billing_status text;
  v_state text;
begin
  if nullif(btrim(p_token), '') is null then
    return jsonb_build_object('found', false);
  end if;
  v_hash := encode(digest(btrim(p_token), 'sha256'), 'hex');
  select * into v_token from public.invoice_pay_tokens where token_hash = v_hash;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  select * into v_inv from public.invoices where id = v_token.invoice_id;
  select business_name, coalesce(billing_enforcement, 'off'),
         nullif(btrim(alert_email), ''),
         case
           when nullif(btrim(whatsapp_notification_number), '') like 'pending:%' then null
           else nullif(btrim(whatsapp_notification_number), '')
         end
    into v_name, v_enf, v_email, v_phone
  from public.tenants where id = v_token.tenant_id;

  select s.billing_status into v_billing_status
  from public.tenant_subscriptions s
  where s.tenant_id = v_token.tenant_id;

  if v_inv.status = 'paid' then
    v_state := 'paid';
  elsif v_inv.status = 'void' then
    v_state := 'void';
  elsif v_token.revoked_at is not null or v_token.expires_at <= now() then
    v_state := 'expired';
  elsif v_enf = 'off' or v_billing_status = 'beta' then
    v_state := 'unavailable';
  elsif v_inv.status = 'open' then
    v_state := 'payable';
  else
    v_state := 'closed';
  end if;

  return jsonb_build_object(
    'found', true,
    'state', v_state,
    'business_name', v_name,
    'invoice_number', v_inv.invoice_number,
    'invoice_id', v_inv.id,
    'tenant_id', v_inv.tenant_id,
    'subtotal_kes', v_inv.subtotal_kes,
    'total_kes', v_inv.total_kes,
    'amount_paid_kes', v_inv.amount_paid_kes,
    'due_at', v_inv.due_at,
    'enforcement', v_enf,
    'owner_name', v_name,
    'owner_email', v_email,
    'owner_phone', v_phone
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.payments_issue_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.match_status in ('matched', 'partial', 'over')
     and new.invoice_id is not null
     and new.amount_kes > 0
  then
    perform public.issue_invoice_receipt(new.id);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reconcile_checkout_collection(p_provider text, p_provider_ref text, p_checkout_id text, p_amount_kes numeric, p_tenant_id uuid, p_invoice_id uuid, p_raw jsonb DEFAULT '{}'::jsonb, p_settled_amount_minor integer DEFAULT NULL::integer, p_settled_currency text DEFAULT NULL::text, p_fee_minor integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inv public.invoices%rowtype;
  v_existing public.payments%rowtype;
  v_row public.payments%rowtype;
  v_next_cents bigint;
  v_prev_cents bigint;
  v_delta numeric;
  v_due numeric;
  v_apply numeric;
  v_excess numeric;
  v_paid numeric;
  v_match text;
  v_key text;
  v_credit uuid;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_provider_ref), '') is null then
    raise exception 'provider and provider ref are required';
  end if;
  if p_amount_kes is null or p_amount_kes <= 0 then
    raise exception 'payment amount must be positive';
  end if;
  if p_invoice_id is null then
    raise exception 'invoice not found';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status in ('void', 'uncollectible') then
    raise exception 'invoice cannot be paid';
  end if;
  if v_inv.status = 'draft' then
    raise exception 'draft invoices are not payable';
  end if;
  if p_tenant_id is not null and p_tenant_id is distinct from v_inv.tenant_id then
    raise exception 'payment tenant does not match the invoice';
  end if;
  p_tenant_id := v_inv.tenant_id;

  v_next_cents := round(p_amount_kes * 100);
  select * into v_existing
  from public.payments
  where provider = p_provider
    and provider_ref = p_provider_ref
    and match_status is distinct from 'issue'
  for update;
  v_prev_cents := case when found then round(v_existing.amount_kes * 100) else 0 end;
  if v_next_cents <= v_prev_cents then
    return jsonb_build_object(
      'noop', true,
      'applied_kes', 0,
      'excess_kes', 0,
      'amount_kes', coalesce(v_existing.amount_kes, 0)
    );
  end if;

  v_delta := (v_next_cents - v_prev_cents) / 100.0;
  v_due := greatest(v_inv.total_kes - v_inv.amount_paid_kes, 0);
  v_apply := least(v_delta, v_due);
  v_excess := v_delta - v_apply;
  v_paid := v_inv.amount_paid_kes + v_apply;
  if v_excess > 0 then
    v_match := 'over';
  elsif v_paid >= v_inv.total_kes then
    v_match := 'matched';
  else
    v_match := 'partial';
  end if;

  if found then
    update public.payments
    set amount_kes = p_amount_kes,
        match_status = v_match,
        bill_ref = coalesce(nullif(btrim(p_checkout_id), ''), bill_ref),
        raw = coalesce(p_raw, raw),
        settled_amount_minor = coalesce(p_settled_amount_minor, settled_amount_minor),
        settled_currency = coalesce(p_settled_currency, settled_currency),
        fee_minor = coalesce(p_fee_minor, fee_minor)
    where id = v_existing.id
    returning * into v_row;
  else
    insert into public.payments (
      tenant_id, invoice_id, provider, provider_ref, amount_kes,
      settled_amount_minor, settled_currency, fee_minor,
      match_status, bill_ref, paid_at, raw, actor
    ) values (
      p_tenant_id, p_invoice_id, p_provider, p_provider_ref, p_amount_kes,
      p_settled_amount_minor, p_settled_currency, p_fee_minor,
      v_match, nullif(btrim(p_checkout_id), ''), now(),
      coalesce(p_raw, '{}'::jsonb), 'bachs-webhook'
    )
    returning * into v_row;
  end if;

  if v_apply > 0 then
    perform set_config('scalers.billing_write', '1', true);
    if v_paid >= v_inv.total_kes then
      update public.invoices
      set amount_paid_kes = total_kes,
          status = 'paid',
          paid_at = coalesce(paid_at, now()),
          updated_at = now()
      where id = p_invoice_id;
    else
      update public.invoices
      set amount_paid_kes = amount_paid_kes + v_apply,
          updated_at = now()
      where id = p_invoice_id;
    end if;
  end if;

  if v_excess > 0 then
    v_key := 'collection-excess:' || p_provider || ':' || p_provider_ref || ':' || v_next_cents::text;
    insert into public.tenant_credits (tenant_id, amount_kes, reason, idempotency_key, payment_id)
    values (p_tenant_id, v_excess, 'collection_excess', v_key, v_row.id)
    on conflict (idempotency_key) do nothing
    returning id into v_credit;
    if v_credit is not null then
      perform public._billing_audit(
        'system',
        'collection_excess_credit',
        p_tenant_id,
        jsonb_build_object(
          'provider', p_provider,
          'provider_ref', p_provider_ref,
          'checkout_id', p_checkout_id,
          'amount_kes', v_excess,
          'credit_id', v_credit
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'noop', false,
    'applied_kes', v_apply,
    'excess_kes', v_excess,
    'amount_kes', p_amount_kes
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reconcile_checkout_total(p_provider text, p_checkout_id text, p_total_kes numeric, p_tenant_id uuid, p_invoice_id uuid, p_raw jsonb DEFAULT '{}'::jsonb, p_settled_amount_minor integer DEFAULT NULL::integer, p_settled_currency text DEFAULT NULL::text, p_fee_minor integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_inv public.invoices%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_existing public.payments%rowtype;
  v_row public.payments%rowtype;
  v_have_attempt boolean;
  v_have_payment boolean;
  v_next_cents bigint;
  v_seen_cents bigint;
  v_delta numeric;
  v_due numeric;
  v_apply numeric;
  v_excess numeric;
  v_paid numeric;
  v_match text;
  v_key text;
  v_credit uuid;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_checkout_id), '') is null then
    raise exception 'provider and checkout id are required';
  end if;
  if p_total_kes is null or p_total_kes < 0 then
    raise exception 'collected total must be zero or positive';
  end if;
  if p_invoice_id is null then
    raise exception 'invoice not found';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status in ('void', 'uncollectible') then
    raise exception 'invoice cannot be paid';
  end if;
  if v_inv.status = 'draft' then
    raise exception 'draft invoices are not payable';
  end if;
  if p_tenant_id is not null and p_tenant_id is distinct from v_inv.tenant_id then
    raise exception 'payment tenant does not match the invoice';
  end if;
  p_tenant_id := v_inv.tenant_id;

  if p_total_kes = 0 then
    return jsonb_build_object(
      'noop', true,
      'applied_kes', 0,
      'excess_kes', 0,
      'amount_kes', 0,
      'partial', false
    );
  end if;

  select * into v_attempt
  from public.payment_attempts
  where checkout_session_id = p_checkout_id
    and invoice_id = p_invoice_id
  order by created_at desc
  limit 1
  for update;
  v_have_attempt := found;
  if not v_have_attempt then
    raise exception 'pay attempt not found';
  end if;

  v_next_cents := round(p_total_kes * 100);
  v_seen_cents := round(coalesce(v_attempt.collected_total_seen_kes, 0) * 100);
  if v_next_cents <= v_seen_cents then
    return jsonb_build_object(
      'noop', true,
      'applied_kes', 0,
      'excess_kes', 0,
      'amount_kes', coalesce(v_attempt.collected_total_seen_kes, 0),
      'partial', false
    );
  end if;

  v_delta := (v_next_cents - v_seen_cents) / 100.0;
  v_due := greatest(v_inv.total_kes - v_inv.amount_paid_kes, 0);
  v_apply := least(v_delta, v_due);
  v_excess := v_delta - v_apply;
  v_paid := v_inv.amount_paid_kes + v_apply;
  if v_excess > 0 then
    v_match := 'over';
  elsif v_paid >= v_inv.total_kes then
    v_match := 'matched';
  else
    v_match := 'partial';
  end if;

  update public.payment_attempts
  set collected_total_seen_kes = p_total_kes
  where id = v_attempt.id;

  select * into v_existing
  from public.payments
  where provider = p_provider
    and provider_ref = p_checkout_id
  for update;
  v_have_payment := found;

  if v_have_payment then
    update public.payments
    set amount_kes = p_total_kes,
        match_status = v_match,
        bill_ref = p_checkout_id,
        raw = coalesce(p_raw, raw),
        settled_amount_minor = coalesce(p_settled_amount_minor, settled_amount_minor),
        settled_currency = coalesce(p_settled_currency, settled_currency),
        fee_minor = coalesce(p_fee_minor, fee_minor),
        invoice_id = p_invoice_id
    where id = v_existing.id
    returning * into v_row;
  else
    insert into public.payments (
      tenant_id, invoice_id, provider, provider_ref, amount_kes,
      settled_amount_minor, settled_currency, fee_minor,
      match_status, bill_ref, paid_at, raw, actor
    ) values (
      p_tenant_id, p_invoice_id, p_provider, p_checkout_id, p_total_kes,
      p_settled_amount_minor, p_settled_currency, p_fee_minor,
      v_match, p_checkout_id, now(),
      coalesce(p_raw, '{}'::jsonb), 'bachs-webhook'
    )
    returning * into v_row;
  end if;

  if v_apply > 0 then
    perform set_config('scalers.billing_write', '1', true);
    if v_paid >= v_inv.total_kes then
      update public.invoices
      set amount_paid_kes = total_kes,
          status = 'paid',
          paid_at = coalesce(paid_at, now()),
          updated_at = now()
      where id = p_invoice_id;
    else
      update public.invoices
      set amount_paid_kes = amount_paid_kes + v_apply,
          updated_at = now()
      where id = p_invoice_id;
    end if;
  end if;

  if v_excess > 0 then
    v_key := 'checkout-total:' || p_provider || ':' || p_checkout_id || ':' || v_next_cents::text;
    insert into public.tenant_credits (tenant_id, amount_kes, reason, idempotency_key, payment_id)
    values (p_tenant_id, v_excess, 'checkout_total', v_key, v_row.id)
    on conflict (idempotency_key) do nothing
    returning id into v_credit;
    if v_credit is not null then
      perform public._billing_audit(
        'system',
        'checkout_total_credit',
        p_tenant_id,
        jsonb_build_object(
          'provider', p_provider,
          'checkout_id', p_checkout_id,
          'amount_kes', v_excess,
          'credit_id', v_credit
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'noop', false,
    'applied_kes', v_apply,
    'excess_kes', v_excess,
    'amount_kes', p_total_kes,
    'partial', v_excess = 0 and v_paid < v_inv.total_kes
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_payment_event(p_provider text, p_event_key text, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS payment_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.payment_events%rowtype;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_event_key), '') is null then
    raise exception 'provider and event key are required';
  end if;
  insert into public.payment_events (provider, event_key, payload)
  values (p_provider, p_event_key, coalesce(p_payload, '{}'::jsonb))
  on conflict (provider, event_key) do update
    set attempts = public.payment_events.attempts + 1
  returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.record_payment_issue(p_provider text, p_provider_ref text, p_amount_kes numeric, p_tenant_id uuid DEFAULT NULL::uuid, p_invoice_id uuid DEFAULT NULL::uuid, p_raw jsonb DEFAULT '{}'::jsonb, p_settled_amount_minor integer DEFAULT NULL::integer, p_settled_currency text DEFAULT NULL::text, p_fee_minor integer DEFAULT NULL::integer, p_reason text DEFAULT 'mismatch'::text)
 RETURNS payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing public.payments%rowtype;
  v_row public.payments%rowtype;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_provider_ref), '') is null then
    raise exception 'provider and provider ref are required';
  end if;

  select * into v_existing
  from public.payments
  where provider = p_provider and provider_ref = p_provider_ref;
  if found then
    return v_existing;
  end if;

  perform public._billing_audit(
    'bachs-webhook',
    'payment_issue',
    p_tenant_id,
    jsonb_build_object(
      'provider', p_provider,
      'provider_ref', p_provider_ref,
      'amount_kes', p_amount_kes,
      'reason', p_reason,
      'invoice_id', p_invoice_id,
      'settled_currency', p_settled_currency
    )
  );

  if p_amount_kes is null or p_amount_kes <= 0 then
    return null;
  end if;

  insert into public.payments (
    tenant_id, invoice_id, provider, provider_ref, amount_kes,
    settled_amount_minor, settled_currency, fee_minor,
    match_status, bill_ref, raw, actor
  ) values (
    p_tenant_id, p_invoice_id, p_provider, p_provider_ref, p_amount_kes,
    p_settled_amount_minor, p_settled_currency, p_fee_minor,
    'issue', p_provider_ref, coalesce(p_raw, '{}'::jsonb), 'bachs-webhook'
  )
  returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.release_held_pay_checkout(p_attempt_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.payment_attempts
  set checkout_closed_at = now(),
      checkout_expires_at = now() - interval '1 second',
      updated_at = now()
  where id = p_attempt_id
    and status = 'succeeded'
    and nullif(btrim(checkout_session_id), '') is not null;
  if not found then
    raise exception 'pay attempt is not a held checkout';
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_checkout_total_review(p_provider text, p_provider_ref text, p_actor text, p_reason text, p_choice text, p_total_kes numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invoice uuid;
  v_tenant uuid;
  v_status text;
  v_raw jsonb;
  v_get numeric;
  v_total numeric;
  v_checkout text;
  v_book jsonb;
  v_applied numeric := 0;
  v_excess numeric := 0;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_provider_ref), '') is null then
    raise exception 'provider and provider ref are required';
  end if;
  if nullif(btrim(p_actor), '') is null then
    raise exception 'actor is required';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception 'reason is required';
  end if;
  if p_choice is distinct from 'book' and p_choice is distinct from 'nothing' then
    raise exception 'resolve choice is required';
  end if;
  if p_provider_ref not like 'checkout-total-review:%' then
    raise exception 'checkout review not found';
  end if;
  select invoice_id, tenant_id, coalesce(raw->>'review_status', 'open'), coalesce(raw, '{}'::jsonb)
  into v_invoice, v_tenant, v_status, v_raw
  from public.payments
  where provider = p_provider
    and provider_ref = p_provider_ref
    and match_status = 'issue'
  for update;
  if not found then
    raise exception 'checkout review not found';
  end if;
  if v_invoice is not null then
    perform 1 from public.invoices where id = v_invoice for update;
  end if;

  v_get := coalesce((v_raw->>'get_kes')::numeric, 0);

  if v_status is distinct from 'resolved' then
    if p_choice = 'book' then
      if p_total_kes is not null and round(p_total_kes * 100) < round(v_get * 100) then
        raise exception 'collected total fell';
      end if;
      v_total := coalesce(p_total_kes, v_get);
      v_checkout := nullif(btrim(v_raw->>'checkout_id'), '');
      if v_checkout is null then
        raise exception 'pay attempt not found';
      end if;
      v_book := public.reconcile_checkout_total(
        p_provider,
        v_checkout,
        v_total,
        v_tenant,
        v_invoice,
        coalesce(v_raw->'event', '{}'::jsonb)
      );
      v_applied := coalesce((v_book->>'applied_kes')::numeric, 0);
      v_excess := coalesce((v_book->>'excess_kes')::numeric, 0);
    end if;
    update public.payments
    set raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(
      'review_status', 'resolved',
      'resolve_choice', p_choice
    )
    where provider = p_provider
      and provider_ref = p_provider_ref
      and match_status = 'issue';
    if to_regclass('public.platform_ops_notices') is not null then
      update public.platform_ops_notices
      set status = 'resolved',
          resolved_at = coalesce(resolved_at, now())
      where kind = 'checkout_total_review:' || p_provider || ':' || p_provider_ref
        and status in ('open', 'acked');
    end if;
  end if;

  perform public._billing_audit(
    btrim(p_actor),
    'checkout_total_review_resolved',
    v_tenant,
    jsonb_build_object(
      'provider', p_provider,
      'provider_ref', p_provider_ref,
      'reason', btrim(p_reason),
      'invoice_id', v_invoice,
      'choice', p_choice,
      'applied_kes', v_applied,
      'excess_kes', v_excess,
      'get_kes', v_get
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.roll_package_periods(p_dry_run boolean DEFAULT false)
 RETURNS TABLE(tenant_id uuid, period text, old_period_start timestamp with time zone, old_period_end timestamp with time zone, new_period_start timestamp with time zone, new_period_end timestamp with time zone, seconds_used_before integer, sms_used_before integer, email_used_before integer, whatsapp_used_before integer, applied_change text, package_id_after uuid, minutes_included_after integer, term_end_after timestamp with time zone, catch_up boolean, seconds_used_after integer, sms_used_after integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  r record;
  v_start timestamptz;
  v_end timestamptz;
  v_period text;
  v_package uuid;
  v_status text;
  v_change text;
  v_minutes integer;
  v_grants integer;
  v_term_start timestamptz;
  v_term_end timestamptz;
  v_steps integer;
  v_secs integer;
  v_sms integer;
  v_catch_up boolean;
begin
  for r in
    select s.tenant_id, s.period, s.status, s.package_id,
           s.current_period_start, s.current_period_end, s.term_start, s.term_end,
           s.pending_change, s.pending_package_id, s.pending_period, s.pending_effective_at,
           t.seconds_used, t.sms_used_units, t.email_used_units, t.whatsapp_used_units
    from public.tenant_subscriptions s
    join public.tenants t on t.id = s.tenant_id
    where s.status in ('active', 'cancelled')
      and t.archived_at is null  -- archived: no renewal; counters stay as the final usage (archive_tenant_billing, #737)
      and s.current_period_end is not null
      and s.current_period_end <= now()
    for update of s skip locked
  loop
    v_period := r.period;
    v_package := r.package_id;
    v_status := r.status;
    v_change := null;

    if r.pending_change is not null and r.pending_effective_at <= r.current_period_end then
      v_change := r.pending_change;
      if r.pending_change = 'unassign' then
        v_status := 'cancelled';
      else
        v_package := r.pending_package_id;
        v_period := r.pending_period;
      end if;
    end if;

    -- Usage always rolls one calendar month (EAT), for monthly and annual terms.
    v_start := r.current_period_end;
    v_end := public.billing_add_months(v_start, 1);
    v_steps := 1;
    while v_end <= now() loop
      v_start := v_end;
      v_end := public.billing_add_months(v_start, 1);
      v_steps := v_steps + 1;
    end loop;

    -- Usage already in the new period (catch-up). Lock the tenant first so a
    -- concurrent consume_call_seconds / reserve_notify_send serialises with us.
    if not p_dry_run then
      perform 1 from public.tenants t where t.id = r.tenant_id for update;
    end if;
    select coalesce(sum(c.package_seconds_applied), 0)::integer into v_secs
    from public.calls c
    where c.tenant_id = r.tenant_id
      and c.created_at >= v_start and c.created_at < v_end;
    select (coalesce((select sum(b.units) from public.notify_sms_billable b
                      where b.tenant_id = r.tenant_id
                        and b.created_at >= v_start and b.created_at < v_end), 0)
          + coalesce((select sum(n.held_units) from public.notify_sends n
                      where n.tenant_id = r.tenant_id
                        and n.channel = 'sms' and n.billed_to = 'tenant' and n.status = 'pending'
                        and n.created_at >= v_start and n.created_at < v_end), 0))::integer
      into v_sms;
    v_catch_up := v_steps > 1 or v_secs > 0 or v_sms > 0;
    if not v_catch_up then
      v_secs := 0;
      v_sms := 0;
    end if;

    -- Billing term: a term switch starts a new term with the new usage month;
    -- otherwise the term moves only once it has ended.
    if v_change = 'period_change' or r.term_end is null then
      v_term_start := v_start;
      v_term_end := public.billing_add_months(v_start, case when v_period = 'year' then 12 else 1 end);
    else
      v_term_start := r.term_start;
      v_term_end := r.term_end;
      while v_term_end <= v_start loop
        v_term_start := v_term_end;
        v_term_end := public.billing_add_months(v_term_start, case when v_period = 'year' then 12 else 1 end);
      end loop;
    end if;

    v_grants := public.billing_grant_minutes_for_period(r.tenant_id, v_start, v_end);
    if v_status = 'active' then
      select p.minutes + v_grants into v_minutes from public.billing_packages p where p.id = v_package;
    else
      v_minutes := v_grants;
    end if;

    tenant_id := r.tenant_id;
    period := v_period;
    old_period_start := r.current_period_start;
    old_period_end := r.current_period_end;
    new_period_start := v_start;
    new_period_end := v_end;
    seconds_used_before := r.seconds_used;
    sms_used_before := r.sms_used_units;
    email_used_before := r.email_used_units;
    whatsapp_used_before := r.whatsapp_used_units;
    applied_change := v_change;
    package_id_after := case when v_status = 'active' then v_package end;
    minutes_included_after := v_minutes;
    term_end_after := v_term_end;
    catch_up := v_catch_up;
    seconds_used_after := v_secs;
    sms_used_after := v_sms;

    if not p_dry_run then
      update public.tenant_subscriptions s
        set current_period_start = v_start,
            current_period_end = v_end,
            period = v_period,
            term_start = v_term_start,
            term_end = v_term_end,
            package_id = v_package,
            status = v_status,
            ended_at = case when v_change = 'unassign' then r.current_period_end else s.ended_at end,
            pending_package_id = case when v_change is not null then null else s.pending_package_id end,
            pending_period = case when v_change is not null then null else s.pending_period end,
            pending_change = case when v_change is not null then null else s.pending_change end,
            pending_effective_at = case when v_change is not null then null else s.pending_effective_at end,
            pending_set_at = case when v_change is not null then null else s.pending_set_at end,
            pending_actor = case when v_change is not null then null else s.pending_actor end,
            updated_at = now()
        where s.tenant_id = r.tenant_id
          and s.current_period_end = r.current_period_end;  -- guard against a concurrent roll

      if found then
        -- Counters are wallet-protected; same flag the billing RPCs use.
        perform set_config('scalers.wallet_write', '1', true);
        -- On time: 0. Catch-up: rebuilt from calls + the SMS ledger (header).
        update public.tenants t
          set seconds_used = v_secs,
              sms_used_units = v_sms,
              email_used_units = 0,
              whatsapp_used_units = 0
          where t.id = r.tenant_id;

        perform public._tenant_set_allowances(
          r.tenant_id,
          case when v_status = 'active' then v_package end,
          v_minutes);

        insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
        values (
          'cron',
          'package_period_rollover',
          r.tenant_id,
          null,
          jsonb_build_object(
            'period', v_period,
            'old_start', r.current_period_start,
            'old_end', r.current_period_end,
            'new_start', v_start,
            'new_end', v_end,
            'term_start', v_term_start,
            'term_end', v_term_end,
            'applied_change', v_change,
            'package_id', case when v_status = 'active' then v_package end,
            'minutes_included_after', v_minutes,
            'grant_minutes', v_grants,
            'seconds_used', r.seconds_used,
            'sms_used_units', r.sms_used_units,
            'email_used_units', r.email_used_units,
            'whatsapp_used_units', r.whatsapp_used_units,
            'catch_up', v_catch_up,
            'periods_rolled', v_steps,
            'counters_source', case when v_catch_up then 'rebuilt_from_ledger' else 'zero' end,
            'seconds_used_after', v_secs,
            'sms_used_units_after', v_sms
          )
        );
      end if;
    end if;

    return next;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_tenant_billing_mode(p_tenant_id uuid, p_mode text, p_actor text DEFAULT 'ops'::text, p_note text DEFAULT NULL::text, p_beta_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_waive_negative_balance boolean DEFAULT false)
 RETURNS TABLE(billing_enforcement text, wallet_balance_kes numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_mode text := lower(trim(p_mode));
  v_actor text := coalesce(nullif(trim(p_actor), ''), 'ops');
  v_bal numeric;
  v_note text := coalesce(nullif(trim(p_note), ''), 'Billing mode change');
begin
  perform set_config('scalers.wallet_write', '1', true);

  if v_mode not in ('off', 'soft', 'hard') then
    raise exception 'mode must be off|soft|hard';
  end if;

  -- Charging on while the subscription is still beta is refused. Status is
  -- not updated here. An admin sets it to active in the same confirmed call
  -- through admin_set_tenant_billing_mode.
  if v_mode is distinct from 'off' and exists (
    select 1
    from public.tenant_subscriptions
    where tenant_id = p_tenant_id
      and billing_status = 'beta'
  ) then
    raise exception 'billing stays off while the business is on beta';
  end if;

  update public.tenants
  set
    billing_enforcement = v_mode,
    beta_notes = case
      when v_mode = 'off' then v_note
      else beta_notes
    end,
    beta_expires_at = case
      when v_mode = 'off' then p_beta_expires_at
      else null
    end
  where id = p_tenant_id
  returning tenants.wallet_balance_kes into v_bal;

  if not found then
    raise exception 'tenant not found';
  end if;

  -- Optional: when moving to beta, wipe debt so soft-charged beta debt disappears.
  if p_waive_negative_balance and coalesce(v_bal, 0) < 0 then
    perform public._wallet_apply_delta(
      p_tenant_id,
      'trial_credit',
      abs(v_bal),
      'beta_waive',
      'waive:' || p_tenant_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS'),
      'Beta whitelist - waived negative balance',
      jsonb_build_object('actor', v_actor)
    );
    select t.wallet_balance_kes into v_bal from public.tenants t where t.id = p_tenant_id;
  end if;

  insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
  values (
    v_actor,
    'set_billing_mode',
    p_tenant_id,
    null,
    jsonb_build_object(
      'mode', v_mode,
      'note', v_note,
      'beta_expires_at', p_beta_expires_at,
      'waive_negative', p_waive_negative_balance,
      'balance_after', v_bal
    )
  );

  billing_enforcement := v_mode;
  wallet_balance_kes := coalesce(v_bal, 0);
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_tenant_on_demand_usage(p_tenant_id uuid, p_enabled boolean)
 RETURNS TABLE(on_demand_usage_enabled boolean, wallet_balance_kes numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_enabled boolean := coalesce(p_enabled, false);
  v_before boolean;
  v_uid uuid := auth.uid();
  v_owner boolean := auth.uid() is not null and coalesce(auth.role(), '') = 'authenticated';
  v_actor text;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;

  if v_owner then
    if p_tenant_id not in (select public.current_user_tenant_ids()) then
      raise exception 'not allowed';
    end if;
  end if;

  select coalesce(t.on_demand_usage_enabled, false) into v_before
  from public.tenants t where t.id = p_tenant_id
  for update;
  if not found then
    raise exception 'tenant not found';
  end if;

  perform set_config('scalers.wallet_write', '1', true);

  update public.tenants t
  set on_demand_usage_enabled = v_enabled
  where t.id = p_tenant_id;

  if v_before is distinct from v_enabled then
    if v_uid is not null then
      select coalesce(nullif(trim(u.email), ''), 'user:' || v_uid::text) into v_actor
      from auth.users u where u.id = v_uid;
      v_actor := coalesce(v_actor, 'user:' || v_uid::text);
    else
      v_actor := coalesce(nullif(auth.role(), ''), 'ops');
    end if;

    insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
    values (
      v_actor,
      'set_on_demand_usage',
      p_tenant_id,
      null,
      jsonb_build_object(
        'before', jsonb_build_object('on_demand_usage_enabled', v_before),
        'after', jsonb_build_object('on_demand_usage_enabled', v_enabled),
        'source', case when v_owner then 'owner' else 'service' end
      )
    );
  end if;

  on_demand_usage_enabled := v_enabled;
  select coalesce(t.wallet_balance_kes, 0) into wallet_balance_kes
  from public.tenants t where t.id = p_tenant_id;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_tenant_soft_spend_limit(p_tenant_id uuid, p_enabled boolean, p_limit_kes numeric DEFAULT NULL::numeric)
 RETURNS TABLE(soft_spend_limit_enabled boolean, soft_spend_limit_kes numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_enabled boolean := coalesce(p_enabled, false);
  v_limit numeric := nullif(p_limit_kes, 0);
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;

  if auth.uid() is not null and coalesce(auth.role(), '') = 'authenticated' then
    if p_tenant_id not in (select public.current_user_tenant_ids()) then
      raise exception 'not allowed';
    end if;
  end if;

  if v_enabled then
    if v_limit is null or v_limit < 500 then
      raise exception 'soft spend limit must be at least 500 KES when enabled';
    end if;
    if v_limit > 1000000 then
      raise exception 'soft spend limit cannot exceed 1000000 KES';
    end if;
    v_limit := round(v_limit);
  else
    v_limit := null;
  end if;

  perform set_config('scalers.wallet_write', '1', true);

  update public.tenants
  set
    soft_spend_limit_enabled = v_enabled,
    soft_spend_limit_kes = v_limit
  where id = p_tenant_id;

  if not found then
    raise exception 'tenant not found';
  end if;

  soft_spend_limit_enabled := v_enabled;
  soft_spend_limit_kes := v_limit;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_billing_notice(p_id uuid, p_status text, p_notify_send_id uuid DEFAULT NULL::uuid, p_error text DEFAULT NULL::text)
 RETURNS billing_notices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.billing_notices%rowtype;
begin
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'settle status must be sent, failed, or skipped';
  end if;
  select * into v_row from public.billing_notices where id = p_id for update;
  if not found then
    raise exception 'notice not found';
  end if;
  -- A sent notice stays sent. A later failed or skipped settle, or a
  -- different notify_send_id, does not overwrite it.
  if v_row.delivery_status = 'sent' then
    return v_row;
  end if;
  perform set_config('scalers.billing_notice_delivery', '1', true);
  update public.billing_notices
  set delivery_status = p_status,
      notify_send_id = p_notify_send_id,
      last_error = p_error
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_checkout_reading(p_provider text, p_checkout_id text, p_total_kes numeric, p_tenant_id uuid, p_invoice_id uuid, p_identity text DEFAULT NULL::text, p_event_amount_kes numeric DEFAULT NULL::numeric, p_raw jsonb DEFAULT '{}'::jsonb, p_settled_amount_minor integer DEFAULT NULL::integer, p_settled_currency text DEFAULT NULL::text, p_fee_minor integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_have_attempt boolean;
  v_identity text;
  v_real boolean;
  v_ids jsonb;
  v_next_cents bigint;
  v_seen_cents bigint;
  v_event_cents bigint;
  v_price_cents bigint;
  v_amount_is_price boolean;
  v_rise bigint;
  v_known boolean;
  v_applied jsonb;
  v_key text;
begin
  if nullif(btrim(p_provider), '') is null or nullif(btrim(p_checkout_id), '') is null then
    raise exception 'provider and checkout id are required';
  end if;
  if p_total_kes is null or p_total_kes < 0 then
    raise exception 'collected total must be zero or positive';
  end if;
  if p_invoice_id is null then
    raise exception 'invoice not found';
  end if;
  perform 1 from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;

  select * into v_attempt
  from public.payment_attempts
  where checkout_session_id = p_checkout_id
    and invoice_id = p_invoice_id
  order by created_at desc
  limit 1
  for update;
  v_have_attempt := found;
  if not v_have_attempt then
    raise exception 'pay attempt not found';
  end if;

  v_identity := nullif(btrim(p_identity), '');
  v_real := v_identity is not null and v_identity is distinct from ('ch_' || p_checkout_id);
  v_ids := coalesce(v_attempt.collection_ids, '[]'::jsonb);
  v_next_cents := round(p_total_kes * 100);
  v_seen_cents := round(coalesce(v_attempt.collected_total_seen_kes, 0) * 100);
  v_event_cents := null;
  if p_event_amount_kes is not null and p_event_amount_kes > 0 then
    v_event_cents := round(p_event_amount_kes * 100);
  end if;
  v_price_cents := round(coalesce(v_attempt.amount_kes, 0) * 100);
  v_amount_is_price := v_event_cents is not null and v_price_cents > 0 and v_event_cents = v_price_cents;
  v_rise := v_next_cents - v_seen_cents;
  v_known := v_real and not (v_ids @> jsonb_build_array(v_identity));

  if v_next_cents < v_seen_cents then
    return public.open_checkout_total_review(
      p_provider,
      p_checkout_id,
      'lower:' || v_seen_cents::text || ':' || v_next_cents::text,
      'decrease',
      p_total_kes,
      coalesce(v_attempt.collected_total_seen_kes, 0),
      p_event_amount_kes,
      p_tenant_id,
      p_invoice_id,
      p_raw,
      (v_seen_cents - v_next_cents) / 100.0
    );
  end if;

  if not v_real and (v_rise > 0 or (v_rise = 0 and v_seen_cents > 0)) then
    v_key := coalesce(v_identity, 'missing') || ':' || v_seen_cents::text || ':' || v_next_cents::text;
    return public.open_checkout_total_review(
      p_provider,
      p_checkout_id,
      v_key,
      'missing_identity',
      p_total_kes,
      coalesce(v_attempt.collected_total_seen_kes, 0),
      p_event_amount_kes,
      p_tenant_id,
      p_invoice_id,
      p_raw,
      case when v_rise > 0 then v_rise / 100.0 else coalesce(v_attempt.collected_total_seen_kes, p_total_kes) end
    );
  end if;

  if v_known and v_event_cents is not null and not v_amount_is_price and v_rise < v_event_cents then
    return public.open_checkout_total_review(
      p_provider,
      p_checkout_id,
      v_identity,
      'short_rise',
      p_total_kes,
      coalesce(v_attempt.collected_total_seen_kes, 0),
      p_event_amount_kes,
      p_tenant_id,
      p_invoice_id,
      p_raw,
      p_event_amount_kes
    );
  end if;

  if v_known and (v_event_cents is null or v_amount_is_price) and v_rise = 0 and v_seen_cents > 0 then
    return public.open_checkout_total_review(
      p_provider,
      p_checkout_id,
      v_identity,
      'short_rise',
      p_total_kes,
      coalesce(v_attempt.collected_total_seen_kes, 0),
      p_event_amount_kes,
      p_tenant_id,
      p_invoice_id,
      p_raw,
      coalesce(v_attempt.collected_total_seen_kes, p_total_kes)
    );
  end if;

  if v_next_cents = 0 or v_next_cents <= v_seen_cents then
    return jsonb_build_object(
      'noop', true,
      'review', false,
      'wait', v_next_cents = 0,
      'applied_kes', 0,
      'excess_kes', 0,
      'amount_kes', coalesce(v_attempt.collected_total_seen_kes, 0),
      'partial', false
    );
  end if;

  v_applied := public.reconcile_checkout_total(
    p_provider,
    p_checkout_id,
    p_total_kes,
    p_tenant_id,
    p_invoice_id,
    p_raw,
    p_settled_amount_minor,
    p_settled_currency,
    p_fee_minor
  );

  if v_real then
    update public.payment_attempts
    set collection_ids = case
      when coalesce(collection_ids, '[]'::jsonb) @> jsonb_build_array(v_identity)
        then coalesce(collection_ids, '[]'::jsonb)
      else coalesce(collection_ids, '[]'::jsonb) || jsonb_build_array(v_identity)
    end
    where id = v_attempt.id;
  end if;

  return v_applied || jsonb_build_object('review', false, 'duplicate', false);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.settle_invoice_pay_attempt(p_attempt_id uuid, p_status text, p_provider_amount numeric DEFAULT NULL::numeric, p_provider_currency text DEFAULT NULL::text, p_fee_amount numeric DEFAULT NULL::numeric, p_fee_currency text DEFAULT NULL::text, p_raw jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_status not in ('pending', 'pending_unattached', 'succeeded', 'failed', 'issue', 'cancelled', 'superseded') then
    raise exception 'unknown attempt status';
  end if;
  update public.payment_attempts
  set status = p_status,
      provider_amount = p_provider_amount,
      provider_currency = p_provider_currency,
      fee_amount = p_fee_amount,
      fee_currency = p_fee_currency,
      raw = coalesce(p_raw, '{}'::jsonb),
      updated_at = now()
  where id = p_attempt_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sms_counter_drift()
 RETURNS TABLE(tenant_id uuid, period_start timestamp with time zone, counter integer, ledger_sent_units integer, pending_held_units integer, drift integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select t.id,
         s.current_period_start,
         coalesce(t.sms_used_units, 0),
         coalesce(sum(n.units) filter (where n.status = 'sent'), 0)::integer,
         coalesce(sum(n.held_units) filter (where n.status = 'pending'), 0)::integer,
         (coalesce(t.sms_used_units, 0)
           - coalesce(sum(n.units) filter (where n.status = 'sent'), 0)
           - coalesce(sum(n.held_units) filter (where n.status = 'pending'), 0))::integer
  from public.tenants t
  left join public.tenant_subscriptions s on s.tenant_id = t.id
  left join public.notify_sends n
    on n.tenant_id = t.id
   and n.channel = 'sms' and n.billed_to = 'tenant'
   and n.created_at >= coalesce(s.current_period_start, '-infinity'::timestamptz)
  group by t.id, s.current_period_start, t.sms_used_units;
$function$
;

CREATE OR REPLACE FUNCTION public.sms_counter_drift_log()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_n integer;
begin
  insert into public.ops_audit_log (actor, action, tenant_id, detail)
  select 'cron', 'sms_counter_drift', d.tenant_id,
         jsonb_build_object(
           'period_start', d.period_start,
           'counter', d.counter,
           'ledger_sent_units', d.ledger_sent_units,
           'pending_held_units', d.pending_held_units,
           'drift', d.drift)
  from public.sms_counter_drift() d
  where d.drift <> 0;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.system_move_subscribers_to_package_version(p_version_id uuid, p_tenant_ids uuid[], p_actor text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_version public.billing_package_versions%rowtype;
  v_tenant uuid;
  v_sub public.tenant_subscriptions%rowtype;
  v_status text;
  v_enforcement text;
  v_from_sku text;
  v_from_version integer;
  v_to_sku text;
  v_moved integer := 0;
  v_skipped integer := 0;
  v_invoices integer;
begin
  if p_tenant_ids is null or coalesce(array_length(p_tenant_ids, 1), 0) < 1 then
    raise exception 'choose at least one business';
  end if;
  select * into v_version from public.billing_package_versions where id = p_version_id;
  if not found or v_version.status <> 'published' then
    raise exception 'move businesses onto a published version';
  end if;
  select sku into v_to_sku from public.billing_packages where id = v_version.package_id;
  select count(*) into v_invoices from public.invoices;
  foreach v_tenant in array p_tenant_ids
  loop
    if not exists (select 1 from public.tenants where id = v_tenant) then
      raise exception 'business not found';
    end if;
    v_sub := null;
    select * into v_sub from public.tenant_subscriptions where tenant_id = v_tenant;
    select billing_enforcement into v_enforcement from public.tenants where id = v_tenant;
    v_status := v_sub.billing_status;
    if v_sub.tenant_id is null
       or v_status = 'beta'
       or coalesce(v_enforcement, 'off') = 'off'
    then
      select p.sku, v.version into v_from_sku, v_from_version
      from public.billing_packages p
      join public.billing_package_versions v on v.id = v_sub.package_version_id
      where p.id = v_sub.package_id;
      perform public._billing_audit(
        coalesce(nullif(btrim(p_actor), ''), 'system'),
        'skip_package_version',
        v_tenant,
        jsonb_build_object(
          'reason', btrim(coalesce(p_reason, '')),
          'source', 'system',
          'skipped', case
            when v_sub.tenant_id is null then 'no subscription'
            when v_status = 'beta' then 'beta'
            else 'enforcement off'
          end,
          'from_version_id', v_sub.package_version_id,
          'from_version', v_from_version,
          'from_sku', v_from_sku,
          'to_version_id', v_version.id,
          'to_version', v_version.version,
          'to_sku', v_to_sku,
          'billing_status_before', v_status,
          'billing_status_after', v_status,
          'billing_enforcement_before', v_enforcement,
          'billing_enforcement_after', v_enforcement,
          'moved_at', now()
        )
      );
      v_skipped := v_skipped + 1;
    else
      perform public._apply_package_version_move(
        v_version, v_tenant, coalesce(nullif(btrim(p_actor), ''), 'system'), p_reason, 'system'
      );
      v_moved := v_moved + 1;
    end if;
  end loop;
  if (select count(*) from public.invoices) is distinct from v_invoices then
    raise exception 'a version move must not create an invoice';
  end if;
  perform set_config('scalers.billing_admin_move', '0', true);
  perform set_config('scalers.billing_version_move', '0', true);
  perform set_config('scalers.wallet_write', '0', true);
  return jsonb_build_object('version_id', p_version_id, 'moved', v_moved, 'skipped', v_skipped);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tenant_credits_freeze()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  raise exception 'credits are append-only';
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tenant_subscriptions_a_billing_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if current_setting('scalers.billing_transition', true) = '1' then
    return new;
  end if;
  if new.billing_status is distinct from old.billing_status
     or new.voicemail_until is distinct from old.voicemail_until
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.past_due_at is distinct from old.past_due_at
     or new.grace_started_at is distinct from old.grace_started_at
     or new.billing_suspended_at is distinct from old.billing_suspended_at
     or new.billing_cancelled_at is distinct from old.billing_cancelled_at
     or new.billing_archived_at is distinct from old.billing_archived_at
     or new.billing_status_changed_at is distinct from old.billing_status_changed_at
  then
    raise exception 'billing status changes go through transition_subscription_billing_status';
  end if;
  if new.package_version_id is distinct from old.package_version_id
     and new.package_id is not distinct from old.package_id
     and old.package_version_id is not null
     and current_setting('scalers.billing_version_move', true) is distinct from '1'
  then
    raise exception 'package version is pinned';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tenant_subscriptions_b_pin_version()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_version uuid;
  v_generation integer;
  v_enforcement text;
begin
  if new.billing_status is null then
    new.billing_status := 'beta';
  end if;
  if current_setting('scalers.billing_admin_move', true) = '1' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.package_version_id is null then
      v_version := public.billing_latest_package_version(new.package_id);
      if v_version is null then
        raise exception 'no published package version for this package';
      end if;
      new.package_version_id := v_version;
    end if;
    return new;
  end if;
  if new.package_id is distinct from old.package_id then
    select v.version into v_generation
    from public.billing_package_versions v
    where v.id = old.package_version_id;
    select v.id into v_version
    from public.billing_package_versions v
    where v.package_id = new.package_id
      and v.version = v_generation
      and v.status = 'published';
    if v_version is null then
      raise exception 'a package change keeps the current version; this package has no published version at that generation';
    end if;
    new.package_version_id := v_version;
    return new;
  end if;
  if new.package_version_id is distinct from old.package_version_id then
    select coalesce(t.billing_enforcement, 'off') into v_enforcement
    from public.tenants t
    where t.id = new.tenant_id;
    if new.billing_status = 'beta' or v_enforcement = 'off' then
      raise exception 'a beta business is not moved onto a package version';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tenant_subscriptions_c_require_version_pin()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.billing_status = 'active' and new.package_version_id is null then
    raise exception 'active billing requires a pinned package version';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tenant_subscriptions_clear_spend_hold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.current_period_start is distinct from old.current_period_start then
    new.spend_limit_held_period := null;
    perform set_config('scalers.wallet_write', '1', true);
    update public.tenants
    set spend_limit_blocked = false
    where id = new.tenant_id and spend_limit_blocked;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tenant_subscriptions_d_block_retired_version()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare v_status text;
begin
  if new.package_version_id is not null
     and (tg_op = 'INSERT' or new.package_version_id is distinct from old.package_version_id) then
    select status into v_status from public.billing_package_versions where id = new.package_version_id;
    if v_status is distinct from 'published' then
      raise exception 'cannot assign a % package version', coalesce(v_status, 'missing');
    end if;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.tenants_a_new_signup_trial()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_enabled boolean;
  v_package uuid;
begin
  select new_signup_trial_enabled into v_enabled
  from public.billing_lifecycle_settings
  where id = 1;
  if not coalesce(v_enabled, false) then
    return new;
  end if;
  if exists (
    select 1 from public.tenant_subscriptions where tenant_id = new.id
  ) then
    return new;
  end if;
  select id into v_package from public.billing_packages where sku = 'trial';
  if v_package is null or public.billing_latest_package_version(v_package) is null then
    return new;
  end if;
  insert into public.tenant_subscriptions (tenant_id, package_id, status)
  values (new.id, v_package, 'active');
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tenants_archived_billing_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.archived_at is null then
    return new;
  end if;
  if coalesce(new.billing_enforcement, 'off') <> 'off'
     and new.billing_enforcement is distinct from old.billing_enforcement then
    raise exception 'This business is archived. Unarchive it before turning billing on.'
      using errcode = 'P0001';
  end if;
  if coalesce(new.on_demand_usage_enabled, false)
     and new.on_demand_usage_enabled is distinct from old.on_demand_usage_enabled then
    raise exception 'This business is archived. Unarchive it before turning on-demand on.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tenants_billing_purge_flag()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  perform set_config('scalers.billing_purge', '1', true);
  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tenants_protect_spend_limit()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'UPDATE'
     and new.spend_limit_blocked is distinct from old.spend_limit_blocked
     and current_setting('scalers.wallet_write', true) is distinct from '1'
     and current_setting('scalers.billing_write', true) is distinct from '1'
  then
    raise exception 'spend limit is rpc only';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tenants_protect_wallet_columns()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if current_setting('scalers.wallet_write', true) = '1' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.wallet_balance_kes is distinct from old.wallet_balance_kes
      or new.wallet_low_balance_kes is distinct from old.wallet_low_balance_kes
      or new.billing_enforcement is distinct from old.billing_enforcement
      or new.telecom_wallet_balance_kes is distinct from old.telecom_wallet_balance_kes
      or new.ai_wallet_balance_usd is distinct from old.ai_wallet_balance_usd
      or new.beta_notes is distinct from old.beta_notes
      or new.beta_expires_at is distinct from old.beta_expires_at
      or new.soft_spend_limit_enabled is distinct from old.soft_spend_limit_enabled
      or new.soft_spend_limit_kes is distinct from old.soft_spend_limit_kes
      or new.on_demand_usage_enabled is distinct from old.on_demand_usage_enabled
      or new.wallet_low_alert_sent_at is distinct from old.wallet_low_alert_sent_at
      or new.wallet_empty_alert_sent_at is distinct from old.wallet_empty_alert_sent_at
      or new.line_paid_through is distinct from old.line_paid_through
      or new.line_grace_days is distinct from old.line_grace_days
      or new.line_status is distinct from old.line_status
      or new.sms_included_units is distinct from old.sms_included_units
      or new.sms_used_units is distinct from old.sms_used_units
      or new.email_included_units is distinct from old.email_included_units
      or new.email_used_units is distinct from old.email_used_units
      or new.seat_included is distinct from old.seat_included
      or new.minutes_included is distinct from old.minutes_included
      or new.seconds_used is distinct from old.seconds_used
      or new.whatsapp_included_units is distinct from old.whatsapp_included_units
      or new.whatsapp_used_units is distinct from old.whatsapp_used_units
    then
      raise exception 'wallet/billing columns are RPC-only';
    end if;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.transition_subscription_billing_status(p_tenant_id uuid, p_to text, p_actor text, p_reason text DEFAULT NULL::text, p_voicemail_days integer DEFAULT NULL::integer)
 RETURNS tenant_subscriptions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sub public.tenant_subscriptions%rowtype;
  v_tenant public.tenants%rowtype;
  v_version public.billing_package_versions%rowtype;
  v_from text;
  v_days integer;
  v_vm timestamptz;
  v_trial_ends timestamptz;
  v_notice_kind text;
  v_notice_title text;
  v_notice_body text;
  v_when text;
  v_allowed_move boolean := false;
begin
  if p_tenant_id is null then
    raise exception 'business id required';
  end if;
  if p_to not in (
    'beta', 'trialing', 'active', 'past_due', 'grace', 'suspended', 'cancelled', 'archived'
  ) then
    raise exception 'unknown billing status %', p_to;
  end if;

  select * into v_sub
  from public.tenant_subscriptions
  where tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception 'no subscription';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then
    raise exception 'business not found';
  end if;

  v_from := v_sub.billing_status;
  if v_from = p_to then
    return v_sub;
  end if;

  if v_from = 'beta' and p_to in ('past_due', 'grace', 'suspended') then
    raise exception 'a beta business is not billed';
  end if;
  if v_from = 'beta' and p_to = 'active' and coalesce(v_tenant.billing_enforcement, 'off') = 'off' then
    raise exception 'set billing mode before active';
  end if;

  if v_from = 'beta' and p_to in ('trialing', 'active', 'cancelled', 'archived') then
    v_allowed_move := true;
  elsif v_from = 'trialing' and p_to in ('active', 'past_due', 'grace', 'suspended', 'cancelled', 'archived') then
    v_allowed_move := true;
  elsif v_from = 'active' and p_to in ('past_due', 'grace', 'suspended', 'cancelled', 'archived') then
    v_allowed_move := true;
  elsif v_from = 'past_due' and p_to in ('active', 'grace', 'suspended', 'cancelled', 'archived') then
    v_allowed_move := true;
  elsif v_from = 'grace' and p_to in ('active', 'past_due', 'suspended', 'cancelled', 'archived') then
    v_allowed_move := true;
  elsif v_from = 'suspended' and p_to in ('active', 'grace', 'cancelled', 'archived') then
    v_allowed_move := true;
  elsif v_from = 'cancelled' and p_to in ('active', 'trialing', 'archived') then
    v_allowed_move := true;
  elsif v_from = 'archived' and p_to in ('beta', 'active', 'cancelled') then
    v_allowed_move := true;
  end if;
  if not v_allowed_move then
    raise exception 'cannot move billing status from % to %', v_from, p_to;
  end if;

  if p_voicemail_days is not null and (p_voicemail_days < 1 or p_voicemail_days > 90) then
    raise exception 'voicemail hold must be 1 to 90 days';
  end if;
  select coalesce(p_voicemail_days, voicemail_hold_days)
    into v_days
  from public.billing_lifecycle_settings
  where id = 1;
  if v_days is null or v_days < 1 or v_days > 90 then
    raise exception 'voicemail hold must be 1 to 90 days';
  end if;

  v_vm := v_sub.voicemail_until;
  v_trial_ends := v_sub.trial_ends_at;
  v_notice_kind := null;

  if p_to = 'trialing' then
    select * into v_version
    from public.billing_package_versions
    where id = v_sub.package_version_id;
    if v_version.trial_days is null then
      raise exception 'this package version has no trial';
    end if;
    if v_trial_ends is null then
      v_trial_ends := now() + make_interval(days => v_version.trial_days);
    end if;
  end if;

  -- Trial end opens the voicemail window, except when the trial converts to active.
  -- Suspension opens it too. Active, and a non-trial past_due or grace, clear it
  -- because the Business Assistant still answers. Cancel keeps a window only when
  -- the trial itself just ended.
  if p_to in ('active', 'beta') or (p_to = 'trialing') then
    v_vm := null;
  elsif v_from = 'trialing' and p_to <> 'active' then
    v_vm := now() + make_interval(days => v_days);
    v_notice_kind := 'platform_billing_trial_ended';
  elsif p_to = 'suspended' then
    v_vm := now() + make_interval(days => v_days);
    v_notice_kind := 'platform_billing_suspended';
  elsif p_to in ('past_due', 'grace') and v_from <> 'trialing' then
    v_vm := null;
    if p_to = 'past_due' then
      v_notice_kind := 'platform_billing_past_due';
    end if;
  end if;

  perform set_config('scalers.billing_transition', '1', true);
  update public.tenant_subscriptions s
  set
    billing_status = p_to,
    billing_status_changed_at = now(),
    voicemail_until = v_vm,
    trial_ends_at = v_trial_ends,
    past_due_at = case
      when p_to = 'past_due' then coalesce(s.past_due_at, now())
      when p_to in ('active', 'trialing', 'beta') then null
      else s.past_due_at
    end,
    grace_started_at = case
      when p_to = 'grace' then coalesce(s.grace_started_at, now())
      when p_to in ('active', 'trialing', 'beta') then null
      else s.grace_started_at
    end,
    billing_suspended_at = case
      when p_to = 'suspended' then coalesce(s.billing_suspended_at, now())
      when p_to in ('active', 'trialing', 'beta') then null
      else s.billing_suspended_at
    end,
    billing_cancelled_at = case
      when p_to = 'cancelled' then coalesce(s.billing_cancelled_at, now())
      when p_to in ('active', 'trialing', 'beta') then null
      else s.billing_cancelled_at
    end,
    billing_archived_at = case
      when p_to = 'archived' then coalesce(s.billing_archived_at, now())
      else s.billing_archived_at
    end,
    updated_at = now()
  where s.tenant_id = p_tenant_id
  returning * into v_sub;

  insert into public.subscription_events (tenant_id, from_status, to_status, actor, reason, detail)
  values (
    p_tenant_id, v_from, p_to, coalesce(nullif(btrim(p_actor), ''), 'system'), p_reason,
    jsonb_build_object(
      'billing_enforcement', v_tenant.billing_enforcement,
      'line_status', v_tenant.line_status,
      'minutes_included', v_tenant.minutes_included,
      'package_clock_status', v_sub.status,
      'voicemail_until', v_vm,
      'note', 'does not change enforcement, line status, minutes, or the package clock'
    )
  );

  perform public._billing_audit(
    p_actor,
    'billing_status_' || p_to,
    p_tenant_id,
    jsonb_build_object('from', v_from, 'to', p_to, 'reason', p_reason, 'voicemail_until', v_vm)
  );

  if v_notice_kind is not null then
    v_when := public.billing_notice_when(v_vm);
    if v_notice_kind = 'platform_billing_trial_ended' then
      v_notice_title := 'Trial ended';
      v_notice_body := 'Your Business Assistant trial has ended. Callers can leave a voicemail until '
        || v_when || '. After that, callers hear that this line is not available.';
    elsif v_notice_kind = 'platform_billing_suspended' then
      v_notice_title := 'Line suspended';
      v_notice_body := 'Your line is suspended. Callers can leave a voicemail until '
        || v_when || '. After that, callers hear that this line is not available.';
    elsif v_notice_kind = 'platform_billing_past_due' then
      v_notice_title := 'Payment past due';
      v_notice_body := 'Your Business Assistant payment is past due. The line stays on until it is suspended.';
    end if;
    perform public.enqueue_billing_notice(
      p_tenant_id,
      v_notice_kind,
      v_notice_kind || ':' || p_tenant_id::text || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
      v_notice_title,
      v_notice_body
    );
  end if;

  return v_sub;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.unarchive_tenant_billing(p_tenant_id uuid, p_actor text, p_reason text DEFAULT NULL::text)
 RETURNS TABLE(audited boolean, billing_enforcement text, on_demand_enabled boolean, pre_archive_billing text, pre_archive_on_demand boolean, period_lapsed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_t record;
  v_last record;
  v_before jsonb;
  v_lapsed boolean := false;
  v_found boolean;
  v_was_archived boolean := false;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id required';
  end if;
  if coalesce(trim(p_actor), '') = '' then
    raise exception 'actor required';
  end if;

  select t.id, t.archived_at,
         coalesce(t.billing_enforcement, 'off') as billing_enforcement,
         coalesce(t.on_demand_usage_enabled, false) as on_demand
    into v_t
  from public.tenants t
  where t.id = p_tenant_id
  for update;

  if not found then
    raise exception 'This business no longer exists.';
  end if;
  if v_t.archived_at is not null then
    raise exception 'Unarchive the business before resuming its billing.';
  end if;

  select l.action, l.detail
    into v_last
  from public.ops_audit_log l
  where l.tenant_id = p_tenant_id
    and l.action in ('archive_tenant_billing', 'unarchive_tenant_billing')
  order by l.created_at desc, l.id desc
  limit 1;
  v_found := found;

  if v_found then
    v_was_archived := v_last.action = 'archive_tenant_billing';
    v_before := case when v_was_archived then v_last.detail->'before'
                     else v_last.detail->'pre_archive' end;
  end if;

  if to_regclass('public.tenant_subscriptions') is not null then
    execute 'select coalesce(bool_or(s.current_period_end <= now()), false)
               from public.tenant_subscriptions s where s.tenant_id = $1'
      into v_lapsed using p_tenant_id;
  end if;

  -- Only the first call after an archive writes a row. Re-runs add nothing.
  audited := v_was_archived;
  if audited then
    insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
    values (
      trim(p_actor),
      'unarchive_tenant_billing',
      p_tenant_id,
      null,
      jsonb_build_object(
        'reason', nullif(trim(coalesce(p_reason, '')), ''),
        'archived_at', v_last.detail->'archived_at',
        'pre_archive', v_before,
        'now', jsonb_build_object(
          'billing_enforcement', v_t.billing_enforcement,
          'on_demand_usage_enabled', v_t.on_demand),
        'restored', '[]'::jsonb,
        'period_lapsed', v_lapsed,
        'note', 'Billing mode and on-demand stay as they are until an admin turns them on.'
      )
    );
  end if;

  billing_enforcement := v_t.billing_enforcement;
  on_demand_enabled := v_t.on_demand;
  pre_archive_billing := v_before->>'billing_enforcement';
  pre_archive_on_demand := (v_before->>'on_demand_usage_enabled')::boolean;
  period_lapsed := v_lapsed;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.unassign_tenant_package(p_tenant_id uuid, p_when text, p_note text, p_actor text DEFAULT 'ops'::text)
 RETURNS TABLE(tenant_id uuid, package_state text, effective_at timestamp with time zone, minutes_included integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_actor text := coalesce(nullif(trim(p_actor), ''), 'ops');
  v_note text := trim(coalesce(p_note, ''));
  v_when text := lower(trim(coalesce(p_when, '')));
  v_sub record;
  v_grants integer;
  v_after integer;
  v_effective timestamptz;
  v_state text;
  v_before jsonb;
begin
  if p_tenant_id is null then
    raise exception 'tenant required';
  end if;
  if v_when not in ('now', 'period_end') then
    raise exception 'when must be now or period_end';
  end if;
  if length(v_note) < 3 then
    raise exception 'note required (min 3 chars)';
  end if;

  perform 1 from public.tenants t where t.id = p_tenant_id for update;
  if not found then
    raise exception 'tenant not found';
  end if;

  select s.* into v_sub
  from public.tenant_subscriptions s where s.tenant_id = p_tenant_id for update;

  if not found or v_sub.status <> 'active' then
    -- Already no package: idempotent no-op.
    select t.minutes_included into v_after from public.tenants t where t.id = p_tenant_id;
    tenant_id := p_tenant_id; package_state := 'none'; effective_at := null;
    minutes_included := v_after;
    return next;
    return;
  end if;
  v_before := public._billing_package_snapshot(p_tenant_id);

  if v_when = 'period_end' then
    if v_sub.current_period_end is null then
      raise exception 'subscription has no period end; use now';
    end if;
    -- Rule 10: at the end of the billing term (prepaid year for annual).
    v_effective := greatest(coalesce(v_sub.term_end, v_sub.current_period_end), v_sub.current_period_end);
    if v_sub.pending_change is distinct from 'unassign' then
      update public.tenant_subscriptions s
        set pending_package_id = null, pending_period = null, pending_change = 'unassign',
            pending_effective_at = v_effective, pending_set_at = now(),
            pending_actor = v_actor, updated_at = now()
      where s.tenant_id = p_tenant_id;
      insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
      values (v_actor, 'unassign_package', p_tenant_id, null, jsonb_build_object(
        'when', 'period_end', 'package_id', v_sub.package_id,
        'effective_at', v_effective, 'note', v_note,
        'before', v_before,
        'after', public._billing_package_snapshot_of(
          null, null, v_effective, public.billing_add_months(v_effective, 1), 'none'),
        'scheduled', true));
    end if;
    v_state := 'active';
  else
    update public.tenant_subscriptions s
      set status = 'cancelled', ended_at = now(), updated_at = now(),
          pending_package_id = null, pending_period = null, pending_change = null,
          pending_effective_at = null, pending_set_at = null, pending_actor = null
    where s.tenant_id = p_tenant_id;
    v_grants := public.billing_grant_minutes_for_period(
      p_tenant_id, v_sub.current_period_start, v_sub.current_period_end);
    perform public._tenant_set_allowances(p_tenant_id, null, v_grants);
    insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
    values (v_actor, 'unassign_package', p_tenant_id, null, jsonb_build_object(
      'when', 'now', 'package_id', v_sub.package_id, 'grant_minutes_kept', v_grants,
      'note', v_note,
      'before', v_before,
      'after', public._billing_package_snapshot(p_tenant_id),
      'scheduled', false));
    v_state := 'none';
    v_effective := now();
  end if;

  select t.minutes_included into v_after from public.tenants t where t.id = p_tenant_id;
  tenant_id := p_tenant_id;
  package_state := v_state;
  effective_at := v_effective;
  minutes_included := v_after;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.voice_wallet_alert_observe(p_thresholds bigint[], p_balance_minor bigint, p_source text, p_observed_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(threshold_minor bigint, action text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
begin
  if p_balance_minor is null or p_thresholds is null then
    return;
  end if;

  insert into public.voice_wallet_alert_state (threshold_minor)
  select distinct t from unnest(p_thresholds) as t where t > 0
  on conflict (threshold_minor) do nothing;

  return query
  update public.voice_wallet_alert_state s
     set crossed = false,
         rearmed_at = now(),
         last_balance_minor = p_balance_minor,
         last_source = p_source,
         observed_at = p_observed_at,
         updated_at = now()
   where s.threshold_minor = any (p_thresholds)
     and s.crossed
     and p_balance_minor > s.threshold_minor
     and (s.observed_at is null or s.observed_at <= p_observed_at)
  returning s.threshold_minor, 'rearmed'::text;

  return query
  update public.voice_wallet_alert_state s
     set crossed = true,
         crossed_at = now(),
         last_balance_minor = p_balance_minor,
         last_source = p_source,
         observed_at = p_observed_at,
         updated_at = now()
   where s.threshold_minor = any (p_thresholds)
     and not s.crossed
     and p_balance_minor <= s.threshold_minor
     and (s.observed_at is null or s.observed_at <= p_observed_at)
  returning s.threshold_minor, 'crossed'::text;

  update public.voice_wallet_alert_state s
     set last_balance_minor = p_balance_minor,
         last_source = p_source,
         observed_at = p_observed_at,
         updated_at = now()
   where s.threshold_minor = any (p_thresholds)
     and (s.observed_at is null or s.observed_at < p_observed_at);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.voice_wallet_alert_release(p_thresholds bigint[])
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update public.voice_wallet_alert_state
     set crossed = false, crossed_at = null, updated_at = now()
   where threshold_minor = any (p_thresholds) and crossed;
$function$
;

CREATE OR REPLACE FUNCTION public.waive_tenant_overage(p_tenant_id uuid, p_note text, p_actor text DEFAULT 'ops'::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS TABLE(tenant_id uuid, wallet_balance_kes numeric, waived_kes numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor text := coalesce(nullif(trim(p_actor), ''), 'ops');
  v_note text := trim(coalesce(p_note, ''));
  v_key text := nullif(trim(p_idempotency_key), '');
  v_bal numeric;
  v_waived numeric := 0;
  v_row record;
begin
  if p_tenant_id is null then
    raise exception 'tenant required';
  end if;
  if v_note is null or length(v_note) < 3 then
    raise exception 'note required (min 3 chars)';
  end if;

  select t.wallet_balance_kes into v_bal from public.tenants t where t.id = p_tenant_id;
  if not found then
    raise exception 'tenant not found';
  end if;

  if coalesce(v_bal, 0) >= 0 then
    tenant_id := p_tenant_id;
    wallet_balance_kes := coalesce(v_bal, 0);
    waived_kes := 0;
    return next;
    return;
  end if;

  if v_key is not null then
    if exists (
      select 1
      from public.ops_audit_log o
      where o.tenant_id = p_tenant_id
        and o.action = 'waive_overage'
        and o.detail->>'idempotency_key' = v_key
    ) then
      select t.wallet_balance_kes into v_bal from public.tenants t where t.id = p_tenant_id;
      tenant_id := p_tenant_id;
      wallet_balance_kes := coalesce(v_bal, 0);
      waived_kes := 0;
      return next;
      return;
    end if;
  end if;

  v_waived := abs(v_bal);
  select * into v_row
  from public._wallet_apply_delta(
    p_tenant_id,
    'trial_credit',
    v_waived,
    'waive_overage',
    coalesce(v_key, 'waive:' || p_tenant_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS')),
    v_note,
    jsonb_build_object('actor', v_actor, 'source', 'admin_billing')
  );

  insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
  values (
    v_actor,
    'waive_overage',
    p_tenant_id,
    v_waived,
    jsonb_build_object(
      'note', v_note,
      'waived_kes', v_waived,
      'balance_after', v_row.wallet_balance_kes,
      'idempotency_key', v_key
    )
  );

  tenant_id := p_tenant_id;
  wallet_balance_kes := v_row.wallet_balance_kes;
  waived_kes := v_waived;
  return next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.wallet_ledger_deny_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ begin raise exception 'wallet_ledger is append-only'; end; $function$
;

-- ============================================================
-- Check constraints (after functions, some call them)
-- ============================================================

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_company_id_check' and conrelid = 'public.billing_company'::regclass) then
    alter table public.billing_company add constraint billing_company_id_check CHECK ((id = 1));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_company_legal_name_check' and conrelid = 'public.billing_company'::regclass) then
    alter table public.billing_company add constraint billing_company_legal_name_check CHECK ((length(btrim(legal_name)) > 0));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_company_product_check' and conrelid = 'public.billing_company'::regclass) then
    alter table public.billing_company add constraint billing_company_product_check CHECK ((length(btrim(product)) > 0));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_lifecycle_settings_bachs_mode_check' and conrelid = 'public.billing_lifecycle_settings'::regclass) then
    alter table public.billing_lifecycle_settings add constraint billing_lifecycle_settings_bachs_mode_check CHECK ((bachs_payments_mode = ANY (ARRAY['off'::text, 'sandbox'::text, 'live'::text])));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_lifecycle_settings_hold_check' and conrelid = 'public.billing_lifecycle_settings'::regclass) then
    alter table public.billing_lifecycle_settings add constraint billing_lifecycle_settings_hold_check CHECK (((voicemail_hold_days >= 1) AND (voicemail_hold_days <= 90)));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_lifecycle_settings_id_check' and conrelid = 'public.billing_lifecycle_settings'::regclass) then
    alter table public.billing_lifecycle_settings add constraint billing_lifecycle_settings_id_check CHECK ((id = 1));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_lifecycle_settings_number_hold_days_check' and conrelid = 'public.billing_lifecycle_settings'::regclass) then
    alter table public.billing_lifecycle_settings add constraint billing_lifecycle_settings_number_hold_days_check CHECK (((number_hold_days >= 1) AND (number_hold_days <= 90)));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_lifecycle_settings_reactivation_fee_check' and conrelid = 'public.billing_lifecycle_settings'::regclass) then
    alter table public.billing_lifecycle_settings add constraint billing_lifecycle_settings_reactivation_fee_check CHECK (((reactivation_fee_kes IS NULL) OR (reactivation_fee_kes > (0)::numeric)));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_lifecycle_settings_threshold_check' and conrelid = 'public.billing_lifecycle_settings'::regclass) then
    alter table public.billing_lifecycle_settings add constraint billing_lifecycle_settings_threshold_check CHECK (((price_change_approval_threshold_kes IS NULL) OR (price_change_approval_threshold_kes >= (0)::numeric)));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_notices_audience_check' and conrelid = 'public.billing_notices'::regclass) then
    alter table public.billing_notices add constraint billing_notices_audience_check CHECK ((audience = 'staff'::text));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_notices_billed_to_check' and conrelid = 'public.billing_notices'::regclass) then
    alter table public.billing_notices add constraint billing_notices_billed_to_check CHECK ((billed_to = 'platform'::text));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_notices_channel_check' and conrelid = 'public.billing_notices'::regclass) then
    alter table public.billing_notices add constraint billing_notices_channel_check CHECK (((channel IS NULL) OR (channel = ANY (ARRAY['sms'::text, 'whatsapp'::text, 'email'::text]))));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_notices_delivery_status_check' and conrelid = 'public.billing_notices'::regclass) then
    alter table public.billing_notices add constraint billing_notices_delivery_status_check CHECK ((delivery_status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_notices_kind_check' and conrelid = 'public.billing_notices'::regclass) then
    alter table public.billing_notices add constraint billing_notices_kind_check CHECK ((kind = ANY (ARRAY['platform_billing_trial_ending'::text, 'platform_billing_trial_ended'::text, 'platform_billing_invoice_due'::text, 'platform_billing_past_due'::text, 'platform_billing_suspended'::text, 'platform_billing_invoice_issued'::text, 'platform_billing_invoice_due_soon'::text, 'platform_billing_payment_received'::text, 'platform_billing_invoice_overdue'::text])));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_version_approvals_status_check' and conrelid = 'public.billing_package_version_approvals'::regclass) then
    alter table public.billing_package_version_approvals add constraint billing_package_version_approvals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_annual_discount_percent_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_annual_discount_percent_check CHECK (((annual_discount_percent >= (0)::numeric) AND (annual_discount_percent <= (100)::numeric)));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_desk_terms_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_desk_terms_check CHECK (((annual_price_kes >= (0)::numeric) AND (credit_kes >= (0)::numeric) AND (spend_limit_share_percent >= (0)::numeric) AND (spend_limit_share_percent <= (100)::numeric)));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_dids_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_dids_check CHECK ((dids >= 0));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_email_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_email_check CHECK ((email >= 0));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_email_kes_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_email_kes_check CHECK ((email_kes >= (0)::numeric));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_extra_seat_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_extra_seat_check CHECK (((extra_seat_monthly_kes IS NULL) OR (extra_seat_monthly_kes >= (0)::numeric)));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_inbound_kes_per_second_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_inbound_kes_per_second_check CHECK ((inbound_kes_per_second >= (0)::numeric));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_message_credits_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_message_credits_check CHECK ((((message_credits IS NULL) OR (message_credits >= 0)) AND ((sms_credit_burn IS NULL) OR (sms_credit_burn >= (0)::numeric)) AND ((whatsapp_credit_burn IS NULL) OR (whatsapp_credit_burn >= (0)::numeric)) AND ((email_credit_burn IS NULL) OR (email_credit_burn >= (0)::numeric))));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_minutes_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_minutes_check CHECK ((minutes >= 0));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_monthly_price_kes_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_monthly_price_kes_check CHECK ((monthly_price_kes >= (0)::numeric));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_outbound_kes_per_second_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_outbound_kes_per_second_check CHECK ((outbound_kes_per_second >= (0)::numeric));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_seats_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_seats_check CHECK ((seats >= 0));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_sms_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_sms_check CHECK ((sms >= 0));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_sms_kes_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_sms_kes_check CHECK ((sms_kes >= (0)::numeric));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_staff_wa_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_staff_wa_check CHECK ((staff_wa >= 0));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_status_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'retired'::text])));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_trial_days_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_trial_days_check CHECK (((trial_days IS NULL) OR ((trial_days >= 1) AND (trial_days <= 90))));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_version_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_version_check CHECK ((version >= 1));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_package_versions_whatsapp_kes_check' and conrelid = 'public.billing_package_versions'::regclass) then
    alter table public.billing_package_versions add constraint billing_package_versions_whatsapp_kes_check CHECK ((whatsapp_kes >= (0)::numeric));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_packages_dids_check' and conrelid = 'public.billing_packages'::regclass) then
    alter table public.billing_packages add constraint billing_packages_dids_check CHECK ((dids >= 0));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_packages_email_check' and conrelid = 'public.billing_packages'::regclass) then
    alter table public.billing_packages add constraint billing_packages_email_check CHECK ((email >= 0));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_packages_minutes_check' and conrelid = 'public.billing_packages'::regclass) then
    alter table public.billing_packages add constraint billing_packages_minutes_check CHECK ((minutes >= 0));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_packages_price_check' and conrelid = 'public.billing_packages'::regclass) then
    alter table public.billing_packages add constraint billing_packages_price_check CHECK ((monthly_price_kes >= (0)::numeric));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_packages_seats_check' and conrelid = 'public.billing_packages'::regclass) then
    alter table public.billing_packages add constraint billing_packages_seats_check CHECK ((seats >= 0));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_packages_sku_check' and conrelid = 'public.billing_packages'::regclass) then
    alter table public.billing_packages add constraint billing_packages_sku_check CHECK ((sku ~ '^[a-z][a-z0-9_-]{1,31}$'::text));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_packages_sms_check' and conrelid = 'public.billing_packages'::regclass) then
    alter table public.billing_packages add constraint billing_packages_sms_check CHECK ((sms >= 0));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_packages_wa_check' and conrelid = 'public.billing_packages'::regclass) then
    alter table public.billing_packages add constraint billing_packages_wa_check CHECK ((staff_wa >= 0));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_rate_card_discount_check' and conrelid = 'public.billing_rate_card'::regclass) then
    alter table public.billing_rate_card add constraint billing_rate_card_discount_check CHECK (((annual_discount_percent >= (0)::numeric) AND (annual_discount_percent <= (100)::numeric)));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_rate_card_email_check' and conrelid = 'public.billing_rate_card'::regclass) then
    alter table public.billing_rate_card add constraint billing_rate_card_email_check CHECK ((email_kes >= (0)::numeric));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_rate_card_id_check' and conrelid = 'public.billing_rate_card'::regclass) then
    alter table public.billing_rate_card add constraint billing_rate_card_id_check CHECK ((id = 1));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_rate_card_inbound_check' and conrelid = 'public.billing_rate_card'::regclass) then
    alter table public.billing_rate_card add constraint billing_rate_card_inbound_check CHECK ((inbound_kes_per_second >= (0)::numeric));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_rate_card_outbound_check' and conrelid = 'public.billing_rate_card'::regclass) then
    alter table public.billing_rate_card add constraint billing_rate_card_outbound_check CHECK ((outbound_kes_per_second >= (0)::numeric));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_rate_card_sms_check' and conrelid = 'public.billing_rate_card'::regclass) then
    alter table public.billing_rate_card add constraint billing_rate_card_sms_check CHECK ((sms_kes >= (0)::numeric));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'billing_rate_card_wa_check' and conrelid = 'public.billing_rate_card'::regclass) then
    alter table public.billing_rate_card add constraint billing_rate_card_wa_check CHECK ((whatsapp_kes >= (0)::numeric));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_lines_kind_check' and conrelid = 'public.invoice_lines'::regclass) then
    alter table public.invoice_lines add constraint invoice_lines_kind_check CHECK (((kind IS NULL) OR (kind = ANY (ARRAY['plan'::text, 'extra_minutes'::text, 'extra_seats'::text, 'message_credits'::text, 'proration'::text]))));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_lines_quantity_check' and conrelid = 'public.invoice_lines'::regclass) then
    alter table public.invoice_lines add constraint invoice_lines_quantity_check CHECK ((quantity >= (0)::numeric));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoice_receipts_amount_kes_check' and conrelid = 'public.invoice_receipts'::regclass) then
    alter table public.invoice_receipts add constraint invoice_receipts_amount_kes_check CHECK ((amount_kes > (0)::numeric));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_amount_paid_kes_check' and conrelid = 'public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_amount_paid_kes_check CHECK ((amount_paid_kes >= (0)::numeric));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_billing_source_check' and conrelid = 'public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_billing_source_check CHECK (((billing_source IS NULL) OR (billing_source = ANY (ARRAY['proration'::text, 'next'::text]))));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_credits_applied_kes_check' and conrelid = 'public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_credits_applied_kes_check CHECK (((credits_applied_kes IS NULL) OR (credits_applied_kes >= (0)::numeric)));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_currency_check' and conrelid = 'public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_currency_check CHECK ((currency = 'KES'::text));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_status_check' and conrelid = 'public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'open'::text, 'paid'::text, 'void'::text, 'uncollectible'::text])));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_tax_kes_check' and conrelid = 'public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_tax_kes_check CHECK (((tax_kes IS NULL) OR (tax_kes >= (0)::numeric)));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'payment_attempts_status_check' and conrelid = 'public.payment_attempts'::regclass) then
    alter table public.payment_attempts add constraint payment_attempts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'pending_unattached'::text, 'succeeded'::text, 'failed'::text, 'issue'::text, 'cancelled'::text, 'superseded'::text])));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_amount_kes_check' and conrelid = 'public.payments'::regclass) then
    alter table public.payments add constraint payments_amount_kes_check CHECK ((amount_kes > (0)::numeric));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_match_status_check' and conrelid = 'public.payments'::regclass) then
    alter table public.payments add constraint payments_match_status_check CHECK ((match_status = ANY (ARRAY['matched'::text, 'partial'::text, 'over'::text, 'unmatched'::text, 'issue'::text])));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_credits_amount_kes_check' and conrelid = 'public.tenant_credits'::regclass) then
    alter table public.tenant_credits add constraint tenant_credits_amount_kes_check CHECK ((amount_kes <> (0)::numeric));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_minute_grants_minutes_check' and conrelid = 'public.tenant_minute_grants'::regclass) then
    alter table public.tenant_minute_grants add constraint tenant_minute_grants_minutes_check CHECK (((minutes >= 1) AND (minutes <= 100000)));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_subscriptions_billing_status_check' and conrelid = 'public.tenant_subscriptions'::regclass) then
    alter table public.tenant_subscriptions add constraint tenant_subscriptions_billing_status_check CHECK (((billing_status IS NULL) OR (billing_status = ANY (ARRAY['beta'::text, 'trialing'::text, 'active'::text, 'past_due'::text, 'grace'::text, 'suspended'::text, 'cancelled'::text, 'archived'::text]))));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_subscriptions_collection_method_check' and conrelid = 'public.tenant_subscriptions'::regclass) then
    alter table public.tenant_subscriptions add constraint tenant_subscriptions_collection_method_check CHECK (((collection_method IS NULL) OR (collection_method = ANY (ARRAY['bachs'::text, 'daraja'::text, 'manual'::text]))));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_subscriptions_extra_seats_check' and conrelid = 'public.tenant_subscriptions'::regclass) then
    alter table public.tenant_subscriptions add constraint tenant_subscriptions_extra_seats_check CHECK ((extra_seats >= 0));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_subscriptions_pending_check' and conrelid = 'public.tenant_subscriptions'::regclass) then
    alter table public.tenant_subscriptions add constraint tenant_subscriptions_pending_check CHECK ((((pending_change IS NULL) AND (pending_package_id IS NULL) AND (pending_period IS NULL) AND (pending_effective_at IS NULL)) OR ((pending_change = ANY (ARRAY['downgrade'::text, 'period_change'::text, 'upgrade'::text])) AND (pending_package_id IS NOT NULL) AND (pending_period = ANY (ARRAY['month'::text, 'year'::text])) AND (pending_effective_at IS NOT NULL)) OR ((pending_change = 'unassign'::text) AND (pending_package_id IS NULL) AND (pending_period IS NULL) AND (pending_effective_at IS NOT NULL))));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_subscriptions_period_check' and conrelid = 'public.tenant_subscriptions'::regclass) then
    alter table public.tenant_subscriptions add constraint tenant_subscriptions_period_check CHECK ((period = ANY (ARRAY['month'::text, 'year'::text])));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_subscriptions_status_check' and conrelid = 'public.tenant_subscriptions'::regclass) then
    alter table public.tenant_subscriptions add constraint tenant_subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text])));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'voice_wallet_alert_state_threshold_minor_check' and conrelid = 'public.voice_wallet_alert_state'::regclass) then
    alter table public.voice_wallet_alert_state add constraint voice_wallet_alert_state_threshold_minor_check CHECK ((threshold_minor > 0));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'wallet_ledger_currency_check' and conrelid = 'public.wallet_ledger'::regclass) then
    alter table public.wallet_ledger add constraint wallet_ledger_currency_check CHECK ((currency = 'KES'::text));
  end if;
end $m$;

do $m$ begin
  if not exists (select 1 from pg_constraint where conname = 'wallet_ledger_kind_check' and conrelid = 'public.wallet_ledger'::regclass) then
    alter table public.wallet_ledger add constraint wallet_ledger_kind_check CHECK ((kind = ANY (ARRAY['topup'::text, 'call_charge'::text, 'line_rental'::text, 'admin_adjustment'::text, 'migration_credit'::text, 'trial_credit'::text, 'sms_charge'::text])));
  end if;
end $m$;

-- ============================================================
-- Views
-- ============================================================

do $m$ begin
  execute $vdef$create or replace view public.billing_notice_outbox with (security_invoker=true) as
 SELECT id,
    tenant_id,
    kind,
    title,
    body,
    channel,
    recipient,
    fallback,
    audience,
    billed_to,
    delivery_status,
    idempotency_key,
    notify_send_id,
    last_error,
    read_at,
    claimed_at,
    created_at
   FROM billing_notices
  WHERE (delivery_status = ANY (ARRAY['pending'::text, 'sending'::text]))$vdef$;
exception when invalid_table_definition or feature_not_supported then
  -- column list changed: replace the view (fails loudly if another object depends on it)
  execute 'drop view public.'||quote_ident('billing_notice_outbox');
  execute $vdef$create or replace view public.billing_notice_outbox with (security_invoker=true) as
 SELECT id,
    tenant_id,
    kind,
    title,
    body,
    channel,
    recipient,
    fallback,
    audience,
    billed_to,
    delivery_status,
    idempotency_key,
    notify_send_id,
    last_error,
    read_at,
    claimed_at,
    created_at
   FROM billing_notices
  WHERE (delivery_status = ANY (ARRAY['pending'::text, 'sending'::text]))$vdef$;
end $m$;

do $m$ begin
  execute $vdef$create or replace view public.billing_subscription_read with (security_invoker=true) as
 SELECT s.tenant_id,
    t.business_name,
    p.sku AS package_sku,
    p.name AS package_name,
    p.is_active AS package_listed,
    s.status AS package_clock_status,
    s.billing_status,
    s.package_version_id,
    v.version AS package_version,
    v.monthly_price_kes AS version_monthly_price_kes,
    v.minutes AS version_minutes,
    v.sms AS version_sms,
    v.email AS version_email,
    v.seats AS version_seats,
    v.staff_wa AS version_staff_wa,
    v.dids AS version_dids,
    v.trial_days,
    v.allowances_placeholder,
    v.active_from AS version_active_from,
    s.trial_ends_at,
    s.voicemail_until,
    s.past_due_at,
    s.grace_started_at,
    s.billing_suspended_at,
    s.billing_cancelled_at,
    s.billing_archived_at,
    s.paid_through,
    s.collection_method,
    t.billing_enforcement,
    t.line_status,
    t.minutes_included,
    t.seconds_used,
    t.on_demand_usage_enabled
   FROM (((tenant_subscriptions s
     JOIN tenants t ON ((t.id = s.tenant_id)))
     JOIN billing_packages p ON ((p.id = s.package_id)))
     LEFT JOIN billing_package_versions v ON ((v.id = s.package_version_id)))$vdef$;
exception when invalid_table_definition or feature_not_supported then
  -- column list changed: replace the view (fails loudly if another object depends on it)
  execute 'drop view public.'||quote_ident('billing_subscription_read');
  execute $vdef$create or replace view public.billing_subscription_read with (security_invoker=true) as
 SELECT s.tenant_id,
    t.business_name,
    p.sku AS package_sku,
    p.name AS package_name,
    p.is_active AS package_listed,
    s.status AS package_clock_status,
    s.billing_status,
    s.package_version_id,
    v.version AS package_version,
    v.monthly_price_kes AS version_monthly_price_kes,
    v.minutes AS version_minutes,
    v.sms AS version_sms,
    v.email AS version_email,
    v.seats AS version_seats,
    v.staff_wa AS version_staff_wa,
    v.dids AS version_dids,
    v.trial_days,
    v.allowances_placeholder,
    v.active_from AS version_active_from,
    s.trial_ends_at,
    s.voicemail_until,
    s.past_due_at,
    s.grace_started_at,
    s.billing_suspended_at,
    s.billing_cancelled_at,
    s.billing_archived_at,
    s.paid_through,
    s.collection_method,
    t.billing_enforcement,
    t.line_status,
    t.minutes_included,
    t.seconds_used,
    t.on_demand_usage_enabled
   FROM (((tenant_subscriptions s
     JOIN tenants t ON ((t.id = s.tenant_id)))
     JOIN billing_packages p ON ((p.id = s.package_id)))
     LEFT JOIN billing_package_versions v ON ((v.id = s.package_version_id)))$vdef$;
end $m$;

do $m$ begin
  execute $vdef$create or replace view public.notify_sms_billable with (security_invoker=true) as
 SELECT id,
    tenant_id,
    created_at,
    kind,
    audience,
    units,
    overage,
    provider_message_id,
    idempotency_key
   FROM notify_sends n
  WHERE ((channel = 'sms'::text) AND (billed_to = 'tenant'::text) AND (status = 'sent'::text) AND (tenant_id IS NOT NULL))$vdef$;
exception when invalid_table_definition or feature_not_supported then
  -- column list changed: replace the view (fails loudly if another object depends on it)
  execute 'drop view public.'||quote_ident('notify_sms_billable');
  execute $vdef$create or replace view public.notify_sms_billable with (security_invoker=true) as
 SELECT id,
    tenant_id,
    created_at,
    kind,
    audience,
    units,
    overage,
    provider_message_id,
    idempotency_key
   FROM notify_sends n
  WHERE ((channel = 'sms'::text) AND (billed_to = 'tenant'::text) AND (status = 'sent'::text) AND (tenant_id IS NOT NULL))$vdef$;
end $m$;

do $m$ begin
  execute $vdef$create or replace view public.tenant_billing_state with (security_invoker=true) as
 WITH ps AS (
         SELECT t.id AS tenant_id,
            s.status AS sub_status,
            s.package_id,
            s.period,
            COALESCE(s.current_period_start, (date_trunc('month'::text, (now() AT TIME ZONE 'Africa/Nairobi'::text)) AT TIME ZONE 'Africa/Nairobi'::text)) AS period_start,
                CASE
                    WHEN (s.tenant_id IS NULL) THEN billing_add_months((date_trunc('month'::text, (now() AT TIME ZONE 'Africa/Nairobi'::text)) AT TIME ZONE 'Africa/Nairobi'::text), 1)
                    ELSE s.current_period_end
                END AS period_end,
            s.term_start,
            s.term_end,
            s.pending_change,
            s.pending_package_id,
            s.pending_period,
            s.pending_effective_at
           FROM (tenants t
             LEFT JOIN tenant_subscriptions s ON ((s.tenant_id = t.id)))
        ), base AS (
         SELECT t.id AS tenant_id,
            t.business_name,
                CASE
                    WHEN (ps.sub_status = 'active'::text) THEN 'active'::text
                    ELSE 'none'::text
                END AS package_state,
                CASE
                    WHEN (ps.sub_status = 'active'::text) THEN ps.package_id
                    ELSE NULL::uuid
                END AS package_id,
                CASE
                    WHEN (ps.sub_status = 'active'::text) THEN p.sku
                    ELSE NULL::text
                END AS package_sku,
                CASE
                    WHEN (ps.sub_status = 'active'::text) THEN p.name
                    ELSE NULL::text
                END AS package_name,
            ps.period AS billing_term,
            ps.term_start,
            ps.term_end,
            ps.period_start,
            ps.period_end,
            ps.pending_change,
            ps.pending_package_id,
            pp.sku AS pending_package_sku,
            ps.pending_period,
            ps.pending_effective_at,
            COALESCE(t.minutes_included, 0) AS included_minutes,
            billing_grant_minutes_for_period(t.id, ps.period_start, ps.period_end) AS granted_minutes,
            COALESCE(t.seconds_used, 0) AS used_seconds,
            COALESCE(t.sms_included_units, 0) AS sms_included,
            ( SELECT (COALESCE(sum(COALESCE(b_1.units, 1)), (0)::bigint))::integer AS "coalesce"
                   FROM notify_sms_billable b_1
                  WHERE ((b_1.tenant_id = t.id) AND (b_1.created_at >= ps.period_start) AND ((ps.period_end IS NULL) OR (b_1.created_at < ps.period_end)))) AS sms_used,
            'ledger'::text AS sms_used_source,
            COALESCE(t.sms_used_units, 0) AS sms_counter,
            COALESCE(t.on_demand_usage_enabled, false) AS on_demand_enabled,
            COALESCE(t.billing_enforcement, 'off'::text) AS enforcement_mode,
                CASE
                    WHEN COALESCE(t.soft_spend_limit_enabled, false) THEN t.soft_spend_limit_kes
                    ELSE NULL::numeric
                END AS spend_cap_kes,
            r.inbound_kes_per_second,
            r.sms_kes
           FROM ((((tenants t
             JOIN ps ON ((ps.tenant_id = t.id)))
             LEFT JOIN billing_packages p ON ((p.id = ps.package_id)))
             LEFT JOIN billing_packages pp ON ((pp.id = ps.pending_package_id)))
             LEFT JOIN billing_rate_card r ON ((r.id = 1)))
        )
 SELECT tenant_id,
    business_name,
    package_state,
    package_id,
    package_sku,
    package_name,
    billing_term,
    term_start,
    term_end,
    period_start,
    period_end,
    pending_change,
    pending_package_id,
    pending_package_sku,
    pending_period,
    pending_effective_at,
    included_minutes,
    GREATEST((included_minutes - granted_minutes), 0) AS package_minutes,
    granted_minutes,
    used_seconds,
    round(((used_seconds)::numeric / 60.0), 1) AS used_minutes,
    round(((GREATEST(((included_minutes * 60) - used_seconds), 0))::numeric / 60.0), 1) AS remaining_minutes,
    GREATEST((used_seconds - (included_minutes * 60)), 0) AS overage_seconds,
    sms_included,
    sms_used,
    sms_used_source,
    sms_counter,
    GREATEST((sms_used - sms_included), 0) AS sms_overage_units,
    on_demand_enabled,
    enforcement_mode,
        CASE
            WHEN (enforcement_mode <> ALL (ARRAY['soft'::text, 'hard'::text])) THEN 'beta'::text
            WHEN on_demand_enabled THEN 'metered'::text
            ELSE 'capped'::text
        END AS mode_label,
    spend_cap_kes,
        CASE
            WHEN ((enforcement_mode = ANY (ARRAY['soft'::text, 'hard'::text])) AND on_demand_enabled) THEN round((((GREATEST((used_seconds - (included_minutes * 60)), 0))::numeric * COALESCE(inbound_kes_per_second, (0)::numeric)) + ((GREATEST((sms_used - sms_included), 0))::numeric * COALESCE(sms_kes, (0)::numeric))), 2)
            ELSE (0)::numeric
        END AS overage_owed_kes
   FROM base b$vdef$;
exception when invalid_table_definition or feature_not_supported then
  -- column list changed: replace the view (fails loudly if another object depends on it)
  execute 'drop view public.'||quote_ident('tenant_billing_state');
  execute $vdef$create or replace view public.tenant_billing_state with (security_invoker=true) as
 WITH ps AS (
         SELECT t.id AS tenant_id,
            s.status AS sub_status,
            s.package_id,
            s.period,
            COALESCE(s.current_period_start, (date_trunc('month'::text, (now() AT TIME ZONE 'Africa/Nairobi'::text)) AT TIME ZONE 'Africa/Nairobi'::text)) AS period_start,
                CASE
                    WHEN (s.tenant_id IS NULL) THEN billing_add_months((date_trunc('month'::text, (now() AT TIME ZONE 'Africa/Nairobi'::text)) AT TIME ZONE 'Africa/Nairobi'::text), 1)
                    ELSE s.current_period_end
                END AS period_end,
            s.term_start,
            s.term_end,
            s.pending_change,
            s.pending_package_id,
            s.pending_period,
            s.pending_effective_at
           FROM (tenants t
             LEFT JOIN tenant_subscriptions s ON ((s.tenant_id = t.id)))
        ), base AS (
         SELECT t.id AS tenant_id,
            t.business_name,
                CASE
                    WHEN (ps.sub_status = 'active'::text) THEN 'active'::text
                    ELSE 'none'::text
                END AS package_state,
                CASE
                    WHEN (ps.sub_status = 'active'::text) THEN ps.package_id
                    ELSE NULL::uuid
                END AS package_id,
                CASE
                    WHEN (ps.sub_status = 'active'::text) THEN p.sku
                    ELSE NULL::text
                END AS package_sku,
                CASE
                    WHEN (ps.sub_status = 'active'::text) THEN p.name
                    ELSE NULL::text
                END AS package_name,
            ps.period AS billing_term,
            ps.term_start,
            ps.term_end,
            ps.period_start,
            ps.period_end,
            ps.pending_change,
            ps.pending_package_id,
            pp.sku AS pending_package_sku,
            ps.pending_period,
            ps.pending_effective_at,
            COALESCE(t.minutes_included, 0) AS included_minutes,
            billing_grant_minutes_for_period(t.id, ps.period_start, ps.period_end) AS granted_minutes,
            COALESCE(t.seconds_used, 0) AS used_seconds,
            COALESCE(t.sms_included_units, 0) AS sms_included,
            ( SELECT (COALESCE(sum(COALESCE(b_1.units, 1)), (0)::bigint))::integer AS "coalesce"
                   FROM notify_sms_billable b_1
                  WHERE ((b_1.tenant_id = t.id) AND (b_1.created_at >= ps.period_start) AND ((ps.period_end IS NULL) OR (b_1.created_at < ps.period_end)))) AS sms_used,
            'ledger'::text AS sms_used_source,
            COALESCE(t.sms_used_units, 0) AS sms_counter,
            COALESCE(t.on_demand_usage_enabled, false) AS on_demand_enabled,
            COALESCE(t.billing_enforcement, 'off'::text) AS enforcement_mode,
                CASE
                    WHEN COALESCE(t.soft_spend_limit_enabled, false) THEN t.soft_spend_limit_kes
                    ELSE NULL::numeric
                END AS spend_cap_kes,
            r.inbound_kes_per_second,
            r.sms_kes
           FROM ((((tenants t
             JOIN ps ON ((ps.tenant_id = t.id)))
             LEFT JOIN billing_packages p ON ((p.id = ps.package_id)))
             LEFT JOIN billing_packages pp ON ((pp.id = ps.pending_package_id)))
             LEFT JOIN billing_rate_card r ON ((r.id = 1)))
        )
 SELECT tenant_id,
    business_name,
    package_state,
    package_id,
    package_sku,
    package_name,
    billing_term,
    term_start,
    term_end,
    period_start,
    period_end,
    pending_change,
    pending_package_id,
    pending_package_sku,
    pending_period,
    pending_effective_at,
    included_minutes,
    GREATEST((included_minutes - granted_minutes), 0) AS package_minutes,
    granted_minutes,
    used_seconds,
    round(((used_seconds)::numeric / 60.0), 1) AS used_minutes,
    round(((GREATEST(((included_minutes * 60) - used_seconds), 0))::numeric / 60.0), 1) AS remaining_minutes,
    GREATEST((used_seconds - (included_minutes * 60)), 0) AS overage_seconds,
    sms_included,
    sms_used,
    sms_used_source,
    sms_counter,
    GREATEST((sms_used - sms_included), 0) AS sms_overage_units,
    on_demand_enabled,
    enforcement_mode,
        CASE
            WHEN (enforcement_mode <> ALL (ARRAY['soft'::text, 'hard'::text])) THEN 'beta'::text
            WHEN on_demand_enabled THEN 'metered'::text
            ELSE 'capped'::text
        END AS mode_label,
    spend_cap_kes,
        CASE
            WHEN ((enforcement_mode = ANY (ARRAY['soft'::text, 'hard'::text])) AND on_demand_enabled) THEN round((((GREATEST((used_seconds - (included_minutes * 60)), 0))::numeric * COALESCE(inbound_kes_per_second, (0)::numeric)) + ((GREATEST((sms_used - sms_included), 0))::numeric * COALESCE(sms_kes, (0)::numeric))), 2)
            ELSE (0)::numeric
        END AS overage_owed_kes
   FROM base b$vdef$;
end $m$;

do $m$ begin
  execute $vdef$create or replace view public.tenant_credit_balance with (security_invoker=true) as
 SELECT tenant_id,
    sum(amount_kes) AS balance_kes
   FROM tenant_credits
  GROUP BY tenant_id$vdef$;
exception when invalid_table_definition or feature_not_supported then
  -- column list changed: replace the view (fails loudly if another object depends on it)
  execute 'drop view public.'||quote_ident('tenant_credit_balance');
  execute $vdef$create or replace view public.tenant_credit_balance with (security_invoker=true) as
 SELECT tenant_id,
    sum(amount_kes) AS balance_kes
   FROM tenant_credits
  GROUP BY tenant_id$vdef$;
end $m$;

-- ============================================================
-- Triggers
-- ============================================================

drop trigger if exists billing_audit_log_no_update on public.billing_audit_log;
CREATE TRIGGER billing_audit_log_no_update BEFORE DELETE OR UPDATE ON public.billing_audit_log FOR EACH ROW EXECUTE FUNCTION billing_audit_log_freeze();

drop trigger if exists billing_notices_guard on public.billing_notices;
CREATE TRIGGER billing_notices_guard BEFORE DELETE OR UPDATE ON public.billing_notices FOR EACH ROW EXECUTE FUNCTION billing_notices_guard();

drop trigger if exists billing_package_version_approvals_no_update on public.billing_package_version_approvals;
CREATE TRIGGER billing_package_version_approvals_no_update BEFORE DELETE OR UPDATE ON public.billing_package_version_approvals FOR EACH ROW EXECUTE FUNCTION billing_package_version_approvals_freeze();

drop trigger if exists billing_package_version_features_freeze on public.billing_package_version_features;
CREATE TRIGGER billing_package_version_features_freeze BEFORE INSERT OR DELETE OR UPDATE ON public.billing_package_version_features FOR EACH ROW EXECUTE FUNCTION billing_package_version_features_freeze();

drop trigger if exists billing_package_versions_freeze on public.billing_package_versions;
CREATE TRIGGER billing_package_versions_freeze BEFORE UPDATE ON public.billing_package_versions FOR EACH ROW EXECUTE FUNCTION billing_package_versions_freeze();

drop trigger if exists billing_package_versions_freeze_seat on public.billing_package_versions;
CREATE TRIGGER billing_package_versions_freeze_seat BEFORE UPDATE ON public.billing_package_versions FOR EACH ROW EXECUTE FUNCTION billing_package_versions_freeze_seat();

drop trigger if exists invoice_lines_freeze on public.invoice_lines;
CREATE TRIGGER invoice_lines_freeze BEFORE DELETE OR UPDATE ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION invoice_lines_freeze();

drop trigger if exists invoice_lines_tenant on public.invoice_lines;
CREATE TRIGGER invoice_lines_tenant BEFORE INSERT ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION invoice_lines_tenant();

drop trigger if exists invoices_freeze on public.invoices;
CREATE TRIGGER invoices_freeze BEFORE DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION invoices_freeze();

drop trigger if exists payments_issue_receipt on public.payments;
CREATE TRIGGER payments_issue_receipt AFTER INSERT ON public.payments FOR EACH ROW EXECUTE FUNCTION payments_issue_receipt();

drop trigger if exists payments_issue_receipt_update on public.payments;
CREATE TRIGGER payments_issue_receipt_update AFTER UPDATE OF amount_kes ON public.payments FOR EACH ROW WHEN (((new.amount_kes IS DISTINCT FROM old.amount_kes) AND (new.match_status = ANY (ARRAY['matched'::text, 'partial'::text, 'over'::text])) AND (new.invoice_id IS NOT NULL) AND (new.amount_kes > (0)::numeric))) EXECUTE FUNCTION payments_issue_receipt();

drop trigger if exists subscription_events_no_update on public.subscription_events;
CREATE TRIGGER subscription_events_no_update BEFORE DELETE OR UPDATE ON public.subscription_events FOR EACH ROW EXECUTE FUNCTION billing_audit_log_freeze();

drop trigger if exists tenant_credits_no_update on public.tenant_credits;
CREATE TRIGGER tenant_credits_no_update BEFORE DELETE OR UPDATE ON public.tenant_credits FOR EACH ROW EXECUTE FUNCTION tenant_credits_freeze();

drop trigger if exists tenant_subscriptions_a_billing_guard on public.tenant_subscriptions;
CREATE TRIGGER tenant_subscriptions_a_billing_guard BEFORE UPDATE ON public.tenant_subscriptions FOR EACH ROW EXECUTE FUNCTION tenant_subscriptions_a_billing_guard();

drop trigger if exists tenant_subscriptions_b_pin_version on public.tenant_subscriptions;
CREATE TRIGGER tenant_subscriptions_b_pin_version BEFORE INSERT OR UPDATE ON public.tenant_subscriptions FOR EACH ROW EXECUTE FUNCTION tenant_subscriptions_b_pin_version();

drop trigger if exists tenant_subscriptions_c_require_version_pin on public.tenant_subscriptions;
CREATE TRIGGER tenant_subscriptions_c_require_version_pin BEFORE INSERT OR UPDATE ON public.tenant_subscriptions FOR EACH ROW EXECUTE FUNCTION tenant_subscriptions_c_require_version_pin();

drop trigger if exists tenant_subscriptions_clear_spend_hold on public.tenant_subscriptions;
CREATE TRIGGER tenant_subscriptions_clear_spend_hold BEFORE UPDATE ON public.tenant_subscriptions FOR EACH ROW EXECUTE FUNCTION tenant_subscriptions_clear_spend_hold();

drop trigger if exists tenant_subscriptions_d_block_retired_version on public.tenant_subscriptions;
CREATE TRIGGER tenant_subscriptions_d_block_retired_version BEFORE INSERT OR UPDATE ON public.tenant_subscriptions FOR EACH ROW EXECUTE FUNCTION tenant_subscriptions_d_block_retired_version();

drop trigger if exists tenants_a_new_signup_trial on public.tenants;
CREATE TRIGGER tenants_a_new_signup_trial AFTER INSERT ON public.tenants FOR EACH ROW EXECUTE FUNCTION tenants_a_new_signup_trial();

drop trigger if exists tenants_archived_billing_guard on public.tenants;
CREATE TRIGGER tenants_archived_billing_guard BEFORE UPDATE OF billing_enforcement, on_demand_usage_enabled ON public.tenants FOR EACH ROW EXECUTE FUNCTION tenants_archived_billing_guard();

drop trigger if exists tenants_billing_purge_flag on public.tenants;
CREATE TRIGGER tenants_billing_purge_flag BEFORE DELETE ON public.tenants FOR EACH ROW EXECUTE FUNCTION tenants_billing_purge_flag();

drop trigger if exists tenants_protect_spend_limit on public.tenants;
CREATE TRIGGER tenants_protect_spend_limit BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION tenants_protect_spend_limit();

drop trigger if exists tenants_protect_wallet_columns on public.tenants;
CREATE TRIGGER tenants_protect_wallet_columns BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION tenants_protect_wallet_columns();

drop trigger if exists wallet_ledger_no_delete on public.wallet_ledger;
CREATE TRIGGER wallet_ledger_no_delete BEFORE DELETE ON public.wallet_ledger FOR EACH ROW EXECUTE FUNCTION wallet_ledger_deny_mutation();

drop trigger if exists wallet_ledger_no_update on public.wallet_ledger;
CREATE TRIGGER wallet_ledger_no_update BEFORE UPDATE ON public.wallet_ledger FOR EACH ROW EXECUTE FUNCTION wallet_ledger_deny_mutation();

-- ============================================================
-- Row level security
-- ============================================================

alter table public.billing_audit_log enable row level security;

alter table public.billing_company enable row level security;

alter table public.billing_features enable row level security;

alter table public.billing_invoice_counters enable row level security;

alter table public.billing_lifecycle_settings enable row level security;

alter table public.billing_live_tenants enable row level security;

alter table public.billing_notices enable row level security;

alter table public.billing_owner_action_keys enable row level security;

alter table public.billing_package_version_approvals enable row level security;

alter table public.billing_package_version_features enable row level security;

alter table public.billing_package_versions enable row level security;

alter table public.billing_packages enable row level security;

alter table public.billing_rate_card enable row level security;

alter table public.billing_receipt_counters disable row level security;

alter table public.invoice_lines enable row level security;

alter table public.invoice_pay_tokens enable row level security;

alter table public.invoice_receipts enable row level security;

alter table public.invoices enable row level security;

alter table public.ops_audit_log enable row level security;

alter table public.payment_attempts enable row level security;

alter table public.payment_events enable row level security;

alter table public.payments enable row level security;

alter table public.sms_counter_reconciliations enable row level security;

alter table public.subscription_events enable row level security;

alter table public.tenant_credits enable row level security;

alter table public.tenant_minute_grants enable row level security;

alter table public.tenant_subscriptions enable row level security;

alter table public.voice_wallet_alert_state enable row level security;

alter table public.wallet_ledger enable row level security;

-- ============================================================
-- Policies
-- ============================================================

drop policy if exists billing_features_select_all on public.billing_features;
create policy billing_features_select_all on public.billing_features as PERMISSIVE for SELECT to authenticated
  using (true);

drop policy if exists billing_notices_select_member on public.billing_notices;
create policy billing_notices_select_member on public.billing_notices as PERMISSIVE for SELECT to authenticated
  using ((tenant_id IN ( SELECT current_user_tenant_ids() AS current_user_tenant_ids)));

drop policy if exists billing_package_version_features_select_published on public.billing_package_version_features;
create policy billing_package_version_features_select_published on public.billing_package_version_features as PERMISSIVE for SELECT to authenticated
  using ((package_version_id IN ( SELECT billing_package_versions.id
   FROM billing_package_versions
  WHERE (billing_package_versions.status = 'published'::text))));

drop policy if exists billing_package_versions_select_published on public.billing_package_versions;
create policy billing_package_versions_select_published on public.billing_package_versions as PERMISSIVE for SELECT to authenticated
  using ((status = 'published'::text));

drop policy if exists billing_packages_select_all on public.billing_packages;
create policy billing_packages_select_all on public.billing_packages as PERMISSIVE for SELECT to authenticated
  using (true);

drop policy if exists billing_rate_card_select_all on public.billing_rate_card;
create policy billing_rate_card_select_all on public.billing_rate_card as PERMISSIVE for SELECT to authenticated
  using (true);

drop policy if exists invoice_lines_select_member on public.invoice_lines;
create policy invoice_lines_select_member on public.invoice_lines as PERMISSIVE for SELECT to authenticated
  using ((tenant_id IN ( SELECT current_user_tenant_ids() AS current_user_tenant_ids)));

drop policy if exists invoice_receipts_select_member on public.invoice_receipts;
create policy invoice_receipts_select_member on public.invoice_receipts as PERMISSIVE for SELECT to authenticated
  using ((tenant_id IN ( SELECT current_user_tenant_ids() AS current_user_tenant_ids)));

drop policy if exists invoices_select_member on public.invoices;
create policy invoices_select_member on public.invoices as PERMISSIVE for SELECT to authenticated
  using ((tenant_id IN ( SELECT current_user_tenant_ids() AS current_user_tenant_ids)));

drop policy if exists tenant_minute_grants_select_member on public.tenant_minute_grants;
create policy tenant_minute_grants_select_member on public.tenant_minute_grants as PERMISSIVE for SELECT to authenticated
  using ((tenant_id IN ( SELECT current_user_tenant_ids() AS current_user_tenant_ids)));

drop policy if exists tenant_subscriptions_select_member on public.tenant_subscriptions;
create policy tenant_subscriptions_select_member on public.tenant_subscriptions as PERMISSIVE for SELECT to authenticated
  using ((tenant_id IN ( SELECT current_user_tenant_ids() AS current_user_tenant_ids)));

drop policy if exists wallet_ledger_select_admin on public.wallet_ledger;
create policy wallet_ledger_select_admin on public.wallet_ledger as RESTRICTIVE for SELECT to authenticated
  using (member_can_admin(tenant_id));

drop policy if exists wallet_ledger_select_member on public.wallet_ledger;
create policy wallet_ledger_select_member on public.wallet_ledger as PERMISSIVE for SELECT to authenticated
  using ((tenant_id IN ( SELECT current_user_tenant_ids() AS current_user_tenant_ids)));

-- ============================================================
-- Grants (anon, authenticated, service_role, public)
-- ============================================================

revoke all on function _apply_package_version_move(billing_package_versions,uuid,text,text,text) from public, anon, authenticated, service_role;
grant execute on function _apply_package_version_move(billing_package_versions,uuid,text,text,text) to service_role;

revoke all on function _billing_audit(text,text,uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function _billing_audit(text,text,uuid,jsonb) to service_role;

revoke all on function _billing_mark_spend_blocked(uuid) from public, anon, authenticated, service_role;
grant execute on function _billing_mark_spend_blocked(uuid) to service_role;

revoke all on function _billing_package_snapshot(uuid) from public, anon, authenticated, service_role;
grant execute on function _billing_package_snapshot(uuid) to service_role;

revoke all on function _billing_package_snapshot_of(uuid,text,timestamp with time zone,timestamp with time zone,text) from public, anon, authenticated, service_role;
grant execute on function _billing_package_snapshot_of(uuid,text,timestamp with time zone,timestamp with time zone,text) to service_role;

revoke all on function _owner_billing_finish(uuid,uuid,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function _owner_billing_finish(uuid,uuid,text,text,jsonb) to service_role;

revoke all on function _owner_billing_gate(uuid,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function _owner_billing_gate(uuid,uuid,text,text) to service_role;

revoke all on function _owner_next_invoice_line(uuid,text,numeric,timestamp with time zone,timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function _owner_next_invoice_line(uuid,text,numeric,timestamp with time zone,timestamp with time zone) to service_role;

revoke all on function _owner_open_proration_invoice(uuid,numeric,numeric,text,text,timestamp with time zone,timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function _owner_open_proration_invoice(uuid,numeric,numeric,text,text,timestamp with time zone,timestamp with time zone) to service_role;

revoke all on function _package_annual_discount(numeric,numeric) from public, anon, authenticated, service_role;
grant execute on function _package_annual_discount(numeric,numeric) to service_role;

revoke all on function _package_editor_actor(text,text) from public, anon, authenticated, service_role;
grant execute on function _package_editor_actor(text,text) to service_role;

revoke all on function _package_editor_apply_features(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function _package_editor_apply_features(uuid,jsonb) to service_role;

revoke all on function _package_editor_count(jsonb,text) from public, anon, authenticated, service_role;
grant execute on function _package_editor_count(jsonb,text) to service_role;

revoke all on function _package_editor_money(jsonb,text) from public, anon, authenticated, service_role;
grant execute on function _package_editor_money(jsonb,text) to service_role;

revoke all on function _package_editor_open() from public, anon, authenticated, service_role;
grant execute on function _package_editor_open() to service_role;

revoke all on function _package_version_apply_extra_seat(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function _package_version_apply_extra_seat(uuid,jsonb) to service_role;

revoke all on function _package_version_copy_extra_seat(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function _package_version_copy_extra_seat(uuid,uuid) to service_role;

revoke all on function _package_version_current_id(uuid) from public, anon, authenticated, service_role;
grant execute on function _package_version_current_id(uuid) to service_role;

revoke all on function _package_version_fill_extra_seat() from public, anon, authenticated, service_role;
grant execute on function _package_version_fill_extra_seat() to service_role;

revoke all on function _package_version_has_column(text) from public, anon, authenticated, service_role;
grant execute on function _package_version_has_column(text) to service_role;

revoke all on function _package_version_json(uuid) from public, anon, authenticated, service_role;
grant execute on function _package_version_json(uuid) to service_role;

revoke all on function _package_version_needs_approval(uuid) from public, anon, authenticated, service_role;
grant execute on function _package_version_needs_approval(uuid) to service_role;

revoke all on function _package_version_price_snapshot(uuid) from public, anon, authenticated, service_role;
grant execute on function _package_version_price_snapshot(uuid) to service_role;

revoke all on function _package_version_sha256(text) from public, anon, authenticated, service_role;
grant execute on function _package_version_sha256(text) to service_role;

revoke all on function _wallet_apply_delta(uuid,text,numeric,text,text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function _wallet_apply_delta(uuid,text,numeric,text,text,text,jsonb) to service_role;

revoke all on function adjust_payment_overpay(text,text,numeric,uuid) from public, anon, authenticated, service_role;
grant execute on function adjust_payment_overpay(text,text,numeric,uuid) to service_role;

revoke all on function adjust_tenant_wallet(uuid,numeric,numeric,text) from public, anon, authenticated, service_role;
grant execute on function adjust_tenant_wallet(uuid,numeric,numeric,text) to service_role;

revoke all on function adjust_tenant_wallet(uuid,numeric,text,text,text) from public, anon, authenticated, service_role;
grant execute on function adjust_tenant_wallet(uuid,numeric,text,text,text) to service_role;

revoke all on function admin_approve_package_version(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function admin_approve_package_version(uuid,text,text) to service_role;

revoke all on function admin_archive_package_version(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function admin_archive_package_version(uuid,text,text) to service_role;

revoke all on function admin_discard_package_version_draft(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function admin_discard_package_version_draft(uuid,text,text) to service_role;

revoke all on function admin_draft_package_version(text,text,text) from public, anon, authenticated, service_role;
grant execute on function admin_draft_package_version(text,text,text) to service_role;

revoke all on function admin_export_package_version(uuid) from public, anon, authenticated, service_role;
grant execute on function admin_export_package_version(uuid) to service_role;

revoke all on function admin_import_promoted_package_version(jsonb,text,text) from public, anon, authenticated, service_role;
grant execute on function admin_import_promoted_package_version(jsonb,text,text) to service_role;

revoke all on function admin_issue_credit_note(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function admin_issue_credit_note(uuid,text,text) to service_role;

revoke all on function admin_list_package_versions() from public, anon, authenticated, service_role;
grant execute on function admin_list_package_versions() to service_role;

revoke all on function admin_move_subscribers_to_package_version(uuid,uuid[],text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function admin_move_subscribers_to_package_version(uuid,uuid[],text,text,boolean) to service_role;

revoke all on function admin_publish_package_version(uuid,timestamp with time zone,text,text) from public, anon, authenticated, service_role;
grant execute on function admin_publish_package_version(uuid,timestamp with time zone,text,text) to service_role;

revoke all on function admin_set_billing_runtime_switch(text,text,boolean,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function admin_set_billing_runtime_switch(text,text,boolean,text,text,boolean) to service_role;

revoke all on function admin_set_invoice_dispute(uuid,boolean,text,text) from public, anon, authenticated, service_role;
grant execute on function admin_set_invoice_dispute(uuid,boolean,text,text) to service_role;

revoke all on function admin_set_package_editor_enabled(boolean,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function admin_set_package_editor_enabled(boolean,text,text,boolean) to service_role;

revoke all on function admin_set_tenant_billing_mode(uuid,text,text,text,text,boolean) from public, anon, authenticated, service_role;
grant execute on function admin_set_tenant_billing_mode(uuid,text,text,text,text,boolean) to service_role;

revoke all on function admin_set_tenant_live_payments(uuid,boolean,text,text) from public, anon, authenticated, service_role;
grant execute on function admin_set_tenant_live_payments(uuid,boolean,text,text) to service_role;

revoke all on function admin_update_package_version_draft(uuid,jsonb,text,text) from public, anon, authenticated, service_role;
grant execute on function admin_update_package_version_draft(uuid,jsonb,text,text) to service_role;

revoke all on function admin_void_invoice(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function admin_void_invoice(uuid,text,text) to service_role;

revoke all on function apply_payment(text,text,numeric,uuid,uuid,timestamp with time zone,text,jsonb,integer,text,numeric,integer,text,text) from public, anon, authenticated, service_role;
grant execute on function apply_payment(text,text,numeric,uuid,uuid,timestamp with time zone,text,jsonb,integer,text,numeric,integer,text,text) to service_role;

revoke all on function archive_tenant_billing(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function archive_tenant_billing(uuid,text,text) to service_role;

revoke all on function assign_tenant_package(uuid,uuid,text,text,text) from public, anon, authenticated, service_role;
grant execute on function assign_tenant_package(uuid,uuid,text,text,text) to service_role;

revoke all on function attach_invoice_pay_checkout(uuid,text,text,timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function attach_invoice_pay_checkout(uuid,text,text,timestamp with time zone) to service_role;

revoke all on function billing_add_months(timestamp with time zone,integer) from public, anon, authenticated, service_role;
grant execute on function billing_add_months(timestamp with time zone,integer) to authenticated;
grant execute on function billing_add_months(timestamp with time zone,integer) to service_role;

revoke all on function billing_audit_log_freeze() from public, anon, authenticated, service_role;
grant execute on function billing_audit_log_freeze() to anon;
grant execute on function billing_audit_log_freeze() to authenticated;
grant execute on function billing_audit_log_freeze() to public;
grant execute on function billing_audit_log_freeze() to service_role;

revoke all on function billing_grant_minutes_for_period(uuid,timestamp with time zone,timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function billing_grant_minutes_for_period(uuid,timestamp with time zone,timestamp with time zone) to authenticated;
grant execute on function billing_grant_minutes_for_period(uuid,timestamp with time zone,timestamp with time zone) to service_role;

revoke all on function billing_latest_package_version(uuid) from public, anon, authenticated, service_role;
grant execute on function billing_latest_package_version(uuid) to service_role;

revoke all on function billing_live_tenant_allowed(uuid) from public, anon, authenticated, service_role;
grant execute on function billing_live_tenant_allowed(uuid) to service_role;

revoke all on function billing_notice_when(timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function billing_notice_when(timestamp with time zone) to service_role;

revoke all on function billing_notices_guard() from public, anon, authenticated, service_role;
grant execute on function billing_notices_guard() to anon;
grant execute on function billing_notices_guard() to authenticated;
grant execute on function billing_notices_guard() to public;
grant execute on function billing_notices_guard() to service_role;

revoke all on function billing_on_demand_open(uuid) from public, anon, authenticated, service_role;
grant execute on function billing_on_demand_open(uuid) to service_role;

revoke all on function billing_package_version_approvals_freeze() from public, anon, authenticated, service_role;
grant execute on function billing_package_version_approvals_freeze() to anon;
grant execute on function billing_package_version_approvals_freeze() to authenticated;
grant execute on function billing_package_version_approvals_freeze() to public;
grant execute on function billing_package_version_approvals_freeze() to service_role;

revoke all on function billing_package_version_features_freeze() from public, anon, authenticated, service_role;
grant execute on function billing_package_version_features_freeze() to anon;
grant execute on function billing_package_version_features_freeze() to authenticated;
grant execute on function billing_package_version_features_freeze() to public;
grant execute on function billing_package_version_features_freeze() to service_role;

revoke all on function billing_package_versions_freeze() from public, anon, authenticated, service_role;
grant execute on function billing_package_versions_freeze() to anon;
grant execute on function billing_package_versions_freeze() to authenticated;
grant execute on function billing_package_versions_freeze() to public;
grant execute on function billing_package_versions_freeze() to service_role;

revoke all on function billing_package_versions_freeze_seat() from public, anon, authenticated, service_role;
grant execute on function billing_package_versions_freeze_seat() to anon;
grant execute on function billing_package_versions_freeze_seat() to authenticated;
grant execute on function billing_package_versions_freeze_seat() to public;
grant execute on function billing_package_versions_freeze_seat() to service_role;

revoke all on function billing_payment_reconciliation() from public, anon, authenticated, service_role;
grant execute on function billing_payment_reconciliation() to service_role;

revoke all on function billing_period_days(timestamp with time zone,timestamp with time zone,timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function billing_period_days(timestamp with time zone,timestamp with time zone,timestamp with time zone) to service_role;

revoke all on function billing_period_on_demand_kes(uuid) from public, anon, authenticated, service_role;
grant execute on function billing_period_on_demand_kes(uuid) to service_role;

revoke all on function billing_prorate_kes(numeric,integer,integer) from public, anon, authenticated, service_role;
grant execute on function billing_prorate_kes(numeric,integer,integer) to service_role;

revoke all on function billing_proration_quote(numeric,numeric,timestamp with time zone,timestamp with time zone,timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function billing_proration_quote(numeric,numeric,timestamp with time zone,timestamp with time zone,timestamp with time zone) to service_role;

revoke all on function billing_quarantine_placeholder_days() from public, anon, authenticated, service_role;
grant execute on function billing_quarantine_placeholder_days() to service_role;

revoke all on function billing_seats_used(uuid) from public, anon, authenticated, service_role;
grant execute on function billing_seats_used(uuid) to service_role;

revoke all on function billing_spend_allows_charge(uuid,numeric) from public, anon, authenticated, service_role;
grant execute on function billing_spend_allows_charge(uuid,numeric) to service_role;

revoke all on function billing_spend_limit_kes(uuid) from public, anon, authenticated, service_role;
grant execute on function billing_spend_limit_kes(uuid) to service_role;

revoke all on function billing_version_price_kes(uuid,text) from public, anon, authenticated, service_role;
grant execute on function billing_version_price_kes(uuid,text) to service_role;

revoke all on function charge_call_to_wallet(uuid,numeric,numeric) from public, anon, authenticated, service_role;
grant execute on function charge_call_to_wallet(uuid,numeric,numeric) to service_role;

revoke all on function claim_billing_notices(integer) from public, anon, authenticated, service_role;
grant execute on function claim_billing_notices(integer) to service_role;

revoke all on function claim_wallet_balance_alerts(uuid) from public, anon, authenticated, service_role;
grant execute on function claim_wallet_balance_alerts(uuid) to service_role;

revoke all on function clear_payment_event_retry(text,text) from public, anon, authenticated, service_role;
grant execute on function clear_payment_event_retry(text,text) to service_role;

revoke all on function create_invoice_pay_attempt(text,numeric) from public, anon, authenticated, service_role;
grant execute on function create_invoice_pay_attempt(text,numeric) to service_role;

revoke all on function credit_cancelled_collection(text,text,numeric,uuid) from public, anon, authenticated, service_role;
grant execute on function credit_cancelled_collection(text,text,numeric,uuid) to service_role;

revoke all on function credit_checkout_extra(text,text,numeric,uuid) from public, anon, authenticated, service_role;
grant execute on function credit_checkout_extra(text,text,numeric,uuid) to service_role;

revoke all on function enqueue_billing_notice(uuid,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function enqueue_billing_notice(uuid,text,text,text,text) to service_role;

revoke all on function enqueue_invoice_due_soon(uuid) from public, anon, authenticated, service_role;
grant execute on function enqueue_invoice_due_soon(uuid) to service_role;

revoke all on function enqueue_invoice_overdue(uuid) from public, anon, authenticated, service_role;
grant execute on function enqueue_invoice_overdue(uuid) to service_role;

revoke all on function finalize_invoice(uuid) from public, anon, authenticated, service_role;
grant execute on function finalize_invoice(uuid) to service_role;

revoke all on function grant_tenant_package_minutes(uuid,integer,text,text,text) from public, anon, authenticated, service_role;
grant execute on function grant_tenant_package_minutes(uuid,integer,text,text,text) to service_role;

revoke all on function invoice_kes_parts(numeric) from public, anon, authenticated, service_role;
grant execute on function invoice_kes_parts(numeric) to service_role;

revoke all on function invoice_lines_freeze() from public, anon, authenticated, service_role;
grant execute on function invoice_lines_freeze() to anon;
grant execute on function invoice_lines_freeze() to authenticated;
grant execute on function invoice_lines_freeze() to public;
grant execute on function invoice_lines_freeze() to service_role;

revoke all on function invoice_lines_tenant() from public, anon, authenticated, service_role;
grant execute on function invoice_lines_tenant() to anon;
grant execute on function invoice_lines_tenant() to authenticated;
grant execute on function invoice_lines_tenant() to public;
grant execute on function invoice_lines_tenant() to service_role;

revoke all on function invoice_next_pay_part(numeric,numeric) from public, anon, authenticated, service_role;
grant execute on function invoice_next_pay_part(numeric,numeric) to service_role;

revoke all on function invoice_pay_attempt_by_checkout(text) from public, anon, authenticated, service_role;
grant execute on function invoice_pay_attempt_by_checkout(text) to service_role;

revoke all on function invoices_freeze() from public, anon, authenticated, service_role;
grant execute on function invoices_freeze() to anon;
grant execute on function invoices_freeze() to authenticated;
grant execute on function invoices_freeze() to public;
grant execute on function invoices_freeze() to service_role;

revoke all on function issue_invoice_receipt(uuid) from public, anon, authenticated, service_role;
grant execute on function issue_invoice_receipt(uuid) to service_role;

revoke all on function mark_billing_notice_read(uuid) from public, anon, authenticated, service_role;
grant execute on function mark_billing_notice_read(uuid) to authenticated;
grant execute on function mark_billing_notice_read(uuid) to service_role;

revoke all on function mark_payment_event_retry(text,text) from public, anon, authenticated, service_role;
grant execute on function mark_payment_event_retry(text,text) to service_role;

revoke all on function mint_invoice_pay_token(uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function mint_invoice_pay_token(uuid,boolean) to service_role;

revoke all on function open_checkout_total_review(text,text,text,text,numeric,numeric,numeric,uuid,uuid,jsonb,numeric) from public, anon, authenticated, service_role;
grant execute on function open_checkout_total_review(text,text,text,text,numeric,numeric,numeric,uuid,uuid,jsonb,numeric) to service_role;

revoke all on function owner_set_spend_limit(uuid,uuid,numeric,text) from public, anon, authenticated, service_role;
grant execute on function owner_set_spend_limit(uuid,uuid,numeric,text) to service_role;

revoke all on function package_version_fingerprint(text,jsonb,jsonb) from public, anon, authenticated, service_role;
grant execute on function package_version_fingerprint(text,jsonb,jsonb) to service_role;

revoke all on function park_invoice_pay_attempt(uuid,text,text,timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function park_invoice_pay_attempt(uuid,text,text,timestamp with time zone) to service_role;

revoke all on function pay_invoice_by_return(text) from public, anon, authenticated, service_role;
grant execute on function pay_invoice_by_return(text) to service_role;

revoke all on function pay_invoice_by_token(text) from public, anon, authenticated, service_role;
grant execute on function pay_invoice_by_token(text) to service_role;

revoke all on function payments_issue_receipt() from public, anon, authenticated, service_role;
grant execute on function payments_issue_receipt() to service_role;

revoke all on table public.billing_audit_log from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_audit_log to service_role;

revoke all on table public.billing_company from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_company to service_role;

revoke all on table public.billing_features from public, anon, authenticated, service_role;
grant select on table public.billing_features to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_features to service_role;

revoke all on table public.billing_invoice_counters from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_invoice_counters to service_role;

revoke all on table public.billing_lifecycle_settings from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_lifecycle_settings to service_role;

revoke all on table public.billing_live_tenants from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_live_tenants to service_role;

revoke all on table public.billing_notice_outbox from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_notice_outbox to service_role;

revoke all on table public.billing_notices from public, anon, authenticated, service_role;
grant select on table public.billing_notices to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_notices to service_role;

revoke all on table public.billing_owner_action_keys from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_owner_action_keys to service_role;

revoke all on table public.billing_package_version_approvals from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_package_version_approvals to service_role;

revoke all on table public.billing_package_version_features from public, anon, authenticated, service_role;
grant select on table public.billing_package_version_features to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_package_version_features to service_role;

revoke all on table public.billing_package_versions from public, anon, authenticated, service_role;
grant select on table public.billing_package_versions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_package_versions to service_role;

revoke all on table public.billing_packages from public, anon, authenticated, service_role;
grant select on table public.billing_packages to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_packages to service_role;

revoke all on table public.billing_rate_card from public, anon, authenticated, service_role;
grant select on table public.billing_rate_card to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_rate_card to service_role;

revoke all on table public.billing_receipt_counters from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_receipt_counters to service_role;

revoke all on table public.billing_subscription_read from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_subscription_read to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_subscription_read to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.billing_subscription_read to service_role;

revoke all on table public.invoice_lines from public, anon, authenticated, service_role;
grant select on table public.invoice_lines to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invoice_lines to service_role;

revoke all on table public.invoice_pay_tokens from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invoice_pay_tokens to service_role;

revoke all on table public.invoice_receipts from public, anon, authenticated, service_role;
grant select on table public.invoice_receipts to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invoice_receipts to service_role;

revoke all on table public.invoices from public, anon, authenticated, service_role;
grant select on table public.invoices to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.invoices to service_role;

revoke all on table public.notify_sms_billable from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.notify_sms_billable to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.notify_sms_billable to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.notify_sms_billable to service_role;

revoke all on table public.ops_audit_log from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ops_audit_log to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ops_audit_log to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.ops_audit_log to service_role;

revoke all on table public.payment_attempts from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.payment_attempts to service_role;

revoke all on table public.payment_events from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.payment_events to service_role;

revoke all on table public.payments from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.payments to service_role;

revoke all on table public.sms_counter_reconciliations from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.sms_counter_reconciliations to service_role;

revoke all on table public.subscription_events from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.subscription_events to service_role;

revoke all on table public.tenant_billing_state from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenant_billing_state to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenant_billing_state to service_role;

revoke all on table public.tenant_credit_balance from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenant_credit_balance to service_role;

revoke all on table public.tenant_credits from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenant_credits to service_role;

revoke all on table public.tenant_minute_grants from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenant_minute_grants to service_role;

revoke all on table public.tenant_subscriptions from public, anon, authenticated, service_role;
grant select on table public.tenant_subscriptions to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.tenant_subscriptions to service_role;

revoke all on table public.voice_wallet_alert_state from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.voice_wallet_alert_state to service_role;

revoke all on table public.wallet_ledger from public, anon, authenticated, service_role;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.wallet_ledger to anon;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.wallet_ledger to authenticated;
grant delete, insert, maintain, references, select, trigger, truncate, update on table public.wallet_ledger to service_role;

revoke all on function reconcile_checkout_collection(text,text,text,numeric,uuid,uuid,jsonb,integer,text,integer) from public, anon, authenticated, service_role;
grant execute on function reconcile_checkout_collection(text,text,text,numeric,uuid,uuid,jsonb,integer,text,integer) to service_role;

revoke all on function reconcile_checkout_total(text,text,numeric,uuid,uuid,jsonb,integer,text,integer) from public, anon, authenticated, service_role;
grant execute on function reconcile_checkout_total(text,text,numeric,uuid,uuid,jsonb,integer,text,integer) to service_role;

revoke all on function record_payment_event(text,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function record_payment_event(text,text,jsonb) to service_role;

revoke all on function record_payment_issue(text,text,numeric,uuid,uuid,jsonb,integer,text,integer,text) from public, anon, authenticated, service_role;
grant execute on function record_payment_issue(text,text,numeric,uuid,uuid,jsonb,integer,text,integer,text) to service_role;

revoke all on function release_held_pay_checkout(uuid) from public, anon, authenticated, service_role;
grant execute on function release_held_pay_checkout(uuid) to service_role;

revoke all on function resolve_checkout_total_review(text,text,text,text,text,numeric) from public, anon, authenticated, service_role;
grant execute on function resolve_checkout_total_review(text,text,text,text,text,numeric) to service_role;

revoke all on function roll_package_periods(boolean) from public, anon, authenticated, service_role;
grant execute on function roll_package_periods(boolean) to service_role;

revoke all on function set_tenant_billing_mode(uuid,text,text,text,timestamp with time zone,boolean) from public, anon, authenticated, service_role;
grant execute on function set_tenant_billing_mode(uuid,text,text,text,timestamp with time zone,boolean) to service_role;

revoke all on function set_tenant_on_demand_usage(uuid,boolean) from public, anon, authenticated, service_role;
grant execute on function set_tenant_on_demand_usage(uuid,boolean) to authenticated;
grant execute on function set_tenant_on_demand_usage(uuid,boolean) to service_role;

revoke all on function set_tenant_soft_spend_limit(uuid,boolean,numeric) from public, anon, authenticated, service_role;
grant execute on function set_tenant_soft_spend_limit(uuid,boolean,numeric) to authenticated;
grant execute on function set_tenant_soft_spend_limit(uuid,boolean,numeric) to service_role;

revoke all on function settle_billing_notice(uuid,text,uuid,text) from public, anon, authenticated, service_role;
grant execute on function settle_billing_notice(uuid,text,uuid,text) to service_role;

revoke all on function settle_checkout_reading(text,text,numeric,uuid,uuid,text,numeric,jsonb,integer,text,integer) from public, anon, authenticated, service_role;
grant execute on function settle_checkout_reading(text,text,numeric,uuid,uuid,text,numeric,jsonb,integer,text,integer) to service_role;

revoke all on function settle_invoice_pay_attempt(uuid,text,numeric,text,numeric,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function settle_invoice_pay_attempt(uuid,text,numeric,text,numeric,text,jsonb) to service_role;

revoke all on function sms_counter_drift() from public, anon, authenticated, service_role;
grant execute on function sms_counter_drift() to service_role;

revoke all on function sms_counter_drift_log() from public, anon, authenticated, service_role;
grant execute on function sms_counter_drift_log() to service_role;

revoke all on function system_move_subscribers_to_package_version(uuid,uuid[],text,text) from public, anon, authenticated, service_role;
grant execute on function system_move_subscribers_to_package_version(uuid,uuid[],text,text) to service_role;

revoke all on function tenant_credits_freeze() from public, anon, authenticated, service_role;
grant execute on function tenant_credits_freeze() to anon;
grant execute on function tenant_credits_freeze() to authenticated;
grant execute on function tenant_credits_freeze() to public;
grant execute on function tenant_credits_freeze() to service_role;

revoke all on function tenant_subscriptions_a_billing_guard() from public, anon, authenticated, service_role;
grant execute on function tenant_subscriptions_a_billing_guard() to anon;
grant execute on function tenant_subscriptions_a_billing_guard() to authenticated;
grant execute on function tenant_subscriptions_a_billing_guard() to public;
grant execute on function tenant_subscriptions_a_billing_guard() to service_role;

revoke all on function tenant_subscriptions_b_pin_version() from public, anon, authenticated, service_role;
grant execute on function tenant_subscriptions_b_pin_version() to anon;
grant execute on function tenant_subscriptions_b_pin_version() to authenticated;
grant execute on function tenant_subscriptions_b_pin_version() to public;
grant execute on function tenant_subscriptions_b_pin_version() to service_role;

revoke all on function tenant_subscriptions_c_require_version_pin() from public, anon, authenticated, service_role;
grant execute on function tenant_subscriptions_c_require_version_pin() to anon;
grant execute on function tenant_subscriptions_c_require_version_pin() to authenticated;
grant execute on function tenant_subscriptions_c_require_version_pin() to public;
grant execute on function tenant_subscriptions_c_require_version_pin() to service_role;

revoke all on function tenant_subscriptions_clear_spend_hold() from public, anon, authenticated, service_role;
grant execute on function tenant_subscriptions_clear_spend_hold() to anon;
grant execute on function tenant_subscriptions_clear_spend_hold() to authenticated;
grant execute on function tenant_subscriptions_clear_spend_hold() to public;
grant execute on function tenant_subscriptions_clear_spend_hold() to service_role;

revoke all on function tenant_subscriptions_d_block_retired_version() from public, anon, authenticated, service_role;
grant execute on function tenant_subscriptions_d_block_retired_version() to authenticated;
grant execute on function tenant_subscriptions_d_block_retired_version() to public;
grant execute on function tenant_subscriptions_d_block_retired_version() to service_role;

revoke all on function tenants_a_new_signup_trial() from public, anon, authenticated, service_role;
grant execute on function tenants_a_new_signup_trial() to service_role;

revoke all on function tenants_archived_billing_guard() from public, anon, authenticated, service_role;
grant execute on function tenants_archived_billing_guard() to anon;
grant execute on function tenants_archived_billing_guard() to authenticated;
grant execute on function tenants_archived_billing_guard() to public;
grant execute on function tenants_archived_billing_guard() to service_role;

revoke all on function tenants_billing_purge_flag() from public, anon, authenticated, service_role;
grant execute on function tenants_billing_purge_flag() to anon;
grant execute on function tenants_billing_purge_flag() to authenticated;
grant execute on function tenants_billing_purge_flag() to public;
grant execute on function tenants_billing_purge_flag() to service_role;

revoke all on function tenants_protect_spend_limit() from public, anon, authenticated, service_role;
grant execute on function tenants_protect_spend_limit() to anon;
grant execute on function tenants_protect_spend_limit() to authenticated;
grant execute on function tenants_protect_spend_limit() to public;
grant execute on function tenants_protect_spend_limit() to service_role;

revoke all on function tenants_protect_wallet_columns() from public, anon, authenticated, service_role;
grant execute on function tenants_protect_wallet_columns() to anon;
grant execute on function tenants_protect_wallet_columns() to authenticated;
grant execute on function tenants_protect_wallet_columns() to public;
grant execute on function tenants_protect_wallet_columns() to service_role;

revoke all on function transition_subscription_billing_status(uuid,text,text,text,integer) from public, anon, authenticated, service_role;
grant execute on function transition_subscription_billing_status(uuid,text,text,text,integer) to service_role;

revoke all on function unarchive_tenant_billing(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function unarchive_tenant_billing(uuid,text,text) to service_role;

revoke all on function unassign_tenant_package(uuid,text,text,text) from public, anon, authenticated, service_role;
grant execute on function unassign_tenant_package(uuid,text,text,text) to service_role;

revoke all on function voice_wallet_alert_observe(bigint[],bigint,text,timestamp with time zone) from public, anon, authenticated, service_role;
grant execute on function voice_wallet_alert_observe(bigint[],bigint,text,timestamp with time zone) to service_role;

revoke all on function voice_wallet_alert_release(bigint[]) from public, anon, authenticated, service_role;
grant execute on function voice_wallet_alert_release(bigint[]) to service_role;

revoke all on function waive_tenant_overage(uuid,text,text,text) from public, anon, authenticated, service_role;
grant execute on function waive_tenant_overage(uuid,text,text,text) to service_role;

revoke all on function wallet_ledger_deny_mutation() from public, anon, authenticated, service_role;
grant execute on function wallet_ledger_deny_mutation() to anon;
grant execute on function wallet_ledger_deny_mutation() to authenticated;
grant execute on function wallet_ledger_deny_mutation() to public;
grant execute on function wallet_ledger_deny_mutation() to service_role;

-- ============================================================
-- pg_cron jobs
-- ============================================================

do $m$ begin
  if exists (select 1 from cron.job where jobname = 'scalers-package-period-rollover') then perform cron.unschedule('scalers-package-period-rollover'); end if;
  perform cron.schedule('scalers-package-period-rollover', '5 * * * *', 'select public.roll_package_periods(false);');
end $m$;

do $m$ begin
  if exists (select 1 from cron.job where jobname = 'sms-counter-drift-daily') then perform cron.unschedule('sms-counter-drift-daily'); end if;
  perform cron.schedule('sms-counter-drift-daily', '20 4 * * *', 'select public.sms_counter_drift_log()');
end $m$;
