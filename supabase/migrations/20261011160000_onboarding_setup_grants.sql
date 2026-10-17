-- Fix for 20261011150000: public.tenants uses column-level UPDATE grants for `authenticated`
-- (wallet columns stay service-role only). New setup columns had no grant, so the
-- SECURITY INVOKER save_onboarding_step RPC failed with "permission denied for table tenants"
-- and step 1 never saved. RLS (tenants_update_member / tenants_update_admin_only) still
-- limits rows to the caller's own workspace.
-- Applied to staging (sgcdncjxauhsbunobmob) 11 Oct 2026. Production: apply together with 20261011150000.
grant update (onboarding_draft, onboarding_step, onboarding_draft_version, setup_completed_at)
  on public.tenants to authenticated;
