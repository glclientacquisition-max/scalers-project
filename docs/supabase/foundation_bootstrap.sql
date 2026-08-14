-- =============================================================================
-- foundation_bootstrap.sql
-- PRODUCTION-AUTHORITATIVE / HISTORICALLY-UNVERIFIED
-- =============================================================================
--
-- Reconstructed from production catalog introspection (read-only audit Phase 3D-4).
-- Represents the CURRENT VERIFIED PRODUCTION SHAPE of the three foundation tables.
--
-- This is NOT the recovered historical bootstrap.
-- Original foundation CREATE TABLE provenance is UNKNOWN.
-- Do NOT use commit 9153a09 schema.sql CREATE TABLE as a source (superseded shape).
--
-- Production project: fjxcdccgyhnvnnlnovcl (ALCR)
-- PostgreSQL: 17.6
-- Reconstruction date: 2026-08-14
--
-- DO NOT apply directly to ALCR production.
-- Intended for staging bootstrap, greenfield reproducibility, and human review only.
--
-- Prerequisites on target project:
--   - auth.users (Supabase Auth)
--   - public.current_user_tenant_ids() for RLS policies (see owner_rls.sql)
--
-- After this file on a greenfield project, continue with docs/supabase/README.md
-- tiers (multi_tenant_onboarding.sql onward). Additive scripts should no-op.
--
-- Extensions note:
--   uuid-ossp is REQUIRED (uuid_generate_v4 defaults).
--   pgcrypto exists on production ALCR but is NOT required by these foundation tables.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "uuid-ossp";

-- pgcrypto is present on production ALCR (1.3) but not a dependency of these tables.

-- ---------------------------------------------------------------------------
-- 2) public.tenants (49 columns)
-- ---------------------------------------------------------------------------
create table if not exists public.tenants (
  id uuid not null default uuid_generate_v4(),
  created_at timestamptz not null default timezone('utc'::text, now()),
  business_name text not null,
  sautikit_virtual_number text not null,
  whatsapp_notification_number text not null,
  llm_system_prompt text,
  telecom_wallet_balance_kes numeric(10, 2) default 0.00,
  ai_wallet_balance_usd numeric(10, 2) default 0.00,
  is_active boolean default true,
  owner_user_id uuid references auth.users (id),
  voice_languages text[] not null default array['en'::text, 'sw'::text, 'sheng'::text],
  voice_language_other text,
  business_hours text,
  services_offered text,
  agent_tone text,
  unknown_answer_fallback text,
  agent_name text not null default 'Receptionist'::text,
  team_directory jsonb not null default '[]'::jsonb,
  faqs jsonb not null default '[]'::jsonb,
  hours_schedule jsonb,
  after_hours_mode text not null default 'serve'::text,
  services_catalog jsonb not null default '[]'::jsonb,
  daily_bulletin jsonb not null default '[]'::jsonb,
  escalation_enabled boolean not null default true,
  alert_email text,
  wallet_balance_kes numeric default 0,
  wallet_low_balance_kes numeric default 200,
  billing_enforcement text default 'off'::text,
  beta_notes text,
  beta_expires_at timestamptz,
  agent_tools jsonb not null default '{"end_call": true, "escalate": true}'::jsonb,
  vertical text not null default 'general'::text,
  handoff_mode text not null default 'callback'::text,
  business_locations jsonb not null default '[]'::jsonb,
  business_policies jsonb not null default '{}'::jsonb,
  soft_spend_limit_enabled boolean not null default false,
  soft_spend_limit_kes numeric,
  on_demand_usage_enabled boolean not null default false,
  wallet_low_alert_sent_at timestamptz,
  wallet_empty_alert_sent_at timestamptz,
  tts_lexicon jsonb not null default '[]'::jsonb,
  product_catalog jsonb not null default '[]'::jsonb,
  social_handles jsonb not null default '{}'::jsonb,
  soniox_voice_id text,
  soniox_voice_label text,
  pronunciation_review_queue jsonb not null default '[]'::jsonb,
  pronunciation_scan_dismissals jsonb not null default '[]'::jsonb,
  pronunciation_gemini_scan_logs jsonb not null default '[]'::jsonb,
  notify_channels jsonb not null default '{"sms": true, "email": true, "whatsapp": true}'::jsonb,
  constraint tenants_pkey primary key (id),
  constraint tenants_sautikit_virtual_number_key unique (sautikit_virtual_number),
  constraint tenants_after_hours_mode_check check (
    after_hours_mode = any (array['serve'::text, 'message'::text])
  ),
  constraint tenants_soft_spend_limit_kes_check check (
    soft_spend_limit_kes is null or soft_spend_limit_kes >= 500::numeric
  )
);

