\set ON_ERROR_STOP 1
do $$
declare r record;
begin
  select seconds_used, sms_used_units into r from tenants where id = 'df4ad9d8-28ff-4810-b1e6-94f5495472b0';
  if r.seconds_used <> 792 or r.sms_used_units <> 3 then
    raise exception 'FAIL D&D reconcile: seconds %, sms % (want 792, 3)', r.seconds_used, r.sms_used_units;
  end if;
  if (select count(*) from ops_audit_log where action = 'usage_counter_reconcile') <> 1 then
    raise exception 'FAIL D&D reconcile: want exactly one audit row after two runs';
  end if;
  select detail into r from ops_audit_log where action = 'usage_counter_reconcile';
  raise notice 'D&D reconcile: ok (two runs, one audit row) %', r.detail->'after';
end $$;
