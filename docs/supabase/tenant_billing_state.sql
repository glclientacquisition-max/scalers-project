-- DRAFT. NOT APPLIED to staging or production. Needs Alvin's GO via Chief.
--
-- tenant_billing_state: one row per tenant for the Admin period card and the
-- Desk banners. security_invoker, so owners see only their own tenant through
-- the existing RLS (tenants_select_member) plus the read policies below.
-- Service role (Admin, Voice) sees every tenant.
--
-- Run after: package_state_rules.sql, fix_grant_package_minutes.sql,
--            owner_rls.sql (current_user_tenant_ids). Re-run after
--            notify_send_reserve_settle.sql (#647) so SMS switches to the ledger.
-- ASCII-only. Safe to re-run.
--
-- Columns
--   package_state      active | none (explicit no package; never unlimited)
--   mode_label         beta (enforcement off) | metered (enforced, on-demand on)
--                      | capped (enforced, on-demand off)
--   included_minutes   tenants.minutes_included (package part + granted)
--   package_minutes    included_minutes - granted_minutes (prorated on upgrade)
--   granted_minutes    billing_grant_minutes_for_period() -> the ONE expiry rule
--   used/remaining     from tenants.seconds_used
--   sms_used           notify_sms_billable rows this period when #647 is
--                      applied (sms_used_source = 'ledger'), else the counter
--   overage_owed_kes   0 unless enforced AND on-demand on. Call part priced at
--                      the inbound rate (an estimate; invoices will be exact),
--                      plus SMS over the allowance at sms_kes.

-- ---------------------------------------------------------------------------
-- Owner read policies needed by a security_invoker view
-- ---------------------------------------------------------------------------
drop policy if exists tenant_subscriptions_select_member on public.tenant_subscriptions;
create policy tenant_subscriptions_select_member
  on public.tenant_subscriptions for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
grant select on public.tenant_subscriptions to authenticated;

drop policy if exists billing_packages_select_all on public.billing_packages;
create policy billing_packages_select_all
  on public.billing_packages for select to authenticated using (true);
grant select on public.billing_packages to authenticated;

drop policy if exists billing_rate_card_select_all on public.billing_rate_card;
create policy billing_rate_card_select_all
  on public.billing_rate_card for select to authenticated using (true);
grant select on public.billing_rate_card to authenticated;

-- Grants: owners read amounts and periods only (no ops note/actor).
drop policy if exists tenant_minute_grants_select_member on public.tenant_minute_grants;
create policy tenant_minute_grants_select_member
  on public.tenant_minute_grants for select to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));
revoke select on public.tenant_minute_grants from authenticated;
grant select (tenant_id, minutes, period_start, period_end) on public.tenant_minute_grants to authenticated;

-- ---------------------------------------------------------------------------
-- View (built with dynamic SQL so it uses the SMS ledger when it exists)
-- ---------------------------------------------------------------------------
do $do$
declare
  v_has_ledger boolean := to_regclass('public.notify_sms_billable') is not null;
  v_sms_used text;
  v_sms_source text;
