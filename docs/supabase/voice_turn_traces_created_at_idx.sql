-- Index for the 30-day trace purge.
-- Run after: voice_turn_traces.sql.
-- purge_voice_turn_traces filters on created_at alone. The only index with
-- created_at is voice_turn_traces_tenant_idx (tenant_id, created_at desc), which
-- leads with tenant_id, so Postgres 17 cannot range-scan it for
-- "created_at < cutoff". Without this index every batch of the purge is a
-- sequential scan of the whole table.
--
-- Why a plain CREATE INDEX (not CONCURRENTLY):
--   * Sizes on 2026-10-09: prod 0 rows (32 kB), staging 267 rows (1.2 MB).
--     A plain build finishes in milliseconds, so the write lock it takes
--     (SHARE: inserts wait, reads do not) is not noticeable.
--   * CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and
--     Supabase apply_migration wraps every migration in one. This file stays
--     safe to run there.
--   * If the table is ever large (say over 1M rows) when this runs, use the SQL
--     editor instead, one statement on its own:
--       create index concurrently if not exists voice_turn_traces_created_at_idx
--         on public.voice_turn_traces (created_at);
--     If that fails half way, drop the INVALID index and run it again:
--       select indexrelid::regclass from pg_index
--       where indrelid = 'public.voice_turn_traces'::regclass and not indisvalid;
--
-- Idempotent. ASCII-only.

create index if not exists voice_turn_traces_created_at_idx
  on public.voice_turn_traces (created_at);

-- Verify (read-only):
--   select indexname, indexdef from pg_indexes
--   where schemaname = 'public' and tablename = 'voice_turn_traces';
