-- Owner desk insert for contacts (manual add + CSV import).
-- Run after: contacts_and_requests.sql
-- Voice still writes via service_role. Owners insert only for their tenant.

drop policy if exists contacts_insert_member on public.contacts;
create policy contacts_insert_member
  on public.contacts
  for insert
  to authenticated
  with check (tenant_id in (select public.current_user_tenant_ids()));

grant insert on public.contacts to authenticated;
