# MISSED-CALL-PROJECT

AI receptionist for East African B2B businesses: answers missed / busy / after-hours calls, captures name + reason, and notifies the owner on WhatsApp.

## Current stack

- **Telephony:** Twilio ConversationRelay  
- **LLM:** Google Gemini  
- **DB / Storage:** Supabase PostgreSQL (`tenants`, `calls`, `transcripts`) + `call-recordings` bucket  
- **Entry:** `npm start` → `server.js`

## Setup

1. Copy `.env.example` → `.env` and fill Twilio, Gemini, and Supabase keys.
2. Ensure schema matches [`docs/supabase/schema.sql`](docs/supabase/schema.sql) (or your live equivalent).
3. `npm install && npm start`
4. Optional DB smoke test: `npm run smoke:db`

## Production direction

See the architecture and phased cutover plan:

**[docs/ARCHITECTURE_MIGRATION_BLUEPRINT.md](docs/ARCHITECTURE_MIGRATION_BLUEPRINT.md)**

Target stack: **SautiKit** (telephony) + **Soniox** (STT/TTS) + **Gemini / GPT-4o-mini** + **Supabase**, with a custom Node.js media orchestrator and a Next.js admin dashboard.
