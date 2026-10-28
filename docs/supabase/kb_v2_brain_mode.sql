-- Retire the old brain, P1 (kb_v2), version 2026-10-28.4. Apply AFTER kb_v2_paste_replace.sql (2026-10-28.3).
-- ADDITIVE. tenants.brain_mode 'full' (default) | 'safe' = "Take messages only" (Brain builds the safe script: greet,
-- take name / number / reason, read back, alert / hand over). Who set it: brain_mode_set_by / _set_at / _source
-- ('owner' = the business from Desk Settings, 'admin' = Super Admin). BRAIN_SAFE_MODE=all on Voice/Desk overrides every
-- business (env only, never written here).
-- Writes: ONLY through public.set_brain_mode(p_tenant, p_mode, p_actor) (SECURITY DEFINER, search_path pinned):
--   * authenticated caller who is an owner or admin member of p_tenant (Desk toggle) -> source 'owner';
--   * service role (Super Admin API, p_actor = the admin's user id) -> source 'admin';
--   * anyone else, another business, or a mode other than full/safe -> error, nothing written.
-- It changes only the four brain_mode columns and appends one row to public.tenant_brain_mode_audit.
-- Members read the columns with their row (tenants_select_member). No column UPDATE grant for authenticated / anon;
-- the restrictive tenants_update_admin_only policy stays. tenants.brain_target is left in place (read-free from P1)
-- and dropped one release later by kb_v2_drop_brain_target.sql (P2).
-- Idempotent. Rollback: docs/supabase/kb_v2_brain_mode_down.sql. Staging first; prod only on Alvin's yes.

alter table public.tenants add column if not exists brain_mode text not null default 'full';
alter table public.tenants add column if not exists brain_mode_set_by uuid;
alter table public.tenants add column if not exists brain_mode_set_at timestamptz;
alter table public.tenants add column if not exists brain_mode_source text;
do $$ begin
  alter table public.tenants add constraint tenants_brain_mode check (brain_mode in ('full', 'safe'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tenants add constraint tenants_brain_mode_source check (brain_mode_source is null or brain_mode_source in ('owner', 'admin'));
exception when duplicate_object then null; end $$;
comment on column public.tenants.brain_mode is 'full = the KB brain; safe = "Take messages only" (greet, take name / number / reason, read back, alert / hand over). Write only via public.set_brain_mode. BRAIN_SAFE_MODE=all overrides every business.';
comment on column public.tenants.brain_mode_source is 'owner = set by the business (Desk Settings); admin = set by Super Admin. Null = never set (default full).';
revoke update (brain_mode, brain_mode_set_by, brain_mode_set_at, brain_mode_source) on public.tenants from authenticated, anon;

create table if not exists public.tenant_brain_mode_audit (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  actor uuid,
  source text not null check (source in ('owner', 'admin')),
  from_mode text,
  to_mode text not null check (to_mode in ('full', 'safe')),
  created_at timestamptz not null default now()
);
create index if not exists tenant_brain_mode_audit_tenant_idx on public.tenant_brain_mode_audit (tenant_id, created_at desc);
alter table public.tenant_brain_mode_audit enable row level security;
revoke all on public.tenant_brain_mode_audit from public, anon, authenticated;
grant select on public.tenant_brain_mode_audit to authenticated;
grant all on public.tenant_brain_mode_audit to service_role;
do $$ begin
  create policy tenant_brain_mode_audit_select_member on public.tenant_brain_mode_audit for select to authenticated
    using (exists (select 1 from public.tenant_members m where m.tenant_id = tenant_brain_mode_audit.tenant_id and m.user_id = auth.uid()));
exception when duplicate_object then null; end $$;

create or replace function public.set_brain_mode(p_tenant uuid, p_mode text, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_service boolean := coalesce(auth.role(), '') = 'service_role';
  v_role text;
  v_source text;
  v_actor uuid;
  v_from text;
begin
  if p_mode is null or p_mode not in ('full', 'safe') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;
  if v_service then
    v_source := 'admin';
    v_actor := p_actor;
  else
    if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
    select role into v_role from public.tenant_members where tenant_id = p_tenant and user_id = v_uid;
    if v_role is null or v_role not in ('owner', 'admin') then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    v_source := 'owner';
    v_actor := v_uid; -- p_actor is ignored for members
  end if;
  select brain_mode into v_from from public.tenants where id = p_tenant for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  update public.tenants
     set brain_mode = p_mode, brain_mode_set_by = v_actor, brain_mode_set_at = now(), brain_mode_source = v_source
   where id = p_tenant;
  insert into public.tenant_brain_mode_audit (tenant_id, actor, source, from_mode, to_mode)
  values (p_tenant, v_actor, v_source, v_from, p_mode);
  return jsonb_build_object('tenant_id', p_tenant, 'brain_mode', p_mode, 'from', v_from, 'source', v_source, 'set_by', v_actor, 'set_at', now());
end $$;
revoke all on function public.set_brain_mode(uuid, text, uuid) from public, anon;
grant execute on function public.set_brain_mode(uuid, text, uuid) to authenticated, service_role;
