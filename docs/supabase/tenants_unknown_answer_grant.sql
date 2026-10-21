-- Column UPDATE grant for owner Policies saves.
-- Run after unknown_answer_by_kind.sql and
-- supabase/migrations/20261018233000_unknown_answer_spoken.sql.
--
-- Why: the owner Policies save writes unknown_answer_spoken and
-- unknown_answer_by_kind on public.tenants. authenticated only has
-- column-level UPDATE on tenants, and these two columns were never granted.
-- Every Policies save failed with "permission denied for table tenants"
-- (returned inside a 200, so owners saw "Could not save").
--
-- Row scope is unchanged: RLS on tenants (tenants_update_member /
-- tenants_update_admin_only) still limits authenticated to its own tenant.
-- ADDITIVE. ASCII-only. Safe to re-run (GRANT is idempotent).
--
-- Rollback:
--   revoke update (unknown_answer_spoken, unknown_answer_by_kind) on public.tenants from authenticated;

grant update (unknown_answer_spoken, unknown_answer_by_kind) on public.tenants to authenticated;
