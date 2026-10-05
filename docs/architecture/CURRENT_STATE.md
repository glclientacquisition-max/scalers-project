# Scalers current state

**Status:** Fact inventory. Not the 5-minute picture.  
**Read first:** [`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md) (updated 2026-10-05).  
**Baseline commit:** `main` @ `5b875dc` (documented 2026-08-14). Sections marked **Updated 2026-10-05** correct later facts.  
**Purpose:** File-level facts about what Scalers is today. The target module split is [`TARGET_MODULE_LAYOUT.md`](./TARGET_MODULE_LAYOUT.md). The Twilio/SQLite history is [`ARCHITECTURE_MIGRATION_BLUEPRINT.md`](./ARCHITECTURE_MIGRATION_BLUEPRINT.md).

Legend: **FACT** = verified in repo or tests. **INFERENCE** = reasonable conclusion from evidence. **UNKNOWN** = not verified in this audit.

---

## Executive summary

Scalers is a Kenya-focused multi-tenant Business Assistant. A **Node.js voice engine** (`server.js`) handles live telephony, speech, and agent reasoning. A **Next.js Desk** (`dashboard/`) is setup, inbox, contacts, usage, and Super Admin. **Supabase** is the system of record for tenants, calls, transcripts, billing, and auth. The picture is [`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md).

**FACT:** Two deploy units: voice on Railway/Render (Docker), desk on Vercel.  
**FACT:** Telephony path is SautiKit + Soniox STT/TTS + Gemini. Twilio is no longer the active telephony path.  
**UNKNOWN:** Live health of production Railway/Vercel deploys and which SQL scripts are applied on the production Supabase project.  
**Updated 2026-10-05:** Staging is documented as active in [`../operations/ENVIRONMENTS.md`](../operations/ENVIRONMENTS.md). CI workflows are in `.github/workflows/`.

---

## Repository structure

Living map: [`../../README.md`](../../README.md) and [`../README.md`](../README.md).

```
server.js                 # Voice HTTP + media websocket + turn loop — FACT
db.js                     # Shim → src/db.js — FACT
src/speech/               # Soniox STT/TTS, turn-taking — FACT
src/conversation/         # Brain runtime, tools, playbooks — FACT
src/notifications/        # SMS, WhatsApp, email — FACT
src/sautikit/             # Webhook guard — FACT
src/billing/              # Package overage, transfer legs — FACT
src/db.js                 # Voice DB API — FACT
dashboard/                # Next.js Desk + Super Admin — FACT
docs/                     # Indexed in docs/README.md — FACT
tests/                    # Node tests — FACT
scripts/                  # Smoke, tunnel, staging helpers — FACT
Dockerfile, railway.toml, render.yaml
```

**FACT:** Not a formal monorepo (no npm workspaces). Root package `missed-call-agent`, desk package `dashboard`.  
**FACT:** CI lives in `.github/workflows/` (`ci.yml` plus staging workflows).  
**FACT:** `server.js`, `src/`, `db.js`, and `dashboard/` stay at these paths. Railway starts `server.js`. Vercel root directory is `dashboard`.

See also: [`../governance/REPOSITORY_INVENTORY.md`](../governance/REPOSITORY_INVENTORY.md).

---

## Frontend (owner desk + Super Admin)

| Area | Path | Role |
| --- | --- | --- |
| Marketing | `dashboard/src/app/page.tsx` | Landing |
| Auth | `login/`, `signup/` | Supabase Auth email/password |
| Onboarding | `onboarding/` | Wizard → compile `llm_system_prompt` |
| Owner desk | `(desk)/` | Overview, Inbox, Contacts, Usage (`/wallet`), Settings. Holds and visits are routes under `requests/` and `appointments/`. |
| Super Admin | `admin/` | Businesses, numbers, wallets, voices |
| API routes | `dashboard/src/app/api/` | Auth, admin, pronunciation preview, voices |

**FACT:** Owner shell uses Supabase Auth JWT + RLS.  
**FACT:** Super Admin uses Better Auth username + access code (`/admin/login`). Optional host `admin.scalers.co.ke`. HMAC `DASHBOARD_PASSWORD` is transition-only.

---

## Backend / voice engine