comment on column public.tenants.telecom_wallet_balance_kes is
  'DEPRECATED — use wallet_balance_kes. Kept for rollback / history.';
comment on column public.tenants.ai_wallet_balance_usd is
  'DEPRECATED — AI is bundled into KES wallet_balance_kes.';
comment on column public.tenants.voice_languages is
  'Automatic receptionist languages: en, sw, sheng (no user picker; locals later)';
comment on column public.tenants.voice_language_other is
  'Reserved for future local-language support';
comment on column public.tenants.business_hours is
  'Owner-facing hours and service area; compiled into llm_system_prompt';
comment on column public.tenants.services_offered is
  'Owner-facing services and pricing; compiled into llm_system_prompt';
comment on column public.tenants.agent_tone is
  'Owner tone preference: professional | friendly | localized';
comment on column public.tenants.unknown_answer_fallback is
  'Owner-written line the receptionist says when asked about something not offered';
comment on column public.tenants.hours_schedule is
  'Weekly open hours JSON: {timezone, days:{mon..sun:{open,close}|null}, location}. Used live for open/closed.';
comment on column public.tenants.after_hours_mode is
  'When closed: serve = help fully with expectations; message = take a callback note';
comment on column public.tenants.services_catalog is
  'Structured services [{name, price_range, notes, out_of_scope}] used live + for prompt compile';
comment on column public.tenants.daily_bulletin is
  'Temporary owner updates [{id,text,active,starts_at,ends_at,created_at}] injected live at call time';
comment on column public.tenants.escalation_enabled is
  'When true, voice may escalate to Team Directory and send owner/teammate alerts. When false, skip escalation notify.';
comment on column public.tenants.alert_email is
  'Owner alert email used as fallback when WhatsApp sender is unavailable or send fails.';
comment on column public.tenants.wallet_balance_kes is
  'Owner prepaid wallet in KES (telecom + AI bundled). Cached sum of wallet_ledger.';
comment on column public.tenants.wallet_low_balance_kes is
  'UI / alert threshold in KES (default 200).';
comment on column public.tenants.billing_enforcement is
  'off = beta free (whitelist); soft = prepaid debit no block; hard = prepaid + block later';
comment on column public.tenants.beta_notes is
  'Ops note for beta whitelist reason';
comment on column public.tenants.beta_expires_at is
  'Optional end of free beta; null = open-ended';
comment on column public.tenants.agent_tools is
  'Receptionist tool toggles: escalate, end_call. save_caller_info is always enabled.';
comment on column public.tenants.vertical is
  'Business pack: general | retail | home_services | hospitality';
comment on column public.tenants.handoff_mode is
  'Human handoff preference: callback (WhatsApp/email) | live_transfer (when telephony supports it)';
comment on column public.tenants.business_locations is
  'Locations [{label, address, landmark, directions, coverage_notes}] for live directions';
comment on column public.tenants.business_policies is
  'Keyed policies {returns, delivery, payment, deposit, cancellation, warranty, other}';
comment on column public.tenants.soft_spend_limit_enabled is
  'Owner opt-in monthly soft spend budget. false = no limit (default).';
comment on column public.tenants.soft_spend_limit_kes is
  'Monthly soft spend budget in KES when enabled. Soft = warn only; never blocks calls.';
comment on column public.tenants.on_demand_usage_enabled is
  'Owner opt-in: when prepaid balance <= 0, continue charging (on-demand/overdraft). Default false.';
