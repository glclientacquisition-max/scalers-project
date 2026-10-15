-- Payments v2 and typed policy rules (business_policies.payments / business_policies.rules).
--
-- Payments v2 adds Pochi la Biashara, M-Pesa Send Money and Airtel Money phone numbers,
-- bank details, card options, several "when customers pay" answers (timings[]) and a
-- free note. Rules hold short choices for returns, delivery, cancellation, booking
-- changes, late/no-show and warranty. The spoken text keys (payment, returns, delivery,
-- cancellation, warranty) are generated from them by the dashboard on save.
--
-- Safe to re-run. Version 1 payments stay valid, so the old dashboard keeps saving
-- during a deploy. Existing rows are rewritten to v2 in place; nothing is dropped.

-- 1. Validity --------------------------------------------------------------------
create or replace function public.ke_mobile_valid(p text)
returns boolean language sql immutable as $$
  select p is not null and p ~ '^\+254[17][0-9]{8}$';
$$;

create or replace function public.payments_valid(p jsonb)
returns boolean language sql immutable as $$
  select p is null or jsonb_typeof(p) = 'null' or (
    jsonb_typeof(p) = 'object'
    and jsonb_typeof(coalesce(p->'methods', '[]')) = 'array'
    and not exists (
      select 1 from jsonb_array_elements_text(coalesce(p->'methods', '[]')) m
      where m not in ('mpesa_till', 'mpesa_paybill', 'pochi', 'mpesa_send', 'airtel', 'bank', 'card', 'cash', 'cheque'))
    and (p->>'mpesa_till' is null or p->>'mpesa_till' ~ '^\d{5,7}$')
    and (p->'mpesa_paybill' is null or jsonb_typeof(p->'mpesa_paybill') = 'null' or (
      p->'mpesa_paybill'->>'business_no' ~ '^\d{5,7}$'
      and coalesce(p->'mpesa_paybill'->>'account_mode', 'fixed') in ('fixed', 'customer_name', 'customer_phone', 'order_no')
      and coalesce(length(p->'mpesa_paybill'->>'account'), 0) <= 40))
    and (p->'pochi' is null or jsonb_typeof(p->'pochi') = 'null' or public.ke_mobile_valid(p->'pochi'->>'phone'))
    and (p->'mpesa_send' is null or jsonb_typeof(p->'mpesa_send') = 'null' or public.ke_mobile_valid(p->'mpesa_send'->>'phone'))
    and (p->'airtel' is null or jsonb_typeof(p->'airtel') = 'null' or (
      (p->'airtel'->>'till' is null or p->'airtel'->>'till' ~ '^\d{4,8}$')
      and (p->'airtel'->>'phone' is null or public.ke_mobile_valid(p->'airtel'->>'phone'))))
    and (p->'bank' is null or jsonb_typeof(p->'bank') = 'null' or (
      length(coalesce(p->'bank'->>'bank_name', '')) between 1 and 60
      and length(coalesce(p->'bank'->>'account_name', '')) between 1 and 80
      and coalesce(p->'bank'->>'account_no', '') ~ '^\d{6,20}$'))
    -- v1: one timing string. v2: timings array.
    and (p->>'timing' is null or p->>'timing' in ('before_delivery', 'on_delivery', 'after_service', 'deposit_then_balance'))
    and (p->'timings' is null or (jsonb_typeof(p->'timings') = 'array' and not exists (
      select 1 from jsonb_array_elements_text(p->'timings') t
      where t not in ('before_delivery', 'on_delivery', 'at_pickup', 'before_service', 'after_service', 'deposit_then_balance', 'on_account'))))
    and (p->>'deposit_percent' is null or (p->>'deposit_percent') ~ '^\d{1,3}$' and (p->>'deposit_percent')::int between 1 and 100)
    and coalesce(length(p->>'note'), 0) <= 240
  );
$$;

