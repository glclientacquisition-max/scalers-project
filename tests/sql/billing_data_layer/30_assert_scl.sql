do $$
begin
  if pg_get_functiondef('public.finalize_invoice(uuid)'::regprocedure) not like '%SCL- stand-in%' then
    raise exception 're-apply replaced SCL finalize_invoice';
  end if;
end $$;
