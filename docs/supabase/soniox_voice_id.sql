-- Per-tenant Soniox TTS voice (curated allowlist id from config/soniox-voices.json).
-- Run in Supabase SQL editor after tts_lexicon.sql.
--
-- null = use platform default voice from dashboard/src/data/soniox-voices.json.

alter table public.tenants
  add column if not exists soniox_voice_id text;

alter table public.tenants
  add column if not exists soniox_voice_label text;

comment on column public.tenants.soniox_voice_id is
  'Optional Soniox cloned voice UUID from Scalers curated catalog; null uses default.';

comment on column public.tenants.soniox_voice_label is
  'Owner label for the phone voice profile (desk display only; agent_name is what callers hear).';

grant update (soniox_voice_id, soniox_voice_label) on public.tenants to authenticated;
