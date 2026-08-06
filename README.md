# MISSED-CALL-PROJECT

AI receptionist for East African B2B businesses: answers missed / busy / after-hours calls, captures name + reason, and notifies the owner on WhatsApp.

## Current (Phase 1)

- **Telephony:** Twilio ConversationRelay  
- **LLM:** Google Gemini  
- **DB:** SQLite (`db.js`)  
- **Entry:** `npm start` → `server.js`

## Production direction

- **Requirements (what to build):** [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)
- **Architecture & migration plan:** [docs/ARCHITECTURE_MIGRATION_BLUEPRINT.md](docs/ARCHITECTURE_MIGRATION_BLUEPRINT.md)

Target stack: **SautiKit** (telephony) + **Soniox** (STT/TTS) + **Gemini / GPT-4o-mini** + **Supabase**, with a custom Node.js media orchestrator and a Next.js admin dashboard.
