-- DRAFT. NOT APPLIED to staging or production. Needs Alvin's GO via Chief.
--
-- Package state rules (Admin audit B4 + "no package" state).
-- Run after: package_catalog.sql, fix_grant_package_minutes.sql (#648,
--            tenant_minute_grants), wallet_security_beta.sql (ops_audit_log).
-- Then re-run package_period_rollover.sql (its rollover calls the helpers
-- below) and tenant_billing_state.sql.
-- ASCII-only. Safe to re-run.
--
-- RULES
--  1. No package is explicit: tenant_subscriptions.status = 'cancelled' (or no
--     row). Package allowances are 0. tenants.minutes_included then holds only
--     this period's grants. 0 included minutes is a cap of 0, never unlimited
--     (Voice inboundOpen reads the status; see src/billing/packageOverage.js).
--  2. Calls with no package: beta (billing_enforcement = off) still answers and
--     meters. Enforced + on-demand on: answers, every second is on-demand.
--     Enforced + on-demand off: refused (same path as package_exhausted).
--  3. Upgrade (higher monthly price; same price and more minutes): applies now.
--     Period, usage and grants are kept. Included minutes grow by the minute
--     difference prorated over the rest of the period (rounded up). SMS, email,
--     staff WhatsApp and seats move to the new package now.
--  4. Downgrade (lower price, or same price and not more minutes) and a period
--     change (month <-> year) on the same package: scheduled for the next
--     period (pending_* columns). Nothing changes now. Re-assigning the current
--     package cancels a pending change. An upgrade also cancels it.
--  5. Starting a package from none: applies now, full package minutes for the
--     current period (calendar month in EAT, or the running period clock of a
--     cancelled row). Same as today's assign; no proration.
--  6. Unassign: p_when = 'now' (allowances drop to 0 now, grants for this
--     period still count) or 'period_end' (scheduled like a downgrade).
--  7. Period rollover (package_period_rollover.sql) applies pending changes,
--     zeroes usage, and rebuilds minutes_included = package minutes + grants
--     that count in the new period. It never deletes a grant row.
--  8. GRANT EXPIRY is ONE rule: billing_grant_minutes_for_period() below.
--     A grant counts only in the usage month it was made in (Alvin, 9 Oct
--     21:38 EAT). Change that one function to change the rule everywhere
--     (assign, unassign, rollover, tenant_billing_state).
--  9. TERM vs USAGE PERIOD (Alvin, 9 Oct 21:38 EAT). tenant_subscriptions.period
--     is the BILLING TERM length (month | year; year = billed once, 17% off).
--     term_start / term_end are the invoicing term. current_period_start /
--     current_period_end are the USAGE period and are ALWAYS one calendar
--     month (EAT): minutes, SMS, email, staff WhatsApp reset monthly and
--     grants expire monthly for every tenant. The rollover rolls usage monthly
--     and moves the term only when the term itself ends.
-- 10. Effective dates: upgrades now. Month <-> year switches at the next usage
--     month (that month starts a new term). Downgrades and unassign
--     (period_end) at the end of the BILLING TERM: next month for monthly
--     tenants, the end of the prepaid year for annual tenants.

-- ---------------------------------------------------------------------------
-- 0a. Calendar-month arithmetic in EAT. Plain "timestamptz + interval '1 month'"
--     runs in the session zone (UTC on Supabase), so 1 Oct 00:00 EAT + 1 month
--     landed on 31 Oct 00:00 EAT. Every period/term boundary uses this instead.
-- ---------------------------------------------------------------------------
create or replace function public.billing_add_months(p_ts timestamptz, p_months integer)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select ((p_ts at time zone 'Africa/Nairobi') + make_interval(months => p_months)) at time zone 'Africa/Nairobi';
$$;

