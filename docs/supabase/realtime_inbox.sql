-- realtime_inbox.sql
-- Purpose: stream work-table changes to the owner desk (Live Inbox).
--          Adds calls, service_requests, appointments to the supabase_realtime
--          publication so the dashboard's LiveInbox subscription receives them.
-- Run after: contacts_and_requests.sql, appointments.sql (tables must exist).
-- Idempotent: re-runs skip tables already in the publication.
-- No schema, grant, or policy change. Existing member SELECT policies
-- (owner_rls.sql era) govern what a subscribed owner receives; the service
-- role voice engine is unaffected.

do $$
declare
  t text;
begin
  foreach t in array array['calls', 'service_requests', 'appointments'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
