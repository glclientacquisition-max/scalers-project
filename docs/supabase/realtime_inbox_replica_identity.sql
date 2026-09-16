-- realtime_inbox_replica_identity.sql
-- Purpose: Live Inbox filters postgres_changes on tenant_id. Replica identity
--          DEFAULT only puts the primary key in hangup WAL, so terminal
--          patches never match the filter. INSERT of in_progress still fires
--          (full new row). That is why a watched live call appears and earlier
--          completed calls do not live-update.
-- Run after: realtime_inbox.sql
-- Idempotent: re-setting FULL is a no-op.
-- No publication, grant, or policy change. Member SELECT still governs
-- what a subscribed owner receives.

alter table public.calls replica identity full;
alter table public.service_requests replica identity full;
alter table public.appointments replica identity full;
