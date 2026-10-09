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

-- The purge filters on created_at alone. See voice_turn_traces_created_at_idx.sql.
create index if not exists voice_turn_traces_created_at_idx
  on public.voice_turn_traces (created_at);

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
-- Retention: keep 30 days of traces, deleted in batches of 5000 rows.
--
-- Two entry points, same rule (created_at older than p_days, minimum 1 day):
--
--   call public.purge_voice_turn_traces_batched(30);
--     Procedure. COMMITs after every batch, so no transaction is ever bigger
--     than one batch: row locks are released, autovacuum can reclaim space as
--     it goes, WAL is spread out, and a run that is stopped (timeout, restart)
--     keeps the batches it already finished. This is what pg_cron calls
--     (voice_turn_traces_cron.sql). A procedure that commits cannot have a SET
--     clause or be security definer, so every name below is schema-qualified.
--     It must be called on its own (not inside BEGIN ... COMMIT); pg_cron and
--     the SQL editor both do that.
--
--   select public.purge_voice_turn_traces(30);
--     Function, unchanged signature (integer -> integer). Same 5000-row
--     batches, but a function runs inside one transaction, so every batch
--     commits together at the end. Fine for the daily trickle and for manual
--     or rpc('purge_voice_turn_traces') use; use the procedure for a large
--     backlog. Returns rows deleted.
--
-- Neither takes a table lock that blocks callers: DELETE takes ROW EXCLUSIVE,
-- which only conflicts with DDL. Batches walk voice_turn_traces_created_at_idx.
-- Both are security invoker: only service_role (and postgres, which runs
-- pg_cron) can execute them, and only those roles can delete rows.
-- ---------------------------------------------------------------------------
create or replace function public.purge_voice_turn_traces(p_days integer default 30)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_batch constant integer := 5000;
  v_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
  v_rows integer;
  v_total integer := 0;
begin
  loop
    delete from public.voice_turn_traces
    where id in (
      select id from public.voice_turn_traces
      where created_at < v_cutoff
      limit v_batch
    );
    get diagnostics v_rows = row_count;
    v_total := v_total + v_rows;
    exit when v_rows < v_batch;
  end loop;
  return v_total;
end;
$$;

comment on function public.purge_voice_turn_traces(integer) is
  'Deletes voice_turn_traces older than p_days (default 30, minimum 1) in 5000-row batches inside one transaction. Returns rows deleted. For a large backlog use the procedure purge_voice_turn_traces_batched, which commits per batch.';

revoke all on function public.purge_voice_turn_traces(integer) from public, anon, authenticated;
grant execute on function public.purge_voice_turn_traces(integer) to service_role;

create or replace procedure public.purge_voice_turn_traces_batched(
  p_days integer default 30,
  p_batch integer default 5000,
  inout p_deleted integer default null
)
language plpgsql
as $$
declare
  v_batch integer := least(greatest(coalesce(p_batch, 5000), 100), 50000);
  v_cutoff timestamptz := pg_catalog.now()
    - pg_catalog.make_interval(days => greatest(coalesce(p_days, 30), 1));
  v_rows integer;
begin
  p_deleted := 0;
  loop
    delete from public.voice_turn_traces
    where id in (
      select id from public.voice_turn_traces
      where created_at < v_cutoff
      limit v_batch
    );
    get diagnostics v_rows = row_count;
    p_deleted := p_deleted + v_rows;
    commit;
    exit when v_rows < v_batch;
  end loop;
end;
$$;

comment on procedure public.purge_voice_turn_traces_batched(integer, integer, integer) is
  'Deletes voice_turn_traces older than p_days (default 30, minimum 1) in p_batch-row batches (default 5000, clamped 100..50000), committing after each batch. Call it on its own, not inside a transaction block. p_deleted returns rows deleted. Used by pg_cron.';

revoke all on procedure public.purge_voice_turn_traces_batched(integer, integer, integer) from public, anon, authenticated;
grant execute on procedure public.purge_voice_turn_traces_batched(integer, integer, integer) to service_role;
