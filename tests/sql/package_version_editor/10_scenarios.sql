\set ON_ERROR_STOP 1

-- Fixture prices below (1111, 2222) are not Scalers prices. They exist only in this throwaway database.

create or replace function pg_temp.feature_patch(p_off text)
returns jsonb
language sql
as $$
  select jsonb_agg(
    jsonb_build_object(
      'key', f.key,
      'enabled', case when f.key = p_off then false else true end
    )
    order by f.key
  )
  from public.billing_features f
$$;

create or replace function pg_temp.version_patch(p_id uuid, p_over jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'monthly_price_kes', v.monthly_price_kes,
    'seats', v.seats,
    'minutes', v.minutes,
    'sms', v.sms,
    'email', v.email,
    'staff_wa', v.staff_wa,
    'dids', v.dids,
    'inbound_kes_per_second', v.inbound_kes_per_second,
    'outbound_kes_per_second', v.outbound_kes_per_second,
    'whatsapp_kes', v.whatsapp_kes,
    'sms_kes', v.sms_kes,
    'email_kes', v.email_kes,
    'annual_discount_percent', v.annual_discount_percent,
    'trial_days', v.trial_days,
    'allowances_placeholder', v.allowances_placeholder,
    'features', pg_temp.feature_patch(null)
  ) || coalesce(p_over, '{}'::jsonb)
  from public.billing_package_versions v
  where v.id = p_id
$$;

-- Catalogue still matches the seeded versions. The editor did not invent a price.
do $$
declare
  v_list jsonb;
  v_starter numeric;
  v_trial_minutes integer;
  v_trial_days integer;
  v_placeholder boolean;
begin
  v_list := public.admin_list_package_versions();
  if v_list ->> 'package_editor_enabled' <> 'true' then
    raise exception 'editor should be on';
  end if;
  if v_list -> 'price_change_approval_threshold_kes' <> 'null'::jsonb then
    raise exception 'approval threshold should start unset';
  end if;
  select (ver ->> 'monthly_price_kes')::numeric into v_starter
  from jsonb_array_elements(v_list -> 'packages') pkg
  cross join lateral jsonb_array_elements(pkg -> 'versions') ver
  where pkg ->> 'sku' = 'starter' and (ver ->> 'version')::int = 1;
  if v_starter <> 5000 then
    raise exception 'list changed the starter price';
  end if;
  select (ver ->> 'minutes')::int, (ver ->> 'trial_days')::int, (ver ->> 'allowances_placeholder')::boolean
    into v_trial_minutes, v_trial_days, v_placeholder
  from jsonb_array_elements(v_list -> 'packages') pkg
  cross join lateral jsonb_array_elements(pkg -> 'versions') ver
  where pkg ->> 'sku' = 'trial' and (ver ->> 'version')::int = 1;
  if v_trial_minutes <> 20 or v_trial_days <> 14 or not v_placeholder then
    raise exception 'trial v1 was not left as 20 minutes, 14 days, placeholders';
  end if;
  if (select is_active from public.billing_packages where sku = 'trial') then
    raise exception 'trial must stay off the public catalogue';
  end if;
end $$;

-- The only published version cannot be archived. A blank reason is refused.
do $$
declare
  v_id uuid;
  v_audits int;
begin
  select v.id into v_id
  from public.billing_package_versions v
  join public.billing_packages p on p.id = v.package_id
  where p.sku = 'starter' and v.version = 1;
  select count(*) into v_audits from public.billing_audit_log;
  begin
    perform public.admin_archive_package_version(v_id, 'ada', 'retire the only one');
    raise exception 'archiving the only version should have failed';
  exception when others then
    if sqlerrm not like '%only published version%' then raise; end if;
  end;
  begin
    perform public.admin_draft_package_version('starter', 'ada', '   ');
    raise exception 'blank reason should have failed';
  exception when others then
    if sqlerrm not like '%reason is required%' then raise; end if;
  end;
  if (select count(*) from public.billing_audit_log) <> v_audits then
    raise exception 'a refused change wrote an audit row';
  end if;
