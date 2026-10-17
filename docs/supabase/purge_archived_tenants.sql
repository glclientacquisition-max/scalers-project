-- Scheduled purge of businesses archived longer than the restore window.
--
-- purge_archived_tenants(p_days, p_dry_run default true, p_tenant_id default null)
-- returns one row per (business, item) with the row count (n_rows) and what happens:
--   would_delete / deleted   rows removed
--   would_clear  / cleared   values blanked on rows we keep
--   keep                     kept on purpose (billing, usage, audit, tombstone)
--   blocked                  recordings still in storage; the business is skipped
--   error                    this business failed and was rolled back; others go on
--
-- Who is purged: archived_at is set, is_active = false, and archived_at is older
-- than p_days. A real run needs p_days >= 30 (ARCHIVE_RESTORE_DAYS in
-- dashboard/src/lib/adminBusinessModel.ts). A dry run may use any p_days >= 0,
-- so a fresh archive can be previewed.
--
-- Deleted: calls (transcripts and call facts cascade), voice traces, contacts
-- and caller files, appointments, service requests, pending invites, playbook
-- and business facts (field meta and history, spoken catalogue versions,
-- staff names, price history, data quality snapshots, memory runs).
-- Cleared: playbook columns on the tenant row; message text and recipient on
-- notify_sends (units, kind and billing columns stay for usage billing).
-- Kept: the tenant row (tombstone: name, archive date, package and billing
-- columns), wallet_ledger, tenant_subscriptions, tenant_minute_grants,
-- notify_sends rows, ops_audit_log, tenant_members (login stays blocked because
-- the business stays archived), sautikit_did_pool.
--
-- Recordings: the call-recordings bucket stores <call sid>/<recording>.mp3.
-- Supabase blocks deleting storage objects from SQL (protect_objects_delete),
-- so the app must delete them through the Storage API first
-- (archived_tenant_recording_objects lists them). A real run skips any business
-- whose recordings are still there, so call rows are never deleted ahead of
-- their audio.
--
-- Usage billing after a purge (ops-billing audit, 17 Oct 2026):
--   Nothing that bills reads old calls. Minutes bill from tenants.seconds_used /
--   minutes_included (counters on the kept tenant row) and wallet_ledger;
--   SMS bills from notify_sends (notify_sms_billable, PR #647); grants and
--   subscriptions are kept; tenant_billing_state (PR #650) reads none of calls.
--   consume_call_seconds / charge_call_to_wallet look up one live call by id, so
--   a late retry for a purged call fails with "call not found" and charges nothing.
--   Calls are the only per-month minute history, so before deleting them the
--   purge writes a per-month summary (calls, duration_seconds,
--   package_seconds_applied) and the tenant's counters into its audit row.
--
-- notify_sends is append-only (notify_sends_deny_mutation). Deleting calls sets
-- notify_sends.call_id to null (FK on delete set null) and the purge blanks body
-- and recipient; both are UPDATEs the trigger used to refuse, so every business
-- with any notify_sends row failed with 'error'. The trigger below allows exactly
-- that (body, recipient, call_id to null; nothing else; archived businesses only)
-- while scalers.notify_purge = '1', which only this function sets.
--
-- Every real purge writes one ops_audit_log row per business (actor 'purge').
-- Missing tables or columns are skipped, so this runs on prod and staging.
-- Never touches a business that is not archived.
--
-- Apply: staging only for now. Prod needs Alvin's GO. Schedule lives in
-- purge_archived_tenants_schedule.sql and is not applied anywhere.

-- ---------------------------------------------------------------------------
-- notify_sends stays append-only. Two narrow exceptions:
--   scalers.notify_settle = '1'  settle / re-arm inside the PR #647 RPCs
--                                (same text as notify_send_reserve_settle.sql);
--   scalers.notify_purge  = '1'  purge_archived_tenants: body, recipient and
--                                call_id may become null, nothing else, and only
--                                for an archived business.
-- Keep this function identical in notify_send_reserve_settle.sql (#647).
-- ---------------------------------------------------------------------------
create or replace function public.notify_sends_deny_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and current_setting('scalers.notify_purge', true) = '1' then
    if (to_jsonb(new) - array['body', 'recipient', 'call_id'])
         is distinct from (to_jsonb(old) - array['body', 'recipient', 'call_id'])
      or (new.body is not null and new.body is distinct from old.body)
      or (new.recipient is not null and new.recipient is distinct from old.recipient)
      or (new.call_id is not null and new.call_id is distinct from old.call_id)
    then
      raise exception 'notify_sends: a purge may only blank body, recipient and call_id';
    end if;
    if not exists (select 1 from public.tenants t
                   where t.id = old.tenant_id and t.archived_at is not null) then
      raise exception 'notify_sends: purge only touches archived businesses';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and current_setting('scalers.notify_settle', true) = '1' then
    if new.id is distinct from old.id
      or new.tenant_id is distinct from old.tenant_id
      or new.idempotency_key is distinct from old.idempotency_key
      or new.kind is distinct from old.kind
      or new.created_at is distinct from old.created_at
      or new.audience is distinct from old.audience
      or new.billed_to is distinct from old.billed_to
      or new.call_id is distinct from old.call_id
      or new.call_sid is distinct from old.call_sid
    then
      raise exception 'notify_sends: identity columns are immutable';
    end if;
    if old.status = 'sent' then
      raise exception 'notify_sends: sent rows are final';
    end if;
    return new;
  end if;
  raise exception 'notify_sends is append-only';
end;
$$;

create or replace function public.archived_tenant_recording_objects(
  p_days integer,
  p_tenant_id uuid default null
)
returns table (tenant_id uuid, bucket_id text, object_name text)
language sql
stable
security definer
set search_path = public, storage
as $$
  select c.tenant_id, o.bucket_id, o.name
  from public.tenants t
  join public.calls c on c.tenant_id = t.id
  join storage.objects o
    on o.bucket_id = 'call-recordings'
   and c.sautikit_call_sid is not null
   and length(c.sautikit_call_sid) > 0
   and o.name like c.sautikit_call_sid || '/%'
  where t.archived_at is not null
    and t.is_active is false
    and t.archived_at < now() - make_interval(days => greatest(coalesce(p_days, 30), 0))
    and (p_tenant_id is null or t.id = p_tenant_id);
$$;

revoke all on function public.archived_tenant_recording_objects(integer, uuid) from public, anon, authenticated;
grant execute on function public.archived_tenant_recording_objects(integer, uuid) to service_role;

create or replace function public.purge_archived_tenants(
  p_days integer,
  p_dry_run boolean default true,
  p_tenant_id uuid default null
)
returns table (
  tenant_id uuid,
  business_name text,
  archived_at timestamptz,
  item text,
  n_rows bigint,
  action text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_t record;
  v_tbl text;
  v_col text;
  v_n bigint;
  v_rec bigint;
  v_summary jsonb;
  v_sets text[];
  v_default text;
  v_nullable text;
  v_usage jsonb;
  v_counters jsonb;
  -- Child tables deleted by tenant_id, children of calls/contacts first.
  c_delete constant text[] := array[
    'call_facts', 'voice_turn_traces', 'caller_files', 'appointments',
    'service_requests', 'calls', 'contacts', 'tenant_invites',
    'tenant_field_meta', 'tenant_spoken_catalogue_versions',
    'tenant_staff_names', 'catalogue_price_history',
    'data_quality_snapshots', 'memory_retention_runs'
  ];
  -- Deleted after the tenant scrub, because tenant updates may log history.
  c_delete_last constant text[] := array['tenant_field_history'];
  c_keep constant text[] := array[
    'wallet_ledger', 'tenant_subscriptions', 'tenant_minute_grants',
    'notify_sends', 'ops_audit_log', 'tenant_members', 'sautikit_did_pool'
  ];
  -- Playbook / business facts on the tenant row.
  c_tenant_cols constant text[] := array[
    'llm_system_prompt', 'business_hours', 'services_offered', 'agent_tone',
    'unknown_answer_fallback', 'team_directory', 'faqs', 'hours_schedule',
    'services_catalog', 'daily_bulletin', 'business_locations',
    'business_policies', 'tts_lexicon', 'product_catalog', 'social_handles',
    'pronunciation_review_queue', 'pronunciation_scan_dismissals',
    'pronunciation_gemini_scan_logs', 'onboarding_draft', 'service_areas',
    'spoken_catalogue', 'greeting_invite'
  ];
begin
  if p_days is null or p_days < 0 then
    raise exception 'p_days must be >= 0';
  end if;
  if not coalesce(p_dry_run, true) and p_days < 30 then
    raise exception 'a real purge needs p_days >= 30 (the restore window)';
  end if;

  for v_t in
    select t.id, t.business_name, t.archived_at
    from public.tenants t
    where t.archived_at is not null
      and t.is_active is false
      and t.archived_at < now() - make_interval(days => p_days)
      and (p_tenant_id is null or t.id = p_tenant_id)
    order by t.archived_at
  loop
    begin
      v_summary := '{}'::jsonb;

      -- Recordings in storage.
      v_rec := 0;
      if to_regclass('storage.objects') is not null
         and to_regclass('public.calls') is not null then
        select count(*) into v_rec
        from public.archived_tenant_recording_objects(p_days, v_t.id);
      end if;
      tenant_id := v_t.id; business_name := v_t.business_name; archived_at := v_t.archived_at;
      item := 'storage:call-recordings'; n_rows := v_rec;
      if p_dry_run then
        action := 'would_delete';
      elsif v_rec > 0 then
        action := 'blocked';
      else
        action := 'deleted';
      end if;
      return next;
      if not p_dry_run and v_rec > 0 then
        continue;
      end if;

      -- Real run: let the notify_sends trigger accept the call_id / text blanking.
      perform set_config('scalers.notify_purge', case when p_dry_run then '0' else '1' end, true);

      -- Usage history: calls are the only per-month minute record. Summarise them
      -- into the audit row before they go. Billing itself never reads calls.
      v_usage := '{}'::jsonb;
      if to_regclass('public.calls') is not null then
        execute format(
          'select coalesce(jsonb_object_agg(m, jsonb_build_object(''calls'', n, ''duration_seconds'', d, ''package_seconds_applied'', ps)), ''{}''::jsonb)
             from (select to_char(c.created_at at time zone ''Africa/Nairobi'', ''YYYY-MM'') as m,
                          count(*) as n,
                          coalesce(sum(c.duration_seconds), 0) as d,
                          %s as ps
                     from public.calls c where c.tenant_id = $1 group by 1) x',
          case when exists (select 1 from information_schema.columns
                            where table_schema = 'public' and table_name = 'calls'
                              and column_name = 'package_seconds_applied')
               then 'coalesce(sum(c.package_seconds_applied), 0)' else 'null::bigint' end)
          into v_usage using v_t.id;
        item := 'calls usage by month (kept in audit log)';
        n_rows := (select count(*) from jsonb_object_keys(v_usage));
        action := 'keep';
        return next;
      end if;
      select jsonb_strip_nulls(jsonb_build_object(
               'seconds_used', x->'seconds_used',
               'minutes_included', x->'minutes_included',
               'sms_used_units', x->'sms_used_units',
               'sms_included_units', x->'sms_included_units',
               'billing_enforcement', x->'billing_enforcement',
               'on_demand_usage_enabled', x->'on_demand_usage_enabled'))
        into v_counters
      from (select to_jsonb(t) as x from public.tenants t where t.id = v_t.id) q;

      -- Transcripts go with calls (FK cascade); count them for the report.
      if to_regclass('public.transcripts') is not null and to_regclass('public.calls') is not null then
        execute 'select count(*) from public.transcripts x join public.calls c on c.id = x.call_id where c.tenant_id = $1'
          into v_n using v_t.id;
        item := 'transcripts (with calls)'; n_rows := v_n;
        action := case when p_dry_run then 'would_delete' else 'deleted' end;
        return next;
      end if;

      foreach v_tbl in array c_delete loop
        if to_regclass('public.' || v_tbl) is null then continue; end if;
        if not exists (select 1 from information_schema.columns
                       where table_schema = 'public' and table_name = v_tbl and column_name = 'tenant_id') then
          continue;
        end if;
        if p_dry_run then
          execute format('select count(*) from public.%I where tenant_id = $1', v_tbl) into v_n using v_t.id;
        else
          execute format('delete from public.%I where tenant_id = $1', v_tbl) using v_t.id;
          get diagnostics v_n = row_count;
        end if;
        v_summary := v_summary || jsonb_build_object(v_tbl, v_n);
        item := v_tbl; n_rows := v_n;
        action := case when p_dry_run then 'would_delete' else 'deleted' end;
        return next;
      end loop;

      -- Tenant row: blank playbook columns, keep the tombstone.
      v_sets := array[]::text[];
      foreach v_col in array c_tenant_cols loop
        select c.column_default, c.is_nullable into v_default, v_nullable
        from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = 'tenants' and c.column_name = v_col;
        if not found then continue; end if;
        if v_default is not null then
          v_sets := v_sets || format('%I = default', v_col);
        elsif v_nullable = 'YES' then
          v_sets := v_sets || format('%I = null', v_col);
        end if;
      end loop;
      item := 'tenants (playbook columns, row kept)'; n_rows := coalesce(array_length(v_sets, 1), 0);
      if not p_dry_run and array_length(v_sets, 1) > 0 then
        execute format('update public.tenants set %s where id = $1', array_to_string(v_sets, ', ')) using v_t.id;
      end if;
      action := case when p_dry_run then 'would_clear' else 'cleared' end;
      return next;

      foreach v_tbl in array c_delete_last loop
        if to_regclass('public.' || v_tbl) is null then continue; end if;
        if p_dry_run then
          execute format('select count(*) from public.%I where tenant_id = $1', v_tbl) into v_n using v_t.id;
        else
          execute format('delete from public.%I where tenant_id = $1', v_tbl) using v_t.id;
          get diagnostics v_n = row_count;
        end if;
        v_summary := v_summary || jsonb_build_object(v_tbl, v_n);
        item := v_tbl; n_rows := v_n;
        action := case when p_dry_run then 'would_delete' else 'deleted' end;
        return next;
      end loop;

      -- notify_sends: keep for usage billing, blank the message text and recipient.
      if to_regclass('public.notify_sends') is not null then
        if p_dry_run then
          select count(*) into v_n from public.notify_sends ns
          where ns.tenant_id = v_t.id and (ns.body is not null or ns.recipient is not null);
        else
          update public.notify_sends ns set body = null, recipient = null
          where ns.tenant_id = v_t.id and (ns.body is not null or ns.recipient is not null);
          get diagnostics v_n = row_count;
        end if;
        item := 'notify_sends (text and recipient)'; n_rows := v_n;
        action := case when p_dry_run then 'would_clear' else 'cleared' end;
        return next;
      end if;

      foreach v_tbl in array c_keep loop
        if to_regclass('public.' || v_tbl) is null then continue; end if;
        execute format('select count(*) from public.%I where tenant_id = $1', v_tbl) into v_n using v_t.id;
        item := v_tbl; n_rows := v_n; action := 'keep';
        return next;
      end loop;

      if not p_dry_run then
        insert into public.ops_audit_log (actor, action, tenant_id, detail)
        values ('purge', 'purge_business', v_t.id,
                jsonb_build_object('archived_at', v_t.archived_at, 'days', p_days, 'deleted', v_summary,
                           'usage_by_month', v_usage, 'counters', v_counters));
      end if;
      perform set_config('scalers.notify_purge', '0', true);
    exception when others then
      perform set_config('scalers.notify_purge', '0', true);
      tenant_id := v_t.id; business_name := v_t.business_name; archived_at := v_t.archived_at;
      item := left(sqlerrm, 200); n_rows := 0; action := 'error';
      return next;
    end;
  end loop;
end;
$$;

revoke all on function public.purge_archived_tenants(integer, boolean, uuid) from public, anon, authenticated;
grant execute on function public.purge_archived_tenants(integer, boolean, uuid) to service_role;
