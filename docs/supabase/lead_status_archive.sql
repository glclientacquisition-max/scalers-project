-- Extend CRM lead status with Archive (additive).
-- Apply after docs/supabase/lead_status.sql.
--
-- Owner flow: New -> Followed Up (contacted) -> Done (resolved),
-- plus Archive to hide from the active inbox without hard-delete.
-- ASCII-only (safe for Supabase SQL Editor).

do $do$
begin
  if exists (
    select 1 from pg_constraint where conname = 'calls_lead_status_check'
  ) then
    alter table public.calls drop constraint calls_lead_status_check;
  end if;

  alter table public.calls
    add constraint calls_lead_status_check
    check (lead_status in ('new', 'contacted', 'resolved', 'archived'));
end
$do$;

comment on column public.calls.lead_status is
  'Owner triage state: new | contacted (Followed Up) | resolved (Done) | archived';
