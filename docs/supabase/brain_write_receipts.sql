-- Brain write receipts: one row per write attempt and phase (v1 and v2 paths).
-- Run after contacts_and_requests.sql (calls, tenants, current_user_tenant_ids)
-- and voice_turn_traces.sql (call_sid matches voice_turn_traces.call_id).
-- Service role writes. Shop owners read their own tenant's rows (Desk later).
-- Additive and idempotent. ASCII-only. Not applied by deploy.
-- Do not apply to production from the app. Production needs Alvin's GO.

create table if not exists public.brain_write_receipts (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references public.calls(id) on delete set null,
  call_sid text,
  tenant_id uuid references public.tenants(id) on delete cascade,
  turn_index integer,
  path text not null,
  created_at timestamptz not null default now(),
  tool text not null,
  phase text not null,
  confirm_token text,
  token_issued_turn integer,
  token_confirmed_turn integer,
  idempotency_key text not null,
  slots jsonb not null default '{}'::jsonb,
  validators jsonb default '{}'::jsonb,
  write_table text,
  write_id uuid,
  error_code text,
  error_detail text,
  outbox_task_id uuid,
  latency_ms integer,
  constraint brain_write_receipts_key_phase_unique unique (idempotency_key, phase),
  constraint brain_write_receipts_path_check check (path in ('v1', 'v2')),
  constraint brain_write_receipts_tool_check check (
    tool in ('book_appointment', 'create_order', 'request_callback', 'log_complaint', 'escalate', 'quote')
  ),
  constraint brain_write_receipts_phase_check check (
    phase in ('proposed', 'confirmed', 'committed', 'failed', 'rejected')
  ),
  constraint brain_write_receipts_write_id_committed check (write_id is null or phase = 'committed'),
  constraint brain_write_receipts_error_detail_len check (error_detail is null or char_length(error_detail) <= 500)
);

create index if not exists brain_write_receipts_call_idx
  on public.brain_write_receipts (call_id);

create index if not exists brain_write_receipts_call_sid_idx
  on public.brain_write_receipts (call_sid);

create index if not exists brain_write_receipts_tenant_created_idx
  on public.brain_write_receipts (tenant_id, created_at desc);

comment on table public.brain_write_receipts is
  'One row per Brain write attempt and phase (proposed, confirmed, committed, failed, rejected). Upsert key (idempotency_key, phase). Service role writes; owners read their tenant rows.';
comment on column public.brain_write_receipts.call_id is
  'calls.id (uuid) when the call row exists. call_sid carries the HD_ SID used by voice_turn_traces.';
comment on column public.brain_write_receipts.idempotency_key is
  'call + tool + hash of normalized slots. Same attempt, same key, across phases.';
comment on column public.brain_write_receipts.slots is
  'Normalized tool args. No raw transcript.';
comment on column public.brain_write_receipts.validators is
  'Validator verdicts, e.g. {"hours":"ok|closed","area":"ok|out","availability":"ok|full"}.';
comment on column public.brain_write_receipts.confirm_token is
  'Server-minted at propose on the v2 path. Null on v1.';
comment on column public.brain_write_receipts.write_id is
  'Id of the row written in write_table. Null unless phase = committed.';
comment on column public.brain_write_receipts.outbox_task_id is
  'Owner task created when the write failed.';

alter table public.brain_write_receipts enable row level security;

revoke all on public.brain_write_receipts from public;
revoke all on public.brain_write_receipts from anon;
revoke all on public.brain_write_receipts from authenticated;

grant all on public.brain_write_receipts to service_role;
grant select on public.brain_write_receipts to authenticated;

drop policy if exists brain_write_receipts_select_member on public.brain_write_receipts;
create policy brain_write_receipts_select_member
  on public.brain_write_receipts
  for select
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
-- No insert/update/delete policy: owners cannot write. Service role bypasses RLS.
