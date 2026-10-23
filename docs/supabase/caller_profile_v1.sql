-- caller_profile_v1.sql
-- Caller profile v1 (planned #871 / CALLER_PROFILE_SPEC.md section 9).
-- Additive and idempotent. Staging first. Not applied by deploy.
-- Run after contacts_and_requests.sql, appointments.sql, greeting_language.sql (#844),
-- and brain_write_receipts.sql (#845). Production needs Alvin's GO.
-- Flag BRAIN_V2_CALLER_PROFILE stays off until SQL + stubs are verified.
-- ASCII-only.

-- Phone normaliser (Kenya E.164). Used by contacts.phone_e164 and the views/RPCs.
create or replace function public.ke_phone_e164(p text) returns text
language sql immutable as $$
  select case
    when p is null then null
    when regexp_replace(p,'\D','','g') ~ '^254[17][0-9]{8}$' then '+' || regexp_replace(p,'\D','','g')
    when regexp_replace(p,'\D','','g') ~ '^0[17][0-9]{8}$'   then '+254' || substr(regexp_replace(p,'\D','','g'),2)
    when regexp_replace(p,'\D','','g') ~ '^[17][0-9]{8}$'    then '+254' || regexp_replace(p,'\D','','g')
    else null end $$;

alter table public.contacts add column if not exists phone_e164 text
  generated always as (public.ke_phone_e164(phone)) stored;
alter table public.contacts add column if not exists line_shared boolean not null default false;
alter table public.contacts add column if not exists line_shared_source text
  check (line_shared_source is null or line_shared_source in ('derived','owner_desk'));
create index if not exists contacts_tenant_phone_e164_idx
  on public.contacts (tenant_id, phone_e164) include (id, name_confirmed, last_language, line_shared);
create index if not exists calls_tenant_caller_e164_idx
  on public.calls (tenant_id, public.ke_phone_e164(caller_number), created_at desc);

create table if not exists public.caller_persons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  display_name text not null check (char_length(display_name) <= 60),
  name_key text not null,
  preferred_language text check (preferred_language in ('en','sw','mix')),
  preferred_channel text check (preferred_channel in ('call','sms','whatsapp')),
  name_source text not null check (name_source in ('readback_yes','owner_edit','legacy_alternate')),
  name_source_ref text,
  name_confirmed_at timestamptz,
  profile_consent boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists caller_persons_tenant_key_idx on public.caller_persons (tenant_id, name_key);

create table if not exists public.line_persons (
  contact_id uuid not null references public.contacts(id) on delete cascade,
  person_id uuid not null references public.caller_persons(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null default 'primary' check (role in ('primary','household','staff','manager','other')),
  source text not null check (source in ('owner_desk','booking_system','confirmed_receipt','caller_stated_unconfirmed')),
  source_ref text,
  confirmed_at timestamptz,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  primary key (contact_id, person_id)
);

create table if not exists public.caller_properties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  label text check (char_length(label) <= 40),
  area text, estate text,
  landmark text check (char_length(landmark) <= 80),
  access_notes text check (char_length(access_notes) <= 120),
  size_hint jsonb,
  source text not null check (source in ('owner_desk','booking_system','confirmed_receipt','caller_stated_unconfirmed')),
  source_ref text,
  confidence text not null check (confidence in ('verified','confirmed','stated')),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  expires_at timestamptz,
  superseded_by uuid references public.caller_properties(id),
  created_at timestamptz not null default now()
);

create table if not exists public.person_properties (
  person_id uuid not null references public.caller_persons(id) on delete cascade,
  property_id uuid not null references public.caller_properties(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','tenant','househelp','manager')),
  is_default boolean not null default false,
  primary key (person_id, property_id)
);
create unique index if not exists person_properties_one_default
  on public.person_properties (person_id) where is_default;

create table if not exists public.caller_facts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  person_id uuid not null references public.caller_persons(id) on delete cascade,
  property_id uuid references public.caller_properties(id) on delete cascade,
  fact_key text not null check (fact_key in ('preferred_cleaner','preferred_day','preferred_time_window',
    'service_type_default','pets','products_note','do_not_contact_window')),
  value jsonb not null,
  say_en text check (char_length(say_en) <= 80),
  say_sw text check (char_length(say_sw) <= 80),
  source text not null check (source in ('owner_desk','booking_system','confirmed_receipt','caller_stated_unconfirmed')),
  source_ref text,
  confidence text not null check (confidence in ('verified','confirmed','stated')),
  call_id uuid references public.calls(id) on delete set null,
  receipt_id uuid references public.brain_write_receipts(id) on delete set null,
  approval text check (approval is null or approval in ('pending','approved','rejected')),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  expires_at timestamptz,
  superseded_by uuid references public.caller_facts(id),
  last_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint caller_facts_stated_needs_expiry check (confidence <> 'stated' or expires_at is not null)
);
create unique index if not exists caller_facts_current_uidx
  on public.caller_facts (person_id, coalesce(property_id,'00000000-0000-0000-0000-000000000000'::uuid), fact_key)
  where valid_to is null and confidence <> 'stated';
create unique index if not exists caller_facts_writer_idem_uidx
  on public.caller_facts (tenant_id, call_id, receipt_id, fact_key);
create index if not exists caller_facts_person_idx on public.caller_facts (person_id) where valid_to is null;

create table if not exists public.caller_consent (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  person_id uuid references public.caller_persons(id) on delete cascade,
  recording_consent boolean, profile_consent boolean, marketing_consent boolean,
  notice_version text, channel text, call_id uuid references public.calls(id) on delete set null,
  captured_at timestamptz not null default now()
);

alter table public.appointments add column if not exists property_id uuid
  references public.caller_properties(id) on delete set null;

alter table public.brain_write_receipts drop constraint if exists brain_write_receipts_tool_check;
alter table public.brain_write_receipts add constraint brain_write_receipts_tool_check check (
  tool in ('book_appointment','create_order','request_callback','log_complaint','escalate','quote','save_preference'));

-- Views (security_invoker so table RLS applies to owners)
create or replace view public.caller_open_items_v with (security_invoker = true) as
select 'apt:' || a.id as item_id, 'visit'::text as kind, a.tenant_id, a.contact_id, a.id as row_id,
       a.caller_name as person_name, a.service_name as title, a.when_text, a.window_start, a.window_end,
       a.address_landmark as place, a.property_id,
       case when coalesce(a.window_end, a.window_start) < now() - interval '30 days' then 'stale' else 'open' end as status,
       coalesce(a.window_end, a.window_start) < now() as is_past,
       a.window_start as due_at,
       (select r.id from public.brain_write_receipts r where r.write_id = a.id and r.phase = 'committed'
         order by r.created_at desc limit 1) as receipt_id,
       a.created_at
from public.appointments a where a.status in ('requested','confirmed')
union all
select 'req:' || s.id,
       case when s.request_type = 'callback' then 'callback_promised'
            when s.metadata->>'kind' = 'quote' then 'quote_pending'
            when s.metadata->>'kind' = 'complaint' then 'complaint_open'
            when s.request_type in ('hold','order') then 'booking_unconfirmed'
            else 'callback_promised' end,
       s.tenant_id, s.contact_id, s.id, s.caller_name, coalesce(s.item, s.request_type), s.when_text, null::timestamptz, null::timestamptz,
       null::text, null::uuid,
       case when coalesce((s.metadata->>'due_at')::timestamptz, s.created_at) < now() - interval '30 days' then 'stale' else 'open' end,
       coalesce((s.metadata->>'due_at')::timestamptz, now() + interval '1 day') < now(),
       (s.metadata->>'due_at')::timestamptz,
       (select r.id from public.brain_write_receipts r where r.write_id = s.id and r.phase = 'committed'
         order by r.created_at desc limit 1),
       s.created_at
from public.service_requests s where s.status = 'open';

create or replace view public.caller_stats_v with (security_invoker = true) as
select c.id as contact_id, c.tenant_id,
  (select count(*) from public.calls k where k.tenant_id = c.tenant_id and public.ke_phone_e164(k.caller_number) = c.phone_e164) as calls_total,
  (select count(*) from public.calls k where k.tenant_id = c.tenant_id and public.ke_phone_e164(k.caller_number) = c.phone_e164
     and k.created_at > now() - interval '90 days') as calls_90d,
  (select min(k.created_at) from public.calls k where k.tenant_id = c.tenant_id and public.ke_phone_e164(k.caller_number) = c.phone_e164) as first_seen_at,
  (select max(k.created_at) from public.calls k where k.tenant_id = c.tenant_id and public.ke_phone_e164(k.caller_number) = c.phone_e164) as last_seen_at,
  (select count(*) from public.appointments a where a.contact_id = c.id) as visits_total,
  (select count(*) from public.appointments a where a.contact_id = c.id and a.status = 'done') as visits_done,
  (select count(*) from public.appointments a where a.contact_id = c.id and a.status = 'cancelled') as visits_cancelled,
  (select count(*) from public.service_requests s where s.contact_id = c.id) as requests_total
from public.contacts c;

create or replace view public.caller_last_outcome_v with (security_invoker = true) as
select distinct on (k.tenant_id, public.ke_phone_e164(k.caller_number))
  k.tenant_id, public.ke_phone_e164(k.caller_number) as phone_e164, k.id as call_id,
  (k.summary::text::jsonb -> 'call_summary_event' ->> 'emittedAt')::timestamptz as emitted_at,
  k.summary::text::jsonb -> 'call_summary_event' ->> 'outcome' as outcome,
  k.summary::text::jsonb -> 'call_summary_event' ->> 'path' as path,
  k.summary::text::jsonb -> 'call_summary_event' ->> 'callLanguage' as call_language,
  k.summary::text::jsonb -> 'call_summary_event' -> 'receipts' -> 0 as top_receipt
from public.calls k
where k.summary is not null and k.summary::text like '{%' and k.summary::text like '%call_summary_event%'
order by k.tenant_id, public.ke_phone_e164(k.caller_number), k.created_at desc;

-- RPCs: service role only (voice server). One round trip each.
create or replace function public.caller_profile_safe_card(p_tenant uuid, p_phone text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'bind_state','candidate','contact_id',c.id,'line_shared',c.line_shared,
      'known_person_count',(select count(*) from line_persons lp where lp.contact_id=c.id and lp.valid_to is null),
      'has_open_items',exists(select 1 from caller_open_items_v o where o.contact_id=c.id and o.status='open' and not o.is_past),
      'preferred_language',c.last_language)
    from contacts c where c.tenant_id=p_tenant and c.phone_e164=ke_phone_e164(p_phone) limit 1),
    jsonb_build_object('bind_state','unbound')) $$;

-- Minimal bound card shape for v1 stub (Brain owns the final render).
create or replace function public.caller_profile_bound_card(p_tenant uuid, p_contact uuid, p_person uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'bind_state','bound',
      'person', jsonb_build_object(
        'id', p.id,
        'display_name', p.display_name,
        'preferred_language', p.preferred_language,
        'profile_consent', p.profile_consent
      ),
      'line', jsonb_build_object(
        'contact_id', c.id,
        'line_shared', c.line_shared,
        'known_person_count', (select count(*) from line_persons lp where lp.contact_id=c.id and lp.valid_to is null)
      ),
      'default_property', (
        select jsonb_build_object('id', cp.id, 'label', cp.label, 'area', cp.area, 'landmark', cp.landmark, 'size_hint', cp.size_hint)
        from person_properties pp
        join caller_properties cp on cp.id = pp.property_id and cp.valid_to is null
        where pp.person_id = p.id and pp.is_default
        limit 1
      ),
      'stats', (select to_jsonb(s) from caller_stats_v s where s.contact_id = c.id),
      'prefs', coalesce((
        select jsonb_agg(jsonb_build_object('fact_key', f.fact_key, 'value', f.value, 'say_en', f.say_en, 'say_sw', f.say_sw, 'source', f.source, 'confidence', f.confidence) order by f.fact_key)
        from caller_facts f
        where f.person_id = p.id and f.valid_to is null and f.confidence <> 'stated'
          and (f.expires_at is null or f.expires_at > now())
      ), '[]'::jsonb),
      'open_items', coalesce((
        select jsonb_agg(to_jsonb(o) order by o.due_at nulls last, o.created_at)
        from caller_open_items_v o
        where o.contact_id = c.id and o.status = 'open' and not o.is_past
      ), '[]'::jsonb),
      'last_outcome', (
        select to_jsonb(lo) from caller_last_outcome_v lo
        where lo.tenant_id = c.tenant_id and lo.phone_e164 = c.phone_e164
        limit 1
      )
    )
    from contacts c
    join caller_persons p on p.id = p_person and p.tenant_id = p_tenant
    where c.id = p_contact and c.tenant_id = p_tenant
      and exists (select 1 from line_persons lp where lp.contact_id = c.id and lp.person_id = p.id and lp.valid_to is null)
      and p.profile_consent is true
  ), jsonb_build_object('bind_state','unbound','error','unavailable')) $$;

revoke all on function public.caller_profile_safe_card(uuid,text) from public, anon, authenticated;
grant execute on function public.caller_profile_safe_card(uuid,text) to service_role;
revoke all on function public.caller_profile_bound_card(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.caller_profile_bound_card(uuid,uuid,uuid) to service_role;

-- RLS: service role writes; owners read/edit their tenant (Desk).
do $$ declare t text; begin
  foreach t in array array['caller_persons','line_persons','caller_properties','person_properties','caller_facts','caller_consent'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('drop policy if exists %I on public.%I', t||'_owner_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (tenant_id in (select public.current_user_tenant_ids())) with check (tenant_id in (select public.current_user_tenant_ids()))', t||'_owner_rw', t);
  end loop; end $$;

comment on table public.caller_persons is 'Caller profile v1: confirmed people on a tenant line. Flag BRAIN_V2_CALLER_PROFILE.';
comment on table public.caller_facts is 'Caller profile v1: typed preferences with provenance. Written post-call only.';
comment on function public.caller_profile_safe_card(uuid,text) is 'Thin pre-bind card. No names or history. Service role only.';
comment on function public.caller_profile_bound_card(uuid,uuid,uuid) is 'Bound card payload after name confirm. Service role only.';
