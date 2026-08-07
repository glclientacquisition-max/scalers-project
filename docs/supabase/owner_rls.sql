-- Sprint 1: Owner Row Level Security
-- Run in the Supabase SQL editor after multi_tenant_onboarding.sql.
--
-- Goal: workspace owners read/update ONLY their own tenant data via the
-- authenticated JWT (anon key + user session). Super Admin ops and the
-- Railway voice engine keep using the service_role key, which bypasses RLS.
--
-- ASCII-only (safe for Supabase SQL Editor).

-- ---------------------------------------------------------------------------
-- Helper: tenant ids for the current Auth user (security definer avoids RLS recursion)
-- ---------------------------------------------------------------------------
create or replace function public.current_user_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id
  from public.tenant_members
  where user_id = auth.uid();
$$;

revoke all on function public.current_user_tenant_ids() from public;
grant execute on function public.current_user_tenant_ids() to authenticated;
grant execute on function public.current_user_tenant_ids() to service_role;

-- ---------------------------------------------------------------------------
-- tenant_members
-- ---------------------------------------------------------------------------
alter table public.tenant_members enable row level security;

drop policy if exists tenant_members_select_own on public.tenant_members;
create policy tenant_members_select_own
  on public.tenant_members
  for select
  to authenticated
  using (user_id = auth.uid());

-- Owners do not insert/delete memberships from the desk (signup trigger / service role only).
drop policy if exists tenant_members_insert_own on public.tenant_members;
drop policy if exists tenant_members_update_own on public.tenant_members;
drop policy if exists tenant_members_delete_own on public.tenant_members;

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------
alter table public.tenants enable row level security;

drop policy if exists tenants_select_member on public.tenants;
create policy tenants_select_member
  on public.tenants
  for select
  to authenticated
  using (id in (select public.current_user_tenant_ids()));

drop policy if exists tenants_update_member on public.tenants;
create policy tenants_update_member
  on public.tenants
  for update
  to authenticated
  using (id in (select public.current_user_tenant_ids()))
  with check (id in (select public.current_user_tenant_ids()));

-- No authenticated INSERT/DELETE on tenants (provisioning is service role / Auth trigger).

-- ---------------------------------------------------------------------------
-- calls
-- ---------------------------------------------------------------------------
alter table public.calls enable row level security;

drop policy if exists calls_select_member on public.calls;
create policy calls_select_member
  on public.calls
  for select
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

-- Voice engine writes calls with service_role (bypasses RLS). No owner inserts.

-- ---------------------------------------------------------------------------
-- transcripts
-- ---------------------------------------------------------------------------
alter table public.transcripts enable row level security;

drop policy if exists transcripts_select_member on public.transcripts;
create policy transcripts_select_member
  on public.transcripts
  for select
  to authenticated
  using (
    call_id in (
      select c.id
      from public.calls c
      where c.tenant_id in (select public.current_user_tenant_ids())
    )
  );

-- ---------------------------------------------------------------------------
-- Table grants for authenticated (RLS still filters rows)
-- ---------------------------------------------------------------------------
grant select on public.tenant_members to authenticated;
grant select, update on public.tenants to authenticated;
grant select on public.calls to authenticated;
grant select on public.transcripts to authenticated;

-- service_role already has full access and bypasses RLS in Supabase.

comment on function public.current_user_tenant_ids() is
  'Sprint 1 RLS helper: tenant ids for auth.uid() memberships';
