-- Down for admin_sign_in_2fa.sql. Restores the admin_step_up.sql reset function body.
drop table if exists public.admin_sign_in_email_code;

create or replace function public.admin_step_up_reset(p_operator text, p_actor text, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(trim(p_operator), '') = '' then raise exception 'operator required'; end if;
  if coalesce(trim(p_actor), '') = '' then raise exception 'actor required'; end if;
  if length(coalesce(trim(p_reason), '')) < 3 then raise exception 'reason required (3+ chars)'; end if;

  update public.admin_step_up_factor
     set secret_enc = null, pending_secret_enc = null, enrolled_at = null,
         needs_reenrol = true, failed_count = 0, locked_until = null, last_step = null, updated_at = now()
   where operator = p_operator;
  delete from public.admin_step_up_backup_code where operator = p_operator;
  update public.admin_step_up_grant set revoked_at = now()
   where operator = p_operator and revoked_at is null and expires_at > now();

  insert into public.ops_audit_log (actor, action, tenant_id, detail)
  values (p_actor, 'admin.2fa.reset', null,
          jsonb_build_object('target', p_operator, 'reason', trim(p_reason)));
end;
$$;

revoke all on function public.admin_step_up_reset(text, text, text) from public, anon, authenticated;
grant execute on function public.admin_step_up_reset(text, text, text) to service_role;
