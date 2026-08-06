# B2B AI Voice SaaS — Architecture & Migration Blueprint

> **Status:** Approved direction for production migration  
> **Codebase baseline:** `main` (Twilio ConversationRelay + Gemini + SQLite)  
> **Target:** Hybrid custom stack (SautiKit + Soniox + Gemini/GPT-4o-mini + Supabase)  
> **Requirements:** [`REQUIREMENTS.md`](./REQUIREMENTS.md) (functional, NFR, acceptance, phased exit criteria)

---

## 1. Executive Summary

An automated, sub-second latency AI receptionist platform built specifically for the East African B2B market. The system intercepts missed, busy, or after-hours calls using localized telephony (**SautiKit**) and engages customers in real-time, human-like voice conversations (**English, Swahili, Sheng**) before logging actionable data to a client dashboard.

**What changes vs today**

| Concern | Phase 1 (current) | Production target |
| --- | --- | --- |
| Telephony | Twilio + ConversationRelay (text in/out) | SautiKit Stream (raw PCM duplex WebSocket) |
| Orchestration | Twilio-managed STT/TTS + our WS text loop | Custom Node.js media orchestrator |
| Speech | Twilio / Google TTS via ConversationRelay | Soniox realtime STT + TTS |
| Intelligence | Gemini (`gemini-3.6-flash`) | Gemini / GPT-4o-mini (fillers + RAG) |
| Persistence | Local SQLite (`db/calls.db`) | Supabase PostgreSQL + Storage |
| Notifications | Twilio WhatsApp | SautiKit WhatsApp (or Twilio bridge during cutover) |
| Hosting | Single Express process | Voice engine (Railway/Render/DO) + Next.js dashboard (Vercel) |

---

## 2. Production Tech Stack

### Hybrid Custom Stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| **Telephony** | SautiKit API (+254 DIDs, KES billing, free inbound, bidirectional WebSockets) | Replaces Twilio; local pricing, Kenya DIDs, prepaid KES wallet |
| **Orchestration** | Custom Node.js/Express (`server.js` → modular `src/`) | Replaces Vapi/Retell; cost control + full turn-taking ownership |
| **Speech (STT & TTS)** | Soniox realtime WebSockets | Existing investment + custom voices; must use interim STT for latency |
| **Intelligence (LLM)** | Google Gemini / OpenAI GPT-4o-mini | Conversational logic, instant fillers, RAG via prompt injection |
| **Database & Storage** | Supabase (PostgreSQL + S3-compatible Storage) | Replaces SQLite + local filesystem |
| **Voice hosting** | Railway / Render / DigitalOcean | Persistent server for long-lived SautiKit WebSockets |
| **Admin dashboard** | Next.js on Vercel | Client CRM / call history / agent config |

### Canonical external endpoints

| Service | Endpoint |
| --- | --- |
| SautiKit REST | `https://api.sautikit.com` |
| SautiKit media WS | Our `wss://…/ws/media` accepting subprotocol `audio.drachtio.org` |
| Soniox STT WS | `wss://stt-rt.soniox.com/transcribe-websocket` |
| Soniox TTS WS | `wss://tts-rt.soniox.com/tts-websocket` |

---

## 3. Core Call Flow & Data Pipeline

```
Caller (+254) 
    │  dial DID / diverted Safaricom|Airtel
    ▼
SautiKit voice_callback_url  ──POST──►  POST /voice/incoming
    │                                      │
    │◄──── XML <Stream connect="true" …/> ─┘
    │
    ▼
wss://…/ws/media  (audio.drachtio.org)
    │  binary S16LE PCM @ 8k/16k
    ▼
mediaStreamHandler
    ├─► Soniox STT (interim + final tokens)
    │       │  end-of-utterance
    │       ▼
    │   Instant filler TTS  ("Sawa, nakucheckia…")
    │       +
    │   LLM turn (Gemini / GPT-4o-mini)
    │       ▼
    │   Soniox TTS stream ──PCM──► SautiKit WS (play to caller)
    │
    └─► transcript buffer / barge-in cancel

SautiKit events_url ── call.completed / recording.ready ──► POST /voice/events
                                                              │
                                                              ▼
                                                         Supabase flush
                                                         WhatsApp notify
```

### Step-by-step

