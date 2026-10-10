-- Team member logins, roles and invites (design: scalers-invites-design.md).
-- ADDITIVE ONLY. Not applied anywhere yet. Apply to staging first.
-- App feature flag: TEAM_INVITES_ENABLED / TEAM_INVITES_TENANTS (default off).

create extension if not exists citext;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Roles: owner | admin | staff | viewer   (legacy 'member' -> 'staff')
-- ---------------------------------------------------------------------------
alter table public.tenant_members drop constraint if exists tenant_members_role_check;
update public.tenant_members set role = 'staff' where role = 'member';
alter table public.tenant_members
  add constraint tenant_members_role_check
  check (role in ('owner', 'admin', 'staff', 'viewer'));
alter table public.tenant_members add column if not exists invited_by uuid references auth.users (id);
alter table public.tenant_members add column if not exists updated_at timestamptz not null default now();

-- Exactly one owner per workspace. If this fails, a tenant already has two
-- owners: resolve those rows manually (keep tenants.owner_user_id) and re-run.
create unique index if not exists tenant_members_one_owner
  on public.tenant_members (tenant_id) where role = 'owner';

-- ---------------------------------------------------------------------------
-- 2. Invites (token stored only as sha256 hex)
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email citext not null,
  role text not null check (role in ('admin', 'staff', 'viewer')),
  token_hash text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id),
  revoked_at timestamptz
);
create unique index if not exists tenant_invites_one_pending
  on public.tenant_invites (tenant_id, email) where status = 'pending';
