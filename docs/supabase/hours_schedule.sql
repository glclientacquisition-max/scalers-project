-- Knowledge Acquisition: structured weekly hours for open/closed awareness.
-- Run in the Supabase SQL editor after knowledge_acquisition_phase1.sql.
--
-- Voice engine reads hours_schedule at call time for CONTEXT HEADER + greeting.
-- Desk still keeps business_hours text as a human-readable summary for the compiler.
-- ASCII-only (safe for Supabase SQL Editor).

alter table public.tenants
  add column if not exists hours_schedule jsonb;

comment on column public.tenants.hours_schedule is
  'Weekly open hours JSON: {timezone, days:{mon..sun:{open,close}|null}, location}. Used live for open/closed.';
