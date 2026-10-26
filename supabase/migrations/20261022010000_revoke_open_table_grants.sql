-- Migration copy of docs/supabase/revoke_open_table_grants.sql (keep in sync).
-- Close the open table-level grants on public.calls, public.contacts,
-- public.tenants, public.service_requests and public.appointments for the
-- anon and authenticated roles.
-- Run after: owner_rls.sql, lead_status.sql, contacts_owner_insert.sql,
-- fix_p0_rls_remove_legacy_allow_all.sql, contacts_and_requests.sql,
-- appointments.sql, inbox_archive_cascade.sql (member policies in place).
--
-- Why. Supabase default privileges gave anon and authenticated every table
-- privilege on these foundation tables. Row level security blocks most rows
-- today (anon has no policy at all), but TRUNCATE, REFERENCES and TRIGGER are
-- not checked by RLS, and one permissive policy added by mistake would open
-- writes to logged-out callers.
--
-- Before this file (staging sgcdncjxauhsbunobmob and production
-- fjxcdccgyhnvnnlnovcl, 22 Oct 2026), identical on all five tables:
--   anon          = arwdDxtm  (SELECT INSERT UPDATE DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN)
--   authenticated = ardDxtm   (SELECT INSERT DELETE TRUNCATE REFERENCES TRIGGER MAINTAIN)
--   authenticated also holds column-level UPDATE grants (Desk edits). This
--   file does not touch them. Never revoke table-level UPDATE from
--   authenticated here: Postgres also drops the column UPDATE grants.
--   The anon "column UPDATE" on service_requests.inbox_archived_at and
--   appointments.inbox_archived_at (information_schema.column_privileges)
--   is this table-level anon grant, which Supabase default privileges in
--   public gave every new table. There is no column-level anon ACL.
--   authenticated has no UPDATE on inbox_archived_at; archive and undo go
--   through inbox_archive_calls / inbox_undo_archive only.
--   inbox_archive_undo already has no anon or authenticated grant.
--
-- Code audit (main a2ffb8eb, 22 Oct 2026):
--   * No code writes these tables as anon. Voice (src/lib/supabaseClient.js)
--     and getSupabaseAdmin() use the service role. Desk writes use the owner
--     session (role authenticated, createWorkspaceDataClient).
--   * anon reads nothing: no RLS policy grants anon a row on these tables.
--   * Owner session INSERT is used only on contacts
--     (dashboard/src/app/(desk)/contacts/actions.ts manual add and CSV import),
--     under policy contacts_insert_member. No owner INSERT on calls or
--     tenants (tenant creation uses getSupabaseAdmin). No owner DELETE.
--   * service_requests / appointments: Desk only UPDATEs status, updated_at
--     and the When fields through the owner session
--     (dashboard/src/app/(desk)/requests/actions.ts, appointments/actions.ts).
--     Voice inserts and updates them with the service role (src/db.js).
--     No owner INSERT or DELETE.
--   * API logs (24 h, both projects): no anon-role request to these tables.
--
-- After this file:
--   anon          = nothing on the five tables
--   authenticated = SELECT on all five, INSERT on contacts only, column UPDATE unchanged
--   service_role  = unchanged
--
-- Idempotent: revoking a privilege that is not held is a no-op.
-- ASCII-only. Staging first; production needs Alvin's GO.
--
-- Rollback (restores the exact grants above):
--   grant select, insert, update, delete, truncate, references, trigger on public.calls, public.contacts, public.tenants, public.service_requests, public.appointments to anon;
--   grant insert, delete, truncate, references, trigger on public.calls, public.contacts, public.tenants, public.service_requests, public.appointments to authenticated;
--   -- Postgres 17+ only:
--   grant maintain on public.calls, public.contacts, public.tenants, public.service_requests, public.appointments to anon, authenticated;

revoke select, insert, update, delete, truncate, references, trigger
  on public.calls, public.contacts, public.tenants, public.service_requests, public.appointments from anon;

revoke delete, truncate, references, trigger
  on public.calls, public.contacts, public.tenants, public.service_requests, public.appointments from authenticated;

revoke insert on public.calls, public.tenants, public.service_requests, public.appointments from authenticated;

-- MAINTAIN exists from Postgres 17 (both projects run 17).
do $$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on public.calls, public.contacts, public.tenants, public.service_requests, public.appointments from anon, authenticated';
  end if;
end
$$;
