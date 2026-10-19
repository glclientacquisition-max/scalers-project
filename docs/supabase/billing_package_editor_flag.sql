-- Package editor on/off (P18).
-- Apply once, as one transaction, after invoice_pay_live_allowlist.sql (P17).
-- Does not call _package_editor_open, so this switch can turn the editor back on.
-- Does not replace finalize_invoice. Does not edit P1-P17.
-- Idempotent. Re-running replaces the function and does not change the stored flag.
-- Production (fjxcdccgyhnvnnlnovcl) does not have this file. Do not apply it there.
-- Staging (sgcdncjxauhsbunobmob) is the only apply.

create or replace function public.admin_set_package_editor_enabled(
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
  v_before boolean;
begin
  perform public._package_editor_actor(p_actor, p_reason);
  if p_confirm is distinct from true then
    raise exception 'confirm the package editor setting';
  end if;
  if p_enabled is null then
    raise exception 'package editor must be on or off';
  end if;

  select package_editor_enabled into v_before
  from public.billing_lifecycle_settings
  where id = 1;
  if not found then
    raise exception 'billing settings are missing';
  end if;

  update public.billing_lifecycle_settings
  set package_editor_enabled = p_enabled,
      updated_at = now()
  where id = 1;

  perform public._billing_audit(
    btrim(p_actor),
    'set_package_editor_enabled',
    null,
    jsonb_build_object(
      'reason', btrim(p_reason),
      'confirm', true,
      'before', v_before,
      'after', p_enabled,
      'changed_at', now()
    )
  );

  return jsonb_build_object('package_editor_enabled', p_enabled);
end;
$$;

comment on function public.admin_set_package_editor_enabled(boolean, text, text, boolean) is
  'Service role only. Requires a reason and confirm. Does not check whether the editor is already open. Writes billing_audit_log set_package_editor_enabled.';

revoke all on function public.admin_set_package_editor_enabled(boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_set_package_editor_enabled(boolean, text, text, boolean) to service_role;