end $$;

-- Signed-in owners and anon cannot call the editor.
do $$
begin
  begin
    execute 'set local role authenticated';
    perform public.admin_draft_package_version('starter', 'ada', 'should fail');
    raise exception 'authenticated should have been refused';
  exception when insufficient_privilege then
    null;
  end;
end $$;

do $$
begin
  begin
    execute 'set local role anon';
    perform public.admin_list_package_versions();
    raise exception 'anon should have been refused';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- Draft copies the current version. Edit allowances and one feature. Publish.
-- Existing subscribers stay. A new subscriber pins to the published version.
do $$
declare
  v_draft uuid;
  v_legacy int;
  v_new int;
  v_minutes int;
  v_seconds int;
  v_enf text;
  v_status text;
  v_vm timestamptz;
  v_bookings boolean;
  v_v1_bookings boolean;
begin
  v_draft := (public.admin_draft_package_version('starter', 'ada', 'open a starter draft')) ->> 'version_id';
  if (select monthly_price_kes from public.billing_package_versions where id = v_draft::uuid) <> 5000
     or (select minutes from public.billing_package_versions where id = v_draft::uuid) <> 300
  then
    raise exception 'draft did not copy the current starter version';
  end if;
  begin
    perform public.admin_draft_package_version('starter', 'ada', 'a second draft');
    raise exception 'a second draft should have failed';
  exception when others then
    if sqlerrm not like '%draft already exists%' then raise; end if;
  end;
  begin
    perform public.admin_update_package_version_draft(
      v_draft::uuid,
      pg_temp.version_patch(v_draft::uuid, '{"minutes": -1}'::jsonb),
      'ada',
      'negative minutes'
    );
    raise exception 'negative minutes should have failed';
  exception when others then
    if sqlerrm not like '%zero or more%' then raise; end if;
  end;
  if (select minutes from public.billing_package_versions where id = v_draft::uuid) <> 300 then
    raise exception 'failed edit changed the draft';
  end if;
  perform public.admin_update_package_version_draft(
    v_draft::uuid,
    pg_temp.version_patch(
      v_draft::uuid,
      jsonb_build_object('minutes', 301, 'features', pg_temp.feature_patch('bookings'))
    ),
    'ada',
    'one more minute and bookings off'
  );
  perform public.admin_publish_package_version(v_draft::uuid, now(), 'ada', 'publish starter');

  select v.version, t.minutes_included, t.seconds_used, t.billing_enforcement, s.billing_status, s.voicemail_until
    into v_legacy, v_minutes, v_seconds, v_enf, v_status, v_vm
  from public.tenant_subscriptions s
  join public.tenants t on t.id = s.tenant_id
  join public.billing_package_versions v on v.id = s.package_version_id
  where s.tenant_id = '11111111-1111-1111-1111-111111111111';
  if v_legacy <> 1 or v_minutes <> 300 or v_seconds <> 10 or v_enf <> 'off' or v_status <> 'beta' or v_vm is not null then
    raise exception 'publish moved or altered the grandfathered business';
  end if;

  select f.enabled into v_bookings
  from public.billing_package_version_features f
  where f.package_version_id = v_draft::uuid and f.feature_key = 'bookings';
  select f.enabled into v_v1_bookings
  from public.billing_package_version_features f
  join public.billing_package_versions v on v.id = f.package_version_id
  join public.billing_packages p on p.id = v.package_id
  where p.sku = 'starter' and v.version = 1 and f.feature_key = 'bookings';
  if v_bookings or not v_v1_bookings then
    raise exception 'feature edit leaked onto the published v1 or did not stick on v2';
  end if;

  begin
    update public.billing_package_versions set monthly_price_kes = 1 where id = v_draft::uuid;
    raise exception 'published price update should have failed';
  exception when others then
    if sqlerrm not like '%frozen%' then raise; end if;
  end;
  begin
    update public.billing_package_version_features
    set enabled = true
    where package_version_id = v_draft::uuid and feature_key = 'bookings';
    raise exception 'published feature update should have failed';
  exception when others then
    if sqlerrm not like '%frozen%' then raise; end if;
  end;

  insert into public.tenants (
    id, business_name, sautikit_virtual_number, minutes_included, whatsapp_notification_number
  ) values (
    '99999999-9999-9999-9999-999999999991',
    'New After Publish',
    'pending:99999999-9999-9999-9999-999999999991',
    300,
    '+254700000091'
  );
  insert into public.tenant_subscriptions (tenant_id, package_id, status)
  select '99999999-9999-9999-9999-999999999991', id, 'active'
  from public.billing_packages where sku = 'starter';
  select v.version into v_new
  from public.tenant_subscriptions s
  join public.billing_package_versions v on v.id = s.package_version_id
  where s.tenant_id = '99999999-9999-9999-9999-999999999991';
  if v_new <> 2 then
    raise exception 'new subscription should pin to starter v2, got %', v_new;
  end if;