comment on column public.tenants.wallet_low_alert_sent_at is
  'Last automatic low-balance live alert; cleared when balance recovers above threshold.';
comment on column public.tenants.wallet_empty_alert_sent_at is
  'Last automatic empty-prepaid live alert; cleared when balance recovers above 0.';
comment on column public.tenants.tts_lexicon is
  'Optional TTS pronunciation overrides: [{match, say, langs?, priority?}].';
comment on column public.tenants.product_catalog is
  'Retail/product rows: [{name, sku, category, price, unit, in_stock, notes, aliases[]}]. Separate from services_catalog.';
comment on column public.tenants.social_handles is
  'Public social / web handles: {website, instagram, facebook, tiktok, twitter, youtube, whatsapp, other}.';
comment on column public.tenants.soniox_voice_id is
  'Optional Soniox cloned voice UUID from platform catalog; null uses default.';
comment on column public.tenants.soniox_voice_label is
  'Owner label for the phone voice profile (desk display only).';
comment on column public.tenants.pronunciation_review_queue is
  'Pending Gemini/manual pronunciation review candidates. Not live TTS until approved.';
comment on column public.tenants.pronunciation_scan_dismissals is
  'Rejected/snoozed Gemini scan keys so the same call+word does not resurface.';
comment on column public.tenants.pronunciation_gemini_scan_logs is
  'Recent Gemini Scan run logs (tenant debugging). Capped in app code.';
comment on column public.tenants.notify_channels is
  'Owner notify prefs: {sms, whatsapp, email} booleans. Platform still greys channels that are not live yet.';

-- ---------------------------------------------------------------------------
-- 3) public.calls (15 columns)
-- ---------------------------------------------------------------------------
create table if not exists public.calls (
  id uuid not null default uuid_generate_v4(),
  created_at timestamptz not null default timezone('utc'::text, now()),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  caller_number text not null,
  sautikit_call_sid text,
  status text default 'in_progress'::text,
  duration_seconds integer default 0,
  ai_processing_minutes numeric(10, 2) default 0.00,
  recording_url text,
  sentiment text,
  summary text,
  lead_status text not null default 'new'::text,
  resolution text not null default 'unknown'::text,
  primary_intent text,
  resolution_note text,
  constraint calls_pkey primary key (id),
  constraint calls_sautikit_call_sid_key unique (sautikit_call_sid),
  constraint calls_lead_status_check check (
    lead_status = any (
      array['new'::text, 'contacted'::text, 'resolved'::text, 'archived'::text]
    )
  ),
  constraint calls_resolution_check check (
    resolution = any (
      array[
        'resolved'::text,
        'needs_human'::text,
        'abandoned'::text,
        'unresolved'::text,
        'unknown'::text
      ]
    )
  )
);

comment on column public.calls.ai_processing_minutes is
  'Billable AI minutes for this call (usually duration_seconds / 60); written by voice engine';
comment on column public.calls.lead_status is
  'Owner triage state: new | contacted (Followed Up) | resolved (Done) | archived';
comment on column public.calls.resolution is
  'AI assist outcome: resolved | needs_human | abandoned | unresolved | unknown';
comment on column public.calls.primary_intent is
  'Best-effort primary caller intent from the live Brain state.';
comment on column public.calls.resolution_note is
  'Short note about how the call ended (hold saved, escalate, etc.).';

-- ---------------------------------------------------------------------------
-- 4) public.transcripts (6 columns — one row per utterance)
-- ---------------------------------------------------------------------------
create table if not exists public.transcripts (
  id uuid not null default uuid_generate_v4(),
  created_at timestamptz not null default timezone('utc'::text, now()),
  call_id uuid not null references public.calls (id) on delete cascade,
  speaker text not null,
  text_content text not null,
  latency_ms integer,
  constraint transcripts_pkey primary key (id)
);

-- ---------------------------------------------------------------------------
-- 5) Row Level Security (production-verified post-P0 state)
-- Requires public.current_user_tenant_ids() from owner_rls.sql
-- ---------------------------------------------------------------------------
alter table public.tenants enable row level security;
alter table public.calls enable row level security;
alter table public.transcripts enable row level security;

