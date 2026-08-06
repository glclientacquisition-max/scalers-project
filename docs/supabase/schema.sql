-- Live Supabase schema target for Phase 1 (tenants / calls / transcripts).
-- Safe to re-run: uses IF NOT EXISTS. Aligns app code in src/db.js.
-- Storage bucket `call-recordings` should already exist (private).

create extension if not exists "pgcrypto";

-- Tenants (businesses / clients)
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  did_e164 text unique,
  owner_whatsapp_e164 text,
  system_prompt_override text,
  locale_default text not null default 'en-KE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Call CDRs
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete set null,
  call_sid text not null unique,
  provider text not null default 'twilio' check (provider in ('twilio', 'sautikit')),
  from_number text,
  to_number text,
  name text,
  reason text,
  recording_url text,
  recording_sid text,
  recording_path text,
  duration_seconds integer,
  status text not null default 'in_progress',
  whatsapp_sent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calls_tenant_id_idx on public.calls (tenant_id);
create index if not exists calls_created_at_idx on public.calls (created_at desc);
create index if not exists calls_from_number_idx on public.calls (from_number);

-- Full conversation transcript (one row per call)
create table if not exists public.transcripts (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null unique references public.calls (id) on delete cascade,
  call_sid text not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists transcripts_call_sid_idx on public.transcripts (call_sid);

-- Webhook / stream audit + idempotency (used from Phase 2+)
create table if not exists public.call_events (
  id uuid primary key default gen_random_uuid(),
  call_sid text references public.calls (call_sid) on delete cascade,
  event_id text unique,
  event_kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Optional RAG corpus (later)
create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  title text,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists knowledge_chunks_tenant_id_idx
  on public.knowledge_chunks (tenant_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tenants_set_updated_at on public.tenants;
create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function public.set_updated_at();

drop trigger if exists calls_set_updated_at on public.calls;
create trigger calls_set_updated_at
  before update on public.calls
  for each row execute function public.set_updated_at();

drop trigger if exists transcripts_set_updated_at on public.transcripts;
create trigger transcripts_set_updated_at
  before update on public.transcripts
  for each row execute function public.set_updated_at();

-- If an older draft used `businesses` instead of `tenants`, migrate manually
-- or rename before applying this file. App code expects `tenants`.

-- Storage: private bucket name `call-recordings` (create in dashboard if missing).
