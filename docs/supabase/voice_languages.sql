-- Voice languages for onboarding (English, Kiswahili, Sheng, Kenyan locals)
-- Run in the Supabase SQL editor after multi_tenant_onboarding.sql.
--
-- Adds:
--   tenants.voice_languages text[]
--   tenants.voice_language_other text
-- Updates Auth trigger to read languages from signup metadata.

alter table public.tenants
  add column if not exists voice_languages text[] not null default array['en', 'sw']::text[];

alter table public.tenants
  add column if not exists voice_language_other text;

comment on column public.tenants.voice_languages is
  'Receptionist languages chosen at onboarding: en, sw, sheng, kikuyu, luo, kamba, kalenjin, luhya, kisii, meru, somali, other';

comment on column public.tenants.voice_language_other is
  'Free-text label when voice_languages includes other';

-- Default prompt can mention languages (business name still primary arg).
create or replace function public.default_tenant_llm_prompt(
  p_business_name text,
  p_languages text[] default array['en', 'sw']::text[]
)
returns text
language plpgsql
immutable
as $$
declare
  v_name text := coalesce(nullif(trim(p_business_name), ''), 'the business');
  v_langs text;
begin
  select string_agg(label, ', ' order by ord)
  into v_langs
  from (
    select
      case code
        when 'en' then 'English'
        when 'sw' then 'Kiswahili'
        when 'sheng' then 'Sheng'
        when 'kikuyu' then 'Kikuyu'
        when 'luo' then 'Luo'
        when 'kamba' then 'Kamba'
        when 'kalenjin' then 'Kalenjin'
        when 'luhya' then 'Luhya'
        when 'kisii' then 'Kisii'
        when 'meru' then 'Meru'
        when 'somali' then 'Somali'
        when 'other' then 'other Kenyan languages'
        else code
      end as label,
      ord
    from unnest(coalesce(nullif(p_languages, '{}'::text[]), array['en', 'sw']::text[]))
      with ordinality as t(code, ord)
  ) x;

  if v_langs is null or length(trim(v_langs)) = 0 then
    v_langs := 'English, Kiswahili';
  end if;

  return format(
    E'You are the live phone receptionist for %s in Kenya.\n\n'
    E'BUSINESS KNOWLEDGE (update this in Sauti Desk → Business settings):\n'
    E'- Business name: %s\n'
    E'- Services: describe what you offer\n'
    E'- Hours: e.g. Mon–Sat 8:00am–6:00pm EAT\n'
    E'- Service area: cities / neighborhoods you cover\n'
    E'- Pricing: quote after understanding the job — do not invent exact prices\n'
    E'- Payment: e.g. M-Pesa and cash\n'
    E'- Languages: %s\n\n'
    E'Your job on this call:\n'
    E'1. Answer using ONLY the business knowledge above. If unknown, say the team will follow up.\n'
    E'2. Get the caller''s name.\n'
    E'3. Get a short reason for their call.\n'
    E'4. Confirm name + reason, say the business will get back to them soon, then goodbye.\n\n'
    E'Conversation rules (live phone — be conclusive and intelligent):\n'
    E'- Answer the caller''s actual question first — do not stall with holding phrases.\n'
    E'- Ask at most ONE clarifying question per turn.\n'
    E'- Mirror the caller''s language within the enabled set (%s). If they switch, switch with them.\n'
    E'- Sheng (if enabled): natural Kenyan street mix — warm, not forced.\n'
    E'- Keep every spoken reply to 1–2 short sentences.',
    v_name,
    v_name,
    v_langs,
    v_langs
  );
end;
$$;

create or replace function public.handle_new_user_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_name text;
  v_notify_phone text;
  v_tenant_id uuid;
  v_langs text[];
  v_other text;
begin
  v_business_name := nullif(trim(coalesce(NEW.raw_user_meta_data->>'business_name', '')), '');
  v_notify_phone := nullif(trim(coalesce(
    NEW.raw_user_meta_data->>'whatsapp_notification_number',
    NEW.raw_user_meta_data->>'notification_phone',
    ''
  )), '');
  v_other := nullif(trim(coalesce(NEW.raw_user_meta_data->>'voice_language_other', '')), '');

  -- voice_languages may be a JSON array in auth metadata.
  if jsonb_typeof(NEW.raw_user_meta_data->'voice_languages') = 'array' then
    select coalesce(array_agg(value order by ordinality), array['en', 'sw']::text[])
    into v_langs
    from jsonb_array_elements_text(NEW.raw_user_meta_data->'voice_languages')
      with ordinality as t(value, ordinality);
  elsif nullif(trim(coalesce(NEW.raw_user_meta_data->>'voice_languages', '')), '') is not null then
    select coalesce(array_agg(trim(both from x)), array['en', 'sw']::text[])
    into v_langs
    from unnest(string_to_array(NEW.raw_user_meta_data->>'voice_languages', ',')) as x
    where length(trim(both from x)) > 0;
  else
    v_langs := array['en', 'sw']::text[];
  end if;

  if v_business_name is null then
    return NEW;
  end if;

  if v_notify_phone is null then
    v_notify_phone := 'pending';
  end if;

  insert into public.tenants (
    business_name,
    sautikit_virtual_number,
    whatsapp_notification_number,
    llm_system_prompt,
    voice_languages,
    voice_language_other,
    is_active,
    owner_user_id,
    telecom_wallet_balance_kes,
    ai_wallet_balance_usd
  ) values (
    v_business_name,
    'pending:' || NEW.id::text,
    v_notify_phone,
    public.default_tenant_llm_prompt(v_business_name, v_langs),
    v_langs,
    v_other,
    true,
    NEW.id,
    0,
    0
  )
  returning id into v_tenant_id;

  insert into public.tenant_members (user_id, tenant_id, role)
  values (NEW.id, v_tenant_id, 'owner')
  on conflict (user_id, tenant_id) do nothing;

  begin
    perform public.assign_did_from_pool(v_tenant_id);
  exception
    when undefined_function then
      null;
  end;

  return NEW;
end;
$$;
