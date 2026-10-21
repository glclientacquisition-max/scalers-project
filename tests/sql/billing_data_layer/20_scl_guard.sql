-- Stand-in whose body contains SCL- numbering. A re-apply of
-- billing_data_layer.sql must leave this function in place.
create or replace function public.finalize_invoice(p_invoice_id uuid)
returns public.invoices
language plpgsql
as $$
begin
  raise exception 'SCL- stand-in';
end
$$;
