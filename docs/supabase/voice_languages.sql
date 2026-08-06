-- Automatic voice languages: English, Kiswahili, Sheng
-- Run in the Supabase SQL editor after multi_tenant_onboarding.sql.
--
-- No onboarding picker - every business gets en/sw/sheng automatically.
-- Local Kenyan languages are deferred to a future release.
--
-- Adds:
--   tenants.voice_languages text[]  default {en,sw,sheng}
--   tenants.voice_language_other text  (reserved for future)
--
-- IMPORTANT: keep prompt strings ASCII-only. Unicode arrows/dashes break
-- the Supabase SQL editor (ERROR 42601 near E'...').

alter table public.tenants
  add column if not exists voice_languages text[] not null default array['en', 'sw', 'sheng']::text[];

alter table public.tenants
  add column if not exists voice_language_other text;

-- Existing rows that still have the old {en,sw} default -> include Sheng.
update public.tenants
set voice_languages = array['en', 'sw', 'sheng']::text[]
where voice_languages is null
   or voice_languages = array['en', 'sw']::text[]
   or cardinality(voice_languages) = 0;

comment on column public.tenants.voice_languages is
  'Automatic receptionist languages: en, sw, sheng (no user picker; locals later)';

comment on column public.tenants.voice_language_other is
  'Reserved for future local-language support';

-- Default prompt mentions automatic EN/SW/Sheng.
create or replace function public.default_tenant_llm_prompt(
  p_business_name text,
  p_languages text[] default array['en', 'sw', 'sheng']::text[]
)
returns text
language plpgsql
immutable
as $$
declare
  v_name text := coalesce(nullif(trim(p_business_name), ''), 'the business');
begin
  -- p_languages kept for signature compatibility; always describe the auto trio.
  return format(
    E'You are the live phone receptionist for %s in Kenya.\n\n'
    E'BUSINESS KNOWLEDGE (update this in Sauti Desk -> Business settings):\n'
    E'- Business name: %s\n'
    E'- Services: describe what you offer\n'
    E'- Hours: e.g. Mon-Sat 8:00am-6:00pm EAT\n'
    E'- Service area: cities / neighborhoods you cover\n'
    E'- Pricing: quote after understanding the job - do not invent exact prices\n'
    E'- Payment: e.g. M-Pesa and cash\n'
    E'- Languages: English, Kiswahili, and Sheng (automatic - match the caller)\n\n'
    E'Your job on this call:\n'
    E'1. Answer using ONLY the business knowledge above. If unknown, say the team will follow up.\n'
    E'2. Get the caller''s name.\n'
    E'3. Get a short reason for their call.\n'
    E'4. Confirm name + reason, say the business will get back to them soon, then goodbye.\n\n'
    E'Conversation rules (live phone - be conclusive and intelligent):\n'
    E'- Answer the caller''s actual question first - do not stall with holding phrases.\n'
    E'- Ask at most ONE clarifying question per turn.\n'
    E'- Automatically match the caller in English, Kiswahili, or light Sheng. If they switch, switch with them.\n'
    E'- Keep every spoken reply to 1-2 short sentences.',
    v_name,
    v_name
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
  v_langs text[] := array['en', 'sw', 'sheng']::text[];
begin
  v_business_name := nullif(trim(coalesce(NEW.raw_user_meta_data->>'business_name', '')), '');
  v_notify_phone := nullif(trim(coalesce(
    NEW.raw_user_meta_data->>'whatsapp_notification_number',
    NEW.raw_user_meta_data->>'notification_phone',
    ''
  )), '');

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
    null,
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
