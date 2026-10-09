-- notify_send_reserve_settle.sql
-- STATUS: DRAFT, NOT APPLIED. Prod and staging need Alvin's GO. Staging first.
-- Supersedes the unapplied drafts/2026-10-09_claim_sms_units.sql (never shipped).
--
-- Purpose: make notify_sends the SMS billing source of truth.
--   reserve  -> one RPC inserts a `pending` notify_sends row AND counts the SMS
--               units on tenants.sms_used_units, in one transaction.
--   send     -> the app calls the provider.
--   settle   -> `sent` (+ provider_message_id), or `failed`, which releases the
--               units held by that row (a reservation release, not a money refund).
--   Billing reads notify_sends (status = 'sent', channel = 'sms', billed_to =
--   'tenant'). tenants.sms_used_units becomes an allowance/display cache that
--   sms_counter_drift() checks against the ledger every day.
--
-- Why: prod 2026-10-09 read-only: counter 358 vs ledger 166 (Esga), 42 vs 18
-- (Aris), 8 vs 4 (SBS). consume_sms_units counts BEFORE the send and nothing
-- releases the units when TextSMS fails (402, balance 0), so every failed SMS
-- that fell back to WhatsApp/email still counted.
--
-- Idempotency: one row per (tenant_id, idempotency_key) (existing unique index;
-- platform rows use tenant_id null + a partial unique index on the key).
--   reserve on a key that is `pending`  -> replayed, allowed=false, reason in_flight
--   reserve on a key that is `sent`     -> replayed, allowed=false, reason already_sent
--   reserve on a key that is `failed` or `refused` -> the SAME row is re-armed
--     (attempts+1, new channel/recipient allowed: this is how a failed SMS falls
--      back to WhatsApp/email under one per-person key without double counting)
--   settle on a row that is no longer `pending` -> replayed no-op, first settle wins.
--
-- Rollout order (each step needs GO):
--   1. Apply this file on staging; run the checks at the bottom.
--   2. Deploy Voice + Desk from the reserve/settle PR (code falls back to the
--      legacy consume+insert path while reserve_notify_send is missing).
--   3. Apply on prod; deploy; run drafts/2026-10-09_sms_counter_reconcile.sql.
--   4. After 7 clean days of sms_counter_drift(): revoke consume_sms_units from
--      authenticated and drop the legacy fallback in code.
-- Run after: notify_send_ledger.sql, sms_allowance.sql, package_catalog.sql
-- (tenant_subscriptions). ASCII-only. Re-runnable.

begin;

-- ---------------------------------------------------------------------------
-- 1. notify_sends: status + reservation columns. Existing rows are `sent`.
-- ---------------------------------------------------------------------------
alter table public.notify_sends
  add column if not exists status text not null default 'sent',
  add column if not exists held_units integer not null default 0,
  add column if not exists outcome text,
  add column if not exists failure_reason text,
  add column if not exists attempts integer not null default 1,
  add column if not exists reserved_at timestamptz,
  add column if not exists settled_at timestamptz;

comment on column public.notify_sends.status is
  'pending (reserved, not yet sent) | sent | failed (units released) | refused (allowance). Billing reads sent.';
comment on column public.notify_sends.held_units is
  'SMS units this row currently holds on tenants.sms_used_units. 0 after release. Legacy rows: 0.';
comment on column public.notify_sends.outcome is
  'Allowance outcome at reserve: included | on_demand | beta | refused | platform | not_metered.';

alter table public.notify_sends drop constraint if exists notify_sends_status_check;
alter table public.notify_sends add constraint notify_sends_status_check
  check (status in ('pending', 'sent', 'failed', 'refused'));

alter table public.notify_sends drop constraint if exists notify_sends_held_units_check;
alter table public.notify_sends add constraint notify_sends_held_units_check
  check (held_units >= 0 and (status = 'pending' or status = 'sent' or held_units = 0));

-- Platform-billed sends (ops alerts, platform WhatsApp replies) have no tenant.
alter table public.notify_sends alter column tenant_id drop not null;

alter table public.notify_sends drop constraint if exists notify_sends_audience_check;
alter table public.notify_sends add constraint notify_sends_audience_check
  check (audience in ('staff', 'caller', 'platform'));

alter table public.notify_sends drop constraint if exists notify_sends_tenant_or_platform_check;
alter table public.notify_sends add constraint notify_sends_tenant_or_platform_check
  check (tenant_id is not null or billed_to = 'platform');

create unique index if not exists notify_sends_platform_idempotency_idx
  on public.notify_sends (idempotency_key)
  where tenant_id is null;

