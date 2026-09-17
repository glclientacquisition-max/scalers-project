-- whatsapp_threads.sql
-- Purpose: persist Scalers platform two-way WhatsApp (SautiKit stores nothing).
-- Identity: Meta phone_number_id 1237105982825100 / SautiKit number
-- 81424fbd-8f4c-459a-858d-98ced4393df6 / E.164 +254709221536 is Scalers chat.
-- Voice on that DID still maps to Done and Dusted until Phase 2 (second DID).
-- Inbound routing is phone_number_id, never tenants.sautikit_virtual_number.
-- Phase 1 tables are platform inbox: no owner RLS (shop owners must not
-- read other tenants' support chat). Voice writes via service_role.
-- Run after: notify_send_ledger.sql
-- Idempotent. ASCII-only.

create table if not exists public.whatsapp_threads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  identity text not null default 'platform',
  phone_number_id text not null,
  sautikit_number_id text,
  e164 text,
  contact_wa_id text not null,
  contact_name text,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  constraint whatsapp_threads_identity_check check (
    identity in ('platform', 'shop')
  ),
  constraint whatsapp_threads_contact_key unique (identity, phone_number_id, contact_wa_id)
);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  thread_id uuid not null references public.whatsapp_threads (id) on delete cascade,
  direction text not null,
  wamid text,
  msg_type text,
  body text,
  status text,
  payload jsonb,
  constraint whatsapp_messages_direction_check check (
    direction in ('inbound', 'outbound')
  )
);

create unique index if not exists whatsapp_messages_wamid_idx
  on public.whatsapp_messages (wamid)
  where wamid is not null;

create index if not exists whatsapp_messages_thread_created_idx
  on public.whatsapp_messages (thread_id, created_at desc);

comment on table public.whatsapp_threads is
  'Scalers platform WhatsApp sessions. Do not resolve by voice DID.';
comment on table public.whatsapp_messages is
  'Inbound/outbound WhatsApp trail. Dedupe on wamid.';

alter table public.whatsapp_threads enable row level security;
alter table public.whatsapp_messages enable row level security;

revoke all on public.whatsapp_threads from public;
revoke all on public.whatsapp_threads from anon;
revoke all on public.whatsapp_threads from authenticated;
revoke all on public.whatsapp_messages from public;
revoke all on public.whatsapp_messages from anon;
revoke all on public.whatsapp_messages from authenticated;

grant all on public.whatsapp_threads to service_role;
grant all on public.whatsapp_messages to service_role;
