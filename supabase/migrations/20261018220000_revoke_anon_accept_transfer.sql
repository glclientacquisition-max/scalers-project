-- Revoke anon and PUBLIC execute on accept and ownership transfer.
-- Run after: supabase/migrations/20261018210000_revoke_anon_create_tenant_invite.sql
--
-- accept_tenant_invite(text, uuid) and transfer_tenant_ownership(uuid, uuid, uuid)
-- are security definer. team_invites.sql revokes PUBLIC and authenticated, then
-- grants service_role. The direct anon grant from default privileges remains.
-- Staging and production ACL before this file:
-- {postgres=X/postgres,anon=X/postgres,service_role=X/postgres}
--
-- App callers use the service role (getSupabaseAdmin):
--   dashboard/src/lib/inviteAccept.ts                         accept_tenant_invite
--   dashboard/src/app/(desk)/settings/membersActions.ts       transfer_tenant_ownership
-- No signed-in or anon RPC caller. Do not grant authenticated.
--
-- Staging first. Production waits for the owner's OK. Same statements.

revoke all on function public.accept_tenant_invite(text, uuid) from public, anon;
revoke all on function public.transfer_tenant_ownership(uuid, uuid, uuid) from public, anon;

grant execute on function public.accept_tenant_invite(text, uuid) to service_role;
grant execute on function public.transfer_tenant_ownership(uuid, uuid, uuid) to service_role;