| Component | Entry | Evidence |
| --- | --- | --- |
| HTTP + WS server | `server.js` | `package.json` `"main": "server.js"`, Dockerfile CMD |
| DB surface | `src/db.js` | All voice persistence |
| Supabase client | `src/lib/supabaseClient.js` | Service role |

**FACT:** Boot requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.  
**FACT:** `GEMINI_API_KEY` and `SONIOX_API_KEY` optional at boot; required for full agent turns.

---

## Telephony

**FACT:** Active path is SautiKit Stream XML → `wss /ws/media` with subprotocol `audio.drachtio.org`.  
**FACT:** Webhook routes: `POST /`, `/voice/incoming`, `/voice`; events at `POST /voice/events`.  
**FACT:** Twilio removed from telephony path (`server.js` header).  
**FACT:** Legacy `/ws/relay` (ConversationRelay) still wired but documented as unused — LEGACY.

---

## STT (speech-to-text)

**FACT:** `src/speech/sonioxStt.js` — Soniox realtime WebSocket (`wss://stt-rt.soniox.com/transcribe-websocket`).  
**FACT:** Per-tenant STT context via `src/speech/sttContext.js` (business name, catalog terms, lexicon).  
**FACT:** Endpointing: Soniox config + local adaptive flush (`src/speech/turnTaking.js`).

---

## LLM (agent reasoning)

**FACT:** Google Gemini via `@google/genai` in `server.js`.  
**FACT:** Default model from env: `GEMINI_MODEL` (`.env.example`: `gemini-3.6-flash`).  
**FACT:** Brain modules in `src/conversation/*` provide state, policy, tools, catalog grounding.  
**INFERENCE:** No `LLM_PROVIDER` switch is implemented despite docs mentioning it.

---

## TTS (text-to-speech)

**FACT:** `src/speech/sonioxTts.js` — Soniox realtime TTS WebSocket.  
**FACT:** Normalization: `ttsNormalize.js`, `pronunciationLexicon.js`, tenant `tts_lexicon` overrides.  
**FACT:** Per-tenant voice: `tenants.soniox_voice_id` + curated catalog (`sonioxVoice.js`).

---

## Database

**FACT:** Supabase PostgreSQL. Tables include `tenants`, `tenant_members`, `calls`, `transcripts`, `wallet_ledger`, `sautikit_did_pool`, `contacts`, `service_requests`, and others — see `docs/supabase/schema.sql` (reference only).  
**FACT:** Schema changes are hand-authored SQL in `docs/supabase/` with documented apply order.  
**FACT:** No Supabase CLI migrations folder in repo.  
**UNKNOWN:** Which SQL scripts are applied on the live production project.

See: [`../database/DATABASE_GOVERNANCE.md`](../database/DATABASE_GOVERNANCE.md).

---

## Authentication

**Updated 2026-10-05.** The August baseline called Super Admin a legacy cookie. The live gate is below.

| Role | Mechanism | Path |
| --- | --- | --- |
| Owner | Supabase Auth JWT + RLS | `dashboard/src/lib/auth.ts`, `owner_rls.sql` |
| Super Admin | Better Auth username + access code | `dashboard/src/lib/admin-auth.ts`, `/admin/login` |
| Transition only | HMAC `DASHBOARD_PASSWORD` cookie | Still accepted inside `isAdminAuthenticated` |
| Voice engine | Service role (bypasses RLS) | `src/lib/supabaseClient.js` |

**FACT:** `isLegacyAuthenticated` is an alias of `isAdminAuthenticated`. It accepts a Better Auth session or the leftover cookie.  
**FACT:** Service role must never appear in `NEXT_PUBLIC_*`.

---

## Billing

**Updated 2026-10-05.** The August "inbound 0 / outbound KES 4" lines are superseded. Customer billing is packages plus on-demand. Owner M-Pesa checkout is not shipped.

