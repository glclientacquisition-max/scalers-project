-- Structured business profile for the AI Prompt Compiler.
-- Run in the Supabase SQL editor after multi_tenant_onboarding.sql.
--
-- Owners edit these fields in Sauti Desk; Gemini compiles them into
-- tenants.llm_system_prompt for the voice engine.
-- ASCII-only (safe for Supabase SQL Editor).

alter table public.tenants
  add column if not exists business_hours text;

alter table public.tenants
  add column if not exists services_offered text;

alter table public.tenants
  add column if not exists agent_tone text;

comment on column public.tenants.business_hours is
  'Owner-facing hours and service area; compiled into llm_system_prompt';
comment on column public.tenants.services_offered is
  'Owner-facing services and pricing; compiled into llm_system_prompt';
comment on column public.tenants.agent_tone is
  'Owner tone preference: professional | friendly | localized';
