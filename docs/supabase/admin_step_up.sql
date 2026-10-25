-- Admin step-up (Unlock enforce). Alvin approved design 24 Oct 2026.
-- Authenticator (TOTP) per operator, 10 hashed backup codes, 10-minute unlock grants,
-- operator / break-glass reset. Idempotent. service_role only; RLS on with no policies.
-- Apply on STAGING first. Prod only on Alvin's GO. Down: admin_step_up_down.sql

create table if not exists public.admin_step_up_factor (
  operator text primary key,
  secret_enc text,                       -- AES-256-GCM blob, key = ADMIN_STEP_UP_KEY (never plaintext)
  pending_secret_enc text,               -- set during setup until the first valid code
  enrolled_at timestamptz,
  needs_reenrol boolean not null default false,
  failed_count integer not null default 0 check (failed_count >= 0),
  locked_until timestamptz,
  last_step bigint,                      -- last accepted TOTP step (replay guard)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_step_up_backup_code (
  id uuid primary key default gen_random_uuid(),
  operator text not null,
  code_hash text not null,               -- sha256(key:code); plaintext shown once at setup
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists admin_step_up_backup_code_operator_idx
  on public.admin_step_up_backup_code (operator);

create table if not exists public.admin_step_up_grant (
  id uuid primary key default gen_random_uuid(),
  operator text not null,
  method text not null check (method in ('totp', 'backup_code')),
  action text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists admin_step_up_grant_operator_idx
  on public.admin_step_up_grant (operator, expires_at desc);

alter table public.admin_step_up_factor enable row level security;
alter table public.admin_step_up_backup_code enable row level security;
alter table public.admin_step_up_grant enable row level security;

revoke all on public.admin_step_up_factor, public.admin_step_up_backup_code, public.admin_step_up_grant
  from public, anon, authenticated;
grant select, insert, update, delete on public.admin_step_up_factor, public.admin_step_up_backup_code, public.admin_step_up_grant
  to service_role;

-- Reset one operator's authenticator: clears secret + backup codes, revokes live unlocks,
-- writes ops_audit_log admin.2fa.reset. Used by the operator-reset route and, from the
-- SQL editor, as the last-resort break-glass reset (runbook: ADMIN_STEP_UP.md §5).
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
