# Requirements by Migration Phase

> Implementation checklist derived from [`REQUIREMENTS.md`](./REQUIREMENTS.md) and  
> [`ARCHITECTURE_MIGRATION_BLUEPRINT.md`](./ARCHITECTURE_MIGRATION_BLUEPRINT.md).  
> Each phase lists **must-build deliverables**, **REQ IDs**, **env/flags**, and **done-when**.

---

## Phase 0 — Blueprint & contracts *(docs only)*

| Deliverable | Status |
| --- | --- |
| Architecture blueprint | Done |
| Supabase schema draft | Done |
| Target module layout | Done |
| Full requirements catalog | Done (`REQUIREMENTS.md`) |
| This phase checklist | Done |

**Done when:** Stakeholders can implement without inventing stack choices.

---

## Phase 1 — Persistence (SQLite → Supabase)

### Must build

| # | Deliverable | REQ IDs |
| --- | --- | --- |
| 1.1 | Apply `docs/supabase/schema.sql` to Supabase project | REQ-DAT-001, REQ-DAT-008 |
| 1.2 | Create `src/db/supabase.js` with identical exports to `db.js` | REQ-DAT-002 |
| 1.3 | Loader `src/db/index.js` selecting backend via `DB_BACKEND` | REQ-DAT-009 |
| 1.4 | Create private Storage bucket `call-recordings` (optional write path) | REQ-DAT-006 |
| 1.5 | Update `.env.example` with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | REQ-OPS-001/006 |
| 1.6 | Smoke test: upsert → saveCallerInfo → attachRecording → getCall on both backends | REQ-DAT-003/004/005 |

### Flags / env

