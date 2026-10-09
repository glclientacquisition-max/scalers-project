# voice_turn_traces: when and how to switch on monthly partitioning

Status: plan only. Nothing here is built. Today the 30-day retention is a
batched DELETE (`purge_voice_turn_traces_batched`, 5000 rows per commit, daily
00:17 UTC / 03:17 EAT via pg_cron) walking `voice_turn_traces_created_at_idx`.
That is the right tool until the numbers below say otherwise.

## Where we are (read-only queries, 2026-10-09 ~13:45 EAT)

| | prod (ALCR, `fjxcdccgyhnvnnlnovcl`) | staging (`sgcdncjxauhsbunobmob`) |
| --- | --- | --- |
| Rows | 0 | 267 (24 calls, oldest 2026-10-07) |
| Rows written in the last 24 h | 0 | 183 |
| Total size (heap + toast + indexes) | 32 kB (empty) | 1.2 MB before the purge test |
| Average row (`pg_column_size`) | n/a | about 2.4 kB, about 4.5 kB per row with indexes and toast |
| Calls in the last 24 h / 30 days | 4 / 101 | 29 / n/a |

Prod is empty because `VOICE_TRACE` defaults to off when the Railway
environment name contains `prod` (see `docs/agents/VOICE_TRACING_AND_EVAL.md`).
Staging writes about 11 trace rows per call (one per turn plus one call row).

Rule of thumb once tracing is on: rows per day is about 11 x calls per day,
and the steady-state table (30 days) is about 330 x calls per day rows, at
about 4.5 kB each. Prod at today's 4 calls a day would hold about 1,300 rows
(about 6 MB). That is roughly 1,000x below the threshold.

## Threshold: switch on when any of these holds for a week

1. Rows per day above 100,000 (about 9,000 traced calls a day). At that rate
   the daily purge deletes 100k rows and the table holds about 3M rows
   (about 14 GB).
2. Table total size above 10 GB (`pg_total_relation_size('public.voice_turn_traces')`).
3. The purge job takes longer than 5 minutes
   (`cron.job_run_details.end_time - start_time`), or autovacuum on the table
   cannot finish between runs (`pg_stat_user_tables.n_dead_tup` stays above
   20% of `n_live_tup` all day).

Below these numbers, DELETE plus autovacuum is cheaper and simpler than
running partitions. Check monthly:

```sql
select count(*) filter (where created_at > now() - interval '1 day') as rows_1d,
       count(*) as rows_total,
       pg_size_pretty(pg_total_relation_size('public.voice_turn_traces')) as total
from public.voice_turn_traces;

select start_time, end_time - start_time as took, status, return_message
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'purge_voice_turn_traces_daily')
order by start_time desc limit 7;
```

## How (when the threshold is hit)

### 1. Partitioned table, one partition per created_at month

```sql
create table public.voice_turn_traces_p (
  like public.voice_turn_traces including defaults including constraints
) partition by range (created_at);

-- The primary key must include the partition key.
alter table public.voice_turn_traces_p add primary key (id, created_at);

create index on public.voice_turn_traces_p (call_id, turn_index);
create index on public.voice_turn_traces_p (tenant_id, created_at desc);
create index on public.voice_turn_traces_p (created_at);

-- Current month plus the next two, and a default partition as a safety net.
create table public.voice_turn_traces_p_2027_01 partition of public.voice_turn_traces_p
  for values from ('2027-01-01') to ('2027-02-01');
-- ... one per month ...
create table public.voice_turn_traces_p_default partition of public.voice_turn_traces_p default;
```

Copy RLS and grants exactly: `enable row level security` on the parent and
every partition, `revoke all ... from public, anon, authenticated`, and
`grant all ... to service_role`, on the parent and on every partition
(partitions can be queried directly, and the parent's grants do not cover
that).

### 2. Migrate with a rename swap, no bulk copy

Retention is only 30 days, so old rows do not need to move:

1. Create `voice_turn_traces_p` and its partitions as above.
2. In one short transaction:
   `alter table public.voice_turn_traces rename to voice_turn_traces_legacy;`
   `alter table public.voice_turn_traces_p rename to voice_turn_traces;`
   This takes an ACCESS EXCLUSIVE lock for milliseconds. Writers
   (`src/speech/voiceTrace.js`) use the table name only, so they continue on
   the new table. Set `lock_timeout = '3s'` first so a long query cannot
   queue everyone behind the rename.
3. Turn rows written before the swap get their hangup score update
   (`update ... where call_id = ? and turn_index = ?`) on the new table, which
   matches nothing for calls that were in flight. Do the swap in a quiet
   window (night EAT) so that is zero or one call. If that matters, copy the
   last hour of rows into the new table first.
4. Keep `voice_turn_traces_legacy` for 30 days for `voice:score` lookups,
   then `drop table`.

### 3. Retention: drop partitions instead of deleting rows

Replace the cron command with a procedure that:

- creates the partitions for the next two months if missing, and
- drops every partition whose upper bound is older than now() - 30 days
  (`drop table public.voice_turn_traces_p_YYYY_MM`), with
  `lock_timeout = '3s'` and a retry next day if it times out. Dropping a
  partition takes a brief ACCESS EXCLUSIVE lock on the parent.
  `detach partition ... concurrently` avoids that lock but is not allowed
  while a default partition exists and cannot run inside a procedure, so it
  does not fit here.

Dropping a partition is instant and leaves no dead rows. Monthly partitions
mean a month's rows are only dropped once the whole month is older than
30 days, so the table holds 30 to 61 days. To keep a strict 30 days, run the
existing batched delete on the single oldest partition after dropping (small
and cheap), or switch to weekly partitions. `pg_partman` (available on
Supabase) can do the create and drop part instead of a hand-written
procedure.

## Risks

- Missing partition: with no partition for a new month, inserts would fail.
  The default partition catches them, but rows in the default partition block
  creating the matching monthly partition later. Create partitions two months
  ahead and alert if the default partition has any rows.
- Primary key becomes (id, created_at): `id` stays unique in practice
  (`gen_random_uuid`), but Postgres no longer enforces it on its own. Nothing
  references `voice_turn_traces.id` today; check again before migrating.
- RLS and grants on partitions: forgetting them on a new partition exposes it
  to direct queries. The partition-creating procedure must apply them every
  time. Add a check to the monthly review.
- Queries without created_at (`where call_id = ...`) scan every partition's
  call index. With two or three live partitions that is fine.
- The rename swap needs a short exclusive lock and a cron change, both prod
  writes that need Alvin's GO.
- Dropping a partition needs a brief exclusive lock on the parent. A long
  running read on the table would make it wait; lock_timeout plus a retry
  keeps it from queueing writers behind it.
