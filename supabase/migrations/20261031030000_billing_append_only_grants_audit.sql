-- tenant_minute_grants and ops_audit_log become append-only.
-- A correction is a new row (a grant with its own note, an audit row naming the row it corrects).
-- No app or DB code path updates or deletes either table (checked 31 Oct 2026).
-- The one allowed exception is removing a business: tenants_billing_purge_flag sets
-- scalers.billing_purge = '1' before the tenant row is deleted, so the FK actions still work:
--   tenant_minute_grants  ON DELETE CASCADE  -> the grant rows go with the tenant
--   ops_audit_log         ON DELETE SET NULL -> only tenant_id becomes null, nothing else may change
-- Same pattern as billing_audit_log_freeze / subscription_events.

create or replace function public.billing_append_only_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if tg_op = 'TRUNCATE' then
    raise exception '% is append-only', tg_table_name;
  end if;
  if current_setting('scalers.billing_purge', true) = '1' then
    if tg_table_name = 'tenant_minute_grants' and tg_op = 'DELETE' then
      return old;
    end if;
    if tg_table_name = 'ops_audit_log' and tg_op = 'UPDATE'
       and old.tenant_id is not null and new.tenant_id is null
       and (to_jsonb(new) - 'tenant_id') = (to_jsonb(old) - 'tenant_id') then
      return new;
    end if;
  end if;
  raise exception '% is append-only: add a correcting row instead', tg_table_name;
end;
$function$;

revoke all on function public.billing_append_only_guard() from public, anon, authenticated;

drop trigger if exists tenant_minute_grants_append_only on public.tenant_minute_grants;
create trigger tenant_minute_grants_append_only
  before update or delete on public.tenant_minute_grants
  for each row execute function public.billing_append_only_guard();
drop trigger if exists tenant_minute_grants_no_truncate on public.tenant_minute_grants;
create trigger tenant_minute_grants_no_truncate
  before truncate on public.tenant_minute_grants
  for each statement execute function public.billing_append_only_guard();

drop trigger if exists ops_audit_log_append_only on public.ops_audit_log;
create trigger ops_audit_log_append_only
  before update or delete on public.ops_audit_log
  for each row execute function public.billing_append_only_guard();
drop trigger if exists ops_audit_log_no_truncate on public.ops_audit_log;
create trigger ops_audit_log_no_truncate
  before truncate on public.ops_audit_log
  for each statement execute function public.billing_append_only_guard();

-- ops_audit_log: RLS is on with no policies, but anon and authenticated still held every
-- privilege, and TRUNCATE ignores RLS. Only the service role (server code) writes or reads it.
revoke all on table public.ops_audit_log from anon, authenticated;
revoke update, delete, truncate on table public.ops_audit_log from service_role;
revoke update, delete, truncate on table public.tenant_minute_grants from service_role;