1. **Inbound call** — Caller dials a Safaricom/Airtel number (diverted) or the +254 DID directly.
2. **Webhook trigger** — SautiKit POSTs to `voice_callback_url` → `POST /voice/incoming`.
3. **Stream setup** — Express returns a **Stream** document (`connect="true"`) pointing at `wss://…/ws/media`.
4. **Audio streaming** — SautiKit forks **raw binary PCM** frames to `mediaStreamHandler` (not base64 mu-law; see §5 corrections).
5. **STT** — Audio is piped to Soniox STT. Orchestrator uses **interim / non-final tokens** + silence / endpointing to detect turn end.
6. **Instant reply / LLM**
   - **Fast path:** Localized filler (e.g. “Sawa, nakucheckia…”).
   - **Intelligence:** LLM processes transcript and generates the full reply (optionally streamed into TTS).
7. **TTS** — Soniox TTS converts text chunks → PCM; Express writes binary frames back on the same SautiKit socket.
8. **Post-call** — SautiKit sends `call.completed` (+ `recording.ready` when available). Express flushes transcript, duration, recording URL to Supabase and triggers WhatsApp.

---

## 4. Current Codebase Map → Target Modules

### Today (`main`)

| File | Role |
| --- | --- |
| `server.js` | Twilio webhooks, ConversationRelay WS (`/ws/relay`), Gemini turns, WhatsApp |
| `db.js` | SQLite via `better-sqlite3`; stable function surface |
| `.env.example` | Twilio + Gemini + WhatsApp env |

ConversationRelay means we currently receive **already-transcribed text** (`type: "prompt"`) and send **text to speak** (`type: "text"`). Production removes that abstraction: we own PCM ↔ STT ↔ LLM ↔ TTS.

### Target layout

```
src/
  server.js                 # HTTP + WS bootstrap
  config.js                 # env validation
  telephony/
    sautikitWebhook.js      # /voice/incoming + signature verify
    sautikitEvents.js       # /voice/events (call.completed, recording.ready)
    mediaStreamHandler.js   # PCM duplex WS (audio.drachtio.org)
  speech/
    sonioxStt.js            # realtime STT client
    sonioxTts.js            # realtime TTS client
    fillers.js              # EN / SW / Sheng instant replies
  intelligence/
    llm.js                  # Gemini / OpenAI provider switch
    prompts.js              # system prompt + RAG injection
    tools.js                # save_caller_info / end_call parsing
  orchestrator/
    turnManager.js          # VAD/endpointing, barge-in, filler+LLM race
    callSession.js          # per-call state machine
  db/
    supabase.js             # same surface as today's db.js
    schema.sql              # see docs/supabase/schema.sql
  notify/
    whatsapp.js             # SautiKit WhatsApp (Twilio bridge optional)
dashboard/                  # Next.js (separate deploy) — later phase
```

**Migration rule:** Keep `db.js` signatures (`upsertCall`, `saveCallerInfo`, `appendTranscript`, `attachRecording`, `getCall`, `markWhatsappSent`) so the orchestrator stays storage-agnostic while SQLite → Supabase swaps behind the interface.

---

## 5. API Reality Check (corrections to early drafts)

These details matter for implementation; early sketches assumed Twilio-like media framing.

| Assumption | Correct SautiKit / Soniox behavior |
| --- | --- |
| Base64 mu-law packets | **Raw binary S16LE PCM** frames over WebSocket |
| JSON “start stream” command like Twilio Media Streams | Return **`<Stream …/>` XML** (JSON `stream` verb via SDK helper; native JSON runtime still evolving) |
| Event `call.ended` | Use **`call.completed`** (+ `call.failed`); also **`recording.ready`** |
| Any WS path works | Must accept subprotocol **`audio.drachtio.org`** |
| Stream alone holds the call | Must set **`connect="true"`** or the leg hangs up ~1s later |
| Sample rates | Prefer `outputSamplingRate` / `bidirectionalSamplingRate` = **16000**; Soniox configured to match |
| Open metadata | First WS **text** frame may carry `streamSid`, caller/destination numbers — parse before binary audio |

