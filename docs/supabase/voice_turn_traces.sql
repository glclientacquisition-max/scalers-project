-- Per-turn voice traces. The payload is the versioned stage list.
-- Run after platform_ops_people.sql. Deploy does not apply this file.
-- Service role only. Shop owners do not read call speech from this table.
-- Idempotent. ASCII-only.

create table if not exists public.voice_turn_traces (
  id uuid primary key default gen_random_uuid(),
  call_id text not null,
  tenant_id uuid,
  turn_index integer,
  record_kind text not null,
  schema_version integer not null default 1,
  pii text not null default 'transcript',
  payload jsonb not null,
  score numeric,
  checks jsonb,
  diagnosis text,
  release jsonb,
  created_at timestamptz not null default now(),
  constraint voice_turn_traces_kind_check check (record_kind in ('call', 'turn'))
);

alter table public.voice_turn_traces add column if not exists score numeric;
alter table public.voice_turn_traces add column if not exists checks jsonb;
alter table public.voice_turn_traces add column if not exists diagnosis text;
alter table public.voice_turn_traces add column if not exists release jsonb;

create index if not exists voice_turn_traces_call_idx
  on public.voice_turn_traces (call_id, turn_index);

create index if not exists voice_turn_traces_tenant_idx
  on public.voice_turn_traces (tenant_id, created_at desc);

comment on table public.voice_turn_traces is
  'Voice turn traces. payload is scalers.voice.turn or scalers.voice.call. pii=transcript. Phones and emails are redacted in the writer. Names stay for scoring. Call rows store score, checks, diagnosis, and release. Turn rows store that turn score and checks. Diagnosis and release stay null on turn rows.';

comment on column public.voice_turn_traces.score is
  '0-100. Call row is the call score. Turn row is that turn score. Written at hangup. Null when scoring threw.';
comment on column public.voice_turn_traces.checks is
  'Per-check counts. Call row is the call total. Turn row is that turn. Written at hangup.';
comment on column public.voice_turn_traces.diagnosis is
  'One plain-English line naming the worst check. Call rows only. Null on turn rows and when scoring threw.';
comment on column public.voice_turn_traces.release is
  'gitSha, branch, and optional label for the process that finished the call.';

alter table public.voice_turn_traces enable row level security;

revoke all on public.voice_turn_traces from public;
revoke all on public.voice_turn_traces from anon;
revoke all on public.voice_turn_traces from authenticated;

grant all on public.voice_turn_traces to service_role;

-- ---------------------------------------------------------------------------
-- Retention: keep 30 days of traces.
-- pg_cron is NOT enabled on prod (checked 2026-10-09), so this adds a purge function only.
-- Scheduling (pick one, needs Alvin's OK):
--   a) enable pg_cron, then:
--        select cron.schedule('purge_voice_turn_traces', '17 2 * * *',
--          $$select public.purge_voice_turn_traces(30)$$);
--   b) a daily service-role caller (voice server or a Vercel cron) runs
--        rpc('purge_voice_turn_traces', { p_days: 30 }).
-- Until one is scheduled, run it by hand: select public.purge_voice_turn_traces(30);
-- Security invoker: only service_role can execute it, and only service_role can delete rows.
-- ---------------------------------------------------------------------------
create or replace function public.purge_voice_turn_traces(p_days integer default 30)
returns integer
language sql
set search_path = public
as $$
  with gone as (
    delete from public.voice_turn_traces
    where created_at < now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
    returning 1
  )
  select count(*)::integer from gone;
$$;

comment on function public.purge_voice_turn_traces(integer) is
  'Deletes voice_turn_traces older than p_days (default 30, minimum 1). Returns rows deleted.';

revoke all on function public.purge_voice_turn_traces(integer) from public, anon, authenticated;
grant execute on function public.purge_voice_turn_traces(integer) to service_role;
