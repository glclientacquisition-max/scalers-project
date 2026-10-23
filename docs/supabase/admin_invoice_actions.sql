-- Admin invoice actions (void, full credit note, dispute → pause reminders).
-- Service role only. Sets scalers.billing_write so invoices_freeze allows status changes.
-- Credit note = full remaining balance only (no partial ledger math).
-- Additive and safe to re-run. Staging first; prod only with Alvin's GO.
-- Depends on: billing_data_layer.sql (invoices, tenant_credits, invoices_freeze),
--             invoice_documents.sql (enqueue_invoice_*), ops_audit_log.

-- ---------------------------------------------------------------------------
-- 1. Dispute flag: pauses due-soon / overdue notices only.
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column if not exists reminders_paused_at timestamptz;

comment on column public.invoices.reminders_paused_at is
  'When set, enqueue_invoice_due_soon / overdue refuse. Dispute pauses reminders only.';

-- ---------------------------------------------------------------------------
-- 2. Void (single operator, reason required). Open or draft → void.
-- ---------------------------------------------------------------------------
create or replace function public.admin_void_invoice(
  p_invoice_id uuid,
  p_actor text,
  p_reason text
)
returns table (
  invoice_id uuid,
  status_before text,
  status_after text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
  v_actor text := nullif(btrim(p_actor), '');
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if p_invoice_id is null then
    raise exception 'invoice required';
  end if;
  if v_actor is null then
    raise exception 'actor required';
  end if;
  if length(v_reason) < 3 then
    raise exception 'reason required (min 3 chars)';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status in ('void', 'uncollectible') then
    invoice_id := v_inv.id;
    status_before := v_inv.status;
    status_after := v_inv.status;
    return next;
    return;
  end if;
  if v_inv.status not in ('open', 'draft') then
    raise exception 'only open or draft invoices can be voided';
  end if;

  perform set_config('scalers.billing_write', '1', true);
  update public.invoices
  set status = 'void'
  where id = v_inv.id;
  perform set_config('scalers.billing_write', '', true);

  insert into public.ops_audit_log (actor, action, tenant_id, detail)
  values (
    v_actor,
    'void_invoice',
    v_inv.tenant_id,
    jsonb_build_object(
      'invoice_id', v_inv.id,
      'invoice_number', v_inv.invoice_number,
      'reason', v_reason,
      'before', v_inv.status,
      'after', 'void'
    )
  );

  invoice_id := v_inv.id;
  status_before := v_inv.status;
  status_after := 'void';
  return next;
end;
$$;

revoke all on function public.admin_void_invoice(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_void_invoice(uuid, text, text) to service_role;

comment on function public.admin_void_invoice(uuid, text, text) is
  'Super Admin void. One operator, reason ≥ 3 chars, no second approver. Idempotent when already void.';

-- ---------------------------------------------------------------------------
-- 3. Credit note = full remaining balance → tenant_credits + void.
-- ---------------------------------------------------------------------------
create or replace function public.admin_issue_credit_note(
  p_invoice_id uuid,
  p_actor text,
  p_reason text
)
returns table (
  invoice_id uuid,
  credit_kes numeric,
  status_after text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
  v_actor text := nullif(btrim(p_actor), '');
  v_reason text := btrim(coalesce(p_reason, ''));
  v_balance numeric;
  v_key text;
begin
  if p_invoice_id is null then
    raise exception 'invoice required';
  end if;
  if v_actor is null then
    raise exception 'actor required';
  end if;
  if length(v_reason) < 3 then
    raise exception 'reason required (min 3 chars)';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status <> 'open' then
    raise exception 'credit notes are for open invoices only';
  end if;

  v_balance := greatest(coalesce(v_inv.total_kes, 0) - coalesce(v_inv.amount_paid_kes, 0), 0);
  if v_balance <= 0 then
    raise exception 'nothing left to credit on this invoice';
  end if;

  v_key := 'credit-note:' || v_inv.id::text;
  insert into public.tenant_credits (tenant_id, amount_kes, reason, idempotency_key)
  values (v_inv.tenant_id, v_balance, 'credit_note:' || coalesce(v_inv.invoice_number, v_inv.id::text), v_key)
  on conflict (idempotency_key) do nothing;

  perform set_config('scalers.billing_write', '1', true);
  update public.invoices
  set status = 'void'
  where id = v_inv.id;
  perform set_config('scalers.billing_write', '', true);

  insert into public.ops_audit_log (actor, action, tenant_id, detail)
  values (
    v_actor,
    'credit_note',
    v_inv.tenant_id,
    jsonb_build_object(
      'invoice_id', v_inv.id,
      'invoice_number', v_inv.invoice_number,
      'reason', v_reason,
      'credit_kes', v_balance,
      'after', 'void'
    )
  );

  invoice_id := v_inv.id;
  credit_kes := v_balance;
  status_after := 'void';
  return next;
end;
$$;

revoke all on function public.admin_issue_credit_note(uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_issue_credit_note(uuid, text, text) to service_role;

comment on function public.admin_issue_credit_note(uuid, text, text) is
  'Full-balance credit note: one tenant_credits row (credit-note:<id>) and void. No partial amounts.';

-- ---------------------------------------------------------------------------
-- 4. Dispute ↔ pause reminders only (does not void or change money).
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_invoice_dispute(
  p_invoice_id uuid,
  p_paused boolean,
  p_actor text,
  p_reason text
)
returns table (
  invoice_id uuid,
  reminders_paused_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
  v_actor text := nullif(btrim(p_actor), '');
  v_reason text := btrim(coalesce(p_reason, ''));
  v_at timestamptz;
begin
  if p_invoice_id is null then
    raise exception 'invoice required';
  end if;
  if v_actor is null then
    raise exception 'actor required';
  end if;
  if length(v_reason) < 3 then
    raise exception 'reason required (min 3 chars)';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status <> 'open' then
    raise exception 'only an open invoice can be marked disputed';
  end if;

  v_at := case when p_paused then coalesce(v_inv.reminders_paused_at, now()) else null end;

  -- reminders_paused_at is not frozen by invoices_freeze (status/number only for drafts;
  -- other columns still hit the freeze on non-draft). Use billing_write.
  perform set_config('scalers.billing_write', '1', true);
  update public.invoices
  set reminders_paused_at = v_at
  where id = v_inv.id;
  perform set_config('scalers.billing_write', '', true);

  insert into public.ops_audit_log (actor, action, tenant_id, detail)
  values (
    v_actor,
    case when p_paused then 'dispute_invoice' else 'clear_invoice_dispute' end,
    v_inv.tenant_id,
    jsonb_build_object(
      'invoice_id', v_inv.id,
      'invoice_number', v_inv.invoice_number,
      'reason', v_reason,
      'reminders_paused_at', v_at
    )
  );

  invoice_id := v_inv.id;
  reminders_paused_at := v_at;
  return next;
end;
$$;

revoke all on function public.admin_set_invoice_dispute(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.admin_set_invoice_dispute(uuid, boolean, text, text) to service_role;

comment on function public.admin_set_invoice_dispute(uuid, boolean, text, text) is
  'Dispute pauses due-soon/overdue enqueue only. Does not void or move money.';

-- ---------------------------------------------------------------------------
-- 5. Reminders skip disputed invoices.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_invoice_due_soon(p_invoice_id uuid)
returns public.billing_notices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
  v_body text;
begin
  select * into v_inv from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status <> 'open' then
    raise exception 'only an open invoice can be reminded';
  end if;
  if v_inv.reminders_paused_at is not null then
    raise exception 'reminders paused (disputed)';
  end if;
  v_body := 'Your Business Assistant invoice ' || coalesce(v_inv.invoice_number, '')
    || ' for KSh ' || trim(to_char(v_inv.total_kes, 'FM999999990.00')) || ' is due soon.';
  return public.enqueue_billing_notice(
    v_inv.tenant_id,
    'platform_billing_invoice_due_soon',
    'platform_billing_invoice_due_soon:' || v_inv.id::text,
    'Invoice due soon',
    v_body
  );
end;
$$;

create or replace function public.enqueue_invoice_overdue(p_invoice_id uuid)
returns public.billing_notices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
  v_body text;
begin
  select * into v_inv from public.invoices where id = p_invoice_id;
  if not found then
    raise exception 'invoice not found';
  end if;
  if v_inv.status <> 'open' then
    raise exception 'only an open invoice can be reminded';
  end if;
  if v_inv.reminders_paused_at is not null then
    raise exception 'reminders paused (disputed)';
  end if;
  v_body := 'Your Business Assistant invoice ' || coalesce(v_inv.invoice_number, '')
    || ' for KSh ' || trim(to_char(v_inv.total_kes, 'FM999999990.00')) || ' is overdue.';
  return public.enqueue_billing_notice(
    v_inv.tenant_id,
    'platform_billing_invoice_overdue',
    'platform_billing_invoice_overdue:' || v_inv.id::text,
    'Invoice overdue',
    v_body
  );
end;
$$;
