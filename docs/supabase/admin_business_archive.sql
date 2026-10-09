-- Super Admin: Archive instead of Remove (A0).
-- Adds the archive date and the operator who archived. Permanent delete opens
-- 30 days after tenants.archived_at (enforced in the Desk server helper).
--
-- Not applied anywhere yet. Apply on staging first, then prod with Alvin's OK.
-- Additive and safe to re-run.
--
-- Before this file runs, Admin still archives (is_active = false) but has no
-- archive date, so permanent delete stays off for every business.

alter table public.tenants
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text;

comment on column public.tenants.archived_at is
  'When a Super Admin archived the business. Permanent delete opens 30 days later. null = not archived, or archived before this column existed.';
comment on column public.tenants.archived_by is
  'Signed-in Super Admin username that archived the business.';

create index if not exists tenants_archived_at_idx
  on public.tenants (archived_at)
  where archived_at is not null;

-- Businesses already inactive before this file have no archive date. They keep
-- permanent delete off until someone restores and re-archives them, which starts
-- a fresh 30-day grace period. No backfill on purpose: we don't know when they
-- were switched off.