```bash
DB_BACKEND=sqlite|supabase   # default sqlite until verified
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

### Done when

- [ ] Twilio Phase-1 voice path still works with `DB_BACKEND=sqlite`
- [ ] Same path works with `DB_BACKEND=supabase` against a test project
- [ ] No orchestrator code changes beyond DB import path

---

## Phase 2 — SautiKit voice webhooks (no full AI yet)

### Must build

| # | Deliverable | REQ IDs |
| --- | --- | --- |
| 2.1 | `TELEPHONY_PROVIDER` switch; keep Twilio routes when `twilio` | REQ-TEL-009, REQ-MIG-001 |
| 2.2 | `POST /voice/incoming` for SautiKit: verify signature, branch on lifecycle | REQ-TEL-001/004/006/010 |
| 2.3 | Initial answer returns Stream XML (`connect=true`, 16 kHz) **or** Say greeting for dry-run | REQ-TEL-002 |
| 2.4 | `POST /voice/events` for `call.completed`, `call.failed`, `recording.ready` | REQ-TEL-005 |
| 2.5 | Idempotent `call_events` insert; update call duration/status | REQ-DAT-007/004 |
| 2.6 | `POST /voice/stream-status` for stream-started/stopped/error | REQ-TEL-011 |
| 2.7 | Ops doc: claim +254 number, set `voice_callback_url` + `events_url` | REQ-INT-002, REQ-TEL-008 |
| 2.8 | Boot validation for SautiKit env when provider=`sautikit` | REQ-OPS-001 |

### Flags / env

```bash
TELEPHONY_PROVIDER=twilio|sautikit
SAUTIKIT_API_KEY=
SAUTIKIT_WEBHOOK_SECRET=
SAUTIKIT_VALIDATE_WEBHOOKS=true
PUBLIC_BASE_URL=https://…
```

### HTTP contracts (required)

| Method | Path | Behavior |
| --- | --- | --- |
| `POST` | `/voice/incoming` | SautiKit voice callback → XML/JSON actions; &lt;10s |
| `POST` | `/voice/events` | Lifecycle events; 2xx fast; async DB write |
| `POST` | `/voice/stream-status` | Stream status; no action body parsing |
| `GET` | `/healthz` | 200 if process up |

### Done when

- [ ] Inbound test call to DID hits webhook and returns Stream/Say without 5xx
- [ ] Re-entrant callback does **not** open a second Stream
- [ ] `call.completed` writes/updates Supabase (or SQLite) row
- [ ] Twilio path still works with `TELEPHONY_PROVIDER=twilio`

---

## Phase 3 — Media WebSocket + Soniox STT (listen-only)

### Must build

| # | Deliverable | REQ IDs |
| --- | --- | --- |
| 3.1 | `WSS /ws/media` accepting `audio.drachtio.org` | REQ-TEL-003 |
| 3.2 | Parse openMetadata text frame; create `callSession` | REQ-TEL-007, REQ-ORC-004 |
| 3.3 | Forward inbound PCM → Soniox STT WS | REQ-SPC-001/005 |
| 3.4 | Log interim + final transcripts; append to DB | REQ-SPC-002, REQ-ORC-005 |
| 3.5 | Language hints `en` + `sw` | REQ-SPC-003 |
| 3.6 | Latency log: time to first final token | REQ-OPS-005 |
| 3.7 | No TTS yet (or optional silence / static Say only) | Phase gate |

### Flags / env

```bash
SONIOX_API_KEY=
SONIOX_STT_MODEL=stt-rt-v5
SONIOX_SAMPLE_RATE=16000
```

### Done when

- [ ] Live call produces readable transcript in logs + DB
- [ ] Sample rate mismatch never silent-fails (logged)
- [ ] Media disconnect cleans up STT socket (no leak)
- [ ] AT-01 partial: PCM inbound works

---

## Phase 4 — Full duplex agent (TTS + LLM + fillers + WhatsApp)

### Must build

| # | Deliverable | REQ IDs |
| --- | --- | --- |
| 4.1 | Soniox TTS → PCM write-back on same media WS | REQ-SPC-004 |
| 4.2 | Turn manager: endpointing, filler fast-path, LLM slow-path | REQ-ORC-001/002/003 |
| 4.3 | Barge-in cancel TTS + clear queue | REQ-SPC-006 |
| 4.4 | Port Gemini turn + tool markers; thinking minimized | REQ-LLM-001/003–007/009 |
| 4.5 | Optional `LLM_PROVIDER=openai` (GPT-4o-mini) | REQ-LLM-002 |
| 4.6 | Welcome / missed-call UX lines | REQ-UX-001–003/006 |
| 4.7 | WhatsApp exactly-once gate on SautiKit path | REQ-NTF-001–005 |
| 4.8 | Fallback apology on pipeline failure | REQ-ORC-008 |
| 4.9 | Concurrent session isolation | REQ-ORC-007 |
| 4.10 | Module extraction per `TARGET_MODULE_LAYOUT.md` | REQ-NFR-MNT-001 |
| 4.11 | Load test ≥5 concurrent calls; measure p50/p95 | REQ-NFR-PERF-001/002 |

### Business rules (must enforce)

| Rule | Requirement |
| --- | --- |
| BR-1 | Capture **name** then **reason** (or both in one turn) |
| BR-2 | Confirm both; promise callback; goodbye |
| BR-3 | Persist via structured save before relying on WhatsApp |
| BR-4 | Notify owner only when name + reason + recording exist |
| BR-5 | Prefer short spoken turns (1–2 sentences) |
| BR-6 | Support EN / SW / Sheng fillers |

### Done when

- [ ] AT-01 … AT-10 pass on SautiKit + Soniox path
- [ ] Name + reason in Supabase; WhatsApp once
- [ ] p50 first-audio ≤ 1.0s on sample set
- [ ] Twilio still rollback-capable via flags

---

## Phase 5 — Production cutover

### Must build / do

| # | Deliverable | REQ IDs |
| --- | --- | --- |
| 5.1 | Point customer divert / DID routing to SautiKit permanently | REQ-TEL-008, REQ-MIG-003 |
| 5.2 | Default env: `TELEPHONY_PROVIDER=sautikit`, `DB_BACKEND=supabase` | REQ-MIG-001 |
| 5.3 | WhatsApp → SautiKit provider (or document Twilio bridge residual) | REQ-NTF-004 |
| 5.4 | Remove ConversationRelay from default start path / docs | Blueprint §13 |
| 5.5 | Cutover checklist signed (wallet, keys, webhooks, RLS) | REQ-MIG-003 |
| 5.6 | Monitor first 48h: error rate, silent calls, notify failures | REQ-OPS-004/005 |

### Cutover checklist

- [ ] SautiKit wallet funded (KES)
- [ ] +254 DID routed: voice + events URLs HTTPS
- [ ] Webhook secret matches server
- [ ] Soniox key live; voice id chosen
- [ ] Supabase schema + service role on voice host
- [ ] `PUBLIC_BASE_URL` WSS reachable
- [ ] WhatsApp destination verified
- [ ] Rollback env documented (`TELEPHONY_PROVIDER=twilio`)

### Done when

- [ ] Happy path has **zero** Twilio ConversationRelay dependency
- [ ] Blueprint §13 acceptance criteria all checked

---

## Phase 6 — Admin dashboard (parallel)

### Must build

| # | Deliverable | REQ IDs |
| --- | --- | --- |
| 6.1 | Next.js app on Vercel | REQ-DASH-001 |
| 6.2 | Auth (Supabase Auth) + RLS by `business_id` | REQ-DASH-003, REQ-NFR-SEC-004 |
| 6.3 | Calls list + detail (transcript, recording, WhatsApp flag) | REQ-DASH-001/002 |
| 6.4 | (P2) Prompt/locale editor; usage stats | REQ-DASH-004/005 |
| 6.5 | Voice engine remains independent of dashboard uptime | REQ-DASH-006 |

### Done when

- [ ] Owner can review today’s missed-call leads in UI
- [ ] Tenant A cannot read tenant B data

---

## Cross-phase user stories

| ID | As a… | I want… | So that… | Phase |
| --- | --- | --- | --- | --- |
| US-01 | Caller | someone to answer when the business misses my call | I can leave my name and reason | 4 |
| US-02 | Caller | to speak English or Swahili | I am understood | 3–4 |
| US-03 | Caller | to interrupt the agent | I can correct myself without waiting | 4 |
| US-04 | Owner | a WhatsApp with name, reason, recording | I can call back the lead | 4 |
| US-05 | Owner | a dashboard of calls | I can audit leads later | 6 |
| US-06 | Implementer | feature flags per layer | I can migrate without downtime | 1–5 |
| US-07 | Operator | KES-priced Kenya DIDs | costs stay local and predictable | 2–5 |
| US-08 | Operator | sub-second agent replies | calls feel human, not laggy | 4 |

---

## Env var matrix (all phases)

| Variable | Phase needed | Required when |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | 1+ | Always |
| `PORT` | 1+ | Always |
| `GEMINI_API_KEY` | 4 (Twilio: already) | `LLM_PROVIDER=gemini` |
| `OPENAI_API_KEY` | 4 | `LLM_PROVIDER=openai` |
| `LLM_PROVIDER` | 4 | Optional (default gemini) |
| `DB_BACKEND` | 1 | Always during migration |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | 1 | `DB_BACKEND=supabase` |
| `TELEPHONY_PROVIDER` | 2 | Always during migration |
| `SAUTIKIT_API_KEY` | 2 | `TELEPHONY_PROVIDER=sautikit` |
| `SAUTIKIT_WEBHOOK_SECRET` | 2 | validation on |
| `SONIOX_API_KEY` | 3 | SautiKit media path |
| `SONIOX_STT_MODEL` / `SONIOX_TTS_VOICE` / `SONIOX_SAMPLE_RATE` | 3–4 | Soniox path |
| `WHATSAPP_PROVIDER` | 4–5 | Notifications enabled |
| `BUSINESS_OWNER_WHATSAPP_NUMBER` | 4 | Notifications enabled |
| `TWILIO_*` | 0–5 | Twilio telephony or WhatsApp bridge |

---

## Suggested PR sequence (implementation)

1. **PR:** Phase 1 — Supabase adapter + flag  
2. **PR:** Phase 2 — SautiKit webhooks + Stream/Say  
3. **PR:** Phase 3 — `/ws/media` + Soniox STT  
4. **PR:** Phase 4 — TTS + turn manager + LLM + WhatsApp  
5. **PR:** Phase 5 — defaults/cutover docs + remove Twilio from happy path  
6. **PR:** Phase 6 — Next.js dashboard (can start after Phase 1 schema)
