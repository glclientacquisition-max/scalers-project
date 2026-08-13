-- Gemini Scan review queue for Pronunciation Studio.
-- Candidates are NEVER auto-applied to tts_lexicon — human approve only.
-- ASCII-only (safe for Supabase SQL Editor).
-- Prefer AFTER tts_lexicon.sql so grants stay consistent.

alter table public.tenants
  add column if not exists pronunciation_review_queue jsonb not null default '[]'::jsonb;

alter table public.tenants
  add column if not exists pronunciation_scan_dismissals jsonb not null default '[]'::jsonb;

alter table public.tenants
  add column if not exists pronunciation_gemini_scan_logs jsonb not null default '[]'::jsonb;

comment on column public.tenants.pronunciation_review_queue is
  'Pending Gemini/manual pronunciation review candidates. Not live TTS until approved.';

comment on column public.tenants.pronunciation_scan_dismissals is
  'Rejected/snoozed Gemini scan keys so the same call+word does not resurface.';

comment on column public.tenants.pronunciation_gemini_scan_logs is
  'Recent Gemini Scan run logs (tenant debugging). Capped in app code.';

grant update (
  pronunciation_review_queue,
  pronunciation_scan_dismissals,
  pronunciation_gemini_scan_logs
) on public.tenants to authenticated;
