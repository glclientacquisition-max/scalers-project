# B2B AI Voice SaaS — Product & Technical Requirements

> **Status:** Draft for implementation  
> **Source of truth (architecture):** [`ARCHITECTURE_MIGRATION_BLUEPRINT.md`](./ARCHITECTURE_MIGRATION_BLUEPRINT.md)  
> **Baseline product:** Missed-call AI receptionist for East African B2B (Kenya first)  
> **ID convention:** `REQ-<AREA>-###` (e.g. `REQ-TEL-001`)  
> **Priority:** `P0` must-ship for production voice path · `P1` required soon after · `P2` nice-to-have / later phase

---

## 1. Purpose & Scope

### 1.1 Problem

Small and mid-size East African businesses miss leads when phones are busy, unanswered, or after hours. They need a localized AI receptionist that answers in real time, captures actionable caller data, and notifies the owner—without U.S.-centric telephony pricing or black-box voice orchestrators.

### 1.2 In scope

- Inbound voice answering on +254 DIDs (and diverted Safaricom/Airtel lines)
- Real-time duplex voice conversation (English, Swahili, Sheng)
- Capture of caller **name** + **reason**; optional confirmation + goodbye
- Persist call metadata, transcript, recording; WhatsApp notify owner
- Multi-tenant readiness (business profile, DID binding)
- Admin dashboard for call history and basic agent config (phased)
- Migration from Twilio ConversationRelay + SQLite to SautiKit + Soniox + Supabase

### 1.3 Out of scope (v1 production voice path)

| Item | Notes |
| --- | --- |
| Outbound AI sales / broadcast campaigns | SautiKit supports; separate product track |
| Managed SautiKit-hosted agents as primary path | We own custom Stream orchestrator |
| Full CRM / billing / invoicing | Dashboard is call ops, not ERP |
| Native mobile apps | Web dashboard only |
| Multi-country DIDs beyond Kenya | Architecture should not block; not required for v1 |
| Human live-transfer / warm handoff | P2 after core receptionist works |
| Complex multi-intent booking engines | v1 is name + reason (+ light RAG FAQ) |

---

## 2. Personas & Goals

| Persona | Goal |
| --- | --- |
| **Caller** | Reach the business; leave clear intent without frustration |
| **Business owner** | Never lose a missed-call lead; get WhatsApp summary + recording |
| **Ops / implementer** | Provision DID, configure prompt/hours, monitor call quality |
| **Platform operator** | Run multi-tenant voice engine with predictable KES cost and sub-second UX |

### Success metrics (v1)

| Metric | Target |
| --- | --- |
| Time to first agent audio after caller stops speaking | p50 ≤ 1.0s, p95 ≤ 1.8s |
| Calls that capture both name + reason | ≥ 80% of completed conversations ≥ 20s |
| WhatsApp notification delivery (when configured) | ≥ 99% of qualified calls, exactly once |
| False double-Stream / silent-audio incidents | 0 in soak tests |
| Twilio dependency on happy path | Removed after Phase 5 cutover |

---

## 3. Functional Requirements

### 3.1 Telephony & call control (`REQ-TEL`)

