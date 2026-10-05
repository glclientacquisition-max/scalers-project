# How Scalers fits together

**Status:** Entry map. Read this first.  
**Updated:** 2026-10-05  
**Scope:** What is live in the repo today.

Scalers is a Kenya multi-tenant Business Assistant. One business, one phone number, one Desk. This page is the picture. Detail lives in the links at the bottom.

Three runtime pieces:

| Piece | Where it runs | What it holds |
| --- | --- | --- |
| Voice | Railway (`server.js`). Render is the alternate host. | The live call |
| Desk | Vercel (`dashboard/`) | What the owner and Super Admin see |
| Supabase | Supabase Cloud | Tenants, calls, contacts, packages, auth, recordings |

SautiKit carries the phone call. Soniox hears and speaks. Gemini decides the next line. TextSMS, SautiKit WhatsApp, and Resend deliver owner alerts.

## A missed call (live)

1. The caller rings the business SautiKit number. SautiKit POSTs to `server.js` (`POST /voice/incoming`, also `/` and `/voice`). `src/sautikit/webhook.js` checks the webhook.
2. The voice process writes a `calls` row through `src/db.js` and answers with Stream XML. SautiKit opens a PCM websocket at `/ws/media` (subprotocol `audio.drachtio.org`, 16 kHz).
3. Soniox STT (`src/speech/sonioxStt.js`) turns audio into text. Turn-taking and barge-in live in `src/speech/`.
4. Brain state for this call sits in memory (`src/conversation/brainState.js`). The prompt is the tenant's compiled text plus live facts (`src/prompts.js`). Gemini runs inside `server.js` (`runGeminiTurnStreaming`).
5. Tool markers in the model reply are parsed and run (`toolMarkers.js`, `toolExecution.js`). Saving the caller's name and reason writes the lead. A human request notifies a teammate and leaves a Desk note. That async handoff is shipped ([`../product/ESCALATION.md`](../product/ESCALATION.md)).
6. Soniox TTS speaks the reply back down the same websocket.
7. On hangup, SautiKit POSTs `/voice/events`. The process stores duration, resolution, and any recording. Included minutes are metered. Past the package, on-demand can debit. While `billing_enforcement` is off, usage is metered and the tenant is not charged.
8. Owner notify goes SMS, then WhatsApp, then email, for channels the business turned on (`src/notifications/dispatch.js`).

```text
Caller → SautiKit → server.js /voice/incoming
                 → /ws/media → Soniox STT → Gemini → tools → Soniox TTS
                 → Supabase (call, lead) → owner SMS / WhatsApp / email
```

`server.js` is still the orchestrator. Speech, brain, billing helpers, and notify already live under `src/`. The next code change is to lift telephony out of `server.js` into `src/telephony/` with no change to this path. That layout is a target, not the tree you clone: [`TARGET_MODULE_LAYOUT.md`](./TARGET_MODULE_LAYOUT.md).

`/ws/relay` is still wired. It is the old ConversationRelay text loop. It is not the production path.

## Not shipped

- Live Dial to a person during the call. Spec only: [`../product/LIVE_TRANSFER.md`](../product/LIVE_TRANSFER.md). The shipped handoff is the async notify above.
- Owner M-Pesa checkout for a package. Super Admin assigns the package. See [`../operations/PACKAGES.md`](../operations/PACKAGES.md).

## Desk

Next.js app in `dashboard/`. Vercel project root is `dashboard`.

Owners sign in with Supabase Auth. They see Overview, Inbox, Contacts, Usage, and Settings (`dashboard/src/components/DeskNav.tsx`). Setup and onboarding compile business facts into `tenants.llm_system_prompt`. The Inbox is the call list. The owner approves a text to the caller (Confirm or Done) before it sends, when text to customers is on. Usage (`/wallet`) shows package buckets. It is not a top-up shop.

Super Admin is a separate shell at `/admin` (Overview, Billing, Businesses, Numbers, Voices). Package assign is `/admin/packages`. Sign-in is Better Auth username plus access code (`dashboard/src/lib/admin-auth.ts`). An old shared-password cookie still works during the transition. Admin routes use the service role on the server and bypass owner row security. Optional host: `admin.scalers.co.ke`.

The Desk reads and writes Supabase. TTS preview calls the voice process (`VOICE_PUBLIC_BASE_URL`, `POST /api/tts/preview`).

## Supabase

Supabase is the system of record.

| Stored here | Examples |
| --- | --- |
| Who the business is | `tenants`, `tenant_members`, compiled prompt, hours, catalog |
| What happened on the phone | `calls`, `transcripts`, recording in the `call-recordings` bucket |
| Who called before | `contacts`, open requests |
| Money | Package counters and `wallet_ledger`. The ledger is metering scaffolding. |
| Which number | `sautikit_did_pool` assigned onto the tenant |

Voice uses the service role (`src/lib/supabaseClient.js`). Owners use their Auth JWT and row-level security. The service role key stays off `NEXT_PUBLIC_*` variables.

SQL is hand-applied from `docs/supabase/`. There is no CLI migrations folder. Apply order: [`../supabase/README.md`](../supabase/README.md). Which scripts are already on the production project is not recorded in git.

## Deploy

| Unit | Host | Entry |
| --- | --- | --- |
| Voice | Railway. Render is the alternate. | `Dockerfile` runs `node server.js` |
| Desk | Vercel | Root directory `dashboard` |
| Data | Supabase | External |

Local voice is `npm start` plus a tunnel when SautiKit must reach your laptop. Staging voice and Desk are documented in [`../operations/ENVIRONMENTS.md`](../operations/ENVIRONMENTS.md). Production hostnames in code are references. This page does not claim a live health check.

## Who edits what

One task, one lane, one pull request. Full path lists: [`../../AGENTS.md`](../../AGENTS.md).

| Lane | Owns |
| --- | --- |
| Voice | `server.js`, `src/speech/`, `src/sautikit/`, call latency |
| Brain | `src/conversation/`, `src/prompts.js`, the Desk prompt compiler |
| Desk | Owner and marketing UI in `dashboard/` |
| Ops & Billing | Packages, DID pool, Super Admin behavior, wallet metering |
| Platform | `src/db.js`, Supabase SQL, auth clients, deploy glue |

Schema changes start with Platform. Then the feature lane.

## Where to read next

| Doc | Kind | Use it for |
| --- | --- | --- |
| [`CURRENT_STATE.md`](./CURRENT_STATE.md) | Fact inventory | File-level facts. August 2026 baseline, with later corrections marked. |
| [`DATA_FLOW.md`](./DATA_FLOW.md) | Fact inventory | What stays in memory on a call, and what is written to Supabase. |
| [`TARGET_MODULE_LAYOUT.md`](./TARGET_MODULE_LAYOUT.md) | Target | Future `src/telephony/` split. Not the current tree. |
| [`ARCHITECTURE_MIGRATION_BLUEPRINT.md`](./ARCHITECTURE_MIGRATION_BLUEPRINT.md) | Historical + target | Twilio and SQLite history, and work still listed as remaining. |
| [`../governance/SOURCE_OF_TRUTH.md`](../governance/SOURCE_OF_TRUTH.md) | Fact inventory | Which file is canonical for each subsystem. |
| [`../agents/AGENT_ARCHITECTURE.md`](../agents/AGENT_ARCHITECTURE.md) | Fact inventory | Prompt layers on a live call. |
| [`../platform/PLATFORM_SYSTEM_MAP.md`](../platform/PLATFORM_SYSTEM_MAP.md) | Fact inventory | Notify, WhatsApp, wallet, and ladder jobs across channels. |
