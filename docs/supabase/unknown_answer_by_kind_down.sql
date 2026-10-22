-- Rollback unknown_answer_by_kind (VOICE_FALLBACK_BY_KIND off before drop in prod).

alter table public.tenants drop column if exists unknown_answer_by_kind;
