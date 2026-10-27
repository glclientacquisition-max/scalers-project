-- Desk access requests (closed self sign-up, invite-only onboarding).
-- Run manually in Supabase SQL editor on staging before enabling SIGNUP_MODE=request.
-- ASCII-only.

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  business text not null,
  phone text not null,
  email text not null,
  about text not null,
  status text not null default 'pending',
  decided_at timestamptz,
  decided_by text,
  invited_user_id uuid references auth.users (id) on delete set null
);

do $do$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'access_requests_status_check'
  ) then
    alter table public.access_requests
      add constraint access_requests_status_check
      check (status in ('pending', 'approved', 'declined'));
  end if;
end
$do$;

create unique index if not exists access_requests_email_pending_uidx
  on public.access_requests (lower(trim(email)))
  where status = 'pending';

create index if not exists access_requests_status_created_idx
  on public.access_requests (status, created_at desc);

comment on table public.access_requests is
  'Owner invite queue: public form inserts via service role only';

alter table public.access_requests enable row level security;

-- No anon or authenticated reads/writes. Service role bypasses RLS.
