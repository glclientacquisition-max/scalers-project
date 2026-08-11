-- Business Operating Model (Phase 0): vertical, handoff, locations, policies.
-- Run after agent_tools.sql / knowledge_acquisition_phase1.sql.
--
-- JSON shapes:
--   business_locations: [{ label, address, landmark, directions, coverage_notes }]
--   business_policies:  { returns, delivery, payment, deposit, cancellation, warranty, other }
--
-- ASCII-only (safe for Supabase SQL Editor).

alter table public.tenants
  add column if not exists vertical text not null default 'general';

alter table public.tenants
  add column if not exists handoff_mode text not null default 'callback';

alter table public.tenants
  add column if not exists business_locations jsonb not null default '[]'::jsonb;

alter table public.tenants
  add column if not exists business_policies jsonb not null default '{}'::jsonb;

-- Normalize legacy / unexpected values.
update public.tenants
set vertical = 'general'
where vertical is null
   or trim(vertical) = ''
   or lower(trim(vertical)) not in ('general', 'retail', 'home_services', 'hospitality');

update public.tenants
set handoff_mode = 'callback'
where handoff_mode is null
   or trim(handoff_mode) = ''
   or lower(trim(handoff_mode)) not in ('callback', 'live_transfer');

comment on column public.tenants.vertical is
  'Business pack: general | retail | home_services | hospitality';
comment on column public.tenants.handoff_mode is
  'Human handoff preference: callback (WhatsApp/email) | live_transfer (when telephony supports it)';
comment on column public.tenants.business_locations is
  'Locations [{label, address, landmark, directions, coverage_notes}] for live directions';
comment on column public.tenants.business_policies is
  'Keyed policies {returns, delivery, payment, deposit, cancellation, warranty, other}';

-- Owners need column-level UPDATE when wallet_security_beta grants are in use.
grant update (
  vertical,
  handoff_mode,
  business_locations,
  business_policies
) on public.tenants to authenticated;
