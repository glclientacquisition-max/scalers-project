-- Invite page: does the invited email already have a Scalers login?
-- Service role only (the invite page runs server-side). ADDITIVE ONLY.
create or replace function public.invite_email_has_account(p_email text)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.users where lower(email) = lower(trim(p_email)));
$$;
revoke all on function public.invite_email_has_account(text) from public, anon, authenticated;
grant execute on function public.invite_email_has_account(text) to service_role;
