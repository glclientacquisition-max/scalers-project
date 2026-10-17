-- notify_sends: record failed sends (status + error). Ship-only file:
-- NOT applied by this PR. Staging first with a go, prod only with Alvin's yes.
-- Code works before this is applied (falls back to a "[FAILED: ...]" body prefix).

alter table public.notify_sends add column if not exists status text not null default 'sent';
alter table public.notify_sends add column if not exists error text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notify_sends_status_check') then
    alter table public.notify_sends
      add constraint notify_sends_status_check check (status in ('sent', 'failed'));
  end if;
end $$;

create index if not exists notify_sends_failed_recent
  on public.notify_sends (tenant_id, created_at desc)
  where status = 'failed';

-- Usage/billing reads should count only status = 'sent' rows once applied.
-- Rollback:
--   drop index if exists public.notify_sends_failed_recent;
--   alter table public.notify_sends drop constraint if exists notify_sends_status_check;
--   alter table public.notify_sends drop column if exists error;
--   alter table public.notify_sends drop column if exists status;
