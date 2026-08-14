# ADR-0001 — SautiKit + Soniox + Supabase voice stack

## Status

**Accepted** — Reconstructed historical decision

## Context

Scalers began as an AI receptionist using Twilio ConversationRelay (text-in/text-out over WebSocket), local SQLite, and a single Express process. For Kenya B2B production, the team needed:

- Local +254 DIDs and KES-aligned telephony economics
- Sub-second voice latency with owned PCM pipeline
- Multi-tenant SaaS persistence with owner dashboard access control

Git evidence: `4907ea7` architecture blueprint PR #2; `9153a09` Supabase migration; `aca2233` SautiKit Stream; `d19a1dd` Twilio removed from boot requirements.

## Decision

Adopt a **hybrid custom voice stack**:

| Layer | Choice |
| --- | --- |
| Telephony | SautiKit Stream XML + PCM WebSocket (`audio.drachtio.org`) |
| STT/TTS | Soniox realtime WebSockets |
| LLM | Google Gemini |
| Persistence | Supabase PostgreSQL + Storage |
| Voice hosting | Railway/Render (long-lived WebSocket) |
| Desk | Next.js on Vercel |

Twilio ConversationRelay remains as legacy `/ws/relay` only — not expanded.

## Alternatives considered

| Alternative | Why not chosen (per blueprint) |
| --- | --- |
| Twilio ConversationRelay (stay) | Higher cost, less control over PCM latency and Kenya telephony |
| Managed voice agent (Vapi/Retell) | Cost and turn-taking control |
| SQLite (stay) | No multi-tenant SaaS, no RLS, no desk Auth integration |
| OpenAI realtime (stay on GPT only) | Gemini retained; provider flag documented but not implemented |

## Consequences

- `server.js` owns full duplex PCM orchestration (~2,841 LOC today).
- Soniox and SautiKit are hard production dependencies.
- Supabase service role required on voice engine; RLS for owners.
- Legacy `/ws/relay` and Twilio references remain in code/docs as historical artifacts.

## Date

Reconstructed: 2026-08-14 (decisions landed August 2026 per Git history)

## Related systems

- `server.js`, `src/speech/`, `src/db.js`
- `docs/ARCHITECTURE_MIGRATION_BLUEPRINT.md`
- [`../architecture/CURRENT_STATE.md`](../architecture/CURRENT_STATE.md)