### SautiKit inbound response (XML form — production-ready today)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Stream
    name="ai-receptionist"
    url="wss://VOICE_HOST/ws/media"
    track="inbound_track"
    connect="true"
    outputSamplingRate="16000"
    bidirectionalSamplingRate="16000"
    statusCallback="https://VOICE_HOST/voice/stream-status"
    statusEvents="stream-started stream-stopped stream-error" />
</Response>
```

**Webhook branching:** SautiKit re-invokes `voice_callback_url` on lifecycle edges (`StreamStopped`, `Completed`, etc.). Return the Stream document **only** on the initial answered edge; return empty `<Response/>` (or hangup/redirect as designed) on subsequent POSTs to avoid re-fork errors.

### Number routing

```bash
PATCH /v1/numbers/{id}/routing
{
  "voice_callback_url": "https://VOICE_HOST/voice/incoming",
  "events_url": "https://VOICE_HOST/voice/events"
}
```

Verify webhooks with `X-Sautikit-Signature` (HMAC-SHA256 over `body + '.' + ts`).

---

## 6. Latency Budget (sub-second UX)

Target: **first audible agent audio ≤ ~800–1200 ms** after caller stops speaking (p50).

| Segment | Budget | Tactic |
| --- | --- | --- |
| STT endpoint detect | 150–300 ms | Soniox interim tokens + local silence gate |
| Filler TTS start | +100–200 ms | Pre-rendered or cached filler PCM per locale |
| LLM first tokens | 300–700 ms | Gemini flash / GPT-4o-mini; `thinkingLevel: MINIMAL` (see PR #1) |
| TTS first audio | 100–250 ms | Stream LLM tokens into Soniox TTS (`text` chunks, `text_end`) |
| Media hop | <50 ms | Co-locate voice engine near SautiKit / low RTT region |

**Parallelism:** Fire filler TTS immediately on end-of-utterance while LLM runs; cancel filler mid-play only if full reply is ready and barge-in policy requires it.

**Barge-in:** On new inbound speech during TTS, stop Soniox TTS stream, clear outbound PCM queue, resume STT listening.

---

## 7. Intelligence Layer

### Conversation contract (preserved from Phase 1)

1. Capture caller **name**
2. Capture short **reason**
3. Confirm both, promise callback, goodbye
4. Persist via structured markers (or native tool calling once media path is stable)

### Locale

- Default: natural Kenyan English
- Detect / prefer Swahili or Sheng from STT language hints (`language_hints: ["en", "sw"]`) and first utterances
- Fillers localized in `speech/fillers.js`

### RAG (phase 2+)

Inject business profile (hours, services, pricing snippets) into system instruction from Supabase `businesses` / `knowledge_chunks` at call setup — not mid-turn retrieval for v1 latency.

### Provider switch

```
LLM_PROVIDER=gemini|openai
GEMINI_API_KEY=…
OPENAI_API_KEY=…
```

Keep marker parsing (`###TOOL###` / `###ENDCALL###`) until tool-calling is proven under streaming TTS.

---

## 8. Data Model (Supabase)

See [`docs/supabase/schema.sql`](./supabase/schema.sql).

**Core tables**

- `businesses` — tenant, DID, WhatsApp destination, prompt overrides
- `calls` — replaces SQLite `calls` row (same fields + `duration_seconds`, `provider_call_id`)
- `call_events` — raw webhook audit / idempotency (`event_id`)
- `knowledge_chunks` — optional RAG corpus (later)

**Storage bucket:** `call-recordings` — store SautiKit recording copies or signed URL references.

**Idempotency:** Deduplicate SautiKit deliveries via `X-Sautikit-Idempotency-Key` / `event_id` before WhatsApp send.

---

## 9. Environment Variables (target)

```bash
# Runtime
PORT=3000
PUBLIC_BASE_URL=https://voice.example.com

# Intelligence
LLM_PROVIDER=gemini
GEMINI_API_KEY=
OPENAI_API_KEY=

# SautiKit
SAUTIKIT_API_KEY=
SAUTIKIT_WEBHOOK_SECRET=
SAUTIKIT_VALIDATE_WEBHOOKS=true

# Soniox
SONIOX_API_KEY=
SONIOX_STT_MODEL=stt-rt-v5
SONIOX_TTS_VOICE=               # custom / catalog voice id
SONIOX_SAMPLE_RATE=16000

# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Notifications
WHATSAPP_PROVIDER=sautikit|twilio
BUSINESS_OWNER_WHATSAPP_NUMBER=
# Twilio bridge (cutover only)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=
```

