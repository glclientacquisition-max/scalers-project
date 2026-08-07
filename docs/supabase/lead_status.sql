-- CRM lead status for the workspace triage inbox.
-- Run in the Supabase SQL editor after owner_rls.sql.
--
-- Owners move a call through: new -> contacted -> resolved.
-- Voice engine (service_role) keeps writing calls; new rows default to 'new'.
-- ASCII-only (safe for Supabase SQL Editor).

alter table public.calls
  add column if not exists lead_status text not null default 'new';

do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'calls_lead_status_check'
  ) then
    alter table public.calls
      add constraint calls_lead_status_check
      check (lead_status in ('new', 'contacted', 'resolved'));
  end if;
end
$do$;

comment on column public.calls.lead_status is
  'Owner triage state: new | contacted | resolved';

-- ---------------------------------------------------------------------------
-- RLS: owners may update ONLY lead_status on their own calls
-- ---------------------------------------------------------------------------
drop policy if exists calls_update_member on public.calls;
create policy calls_update_member
  on public.calls
  for update
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

-- Column-level grant: authenticated can update lead_status and nothing else.
revoke update on public.calls from authenticated;
grant update (lead_status) on public.calls to authenticated;

-- Backfill: mark previously handled calls as resolved if the owner was alerted.
-- (Optional; leave commented if you prefer everything to start as 'new'.)
-- update public.calls set lead_status = 'resolved'
-- where summary like '%"whatsapp_sent":true%' and lead_status = 'new';