end $$;

-- A version dated in the future is not what new subscribers get.
-- Archiving it does not move anyone. An explicit move does, and only those businesses.
do $$
declare
  v_draft uuid;
  v_legacy int;
  v_other int;
  v_new int;
  v_moved_version int;
begin
  v_draft := (public.admin_draft_package_version('starter', 'ada', 'a later starter')) ->> 'version_id';
  perform public.admin_publish_package_version(
    v_draft::uuid,
    now() + interval '30 days',
    'ada',
    'publish later'
  );
  insert into public.tenants (
    id, business_name, sautikit_virtual_number, minutes_included, whatsapp_notification_number
  ) values (
    '99999999-9999-9999-9999-999999999992',
    'Before The Later Version',
    'pending:99999999-9999-9999-9999-999999999992',
    300,
    '+254700000092'
  );
  insert into public.tenant_subscriptions (tenant_id, package_id, status)
  select '99999999-9999-9999-9999-999999999992', id, 'active'
  from public.billing_packages where sku = 'starter';
  select v.version into v_new
  from public.tenant_subscriptions s
  join public.billing_package_versions v on v.id = s.package_version_id
  where s.tenant_id = '99999999-9999-9999-9999-999999999992';
  if v_new <> 2 then
    raise exception 'a future version should not be the one new subscribers get, got %', v_new;
  end if;

  perform public.admin_move_subscribers_to_package_version(
    (select v.id from public.billing_package_versions v
      join public.billing_packages p on p.id = v.package_id
      where p.sku = 'starter' and v.version = 2),
    array['11111111-1111-1111-1111-111111111111']::uuid[],
    'ada',
    'move one grandfathered business'
  );
  select v.version into v_moved_version
  from public.tenant_subscriptions s
  join public.billing_package_versions v on v.id = s.package_version_id
  where s.tenant_id = '11111111-1111-1111-1111-111111111111';
  select v.version into v_other
  from public.tenant_subscriptions s
  join public.billing_package_versions v on v.id = s.package_version_id
  where s.tenant_id = '22222222-2222-2222-2222-222222222222';
  if v_moved_version <> 2 or v_other <> 1 then
    raise exception 'move should have changed one business only (% %)', v_moved_version, v_other;
  end if;
  if (select billing_status from public.tenant_subscriptions where tenant_id = '11111111-1111-1111-1111-111111111111') <> 'beta'
     or (select minutes_included from public.tenants where id = '11111111-1111-1111-1111-111111111111') <> 300
     or (select billing_enforcement from public.tenants where id = '11111111-1111-1111-1111-111111111111') <> 'off'
  then
    raise exception 'move changed billing status, minutes, or enforcement';
  end if;
  begin
    update public.tenant_subscriptions
    set package_version_id = (
      select v.id from public.billing_package_versions v
      join public.billing_packages p on p.id = v.package_id
      where p.sku = 'starter' and v.version = 2
    )
    where tenant_id = '22222222-2222-2222-2222-222222222222';
    raise exception 'direct version change should have failed';
  exception when others then
    if sqlerrm not like '%pinned%' then raise; end if;
  end;

  perform public.admin_archive_package_version(v_draft::uuid, 'ada', 'archive the later version');
  select v.version into v_legacy
  from public.tenant_subscriptions s
  join public.billing_package_versions v on v.id = s.package_version_id
  where s.tenant_id = '11111111-1111-1111-1111-111111111111';
  if v_legacy <> 2 or (select status from public.billing_package_versions where id = v_draft::uuid) <> 'retired' then
    raise exception 'archive moved a subscriber or did not retire the version';
  end if;
