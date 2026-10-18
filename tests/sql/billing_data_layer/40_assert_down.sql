do $$
begin
  if to_regclass('public.invoices') is not null then
    raise exception 'down left invoices';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tenant_subscriptions'
      and column_name = 'billing_status'
  ) then
    raise exception 'down left billing_status';
  end if;
  if to_regprocedure('public.finalize_invoice(uuid)') is not null then
    raise exception 'down left finalize_invoice';
  end if;
end $$;
