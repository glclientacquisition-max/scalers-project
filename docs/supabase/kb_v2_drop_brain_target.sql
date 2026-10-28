-- Retire the old brain, P2 (kb_v2), version 2026-10-28.5. Apply AFTER kb_v2_brain_mode.sql (.4), and only after a
-- release in which nothing reads tenants.brain_target (P1 + Desk D1 shipped; Brain plan question 7). Readers checked
-- 28 Oct: the DB has only the constraint tenants_brain_target (no function, view, policy, index or trigger reads it);
-- code readers are removed by P1 (Voice: db.js, kb/live.js, kb/kbLive.js, kb-cutover.js) and Desk D1
-- (lib/kb.server.ts, lib/kbCaller.server.ts, kbCaller.ts, lib/kbLive.server.ts, api/admin/businesses/[id]/kb,
-- components/admin/v2/BusinessKbBlock.tsx, lib/ops/stepUpCore.ts, stepUpWords.ts).
-- Pre-check (must return 0 rows before applying):
--   select proname from pg_proc where prosrc ilike '%brain_target%';
-- Idempotent. Rollback: docs/supabase/kb_v2_drop_brain_target_down.sql (restores the column as 'v2' for every business).
-- Staging first; prod only on Alvin's yes.
alter table public.tenants drop constraint if exists tenants_brain_target;
alter table public.tenants drop column if exists brain_target;