create index if not exists tenant_invites_tenant_idx on public.tenant_invites (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Audit
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_member_audit (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  actor uuid references auth.users (id),
  action text not null,           -- invite | resend | revoke | accept | role_change | remove | transfer_ownership
  target_email text,
  target_user uuid,
  from_role text,
  to_role text,
  created_at timestamptz not null default now()
);
create index if not exists tenant_member_audit_tenant_idx on public.tenant_member_audit (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.current_member_role(p_tenant uuid)
returns text language sql stable security definer set search_path = public as $$
  select role from public.tenant_members where tenant_id = p_tenant and user_id = auth.uid();
$$;

create or replace function public.member_can_write(p_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_member_role(p_tenant) in ('owner', 'admin', 'staff'), false);
$$;

create or replace function public.member_can_admin(p_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_member_role(p_tenant) in ('owner', 'admin'), false);
$$;

-- Seats used = members + pending (unexpired) invites. Owner counts.
create or replace function public.tenant_seats_used(p_tenant uuid)
returns integer language sql stable security definer set search_path = public as $$
  select (select count(*) from public.tenant_members where tenant_id = p_tenant)::int
       + (select count(*) from public.tenant_invites
            where tenant_id = p_tenant and status = 'pending' and expires_at > now())::int;
$$;

create or replace function public.tenant_seat_available(p_tenant uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.tenant_seats_used(p_tenant) < coalesce((select seat_included from public.tenants where id = p_tenant), 0);
$$;

-- Create an invite atomically (seat check under a row lock on the tenant).
create or replace function public.create_tenant_invite(
  p_tenant uuid, p_email text, p_role text, p_token_hash text, p_actor uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_actor_role text;
begin
  perform 1 from public.tenants where id = p_tenant for update;
  select role into v_actor_role from public.tenant_members where tenant_id = p_tenant and user_id = p_actor;
  if v_actor_role is null or v_actor_role not in ('owner', 'admin') then raise exception 'forbidden'; end if;
  if p_role not in ('admin', 'staff', 'viewer') then raise exception 'bad_role'; end if;
  if v_actor_role = 'admin' and p_role = 'admin' then raise exception 'forbidden'; end if;
  if exists (select 1 from public.tenant_members m join auth.users u on u.id = m.user_id
             where m.tenant_id = p_tenant and lower(u.email) = lower(p_email)) then
    raise exception 'already_member';
  end if;
  update public.tenant_invites set status = 'expired'
    where tenant_id = p_tenant and status = 'pending' and expires_at <= now();
  if exists (select 1 from public.tenant_invites where tenant_id = p_tenant and email = p_email and status = 'pending') then
    raise exception 'already_invited';
  end if;
  if not public.tenant_seat_available(p_tenant) then raise exception 'seats_full'; end if;
  insert into public.tenant_invites (tenant_id, email, role, token_hash, invited_by)
    values (p_tenant, p_email, p_role, p_token_hash, p_actor) returning id into v_id;
  insert into public.tenant_member_audit (tenant_id, actor, action, target_email, to_role)
    values (p_tenant, p_actor, 'invite', p_email, p_role);
  return v_id;
end $$;

-- Accept atomically: valid + unexpired + email matches + seat re-check (pending row itself is
-- already counted, so accepting converts a seat rather than consuming a new one).
create or replace function public.accept_tenant_invite(p_token_hash text, p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_inv public.tenant_invites%rowtype; v_email text;
begin
  select * into v_inv from public.tenant_invites where token_hash = p_token_hash for update;
  if not found then raise exception 'invalid'; end if;
  if v_inv.status <> 'pending' then raise exception 'not_pending'; end if;
  if v_inv.expires_at <= now() then
    update public.tenant_invites set status = 'expired' where id = v_inv.id;
    raise exception 'expired';
  end if;
  select email into v_email from auth.users where id = p_user;
  if v_email is null or lower(v_email) <> lower(v_inv.email::text) then raise exception 'email_mismatch'; end if;
  perform 1 from public.tenants where id = v_inv.tenant_id for update;
  if (select count(*) from public.tenant_members where tenant_id = v_inv.tenant_id)
       >= coalesce((select seat_included from public.tenants where id = v_inv.tenant_id), 0) then
    raise exception 'seats_full';
  end if;
  insert into public.tenant_members (user_id, tenant_id, role, invited_by)
    values (p_user, v_inv.tenant_id, v_inv.role, v_inv.invited_by)
    on conflict (user_id, tenant_id) do nothing;
  update public.tenant_invites set status = 'accepted', accepted_at = now(), accepted_by = p_user where id = v_inv.id;
  insert into public.tenant_member_audit (tenant_id, actor, action, target_email, target_user, to_role)
    values (v_inv.tenant_id, p_user, 'accept', v_inv.email, p_user, v_inv.role);
  return v_inv.tenant_id;
end $$;

-- Transfer ownership to an existing admin (old owner becomes admin).
create or replace function public.transfer_tenant_ownership(p_tenant uuid, p_actor uuid, p_new_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.tenants where id = p_tenant for update;
  if not exists (select 1 from public.tenant_members where tenant_id = p_tenant and user_id = p_actor and role = 'owner') then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.tenant_members where tenant_id = p_tenant and user_id = p_new_owner and role = 'admin') then
    raise exception 'target_not_admin';
  end if;
  update public.tenant_members set role = 'admin', updated_at = now() where tenant_id = p_tenant and user_id = p_actor;
  update public.tenant_members set role = 'owner', updated_at = now() where tenant_id = p_tenant and user_id = p_new_owner;
  update public.tenants set owner_user_id = p_new_owner where id = p_tenant;
  insert into public.tenant_member_audit (tenant_id, actor, action, target_user, from_role, to_role)
    values (p_tenant, p_actor, 'transfer_ownership', p_new_owner, 'admin', 'owner');
end $$;

revoke all on function public.create_tenant_invite(uuid, text, text, text, uuid) from public, authenticated;
revoke all on function public.accept_tenant_invite(text, uuid) from public, authenticated;
revoke all on function public.transfer_tenant_ownership(uuid, uuid, uuid) from public, authenticated;
grant execute on function public.create_tenant_invite(uuid, text, text, text, uuid) to service_role;
grant execute on function public.accept_tenant_invite(text, uuid) to service_role;
grant execute on function public.transfer_tenant_ownership(uuid, uuid, uuid) to service_role;
grant execute on function public.current_member_role(uuid), public.member_can_write(uuid),
  public.member_can_admin(uuid), public.tenant_seats_used(uuid), public.tenant_seat_available(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. RLS: invites/audit readable by owner/admin; writes via service-role RPCs only.
-- ---------------------------------------------------------------------------
alter table public.tenant_invites enable row level security;
alter table public.tenant_member_audit enable row level security;
drop policy if exists tenant_invites_select_admin on public.tenant_invites;
create policy tenant_invites_select_admin on public.tenant_invites
  for select to authenticated using (public.member_can_admin(tenant_id));
drop policy if exists tenant_member_audit_select_admin on public.tenant_member_audit;
create policy tenant_member_audit_select_admin on public.tenant_member_audit
  for select to authenticated using (public.member_can_admin(tenant_id));

-- Members can see co-members of their workspaces (Members list).
drop policy if exists tenant_members_select_cotenant on public.tenant_members;
create policy tenant_members_select_cotenant on public.tenant_members
  for select to authenticated using (tenant_id in (select public.current_user_tenant_ids()));

-- Tightening, added as RESTRICTIVE policies so existing permissive policies stay
-- untouched (purely additive): settings = owner/admin, desk writes = not viewer.
drop policy if exists tenants_update_admin_only on public.tenants;
create policy tenants_update_admin_only on public.tenants
  as restrictive for update to authenticated
  using (public.member_can_admin(id)) with check (public.member_can_admin(id));

do $$
declare t text;
begin
  foreach t in array array['calls', 'contacts', 'service_requests', 'appointments'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_write_not_viewer_u', t);
      execute format('create policy %I on public.%I as restrictive for update to authenticated using (public.member_can_write(tenant_id)) with check (public.member_can_write(tenant_id))', t || '_write_not_viewer_u', t);
      execute format('drop policy if exists %I on public.%I', t || '_write_not_viewer_i', t);
      execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (public.member_can_write(tenant_id))', t || '_write_not_viewer_i', t);
      execute format('drop policy if exists %I on public.%I', t || '_write_not_viewer_d', t);
      execute format('create policy %I on public.%I as restrictive for delete to authenticated using (public.member_can_write(tenant_id))', t || '_write_not_viewer_d', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Signup trigger: invitees (raw_user_meta_data.invite = 'true') get no new workspace.
--    Body otherwise identical to docs/supabase/voice_languages.sql.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user_tenant()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_business_name text;
  v_notify_phone text;
  v_tenant_id uuid;
  v_langs text[] := array['en', 'sw', 'sheng']::text[];
begin
  if coalesce(NEW.raw_user_meta_data->>'invite', '') = 'true' then
    return NEW;  -- joins an existing workspace via accept_tenant_invite
  end if;

  v_business_name := nullif(trim(coalesce(NEW.raw_user_meta_data->>'business_name', '')), '');
  v_notify_phone := nullif(trim(coalesce(
    NEW.raw_user_meta_data->>'whatsapp_notification_number',
    NEW.raw_user_meta_data->>'notification_phone', ''
  )), '');
  if v_business_name is null then return NEW; end if;
  if v_notify_phone is null then v_notify_phone := 'pending'; end if;

  insert into public.tenants (
    business_name, sautikit_virtual_number, whatsapp_notification_number, llm_system_prompt,
    voice_languages, voice_language_other, is_active, owner_user_id,
    telecom_wallet_balance_kes, ai_wallet_balance_usd
  ) values (
    v_business_name, 'pending:' || NEW.id::text, v_notify_phone,
    public.default_tenant_llm_prompt(v_business_name, v_langs),
    v_langs, null, true, NEW.id, 0, 0
  ) returning id into v_tenant_id;

  insert into public.tenant_members (user_id, tenant_id, role)
  values (NEW.id, v_tenant_id, 'owner') on conflict (user_id, tenant_id) do nothing;

  begin
    perform public.assign_did_from_pool(v_tenant_id);
  exception when undefined_function then null;
  end;
  return NEW;
end;
$fn$;
