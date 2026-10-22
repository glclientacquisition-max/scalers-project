-- Ops alert spine. Read this before running anything on production.
-- Checked 18 Oct 2026 against production (fjxcdccgyhnvnnlnovcl) and staging
-- (sgcdncjxauhsbunobmob). Both already have public.platform_ops_notices
-- (id, kind, status, detail, opened_at, notified_at, acked_at, resolved_at)
-- and unique index platform_ops_notices_one_open on (kind)
-- where status in ('open', 'acked').
--
-- There is no DDL to apply. Threshold and TextSMS notices are rows in that
-- table. The kind text is sautikit_low:<minor>, sautikit_low:empty, or
-- sms_credit:warn|critical|exhausted. Do not add a column. Do not re-run
-- platform_ops_notices.sql (create table if not exists will not hurt, but it
-- is not required).
--
-- Production mail stays off until Alvin sets CRON_SECRET (16+ characters) and
-- OPS_ALERTS_DRY_RUN=false on the Desk project. Until then the route returns
-- 401, or it opens notices and sends nothing.
--
-- Read-only check. Safe to run on production when someone wants to confirm
-- the index is still there. It writes nothing.

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'platform_ops_notices'
  and indexname = 'platform_ops_notices_one_open';