| ID | Priority | Requirement |
| --- | --- | --- |
| REQ-TEL-001 | P0 | System SHALL answer inbound calls to provisioned +254 SautiKit DIDs via `voice_callback_url`. |
| REQ-TEL-002 | P0 | On initial answered edge, system SHALL return a bidirectional **Stream** document with `connect="true"`, `outputSamplingRate` and `bidirectionalSamplingRate` set (default **16000**), pointing at `wss://{PUBLIC_BASE_URL}/ws/media`. |
| REQ-TEL-003 | P0 | Media WebSocket server SHALL accept subprotocol `audio.drachtio.org` and exchange **raw S16LE PCM** binary frames (not base64 mu-law). |
| REQ-TEL-004 | P0 | System SHALL branch voice callbacks on `callSessionState` / lifecycle so Stream is **not** re-issued on `StreamStopped`, `Completed`, or other re-entrant POSTs. |
| REQ-TEL-005 | P0 | System SHALL expose `events_url` handler for at least `call.completed`, `call.failed`, and `recording.ready` (or equivalent recording event). |
| REQ-TEL-006 | P0 | System SHALL verify SautiKit webhook signatures (`X-Sautikit-Signature` HMAC-SHA256) when validation is enabled. |
| REQ-TEL-007 | P0 | System SHALL parse Stream open metadata (caller/destination/`streamSid`) and bind it to an internal call session. |
| REQ-TEL-008 | P1 | System SHALL support call-forward / divert from customer’s Safaricom/Airtel numbers onto the SautiKit DID (documented setup, not code). |
| REQ-TEL-009 | P1 | During migration, `TELEPHONY_PROVIDER=twilio\|sautikit` SHALL allow the Phase-1 Twilio path to remain runnable until cutover. |
| REQ-TEL-010 | P0 | System SHALL respond to voice callbacks within platform timeout (&lt; 10s); heavy work MUST be async after the response. |
| REQ-TEL-011 | P1 | System SHALL handle `stream-started` / `stream-stopped` / `stream-error` status callbacks without crashing the process. |
| REQ-TEL-012 | P2 | System SHOULD support explicit hangup / end-call after goodbye (agent-initiated). |

### 3.2 Speech — STT & TTS (`REQ-SPC`)

| ID | Priority | Requirement |
| --- | --- | --- |
| REQ-SPC-001 | P0 | System SHALL stream inbound PCM to Soniox realtime STT (`wss://stt-rt.soniox.com/transcribe-websocket`). |
| REQ-SPC-002 | P0 | System SHALL consume interim (non-final) and final tokens to drive endpointing / turn-taking. |
| REQ-SPC-003 | P0 | STT session SHALL configure language hints including at least English and Swahili (`en`, `sw`). |
| REQ-SPC-004 | P0 | System SHALL stream agent text to Soniox realtime TTS and write returned PCM back to the SautiKit media socket. |
| REQ-SPC-005 | P0 | Sample rates for SautiKit ↔ Soniox MUST match end-to-end (default 16 kHz); mismatches MUST be logged. |
| REQ-SPC-006 | P0 | On barge-in (caller speaks during TTS), system SHALL stop/cancel TTS, clear outbound queue, and resume listening. |
| REQ-SPC-007 | P1 | System SHOULD support a configurable / custom Soniox voice id via env. |
| REQ-SPC-008 | P1 | System SHOULD degrade gracefully if Soniox disconnects mid-call (fallback spoken line + end or retry once). |

### 3.3 Orchestration & turn-taking (`REQ-ORC`)

| ID | Priority | Requirement |
| --- | --- | --- |
| REQ-ORC-001 | P0 | Custom Node.js orchestrator SHALL own buffers, turn detection, filler injection, LLM calls, and barge-in (no Vapi/Retell dependency). |
| REQ-ORC-002 | P0 | On end-of-utterance, system SHALL play a **localized conversational filler** on the fast path before or while the LLM runs. |
| REQ-ORC-003 | P0 | Filler catalog MUST include English, Swahili, and Sheng variants (e.g. “Sawa, nakucheckia…”). |
| REQ-ORC-004 | P0 | Orchestrator SHALL maintain per-call session state: ids, transcript, conversation history, TTS/STT handles, WhatsApp gate flags. |
| REQ-ORC-005 | P0 | Orchestrator SHALL append caller/agent turns to a durable transcript buffer flushed during/after the call. |
| REQ-ORC-006 | P1 | Orchestrator SHOULD stream LLM tokens into TTS when provider streaming is available (reduce time-to-first-audio). |
| REQ-ORC-007 | P1 | Concurrent calls MUST be isolated (no shared mutable transcript/session across call IDs). |
| REQ-ORC-008 | P0 | On unrecoverable pipeline error, system SHALL speak a short fallback apology and end the call cleanly. |

### 3.4 Intelligence / LLM (`REQ-LLM`)

