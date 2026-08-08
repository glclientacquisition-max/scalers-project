-- Owner-facing receptionist tool toggles (per business).
-- ASCII-only (safe for Supabase SQL Editor).
--
-- Shape (jsonb object):
--   {
--     "escalate": true,   -- notify teammate / owner for anger, refunds, role asks
--     "end_call": true    -- allow ###ENDCALL### after goodbye
--   }
-- save_caller_info is always on (lead capture) and is not stored here.

alter table public.tenants
  add column if not exists agent_tools jsonb not null default '{"escalate":true,"end_call":true}'::jsonb;

update public.tenants
set agent_tools = '{"escalate":true,"end_call":true}'::jsonb
where agent_tools is null;

comment on column public.tenants.agent_tools is
  'Receptionist tool toggles: escalate, end_call. save_caller_info is always enabled.';

-- Owners need column-level UPDATE when wallet_security_beta grants are in use.
grant update (agent_tools) on public.tenants to authenticated;