---

## 10. Phased Migration Plan

### Phase 0 — Blueprint & contracts *(this PR)*

- Document architecture, API corrections, schema, module map
- Document full product/technical requirements ([`REQUIREMENTS.md`](./REQUIREMENTS.md))
- Document phase-by-phase implementation checklist ([`REQUIREMENTS_BY_PHASE.md`](./REQUIREMENTS_BY_PHASE.md))
- No production cutover

### Phase 1 — Persistence swap (low risk)

- Implement `src/db/supabase.js` with identical exports to `db.js`
- Feature flag `DB_BACKEND=sqlite|supabase`
- Dual-write optional; verify dashboard queries

### Phase 2 — SautiKit voice webhook (no AI yet)

- `POST /voice/incoming` returns Stream XML / Say greeting
- `POST /voice/events` handles `call.completed` / `recording.ready`
- Signature verification; number routing in SautiKit console
- Keep Twilio path behind `TELEPHONY_PROVIDER=twilio|sautikit`

### Phase 3 — Media path + Soniox STT echo

- `/ws/media` with `audio.drachtio.org`
- Pipe inbound PCM → Soniox STT; log transcripts only (no TTS back)
- Validate sample rates, openMetadata, stream-status callbacks

### Phase 4 — Full duplex agent

- Soniox TTS outbound PCM
- Turn manager: fillers, barge-in, Gemini/OpenAI
- Port `save_caller_info` + WhatsApp gate from current `server.js`
- Load test concurrent calls on persistent host

### Phase 5 — Cutover

- Point DIDs / call-forwarding to SautiKit numbers
- Disable Twilio ConversationRelay
- WhatsApp → SautiKit messaging API
- Remove SQLite / Twilio deps from default start path

### Phase 6 — Admin dashboard (parallel track)

- Next.js on Vercel reading Supabase (`calls`, recordings, per-business config)
- Auth via Supabase Auth; RLS per `business_id`

---

## 11. Hosting & Ops

| Component | Requirement |
| --- | --- |
| Voice engine | Sticky / long-lived process; WebSocket-friendly; no serverless freeze |
| Region | Prefer low latency to SautiKit Kenya edge |
| Health | `GET /healthz` — process up + optional Soniox/Supabase ping |
| Observability | Per-`call_id` structured logs; latency histograms (STT / LLM / TTS) |
| Secrets | Platform env only; never commit keys |
| Scale | One WS session per call; horizontal scale with sticky routing or single powerful node first |

---

## 12. Risk Register

| Risk | Mitigation |
| --- | --- |
| PCM / sample-rate mismatch → robotic or silent audio | Lock 16 kHz end-to-end; log first-frame sizes |
| Re-entrant voice callbacks re-open Stream | Branch on `callSessionState` |
| LLM thinking latency (seen on Gemini 3.x) | Keep `thinkingLevel: 'MINIMAL'`; prefer flash / 4o-mini |
| Soniox interim noise → false turn ends | Require min final chars + silence ms |
| WhatsApp double-send on webhook retries | `whatsapp_sent` + idempotency keys |
| Dashboard before schema stabilizes | Ship schema + RLS first; UI later |

---

## 13. Acceptance Criteria (production voice path)

- [ ] Inbound +254 call answered by Stream within platform timeout
- [ ] Bidirectional PCM with barge-in
- [ ] EN / SW filler heard before full LLM reply (p50)
- [ ] Name + reason persisted to Supabase
- [ ] `call.completed` + recording URL attached
- [ ] Exactly one WhatsApp owner notification per call
- [ ] Twilio ConversationRelay no longer required for happy path

---

## 14. Implementation Order for Next PRs

1. **Supabase adapter + schema** (Phase 1)
2. **SautiKit webhook skeleton + feature flag** (Phase 2)
3. **Media WS + Soniox STT** (Phase 3)
4. **TTS + turn manager + cutover flags** (Phases 4–5)

Do not attempt a big-bang rewrite of `server.js` in one PR. Extract modules behind provider flags so Twilio Phase 1 remains runnable until SautiKit is proven.
