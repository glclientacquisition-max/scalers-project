-- Admin sign-in 2FA email fallback (Alvin, 24 Oct 2026). Builds on admin_step_up.sql.
-- 6-digit codes, stored hashed, 10-minute expiry, single use. Rate limit (1/60 s, 5/hour) is
-- counted from these rows. Idempotent. service_role only; RLS on with no policies.
-- Apply on STAGING first. Prod only on Alvin's GO. Down: admin_sign_in_2fa_down.sql

create table if not exists public.admin_sign_in_email_code (
  id uuid primary key default gen_random_uuid(),
  operator text not null,
  code_hash text not null,               -- sha256(key:operator:code); the code itself is only in the email
  sent_to text,                          -- address it went to (for the audit trail; no code)
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists admin_sign_in_email_code_operator_idx
  on public.admin_sign_in_email_code (operator, created_at desc);

alter table public.admin_sign_in_email_code enable row level security;
revoke all on public.admin_sign_in_email_code from public, anon, authenticated;
grant select, insert, update, delete on public.admin_sign_in_email_code to service_role;

-- Break-glass / operator reset also clears pending sign-in codes.
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
  update public.admin_sign_in_email_code set used_at = now()
   where operator = p_operator and used_at is null;

  insert into public.ops_audit_log (actor, action, tenant_id, detail)
  values (p_actor, 'admin.2fa.reset', null,
          jsonb_build_object('target', p_operator, 'reason', trim(p_reason)));
end;
$$;

revoke all on function public.admin_step_up_reset(text, text, text) from public, anon, authenticated;
grant execute on function public.admin_step_up_reset(text, text, text) to service_role;
