# Scalers data flow

**Status:** Fact inventory for one call. Not the system picture.  
**Read first:** [`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md) (updated 2026-10-05).  
**Baseline:** 2026-08-14. Section 9 billing was corrected 2026-10-05.  
**Purpose:** Lifecycle of data through a live call and the Desk compile path. What is memory-only vs written to Supabase.

Legend: **Persisted** = written to Supabase. **Memory** = process-local only. **External** = third-party service.

---

## 1. Inbound call setup

| Stage | Data | Where |
| --- | --- | --- |
| SautiKit webhook POST | `callSid`, `fromNumber`, `toNumber`, session state | **Memory** (`req.body`) |
| DID correction | Swapped caller/callee if flipped | **Memory** (`correctCallerCalleeNumbers`) |
| Call row created | `calls` row via `upsertCall` | **Persisted** |
| Stream URL returned | `wss://{host}/ws/media?callSid=...` | **External** → SautiKit |

**Files:** `server.js` `handleVoiceIncoming`, `src/db.js` `upsertCall`

---

## 2. Caller audio (streaming)

| Stage | Data | Where |
| --- | --- | --- |
| Binary PCM frames | S16LE @ 16 kHz | **Memory** → forwarded to Soniox STT |
| WS metadata JSON | `killAudio`, stream control | **Memory** |
| STT interim/final tokens | Partial/final transcript text | **Memory** → utterance assembly |

**Files:** `server.js` `mediaWss` handler, `sonioxStt.js`

**Not persisted:** Raw audio streams (recordings come from SautiKit post-call).

---

## 3. Transcript (during call)

| Stage | Data | Where |
| --- | --- | --- |
| Per-utterance log | Caller/agent lines | **Memory** (`transcriptLog` in media session) |
| DB append | `transcripts` rows (`speaker`, `text_content`, `latency_ms`) | **Persisted** via `appendTranscript` |

**Files:** `src/db.js` `appendTranscript`

---

## 4. Brain state (per call)

| Field | Storage |
| --- | --- |
| Intent, goal, entities, language, repair count | **Memory** — `callBrainStates` Map in `server.js` |
| Capabilities (tools enabled, handoff mode) | **Memory** — `callBrainCapabilities` Map |
| Agent tool toggles | **Memory** — `callAgentTools` Map (loaded from `tenants.agent_tools`) |
| Tenant profile / catalog | **Memory** — `callTenantProfiles` Map; source **Persisted** in `tenants` |

**Files:** `brainState.js`, `brainPolicy.js`, `nextBestAction.js`

**Brain trace logs:** `logBrainTrace()` → **stdout only** (not persisted). File: `brainObservability.js`.

---

## 5. LLM request

| Stage | Data | Where |
| --- | --- | --- |
| System prompt | Assembled from `buildSystemPrompt(profile)` + context header + brain injection | **Memory** (`messages[]`) |
| Compiled base | `tenants.llm_system_prompt` | **Persisted** (loaded at call start, not snapshotted on call row) |
| User turn | Finalized caller utterance | **Memory** → Gemini API |
| Model response | Text + tool markers | **Memory** → parse → TTS |

**Files:** `src/prompts.js`, `server.js` `runGeminiTurnStreaming`

**Gap:** No `prompt_hash` or agent version stored on `calls` — see [`../agents/PROMPT_VERSIONING.md`](../agents/PROMPT_VERSIONING.md).

---

## 6. Tool execution

| Tool | Side effects | Persistence |
| --- | --- | --- |
| `save_caller_info` | Name/reason in call summary | **Persisted** — `saveCallerInfo` → `calls.summary` JSON |
| `escalate` | Team notify | **Persisted** — `saveEscalation`; notify via `dispatch` |
| `create_service_request` | CRM row | **Persisted** — `contacts`, `service_requests` |
| `end_call` | Hangup signal | **Memory** → session teardown |

**Files:** `toolExecution.js`, `src/db.js`

---

## 7. TTS and audio return

| Stage | Data | Where |
| --- | --- | --- |
| Text normalization | Lexicon overrides (tenant + Kenya base) | **Memory** |
| Soniox TTS stream | PCM chunks | **Memory** → `sendPcmToMedia` |
| Barge-in cancel | `killAudio`, generation bump, filler stream cancel | **Memory** |

**Files:** `ttsNormalize.js`, `sonioxTts.js`, `turnTaking.js`

---

## 8. Call completion

| Event | Data | Persistence |
| --- | --- | --- |
| `call.completed` webhook | Duration, terminal status | **Persisted** — `updateCallStatus` |
| `recording.ready` | Recording URL (`download_url` or GET `/v1/calls/{id}/recording`) | **Persisted** — `attachRecording`; may upload to Storage bucket `call-recordings` |
| Resolution | `primary_intent`, `resolution`, `resolution_note` | **Persisted** — `setCallResolution` via `deriveCallResolution` |
| Summary | JSON in `calls.summary` (`text`, `brain_summary`, `reason`) | **Persisted** instantly from Brain; Gemini transcript review may rewrite `reason` |
| Transcript review | Owner sentence + human-need check | **Persisted** — `mergeCallSummaryMeta` / `setCallResolution` (non-blocking) |

**Files:** `server.js` `/voice/events`, `callResolution.js`, `callSummary.js`, `callTranscriptReview.js`

---

## 9. Package metering and wallet

**Updated 2026-10-05.** Customer billing is packages plus on-demand. Owner M-Pesa checkout is not shipped. Live Dial is not shipped, so the outbound transfer row is not created on a normal call.

| Stage | Condition | Persistence |
| --- | --- | --- |
| Meter included minutes | Hangup, after `consume_call_seconds` SQL is applied | Package counters on the tenant |
| On-demand debit | Past included minutes, enforcement on, on-demand on | **Persisted** — `chargeCallToWallet` → `wallet_ledger` |
| Beta | `billing_enforcement = off` | Meter only. No charge. |

**Files:** `src/db.js` `chargeCallToWallet`, [`../operations/PACKAGES.md`](../operations/PACKAGES.md), [`../operations/ONE_WALLET_BILLING.md`](../operations/ONE_WALLET_BILLING.md)

---

## 10. Notifications

| Trigger | Channels (priority) | Persistence |
| --- | --- | --- |
| Lead / caller info saved | TextSMS → WhatsApp → email | **Persisted** flag in `calls.summary` (`whatsapp_sent`, etc.) |
| Escalation | Same + teammate SMS | **Persisted** — `escalation_sent` |
| Service request | Owner alert | **Persisted** via request row + notify |

**Files:** `src/notifications/dispatch.js`, `escalation.js`

---

## 11. Desk compile flow (between calls)

| Stage | Data | Where |
| --- | --- | --- |
| Owner edits settings | Structured fields (hours, FAQs, catalog, …) | **Persisted** — `tenants` columns |
| Compile action | Gemini or local template | **Persisted** — `tenants.llm_system_prompt` |
| Pronunciation train | `tts_lexicon` jsonb | **Persisted** |
| Next call | Voice loads fresh profile | Reads **Persisted** tenant state |

**Files:** `dashboard/src/app/(desk)/settings/actions.ts`, `promptCompiler.ts`

**INFERENCE:** A call that started before a settings save uses the profile loaded at `ensureTenantPrompt()` time for that session only.

---

## Memory vs persistence summary

| Artifact | Memory only | Persisted |
| --- | --- | --- |
| Raw PCM audio | ✓ (during call) | Recording URL post-call |
| Brain state Maps | ✓ | ✗ |
| `messages[]` LLM history | ✓ | Transcript rows (partial) |
| `llm_system_prompt` at call time | ✓ (loaded) | Tenant column (not call snapshot) |
| Env tuning (TTS speed, barge grace) | ✓ (process env) | ✗ |
| Brain traces | stdout | ✗ |

---

## Related documents

- [`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md) — 5-minute picture
- [`../governance/SOURCE_OF_TRUTH.md`](../governance/SOURCE_OF_TRUTH.md)
- [`../agents/AGENT_ARCHITECTURE.md`](../agents/AGENT_ARCHITECTURE.md)
