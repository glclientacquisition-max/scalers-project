-- Phase C: SautiKit DID number pool
-- Run after multi_tenant_onboarding.sql (needs public.tenants).
-- Then seed available numbers (see docs/PRODUCTION_DID_POOL.md).
--
-- MVP: pre-buy DIDs in SautiKit console, point voice/events webhooks at Railway,
-- insert them here as status='available'. Signup assigns the next free DID.

-- ---------------------------------------------------------------------------
-- 1. Pool table
-- ---------------------------------------------------------------------------
create table if not exists public.sautikit_did_pool (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  e164 text not null unique,
  sautikit_number_id text,
  status text not null default 'available'
    check (status in ('available', 'assigned', 'reserved', 'disabled')),
  tenant_id uuid unique references public.tenants (id) on delete set null,
  assigned_at timestamptz,
  notes text
);

create index if not exists sautikit_did_pool_available_idx
  on public.sautikit_did_pool (created_at)
  where status = 'available';

-- ---------------------------------------------------------------------------
-- 2. Assign next available DID to a tenant (atomic)
-- ---------------------------------------------------------------------------
create or replace function public.assign_did_from_pool(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.sautikit_did_pool%rowtype;
  v_current text;
begin
  if p_tenant_id is null then
    return null;
  end if;

  select sautikit_virtual_number into v_current
  from public.tenants
  where id = p_tenant_id;

  -- Already has a real DID — leave pool alone.
  if v_current is not null and v_current not like 'pending:%' then
    return v_current;
  end if;

  select *
  into v_row
  from public.sautikit_did_pool
  where status = 'available'
  order by created_at asc
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.sautikit_did_pool
  set
    status = 'assigned',
    tenant_id = p_tenant_id,
    assigned_at = now()
  where id = v_row.id;

  update public.tenants
  set sautikit_virtual_number = v_row.e164
  where id = p_tenant_id;

  return v_row.e164;
end;
$$;

-- Assign a specific E.164 from the pool (ops / manual).
create or replace function public.assign_specific_did_to_tenant(
  p_tenant_id uuid,
  p_e164 text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_e164 text := nullif(trim(p_e164), '');
  v_id uuid;
begin
  if p_tenant_id is null or v_e164 is null then
    raise exception 'tenant_id and e164 are required';
  end if;

  update public.sautikit_did_pool
  set
    status = 'assigned',
    tenant_id = p_tenant_id,
    assigned_at = now()
  where e164 = v_e164
    and status in ('available', 'reserved')
  returning id into v_id;

  if v_id is null then
    raise exception 'DID % is not available in the pool', v_e164;
  end if;

  -- Free any other pool row previously pointing at this tenant.
  update public.sautikit_did_pool
  set
    status = 'available',
    tenant_id = null,
    assigned_at = null
  where tenant_id = p_tenant_id
    and id <> v_id;

  update public.tenants
  set sautikit_virtual_number = v_e164
  where id = p_tenant_id;

  return v_e164;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Hook into Auth signup trigger (replaces pending-only provisioner)
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
  v_langs text[] := array['en', 'sw', 'sheng']::text[];
begin
  v_business_name := nullif(trim(coalesce(NEW.raw_user_meta_data->>'business_name', '')), '');
  v_notify_phone := nullif(trim(coalesce(
    NEW.raw_user_meta_data->>'whatsapp_notification_number',
    NEW.raw_user_meta_data->>'notification_phone',
    ''
  )), '');

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
    voice_languages,
    voice_language_other,
    is_active,
    owner_user_id,
    telecom_wallet_balance_kes,
    ai_wallet_balance_usd
  ) values (
    v_business_name,
    'pending:' || NEW.id::text,
    v_notify_phone,
    public.default_tenant_llm_prompt(v_business_name, v_langs),
    v_langs,
    null,
    true,
    NEW.id,
    0,
    0
  )
  returning id into v_tenant_id;

  insert into public.tenant_members (user_id, tenant_id, role)
  values (NEW.id, v_tenant_id, 'owner')
  on conflict (user_id, tenant_id) do nothing;

  -- Phase C: claim a pre-provisioned DID when the pool has stock.
  perform public.assign_did_from_pool(v_tenant_id);

  return NEW;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Backfill: register existing real tenant DIDs as assigned in the pool
-- ---------------------------------------------------------------------------
insert into public.sautikit_did_pool (e164, status, tenant_id, assigned_at, notes)
select
  t.sautikit_virtual_number,
  'assigned',
  t.id,
  coalesce(t.created_at, now()),
  'backfill from existing tenants'
from public.tenants t
where t.sautikit_virtual_number is not null
  and t.sautikit_virtual_number not like 'pending:%'
on conflict (e164) do update
set
  status = 'assigned',
  tenant_id = excluded.tenant_id,
  assigned_at = coalesce(public.sautikit_did_pool.assigned_at, excluded.assigned_at);

-- ---------------------------------------------------------------------------
-- 5. Seed template (edit numbers, then uncomment)
-- ---------------------------------------------------------------------------
-- insert into public.sautikit_did_pool (e164, status, notes) values
--   ('+2547XXXXXXXX', 'available', 'Pre-bought; webhooks pointed at Railway'),
--   ('+2547YYYYYYYY', 'available', 'Pre-bought; webhooks pointed at Railway')
-- on conflict (e164) do nothing;

-- Assign a DID to an existing pending tenant manually:
-- select public.assign_did_from_pool('<tenant-uuid>');
-- or:
-- select public.assign_specific_did_to_tenant('<tenant-uuid>', '+2547XXXXXXXX');