begin
  if v_has_ledger then
    v_sms_used := $s$(select coalesce(sum(coalesce(b.units, 1)), 0)::integer
                      from public.notify_sms_billable b
                      where b.tenant_id = t.id
                        and b.created_at >= ps.period_start
                        and (ps.period_end is null or b.created_at < ps.period_end))$s$;
    v_sms_source := $s$'ledger'$s$;
  else
    v_sms_used := 'coalesce(t.sms_used_units, 0)';
    v_sms_source := $s$'counter'$s$;
  end if;

  execute 'drop view if exists public.tenant_billing_state';
  execute format($v$
    create view public.tenant_billing_state
    with (security_invoker = true) as
    with ps as (
      select
        t.id as tenant_id,
        s.status as sub_status,
        s.package_id,
        s.period,
        coalesce(s.current_period_start,
          date_trunc('month', now() at time zone 'Africa/Nairobi') at time zone 'Africa/Nairobi') as period_start,
        case when s.tenant_id is null
          then (date_trunc('month', now() at time zone 'Africa/Nairobi') + interval '1 month') at time zone 'Africa/Nairobi'
          else s.current_period_end end as period_end,
        s.pending_change, s.pending_package_id, s.pending_period, s.pending_effective_at
      from public.tenants t
      left join public.tenant_subscriptions s on s.tenant_id = t.id
    ),
    base as (
      select
        t.id as tenant_id,
        t.business_name,
        case when ps.sub_status = 'active' then 'active' else 'none' end as package_state,
        case when ps.sub_status = 'active' then ps.package_id end as package_id,
        case when ps.sub_status = 'active' then p.sku end as package_sku,
        case when ps.sub_status = 'active' then p.name end as package_name,
        ps.period as billing_period,
        ps.period_start,
        ps.period_end,
        ps.pending_change,
        ps.pending_package_id,
        pp.sku as pending_package_sku,
        ps.pending_period,
        ps.pending_effective_at,
        coalesce(t.minutes_included, 0) as included_minutes,
        public.billing_grant_minutes_for_period(t.id, ps.period_start, ps.period_end) as granted_minutes,
        coalesce(t.seconds_used, 0) as used_seconds,
        coalesce(t.sms_included_units, 0) as sms_included,
        %1$s as sms_used,
        %2$s::text as sms_used_source,
        coalesce(t.sms_used_units, 0) as sms_counter,
        coalesce(t.on_demand_usage_enabled, false) as on_demand_enabled,
        coalesce(t.billing_enforcement, 'off') as enforcement_mode,
        case when coalesce(t.soft_spend_limit_enabled, false) then t.soft_spend_limit_kes end as spend_cap_kes,
        r.inbound_kes_per_second,
        r.sms_kes
      from public.tenants t
      join ps on ps.tenant_id = t.id
      left join public.billing_packages p on p.id = ps.package_id
      left join public.billing_packages pp on pp.id = ps.pending_package_id
      left join public.billing_rate_card r on r.id = 1
    )
    select
      b.tenant_id,
      b.business_name,
      b.package_state,
      b.package_id,
      b.package_sku,
      b.package_name,
      b.billing_period,
      b.period_start,
      b.period_end,
      b.pending_change,
      b.pending_package_id,
      b.pending_package_sku,
      b.pending_period,
      b.pending_effective_at,
      b.included_minutes,
      greatest(b.included_minutes - b.granted_minutes, 0) as package_minutes,
      b.granted_minutes,
      b.used_seconds,
      round(b.used_seconds / 60.0, 1) as used_minutes,
      round(greatest(b.included_minutes * 60 - b.used_seconds, 0) / 60.0, 1) as remaining_minutes,
      greatest(b.used_seconds - b.included_minutes * 60, 0) as overage_seconds,
      b.sms_included,
      b.sms_used,
      b.sms_used_source,
      b.sms_counter,
      greatest(b.sms_used - b.sms_included, 0) as sms_overage_units,
      b.on_demand_enabled,
      b.enforcement_mode,
      case
        when b.enforcement_mode not in ('soft', 'hard') then 'beta'
        when b.on_demand_enabled then 'metered'
        else 'capped'
      end as mode_label,
      b.spend_cap_kes,
      case
        when b.enforcement_mode in ('soft', 'hard') and b.on_demand_enabled then
          round(
            greatest(b.used_seconds - b.included_minutes * 60, 0) * coalesce(b.inbound_kes_per_second, 0)
            + greatest(b.sms_used - b.sms_included, 0) * coalesce(b.sms_kes, 0),
          2)
        else 0
      end::numeric as overage_owed_kes
    from base b
  $v$, v_sms_used, v_sms_source);

  execute 'comment on view public.tenant_billing_state is '
    || quote_literal('Per-tenant billing period state for Admin period card and Desk banners. SMS source: '
       || case when v_has_ledger then 'notify_sms_billable ledger' else 'tenants.sms_used_units counter' end || '.');
  execute 'revoke all on public.tenant_billing_state from public, anon';
  execute 'grant select on public.tenant_billing_state to authenticated, service_role';
end
$do$;
