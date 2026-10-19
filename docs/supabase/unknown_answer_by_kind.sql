-- Per-type callback lines when voice lookup cannot answer (price, hours, fee, pay, general).
-- Shape: { "general": { "en": "...", "sw": "..." }, "price": { ... }, ... }
-- Nullable. Voice uses these when VOICE_FALLBACK_BY_KIND=on.
-- ADDITIVE. Safe to re-run.
--
-- Backfill: copy trimmed unknown_answer_fallback into general.en when present.
-- Rollback: docs/supabase/unknown_answer_by_kind_down.sql

alter table public.tenants
  add column if not exists unknown_answer_by_kind jsonb;

comment on column public.tenants.unknown_answer_by_kind is
  'Per lookup kind callback lines: general, price, hours, fee, pay with en and sw. Callbacks only.';

update public.tenants
set unknown_answer_by_kind = jsonb_build_object(
  'general',
  jsonb_build_object('en', btrim(unknown_answer_fallback), 'sw', null)
)
where unknown_answer_by_kind is null
  and unknown_answer_fallback is not null
  and btrim(unknown_answer_fallback) <> '';
