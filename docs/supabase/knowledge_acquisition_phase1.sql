-- Knowledge Acquisition Phase 1: persona, team directory, golden FAQs.
-- Run in the Supabase SQL editor after tenant_business_profile.sql.
--
-- Owners edit these in Scalers Business settings; the AI Prompt Compiler
-- folds them into tenants.llm_system_prompt for the voice engine.
-- ASCII-only (safe for Supabase SQL Editor).

alter table public.tenants
  add column if not exists agent_name text not null default 'Receptionist';

alter table public.tenants
  add column if not exists agent_tone text;

alter table public.tenants
  add column if not exists team_directory jsonb not null default '[]'::jsonb;

alter table public.tenants
  add column if not exists faqs jsonb not null default '[]'::jsonb;

-- Backfill null agent_name if an older partial migration left any.
update public.tenants
set agent_name = 'Receptionist'
where agent_name is null or trim(agent_name) = '';

comment on column public.tenants.agent_name is
  'Receptionist display name used in call introductions (e.g. Aisha, Kevin)';
comment on column public.tenants.agent_tone is
  'Owner tone preference: professional | friendly | empathetic | localized';
comment on column public.tenants.team_directory is
  'JSON array of {name, role, phone} for escalation / human handoff guidance';
comment on column public.tenants.faqs is
  'JSON array of {question, answer} golden Q&A pairs compiled into the voice prompt';
