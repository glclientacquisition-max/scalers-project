-- Structured data foundation (BI). ADDITIVE ONLY: new columns, tables, functions, NOT VALID-safe checks.
-- Old free-text fields stay and keep working; typed values sit beside them.
-- Taxonomy source of truth: src/data/taxonomy.json (mirrored in dashboard/src/lib/taxonomy.json).
-- Staging first. Prod only with the merge of "Structured data foundation".

begin;

-- 1. Business type + category -------------------------------------------------
alter table public.tenants
  add column if not exists business_type text,
  add column if not exists business_category text;

do $$ begin
  alter table public.tenants add constraint tenants_business_type_chk
    check (business_type is null or business_type in ('retail', 'home_services', 'general'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.tenants add constraint tenants_business_category_chk
    check (business_category is null or business_category ~ '^[a-z_]{2,40}$');
exception when duplicate_object then null; end $$;

update public.tenants
   set business_type = case when vertical in ('retail', 'home_services') then vertical else 'general' end
 where business_type is null;

grant update (business_type, business_category) on public.tenants to authenticated;

-- 2. Shared helpers -------------------------------------------------------------
create or replace function public.is_e164(p text)
returns boolean language sql immutable as $$
  select coalesce(p ~ '^\+[1-9][0-9]{7,14}$', false);
$$;

-- Kenyan local formats -> E.164. Returns null when it can't be sure (never guesses other countries).
create or replace function public.to_e164_ke(p text)
returns text language sql immutable as $$
  with d as (select regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g') as v)
  select case
    when v ~ '^\+[1-9][0-9]{7,14}$' then v
    when v ~ '^254[17][0-9]{8}$' then '+' || v
    when v ~ '^0[17][0-9]{8}$' then '+254' || substr(v, 2)
    when v ~ '^[17][0-9]{8}$' then '+254' || v
    else null end
  from d;
$$;

-- Free-text price -> typed price jsonb (mirror of parsePriceText in dashboard/src/lib/structuredData.ts,
-- deterministic subset). Marked source=parsed, confirmed=false: owners confirm in Settings.
create or replace function public.parse_price_ksh(p text)
returns jsonb language plpgsql immutable as $$
declare
  t text := lower(coalesce(p, ''));
  c text;
  lo numeric; hi numeric; m text[];
  is_from boolean;
begin
  if btrim(t) = '' or t ~ '^\s*(ask|call|varies|depends|tbd|on request)' then
    return jsonb_build_object('mode', 'ask', 'amount_ksh', null, 'min_ksh', null, 'max_ksh', null, 'unit', null,
      'in_stock', null, 'source', 'parsed', 'confirmed', false, 'parsed_from', nullif(btrim(p), ''));
  end if;
  c := regexp_replace(t, 'kshs?\.?|kes|/=', ' ', 'g');
  c := regexp_replace(c, '(\d),(\d{3})', '\1\2', 'g');
  c := regexp_replace(c, '(\d),(\d{3})', '\1\2', 'g');
  is_from := t ~ '\m(from|starting|kuanzia|min)';
  m := regexp_match(c, '(\d+(?:\.\d+)?)\s*(k?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(k?)(?![a-z])');
  if m is not null then
    lo := m[1]::numeric * case when m[2] = 'k' then 1000 else 1 end;
    hi := m[3]::numeric * case when m[4] = 'k' then 1000 else 1 end;
    if hi >= lo then
      return jsonb_build_object('mode', 'range', 'amount_ksh', round(lo), 'min_ksh', round(lo), 'max_ksh', round(hi), 'unit', null,
        'in_stock', null, 'source', 'parsed', 'confirmed', false, 'parsed_from', btrim(p));
    end if;
  end if;
  m := regexp_match(c, '(\d+(?:\.\d+)?)\s*(k(?![a-z]))?');
  if m is null then
    return jsonb_build_object('mode', 'ask', 'amount_ksh', null, 'min_ksh', null, 'max_ksh', null, 'unit', null,
      'in_stock', null, 'source', 'parsed', 'confirmed', false, 'parsed_from', btrim(p));
  end if;
  lo := m[1]::numeric * case when m[2] = 'k' then 1000 else 1 end;
  if lo > 100000000 then lo := null; end if;
  return jsonb_build_object('mode', case when lo is null then 'ask' when is_from then 'from' else 'fixed' end,
    'amount_ksh', round(lo), 'min_ksh', case when is_from then round(lo) end, 'max_ksh', null, 'unit', null,
    'in_stock', null, 'source', 'parsed', 'confirmed', false, 'parsed_from', btrim(p));
end $$;

-- 3. Typed payments validity (business_policies.payments) -------------------------
create or replace function public.payments_valid(p jsonb)
returns boolean language sql immutable as $$
  select p is null or jsonb_typeof(p) = 'null' or (
    jsonb_typeof(p) = 'object'
    and jsonb_typeof(coalesce(p->'methods', '[]')) = 'array'
    and not exists (
      select 1 from jsonb_array_elements_text(coalesce(p->'methods', '[]')) m
      where m not in ('mpesa_till', 'mpesa_paybill', 'mpesa_send', 'cash', 'card', 'bank'))
    and (p->>'mpesa_till' is null or p->>'mpesa_till' ~ '^\d{5,7}$')
    and (p->'mpesa_paybill' is null or jsonb_typeof(p->'mpesa_paybill') = 'null' or p->'mpesa_paybill'->>'business_no' ~ '^\d{5,7}$')
    and (p->>'timing' is null or p->>'timing' in ('before_delivery', 'on_delivery', 'after_service', 'deposit_then_balance'))
    and (p->>'deposit_percent' is null or (p->>'deposit_percent') ~ '^\d{1,3}$' and (p->>'deposit_percent')::int between 1 and 100)
  );
$$;

do $$ begin
  alter table public.tenants add constraint tenants_payments_valid_chk
    check (public.payments_valid(business_policies->'payments'));
exception when duplicate_object then null; end $$;

-- Simple prose -> payments (deterministic subset of parsePaymentsText).
create or replace function public.parse_payments_text(p text)
returns jsonb language plpgsql immutable as $$
declare
  t text := lower(coalesce(p, ''));
  methods text[] := '{}';
  till text; pb text; dep int; timing text; m text[];
begin
  if btrim(t) = '' then return null; end if;
  m := regexp_match(t, '(?:till|buy goods)(?:\s*(?:no\.?|number|#))?\s*[:\-]?\s*(\d{5,7})(?!\d)');
  if m is not null then till := m[1]; methods := array_append(methods, 'mpesa_till'); elsif t ~ '\mtill\M|buy goods' then methods := array_append(methods, 'mpesa_till'); end if;
  m := regexp_match(t, 'pay\s*bill(?:\s*(?:no\.?|number|#))?\s*[:\-]?\s*(\d{5,7})(?!\d)');
  if m is not null then pb := m[1]; methods := array_append(methods, 'mpesa_paybill'); elsif t ~ 'pay\s*bill' then methods := array_append(methods, 'mpesa_paybill'); end if;
  if t ~ 'm-?pesa' and not (methods && array['mpesa_till', 'mpesa_paybill']) then methods := array_append(methods, 'mpesa_send'); end if;
  if t ~ '\mcash\M' then methods := array_append(methods, 'cash'); end if;
  if t ~ '\mcard|visa|mastercard' then methods := array_append(methods, 'card'); end if;
  if t ~ '\mbank|\meft\M|rtgs|pesalink' then methods := array_append(methods, 'bank'); end if;
  m := regexp_match(t, '(\d{1,3})\s*%\s*(?:deposit|down|upfront|advance)');
  if m is null then m := regexp_match(t, '(?:deposit|down|upfront|advance)[^\d%]{0,20}(\d{1,3})\s*%'); end if;
  if m is not null then dep := least(100, greatest(1, m[1]::int)); end if;
  timing := case
    when t ~ 'before delivery|pay first|upfront|in advance' then 'before_delivery'
    when t ~ 'on delivery|\mcod\M' then 'on_delivery'
    when t ~ 'after (the )?(job|work|service)' then 'after_service'
    when dep is not null then 'deposit_then_balance' end;
  if cardinality(methods) = 0 and dep is null and timing is null then return null; end if;
  return jsonb_build_object('methods', to_jsonb(methods), 'mpesa_till', till,
    'mpesa_paybill', case when pb is not null then jsonb_build_object('business_no', pb, 'account', null) end,
    'timing', timing, 'deposit_percent', dep, 'source', 'parsed', 'confirmed', false);
end $$;

-- 4. Catalogue price history ------------------------------------------------------
create table if not exists public.catalogue_price_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('product', 'service')),
  item_key text not null,
  item_name text not null,
  mode text not null check (mode in ('fixed', 'from', 'range', 'ask')),
  amount_ksh numeric check (amount_ksh is null or amount_ksh >= 0),
  min_ksh numeric check (min_ksh is null or min_ksh >= 0),
  max_ksh numeric check (max_ksh is null or max_ksh >= 0),
  unit text,
  in_stock boolean,
  source text not null check (source in ('owner', 'parsed', 'setup', 'import')),
  confirmed boolean not null default false,
  effective_from timestamptz not null default now()
);
create index if not exists catalogue_price_history_item_idx
  on public.catalogue_price_history (tenant_id, kind, item_key, effective_from desc);

alter table public.catalogue_price_history enable row level security;
drop policy if exists catalogue_price_history_select on public.catalogue_price_history;
create policy catalogue_price_history_select on public.catalogue_price_history
  for select to authenticated using (public.current_member_role(tenant_id) is not null);
grant select on public.catalogue_price_history to authenticated;

create or replace function public._catalogue_item_key(item jsonb)
returns text language sql immutable as $$
  select coalesce(nullif(btrim(item->>'id'), ''), nullif(btrim(item->>'sku'), ''), lower(btrim(coalesce(item->>'name', ''))));
$$;

-- Records a row whenever an item's typed price (pricing.*) changes. Every write path is covered
-- because it runs on the table, not in one save action.
create or replace function public._record_catalogue_prices()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  k text; arr jsonb; old_arr jsonb; item jsonb; prev jsonb; key text; pr jsonb;
begin
  foreach k in array array['product', 'service'] loop
    arr := case k when 'product' then new.product_catalog else new.services_catalog end;
    old_arr := case when tg_op = 'UPDATE' then case k when 'product' then old.product_catalog else old.services_catalog end else '[]'::jsonb end;
    if jsonb_typeof(arr) <> 'array' then continue; end if;
    for item in select * from jsonb_array_elements(arr) loop
      pr := item->'pricing';
      if pr is null or jsonb_typeof(pr) <> 'object' or coalesce(btrim(item->>'name'), '') = '' then continue; end if;
      key := public._catalogue_item_key(item);
      select o->'pricing' into prev from jsonb_array_elements(case when jsonb_typeof(old_arr) = 'array' then old_arr else '[]' end) o
        where public._catalogue_item_key(o) = key limit 1;
      if prev is not distinct from pr then continue; end if;
      if prev is not null and (prev - 'confirmed' - 'source' - 'parsed_from') = (pr - 'confirmed' - 'source' - 'parsed_from')
         and coalesce((prev->>'confirmed')::boolean, false) = coalesce((pr->>'confirmed')::boolean, false) then continue; end if;
      insert into public.catalogue_price_history
        (tenant_id, kind, item_key, item_name, mode, amount_ksh, min_ksh, max_ksh, unit, in_stock, source, confirmed)
      values (new.id, k, key, left(item->>'name', 200),
        coalesce(nullif(pr->>'mode', ''), 'ask'),
        nullif(pr->>'amount_ksh', '')::numeric, nullif(pr->>'min_ksh', '')::numeric, nullif(pr->>'max_ksh', '')::numeric,
        nullif(pr->>'unit', ''),
        case when pr->>'in_stock' in ('true', 'false') then (pr->>'in_stock')::boolean end,
        case when pr->>'source' in ('owner', 'parsed', 'setup', 'import') then pr->>'source' else 'owner' end,
        coalesce((pr->>'confirmed')::boolean, false));
    end loop;
  end loop;
  return new;
end $$;

drop trigger if exists tenants_record_catalogue_prices on public.tenants;
create trigger tenants_record_catalogue_prices
  after insert or update of product_catalog, services_catalog on public.tenants
  for each row execute function public._record_catalogue_prices();

-- 5. Per-call structured record ---------------------------------------------------
create table if not exists public.call_facts (
  call_id uuid primary key references public.calls(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  intent text check (intent is null or intent in ('price_check','availability','product_info','order_place','order_status',
    'hold_or_pickup','book_visit','quote_request','delivery_question','payment_question','directions','hours','complaint',
    'return_refund','warranty','emergency','human_request','general_enquiry','wrong_number','spam','other')),
  secondary_intents text[] not null default '{}',
  outcome text check (outcome is null or outcome in ('sale_or_order','hold','booking','callback','info_only','transferred','lost','abandoned')),
  lost_reason text check (lost_reason is null or lost_reason in ('price_too_high','out_of_stock','not_offered','outside_coverage',
    'closed_hours','delivery_fee','wanted_human','competitor','other')),
  products_mentioned jsonb not null default '[]' check (jsonb_typeof(products_mentioned) = 'array'),
  price_objection boolean,
  objection_price_ksh numeric check (objection_price_ksh is null or objection_price_ksh >= 0),
  competitor_mentioned text check (competitor_mentioned is null or length(competitor_mentioned) <= 80),
  est_value_ksh numeric check (est_value_ksh is null or est_value_ksh >= 0),
  caller_area text check (caller_area is null or length(caller_area) <= 80),
  language text check (language is null or language in ('en', 'sw', 'sheng', 'mixed')),
  sentiment text check (sentiment is null or sentiment in ('positive', 'neutral', 'negative')),
  unanswered_question text check (unanswered_question is null or length(unanswered_question) <= 300),
  time_of_day text check (time_of_day is null or time_of_day in ('night', 'morning', 'afternoon', 'evening')),
  hour_eat smallint check (hour_eat is null or hour_eat between 0 and 23),
  dow smallint check (dow is null or dow between 0 and 6),
  -- provenance: review (model), legacy (mapped from calls.*), owner (corrected in the desk; trusted)
  source text not null default 'review' check (source in ('review', 'legacy', 'owner')),
  model text,
  confidence numeric check (confidence is null or confidence between 0 and 1),
  owner_corrected_by uuid,
  owner_corrected_at timestamptz,
  review_snapshot jsonb
);
create index if not exists call_facts_tenant_time_idx on public.call_facts (tenant_id, created_at desc);
create index if not exists call_facts_tenant_intent_idx on public.call_facts (tenant_id, intent);

alter table public.call_facts enable row level security;
drop policy if exists call_facts_select on public.call_facts;
create policy call_facts_select on public.call_facts
  for select to authenticated using (public.current_member_role(tenant_id) is not null);
grant select on public.call_facts to authenticated;

-- Owner correction: trusted data. Only owner/admin/staff; keeps the model's values in review_snapshot.
create or replace function public.correct_call_facts(p_call uuid, p_intent text, p_outcome text, p_lost_reason text)
returns public.call_facts language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid; r public.call_facts;
begin
  select tenant_id into v_tenant from public.calls where id = p_call;
  if v_tenant is null then raise exception 'call not found' using errcode = 'P0002'; end if;
  if not public.member_can_write(v_tenant) then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_outcome is distinct from 'lost' then p_lost_reason := null; end if;
  insert into public.call_facts (call_id, tenant_id, intent, outcome, lost_reason, source, owner_corrected_by, owner_corrected_at)
  values (p_call, v_tenant, p_intent, p_outcome, p_lost_reason, 'owner', auth.uid(), now())
  on conflict (call_id) do update set
    review_snapshot = case when call_facts.source = 'owner' then call_facts.review_snapshot
      else jsonb_build_object('intent', call_facts.intent, 'outcome', call_facts.outcome, 'lost_reason', call_facts.lost_reason, 'source', call_facts.source) end,
    intent = excluded.intent, outcome = excluded.outcome, lost_reason = excluded.lost_reason,
    source = 'owner', owner_corrected_by = auth.uid(), owner_corrected_at = now(), updated_at = now()
  returning * into r;
  return r;
end $$;
revoke all on function public.correct_call_facts(uuid, text, text, text) from public, anon;
grant execute on function public.correct_call_facts(uuid, text, text, text) to authenticated;

-- Legacy backfill: map calls.primary_intent / resolution onto the shared taxonomy (source=legacy).
insert into public.call_facts (call_id, tenant_id, created_at, intent, outcome, time_of_day, hour_eat, dow, source)
select c.id, c.tenant_id, c.created_at,
  case when c.primary_intent is null then null else case c.primary_intent
    when 'hours_open' then 'hours' when 'product_inquiry' then 'product_info' when 'price' then 'price_check'
    when 'booking' then 'book_visit' when 'order_enquiry' then 'order_status' when 'human' then 'human_request'
    when 'availability' then 'availability' when 'directions' then 'directions' when 'general_enquiry' then 'general_enquiry'
    when 'complaint' then 'complaint' when 'emergency' then 'emergency' when 'hold_or_pickup' then 'hold_or_pickup'
    when 'book_visit' then 'book_visit' else 'other' end end,
  case c.resolution when 'needs_human' then 'callback' when 'abandoned' then 'abandoned' when 'resolved' then 'info_only' else null end,
  case when extract(hour from c.created_at at time zone 'Africa/Nairobi') < 6 then 'night'
       when extract(hour from c.created_at at time zone 'Africa/Nairobi') < 12 then 'morning'
       when extract(hour from c.created_at at time zone 'Africa/Nairobi') < 17 then 'afternoon' else 'evening' end,
  extract(hour from c.created_at at time zone 'Africa/Nairobi')::smallint,
  extract(dow from c.created_at at time zone 'Africa/Nairobi')::smallint,
  'legacy'
from public.calls c
on conflict (call_id) do nothing;

-- 6. Auto-parse existing free text (typed beside old; owners confirm) -------------
update public.tenants t set product_catalog = (
  select jsonb_agg(case when jsonb_typeof(i) = 'object' and i->'pricing' is null
    then i || jsonb_build_object('pricing', public.parse_price_ksh(i->>'price')
      || jsonb_build_object('in_stock', case lower(coalesce(i->>'in_stock', '')) when 'yes' then true when 'true' then true when 'no' then false when 'false' then false end))
    else i end order by ord)
  from jsonb_array_elements(t.product_catalog) with ordinality as x(i, ord))
where jsonb_typeof(t.product_catalog) = 'array' and jsonb_array_length(t.product_catalog) > 0
  and exists (select 1 from jsonb_array_elements(t.product_catalog) i where i->'pricing' is null);

update public.tenants t set services_catalog = (
  select jsonb_agg(case when jsonb_typeof(i) = 'object' and i->'pricing' is null
    then i || jsonb_build_object('pricing', public.parse_price_ksh(i->>'price_range'))
    else i end order by ord)
  from jsonb_array_elements(t.services_catalog) with ordinality as x(i, ord))
where jsonb_typeof(t.services_catalog) = 'array' and jsonb_array_length(t.services_catalog) > 0
  and exists (select 1 from jsonb_array_elements(t.services_catalog) i where i->'pricing' is null);

update public.tenants
   set business_policies = business_policies || jsonb_build_object('payments',
     public.parse_payments_text(coalesce(business_policies->>'payment', '') || ' ' || coalesce(business_policies->>'deposit', '')))
 where jsonb_typeof(business_policies) = 'object'
   and business_policies->'payments' is null
   and public.parse_payments_text(coalesce(business_policies->>'payment', '') || ' ' || coalesce(business_policies->>'deposit', '')) is not null;

-- 7. Data-quality check -----------------------------------------------------------
create or replace function public._data_quality_rows(p_tenant uuid)
returns table (
  tenant_id uuid, business_name text,
  products int, products_no_price int, services int, services_no_price int, prices_unconfirmed int,
  calls_30d int, calls_intent_unknown_30d int, calls_no_facts_30d int, owner_corrections_30d int,
  local_phones int, payments_text_only boolean, payments_unconfirmed boolean, business_category_missing boolean
) language sql stable security definer set search_path = public as $$
  select t.id, t.business_name,
    (select count(*) from jsonb_array_elements(case when jsonb_typeof(t.product_catalog) = 'array' then t.product_catalog else '[]' end))::int,
    (select count(*) from jsonb_array_elements(case when jsonb_typeof(t.product_catalog) = 'array' then t.product_catalog else '[]' end) i
       where coalesce(i->'pricing'->>'amount_ksh', '') = '' and coalesce(i->'pricing'->>'mode', 'ask') <> 'ask' or i->'pricing' is null
          or (i->'pricing'->>'mode' = 'ask' and coalesce((i->'pricing'->>'confirmed')::boolean, false) = false))::int,
    (select count(*) from jsonb_array_elements(case when jsonb_typeof(t.services_catalog) = 'array' then t.services_catalog else '[]' end))::int,
    (select count(*) from jsonb_array_elements(case when jsonb_typeof(t.services_catalog) = 'array' then t.services_catalog else '[]' end) i
       where coalesce(i->'pricing'->>'amount_ksh', '') = '' and coalesce(i->'pricing'->>'mode', 'ask') <> 'ask' or i->'pricing' is null
          or (i->'pricing'->>'mode' = 'ask' and coalesce((i->'pricing'->>'confirmed')::boolean, false) = false))::int,
    (select count(*) from jsonb_array_elements(
       (case when jsonb_typeof(t.product_catalog) = 'array' then t.product_catalog else '[]' end)
       || (case when jsonb_typeof(t.services_catalog) = 'array' then t.services_catalog else '[]' end)) i
       where i->'pricing'->>'source' = 'parsed' and coalesce((i->'pricing'->>'confirmed')::boolean, false) = false
         and coalesce(btrim(i->'pricing'->>'parsed_from'), '') <> '')::int,  -- empty text is "no price", not a check
    (select count(*) from calls c where c.tenant_id = t.id and c.created_at > now() - interval '30 days')::int,
    (select count(*) from calls c left join call_facts f on f.call_id = c.id
       where c.tenant_id = t.id and c.created_at > now() - interval '30 days' and coalesce(f.intent, 'other') = 'other')::int,
    (select count(*) from calls c where c.tenant_id = t.id and c.created_at > now() - interval '30 days'
       and not exists (select 1 from call_facts f where f.call_id = c.id and f.source <> 'legacy'))::int,
    (select count(*) from call_facts f where f.tenant_id = t.id and f.source = 'owner' and f.owner_corrected_at > now() - interval '30 days')::int,
    ((case when coalesce(t.whatsapp_notification_number, '') <> '' and not public.is_e164(t.whatsapp_notification_number) then 1 else 0 end)
      + (select count(*) from jsonb_array_elements(case when jsonb_typeof(t.team_directory) = 'array' then t.team_directory else '[]' end) m
           where coalesce(m->>'phone', '') <> '' and not public.is_e164(m->>'phone'))
      + (select count(*) from contacts k where k.tenant_id = t.id and coalesce(k.phone, '') <> '' and not public.is_e164(k.phone)))::int,
    (coalesce(btrim(t.business_policies->>'payment'), '') <> '' and t.business_policies->'payments' is null),
    coalesce(t.business_policies->'payments'->>'source' = 'parsed' and not coalesce((t.business_policies->'payments'->>'confirmed')::boolean, false), false),
    t.business_category is null
  from tenants t
  where p_tenant is null or t.id = p_tenant;
$$;
revoke all on function public._data_quality_rows(uuid) from public, anon, authenticated;
grant execute on function public._data_quality_rows(uuid) to service_role;

-- Public entry: a member sees their own workspace; service role (ops) may ask for all (null).

create or replace view public.data_quality_daily with (security_invoker = true) as
  select * from public._data_quality_rows(null);
revoke all on public.data_quality_daily from public, anon, authenticated;
grant select on public.data_quality_daily to service_role;

create or replace function public.data_quality_for(p_tenant uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if public.current_member_role(p_tenant) is null then raise exception 'not allowed' using errcode = '42501'; end if;
  select to_jsonb(x) - 'tenant_id' into r from public._data_quality_rows(p_tenant) x;
  return r;
end $$;
revoke all on function public.data_quality_for(uuid) from public, anon;
grant execute on function public.data_quality_for(uuid) to authenticated;

create table if not exists public.data_quality_snapshots (
  taken_on date not null default (now() at time zone 'Africa/Nairobi')::date,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  report jsonb not null,
  primary key (taken_on, tenant_id)
);
alter table public.data_quality_snapshots enable row level security;
-- service role only (no policies): ops reads it from the admin console.

create or replace function public.snapshot_data_quality()
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.data_quality_snapshots (tenant_id, report)
  select r.tenant_id, to_jsonb(r) - 'tenant_id' from public._data_quality_rows(null) r
  on conflict (taken_on, tenant_id) do update set report = excluded.report;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.snapshot_data_quality() from public, anon, authenticated;
grant execute on function public.snapshot_data_quality() to service_role;

-- Daily at 03:15 EAT (00:15 UTC) when pg_cron is available; otherwise the server cron calls it.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'data_quality_daily';
    perform cron.schedule('data_quality_daily', '15 0 * * *', 'select public.snapshot_data_quality()');
  end if;
end $$;

commit;
