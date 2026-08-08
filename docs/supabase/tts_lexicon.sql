-- Optional per-tenant TTS pronunciation overrides.
-- Shape: jsonb array of { "match": "wanjiku", "say": "Wan-jee-koo", "priority": 200 }
-- Applied after global Kenya lexicon in prepareForTts().

alter table public.tenants
  add column if not exists tts_lexicon jsonb not null default '[]'::jsonb;

comment on column public.tenants.tts_lexicon is
  'Optional TTS pronunciation overrides: [{match, say, langs?, priority?}].';
