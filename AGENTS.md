# Scalers agent lanes

Specialized Cursor agents / chats. One task → one lane → one PR.

| Lane | Scope | Contract |
| --- | --- | --- |
| **Voice** | Telephony media, STT/TTS, turn-taking, call latency | [`docs/agents/VOICE.md`](docs/agents/VOICE.md) |
| Brain | Prompts, conversation logic, tools, knowledge compile | _(next)_ |
| Desk UI/UX | Owner desk + marketing UI | _(next)_ |
| Ops & Billing | Wallet, DID pool, Super Admin | _(next)_ |
| Platform | DB surface, auth/RLS, deploy, shared contracts | _(next)_ |

## Rules of engagement

1. Stay inside your lane’s **owns** paths. Ask Platform before changing `src/db.js` API or Supabase SQL.
2. Do not run parallel agents that both edit `server.js` heavily.
3. Paste the lane contract (or `@docs/agents/…`) at the start of each new chat.
4. Prefer fresh chats per ticket; do not keep one eternal mega-thread.
