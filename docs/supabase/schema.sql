-- Live Supabase schema (introspected 2026-08-06) for MISSED-CALL-PROJECT.
-- App code in src/db.js maps to these tables. Do not invent alternate names.

-- tenants
--   id uuid PK
--   created_at timestamptz
--   business_name text NOT NULL
--   sautikit_virtual_number text NOT NULL
--   whatsapp_notification_number text NOT NULL
--   llm_system_prompt text
--   telecom_wallet_balance_kes numeric
--   ai_wallet_balance_usd numeric
--   is_active boolean

-- calls
--   id uuid PK
--   created_at timestamptz
--   tenant_id uuid NOT NULL → tenants.id
--   caller_number text NOT NULL
--   sautikit_call_sid text  (unique; also stores Twilio CallSid during Phase 1)
--   status text
--   duration_seconds int
--   ai_processing_minutes numeric
--   recording_url text
--   sentiment text
--   summary text  (JSON blob for name/reason/whatsapp_sent/to_number/provider/…)

-- transcripts  (one row per utterance)
--   id uuid PK
--   created_at timestamptz
--   call_id uuid NOT NULL → calls.id
--   speaker text NOT NULL   ('caller' | 'agent' | 'system')
--   text_content text NOT NULL
--   latency_ms int

-- Storage bucket: call-recordings (private)

-- Optional seed for single-tenant / smoke tests:
-- insert into public.tenants (
--   business_name, sautikit_virtual_number, whatsapp_notification_number, is_active
-- ) values (
--   'Jirani Home Services', '+254709221536', '+254119774470', true
-- );
--
-- If an older smoke DID is still stored, update it:
-- update public.tenants
-- set sautikit_virtual_number = '+254709221536'
-- where sautikit_virtual_number = '+254200000001';