| ID | Priority | Requirement |
| --- | --- | --- |
| REQ-LLM-001 | P0 | System SHALL support Gemini as primary LLM provider for conversational turns. |
| REQ-LLM-002 | P1 | System SHALL support OpenAI GPT-4o-mini via `LLM_PROVIDER` switch. |
| REQ-LLM-003 | P0 | Agent goal per call: obtain **name**, obtain **reason**, confirm both, promise callback, goodbye. |
| REQ-LLM-004 | P0 | Spoken replies MUST stay short (≈1–2 sentences) suitable for live phone audio. |
| REQ-LLM-005 | P0 | When name + reason are known, model output MUST include a structured save signal (existing `###TOOL###` markers or equivalent tool call). |
| REQ-LLM-006 | P0 | Model MAY emit an end-call signal (`###ENDCALL###` or equivalent); orchestrator MUST honor it after TTS. |
| REQ-LLM-007 | P0 | Gemini 3.x thinking MUST be constrained for latency (e.g. `thinkingLevel: 'MINIMAL'`) so TTS is not delayed/garbled. |
| REQ-LLM-008 | P1 | System SHOULD inject business profile / knowledge snippets (RAG via prompt injection) at call setup. |
| REQ-LLM-009 | P0 | LLM failures MUST return a safe spoken fallback and allow call completion without crashing the server. |
| REQ-LLM-010 | P2 | System SHOULD detect or prefer Swahili/Sheng reply style based on caller language. |

### 3.5 Data & persistence (`REQ-DAT`)

| ID | Priority | Requirement |
| --- | --- | --- |
| REQ-DAT-001 | P0 | Production SHALL persist calls in Supabase PostgreSQL (replace local SQLite as default after Phase 1). |
| REQ-DAT-002 | P0 | DB adapter MUST preserve the stable API: `upsertCall`, `saveCallerInfo`, `appendTranscript`, `attachRecording`, `getCall`, `markWhatsappSent`. |
| REQ-DAT-003 | P0 | Each call record MUST store at minimum: provider call id, from/to, name, reason, transcript, recording URL, status, timestamps, `whatsapp_sent`. |
| REQ-DAT-004 | P0 | System SHALL upsert on call start and update throughout the call; post-call SHALL flush final transcript + duration. |
| REQ-DAT-005 | P0 | Recording URL/SID MUST attach when `recording.ready` / completed recording webhook arrives (order-independent vs caller-info). |
| REQ-DAT-006 | P1 | System SHOULD store recordings in Supabase Storage (`call-recordings`) or retain durable provider URLs. |
| REQ-DAT-007 | P0 | Webhook deliveries MUST be idempotent via `event_id` / `X-Sautikit-Idempotency-Key` (see `call_events`). |
| REQ-DAT-008 | P1 | Schema MUST support multi-tenant `businesses` and optional `knowledge_chunks` for RAG. |
| REQ-DAT-009 | P1 | `DB_BACKEND=sqlite\|supabase` flag SHALL allow dual-path migration without breaking Phase-1. |

### 3.6 Notifications (`REQ-NTF`)

| ID | Priority | Requirement |
| --- | --- | --- |
| REQ-NTF-001 | P0 | When name + reason + recording are present, system SHALL notify the business owner on WhatsApp **exactly once** per call. |
| REQ-NTF-002 | P0 | Notification body MUST include name, phone, reason, time, and recording link (and media attachment when supported). |
| REQ-NTF-003 | P0 | Missing WhatsApp config MUST log a warning and MUST NOT fail the call pipeline. |
| REQ-NTF-004 | P1 | `WHATSAPP_PROVIDER=twilio\|sautikit` SHALL allow Twilio bridge during cutover, then SautiKit WhatsApp. |
| REQ-NTF-005 | P0 | Notification race (caller-info vs recording completing in either order) MUST be handled by a single gate function. |

### 3.7 Admin dashboard (`REQ-DASH`) — Phase 6