end $$;

-- Trial is edited the same way. v1 stays 20 minutes and 14 days.
do $$
declare
  v_draft uuid;
  v_id uuid;
begin
  v_draft := (public.admin_draft_package_version('trial', 'ada', 'open the trial draft')) ->> 'version_id';
  if (select minutes from public.billing_package_versions where id = v_draft::uuid) <> 20
     or (select trial_days from public.billing_package_versions where id = v_draft::uuid) <> 14
     or (select sms from public.billing_package_versions where id = v_draft::uuid) <> 20
     or (select email from public.billing_package_versions where id = v_draft::uuid) <> 30
     or not (select allowances_placeholder from public.billing_package_versions where id = v_draft::uuid)
     or (select monthly_price_kes from public.billing_package_versions where id = v_draft::uuid) <> 0
  then
    raise exception 'trial draft did not copy 20 minutes, 14 days, and the placeholders';
  end if;
  begin
    perform public.admin_update_package_version_draft(
      v_draft::uuid,
      pg_temp.version_patch(v_draft::uuid, '{"trial_days": null}'::jsonb),
      'ada',
      'clear the trial length'
    );
    raise exception 'a trial version needs a length';
  exception when others then
    if sqlerrm not like '%trial length%' then raise; end if;
  end;
  perform public.admin_update_package_version_draft(
    v_draft::uuid,
    pg_temp.version_patch(v_draft::uuid, '{"trial_days": 10}'::jsonb),
    'ada',
    'fixture trial length'
  );
  perform public.admin_publish_package_version(v_draft::uuid, now(), 'ada', 'publish trial fixture');
  select v.id into v_id
  from public.billing_package_versions v
  join public.billing_packages p on p.id = v.package_id
  where p.sku = 'trial' and v.version = 1;
  if (select minutes from public.billing_package_versions where id = v_id) <> 20
     or (select trial_days from public.billing_package_versions where id = v_id) <> 14
  then
    raise exception 'publishing a trial draft changed trial v1';
  end if;
  if exists (select 1 from public.tenant_subscriptions where package_version_id = v_draft::uuid) then
    raise exception 'trial publish pinned a subscriber';
  end if;
end $$;

-- A non-trial version cannot grow a trial length.
do $$
declare
  v_draft uuid;
begin
  v_draft := (public.admin_draft_package_version('scale', 'ada', 'scale draft')) ->> 'version_id';
  begin
    perform public.admin_update_package_version_draft(
      v_draft::uuid,
      pg_temp.version_patch(v_draft::uuid, '{"trial_days": 14}'::jsonb),
      'ada',
      'scale is not a trial'
    );
    raise exception 'scale should not take a trial length';
  exception when others then
    if sqlerrm not like '%only a trial%' then raise; end if;
  end;
  perform public.admin_discard_package_version_draft(v_draft::uuid, 'ada', 'drop the scale draft');
  if exists (select 1 from public.billing_package_versions where id = v_draft::uuid) then
    raise exception 'discard left the draft in place';
  end if;
