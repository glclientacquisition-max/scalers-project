-- Nightly purge schedule. NOT APPLIED ANYWHERE. Prod needs Alvin's GO.
--
-- Before applying:
--   1. purge_archived_tenants.sql is applied and a dry run was reviewed:
--        select * from public.purge_archived_tenants(30, true);
--   2. Recordings for due businesses are deleted through the Storage API
--      (archived_tenant_recording_objects lists them). Until then the real
--      run reports them as 'blocked' and skips that business.
--   3. pg_cron is enabled (Supabase: Database > Extensions > pg_cron).
--
-- 03:15 EAT = 00:15 UTC. 30 = ARCHIVE_RESTORE_DAYS.

create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'purge-archived-tenants';

select cron.schedule(
  'purge-archived-tenants',
  '15 0 * * *',
  $$select * from public.purge_archived_tenants(30, false)$$
);
