-- VOICE_TRANSCRIPT_ORDER: per-call turn order for transcripts.
-- Every row of one call is inserted in one batch and shares created_at, so
-- readers (Desk) must sort by seq, then created_at. Additive and nullable:
-- old rows keep seq = null; Voice tolerates this column being absent.
alter table public.transcripts add column if not exists seq integer;

comment on column public.transcripts.seq is
  '0-based turn order within a call, written by Voice db.appendTranscript when VOICE_TRANSCRIPT_ORDER is on. Sort by seq, then created_at.';
