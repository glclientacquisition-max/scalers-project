-- Desk "Set up your calls": store the owner's call setup per account (was browser storage
-- `scalers.callSetup.v1.<tenantId>`, PR #755). Same shape plus opened/tested/nudge fields:
--   { option: 'main_number'|'forward'|null, network: 'safaricom'|'airtel'|'telkom'|null,
--     phone: 'android'|'iphone'|null, choices: ['all'|'no_answer'|'busy'|'off'],
--     ring_seconds: 15|20|30, tested_at, tested_via: 'manual'|'auto'|null, opened_at,
--     test_from: '+2547XXXXXXXX'|'+2541XXXXXXXX'|null, test_started_at,
--     nudge_dismissed_at, auto_seen_at, updated_at }   (times are ISO 8601 strings)
-- tested_via 'auto' = a call from test_from reached the assistant within 30 minutes of
-- test_started_at. save_call_setup checks that call exists before it accepts 'auto'.
-- Owners and admins write it only through save_call_setup (membership checked here);
-- no column UPDATE grant for authenticated. Members read it with the tenants row (RLS).
-- ADDITIVE: one nullable column, a check, two functions. No data changes. Safe to re-run.
-- Rollback (owners' browsers keep their own copy and the Desk falls back to it):
--   drop function if exists public.save_call_setup(uuid, jsonb);
--   alter table public.tenants drop constraint if exists tenants_call_setup_valid;
--   drop function if exists public.call_setup_valid(jsonb);
--   alter table public.tenants drop column if exists call_setup;

alter table public.tenants add column if not exists call_setup jsonb;

create or replace function public.call_setup_valid(v jsonb)
returns boolean language sql immutable set search_path = public as $$
  select v is null or jsonb_typeof(v) = 'null' or (
    jsonb_typeof(v) = 'object'
    and pg_column_size(v) <= 4096
    and coalesce(v->>'option', 'main_number') in ('main_number', 'forward')
    and coalesce(v->>'network', 'safaricom') in ('safaricom', 'airtel', 'telkom')
    and coalesce(v->>'phone', 'android') in ('android', 'iphone')
    and coalesce(jsonb_typeof(v->'choices'), 'array') in ('array', 'null')
    and not exists (
      select 1 from jsonb_array_elements_text(
        case when jsonb_typeof(v->'choices') = 'array' then v->'choices' else '[]'::jsonb end
      ) c where c not in ('all', 'no_answer', 'busy', 'off'))
    and coalesce(v->>'ring_seconds', '20') in ('15', '20', '30')
    and coalesce(v->>'tested_via', 'manual') in ('manual', 'auto')
    and coalesce(v->>'test_from', '+254700000000') ~ '^\+254[17]\d{8}$'
    and (coalesce(v->>'tested_via', '') <> 'auto' or (v->>'test_from' is not null and v->>'test_started_at' is not null))
    and not exists (
      select 1 from unnest(array['tested_at', 'opened_at', 'test_started_at', 'nudge_dismissed_at', 'auto_seen_at', 'updated_at']) k
      where v->>k is not null and (v->>k) !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}')
  );
$$;

alter table public.tenants drop constraint if exists tenants_call_setup_valid;
alter table public.tenants add constraint tenants_call_setup_valid check (public.call_setup_valid(call_setup));

-- Owner/admin write path. security definer so no column grant is needed; the membership
-- check is the gate (same rule as tenants_update_admin_only).
create or replace function public.save_call_setup(p_tenant uuid, p_next jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
  prev jsonb;
begin
  if auth.uid() is null or not public.member_can_admin(p_tenant) then
    raise exception 'not allowed for this business' using errcode = '42501';
  end if;
  if p_next is null or jsonb_typeof(p_next) <> 'object' then
    raise exception 'call setup must be an object' using errcode = '22023';
  end if;
  v := p_next || jsonb_build_object('updated_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
  if not public.call_setup_valid(v) then
    raise exception 'call setup is not valid' using errcode = '22023';
  end if;
  -- A new automatic test must point at a real call from the test phone in its window.
  select call_setup into prev from public.tenants where id = p_tenant;
  if v->>'tested_via' = 'auto'
     and (prev->>'tested_via' is distinct from 'auto' or prev->>'tested_at' is distinct from v->>'tested_at') then
    if not exists (
      select 1
      from public.calls c
      cross join lateral (select regexp_replace(coalesce(c.caller_number, ''), '\D', '', 'g') as d) n
      where c.tenant_id = p_tenant
        -- 07.., 7.., 254.. and +254.. caller forms all compare as +254..
        and '+' || case when n.d ~ '^254' then n.d when n.d ~ '^0' then '254' || substr(n.d, 2) else '254' || n.d end
            = v->>'test_from'
        and c.created_at >= (v->>'test_started_at')::timestamptz
        and c.created_at <= (v->>'test_started_at')::timestamptz + interval '30 minutes'
    ) then
      raise exception 'no test call from that phone yet' using errcode = '22023';
    end if;
  end if;
  update public.tenants set call_setup = v where id = p_tenant;
  if not found then
    raise exception 'business not found' using errcode = 'P0002';
  end if;
  return v;
end $$;

revoke all on function public.save_call_setup(uuid, jsonb) from public, anon;
grant execute on function public.save_call_setup(uuid, jsonb) to authenticated;