grant execute on function public.billing_add_months(timestamptz, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 0. Schema: term, pending change and end marker on tenant_subscriptions
-- ---------------------------------------------------------------------------
alter table public.tenant_subscriptions
  add column if not exists term_start timestamptz,
  add column if not exists term_end timestamptz,
  add column if not exists ended_at timestamptz,
  add column if not exists pending_package_id uuid references public.billing_packages (id),
  add column if not exists pending_period text,
  add column if not exists pending_change text,
  add column if not exists pending_effective_at timestamptz,
  add column if not exists pending_set_at timestamptz,
  add column if not exists pending_actor text;

alter table public.tenant_subscriptions
  drop constraint if exists tenant_subscriptions_pending_check;
alter table public.tenant_subscriptions
  add constraint tenant_subscriptions_pending_check check (
    (pending_change is null
      and pending_package_id is null and pending_period is null and pending_effective_at is null)
    or (pending_change in ('downgrade', 'period_change')
      and pending_package_id is not null
      and pending_period in ('month', 'year')
      and pending_effective_at is not null)
    or (pending_change = 'unassign'
      and pending_package_id is null and pending_period is null
      and pending_effective_at is not null)
  );

-- Backfill the billing term. Monthly rows: term = usage month. A legacy annual
-- row whose usage period spans the year keeps that span as its term and its
-- usage period is cut to one month (the rollover catches it up).
-- Also corrects monthly ends written with UTC month math (31 Oct 00:00 EAT
-- instead of 1 Nov 00:00 EAT) to the true calendar-month end.
update public.tenant_subscriptions s
  set term_start = s.current_period_start,
      term_end = case
        when s.period = 'year' and s.current_period_end > public.billing_add_months(s.current_period_start, 1)
          then s.current_period_end
        when s.period = 'year' then public.billing_add_months(s.current_period_start, 12)
        else public.billing_add_months(s.current_period_start, 1) end
where s.term_start is null;

update public.tenant_subscriptions s
  set current_period_end = public.billing_add_months(s.current_period_start, 1)
where s.current_period_end is not null
  and s.current_period_end <> public.billing_add_months(s.current_period_start, 1)
  and s.current_period_end > s.current_period_start + interval '27 days';

alter table public.tenant_subscriptions alter column term_start set default now();
alter table public.tenant_subscriptions alter column term_start set not null;

comment on column public.tenant_subscriptions.period is
  'BILLING TERM length: month | year (billed once a year, annual discount). Usage is always monthly.';
comment on column public.tenant_subscriptions.term_start is 'Billing term start (invoicing).';
comment on column public.tenant_subscriptions.term_end is 'Billing term end (invoicing). Monthly: = current_period_end.';
comment on column public.tenant_subscriptions.current_period_start is
  'USAGE period start. Always one calendar month (EAT); allowances and grants reset here.';

comment on column public.tenant_subscriptions.status is
  'active = on a package. cancelled = NO PACKAGE (explicit; allowances 0, never unlimited). The row keeps the period clock.';
comment on column public.tenant_subscriptions.pending_change is
  'downgrade | period_change | unassign, applied by roll_package_periods at pending_effective_at.';

-- ---------------------------------------------------------------------------
-- 1. THE grant expiry rule (single place)
-- ---------------------------------------------------------------------------
create or replace function public.billing_grant_minutes_for_period(
  p_tenant_id uuid,
  p_period_start timestamptz,
  p_period_end timestamptz
)
returns integer
language sql
stable
security invoker  -- RLS applies: owners only sum their own grants
set search_path = public
as $$
  -- Rule: a grant counts only in the billing period it was made in, so unused
  -- grant minutes expire at that period's end.
  -- To carry grants forward instead, widen this predicate (for example
  -- g.period_start < p_period_end and g.period_end > p_period_start - interval '1 month').
  select coalesce(sum(g.minutes), 0)::integer
  from public.tenant_minute_grants g
  where g.tenant_id = p_tenant_id
    and g.period_start >= p_period_start
    and (p_period_end is null or g.period_start < p_period_end);
$$;

revoke all on function public.billing_grant_minutes_for_period(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.billing_grant_minutes_for_period(uuid, timestamptz, timestamptz)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Internal: write package allowances (p_package_id null = no package)
-- ---------------------------------------------------------------------------
create or replace function public._tenant_set_allowances(
  p_tenant_id uuid,
  p_package_id uuid,
  p_minutes_included integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_pack public.billing_packages%rowtype;
begin
  perform set_config('scalers.wallet_write', '1', true);
  if p_package_id is null then
    -- No package: nothing included except grants. Seats are left alone so
    -- nobody is locked out of the Desk.
    update public.tenants as t
      set minutes_included = greatest(coalesce(p_minutes_included, 0), 0),
          sms_included_units = 0,
          email_included_units = 0,
          whatsapp_included_units = 0
    where t.id = p_tenant_id;
  else
    select * into v_pack from public.billing_packages p where p.id = p_package_id;
    if not found then
      raise exception 'package not found';
    end if;
    update public.tenants as t
      set seat_included = v_pack.seats,
          minutes_included = greatest(coalesce(p_minutes_included, 0), 0),
          sms_included_units = v_pack.sms,
          email_included_units = v_pack.email,
          whatsapp_included_units = v_pack.staff_wa
    where t.id = p_tenant_id;
  end if;
end;
$$;

revoke all on function public._tenant_set_allowances(uuid, uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. assign_tenant_package with change rules
-- ---------------------------------------------------------------------------
drop function if exists public.assign_tenant_package(uuid, uuid, text);
drop function if exists public.assign_tenant_package(uuid, uuid, text, text, text);

create or replace function public.assign_tenant_package(
  p_tenant_id uuid,
  p_package_id uuid,
  p_period text default 'month',
  p_actor text default 'ops',
  p_note text default null
)
returns table (
  assigned_tenant_id uuid,
  assigned_package_id uuid,
  assigned_period text,
  change_kind text,
  effective_at timestamptz,
  minutes_included integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_actor text := coalesce(nullif(trim(p_actor), ''), 'ops');
  v_period text := lower(trim(coalesce(p_period, 'month')));
  v_pack public.billing_packages%rowtype;
  v_cur public.billing_packages%rowtype;
  v_sub record;
  v_has_sub boolean;
  v_tenant_minutes integer;
  v_start timestamptz;
  v_end timestamptz;
  v_grants integer;
  v_base integer;
  v_frac numeric;
  v_kind text;
  v_effective timestamptz := now();
  v_after integer;
  v_upgrade boolean;
  v_repeat boolean := false;
begin
  if p_tenant_id is null or p_package_id is null then
    raise exception 'tenant and package required';
  end if;
  if v_period not in ('month', 'year') then
    raise exception 'period must be month or year';
  end if;

  select t.minutes_included into v_tenant_minutes
  from public.tenants t where t.id = p_tenant_id for update;
  if not found then
    raise exception 'tenant not found';
  end if;

  select * into v_pack from public.billing_packages p where p.id = p_package_id;
  if not found then
    raise exception 'package not found';
  end if;

  select s.* into v_sub
  from public.tenant_subscriptions s where s.tenant_id = p_tenant_id for update;
  v_has_sub := found;

  if not v_has_sub or v_sub.status <> 'active' then
    -- Rule 5: start from no package.
    if not v_pack.is_active then
      raise exception 'package is not available';
    end if;
    -- Usage period is always the calendar month (or the running monthly
    -- clock of a cancelled row). A new billing term starts with it.
    if v_has_sub and v_sub.current_period_end is not null and v_sub.current_period_end > now() then
      v_start := v_sub.current_period_start;
      v_end := v_sub.current_period_end;
    else
      v_start := date_trunc('month', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi';
      v_end := public.billing_add_months(v_start, 1);
    end if;

    insert into public.tenant_subscriptions as s (
      tenant_id, package_id, period, started_at, current_period_start, current_period_end,
      term_start, term_end, status, updated_at, ended_at,
      pending_package_id, pending_period, pending_change, pending_effective_at, pending_set_at, pending_actor
    ) values (
      p_tenant_id, p_package_id, v_period, now(), v_start, v_end,
      v_start, public.billing_add_months(v_start, case when v_period = 'year' then 12 else 1 end),
      'active', now(), null, null, null, null, null, null, null
    )
    on conflict (tenant_id) do update set
      package_id = excluded.package_id,
      period = excluded.period,
      started_at = excluded.started_at,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      term_start = excluded.term_start,
      term_end = excluded.term_end,
      status = 'active',
      updated_at = now(),
      ended_at = null,
      pending_package_id = null, pending_period = null, pending_change = null,
      pending_effective_at = null, pending_set_at = null, pending_actor = null;

    v_grants := public.billing_grant_minutes_for_period(p_tenant_id, v_start, v_end);
    perform public._tenant_set_allowances(p_tenant_id, p_package_id, v_pack.minutes + v_grants);
    v_kind := 'new';

  elsif v_sub.package_id = p_package_id and v_sub.period = v_period then
    -- Same package: no-op, but cancel any pending change (rule 4).
    v_kind := case when v_sub.pending_change is null then 'same' else 'pending_cancelled' end;
    update public.tenant_subscriptions s
      set pending_package_id = null, pending_period = null, pending_change = null,
          pending_effective_at = null, pending_set_at = null, pending_actor = null,
          updated_at = case when v_sub.pending_change is null then s.updated_at else now() end
    where s.tenant_id = p_tenant_id;

  else
    select * into v_cur from public.billing_packages p where p.id = v_sub.package_id;
    v_upgrade := v_sub.package_id <> p_package_id and (
      v_pack.monthly_price_kes > v_cur.monthly_price_kes
      or (v_pack.monthly_price_kes = v_cur.monthly_price_kes and v_pack.minutes > v_cur.minutes)
    );

    if v_upgrade then
      if not v_pack.is_active then
        raise exception 'package is not available';
      end if;
      -- Rule 3: upgrade now, keep period/usage/grants, prorate the difference.
      v_grants := public.billing_grant_minutes_for_period(
        p_tenant_id, v_sub.current_period_start, v_sub.current_period_end);
      v_base := greatest(coalesce(v_tenant_minutes, 0) - v_grants, 0);
      if v_sub.current_period_end is null or v_sub.current_period_end <= v_sub.current_period_start then
        v_frac := 1;
      else
        v_frac := extract(epoch from (v_sub.current_period_end - now()))
                / extract(epoch from (v_sub.current_period_end - v_sub.current_period_start));
        v_frac := least(greatest(v_frac, 0), 1);
      end if;
      v_base := v_base + ceil(greatest(v_pack.minutes - v_cur.minutes, 0) * v_frac)::integer;

      update public.tenant_subscriptions s
        set package_id = p_package_id,
            updated_at = now(),
            -- A different period on an upgrade is scheduled (rule 4).
            pending_package_id = case when v_period <> v_sub.period then p_package_id end,
            pending_period = case when v_period <> v_sub.period then v_period end,
            pending_change = case when v_period <> v_sub.period then 'period_change' end,
            pending_effective_at = case when v_period <> v_sub.period then v_sub.current_period_end end,
            pending_set_at = case when v_period <> v_sub.period then now() end,
            pending_actor = case when v_period <> v_sub.period then v_actor end
      where s.tenant_id = p_tenant_id;

      perform public._tenant_set_allowances(p_tenant_id, p_package_id, v_base + v_grants);
      v_kind := 'upgrade';
    else
      -- Rule 4: downgrade or period change waits for the next period.
      if v_sub.current_period_end is null then
        raise exception 'subscription has no period end; cannot schedule';
      end if;
      v_kind := case when v_sub.package_id = p_package_id then 'period_change_scheduled' else 'downgrade_scheduled' end;
      -- Rule 10: term switch at the next usage month; downgrade at term end.
      v_effective := case
        when v_sub.package_id = p_package_id then v_sub.current_period_end
        else greatest(coalesce(v_sub.term_end, v_sub.current_period_end), v_sub.current_period_end) end;
      if v_sub.pending_package_id is not distinct from p_package_id
         and v_sub.pending_period is not distinct from v_period then
        v_repeat := true;  -- same change already scheduled: no write, no audit
      end if;
      update public.tenant_subscriptions s
        set pending_package_id = p_package_id,
            pending_period = v_period,
            pending_change = case when v_sub.package_id = p_package_id then 'period_change' else 'downgrade' end,
            pending_effective_at = v_effective,
            pending_set_at = now(),
            pending_actor = v_actor,
            updated_at = now()
      where s.tenant_id = p_tenant_id
        and not v_repeat;
    end if;
  end if;

  select t.minutes_included into v_after from public.tenants t where t.id = p_tenant_id;

  if v_kind <> 'same' and not v_repeat then
    insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
    values (v_actor, 'assign_package', p_tenant_id, null, jsonb_build_object(
      'change_kind', v_kind,
      'package_id', p_package_id,
      'package_sku', v_pack.sku,
      'from_package_id', case when v_has_sub then v_sub.package_id end,
      'from_status', case when v_has_sub then v_sub.status end,
      'period', v_period,
      'effective_at', v_effective,
      'minutes_included_before', v_tenant_minutes,
      'minutes_included_after', v_after,
      'note', nullif(trim(coalesce(p_note, '')), '')
    ));
  end if;

  assigned_tenant_id := p_tenant_id;
  assigned_package_id := p_package_id;
  assigned_period := v_period;
  change_kind := v_kind;
  effective_at := v_effective;
  minutes_included := v_after;
  return next;
end;
$$;

revoke all on function public.assign_tenant_package(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.assign_tenant_package(uuid, uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. unassign_tenant_package: explicit "no package"
-- ---------------------------------------------------------------------------
create or replace function public.unassign_tenant_package(
  p_tenant_id uuid,
  p_when text,
  p_note text,
  p_actor text default 'ops'
)
returns table (
  tenant_id uuid,
  package_state text,
  effective_at timestamptz,
  minutes_included integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_actor text := coalesce(nullif(trim(p_actor), ''), 'ops');
  v_note text := trim(coalesce(p_note, ''));
  v_when text := lower(trim(coalesce(p_when, '')));
  v_sub record;
  v_grants integer;
  v_after integer;
  v_effective timestamptz;
  v_state text;
begin
  if p_tenant_id is null then
    raise exception 'tenant required';
  end if;
  if v_when not in ('now', 'period_end') then
    raise exception 'when must be now or period_end';
  end if;
  if length(v_note) < 3 then
    raise exception 'note required (min 3 chars)';
  end if;

  perform 1 from public.tenants t where t.id = p_tenant_id for update;
  if not found then
    raise exception 'tenant not found';
  end if;

  select s.* into v_sub
  from public.tenant_subscriptions s where s.tenant_id = p_tenant_id for update;

  if not found or v_sub.status <> 'active' then
    -- Already no package: idempotent no-op.
    select t.minutes_included into v_after from public.tenants t where t.id = p_tenant_id;
    tenant_id := p_tenant_id; package_state := 'none'; effective_at := null;
    minutes_included := v_after;
    return next;
    return;
  end if;

  if v_when = 'period_end' then
    if v_sub.current_period_end is null then
      raise exception 'subscription has no period end; use now';
    end if;
    -- Rule 10: at the end of the billing term (prepaid year for annual).
    v_effective := greatest(coalesce(v_sub.term_end, v_sub.current_period_end), v_sub.current_period_end);
    if v_sub.pending_change is distinct from 'unassign' then
      update public.tenant_subscriptions s
        set pending_package_id = null, pending_period = null, pending_change = 'unassign',
            pending_effective_at = v_effective, pending_set_at = now(),
            pending_actor = v_actor, updated_at = now()
      where s.tenant_id = p_tenant_id;
      insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
      values (v_actor, 'unassign_package', p_tenant_id, null, jsonb_build_object(
        'when', 'period_end', 'package_id', v_sub.package_id,
        'effective_at', v_effective, 'note', v_note));
    end if;
    v_state := 'active';
  else
    update public.tenant_subscriptions s
      set status = 'cancelled', ended_at = now(), updated_at = now(),
          pending_package_id = null, pending_period = null, pending_change = null,
          pending_effective_at = null, pending_set_at = null, pending_actor = null
    where s.tenant_id = p_tenant_id;
    v_grants := public.billing_grant_minutes_for_period(
      p_tenant_id, v_sub.current_period_start, v_sub.current_period_end);
    perform public._tenant_set_allowances(p_tenant_id, null, v_grants);
    insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
    values (v_actor, 'unassign_package', p_tenant_id, null, jsonb_build_object(
      'when', 'now', 'package_id', v_sub.package_id, 'grant_minutes_kept', v_grants,
      'note', v_note));
    v_state := 'none';
    v_effective := now();
  end if;

  select t.minutes_included into v_after from public.tenants t where t.id = p_tenant_id;
  tenant_id := p_tenant_id;
  package_state := v_state;
  effective_at := v_effective;
  minutes_included := v_after;
  return next;
end;
$$;

revoke all on function public.unassign_tenant_package(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.unassign_tenant_package(uuid, text, text, text) to service_role;
