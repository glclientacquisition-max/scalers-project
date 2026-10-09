-- Phone wallet low-balance alert state (Voice).
-- Staff only. Service role only. ASCII-only (safe for Supabase SQL Editor).
-- Depends on: none (standalone staff tables).
--
-- voice_wallet_alert_state: one row per alert threshold (minor units).
--   crossed = true after we alerted for a downward crossing, until the balance
--   is seen above the threshold again (re-arm). Survives restarts, and the
--   webhook and the 15 min poll share it, so one crossing alerts once.
-- voice_webhook_events: event_id dedupe for at-least-once vendor webhooks.
--
-- Not applied by deploy. Apply by hand on staging first, then prod with a GO.
-- Voice falls back to in-process state (with a warning) when these are missing.

create table if not exists public.voice_wallet_alert_state (
  threshold_minor bigint primary key check (threshold_minor > 0),
  crossed boolean not null default false,
  crossed_at timestamptz,
  rearmed_at timestamptz,
  last_balance_minor bigint,
  last_source text,
  observed_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.voice_wallet_alert_state is
  'Phone wallet low alert latch per threshold. Restart-safe; shared by webhook and poll.';

create table if not exists public.voice_webhook_events (
  event_id text primary key,
  kind text not null,
  received_at timestamptz not null default now()
);

comment on table public.voice_webhook_events is
  'Vendor webhook event_id dedupe (at-least-once delivery). Safe to prune after 30 days.';

create index if not exists voice_webhook_events_received_at_idx
  on public.voice_webhook_events (received_at);

alter table public.voice_wallet_alert_state enable row level security;
alter table public.voice_webhook_events enable row level security;
revoke all on table public.voice_wallet_alert_state from anon, authenticated;
revoke all on table public.voice_webhook_events from anon, authenticated;
grant select, insert, update, delete on table public.voice_wallet_alert_state to service_role;
grant select, insert, update, delete on table public.voice_webhook_events to service_role;

-- Observe one balance reading. Atomic per threshold row:
--   * re-arm rows where balance > threshold and crossed
--   * claim rows where balance <= threshold and not crossed
-- A reading older than the row's last observation is ignored (late webhook
-- after a newer poll), so an old low balance cannot re-alert after a top-up.
-- Returns the thresholds newly claimed (alert) and newly re-armed.
create or replace function public.voice_wallet_alert_observe(
  p_thresholds bigint[],
  p_balance_minor bigint,
  p_source text,
  p_observed_at timestamptz default now()
)
returns table (threshold_minor bigint, action text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if p_balance_minor is null or p_thresholds is null then
    return;
  end if;

  insert into public.voice_wallet_alert_state (threshold_minor)
  select distinct t from unnest(p_thresholds) as t where t > 0
  on conflict (threshold_minor) do nothing;

  return query
  update public.voice_wallet_alert_state s
     set crossed = false,
         rearmed_at = now(),
         last_balance_minor = p_balance_minor,
         last_source = p_source,
         observed_at = p_observed_at,
         updated_at = now()
   where s.threshold_minor = any (p_thresholds)
     and s.crossed
     and p_balance_minor > s.threshold_minor
     and (s.observed_at is null or s.observed_at <= p_observed_at)
  returning s.threshold_minor, 'rearmed'::text;

  return query
  update public.voice_wallet_alert_state s
     set crossed = true,
         crossed_at = now(),
         last_balance_minor = p_balance_minor,
         last_source = p_source,
         observed_at = p_observed_at,
         updated_at = now()
   where s.threshold_minor = any (p_thresholds)
     and not s.crossed
     and p_balance_minor <= s.threshold_minor
     and (s.observed_at is null or s.observed_at <= p_observed_at)
  returning s.threshold_minor, 'crossed'::text;

  update public.voice_wallet_alert_state s
     set last_balance_minor = p_balance_minor,
         last_source = p_source,
         observed_at = p_observed_at,
         updated_at = now()
   where s.threshold_minor = any (p_thresholds)
     and (s.observed_at is null or s.observed_at < p_observed_at);
end;
$$;

-- Undo a claim when the alert could not be sent, so the next reading retries.
create or replace function public.voice_wallet_alert_release(p_thresholds bigint[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.voice_wallet_alert_state
     set crossed = false, crossed_at = null, updated_at = now()
   where threshold_minor = any (p_thresholds) and crossed;
$$;

-- Claim a webhook event_id. True the first time, false on a redelivery.
create or replace function public.voice_webhook_event_claim(p_event_id text, p_kind text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  insert into public.voice_webhook_events (event_id, kind)
  values (p_event_id, coalesce(p_kind, 'unknown'))
  on conflict (event_id) do nothing;
  get diagnostics inserted = row_count;
  return inserted > 0;
end;
$$;

revoke all on function public.voice_wallet_alert_observe(bigint[], bigint, text, timestamptz) from public, anon, authenticated;
revoke all on function public.voice_wallet_alert_release(bigint[]) from public, anon, authenticated;
revoke all on function public.voice_webhook_event_claim(text, text) from public, anon, authenticated;
grant execute on function public.voice_wallet_alert_observe(bigint[], bigint, text, timestamptz) to service_role;
grant execute on function public.voice_wallet_alert_release(bigint[]) to service_role;
grant execute on function public.voice_webhook_event_claim(text, text) to service_role;
