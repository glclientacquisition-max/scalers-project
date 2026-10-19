-- billing_mode_legal_pairs.sql
-- P10. Apply after P9 (invoice_pay_session.sql). P9 is after P8 (billing_company.sql).
--
-- Production already has P1–P8 as of commit 553f1830, plus the owner-price v2
-- import. Production has no billing_mode_legal_pairs migration. Staging already
-- recorded this behavior as billing_mode_legal_pairs (20261018212633).
--
-- This file only replaces set_tenant_billing_mode. It does not change
-- billing_status, and it does not replace finalize_invoice. Do not re-run
-- wallet_security_beta.sql to pick up the check. Re-running this file is safe.
--
-- If a later file replaces finalize_invoice, re-apply billing_company.sql last.

create or replace function public.set_tenant_billing_mode(
  p_tenant_id uuid,
  p_mode text,
  p_actor text default 'ops',
  p_note text default null,
  p_beta_expires_at timestamptz default null,
  p_waive_negative_balance boolean default false
)
returns table (
  billing_enforcement text,
  wallet_balance_kes numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := lower(trim(p_mode));
  v_actor text := coalesce(nullif(trim(p_actor), ''), 'ops');
  v_bal numeric;
  v_note text := coalesce(nullif(trim(p_note), ''), 'Billing mode change');
begin
  perform set_config('scalers.wallet_write', '1', true);

  if v_mode not in ('off', 'soft', 'hard') then
    raise exception 'mode must be off|soft|hard';
  end if;

  -- Charging on while the subscription is still beta is refused. Status is
  -- not updated here. An admin sets it to active in the same confirmed call
  -- through admin_set_tenant_billing_mode.
  if v_mode is distinct from 'off' and exists (
    select 1
    from public.tenant_subscriptions
    where tenant_id = p_tenant_id
      and billing_status = 'beta'
  ) then
    raise exception 'billing stays off while the business is on beta';
  end if;

  update public.tenants
  set
    billing_enforcement = v_mode,
    beta_notes = case
      when v_mode = 'off' then v_note
      else beta_notes
    end,
    beta_expires_at = case
      when v_mode = 'off' then p_beta_expires_at
      else null
    end
  where id = p_tenant_id
  returning tenants.wallet_balance_kes into v_bal;

  if not found then
    raise exception 'tenant not found';
  end if;

  -- Optional: when moving to beta, wipe debt so soft-charged beta debt disappears.
  if p_waive_negative_balance and coalesce(v_bal, 0) < 0 then
    perform public._wallet_apply_delta(
      p_tenant_id,
      'trial_credit',
      abs(v_bal),
      'beta_waive',
      'waive:' || p_tenant_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISS'),
      'Beta whitelist - waived negative balance',
      jsonb_build_object('actor', v_actor)
    );
    select t.wallet_balance_kes into v_bal from public.tenants t where t.id = p_tenant_id;
  end if;

  insert into public.ops_audit_log (actor, action, tenant_id, amount_kes, detail)
  values (
    v_actor,
    'set_billing_mode',
    p_tenant_id,
    null,
    jsonb_build_object(
      'mode', v_mode,
      'note', v_note,
      'beta_expires_at', p_beta_expires_at,
      'waive_negative', p_waive_negative_balance,
      'balance_after', v_bal
    )
  );

  billing_enforcement := v_mode;
  wallet_balance_kes := coalesce(v_bal, 0);
  return next;
end;
$$;

comment on function public.set_tenant_billing_mode(uuid, text, text, text, timestamptz, boolean) is
  'Sets billing_enforcement. Refuses soft or hard while tenant_subscriptions.billing_status is beta. Does not change billing_status.';

revoke all on function public.set_tenant_billing_mode(uuid, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.set_tenant_billing_mode(uuid, text, text, text, timestamptz, boolean) to service_role;
