-- Role enforcement hardening (audit: scalers-roles-matrix.md). ADDITIVE / tightening only.
-- Server code touches these tables via the service role (bypasses RLS) or security-definer RPCs.

-- 1. DID pool: never reachable with the public anon key or a user JWT.
--    Used only by assign_did_from_pool (security definer) and service-role admin routes.
alter table public.sautikit_did_pool enable row level security;
revoke all on table public.sautikit_did_pool from anon, authenticated;

-- 2. tenant_field_meta (settings provenance): owner/admin writes only.
drop policy if exists tenant_field_meta_write_admin_i on public.tenant_field_meta;
create policy tenant_field_meta_write_admin_i on public.tenant_field_meta
  as restrictive for insert to authenticated with check (public.member_can_admin(tenant_id));
drop policy if exists tenant_field_meta_write_admin_u on public.tenant_field_meta;
create policy tenant_field_meta_write_admin_u on public.tenant_field_meta
  as restrictive for update to authenticated
  using (public.member_can_admin(tenant_id)) with check (public.member_can_admin(tenant_id));
-- The upsert/confirm RPCs are security definer (bypass RLS), so also guard at row level.
-- Service-role / system writes (no auth.uid()) are unaffected.
create or replace function public._tenant_field_meta_admin_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.member_can_admin(NEW.tenant_id) then
    raise exception 'forbidden: only the owner or an admin can change business settings';
  end if;
  return NEW;
end $$;
drop trigger if exists tenant_field_meta_admin_guard on public.tenant_field_meta;
create trigger tenant_field_meta_admin_guard
  before insert or update on public.tenant_field_meta
  for each row execute function public._tenant_field_meta_admin_guard();

-- 3. notify_sends: viewers can't create send-ledger rows (staff replying to callers still can).
drop policy if exists notify_sends_write_not_viewer_i on public.notify_sends;
create policy notify_sends_write_not_viewer_i on public.notify_sends
  as restrictive for insert to authenticated with check (public.member_can_write(tenant_id));

-- 4. wallet_ledger: usage/billing history readable by owner/admin only.
drop policy if exists wallet_ledger_select_admin on public.wallet_ledger;
create policy wallet_ledger_select_admin on public.wallet_ledger
  as restrictive for select to authenticated using (public.member_can_admin(tenant_id));
