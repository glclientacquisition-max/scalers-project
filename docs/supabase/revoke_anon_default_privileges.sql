-- Stop new public tables, sequences and functions from granting anon.
-- Run after: any. Only changes default privileges (future objects).
--
-- Supabase ships default privileges that give anon ALL on every new table
-- and sequence in public, plus EXECUTE on every new function. That is why
-- new tables (e.g. inbox_archived_at on holds/visits) showed anon UPDATE.
--
-- Staging and production pg_default_acl before this file (public schema):
--   postgres       r {postgres=arwdDxtm,anon=arwdDxtm,authenticated=arwdDxtm,service_role=arwdDxtm}
--   postgres       S {postgres=rwU,anon=rwU,authenticated=rwU,service_role=rwU}
--   postgres       f {postgres=X,anon=X,authenticated=X,service_role=X}
--   supabase_admin r/S/f same shape (owned by supabase_admin)
--
-- What this does:
--   * Revokes anon from postgres's public-schema defaults (tables,
--     sequences, functions). All 73 public relations are owned by postgres,
--     so postgres is the role that creates tables in practice.
--   * Leaves authenticated and service_role as they are. Owner desk
--     reads/writes depend on authenticated grants + RLS; removing those
--     defaults would break new tables unless every migration grants them.
--
-- What this does not do:
--   * supabase_admin defaults are unchanged. postgres is not a member of
--     supabase_admin, so ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin
--     is refused. Objects created by supabase_admin (platform extensions,
--     dashboard ops) still grant anon.
--   * Existing objects are unchanged. Default privileges only apply to
--     objects created after this runs.
--   * Functions: PostgreSQL also grants EXECUTE to PUBLIC on every new
--     function (built-in default, not in pg_default_acl). anon is in PUBLIC.
--     New functions still need `revoke all on function ... from public, anon;`
--     as the existing revoke_anon_* files do.
--   * Any future table or function that anon must reach (public page, widget)
--     needs an explicit grant to anon in its own migration.
--
-- Staging first. Production waits for the owner's OK. Same statements.

alter default privileges for role postgres in schema public
  revoke all on tables from anon;

alter default privileges for role postgres in schema public
  revoke all on sequences from anon;

alter default privileges for role postgres in schema public
  revoke all on functions from anon;

-- Rollback (restores Supabase defaults for postgres):
-- alter default privileges for role postgres in schema public grant all on tables to anon;
-- alter default privileges for role postgres in schema public grant all on sequences to anon;
-- alter default privileges for role postgres in schema public grant execute on functions to anon;
