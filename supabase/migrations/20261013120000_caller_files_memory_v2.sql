-- Caller files memory v2: caller_files, open_tasks view, staff names, retention.
-- Additive. Staging first. Behind CALLER_MEMORY_V2 (app flag, default off).
-- ASCII-only.

begin;

-- ---------------------------------------------------------------------------
-- 1) Columns on service_requests / appointments
-- ---------------------------------------------------------------------------
alter table public.service_requests
  add column if not exists next_step text,
  add column if not exists owner_action_by timestamptz,
  add column if not exists closed_at timestamptz;

alter table public.appointments
  add column if not exists next_step text,
  add column if not exists owner_action_by timestamptz,
  add column if not exists closed_at timestamptz;

-- Allow request_type 'question' (callback already present).
do $do$
begin
  if exists (
    select 1 from pg_constraint where conname = 'service_requests_type_check'
  ) then
    alter table public.service_requests drop constraint service_requests_type_check;
  end if;
  alter table public.service_requests
    add constraint service_requests_type_check
    check (request_type in ('hold', 'enquiry', 'order', 'callback', 'question', 'other'));
end
$do$;

-- Desk may edit the new columns.
grant update (
  status, notes, updated_at, next_step, owner_action_by, closed_at
) on public.service_requests to authenticated;

grant update (
  status, notes, when_text, window_start, window_end, address_landmark, updated_at,
  next_step, owner_action_by, closed_at
) on public.appointments to authenticated;

-- ---------------------------------------------------------------------------
-- 2) open_tasks view (security_invoker; closed drop out after 30 days)
-- ---------------------------------------------------------------------------
create or replace view public.open_tasks
with (security_invoker = true)
as
  select
    sr.id as task_id,
    sr.tenant_id,
    sr.contact_id,
    sr.request_type as type,
    sr.status,
    sr.next_step,
    sr.call_id as created_call_id,
    sr.updated_at,
    sr.closed_at,
    sr.owner_action_by,
    sr.item as summary_item,
    sr.when_text
  from public.service_requests sr
  where sr.closed_at is null
     or sr.closed_at >= (now() - interval '30 days')
  union all
  select
    a.id as task_id,
    a.tenant_id,
    a.contact_id,
    'visit'::text as type,
    a.status,
    a.next_step,
    a.call_id as created_call_id,
    a.updated_at,
    a.closed_at,
    a.owner_action_by,
    a.service_name as summary_item,
    a.when_text
  from public.appointments a
  where a.closed_at is null
     or a.closed_at >= (now() - interval '30 days');

revoke all on public.open_tasks from public, anon;
grant select on public.open_tasks to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) caller_files
-- ---------------------------------------------------------------------------
create table if not exists public.caller_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  names_seen jsonb not null default '[]'::jsonb,
  primary_name text,
  shared_line boolean not null default false,
  preferred_lang text check (preferred_lang is null or preferred_lang in ('en', 'sw', 'sheng')),
  last_topic text check (last_topic is null or char_length(last_topic) <= 60),
  last_outcome text,
  last_call_id uuid references public.calls(id) on delete set null,
  last_topic_at timestamptz,
  forget_requested_at timestamptz,
  memory_notice_shown_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, contact_id)
);

create index if not exists caller_files_tenant_updated_idx
  on public.caller_files (tenant_id, updated_at desc);

create index if not exists caller_files_topic_expiry_idx
  on public.caller_files (last_topic_at)
  where last_topic is not null;

comment on table public.caller_files is
  'Structured caller memory per tenant+contact (phone stays on contacts)';

alter table public.caller_files enable row level security;

revoke all on public.caller_files from public, anon;
grant select, update, delete on public.caller_files to authenticated;
grant all on public.caller_files to service_role;

drop policy if exists caller_files_select_member on public.caller_files;
create policy caller_files_select_member
  on public.caller_files
  for select
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists caller_files_update_member on public.caller_files;
create policy caller_files_update_member
  on public.caller_files
  for update
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists caller_files_delete_member on public.caller_files;
create policy caller_files_delete_member
  on public.caller_files
  for delete
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

-- No INSERT policy for authenticated: only service_role creates rows.
drop policy if exists caller_files_write_not_viewer_u on public.caller_files;
create policy caller_files_write_not_viewer_u
  on public.caller_files
  as restrictive
  for update
  to authenticated
  using (public.member_can_write(tenant_id))
  with check (public.member_can_write(tenant_id));

drop policy if exists caller_files_write_not_viewer_d on public.caller_files;
create policy caller_files_write_not_viewer_d
  on public.caller_files
  as restrictive
  for delete
  to authenticated
  using (public.member_can_write(tenant_id));

-- ---------------------------------------------------------------------------
-- 4) Staff-name list per tenant (redaction / public opt-in)
-- ---------------------------------------------------------------------------
create table if not exists public.tenant_staff_names (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_staff_names_name_len check (char_length(btrim(name)) between 1 and 80)
);

