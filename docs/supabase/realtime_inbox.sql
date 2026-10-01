-- realtime_inbox.sql
-- Purpose: stream desk changes to the signed-in owner.
--          Adds calls, service_requests, appointments, tenants, wallet_ledger,
--          and transcripts to the supabase_realtime publication so LiveInbox
--          and LiveTicket receive them. tenants carries a minute change.
--          wallet_ledger carries a landed credit. transcripts carries a new line.
-- Run after: contacts_and_requests.sql, appointments.sql, one_wallet_billing.sql
--            (tables must exist).
-- Idempotent: re-runs skip tables already in the publication.
-- Apply by hand in the SQL editor. Deploy does not run this file.
-- calls, service_requests, appointments: staging and production 2026-09-16.
-- tenants, wallet_ledger, transcripts: pending that same hand apply.
-- No schema, grant, or policy change. Existing member SELECT policies
-- (tenants_select_member, wallet_ledger_select_member, transcripts_select_member)
-- govern what a subscribed owner receives; the service role voice engine
-- is unaffected.

do $$
declare
  t text;
begin
  foreach t in array array[
    'calls',
    'service_requests',
    'appointments',
    'tenants',
    'wallet_ledger',
    'transcripts'
  ] loop
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