| ID | Priority | Requirement |
| --- | --- | --- |
| REQ-DASH-001 | P1 | Next.js dashboard on Vercel SHALL list calls for a business (time, from, name, reason, status, duration). |
| REQ-DASH-002 | P1 | User SHALL open a call detail: transcript, recording playback, WhatsApp sent flag. |
| REQ-DASH-003 | P1 | Authenticated users SHALL only see their business data (Supabase Auth + RLS). |
| REQ-DASH-004 | P2 | Owner SHALL edit welcome/system prompt override and default locale. |
| REQ-DASH-005 | P2 | Owner SHALL view basic usage (calls today, minutes) from stored CDRs. |
| REQ-DASH-006 | P2 | Dashboard MUST NOT be required for the voice path to function. |

### 3.8 Configuration & ops (`REQ-OPS`)

| ID | Priority | Requirement |
| --- | --- | --- |
| REQ-OPS-001 | P0 | Required env vars MUST be validated at boot; process exits with clear error if missing for active providers. |
| REQ-OPS-002 | P0 | Voice engine MUST run on a persistent host (Railway / Render / DO)—not serverless-only for media WS. |
| REQ-OPS-003 | P0 | System SHALL expose `GET /healthz` (process alive; optional dependency checks). |
| REQ-OPS-004 | P1 | Structured logs MUST include `call_sid` / `call_id` on all call-path messages. |
| REQ-OPS-005 | P1 | System SHOULD emit latency timings for STT endpoint, LLM, TTS first-byte. |
| REQ-OPS-006 | P0 | Secrets MUST NOT be committed; `.env.example` documents keys without values. |

---

## 4. Non-Functional Requirements

### 4.1 Performance (`REQ-NFR-PERF`)

| ID | Priority | Requirement |
| --- | --- | --- |
| REQ-NFR-PERF-001 | P0 | p50 time from end-of-utterance to first filler/agent audio ≤ **1.0 s**. |
| REQ-NFR-PERF-002 | P0 | p95 of same metric ≤ **1.8 s** under nominal load (≤ 5 concurrent calls on single node). |
| REQ-NFR-PERF-003 | P1 | Voice callback HTTP response time ≤ **500 ms** p95 (actions only; no LLM in request path). |
| REQ-NFR-PERF-004 | P1 | Single node SHALL support ≥ **10** concurrent duplex calls before horizontal scale work. |

### 4.2 Reliability (`REQ-NFR-REL`)

| ID | Priority | Requirement |
| --- | --- | --- |
| REQ-NFR-REL-001 | P0 | Unhandled exceptions in one call MUST NOT crash the Node process or corrupt other sessions. |
| REQ-NFR-REL-002 | P0 | Provider retries (webhooks) MUST NOT duplicate WhatsApp sends or duplicate call rows. |
| REQ-NFR-REL-003 | P1 | Process restart SHOULD leave DB consistent; in-flight calls may drop but completed CDRs remain. |
| REQ-NFR-REL-004 | P1 | Soak test: 1 hour continuous inbound simulation without memory leak growth &gt; agreed threshold. |

### 4.3 Security & privacy (`REQ-NFR-SEC`)

| ID | Priority | Requirement |
| --- | --- | --- |
| REQ-NFR-SEC-001 | P0 | All telephony webhooks MUST verify signatures when validation flag is true. |
| REQ-NFR-SEC-002 | P0 | Service role / API keys used only server-side; never exposed to the dashboard client. |
| REQ-NFR-SEC-003 | P1 | Recordings and transcripts treated as PII; Storage bucket private; signed URLs for access. |
| REQ-NFR-SEC-004 | P1 | Dashboard RLS enforces tenant isolation by `business_id`. |
| REQ-NFR-SEC-005 | P2 | Retention policy configurable (default retain ≥ 90 days for lead disputes). |

### 4.4 Localization (`REQ-NFR-I18N`)

| ID | Priority | Requirement |
| --- | --- | --- |
| REQ-NFR-I18N-001 | P0 | Callers MUST be understandable in English and Swahili (STT hints + prompts). |
| REQ-NFR-I18N-002 | P1 | Fillers and prompts SHOULD include Sheng-friendly variants for Kenyan callers. |
| REQ-NFR-I18N-003 | P0 | Billing/telephony currency context is **KES** via SautiKit prepaid wallet (ops requirement). |

