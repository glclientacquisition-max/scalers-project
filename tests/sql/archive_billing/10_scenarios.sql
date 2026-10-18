-- Scenarios. Each block raises on failure (ON_ERROR_STOP).
\set QUIET on

-- Fixtures ------------------------------------------------------------------
insert into public.tenants (id, business_name, sautikit_virtual_number, billing_enforcement, on_demand_usage_enabled,
                            line_paid_through, seconds_used, minutes_included, sms_used_units)
values ('00000000-0000-0000-0000-00000000000a', 'Archive Me', '+254700000001', 'soft', true, now() - interval '10 days', 1200, 300, 7),
       ('00000000-0000-0000-0000-00000000000b', 'Suspend Me', '+254700000002', 'off', false, null, 0, 300, 0),
       ('00000000-0000-0000-0000-00000000000c', 'Purge Me',   '+254700000003', 'off', false, null, 900, 300, 3),
       ('00000000-0000-0000-0000-00000000000d', 'Live Shop',  '+254700000004', 'off', false, null, 0, 300, 0);
insert into public.tenant_subscriptions (tenant_id, status, current_period_start, current_period_end)
values ('00000000-0000-0000-0000-00000000000a', 'active', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month');

-- 1. archive_tenant_billing refuses a business that is not archived ----------
do $$ begin
  perform public.archive_tenant_billing('00000000-0000-0000-0000-00000000000a', 'alvin', 'test');
  raise exception 'FAIL 1: archive_tenant_billing ran on an active business';
exception when others then
  if sqlerrm not like 'Archive the business%' then raise; end if;
end $$;

-- 2. archive: billing off, on-demand off, one audit row, idempotent ----------
update public.tenants set archived_at = now(), archived_by = 'alvin', is_active = false
 where id = '00000000-0000-0000-0000-00000000000a';
do $$
declare r record; n int;
begin
  select * into r from public.archive_tenant_billing('00000000-0000-0000-0000-00000000000a', 'alvin', 'closing');
  if not (r.changed and r.audited and r.billing_before = 'soft' and r.billing_after = 'off'
          and r.on_demand_before and not r.on_demand_after) then
    raise exception 'FAIL 2a: %', row_to_json(r);
  end if;
  select * into r from public.archive_tenant_billing('00000000-0000-0000-0000-00000000000a', 'alvin', 'closing');
  if r.changed or r.audited then raise exception 'FAIL 2b: re-run changed something: %', row_to_json(r); end if;
  select count(*) into n from public.ops_audit_log where action = 'archive_tenant_billing';
  if n <> 1 then raise exception 'FAIL 2c: % audit rows', n; end if;
  if exists (select 1 from public.tenants where id = '00000000-0000-0000-0000-00000000000a'
             and (billing_enforcement <> 'off' or on_demand_usage_enabled)) then
    raise exception 'FAIL 2d: billing still on';
  end if;
  if not exists (select 1 from public.ops_audit_log where action = 'archive_tenant_billing'
                 and detail->'before'->>'billing_enforcement' = 'soft'
                 and detail->'before'->'subscription'->>'status' = 'active') then
    raise exception 'FAIL 2e: audit row lacks the before snapshot';
  end if;
  -- counters untouched (they are the final usage record)
  if not exists (select 1 from public.tenants where id = '00000000-0000-0000-0000-00000000000a'
                 and seconds_used = 1200 and sms_used_units = 7) then
    raise exception 'FAIL 2f: counters changed';
  end if;
end $$;

-- 3. guard: archived business cannot be switched back to charging -----------
do $$ begin
  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants set billing_enforcement = 'soft' where id = '00000000-0000-0000-0000-00000000000a';
  raise exception 'FAIL 3a: billing turned on while archived';
exception when others then
  if sqlerrm not like 'This business is archived%' then raise; end if;
end $$;
do $$ begin
  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants set on_demand_usage_enabled = true where id = '00000000-0000-0000-0000-00000000000a';
  raise exception 'FAIL 3b: on-demand turned on while archived';
exception when others then
  if sqlerrm not like 'This business is archived%' then raise; end if;
end $$;
do $$ begin  -- no-op writes of the same value still pass
  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants set billing_enforcement = 'off', on_demand_usage_enabled = false
   where id = '00000000-0000-0000-0000-00000000000a';
end $$;

-- 4. line rental charges nothing while archived ------------------------------
do $$
declare r record;
begin
  select * into r from public.apply_line_rental('00000000-0000-0000-0000-00000000000a', null, 1000);
  if r.charged then raise exception 'FAIL 4: line rental charged an archived business'; end if;
  if exists (select 1 from public.wallet_ledger where tenant_id = '00000000-0000-0000-0000-00000000000a') then
    raise exception 'FAIL 4b: ledger row written';
  end if;
end $$;

-- 5. unarchive: reverse refuses while archived, restores nothing, idempotent -
do $$ begin
  perform public.unarchive_tenant_billing('00000000-0000-0000-0000-00000000000a', 'alvin', 'back');
  raise exception 'FAIL 5a: reverse ran while archived';
exception when others then
  if sqlerrm not like 'Unarchive the business%' then raise; end if;
end $$;
update public.tenants set archived_at = null, archived_by = null, is_active = true
 where id = '00000000-0000-0000-0000-00000000000a';
do $$
declare r record;
begin
  select * into r from public.unarchive_tenant_billing('00000000-0000-0000-0000-00000000000a', 'alvin', 'back');
  if not (r.audited and r.billing_enforcement = 'off' and not r.on_demand_enabled
          and r.pre_archive_billing = 'soft' and r.pre_archive_on_demand) then
    raise exception 'FAIL 5b: %', row_to_json(r);
  end if;
  select * into r from public.unarchive_tenant_billing('00000000-0000-0000-0000-00000000000a', 'alvin', 'back');
  if r.audited then raise exception 'FAIL 5c: second unarchive wrote a row'; end if;
  if r.pre_archive_billing <> 'soft' then raise exception 'FAIL 5d: lost pre-archive settings'; end if;
  if exists (select 1 from public.tenants where id = '00000000-0000-0000-0000-00000000000a'
             and (billing_enforcement <> 'off' or on_demand_usage_enabled)) then
    raise exception 'FAIL 5e: unarchive turned charging back on';
  end if;
  -- admin may now choose to turn it back on
  perform set_config('scalers.wallet_write', '1', true);
  update public.tenants set billing_enforcement = 'soft' where id = '00000000-0000-0000-0000-00000000000a';
end $$;

-- 6. a second archive is a new archive: new audit row -----------------------
update public.tenants set archived_at = now() + interval '1 second', is_active = false
 where id = '00000000-0000-0000-0000-00000000000a';
do $$
declare r record;
begin
  select * into r from public.archive_tenant_billing('00000000-0000-0000-0000-00000000000a', 'alvin', 'again');
  if not (r.changed and r.audited) then raise exception 'FAIL 6: %', row_to_json(r); end if;
end $$;

-- 7. refresh_line_status keeps an admin suspension --------------------------
do $$
declare v text;
begin
  perform public.admin_set_business_suspended('00000000-0000-0000-0000-00000000000b', true, 'alvin');
  v := public.refresh_line_status('00000000-0000-0000-0000-00000000000b');
  if v <> 'suspended' then raise exception 'FAIL 7a: refresh lifted the suspension (%)', v; end if;
  if not exists (select 1 from public.tenants where id = '00000000-0000-0000-0000-00000000000b'
                 and line_status = 'suspended' and suspended_at is not null) then
    raise exception 'FAIL 7b: row changed';
  end if;
  begin
    perform public.suspend_line_for_nonpayment('00000000-0000-0000-0000-00000000000b');
    raise exception 'FAIL 7c: non-payment suspension ran on an admin suspension';
  exception when others then
    if sqlerrm not like 'Suspended by an admin%' then raise; end if;
  end;
  perform public.admin_set_business_suspended('00000000-0000-0000-0000-00000000000b', false, 'alvin');
  v := public.refresh_line_status('00000000-0000-0000-0000-00000000000b');
  if v <> 'active' then raise exception 'FAIL 7d: restore did not reopen (%)', v; end if;
  if (select sautikit_virtual_number from public.tenants where id = '00000000-0000-0000-0000-00000000000b') <> '+254700000002' then
    raise exception 'FAIL 7e: number lost';
  end if;
end $$;

-- 8. purge keeps usage billing intact ---------------------------------------
update public.tenants set archived_at = now() - interval '40 days', is_active = false, faqs = '["x"]'
 where id = '00000000-0000-0000-0000-00000000000c';
insert into public.calls (id, tenant_id, sautikit_call_sid, created_at, duration_seconds, package_seconds_applied) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000c', 'sid-c1', '2026-08-15 10:00+03', 300, 300),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000c', 'sid-c2', '2026-09-02 10:00+03', 600, 600);
insert into public.transcripts (call_id, text_content) values ('00000000-0000-0000-0000-0000000000c1', 'hello');
insert into public.call_facts (call_id, tenant_id) values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000c');
insert into public.notify_sends (tenant_id, call_id, call_sid, kind, channel, recipient, audience, billed_to, units, body, idempotency_key, status) values
  ('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000c1', 'sid-c1', 'lead', 'sms', '+254711000000', 'caller', 'tenant', 2, 'Thanks for calling', 'k1', 'sent'),
  ('00000000-0000-0000-0000-00000000000c', null, null, 'digest', 'sms', '+254711000001', 'staff', 'tenant', 1, 'Daily digest', 'k2', 'sent');