end $$;

-- Price move above the threshold needs a different admin. The publisher cannot approve it.
-- 1111 is a fixture, not a price.
do $$
declare
  v_draft uuid;
  v_starter int;
begin
  perform public.admin_set_price_approval_threshold(100, 'ada', 'turn the second admin on');
  v_draft := (public.admin_draft_package_version('growth', 'ada', 'growth draft')) ->> 'version_id';
  perform public.admin_update_package_version_draft(
    v_draft::uuid,
    pg_temp.version_patch(v_draft::uuid, '{"monthly_price_kes": 1111}'::jsonb),
    'ada',
    'fixture price'
  );
  begin
    perform public.admin_publish_package_version(v_draft::uuid, now(), 'ada', 'publish without approval');
    raise exception 'price change should have needed a second admin';
  exception when others then
    if sqlerrm not like '%second admin%' then raise; end if;
  end;
  if (select status from public.billing_package_versions where id = v_draft::uuid) <> 'draft' then
    raise exception 'refused publish still published the draft';
  end if;
  begin
    perform public.admin_approve_package_version(v_draft::uuid, 'ada', 'approve my own price');
    raise exception 'the price setter should not approve';
  exception when others then
    if sqlerrm not like '%your own price%' then raise; end if;
  end;
  perform public.admin_approve_package_version(v_draft::uuid, 'bao', 'second admin');
  begin
    perform public.admin_publish_package_version(v_draft::uuid, now(), 'bao', 'approver publishes');
    raise exception 'the approver should not be the publisher';
  exception when others then
    if sqlerrm not like '%second admin%' then raise; end if;
  end;
  perform public.admin_publish_package_version(v_draft::uuid, now(), 'ada', 'publish after approval');
  if (select monthly_price_kes from public.billing_package_versions where id = v_draft::uuid) <> 1111
     or (select status from public.billing_package_versions where id = v_draft::uuid) <> 'published'
  then
    raise exception 'approved publish did not keep the fixture price';
  end if;
  select v.version into v_starter
  from public.tenant_subscriptions s
  join public.billing_package_versions v on v.id = s.package_version_id
  where s.tenant_id = '22222222-2222-2222-2222-222222222222';
  if v_starter <> 1 then
    raise exception 'a growth publish moved a starter subscriber';
  end if;
  -- A rate change also needs the second admin while the threshold is set.
  v_draft := (public.admin_draft_package_version('growth', 'ada', 'rate draft')) ->> 'version_id';
  perform public.admin_update_package_version_draft(
    v_draft::uuid,
    pg_temp.version_patch(v_draft::uuid, '{"sms_kes": 9}'::jsonb),
    'ada',
    'fixture sms rate'
  );
  begin
    perform public.admin_publish_package_version(v_draft::uuid, now(), 'ada', 'publish the rate');
    raise exception 'a rate change should have needed a second admin';
  exception when others then
    if sqlerrm not like '%second admin%' then raise; end if;
  end;
  perform public.admin_discard_package_version_draft(v_draft::uuid, 'ada', 'drop the rate draft');
end $$;

-- Threshold off: a price change publishes with one admin. 2222 is a fixture, not a price.
do $$
declare
  v_draft uuid;
begin
  perform public.admin_set_price_approval_threshold(null, 'ada', 'turn the second admin off');
  v_draft := (public.admin_draft_package_version('scale', 'ada', 'scale price draft')) ->> 'version_id';
  perform public.admin_update_package_version_draft(
    v_draft::uuid,
    pg_temp.version_patch(v_draft::uuid, '{"monthly_price_kes": 2222}'::jsonb),
    'ada',
    'fixture scale price'
  );
  perform public.admin_publish_package_version(v_draft::uuid, now(), 'ada', 'publish with no second admin');
  if (select status from public.billing_package_versions where id = v_draft::uuid) <> 'published' then
    raise exception 'threshold off should still publish';
  end if;
