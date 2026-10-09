-- Daily 30-day retention for voice_turn_traces via pg_cron.
-- Run after: voice_turn_traces.sql (creates public.purge_voice_turn_traces).
-- Applied on prod (ALCR) 2026-10-09 with Alvin's OK. Not applied on scalers-staging.
--
-- pg_cron runs in UTC: '17 0 * * *' = 00:17 UTC = 03:17 EAT.
-- The job runs as postgres (table owner), so the service_role-only grant on the
-- purge function does not block it.
-- Idempotent: drops any existing job with the same name, then schedules it again.
-- ASCII-only.

create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'purge_voice_turn_traces_daily';

select cron.schedule(
  'purge_voice_turn_traces_daily',
  '17 0 * * *',
  $$select public.purge_voice_turn_traces(30)$$
);

-- Verify (read-only):
--   select jobid, jobname, schedule, command, active from cron.job
--   where jobname = 'purge_voice_turn_traces_daily';
--   select status, start_time, return_message from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'purge_voice_turn_traces_daily')
--   order by start_time desc limit 5;
