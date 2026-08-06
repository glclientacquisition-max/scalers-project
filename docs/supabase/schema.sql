-- Supabase schema for MISSED-CALL-PROJECT production migration
-- Apply in Supabase SQL editor (or via migration tooling) before enabling DB_BACKEND=supabase.

create extension if not exists "pgcrypto";

-- Tenants / client businesses
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  did_e164 text unique,
  owner_whatsapp_e164 text,
  system_prompt_override text,
  locale_default text not null default 'en-KE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Call records (mirrors phase-1 SQLite `calls` + production fields)
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses (id) on delete set null,
  -- Twilio CallSid or SautiKit call_id
  call_sid text not null unique,
  provider text not null default 'sautikit' check (provider in ('twilio', 'sautikit')),
  from_number text,
  to_number text,
  name text,
  reason text,
  transcript text,
  recording_url text,
  recording_sid text,
  duration_seconds integer,
  status text not null default 'in_progress',
  whatsapp_sent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calls_business_id_idx on public.calls (business_id);
create index if not exists calls_created_at_idx on public.calls (created_at desc);
create index if not exists calls_from_number_idx on public.calls (from_number);

-- Webhook / stream audit + idempotency
create table if not exists public.call_events (
  id uuid primary key default gen_random_uuid(),
  call_sid text references public.calls (call_sid) on delete cascade,
  event_id text unique,
  event_kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Optional RAG corpus (phase 6+)
create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  title text,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists knowledge_chunks_business_id_idx
  on public.knowledge_chunks (business_id);

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists businesses_set_updated_at on public.businesses;
create trigger businesses_set_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

drop trigger if exists calls_set_updated_at on public.calls;
create trigger calls_set_updated_at
  before update on public.calls
  for each row execute function public.set_updated_at();

-- Storage: create bucket `call-recordings` in Supabase dashboard (private).
-- Dashboard RLS policies should scope by business membership once Auth is added.
