-- Rollback for kb_import_runs_facts.sql: undo goes back to items only.
alter table public.kb_import_runs drop column if exists fact_after;
alter table public.kb_import_runs drop column if exists fact_before;
