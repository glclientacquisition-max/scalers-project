-- Phone alerts: one row per device (browser push endpoint) per signed-in Desk user.
-- Runbook: docs/reference/platform/DESK_PWA_PUSH.md. Writer: dashboard /api/push/subscribe.
-- Reader/sender: src/notifications/push.js (service role).
-- provider: 'webpush' now; 'fcm' / 'apns' later for a native wrapper (same table).
-- ADDITIVE. Safe to re-run. NOT APPLIED anywhere yet: staging needs Alvin's own GO.
-- Rollback: docs/supabase/push_subscriptions_down.sql

create extension if not exists pgcrypto;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null default 'webpush',
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  platform text,
  device_label text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  fail_count int not null default 0,
  disabled_at timestamptz,
  constraint push_subscriptions_provider check (provider in ('webpush', 'fcm', 'apns'))
);

create index if not exists push_subscriptions_tenant_live
  on public.push_subscriptions (tenant_id) where disabled_at is null;
create index if not exists push_subscriptions_user
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- A signed-in user sees and changes only their own devices, and only for a business they belong to.
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.tenant_members m
      where m.tenant_id = push_subscriptions.tenant_id and m.user_id = auth.uid()
    )
  );

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());

revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

comment on table public.push_subscriptions is
  'Desk phone alerts (web push). One row per device endpoint. See docs/reference/platform/DESK_PWA_PUSH.md';
