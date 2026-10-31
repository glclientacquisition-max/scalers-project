-- Add many undo also puts back found facts saved in the same import (hours, policies, payment, places, areas, FAQs).
-- Version 2026-10-30.2. Apply AFTER kb_import_runs.sql. ADDITIVE (two nullable-default columns). Safe to re-run.
-- fact_before: { hours | policies | locations | faqs | areas: value before the import }  (first write wins)
-- fact_after:  { same keys: value right after the import's saves }  (undo refuses if the stored value differs)
-- The values are restored by the Desk through each fact's own settings save, so calls recompile as after an edit.
-- Rollback: docs/supabase/kb_import_runs_facts_down.sql. Staging first; prod only on Alvin's yes.

alter table public.kb_import_runs add column if not exists fact_before jsonb not null default '{}'::jsonb;
alter table public.kb_import_runs add column if not exists fact_after jsonb not null default '{}'::jsonb;
