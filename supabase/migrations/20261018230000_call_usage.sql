-- Per-call Gemini token usage for the voice brain (PROMPT_CACHE_PREFIX / cost).
-- One row per media session close (a resumed call can have two rows; sum by
-- call_sid). Written by the voice server with the service role, best effort
-- (src/conversation/geminiUsage.js). The voice server keeps working when this
-- table is missing: it logs one warning and keeps the [usage] log line.
--
-- input_tokens is Gemini promptTokenCount and already includes cached_tokens.
-- Billed input = uncached_input_tokens at the full rate + cached_tokens at the
-- cached rate. thinking_tokens are billed as output.
--
-- STAGING ONLY for now. Not applied to production. Production waits for the
-- owner's OK and a backup, like every other migration.

create table if not exists public.call_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  call_sid text not null,
  tenant_id uuid references public.tenants(id) on delete cascade,
  requests integer not null default 0 check (requests >= 0),
  requests_without_usage integer not null default 0 check (requests_without_usage >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  cached_tokens bigint not null default 0 check (cached_tokens >= 0),
  uncached_input_tokens bigint not null default 0 check (uncached_input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  thinking_tokens bigint not null default 0 check (thinking_tokens >= 0),
  tool_use_tokens bigint not null default 0 check (tool_use_tokens >= 0),
  cache_hit_ratio numeric(6, 4) not null default 0,
  models jsonb not null default '{}'::jsonb,
  kinds jsonb not null default '{}'::jsonb
);

comment on table public.call_usage is
  'Gemini tokens per voice media session. Join calls on calls.sautikit_call_sid = call_usage.call_sid. Service role only.';

create index if not exists call_usage_call_sid_idx on public.call_usage (call_sid);
create index if not exists call_usage_tenant_created_idx on public.call_usage (tenant_id, created_at desc);

-- Service role only. No anon or signed-in access; Desk reads it server side if ever needed.
alter table public.call_usage enable row level security;
revoke all on table public.call_usage from public, anon, authenticated;
grant select, insert on table public.call_usage to service_role;
