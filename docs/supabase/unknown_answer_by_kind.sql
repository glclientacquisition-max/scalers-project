-- Per-type callback lines when voice lookup cannot answer (price, hours, fee, pay, general).
-- Shape: { "general": { "en": "...", "sw": "..." }, "price": { ... }, ... }
-- Nullable. Voice uses these when VOICE_FALLBACK_BY_KIND=on.
-- ADDITIVE. Safe to re-run.
--
-- Backfill: owner unsure lines. Quote-style text goes to price only; other lines to general.
-- Rollback: docs/supabase/unknown_answer_by_kind_down.sql

alter table public.tenants
  add column if not exists unknown_answer_by_kind jsonb;

comment on column public.tenants.unknown_answer_by_kind is
  'Per lookup kind callback lines: general, price, hours, fee, pay with en and sw. Callbacks only.';

update public.tenants
set unknown_answer_by_kind = case
  when btrim(unknown_answer_fallback) ~* '(call you back with a (price|quote)|shop will call you back|note what you need|duka litakupigia|litakupigia kwa bei|cannot quote|can''?t quote|formal quote)'
    then jsonb_build_object(
      'price',
      jsonb_build_object('en', btrim(unknown_answer_fallback), 'sw', null)
    )
  else jsonb_build_object(
    'general',
    jsonb_build_object('en', btrim(unknown_answer_fallback), 'sw', null)
  )
end
where unknown_answer_by_kind is null
  and unknown_answer_fallback is not null
  and btrim(unknown_answer_fallback) <> '';

-- Repair rows already backfilled with quote-style text under general only.
update public.tenants
set unknown_answer_by_kind =
  (unknown_answer_by_kind - 'general')
  || jsonb_build_object('price', unknown_answer_by_kind -> 'general')
where unknown_answer_by_kind ? 'general'
  and not (unknown_answer_by_kind ? 'price')
  and coalesce(unknown_answer_by_kind -> 'general' ->> 'en', '') ~* '(call you back with a (price|quote)|shop will call you back|note what you need|duka litakupigia|litakupigia kwa bei|cannot quote|can''?t quote|formal quote)';
