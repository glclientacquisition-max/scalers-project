-- Onboarding rebuild: single setup-complete flag, server-side wizard draft, rate limits.
-- ADDITIVE ONLY. Applied to staging (sgcdncjxauhsbunobmob) on 11 Oct 2026.
-- Production: apply BEFORE deploying the onboarding-polish code (the app falls back to the
-- old heuristic if these columns are missing, so order is safe either way).

-- 1. Source of truth for "setup finished" + server draft with optimistic version.
alter table public.tenants add column if not exists setup_completed_at timestamptz;
alter table public.tenants add column if not exists onboarding_draft jsonb not null default '{}'::jsonb;
alter table public.tenants add column if not exists onboarding_step smallint not null default 0;
alter table public.tenants add column if not exists onboarding_draft_version integer not null default 0;

-- Backfill: every workspace that already has a profile or a real prompt is set up.
-- Mirrors tenantNeedsOnboarding() in dashboard/src/lib/onboarding.ts.
update public.tenants
   set setup_completed_at = coalesce(created_at, now())
 where setup_completed_at is null
   and (
     (coalesce(btrim(services_offered), '') <> ''
       and coalesce(btrim(business_hours), '') <> ''
       and coalesce(btrim(agent_tone), '') <> '')
     or (coalesce(btrim(llm_system_prompt), '') <> ''
       and llm_system_prompt not ilike '%describe what you offer%'
       and llm_system_prompt not ilike '%update this in sauti desk%'
       and llm_system_prompt not ilike '%update this in scalers%')
   );

-- Funnel / ops: workspaces still in setup, newest first.
create index if not exists tenants_setup_pending_idx
  on public.tenants (created_at desc) where setup_completed_at is null;

-- Desk shell resolves the signed-in user's workspaces ordered by created_at.
create index if not exists tenant_members_user_created_idx
  on public.tenant_members (user_id, created_at);

-- 2. One-round-trip, concurrency-safe step save. SECURITY INVOKER: tenants RLS applies.
-- Returns the new version, or NULL when another tab saved first / setup is already done.
create or replace function public.save_onboarding_step(
  p_tenant_id uuid,
  p_key text,
  p_value jsonb,
  p_next_step smallint,
  p_expected_version integer
) returns integer
language sql
security invoker
set search_path = public
as $$
  update public.tenants
     set onboarding_draft = jsonb_set(coalesce(onboarding_draft, '{}'::jsonb), array[p_key], coalesce(p_value, 'null'::jsonb), true),
         onboarding_step = greatest(onboarding_step, least(greatest(p_next_step, 0), 6)::smallint),
         onboarding_draft_version = onboarding_draft_version + 1
   where id = p_tenant_id
     and setup_completed_at is null
     and onboarding_draft_version = p_expected_version
     and p_key in ('business', 'catalogue', 'hours', 'voice', 'faqs', 'alerts')
     and pg_column_size(p_value) < 262144
  returning onboarding_draft_version;
$$;
revoke all on function public.save_onboarding_step(uuid, text, jsonb, smallint, integer) from public, anon;
grant execute on function public.save_onboarding_step(uuid, text, jsonb, smallint, integer) to authenticated, service_role;

-- 3. Fixed-window rate limits (signup, resend confirmation, number retry). Service role only.
create table if not exists public.rate_limit_hits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon, authenticated;

-- True when the call is allowed. Atomic under concurrency (upsert increments).
create or replace function public.hit_rate_limit(p_bucket text, p_window_seconds integer, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits integer;
  v_bucket text := left(p_bucket, 200);
begin
  delete from public.rate_limit_hits where bucket = v_bucket and window_start < v_window;
  insert into public.rate_limit_hits as r (bucket, window_start, hits)
       values (v_bucket, v_window, 1)
  on conflict (bucket, window_start) do update set hits = r.hits + 1
  returning hits into v_hits;
  return v_hits <= p_max;
end;
$$;
revoke all on function public.hit_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, integer, integer) to service_role;
