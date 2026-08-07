-- Knowledge Acquisition: structured services catalog (live ground truth).
-- Run after knowledge_acquisition_phase1.sql.
--
-- Shape: JSON array of
--   { "name": "...", "price_range": "...", "notes": "...", "out_of_scope": "..." }
-- Voice loads this at call time (with faqs + team_directory) as LIVE GROUND TRUTH.
-- ASCII-only (safe for Supabase SQL Editor).

alter table public.tenants
  add column if not exists services_catalog jsonb not null default '[]'::jsonb;

comment on column public.tenants.services_catalog is
  'Structured services [{name, price_range, notes, out_of_scope}] used live + for prompt compile';
