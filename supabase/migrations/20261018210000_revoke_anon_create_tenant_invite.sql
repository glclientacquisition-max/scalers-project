-- Revoke anon and PUBLIC execute on create_tenant_invite.
-- Run after: supabase/migrations/20261011000000_team_invites.sql
--
-- create_tenant_invite(uuid, text, text, text, uuid) is security definer.
-- team_invites.sql revokes PUBLIC and authenticated, then grants service_role.
-- Supabase default privileges also grant execute to anon directly. Revoke
-- from PUBLIC does not remove that grant, so the anon key can still call it.
-- Staging and production ACL before this file:
-- {postgres=X/postgres,anon=X/postgres,service_role=X/postgres}
--
-- The only app caller is the service role (getSupabaseAdmin):
--   dashboard/src/app/(desk)/settings/membersActions.ts
-- No signed-in or anon caller. Do not grant authenticated.
--
-- Staging first. Production waits for the owner's OK. Same statements.

revoke all on function public.create_tenant_invite(uuid, text, text, text, uuid) from public, anon;

grant execute on function public.create_tenant_invite(uuid, text, text, text, uuid) to service_role;
