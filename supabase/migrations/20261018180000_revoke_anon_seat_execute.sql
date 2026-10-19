-- Revoke anon and PUBLIC execute on the seat-count helpers.
-- Run after: supabase/migrations/20261011000000_team_invites.sql
--
-- tenant_seats_used(uuid) and tenant_seat_available(uuid) are security definer
-- and take a tenant id. They do not check membership. Postgres grants execute
-- to PUBLIC when a function is created, and staging also has an explicit anon
-- grant, so the anon key can read any tenant's seat count.
--
-- App callers use the service role (getSupabaseAdmin):
--   dashboard/src/lib/billingStateLoad.ts  (Usage page)
--   dashboard/src/lib/packageCatalog.ts    (package meter fallback)
-- create_tenant_invite is service-role only and security definer. It calls
-- tenant_seat_available as the function owner, so that path does not use the
-- invoker's grant.
-- Keep the authenticated and service_role grants from team_invites.sql.
-- Staging first. Production waits for the owner's OK. Same statements.

revoke all on function public.tenant_seats_used(uuid) from public, anon;
revoke all on function public.tenant_seat_available(uuid) from public, anon;

grant execute on function public.tenant_seats_used(uuid) to authenticated, service_role;
grant execute on function public.tenant_seat_available(uuid) to authenticated, service_role;
