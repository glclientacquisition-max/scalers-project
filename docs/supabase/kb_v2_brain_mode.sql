-- Retire the old brain, P1 (kb_v2), version 2026-10-28.4. Apply AFTER kb_v2_paste_replace.sql (2026-10-28.3).
-- ADDITIVE: tenants.brain_mode 'full' (default) | 'safe' (emergency safe mode for one business; Brain builds the
-- safe script). Members read it with their row (tenants_select_member, table SELECT for authenticated). Only Super Admin
-- writes it (service role): authenticated has column-level UPDATE grants on tenants and brain_mode is NOT granted;
-- the restrictive tenants_update_admin_only policy still limits any member update of the row to owner/admin.
-- tenants.brain_target is left in place (read-free after P1) and dropped later by kb_v2_drop_brain_target.sql (P2).
-- Idempotent. Rollback: docs/supabase/kb_v2_brain_mode_down.sql. Staging first; prod only on Alvin's yes.

alter table public.tenants add column if not exists brain_mode text not null default 'full';
do $$ begin
  alter table public.tenants add constraint tenants_brain_mode check (brain_mode in ('full', 'safe'));
exception when duplicate_object then null; end $$;
comment on column public.tenants.brain_mode is 'full = the KB brain; safe = emergency safe mode (greet, take name / number / reason, read back, alert / hand over). Super Admin only (service role). BRAIN_SAFE_MODE=all on Voice overrides every business.';
revoke update (brain_mode) on public.tenants from authenticated, anon;