insert into public.wallet_ledger (tenant_id, kind, amount_kes, reference_type, reference_id) values
  ('00000000-0000-0000-0000-00000000000c', 'call_charge', -12, 'call', '00000000-0000-0000-0000-0000000000c2:600');
insert into public.tenant_minute_grants (tenant_id, minutes) values ('00000000-0000-0000-0000-00000000000c', 25);
-- a live business's sends to prove the purge flag is scoped
insert into public.notify_sends (tenant_id, kind, channel, recipient, audience, billed_to, units, body, idempotency_key, status) values
  ('00000000-0000-0000-0000-00000000000d', 'lead', 'sms', '+254722000000', 'caller', 'tenant', 1, 'Live text', 'k3', 'sent');

do $$
declare n int;
begin
  -- dry run: reports, changes nothing, no errors
  select count(*) into n from public.purge_archived_tenants(30, true) where action = 'error';
  if n > 0 then raise exception 'FAIL 8a: dry run errors'; end if;
  if (select count(*) from public.calls where tenant_id = '00000000-0000-0000-0000-00000000000c') <> 2 then
    raise exception 'FAIL 8b: dry run deleted calls';
  end if;
end $$;

create temp table purge_out as select * from public.purge_archived_tenants(30, false);
do $$
declare n int; v jsonb;
begin
  if exists (select 1 from purge_out where action in ('error', 'blocked')) then
    raise exception 'FAIL 8c: purge failed: %', (select string_agg(item, '; ') from purge_out where action in ('error','blocked'));
  end if;
  -- only the archived business was touched
  if exists (select 1 from purge_out where tenant_id <> '00000000-0000-0000-0000-00000000000c') then
    raise exception 'FAIL 8d: purge touched another business';
  end if;
  if (select count(*) from public.calls where tenant_id = '00000000-0000-0000-0000-00000000000c') <> 0 then
    raise exception 'FAIL 8e: calls left';
  end if;
  -- SMS ledger kept: units, kind, billing columns intact; text, recipient, call_id blank
  select count(*) into n from public.notify_sends
   where tenant_id = '00000000-0000-0000-0000-00000000000c'
     and body is null and recipient is null and call_id is null
     and status = 'sent' and billed_to = 'tenant' and channel = 'sms';
  if n <> 2 then raise exception 'FAIL 8f: notify_sends not kept/blanked correctly (% rows)', n; end if;
  if (select sum(units) from public.notify_sends where tenant_id = '00000000-0000-0000-0000-00000000000c' and status = 'sent') <> 3 then
    raise exception 'FAIL 8g: SMS billable units changed';
  end if;
  if (select call_sid from public.notify_sends where idempotency_key = 'k1') <> 'sid-c1' then
    raise exception 'FAIL 8h: call_sid should stay';
  end if;
  -- minutes: counters on the tenant row, ledger and grants kept
  if not exists (select 1 from public.tenants where id = '00000000-0000-0000-0000-00000000000c'
                 and seconds_used = 900 and minutes_included = 300 and sms_used_units = 3 and faqs is null) then
    raise exception 'FAIL 8i: tenant counters/tombstone wrong';
  end if;
  if (select count(*) from public.wallet_ledger where tenant_id = '00000000-0000-0000-0000-00000000000c') <> 1 then
    raise exception 'FAIL 8j: wallet_ledger lost';
  end if;
  if (select count(*) from public.tenant_minute_grants where tenant_id = '00000000-0000-0000-0000-00000000000c') <> 1 then
    raise exception 'FAIL 8k: grants lost';
  end if;
  -- usage history summarised into the audit row before calls went
  select detail->'usage_by_month' into v from public.ops_audit_log
   where action = 'purge_business' and tenant_id = '00000000-0000-0000-0000-00000000000c';
  if v is null or (v->'2026-08'->>'package_seconds_applied')::int <> 300
     or (v->'2026-09'->>'duration_seconds')::int <> 600 then
    raise exception 'FAIL 8l: usage summary missing: %', v;
  end if;
  -- the purge flag does not leak: live business text still immutable
  begin
    update public.notify_sends set body = null where idempotency_key = 'k3';
    raise exception 'FAIL 8m: notify_sends edited outside the purge';
  exception when others then
    if sqlerrm <> 'notify_sends is append-only' then raise; end if;
  end;
  -- even with the flag, a live business or a non-blanking edit is refused
  perform set_config('scalers.notify_purge', '1', true);
  begin
    update public.notify_sends set body = null where idempotency_key = 'k3';
    raise exception 'FAIL 8n: purge flag edited a live business';
  exception when others then
    if sqlerrm not like 'notify_sends: purge only touches archived%' then raise; end if;
  end;
  begin
    update public.notify_sends set units = 0 where idempotency_key = 'k1';
    raise exception 'FAIL 8o: purge flag changed units';
  exception when others then
    if sqlerrm not like 'notify_sends: a purge may only blank%' then raise; end if;
  end;
  perform set_config('scalers.notify_purge', '0', true);
end $$;

-- 9. a second real purge is a no-op ------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from public.purge_archived_tenants(30, false)
   where action in ('deleted', 'cleared') and n_rows > 0 and item not like 'tenants (%';
  if n <> 0 then raise exception 'FAIL 9: second purge changed % items', n; end if;
end $$;
