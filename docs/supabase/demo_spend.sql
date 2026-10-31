-- Demo spend totals. One row per browser demo session.
-- Counts only: minutes, STT seconds, TTS seconds, model token estimates, USD.
-- No IP, no device, no transcript, no audio, no caller text.
-- Service role only. Deploy does not apply this file.
-- Apply by hand on staging after Alvin's GO. Do not apply on prod.
-- Idempotent. ASCII-only.

create table if not exists public.demo_spend (
  session_id text primary key,
  day text not null,
  month text not null,
  minutes numeric not null,
  stt_seconds numeric not null,
  tts_seconds numeric not null,
  model_input_tokens integer not null,
  model_output_tokens integer not null,
  cost_usd numeric not null,
  created_at timestamptz not null default now(),
  constraint demo_spend_sid_check check (
    session_id ~ '^demo_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ),
  constraint demo_spend_amounts_check check (
    minutes >= 0
    and stt_seconds >= 0
    and tts_seconds >= 0
    and model_input_tokens >= 0
    and model_output_tokens >= 0
    and cost_usd >= 0
  )
);

create index if not exists demo_spend_day_idx on public.demo_spend (day);
create index if not exists demo_spend_month_idx on public.demo_spend (month);

comment on table public.demo_spend is
  'Anonymous browser demo spend. One row per demo session. No IP, device, transcript, or audio.';

alter table public.demo_spend enable row level security;

revoke all on public.demo_spend from public;
revoke all on public.demo_spend from anon;
revoke all on public.demo_spend from authenticated;

grant all on public.demo_spend to service_role;
