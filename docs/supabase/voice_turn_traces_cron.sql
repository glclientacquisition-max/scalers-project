-- Daily 30-day retention for voice_turn_traces via pg_cron.
-- Run after: voice_turn_traces.sql (creates public.purge_voice_turn_traces_batched)
-- and voice_turn_traces_created_at_idx.sql.
-- First applied on prod (ALCR) 2026-10-09 with Alvin's OK as
-- "select public.purge_voice_turn_traces(30)" (job id 1). This version calls the
-- batched procedure instead, which commits every 5000 rows. Applied on prod
-- 2026-10-09 13:38 EAT with Alvin's GO (job id 1 kept). Not applied on
-- scalers-staging (no pg_cron there).
--
-- pg_cron runs in UTC: '17 0 * * *' = 00:17 UTC = 03:17 EAT.
-- The job runs as postgres (table owner), so the service_role-only grant on the
-- purge function does not block it.
-- Idempotent. cron.schedule with an existing job name updates that job in place
-- (same jobid), so no unschedule is needed.
-- CALL works from pg_cron: each job runs as its own top-level statement, so
-- the procedure's per-batch COMMIT is allowed.
-- ASCII-only.

create extension if not exists pg_cron;

select cron.schedule(
  'purge_voice_turn_traces_daily',
  '17 0 * * *',
  $$call public.purge_voice_turn_traces_batched(30)$$
);

-- Verify (read-only):
--   select jobid, jobname, schedule, command, active from cron.job
--   where jobname = 'purge_voice_turn_traces_daily';
--   select status, start_time, return_message from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'purge_voice_turn_traces_daily')
--   order by start_time desc limit 5;