### 4.5 Maintainability (`REQ-NFR-MNT`)

| ID | Priority | Requirement |
| --- | --- | --- |
| REQ-NFR-MNT-001 | P0 | Telephony, speech, LLM, DB, notify MUST be separable modules (see target layout). |
| REQ-NFR-MNT-002 | P0 | Migration MUST be incremental via provider flags—no big-bang rewrite of `server.js`. |
| REQ-NFR-MNT-003 | P1 | DB interface stability allows SQLite→Supabase without orchestrator rewrites. |

---

## 5. Integration Requirements

| ID | System | Requirement |
| --- | --- | --- |
| REQ-INT-001 | SautiKit REST | Auth via `Authorization: Bearer`; base `https://api.sautikit.com`. |
| REQ-INT-002 | SautiKit Voice | Number routing: `voice_callback_url` + `events_url` HTTPS in production. |
| REQ-INT-003 | SautiKit Stream | XML Stream today; JSON `stream` when runtime-stable—code SHOULD centralize response builder. |
| REQ-INT-004 | Soniox STT/TTS | API key in first WS config message; handle `error_type` / disconnects. |
| REQ-INT-005 | Gemini | `@google/genai` (or current SDK); model configurable; thinking minimized. |
| REQ-INT-006 | OpenAI | Optional GPT-4o-mini path with same tool/marker contract. |
| REQ-INT-007 | Supabase | Service role on voice engine; anon/authenticated keys only on dashboard with RLS. |
| REQ-INT-008 | WhatsApp | Provider-abstracted sender; E.164 numbers without hard-coded prefixes in config. |

---

## 6. Data Requirements

### 6.1 Entities (see `docs/supabase/schema.sql`)

| Entity | Required fields |
| --- | --- |
| `businesses` | id, name, did_e164, owner_whatsapp_e164, locale_default |
| `calls` | call_sid, provider, from/to, name, reason, transcript, recording_url, status, whatsapp_sent, duration_seconds |
| `call_events` | event_id (unique), event_kind, payload, call_sid |
| `knowledge_chunks` | business_id, content (P1/P2 RAG) |

### 6.2 Lifecycle

1. Call start → `upsertCall` / status `in_progress`
2. Mid-call → transcript append; optional `saveCallerInfo`
3. Recording ready → `attachRecording`
4. Call completed → duration + final transcript + status `complete`
5. Notify gate → WhatsApp once → `whatsapp_sent = true`

---

## 7. Conversation / UX Requirements

| ID | Priority | Requirement |
| --- | --- | --- |
| REQ-UX-001 | P0 | Welcome / first agent audio MUST acknowledge a missed or after-hours context. |
| REQ-UX-002 | P0 | Agent MUST sound warm, natural, non-robotic; no long lists or stiff scripts. |
| REQ-UX-003 | P0 | After capturing name + reason, agent MUST confirm and set expectation of callback. |
| REQ-UX-004 | P1 | If caller is silent after prompt, agent SHOULD re-prompt once, then polite goodbye. |
| REQ-UX-005 | P1 | If caller already stated both name and reason in one utterance, agent MUST NOT re-ask both from scratch. |
| REQ-UX-006 | P0 | Filler audio MUST never be the sole lasting reply; full LLM answer follows unless call ends early. |

---

## 8. Migration & Phased Delivery Requirements

Aligned with blueprint Phases 0–6.

| Phase | Exit criteria (requirements satisfied) |
| --- | --- |
| **0 Blueprint** | Architecture + this requirements doc published |
| **1 Persistence** | REQ-DAT-001/002/009; schema applied; flag-switchable Supabase adapter |
| **2 SautiKit webhooks** | REQ-TEL-001/004/005/006/009; Stream or Say without full AI |
| **3 Media + STT** | REQ-TEL-002/003/007; REQ-SPC-001/002/005; transcripts logged |
| **4 Full duplex agent** | REQ-SPC-004/006; REQ-ORC-*; REQ-LLM-*; REQ-NTF-* on SautiKit path |
| **5 Cutover** | Happy path without Twilio ConversationRelay; WhatsApp provider migrated or bridged |
| **6 Dashboard** | REQ-DASH-001–003 minimum |

