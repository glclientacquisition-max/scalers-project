-- Rollback for kb_import_runs.sql (2026-10-30.1).
drop function if exists public.kb_undo_import(uuid, uuid);
drop table if exists public.kb_import_runs;
