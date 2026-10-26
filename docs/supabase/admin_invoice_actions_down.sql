-- Undo for admin_invoice_actions.sql.
-- Restores enqueue_invoice_due_soon / enqueue_invoice_overdue to the prod definitions
-- captured 2026-10-25 (no dispute pause check), then drops the admin invoice action
-- functions and invoices.reminders_paused_at. Run in one transaction.
-- Note: dropping reminders_paused_at clears any dispute flags. Credit notes already
-- issued stay in tenant_credits and voided invoices stay void.

begin;

CREATE OR REPLACE FUNCTION public.enqueue_invoice_due_soon(p_invoice_id uuid)
 RETURNS billing_notices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_invoice_overdue(p_invoice_id uuid)
 RETURNS billing_notices
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

revoke all on function public.enqueue_invoice_due_soon(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_invoice_due_soon(uuid) to service_role;
revoke all on function public.enqueue_invoice_overdue(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_invoice_overdue(uuid) to service_role;

drop function if exists public.admin_void_invoice(uuid, text, text);
drop function if exists public.admin_issue_credit_note(uuid, text, text);
drop function if exists public.admin_set_invoice_dispute(uuid, boolean, text, text);

alter table public.invoices drop column if exists reminders_paused_at;

commit;
