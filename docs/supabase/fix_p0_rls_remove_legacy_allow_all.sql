-- P0 security remediation: remove legacy allow-all RLS policies.
-- Applied to production (ALCR): 2026-08-14
--
-- Problem: pre-governance policies named "Enable all access for service role only"
-- were defined FOR ALL TO public USING (true) WITH CHECK (true), defeating tenant
-- isolation for anon and authenticated roles.
--
-- Fix: drop those policies only. Member policies from owner_rls.sql and
-- lead_status.sql remain in place. service_role bypasses RLS (rolbypassrls=true).
--
-- Safe to re-run (IF EXISTS). Does not change grants or functions.
-- ASCII-only (safe for Supabase SQL Editor).

BEGIN;

DROP POLICY IF EXISTS "Enable all access for service role only"
  ON public.tenants;

DROP POLICY IF EXISTS "Enable all access for service role only"
  ON public.calls;

DROP POLICY IF EXISTS "Enable all access for service role only"
  ON public.transcripts;

COMMIT;