create index if not exists notify_sends_pending_idx
  on public.notify_sends (reserved_at)
  where status = 'pending';

-- Desk direct inserts (legacy path during rollout) may only write final rows
-- that hold nothing. New Desk code uses the RPCs below.
drop policy if exists notify_sends_insert_caller_member on public.notify_sends;
create policy notify_sends_insert_caller_member
  on public.notify_sends
  for insert
  to authenticated
  with check (
    tenant_id in (select public.current_user_tenant_ids())
    and audience = 'caller'
    and billed_to = 'tenant'
    and channel = 'sms'
    and status = 'sent'
    and held_units = 0
  );

-- ---------------------------------------------------------------------------
-- 2. Append-only stays, except a settle/re-arm inside the RPCs below.
--    Identity columns never change; a `sent` row is final.
-- ---------------------------------------------------------------------------
create or replace function public.notify_sends_deny_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and current_setting('scalers.notify_settle', true) = '1' then
    if new.id is distinct from old.id
      or new.tenant_id is distinct from old.tenant_id
      or new.idempotency_key is distinct from old.idempotency_key
      or new.kind is distinct from old.kind
      or new.created_at is distinct from old.created_at
      or new.audience is distinct from old.audience
      or new.billed_to is distinct from old.billed_to
      or new.call_id is distinct from old.call_id
      or new.call_sid is distinct from old.call_sid
    then
      raise exception 'notify_sends: identity columns are immutable';
    end if;
    if old.status = 'sent' then
      raise exception 'notify_sends: sent rows are final';
    end if;
    return new;
  end if;
  raise exception 'notify_sends is append-only';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. reserve_notify_send: insert pending row + count SMS units, atomically.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_notify_send(
  p_tenant_id uuid,
  p_idempotency_key text,
  p_kind text,
  p_channel text,
  p_recipient text default null,
  p_body text default null,
  p_units integer default null,
  p_call_id uuid default null,
  p_call_sid text default null,
  p_audience text default null,
  p_billed_to text default null,
  p_strict boolean default false
)
returns table (
  send_id uuid,
  allowed boolean,
  replayed boolean,
  status text,
  outcome text,
  reason text,
  overage boolean,
  units integer,
  held_units integer,
  sms_used_units integer,
  sms_included_units integer,
  remaining integer,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_kind text := nullif(trim(coalesce(p_kind, '')), '');
  v_channel text := lower(trim(coalesce(p_channel, '')));
  v_billed text;
  v_aud text;
  v_units integer;
  v_metered boolean;
  v_t record;
  v_enf text := 'off';
  v_od boolean := false;
  v_inc integer := null;
  v_used integer := null;
  v_row public.notify_sends%rowtype;
  v_found boolean := false;
  v_allowed boolean;
  v_outcome text;
  v_reason text;
  v_status text;
  v_held integer := 0;
  v_id uuid;
  v_attempts integer := 1;
begin
  if v_key is null then raise exception 'idempotency_key required'; end if;
  if v_kind is null then raise exception 'kind required'; end if;
  if v_channel not in ('sms', 'whatsapp', 'email') then
    raise exception 'channel must be sms, whatsapp or email';
  end if;

  v_billed := coalesce(nullif(p_billed_to, ''),
                       case when p_tenant_id is null then 'platform' else 'tenant' end);
  v_aud := coalesce(nullif(p_audience, ''),
                    case when p_tenant_id is null then 'platform' else 'staff' end);
  if p_tenant_id is null and v_billed <> 'platform' then
    raise exception 'tenant_id required for tenant-billed sends';
  end if;
  v_units := case when v_channel = 'sms' then greatest(coalesce(p_units, 1), 1) else 1 end;
  v_metered := p_tenant_id is not null and v_billed = 'tenant' and v_channel = 'sms';

  -- Desk (authenticated) may only reserve caller SMS for its own tenant.
  if auth.uid() is not null and coalesce(auth.role(), '') = 'authenticated' then
    if p_tenant_id is null
      or p_tenant_id not in (select public.current_user_tenant_ids())
      or v_aud <> 'caller' or v_billed <> 'tenant' or v_channel <> 'sms'
    then
      raise exception 'not allowed';
    end if;
  end if;

  -- Serialize: tenant row lock (also guards the counter); platform rows by key.
  if p_tenant_id is not null then
    select t.billing_enforcement,
           coalesce(t.on_demand_usage_enabled, false) as od,
           coalesce(t.sms_included_units, 200) as inc,
           coalesce(t.sms_used_units, 0) as used
      into v_t
    from public.tenants t
    where t.id = p_tenant_id
    for update;
    if not found then raise exception 'tenant not found'; end if;
    v_enf := coalesce(v_t.billing_enforcement, 'off');
    v_od := v_t.od;
    v_inc := v_t.inc;
    v_used := v_t.used;
  else
    perform pg_advisory_xact_lock(hashtext('notify_sends:' || v_key));
  end if;

  select * into v_row
  from public.notify_sends n
  where n.tenant_id is not distinct from p_tenant_id
    and n.idempotency_key = v_key
  for update;
  v_found := found;

  if v_found and v_row.status in ('pending', 'sent') then
    send_id := v_row.id;
    allowed := false;
    replayed := true;
    status := v_row.status;
    outcome := v_row.outcome;
    reason := case when v_row.status = 'sent' then 'already_sent' else 'in_flight' end;
    overage := coalesce(v_row.overage, false);
    units := v_row.units;
    held_units := v_row.held_units;
    sms_used_units := v_used;
    sms_included_units := v_inc;
    remaining := case when v_inc is null then null else v_inc - v_used end;
    attempts := v_row.attempts;
    return next;
    return;
  end if;

  -- Allowance decision (same rules as consume_sms_units + p_strict handoff rule).
  if not v_metered then
    v_allowed := true;
    v_outcome := case when v_billed = 'platform' then 'platform' else 'not_metered' end;
    v_reason := v_outcome;
  elsif v_used + v_units <= v_inc then
    v_allowed := true; v_outcome := 'included'; v_reason := 'included';
  elsif v_od then
    v_allowed := true; v_outcome := 'on_demand'; v_reason := 'on_demand';
  elsif v_enf = 'off' and not coalesce(p_strict, false) then
    v_allowed := true; v_outcome := 'beta'; v_reason := 'beta';
  else
    v_allowed := false; v_outcome := 'refused'; v_reason := 'sms_allowance_exhausted';
  end if;

  v_status := case when v_allowed then 'pending' else 'refused' end;
  v_held := case when v_allowed and v_metered then v_units else 0 end;

  -- Row first, counter second: a lost race never counts without a row.
  if v_found then
    perform set_config('scalers.notify_settle', '1', true);
    update public.notify_sends n
      set status = v_status,
          channel = v_channel,
          recipient = nullif(trim(coalesce(p_recipient, '')), ''),
          body = left(coalesce(p_body, ''), 2000),
          units = v_units,
          held_units = v_held,
          outcome = v_outcome,
          overage = (v_outcome = 'on_demand'),
          provider_message_id = null,
          failure_reason = case when v_allowed then null else v_reason end,
          attempts = n.attempts + 1,
          reserved_at = now(),
          settled_at = case when v_allowed then null else now() end
      where n.id = v_row.id
      returning n.id, n.attempts into v_id, v_attempts;
    perform set_config('scalers.notify_settle', '0', true);
  else
    insert into public.notify_sends as n (
      tenant_id, call_id, call_sid, kind, channel, recipient, audience, billed_to,
      units, body, idempotency_key, overage, status, held_units, outcome,
      failure_reason, attempts, reserved_at, settled_at
    ) values (
      p_tenant_id, p_call_id, nullif(trim(coalesce(p_call_sid, '')), ''), v_kind, v_channel,
      nullif(trim(coalesce(p_recipient, '')), ''), v_aud, v_billed,
      v_units, left(coalesce(p_body, ''), 2000), v_key, (v_outcome = 'on_demand'),
      v_status, v_held, v_outcome,
      case when v_allowed then null else v_reason end, 1, now(),
      case when v_allowed then null else now() end
    )
    on conflict do nothing
    returning n.id, n.attempts into v_id, v_attempts;

    if v_id is null then
      -- A legacy direct insert won the race: treat as already sent, count nothing.
      send_id := null; allowed := false; replayed := true; status := 'sent';
      outcome := null; reason := 'already_sent'; overage := false;
      units := v_units; held_units := 0; sms_used_units := v_used;
      sms_included_units := v_inc;
      remaining := case when v_inc is null then null else v_inc - v_used end;
      attempts := 1;
      return next;
      return;
    end if;
  end if;

  if v_held > 0 then
    perform set_config('scalers.wallet_write', '1', true);
    update public.tenants t set sms_used_units = v_used + v_held where t.id = p_tenant_id;
    perform set_config('scalers.wallet_write', '0', true);
    v_used := v_used + v_held;
  end if;

  send_id := v_id;
  allowed := v_allowed;
  replayed := false;
  status := v_status;
  outcome := v_outcome;
  reason := v_reason;
  overage := (v_outcome = 'on_demand');
  units := v_units;
  held_units := v_held;
  sms_used_units := v_used;
  sms_included_units := v_inc;
  remaining := case when v_inc is null then null else v_inc - v_used end;
  attempts := v_attempts;
  return next;
end;
$$;

comment on function public.reserve_notify_send(uuid, text, text, text, text, text, integer, uuid, text, text, text, boolean) is
  'Reserve one notify send: pending notify_sends row + SMS units in one transaction. Idempotent by key; failed/refused keys re-arm.';

revoke all on function public.reserve_notify_send(uuid, text, text, text, text, text, integer, uuid, text, text, text, boolean)
  from public, anon;
grant execute on function public.reserve_notify_send(uuid, text, text, text, text, text, integer, uuid, text, text, text, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. settle_notify_send: sent | failed (+ release). First settle wins.
-- ---------------------------------------------------------------------------
create or replace function public.settle_notify_send(
  p_send_id uuid,
  p_status text,
  p_provider_message_id text default null,
  p_failure_reason text default null
)
returns table (
  send_id uuid,
  status text,
  replayed boolean,
  released_units integer,
  sms_used_units integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_status text := lower(trim(coalesce(p_status, '')));
  v_tenant uuid;
  v_row public.notify_sends%rowtype;
  v_used integer := null;
  v_release integer := 0;
  v_period_start timestamptz;
begin
  if p_send_id is null then raise exception 'send_id required'; end if;
  if v_status not in ('sent', 'failed') then
    raise exception 'status must be sent or failed';
  end if;

  select n.tenant_id into v_tenant from public.notify_sends n where n.id = p_send_id;
  if not found then raise exception 'send not found'; end if;

  if auth.uid() is not null and coalesce(auth.role(), '') = 'authenticated' then
    if v_tenant is null or v_tenant not in (select public.current_user_tenant_ids()) then
      raise exception 'not allowed';
    end if;
  end if;

  -- Same lock order as reserve: tenant, then row.
  if v_tenant is not null then
    select coalesce(t.sms_used_units, 0) into v_used
    from public.tenants t where t.id = v_tenant for update;
  end if;

  select * into v_row from public.notify_sends n where n.id = p_send_id for update;

  if v_row.status <> 'pending' then
    send_id := v_row.id; status := v_row.status; replayed := true;
    released_units := 0; sms_used_units := v_used;
    return next;
    return;
  end if;

  if v_status = 'failed' and v_row.held_units > 0 and v_tenant is not null then
    -- Do not release into a newer period: the rollover already zeroed it.
    select s.current_period_start into v_period_start
    from public.tenant_subscriptions s where s.tenant_id = v_tenant;
    if v_period_start is null or v_row.reserved_at is null or v_row.reserved_at >= v_period_start then
      v_release := v_row.held_units;
    end if;
  end if;

  perform set_config('scalers.notify_settle', '1', true);
  update public.notify_sends n
    set status = v_status,
        provider_message_id = case when v_status = 'sent'
                                   then coalesce(nullif(p_provider_message_id, ''), n.provider_message_id)
                                   else n.provider_message_id end,
        failure_reason = case when v_status = 'failed'
                              then left(coalesce(nullif(p_failure_reason, ''), 'send_failed'), 200)
                              else null end,
        held_units = case when v_status = 'failed' then 0 else n.held_units end,
        settled_at = now()
    where n.id = p_send_id;
  perform set_config('scalers.notify_settle', '0', true);

  if v_release > 0 then
    perform set_config('scalers.wallet_write', '1', true);
    update public.tenants t
      set sms_used_units = greatest(0, v_used - v_release)
      where t.id = v_tenant;
    perform set_config('scalers.wallet_write', '0', true);
    v_used := greatest(0, v_used - v_release);
  end if;

  send_id := p_send_id;
  status := v_status;
  replayed := false;
  released_units := v_release;
  sms_used_units := v_used;
  return next;
end;
$$;

comment on function public.settle_notify_send(uuid, text, text, text) is
  'Settle a reserved notify send: sent, or failed + release held SMS units. Idempotent: first settle wins.';

revoke all on function public.settle_notify_send(uuid, text, text, text) from public, anon;
grant execute on function public.settle_notify_send(uuid, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Stale pending sweep (process crashed between reserve and settle).
--    Releases units: under-count beats over-charge. Dry run by default.
-- ---------------------------------------------------------------------------
create or replace function public.release_stale_notify_sends(
  p_older_than interval default interval '15 minutes',
  p_dry_run boolean default true
)
returns table (send_id uuid, tenant_id uuid, held_units integer, reserved_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  r record;
begin
  for r in
    select n.id, n.tenant_id, n.held_units, n.reserved_at
    from public.notify_sends n
    where n.status = 'pending' and n.reserved_at < now() - p_older_than
    order by n.reserved_at
    limit 500
  loop
    if not coalesce(p_dry_run, true) then
      perform public.settle_notify_send(r.id, 'failed', null, 'stale_pending');
    end if;
    send_id := r.id; tenant_id := r.tenant_id; held_units := r.held_units;
    reserved_at := r.reserved_at;
    return next;
  end loop;
end;
$$;

revoke all on function public.release_stale_notify_sends(interval, boolean) from public, anon, authenticated;
grant execute on function public.release_stale_notify_sends(interval, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Billing source + daily drift check.
-- ---------------------------------------------------------------------------
create or replace view public.notify_sms_billable
with (security_invoker = true) as
select n.id, n.tenant_id, n.created_at, n.kind, n.audience, n.units, n.overage,
       n.provider_message_id, n.idempotency_key
from public.notify_sends n
where n.channel = 'sms' and n.billed_to = 'tenant' and n.status = 'sent'
  and n.tenant_id is not null;

comment on view public.notify_sms_billable is
  'The ONLY source for SMS invoice lines. tenants.sms_used_units is a cache.';

grant select on public.notify_sms_billable to authenticated, service_role;

create or replace function public.sms_counter_drift()
returns table (
  tenant_id uuid,
  period_start timestamptz,
  counter integer,
  ledger_sent_units integer,
  pending_held_units integer,
  drift integer
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id,
         s.current_period_start,
         coalesce(t.sms_used_units, 0),
         coalesce(sum(n.units) filter (where n.status = 'sent'), 0)::integer,
         coalesce(sum(n.held_units) filter (where n.status = 'pending'), 0)::integer,
         (coalesce(t.sms_used_units, 0)
           - coalesce(sum(n.units) filter (where n.status = 'sent'), 0)
           - coalesce(sum(n.held_units) filter (where n.status = 'pending'), 0))::integer
  from public.tenants t
  left join public.tenant_subscriptions s on s.tenant_id = t.id
  left join public.notify_sends n
    on n.tenant_id = t.id
   and n.channel = 'sms' and n.billed_to = 'tenant'
   and n.created_at >= coalesce(s.current_period_start, '-infinity'::timestamptz)
  group by t.id, s.current_period_start, t.sms_used_units;
$$;

revoke all on function public.sms_counter_drift() from public, anon, authenticated;
grant execute on function public.sms_counter_drift() to service_role;

commit;

-- ---------------------------------------------------------------------------
-- Cron (separate GO; pg_cron 1.6.4 is on prod):
-- select cron.schedule('notify-stale-release', '*/5 * * * *',
--   $c$select public.release_stale_notify_sends(interval '15 minutes', false)$c$);
-- Daily drift (feeds platform_ops_notices via the Admin ops cron, PR #640):
-- select * from public.sms_counter_drift() where drift <> 0;
--
-- Checks after apply (STAGING, service role, one test tenant):
-- 1) select * from reserve_notify_send('<t>', 'test:k1', 'lead', 'sms', '2547..', 'hi', 1);
--      -> allowed, status pending, held_units 1, counter +1
-- 2) same call again                       -> replayed, reason in_flight, counter unchanged
-- 3) select * from settle_notify_send('<send_id>', 'failed', null, 'textsms_402');
--      -> released_units 1, counter -1
-- 4) reserve 'test:k1' channel 'email'      -> same send_id, attempts 2, held 0 (fallback re-arm)
-- 5) settle 'sent' twice                    -> second is replayed
-- 6) reserve 'test:k1' again                -> replayed, reason already_sent
-- 7) select * from sms_counter_drift();      -> drift 0 for the test tenant
-- 8) update notify_sends set body='x' where id='<id>';  -> 'notify_sends is append-only'
--
-- Rollback (no data loss; new columns stay harmless):
--   drop function if exists public.release_stale_notify_sends(interval, boolean);
--   drop function if exists public.settle_notify_send(uuid, text, text, text);
--   drop function if exists public.reserve_notify_send(uuid, text, text, text, text, text, integer, uuid, text, text, text, boolean);
--   drop function if exists public.sms_counter_drift();
--   drop view if exists public.notify_sms_billable;
--   re-run notify_send_ledger.sql section for notify_sends_deny_mutation (strict append-only).
--   (tenant_id NOT NULL can only return after platform rows are moved out.)