end $$;

-- Audit rows name the actor and the reason, in both logs.
do $$
begin
  if not exists (
    select 1 from public.billing_audit_log
    where action = 'draft_package_version'
      and actor = 'ada'
      and detail ->> 'reason' = 'open a starter draft'
      and detail ->> 'package_sku' = 'starter'
  ) then
    raise exception 'draft audit row missing';
  end if;
  if not exists (
    select 1 from public.ops_audit_log
    where action = 'publish_package_version'
      and actor = 'ada'
      and detail ->> 'reason' = 'publish starter'
  ) then
    raise exception 'publish did not reach the ops audit log';
  end if;
  if not exists (
    select 1 from public.billing_audit_log
    where action = 'move_package_version'
      and actor = 'ada'
      and tenant_id = '11111111-1111-1111-1111-111111111111'
      and detail ->> 'reason' = 'move one grandfathered business'
      and detail -> 'before' ->> 'package_version_id' is not null
      and detail -> 'after' ->> 'package_version_id' is not null
  ) then
    raise exception 'move audit row missing';
  end if;
  if not exists (
    select 1 from public.billing_audit_log
    where action = 'approve_package_version' and actor = 'bao' and detail ->> 'reason' = 'second admin'
  ) then
    raise exception 'approval audit row missing';
  end if;
end $$;

-- Promote copies a published version and does not move subscribers.
-- A second import of the same file returns the same row.
-- The editor can be off. This still does not touch production.
do $$
declare
  v_payload jsonb;
  v_first uuid;
  v_second uuid;
  v_legacy int;
  v_on int;
begin
  select public.admin_export_package_version(v.id) into v_payload
  from public.billing_package_versions v
  join public.billing_packages p on p.id = v.package_id
  where p.sku = 'starter' and v.version = 1;
  v_payload := v_payload || jsonb_build_object('source_project_ref', 'sgcdncjxauhsbunobmob');
  update public.billing_lifecycle_settings set package_editor_enabled = false where id = 1;
  begin
    perform public.admin_draft_package_version('starter', 'ada', 'editor is off');
    raise exception 'editor off should refuse a draft';
  exception when others then
    if sqlerrm not like '%editor is off%' then raise; end if;
  end;
  v_first := (public.admin_import_promoted_package_version(
    v_payload, 'ada', 'promote starter v1 onto this database'
  )) ->> 'version_id';
  v_second := (public.admin_import_promoted_package_version(
    v_payload, 'ada', 'promote starter v1 again'
  )) ->> 'version_id';
  if v_first is distinct from v_second then
    raise exception 'a second promote created another version';
  end if;
  if (select monthly_price_kes from public.billing_package_versions where id = v_first::uuid) <> 5000
     or (select minutes from public.billing_package_versions where id = v_first::uuid) <> 300
     or (select status from public.billing_package_versions where id = v_first::uuid) <> 'published'
  then
    raise exception 'promoted version did not keep the exported terms';
  end if;
  select v.version into v_legacy
  from public.tenant_subscriptions s
  join public.billing_package_versions v on v.id = s.package_version_id
  where s.tenant_id = '22222222-2222-2222-2222-222222222222';
  if v_legacy <> 1 then
    raise exception 'promote moved a subscriber';
  end if;
  select count(*) into v_on
  from public.tenant_subscriptions
  where package_version_id = v_first::uuid;
  if v_on <> 0 then
    raise exception 'promote pinned a subscriber';
  end if;
  if not exists (
    select 1 from public.billing_audit_log
    where action = 'promote_package_version'
      and actor = 'ada'
      and detail ->> 'reason' = 'promote starter v1 onto this database'
      and detail ->> 'source_project_ref' = 'sgcdncjxauhsbunobmob'
  ) then
    raise exception 'promote audit row missing';
  end if;
  update public.billing_lifecycle_settings set package_editor_enabled = true where id = 1;
end $$;
