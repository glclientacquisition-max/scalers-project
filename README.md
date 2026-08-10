# MISSED-CALL-PROJECT

AI receptionist for East African B2B businesses: answers missed / busy / after-hours calls, captures name + reason, and notifies the owner on WhatsApp.

## Current stack

- **Telephony:** SautiKit (Stream XML + PCM WebSocket)
- **Speech:** Soniox realtime STT + TTS
- **LLM:** Google Gemini
- **DB / Storage:** Supabase PostgreSQL (`tenants`, `calls`, `transcripts`) + `call-recordings` bucket
- **Entry:** `npm start` → `server.js`

## Setup (local)

1. Copy `.env.example` → `.env` and fill keys (see comments).
2. Ensure schema matches [`docs/supabase/schema.sql`](docs/supabase/schema.sql).
3. `npm install && npm start`
4. Optional DB smoke: `npm run smoke:db`
5. Local tunnel for SautiKit: [`docs/WEBHOOK_TUNNEL.md`](docs/WEBHOOK_TUNNEL.md)  
   Prefer `npm run tunnel:cloudflared`.

## Production cutover (Phase 5)

See **[`docs/PRODUCTION_CUTOVER.md`](docs/PRODUCTION_CUTOVER.md)** — Railway/Render deploy, point SautiKit voice + events URLs, WhatsApp lead notify.

## Admin dashboard (Phase 6)

Next.js app in [`dashboard/`](dashboard/) — call history, transcripts, business prompt editor.  
Local: `cd dashboard && npm install && npm run dev` (see [`dashboard/README.md`](dashboard/README.md)).

## Architecture

**[docs/ARCHITECTURE_MIGRATION_BLUEPRINT.md](docs/ARCHITECTURE_MIGRATION_BLUEPRINT.md)**

## Agent lanes

Specialized Cursor chats/agents: **[AGENTS.md](AGENTS.md)** (Voice contract: [`docs/agents/VOICE.md`](docs/agents/VOICE.md)).
