-- 2026-10-31: block assigning a retired (or draft) package version to a subscription.
-- Applied on prod (fjxcdccgyhnvnnlnovcl) 2026-10-31 00:55 EAT and staging 00:49 EAT, together with the
-- one-off v1 retire (status='retired', retired_at set on Trial/Starter/Growth/Scale v1; data, not schema).
-- Idempotent: create or replace + drop trigger if exists.
-- Down: drop trigger if exists tenant_subscriptions_d_block_retired_version on public.tenant_subscriptions;
--       drop function if exists public.tenant_subscriptions_d_block_retired_version();
create or replace function public.tenant_subscriptions_d_block_retired_version()
returns trigger language plpgsql as $fn$
declare v_status text;
begin
  if new.package_version_id is not null
     and (tg_op = 'INSERT' or new.package_version_id is distinct from old.package_version_id) then
    select status into v_status from public.billing_package_versions where id = new.package_version_id;
    if v_status is distinct from 'published' then
      raise exception 'cannot assign a % package version', coalesce(v_status, 'missing');
    end if;
  end if;
  return new;
end $fn$;
drop trigger if exists tenant_subscriptions_d_block_retired_version on public.tenant_subscriptions;
create trigger tenant_subscriptions_d_block_retired_version
  before insert or update on public.tenant_subscriptions
  for each row execute function public.tenant_subscriptions_d_block_retired_version();