create or replace function public.policy_rules_valid(r jsonb)
returns boolean language sql immutable as $$
  select r is null or jsonb_typeof(r) = 'null' or (
    jsonb_typeof(r) = 'object'
    and not exists (
      select 1 from jsonb_object_keys(r) k
      where k not in ('returns', 'delivery', 'cancellation', 'booking_changes', 'no_show', 'warranty'))
    and not exists (
      select 1 from jsonb_each(r) e
      where jsonb_typeof(e.value) <> 'object' or coalesce(length(e.value->>'note'), 0) > 200)
    and (r->'returns' is null or coalesce(r->'returns'->>'mode', 'refund_or_exchange') in ('refund_or_exchange', 'exchange', 'store_credit', 'none'))
    and (r->'delivery' is null or coalesce(r->'delivery'->>'mode', 'deliver') in ('deliver', 'pickup_only'))
    and (r->'cancellation' is null or coalesce(r->'cancellation'->>'fee', 'none') in ('none', 'deposit_kept', 'flat'))
    and (r->'no_show' is null or coalesce(r->'no_show'->>'charge', 'none') in ('none', 'callout', 'deposit_kept'))
  );
$$;

do $$ begin
  alter table public.tenants add constraint tenants_policy_rules_valid_chk
    check (public.policy_rules_valid(business_policies->'rules'));
exception when duplicate_object then null; end $$;
-- tenants_payments_valid_chk (from 20261011200000) now calls the v2 function above.

-- 2. Kenyan mobile -> E.164 ----------------------------------------------------------
create or replace function public.ke_mobile_e164(p text)
returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '[\s\-().]', '', 'g'); m text[];
begin
  m := regexp_match(d, '^(?:\+?254|0)?([17]\d{8})$');
  if m is null then m := regexp_match(d, '^\+?2540([17]\d{8})$'); end if;
  return case when m is null then null else '+254' || m[1] end;
end $$;

-- 3. v1 -> v2 -----------------------------------------------------------------------
create or replace function public.payments_to_v2(p jsonb)
returns jsonb language plpgsql immutable as $$
declare
  timings jsonb;
  acc text;
  mode text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return p; end if;
  if (p->>'version') = '2' then return p; end if;
  timings := case when p->>'timing' is not null then jsonb_build_array(p->>'timing') else '[]'::jsonb end;
  if p->>'deposit_percent' is not null and not timings ? 'deposit_then_balance' then
    timings := timings || '["deposit_then_balance"]'::jsonb;
  end if;
  acc := nullif(btrim(p->'mpesa_paybill'->>'account'), '');
  mode := case
    when acc ~* 'name' then 'customer_name'
    when acc ~* '(phone|simu)' and acc !~ '\d{3}' then 'customer_phone'
    else 'fixed' end;
  return (p - 'timing')
    || jsonb_build_object(
      'version', 2,
      'timings', timings,
      'mpesa_paybill', case when jsonb_typeof(p->'mpesa_paybill') = 'object' then
        jsonb_build_object('business_no', p->'mpesa_paybill'->>'business_no', 'account_mode', mode,
          'account', case when mode = 'fixed' then acc end) end,
      -- v1 could not hold a number for Send Money; owners add it in Settings.
      'mpesa_send', null, 'pochi', null, 'airtel', null, 'bank', null, 'card', null,
      'note', null);
end $$;

-- 4. Prose -> v2 (deterministic subset of parsePaymentsText in dashboard/src/lib/payments.ts)
create or replace function public.parse_payments_text(p text)
returns jsonb language plpgsql immutable as $$
declare
  t text := lower(coalesce(p, ''));
  methods text[] := '{}';
  timings text[] := '{}';
  till text; pb text; pochi text; send text; dep int; m text[];
