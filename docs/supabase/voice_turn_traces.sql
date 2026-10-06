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
  'Voice turn traces. payload is scalers.voice.turn or scalers.voice.call. pii=transcript. Phones and emails are redacted in the writer. Names stay for scoring. Call rows also store score, checks, diagnosis, and release. Turn rows leave those columns null.';

comment on column public.voice_turn_traces.score is
  'Call score 0-100, written once at hangup. Null on turn rows and when scoring threw.';
comment on column public.voice_turn_traces.checks is
  'Per-check counts for the call. Null on turn rows.';
comment on column public.voice_turn_traces.diagnosis is
  'One plain-English line naming the worst check. Null on turn rows and when scoring threw.';
comment on column public.voice_turn_traces.release is
  'gitSha, branch, and optional label for the process that finished the call.';

alter table public.voice_turn_traces enable row level security;

revoke all on public.voice_turn_traces from public;
revoke all on public.voice_turn_traces from anon;
revoke all on public.voice_turn_traces from authenticated;

grant all on public.voice_turn_traces to service_role;
