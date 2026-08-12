-- Platform Soniox voice catalog (Super Admin managed) + per-tenant voice pick.
-- Apply after tts_lexicon.sql.
--
-- platform_soniox_voices: curated allowlist (admin controls ids + descriptions)
-- tenants.soniox_voice_id / soniox_voice_label: owner pick + owner label

-- ---------------------------------------------------------------------------
-- Tenant columns
-- ---------------------------------------------------------------------------
alter table public.tenants
  add column if not exists soniox_voice_id text;

alter table public.tenants
  add column if not exists soniox_voice_label text;

comment on column public.tenants.soniox_voice_id is
  'Optional Soniox cloned voice UUID from platform catalog; null uses default.';

comment on column public.tenants.soniox_voice_label is
  'Owner label for the phone voice profile (desk display only).';

grant update (soniox_voice_id, soniox_voice_label) on public.tenants to authenticated;

-- ---------------------------------------------------------------------------
-- Platform catalog (service role / Super Admin only — no owner RLS policies)
-- ---------------------------------------------------------------------------
create table if not exists public.platform_soniox_voices (
  id text primary key,
  description text not null default '',
  is_default boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_soniox_voices_id_uuidish check (
    id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
);

comment on table public.platform_soniox_voices is
  'Curated Soniox cloned voices offered to workspaces. Super Admin manages rows.';

comment on column public.platform_soniox_voices.id is
  'Soniox cloned voice UUID';

comment on column public.platform_soniox_voices.description is
  'Admin-written hint shown to owners when picking a phone voice';

create index if not exists platform_soniox_voices_active_sort_idx
  on public.platform_soniox_voices (is_active, sort_order, created_at);

alter table public.platform_soniox_voices enable row level security;

-- No policies for authenticated/anon — only service_role (Super Admin APIs + voice engine).
revoke all on public.platform_soniox_voices from anon, authenticated;
grant select, insert, update, delete on public.platform_soniox_voices to service_role;

-- Keep a single default among active rows.
create or replace function public.platform_soniox_voices_enforce_single_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.is_default is true and new.is_active is true then
    update public.platform_soniox_voices
    set is_default = false, updated_at = now()
    where id <> new.id
      and is_default is true;
  end if;
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists platform_soniox_voices_single_default
  on public.platform_soniox_voices;

create trigger platform_soniox_voices_single_default
  before insert or update of is_default, is_active
  on public.platform_soniox_voices
  for each row
  execute function public.platform_soniox_voices_enforce_single_default();

-- Seed Scalers default cloned voice (idempotent).
insert into public.platform_soniox_voices (id, description, is_default, is_active, sort_order)
values (
  '7b197f3c-84b4-4404-986f-114e4dac1432',
  'Warm Kenyan receptionist tone',
  true,
  true,
  10
)
on conflict (id) do update
set
  description = excluded.description,
  is_default = excluded.is_default,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();