begin
  if btrim(t) = '' then return null; end if;
  m := regexp_match(t, '(?:till|buy goods)(?:\s*(?:no\.?|number|#))?\s*[:\-]?\s*(\d{5,7})(?!\d)');
  if m is not null then till := m[1]; methods := array_append(methods, 'mpesa_till');
  elsif t ~ '\mtill\M|buy goods' and t !~ 'airtel' then methods := array_append(methods, 'mpesa_till'); end if;
  m := regexp_match(t, 'pay\s*bill(?:\s*(?:no\.?|number|#))?\s*[:\-]?\s*(\d{5,7})(?!\d)');
  if m is not null then pb := m[1]; methods := array_append(methods, 'mpesa_paybill');
  elsif t ~ 'pay\s*bill' then methods := array_append(methods, 'mpesa_paybill'); end if;
  if t ~ 'pochi' then
    methods := array_append(methods, 'pochi');
    m := regexp_match(t, 'pochi[^0-9+]{0,30}((?:\+?254|0)[17][0-9 ]{8,11})');
    if m is not null then pochi := public.ke_mobile_e164(m[1]); end if;
  end if;
  m := regexp_match(t, '(?:send money|tuma pesa|send to)[^0-9+]{0,20}((?:\+?254|0)[17][0-9 ]{8,11})');
  if m is not null then send := public.ke_mobile_e164(m[1]); end if;
  if send is not null then methods := array_append(methods, 'mpesa_send');
  elsif t ~ 'm-?pesa' and not (methods && array['mpesa_till', 'mpesa_paybill', 'pochi']) then methods := array_append(methods, 'mpesa_send'); end if;
  if t ~ 'airtel' then methods := array_append(methods, 'airtel'); end if;
  if t ~ '\mcash\M' then methods := array_append(methods, 'cash'); end if;
  if t ~ '\mcards?\M|visa|mastercard|\mpos\M' then methods := array_append(methods, 'card'); end if;
  if t ~ '\mbank|\meft\M|rtgs|pesalink' then methods := array_append(methods, 'bank'); end if;
  m := regexp_match(t, '(\d{1,2})\s*%\s*(?:deposit|down|upfront|advance)');
  if m is null then m := regexp_match(t, '(?:deposit|down|upfront|advance)[^\d%]{0,20}(\d{1,2})\s*%'); end if;
  if m is not null then dep := greatest(1, m[1]::int); end if;
  if t ~ 'before delivery|pay first|in advance' then timings := array_append(timings, 'before_delivery'); end if;
  if t ~ 'on delivery|\mcod\M' then timings := array_append(timings, 'on_delivery'); end if;
  if t ~ 'after (the )?(job|work|service)' then timings := array_append(timings, 'after_service'); end if;
  if dep is not null then timings := array_append(timings, 'deposit_then_balance'); end if;
  if cardinality(methods) = 0 and cardinality(timings) = 0 then return null; end if;
  -- airtel / bank need numbers we can't read reliably: listed as methods, details left for the owner.
  return jsonb_build_object('version', 2, 'methods', to_jsonb(methods), 'mpesa_till', till,
    'mpesa_paybill', case when pb is not null then jsonb_build_object('business_no', pb, 'account_mode', 'fixed', 'account', null) end,
    'pochi', case when pochi is not null then jsonb_build_object('phone', pochi) end,
    'mpesa_send', case when send is not null then jsonb_build_object('phone', send, 'name', null) end,
    'airtel', null, 'bank', null, 'card', null,
    'timings', to_jsonb(timings), 'deposit_percent', dep, 'note', null,
    'source', 'parsed', 'confirmed', false, 'parsed_from', left(btrim(p), 500));
end $$;

-- 5. Data -------------------------------------------------------------------------
-- 5a. Existing typed payments -> v2.
update public.tenants
   set business_policies = jsonb_set(business_policies, '{payments}', public.payments_to_v2(business_policies->'payments'))
 where jsonb_typeof(business_policies) = 'object'
   and jsonb_typeof(business_policies->'payments') = 'object'
   and coalesce(business_policies->'payments'->>'version', '1') <> '2';

-- 5b. Payment text never read yet -> parsed v2, unconfirmed ("Is this right?" in Settings).
-- Only the payment line: the old `deposit` text is about holds, not paying.
update public.tenants
   set business_policies = business_policies || jsonb_build_object('payments', public.parse_payments_text(business_policies->>'payment'))
 where jsonb_typeof(business_policies) = 'object'
   and business_policies->'payments' is null
   and public.parse_payments_text(business_policies->>'payment') is not null;

-- 5c. Parsed but unconfirmed v2 rows whose number was lost in v1 (pochi / send money): re-read.
update public.tenants
   set business_policies = jsonb_set(business_policies, '{payments}', public.parse_payments_text(business_policies->>'payment'))
 where jsonb_typeof(business_policies) = 'object'
   and business_policies->'payments'->>'source' = 'parsed'
   and coalesce((business_policies->'payments'->>'confirmed')::boolean, false) = false
   and public.parse_payments_text(business_policies->>'payment') is not null
   and (public.parse_payments_text(business_policies->>'payment')->'pochi' <> 'null'::jsonb
     or public.parse_payments_text(business_policies->>'payment')->'mpesa_send' <> 'null'::jsonb);