**FACT:** Hangup meters included minutes via `consume_call_seconds` once that SQL is applied. On-demand past the cap is KES 0.10/sec (KES 6/min) on the rate card.  
**FACT:** `charge_call_to_wallet` stays idempotent per `call_id`. Env `WALLET_RATE_KES_PER_MINUTE` (default 0) is a fallback when the consume RPC is missing.  
**FACT:** Outbound live-transfer rate is stored at KES 0.15/sec (KES 9/min) and is not offered until Live Dial ships. SautiKit outbound cost is KES 3/min answered. A transfer would be a second `calls` row. See [`../product/LIVE_TRANSFER.md`](../product/LIVE_TRANSFER.md) §8 and [`../operations/PACKAGES.md`](../operations/PACKAGES.md).  
**FACT:** Beta (`billing_enforcement=off`) meters and does not charge. It does not originate outbound transfer unless `VOICE_LIVE_TRANSFER_BETA_OUTBOUND=on`.

---

## Notifications

**FACT:** Dispatch order in `src/notifications/dispatch.js`: TextSMS.co.ke → SautiKit WhatsApp → Resend email.  
**FACT:** Triggers: lead capture, escalation, service requests, wallet alerts.

---

## Deployment

| Unit | Platform | Config |
| --- | --- | --- |
| Voice | Railway (primary), Render alt | `Dockerfile`, `railway.toml`, `render.yaml` |
| Desk | Vercel | `dashboard/vercel.json`, root dir `dashboard` |
| Database | Supabase | External |

**INFERENCE:** Referenced production URLs in code: `scalers-project-production.up.railway.app` (voice), `scalers-project.vercel.app` (desk). This inventory does not confirm they are the live hosts.  
**Updated 2026-10-05:** Staging topology is in [`../operations/ENVIRONMENTS.md`](../operations/ENVIRONMENTS.md) (Railway voice, Vercel Desk, Supabase `scalers-staging`).

See: [`../operations/DEPLOYMENT.md`](../operations/DEPLOYMENT.md), [`../operations/ENVIRONMENTS.md`](../operations/ENVIRONMENTS.md).

---

## Dashboard (desk product surface)

**FACT:** Settings compile structured business fields → `tenants.llm_system_prompt` via `promptCompiler.ts`.  
**FACT:** Pronunciation studio, knowledge ingest, catalog import, wallet view, calls triage.  
**FACT:** Largest UI surface: `TenantForm.tsx` (~2,181 LOC).

---

## Tests

| Command | Result (2026-08-14 baseline) |
| --- | --- |
| `npm run test:voice` | PASS |
| `npm run test:brain` | PASS |
| `npm run test:mvp` | PASS |
| `cd dashboard && npm run build` | PASS |
| `cd dashboard && npm run lint` | FAIL (pre-existing) |

See: [`../governance/TESTING_BASELINE.md`](../governance/TESTING_BASELINE.md).

---

## Agent / lane governance (existing)

**FACT:** Five lanes defined in `AGENTS.md`: Voice, Brain, Desk UI/UX, Ops & Billing, Platform.  
**FACT:** Lane contracts in `docs/agents/*.md` and `.cursor/rules/*.mdc`.

---

## Known gaps (not future architecture)

| Gap | Status |
| --- | --- |
| Per-call agent version attribution | Not implemented |
| CI in repo | **Updated 2026-10-05:** present in `.github/workflows/` (`ci.yml`, staging workflows) |
| Staging environment | **Updated 2026-10-05:** documented in [`../operations/ENVIRONMENTS.md`](../operations/ENVIRONMENTS.md) |
| Production SQL migration tier | UNKNOWN |
| Live Dial | Spec only. Not shipped. |
| Owner package checkout | Not shipped. Super Admin assigns packages. |
| JS/TS duplication (intro, lexicon) | ACTIVE risk |

See: [`../governance/TECHNICAL_DEBT.md`](../governance/TECHNICAL_DEBT.md), [`../agents/PROMPT_VERSIONING.md`](../agents/PROMPT_VERSIONING.md).

---

## Related documents

- [`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md) — 5-minute picture. Read that before this inventory.
- [`DATA_FLOW.md`](./DATA_FLOW.md) — call lifecycle and persistence
- [`../governance/SOURCE_OF_TRUTH.md`](../governance/SOURCE_OF_TRUTH.md) — subsystem ownership
- [`../agents/AGENT_ARCHITECTURE.md`](../agents/AGENT_ARCHITECTURE.md) — AI agent stack
