-- package_entitlements.sql
-- Purpose: reserved included counters for later packages (email, team seats).
--          SMS enforcement stays in sms_allowance.sql. Do not gate email or
--          invites in this file. Packages will SET these numbers.
-- Run after: sms_allowance.sql (protect trigger copy).
-- Beta never blocks. Seats are a hard cap when gated (no on-demand).

alter table public.tenants
  add column if not exists email_included_units integer not null default 100;

alter table public.tenants
  add column if not exists email_used_units integer not null default 0;

alter table public.tenants
  add column if not exists seat_included integer not null default 5;

comment on column public.tenants.email_included_units is
  'Included tenant emails per pack. Meter later via consume_email_units. Do not gate yet.';
comment on column public.tenants.email_used_units is
  'Consumed tenant emails. Unused until consume_email_units ships.';
comment on column public.tenants.seat_included is
  'Included tenant_members logins per pack. Hard cap later. Not team_directory rows.';

alter table public.tenants
  drop constraint if exists tenants_email_included_units_check;
alter table public.tenants
  add constraint tenants_email_included_units_check
  check (email_included_units >= 0);

alter table public.tenants
  drop constraint if exists tenants_email_used_units_check;
alter table public.tenants
  add constraint tenants_email_used_units_check
  check (email_used_units >= 0);

alter table public.tenants
  drop constraint if exists tenants_seat_included_check;
alter table public.tenants
  add constraint tenants_seat_included_check
  check (seat_included >= 0);

create or replace function public.tenants_protect_wallet_columns()
returns trigger
language plpgsql
as $$
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
    then
      raise exception 'wallet/billing columns are RPC-only';
    end if;
  end if;

  return new;
end;
$$;
