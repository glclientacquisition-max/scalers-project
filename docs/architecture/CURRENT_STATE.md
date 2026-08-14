# Scalers current state

**Status:** As-is documentation (Phase 2 governance baseline)  
**Baseline commit:** `main` @ `5b875dc` (documented 2026-08-14)  
**Purpose:** Describe what Scalers **is today**, not the target future architecture.

Legend: **FACT** = verified in repo or tests. **INFERENCE** = reasonable conclusion from evidence. **UNKNOWN** = not verified in this audit.

---

## Executive summary

Scalers is a B2B AI voice receptionist for East African businesses. A **Node.js voice engine** (`server.js`) handles live telephony, speech, and agent reasoning. A **Next.js dashboard** (`dashboard/`) provides owner desk, onboarding, settings, and Super Admin ops. **Supabase** is the system of record for tenants, calls, transcripts, billing, and auth.

**FACT:** Two deploy units: voice on Railway/Render (Docker), desk on Vercel.  
**FACT:** Telephony path is SautiKit + Soniox STT/TTS + Gemini. Twilio is no longer the active telephony path.  
**UNKNOWN:** Live health of production Railway/Vercel deploys and exact Supabase migration tier on production.

---

## Repository structure

```
/workspace
├── server.js              # Voice engine entry (2,841 LOC) — FACT
├── db.js                  # Shim → src/db.js — FACT
├── src/                   # Voice modules (~53 JS files) — FACT
│   ├── speech/            # Soniox STT/TTS, turn-taking, normalize
│   ├── conversation/      # Brain runtime, tools, catalog
│   ├── notifications/     # SMS, WhatsApp, email dispatch
│   ├── sautikit/          # Webhook guard
│   ├── db.js              # Voice DB API (1,110 LOC)
│   └── prompts.js         # Runtime prompt assembly
├── dashboard/             # Next.js 16 app (~128 TS/TSX files) — FACT
├── docs/                  # Product, lane, SQL, governance docs
├── tests/                 # 35 test files — FACT
├── scripts/               # Smoke tests, tunnels, harnesses
├── Dockerfile, railway.toml, render.yaml
└── AGENTS.md              # Five-lane agent governance
```

**FACT:** Not a formal monorepo (no npm workspaces). Root package `missed-call-agent`, desk package `dashboard`.  
**FACT:** No `.github/workflows/` CI in repo.

See also: [`../governance/REPOSITORY_INVENTORY.md`](../governance/REPOSITORY_INVENTORY.md).

---

## Frontend (owner desk + Super Admin)

| Area | Path | Role |
| --- | --- | --- |
| Marketing | `dashboard/src/app/page.tsx` | Landing |
| Auth | `login/`, `signup/` | Supabase Auth email/password |
| Onboarding | `onboarding/` | Wizard → compile `llm_system_prompt` |
| Owner desk | `(desk)/` | Home, calls, settings, wallet, requests |
| Super Admin | `admin/` | Businesses, numbers, wallets, voices |
| API routes | `dashboard/src/app/api/` | Auth, admin, pronunciation preview, voices |

**FACT:** Owner shell uses Supabase Auth JWT + RLS.  
**FACT:** Super Admin uses legacy shared-password cookie (`DASHBOARD_PASSWORD`) — see [`../governance/SOURCE_OF_TRUTH.md`](../governance/SOURCE_OF_TRUTH.md).

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

| Role | Mechanism | Path |
| --- | --- | --- |
| Owner | Supabase Auth + RLS | `dashboard/src/lib/auth.ts`, `owner_rls.sql` |
| Super Admin | Legacy HMAC cookie | `isLegacyAuthenticated()`, `admin/layout.tsx` |
| Voice engine | Service role (bypasses RLS) | `src/lib/supabaseClient.js` |

**FACT:** Service role must never appear in `NEXT_PUBLIC_*`.

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

**INFERENCE:** Referenced production URLs: `scalers-project-production.up.railway.app` (voice), `scalers-project.vercel.app` (desk).  
**UNKNOWN:** Staging environment topology.

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
| CI/CD in repo | Not present |
| Staging environment | UNKNOWN |
| Production SQL migration tier | UNKNOWN |
| JS/TS duplication (intro, lexicon) | ACTIVE risk |

See: [`../governance/TECHNICAL_DEBT.md`](../governance/TECHNICAL_DEBT.md), [`../agents/PROMPT_VERSIONING.md`](../agents/PROMPT_VERSIONING.md).

---

## Related documents

- [`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md) — component diagram and paths
- [`DATA_FLOW.md`](./DATA_FLOW.md) — call lifecycle and persistence
- [`../governance/SOURCE_OF_TRUTH.md`](../governance/SOURCE_OF_TRUTH.md) — subsystem ownership
- [`../agents/AGENT_ARCHITECTURE.md`](../agents/AGENT_ARCHITECTURE.md) — AI agent stack
