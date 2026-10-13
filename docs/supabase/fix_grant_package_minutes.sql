-- Hotfix: Admin "Grant minutes" always failed (prod and staging).
-- Run AFTER package_catalog.sql and admin_billing_ops.sql. ASCII-only. Safe to re-run.
--
-- Bug: grant_tenant_package_minutes RETURNS TABLE (tenant_id, minutes_included,
-- minutes_granted). Those OUT params are PL/pgSQL variables, so the unqualified
--   update public.tenants set minutes_included = coalesce(minutes_included, 0) + ...
-- raised 42702 'column reference "minutes_included" is ambiguous' on every call.
-- PostgREST returned that as a plain error object and the Admin Sheet showed
-- "[object Object]". No grant has ever succeeded (ops_audit_log has 0 rows).
--
-- Fix:
--   * #variable_conflict use_column + table aliases on every statement.
--   * tenant_minute_grants: one row per grant, scoped to the billing period it
--     was made in (tenant_subscriptions.current_period_start/end; calendar month
--     in Africa/Nairobi when the tenant has no subscription row).
--   * Idempotent: unique (tenant_id, idempotency_key). A replay returns the
--     current total with minutes_granted = 0 and changes nothing. Tenant row is
--     locked first so concurrent grants serialize.
--   * Audited: ops_audit_log row with grant id, period and actor, written in the
--     same transaction as the grant.
--   * Same signature and return shape, so the dashboard RPC call is unchanged.
--
-- Effective allowance stays in tenants.minutes_included (what consume_call_seconds
-- and the Voice package gate read), so a grant takes effect on the next call.

create table if not exists public.tenant_minute_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  minutes integer not null,
  period_start timestamptz not null,
  period_end timestamptz,
  note text not null,
  actor text not null default 'ops',
  idempotency_key text,
  created_at timestamptz not null default now(),
  constraint tenant_minute_grants_minutes_check check (minutes between 1 and 100000),
  constraint tenant_minute_grants_tenant_key_uniq unique (tenant_id, idempotency_key)
);

create index if not exists tenant_minute_grants_tenant_period_idx
  on public.tenant_minute_grants (tenant_id, period_start);

comment on table public.tenant_minute_grants is
  'Admin-granted package minutes. Each row belongs to one billing period (period_start/period_end).';

alter table public.tenant_minute_grants enable row level security;
revoke all on table public.tenant_minute_grants from public, anon, authenticated;
grant all on table public.tenant_minute_grants to service_role;

create or replace function public.grant_tenant_package_minutes(
  p_tenant_id uuid,
  p_minutes integer,
  p_note text,
  p_actor text default 'ops',
  p_idempotency_key text default null
)
returns table (
  tenant_id uuid,
  minutes_included integer,
  minutes_granted integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_actor text := coalesce(nullif(trim(p_actor), ''), 'ops');
  v_note text := trim(coalesce(p_note, ''));
  v_minutes integer := coalesce(p_minutes, 0);
  v_key text := nullif(trim(p_idempotency_key), '');
  v_after integer;
  v_start timestamptz;
  v_end timestamptz;
  v_grant_id uuid;
begin
  if p_tenant_id is null then
    raise exception 'tenant required';
  end if;
  if v_minutes <= 0 or v_minutes > 100000 then
    raise exception 'minutes must be between 1 and 100000';
  end if;
  if length(v_note) < 3 then
    raise exception 'note required (min 3 chars)';
  end if;

  -- Lock the tenant so concurrent grants (double click, retry) serialize.
  select t.minutes_included into v_after
  from public.tenants t
  where t.id = p_tenant_id
  for update;
  if not found then
    raise exception 'tenant not found';
  end if;

  select s.current_period_start, s.current_period_end
    into v_start, v_end
  from public.tenant_subscriptions s
  where s.tenant_id = p_tenant_id;
  if v_start is null then
    v_start := date_trunc('month', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi';
    v_end := (date_trunc('month', now() at time zone 'Africa/Nairobi') + interval '1 month') at time zone 'Africa/Nairobi';
  end if;

  insert into public.tenant_minute_grants as g
    (tenant_id, minutes, period_start, period_end, note, actor, idempotency_key)
  values (p_tenant_id, v_minutes, v_start, v_end, v_note, v_actor, v_key)
  on conflict on constraint tenant_minute_grants_tenant_key_uniq do nothing
  returning g.id into v_grant_id;

  if v_grant_id is null then
    -- Replay of an idempotency key already used for this tenant.
    tenant_id := p_tenant_id;
    minutes_included := coalesce(v_after, 0);
    minutes_granted := 0;
    return next;
    return;
  end if;

  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants as t
    set minutes_included = coalesce(t.minutes_included, 0) + v_minutes
  where t.id = p_tenant_id
  returning t.minutes_included into v_after;
  perform set_config('scalers.wallet_write', '', true);

  insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
  values (
    v_actor,
    'grant_package_minutes',
    p_tenant_id,
    null,
    jsonb_build_object(
      'grant_id', v_grant_id,
      'note', v_note,
      'minutes_granted', v_minutes,
      'minutes_included_after', v_after,
      'period_start', v_start,
      'period_end', v_end,
      'idempotency_key', v_key
    )
  );

  tenant_id := p_tenant_id;
  minutes_included := v_after;
  minutes_granted := v_minutes;
  return next;
end;
$$;

revoke all on function public.grant_tenant_package_minutes(uuid, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.grant_tenant_package_minutes(uuid, integer, text, text, text) to service_role;
