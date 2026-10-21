-- Spoken lines for tenants.unknown_answer_fallback.
-- Shape: {"en": text, "sw": text, "source": exact trimmed fallback, "updated_at": iso-8601}.
-- Voice uses en/sw only when source equals the current unknown_answer_fallback.
-- Nullable. An empty fallback stores null and voice uses its own team default.
-- ADDITIVE. No backfill. Safe to re-run.
-- Rollback: alter table public.tenants drop column if exists unknown_answer_spoken;

alter table public.tenants
  add column if not exists unknown_answer_spoken jsonb;

comment on column public.tenants.unknown_answer_spoken is
  'Spoken rewrite of unknown_answer_fallback: {en, sw, source, updated_at}. Voice uses en/sw only when source equals the trimmed fallback.';
