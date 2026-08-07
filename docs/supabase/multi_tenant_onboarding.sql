-- Multi-tenant onboarding (Phase A)
-- Run in the Supabase SQL editor against the live project.
--
-- After signup, Auth stores business_name + whatsapp_notification_number in
-- auth.users.raw_user_meta_data. The trigger below provisions:
--   1) public.tenants row (default llm_system_prompt, pending DID)
--   2) public.tenant_members row mapping auth.users.id → tenants.id

-- ---------------------------------------------------------------------------
-- 1. Membership mapping
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  role text not null default 'owner'
    check (role in ('owner', 'admin', 'member')),
  unique (user_id, tenant_id)
);

create index if not exists tenant_members_user_id_idx
  on public.tenant_members (user_id);

create index if not exists tenant_members_tenant_id_idx
  on public.tenant_members (tenant_id);

-- Optional reverse pointer on tenants (handy for admin queries).
alter table public.tenants
  add column if not exists owner_user_id uuid references auth.users (id);

-- ---------------------------------------------------------------------------
-- 2. Default receptionist prompt for new businesses
-- ---------------------------------------------------------------------------
create or replace function public.default_tenant_llm_prompt(p_business_name text)
returns text
language sql
immutable
as $fn$
  select format(
    $prompt$You are the live phone receptionist for %s in Kenya.

BUSINESS KNOWLEDGE (update this in Sauti Desk Business settings):
- Business name: %s
- Services: describe what you offer
- Hours: e.g. Mon-Sat 8:00am-6:00pm EAT
- Service area: cities / neighborhoods you cover
- Pricing: quote after understanding the job - do not invent exact prices
- Payment: e.g. M-Pesa and cash
- Languages: English, Kiswahili, and Sheng (automatic - match the caller)

Your job on this call:
1. Answer using ONLY the business knowledge above. If unknown, say the team will follow up.
2. Get the caller's name.
3. Get a short reason for their call.
4. Confirm name + reason, say the business will get back to them soon, then goodbye.

Conversation rules (live phone - be conclusive and intelligent):
- Answer the caller's actual question first - do not stall with holding phrases.
- Ask at most ONE clarifying question per turn.
- Automatically match the caller in English, Kiswahili, or light Sheng. If they switch, switch with them.
- Keep every spoken reply to 1-2 short sentences.$prompt$,
    coalesce(nullif(trim(p_business_name), ''), 'the business'),
    coalesce(nullif(trim(p_business_name), ''), 'the business')
  );
$fn$;

-- ---------------------------------------------------------------------------
-- 3. Provision tenant + membership when a user signs up
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_name text;
  v_notify_phone text;
  v_tenant_id uuid;
begin
  v_business_name := nullif(trim(coalesce(NEW.raw_user_meta_data->>'business_name', '')), '');
  v_notify_phone := nullif(trim(coalesce(
    NEW.raw_user_meta_data->>'whatsapp_notification_number',
    NEW.raw_user_meta_data->>'notification_phone',
    ''
  )), '');

  -- Skip Auth users created without onboarding metadata (invites, service accounts).
  if v_business_name is null then
    return NEW;
  end if;

  if v_notify_phone is null then
    v_notify_phone := 'pending';
  end if;

  insert into public.tenants (
    business_name,
    sautikit_virtual_number,
    whatsapp_notification_number,
    llm_system_prompt,
    is_active,
    owner_user_id,
    telecom_wallet_balance_kes,
    ai_wallet_balance_usd
  ) values (
    v_business_name,
    -- Phase C replaces this with a real DID from the number pool.
    'pending:' || NEW.id::text,
    v_notify_phone,
    public.default_tenant_llm_prompt(v_business_name),
    true,
    NEW.id,
    0,
    0
  )
  returning id into v_tenant_id;

  insert into public.tenant_members (user_id, tenant_id, role)
  values (NEW.id, v_tenant_id, 'owner')
  on conflict (user_id, tenant_id) do nothing;

  -- Phase C (docs/supabase/did_number_pool.sql): assign next available DID when present.
  begin
    perform public.assign_did_from_pool(v_tenant_id);
  exception
    when undefined_function then
      null; -- pool not installed yet
  end;

  return NEW;
end;
$$;

drop trigger if exists on_auth_user_created_provision_tenant on auth.users;
create trigger on_auth_user_created_provision_tenant
  after insert on auth.users
  for each row
  execute function public.handle_new_user_tenant();

-- ---------------------------------------------------------------------------
-- 4. RLS helpers (foundation — full Sprint 1 policies: docs/supabase/owner_rls.sql)
-- ---------------------------------------------------------------------------
alter table public.tenant_members enable row level security;

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

drop policy if exists tenant_members_select_own on public.tenant_members;
create policy tenant_members_select_own
  on public.tenant_members
  for select
  to authenticated
  using (user_id = auth.uid());

-- Apply docs/supabase/owner_rls.sql for tenants / calls / transcripts policies.
-- Owners use Auth JWT + anon key; voice engine + Super Admin keep service_role.