drop policy if exists tenants_select_member on public.tenants;
create policy tenants_select_member
  on public.tenants
  for select
  to authenticated
  using (id in (select public.current_user_tenant_ids()));

drop policy if exists tenants_update_member on public.tenants;
create policy tenants_update_member
  on public.tenants
  for update
  to authenticated
  using (id in (select public.current_user_tenant_ids()))
  with check (id in (select public.current_user_tenant_ids()));

drop policy if exists calls_select_member on public.calls;
create policy calls_select_member
  on public.calls
  for select
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists calls_update_member on public.calls;
create policy calls_update_member
  on public.calls
  for update
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

drop policy if exists transcripts_select_member on public.transcripts;
create policy transcripts_select_member
  on public.transcripts
  for select
  to authenticated
  using (
    call_id in (
      select c.id
      from public.calls c
      where c.tenant_id in (select public.current_user_tenant_ids())
    )
  );

-- P0: legacy "Enable all access for service role only" policies must NOT exist.
-- Apply fix_p0_rls_remove_legacy_allow_all.sql if migrating an older project.

-- ---------------------------------------------------------------------------
-- 6) Grants (production-verified snapshot)
-- ---------------------------------------------------------------------------
grant select, update on public.tenants to authenticated;
grant select on public.calls to authenticated;
grant select on public.transcripts to authenticated;

revoke update on public.calls from authenticated;
grant update (lead_status, resolution, primary_intent, resolution_note)
  on public.calls to authenticated;

revoke update on public.tenants from authenticated;
grant update (
  business_name,
  whatsapp_notification_number,
  alert_email,
  llm_system_prompt,
  business_hours,
  hours_schedule,
  after_hours_mode,
  services_offered,
  services_catalog,
  agent_name,
  agent_tone,
  team_directory,
  faqs,
  unknown_answer_fallback,
  daily_bulletin,
  voice_languages,
  voice_language_other,
  escalation_enabled,
  agent_tools,
  vertical,
  handoff_mode,
  business_locations,
  business_policies,
  tts_lexicon,
  product_catalog,
  social_handles,
  soniox_voice_id,
  soniox_voice_label,
  pronunciation_review_queue,
  pronunciation_scan_dismissals,
  pronunciation_gemini_scan_logs
) on public.tenants to authenticated;

-- Production gap (verified 2026-08-14): notify_channels lacks authenticated UPDATE grant.
-- Add when fixing Desk notify-channel persistence:
-- grant update (notify_channels) on public.tenants to authenticated;

-- ---------------------------------------------------------------------------
-- 7) Trigger (production-verified wallet column guard)
-- ---------------------------------------------------------------------------
create or replace function public.tenants_protect_wallet_columns()
returns trigger
language plpgsql
as $$
begin
  if current_setting('scalers.wallet_write', true) = '1' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.wallet_balance_kes is distinct from old.wallet_balance_kes
      or new.wallet_low_balance_kes is distinct from old.wallet_low_balance_kes
      or new.billing_enforcement is distinct from old.billing_enforcement
      or new.telecom_wallet_balance_kes is distinct from old.telecom_wallet_balance_kes
      or new.ai_wallet_balance_usd is distinct from old.ai_wallet_balance_usd
      or new.beta_notes is distinct from old.beta_notes
      or new.beta_expires_at is distinct from old.beta_expires_at
      or new.soft_spend_limit_enabled is distinct from old.soft_spend_limit_enabled
      or new.soft_spend_limit_kes is distinct from old.soft_spend_limit_kes
      or new.on_demand_usage_enabled is distinct from old.on_demand_usage_enabled
      or new.wallet_low_alert_sent_at is distinct from old.wallet_low_alert_sent_at
      or new.wallet_empty_alert_sent_at is distinct from old.wallet_empty_alert_sent_at
    then
      raise exception 'wallet/billing columns are RPC-only';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tenants_protect_wallet_columns on public.tenants;
create trigger tenants_protect_wallet_columns
  before update on public.tenants
  for each row execute function public.tenants_protect_wallet_columns();
