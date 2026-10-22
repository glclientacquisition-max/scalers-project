-- Payment runtime switches (P20).
-- Apply once, as one transaction, after billing_package_editor_flag.sql (P18).
-- Stores Bachs mode, live master, billing notices, and desk plan change in billing_lifecycle_settings.
-- Service role only. Idempotent column adds and function replace.

alter table public.billing_lifecycle_settings
  add column if not exists bachs_payments_mode text not null default 'off';

alter table public.billing_lifecycle_settings
  drop constraint if exists billing_lifecycle_settings_bachs_mode_check;
alter table public.billing_lifecycle_settings
  add constraint billing_lifecycle_settings_bachs_mode_check check (
    bachs_payments_mode in ('off', 'sandbox', 'live')
  );

alter table public.billing_lifecycle_settings
  add column if not exists live_payments_master boolean not null default false;

alter table public.billing_lifecycle_settings
  add column if not exists billing_notices_send boolean not null default false;

alter table public.billing_lifecycle_settings
  add column if not exists desk_plan_change_enabled boolean not null default false;

comment on column public.billing_lifecycle_settings.bachs_payments_mode is
  'Super Admin: off, sandbox, or live Bachs checkout. Keys still come from hosting env.';
comment on column public.billing_lifecycle_settings.live_payments_master is
  'Super Admin: when true and mode is live, live checkout may run for allowlisted businesses.';
comment on column public.billing_lifecycle_settings.billing_notices_send is
  'Super Admin: when true, billing notice sends may run.';
comment on column public.billing_lifecycle_settings.desk_plan_change_enabled is
  'Super Admin: when true, owner desk plan change RPCs are allowed (same as legacy DESK_PLAN_CHANGE=on).';

create or replace function public.admin_set_billing_runtime_switch(
  p_switch text,
  p_mode text,
  p_enabled boolean,
  p_actor text,
  p_reason text,
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_key text;
begin
  perform public._package_editor_actor(p_actor, p_reason);
  if p_confirm is distinct from true then
    raise exception 'confirm the change';
  end if;

  v_key := lower(btrim(coalesce(p_switch, '')));
  if v_key not in ('bachs_mode', 'live_master', 'billing_notices', 'desk_plan_change') then
    raise exception 'unknown switch';
  end if;

  select jsonb_build_object(
    'bachs_payments_mode', bachs_payments_mode,
    'live_payments_master', live_payments_master,
    'billing_notices_send', billing_notices_send,
    'desk_plan_change_enabled', desk_plan_change_enabled
  )
  into v_before
  from public.billing_lifecycle_settings
  where id = 1;
  if not found then
    raise exception 'billing settings are missing';
  end if;

  if v_key = 'bachs_mode' then
    if p_mode is null or lower(btrim(p_mode)) not in ('off', 'sandbox', 'live') then
      raise exception 'payments mode must be off, sandbox, or live';
    end if;
    update public.billing_lifecycle_settings
    set bachs_payments_mode = lower(btrim(p_mode)),
        updated_at = now()
    where id = 1;
  elsif v_key = 'live_master' then
    if p_enabled is null then
      raise exception 'live payments must be on or off';
    end if;
    update public.billing_lifecycle_settings
    set live_payments_master = p_enabled,
        updated_at = now()
    where id = 1;
  elsif v_key = 'billing_notices' then
    if p_enabled is null then
      raise exception 'billing notices must be on or off';
    end if;
    update public.billing_lifecycle_settings
    set billing_notices_send = p_enabled,
        updated_at = now()
    where id = 1;
  else
    if p_enabled is null then
      raise exception 'plan changes must be on or off';
    end if;
    update public.billing_lifecycle_settings
    set desk_plan_change_enabled = p_enabled,
        updated_at = now()
    where id = 1;
  end if;

  select jsonb_build_object(
    'bachs_payments_mode', bachs_payments_mode,
    'live_payments_master', live_payments_master,
    'billing_notices_send', billing_notices_send,
    'desk_plan_change_enabled', desk_plan_change_enabled
  )
  into v_after
  from public.billing_lifecycle_settings
  where id = 1;

  perform public._billing_audit(
    btrim(p_actor),
    'set_billing_runtime_switch',
    null,
    jsonb_build_object(
      'switch', v_key,
      'reason', btrim(p_reason),
      'confirm', true,
      'before', v_before,
      'after', v_after,
      'changed_at', now()
    )
  );

  return v_after;
end;
$$;

comment on function public.admin_set_billing_runtime_switch(text, text, boolean, text, text, boolean) is
  'Service role only. Super Admin payment runtime switches with reason and confirm. Writes billing_audit_log.';

revoke all on function public.admin_set_billing_runtime_switch(text, text, boolean, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_set_billing_runtime_switch(text, text, boolean, text, text, boolean)
  to service_role;