create unique index if not exists tenant_staff_names_tenant_lower_uidx
  on public.tenant_staff_names (tenant_id, lower(btrim(name)));

create index if not exists tenant_staff_names_tenant_idx
  on public.tenant_staff_names (tenant_id);

comment on table public.tenant_staff_names is
  'Staff/owner names for speech redaction; is_public opts a name into spoken use';

alter table public.tenant_staff_names enable row level security;

revoke all on public.tenant_staff_names from public, anon;
grant select, insert, update, delete on public.tenant_staff_names to authenticated;
grant all on public.tenant_staff_names to service_role;

drop policy if exists tenant_staff_names_select_member on public.tenant_staff_names;
create policy tenant_staff_names_select_member
  on public.tenant_staff_names
  for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists tenant_staff_names_insert_member on public.tenant_staff_names;
create policy tenant_staff_names_insert_member
  on public.tenant_staff_names
  for insert to authenticated
  with check (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists tenant_staff_names_update_member on public.tenant_staff_names;
create policy tenant_staff_names_update_member
  on public.tenant_staff_names
  for update to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists tenant_staff_names_delete_member on public.tenant_staff_names;
create policy tenant_staff_names_delete_member
  on public.tenant_staff_names
  for delete to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists tenant_staff_names_write_not_viewer_i on public.tenant_staff_names;
create policy tenant_staff_names_write_not_viewer_i
  on public.tenant_staff_names
  as restrictive for insert to authenticated
  with check (public.member_can_write(tenant_id));

drop policy if exists tenant_staff_names_write_not_viewer_u on public.tenant_staff_names;
create policy tenant_staff_names_write_not_viewer_u
  on public.tenant_staff_names
  as restrictive for update to authenticated
  using (public.member_can_write(tenant_id))
  with check (public.member_can_write(tenant_id));

drop policy if exists tenant_staff_names_write_not_viewer_d on public.tenant_staff_names;
create policy tenant_staff_names_write_not_viewer_d
  on public.tenant_staff_names
  as restrictive for delete to authenticated
  using (public.member_can_write(tenant_id));

-- ---------------------------------------------------------------------------
-- 5) Retention audit (no PII) + expire function + pg_cron
-- ---------------------------------------------------------------------------
create table if not exists public.memory_retention_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  topics_cleared integer not null default 0,
  forgets_done integer not null default 0
);

create index if not exists memory_retention_runs_tenant_ran_idx
  on public.memory_retention_runs (tenant_id, ran_at desc);

comment on table public.memory_retention_runs is
  'Per-tenant retention job counters; stores no caller PII';

alter table public.memory_retention_runs enable row level security;

revoke all on public.memory_retention_runs from public, anon, authenticated;
grant all on public.memory_retention_runs to service_role;

drop policy if exists memory_retention_runs_select_admin on public.memory_retention_runs;
create policy memory_retention_runs_select_admin
  on public.memory_retention_runs
  for select to authenticated
  using (public.member_can_admin(tenant_id));

grant select on public.memory_retention_runs to authenticated;

create or replace function public.expire_caller_memory()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer := 0;
begin
  -- Clear last_topic after 60 days (idempotent).
  with cleared as (
    update public.caller_files
    set last_topic = null,
        last_topic_at = null,
        updated_at = now()
    where last_topic is not null
      and last_topic_at is not null
      and last_topic_at < (now() - interval '60 days')
    returning tenant_id
  ),
  topic_counts as (
    select tenant_id, count(*)::int as n from cleared group by tenant_id
  ),
  forgotten as (
    delete from public.caller_files
    where forget_requested_at is not null
    returning tenant_id
  ),
  forget_counts as (
    select tenant_id, count(*)::int as n from forgotten group by tenant_id
  ),
  tenants as (
    select tenant_id from topic_counts
    union
    select tenant_id from forget_counts
  ),
  upserted as (
    insert into public.memory_retention_runs (tenant_id, topics_cleared, forgets_done)
    select
      t.tenant_id,
      coalesce(tc.n, 0),
      coalesce(fc.n, 0)
    from tenants t
    left join topic_counts tc on tc.tenant_id = t.tenant_id
    left join forget_counts fc on fc.tenant_id = t.tenant_id
    returning 1
  )
  select count(*)::int into v_total from upserted;

  return coalesce(v_total, 0);
end;
$$;

revoke all on function public.expire_caller_memory() from public, anon, authenticated;
grant execute on function public.expire_caller_memory() to service_role;

-- Daily at 03:30 EAT (00:30 UTC) when pg_cron is available.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'expire_caller_memory';
    perform cron.schedule(
      'expire_caller_memory',
      '30 0 * * *',
      'select public.expire_caller_memory()'
    );
  end if;
end $$;

commit;
