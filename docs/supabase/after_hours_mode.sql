-- After-hours receptionist mode (per business).
-- Run after hours_schedule.sql.
--
-- Values:
--   serve   = still answer FAQs / capture lead after hours; set expectations (default)
--   message = keep it short: note the request for callback when open
-- ASCII-only (safe for Supabase SQL Editor).

alter table public.tenants
  add column if not exists after_hours_mode text not null default 'serve';

update public.tenants
set after_hours_mode = 'serve'
where after_hours_mode is null
   or trim(after_hours_mode) = ''
   or after_hours_mode not in ('serve', 'message');

alter table public.tenants
  drop constraint if exists tenants_after_hours_mode_check;

alter table public.tenants
  add constraint tenants_after_hours_mode_check
  check (after_hours_mode in ('serve', 'message'));

comment on column public.tenants.after_hours_mode is
  'When closed: serve = help fully with expectations; message = take a callback note';