| ID | Priority | Requirement |
| --- | --- | --- |
| REQ-MIG-001 | P0 | Each phase ships behind flags; rollback to previous provider MUST be possible via env. |
| REQ-MIG-002 | P0 | Phase 1 Twilio receptionist remains functional until Phase 5 acceptance signed off. |
| REQ-MIG-003 | P1 | Cutover checklist MUST include DID routing, webhook URLs, wallet balance, Soniox keys, Supabase RLS. |

---

## 9. Acceptance Test Matrix (P0)

| # | Scenario | Pass condition |
| --- | --- | --- |
| AT-01 | Inbound DID call | Stream connects; PCM flows both ways |
| AT-02 | Speak name + reason in EN | Captured in DB; confirmation spoken |
| AT-03 | Speak in Swahili | STT usable; agent responds appropriately |
| AT-04 | Barge-in during TTS | Agent audio stops; new utterance handled |
| AT-05 | LLM timeout/error | Fallback line; call ends; process healthy |
| AT-06 | Recording after caller-info | Exactly one WhatsApp message |
| AT-07 | Caller-info after recording | Exactly one WhatsApp message |
| AT-08 | Webhook replay | No duplicate call row / WhatsApp |
| AT-09 | Re-entrant voice callback | No second Stream fork / no `-ERR` loop |
| AT-10 | Latency sample (n≥20) | Meets REQ-NFR-PERF-001 |

---

## 10. Environment & Dependency Requirements

| Dependency | Required for |
| --- | --- |
| Node.js 20+ / Express / `ws` | Voice engine |
| `@sautikit/node` (optional helper) | Stream/action builders |
| Soniox account + API key | STT/TTS |
| SautiKit workspace, API key, webhook secret, funded KES wallet, +254 number | Telephony |
| Gemini and/or OpenAI keys | LLM |
| Supabase project (DB + Storage) | Persistence |
| Persistent host with public WSS | Media |
| Vercel (later) | Dashboard |

---

## 11. Requirements Traceability Summary

| Area | P0 count (approx.) | Blocks production voice? |
| --- | --- | --- |
| Telephony | 8 | Yes |
| Speech | 6 | Yes |
| Orchestration | 6 | Yes |
| LLM | 7 | Yes |
| Data | 6 | Yes |
| Notifications | 4 | Yes (if WhatsApp promised) |
| NFR perf/reliability/security | 8+ | Yes |
| Dashboard | 0 P0 | No (P1) |

---

## 12. Open Decisions (to resolve before Phase 4)

| Decision | Options | Default proposal |
| --- | --- | --- |
| Primary LLM in prod | Gemini flash vs GPT-4o-mini | Gemini with OpenAI failover |
| Recording source of truth | SautiKit URL vs copy to Supabase Storage | SautiKit URL first; copy async P1 |
| Endpointing | Soniox-only finals vs local silence + interim | Hybrid: interim + silence ms + min chars |
| WhatsApp final provider | SautiKit vs keep Twilio | SautiKit after messaging API verified |
| Host vendor | Railway vs Render vs DO | Pick one; require WSS + no idle sleep |

---

## 13. Document Control

| Version | Date | Notes |
| --- | --- | --- |
| 0.1 | 2026-08-06 | Initial requirements draft from architecture blueprint |

**Related docs**

- [`ARCHITECTURE_MIGRATION_BLUEPRINT.md`](./ARCHITECTURE_MIGRATION_BLUEPRINT.md)
- [`TARGET_MODULE_LAYOUT.md`](./TARGET_MODULE_LAYOUT.md)
- [`supabase/schema.sql`](./supabase/schema.sql)
