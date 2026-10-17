-- Team at scale: lookup indexes, one-query member directory (no N+1 auth lookups),
-- cron-safe expiry of stale invites. Additive and idempotent.

-- Ordered member pages per workspace.
create index if not exists tenant_members_tenant_created_idx
  on public.tenant_members (tenant_id, created_at, user_id);
-- (user_id, tenant_id) unique already covers user_id lookups; the plain user_id index is redundant.
drop index if exists public.tenant_members_user_id_idx;

-- Pending-invite pages per workspace, invites waiting for a signed-in email, and expiry sweeps.
create index if not exists tenant_invites_pending_tenant_idx
  on public.tenant_invites (tenant_id, created_at desc) where status = 'pending';
create index if not exists tenant_invites_pending_email_idx
  on public.tenant_invites (email) where status = 'pending';
create index if not exists tenant_invites_pending_expiry_idx
  on public.tenant_invites (expires_at) where status = 'pending';

-- Rate limits count recent invite/resend rows per workspace and per actor.
create index if not exists tenant_member_audit_rate_idx
  on public.tenant_member_audit (tenant_id, action, created_at desc);

-- One page of members with email + name from auth.users (service role only).
create or replace function public.tenant_member_directory(p_tenant uuid, p_limit int default 50, p_offset int default 0)
returns table (user_id uuid, role text, created_at timestamptz, email text, name text, total bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, m.role, m.created_at, u.email::text,
         coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), nullif(trim(u.raw_user_meta_data->>'name'), ''), '') as name,
         count(*) over () as total
  from public.tenant_members m
  left join auth.users u on u.id = m.user_id
  where m.tenant_id = p_tenant
  order by (m.role = 'owner') desc, m.created_at, m.user_id
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.tenant_member_directory(uuid, int, int) from public, anon, authenticated;
grant execute on function public.tenant_member_directory(uuid, int, int) to service_role;

-- Mark pending invites past their expiry as expired. Safe to run any time, from any scheduler.
create or replace function public.expire_stale_tenant_invites()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  update public.tenant_invites
     set status = 'expired'
   where status = 'pending' and expires_at < now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.expire_stale_tenant_invites() from public, anon, authenticated;
grant execute on function public.expire_stale_tenant_invites() to service_role;
