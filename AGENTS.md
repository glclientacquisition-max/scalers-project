# Scalers agent lanes

Specialized Cursor agents / chats. One task → one lane → one PR.

| Lane | Scope | Contract |
| --- | --- | --- |
| **Voice** | Telephony media, STT/TTS, turn-taking, call latency | [`docs/agents/VOICE.md`](docs/agents/VOICE.md) · speed plan: [`VOICE_SPEED_CONSISTENCY.md`](docs/agents/VOICE_SPEED_CONSISTENCY.md) · live findings: [`LIVE_CALL_FINDINGS.md`](docs/agents/LIVE_CALL_FINDINGS.md) · ChapterOne setup: [`CHAPTERONE_SETUP_REVIEW.md`](docs/agents/CHAPTERONE_SETUP_REVIEW.md) |
| **Brain** | Prompts, conversation logic, tools, knowledge compile | [`docs/agents/BRAIN.md`](docs/agents/BRAIN.md) |
| **Desk UI/UX** | Owner desk + marketing UI | [`docs/agents/DESK_UX.md`](docs/agents/DESK_UX.md) |
| **Ops & Billing** | Wallet, DID pool, Super Admin | [`docs/agents/OPS_BILLING.md`](docs/agents/OPS_BILLING.md) |
| **Platform** | DB surface, auth/RLS, deploy, shared contracts | [`docs/agents/PLATFORM.md`](docs/agents/PLATFORM.md) |

**Copy-paste chat starters:** [`docs/agents/PROMPTS.md`](docs/agents/PROMPTS.md)

## Rules of engagement

1. Stay inside your lane’s **owns** paths. Ask Platform before changing `src/db.js` API or Supabase SQL.
2. Do not run parallel agents that both edit `server.js` heavily.
3. Paste the lane prompt from `docs/agents/PROMPTS.md` (or `@docs/agents/…`) at the start of each new chat.
4. Prefer fresh chats per ticket; do not keep one eternal mega-thread.
5. Schema / RPC / auth contract changes: **Platform first**, then feature lanes.
