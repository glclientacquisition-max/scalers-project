-- Employee Training center: the "I don't know" fallback line.
-- Run in the Supabase SQL editor after tenant_business_profile.sql.
--
-- Owners write exactly what the receptionist should say when a caller
-- asks for something outside the business knowledge. The compiler bakes
-- it into tenants.llm_system_prompt.
-- ASCII-only (safe for Supabase SQL Editor).

alter table public.tenants
  add column if not exists unknown_answer_fallback text;

comment on column public.tenants.unknown_answer_fallback is
  'Owner-written line the receptionist says when asked about something not offered';
