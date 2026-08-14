# Agent architecture

**Status:** Current-state documentation (2026-08-14)  
**Scope:** How the Scalers AI receptionist agent works today on live calls.

For lane ownership see `docs/agents/BRAIN.md`. For versioning gaps see [`PROMPT_VERSIONING.md`](./PROMPT_VERSIONING.md).

---

## Agent entry point

**FACT:** Live calls enter through `server.js` `mediaWss` handler (`/ws/media`).

On each finalized caller utterance:

1. Load tenant profile (`db.getTenantProfile`)
2. Update brain state (`brainState.js`, `nextBestAction.js`)
3. Call Gemini (`runGeminiTurnStreaming` in `server.js`)
4. Parse tool markers (`toolMarkers.js`)
5. Execute tools (`toolExecution.js`)
6. Speak response via Soniox TTS

**LEGACY alternate:** `/ws/relay` text-in/text-out path — not the production SautiKit PCM path.

---

## Prompt layers (runtime stack)

Built fresh per call and updated per turn. Order of precedence (highest first):

| Layer | Source | File |
| --- | --- | --- |
| 1. Context header | Clock, open/closed, bulletin, after-hours mode | `prompts.js` `buildContextHeader` |
| 2. Compiled system prompt | `tenants.llm_system_prompt` | Loaded via `getTenantProfile` |
| 3. Conversation rules | Static runtime rules | `prompts.js` `CONVERSATION_RULES` |
| 4. Live ground truth | Hours, locations, policies, FAQs, catalog overview | `liveKnowledge.js` |
| 5. Targeted products | Per-turn catalog matches | `productCatalog.js` |
| 6. Brain state injection | Intent, goal, entities, next action | `brainState.js` |
| 7. Authority policy | What tools are allowed | `brainPolicy.js` |
| 8. Language directive | en / sw / sheng sticky state | `language.js` |
| 9. Retail playbook | Vertical-specific guidance | `playbooks/retail.js` |
| 10. Escalate directive | Forced escalate when required | `requiredEscalate.js` |

Desk **compiler** (`promptCompiler.ts`) writes layer 2 only. Layers 1, 3–10 are runtime code.

---

## Model configuration

| Setting | Location | Default (`.env.example`) |
| --- | --- | --- |
| Provider | Hardcoded Gemini | `@google/genai` |
| Model | `GEMINI_MODEL` | `gemini-3.6-flash` |
| Thinking | `GEMINI_THINKING_LEVEL` | `MINIMAL` |
| Max output tokens | `GEMINI_MAX_OUTPUT_TOKENS` | 120 |
| Temperature | `GEMINI_VOICE_TEMPERATURE` | 0.35 |
| Stream to TTS | `VOICE_LLM_STREAM` | `on` |

Desk compile uses separate model default: `gemini-3.5-flash-lite` (`dashboard/.env.example`).

---

## Tool definitions

### Protocol

Gemini emits markers in spoken text:

```
###TOOL###{"save_caller_info":{"name":"...","reason":"..."}}###ENDTOOL###
###ENDCALL###
```

Parsed by `toolMarkers.js` → executed by `toolExecution.js`.

### Tools (current)

| Tool | Purpose | DB side effect |
| --- | --- | --- |
| `save_caller_info` | Name + reason | `saveCallerInfo` |
| `escalate` | Human handoff request | `saveEscalation` + notify |
| `create_service_request` | Hold/order/enquiry | `createServiceRequest`, `upsertContact` |
| `end_call` | Hang up | Session end |

### Tool toggles

`tenants.agent_tools` jsonb: `{ escalate: bool, end_call: bool }`  
Parsed by `agentTools.js`; defaults both `true`.

---

## Business instructions

Stored in **Supabase `tenants` columns** (not hardcoded in platform code):

| Column | Role |
| --- | --- |
| `llm_system_prompt` | Compiled receptionist instructions |
| `agent_name`, `agent_tone` | Persona |
| `services_catalog`, `product_catalog` | Offerings |
| `faqs`, `business_policies` | Knowledge |
| `hours_schedule`, `after_hours_mode` | Open/closed behavior |
| `team_directory` | Escalation targets |
| `unknown_answer_fallback` | Unknown-answer line |
| `daily_bulletin` | Temporary overrides |
| `tts_lexicon` | Pronunciation overrides |
| `soniox_voice_id` | Voice selection |
| `vertical`, `handoff_mode` | Retail / handoff policy |

Loaded once per media session in `ensureTenantPrompt()`.

---

## Memory and context

| Type | Mechanism | Persisted? |
| --- | --- | --- |
| Per-call brain state | `callBrainStates` Map | No |
| LLM message history | `messages[]` (window 16) | Transcript rows only |
| Language stickiness | `callLanguageState` | No |
| Tenant profile cache | `brainProfile`, `callTenantProfiles` | Source in DB |
| Cross-call memory | None | — |

---

## Knowledge retrieval

**Not vector RAG.** Structured injection:

- `liveKnowledge.js` — formats tenant fields for prompt
- `productCatalog.js` — `selectProductsForTurn()` keyword/category match per turn
- `dailyBulletin.js` — active bulletin items in context header

---

## Fallback logic

| Scenario | Behavior | Module |
| --- | --- | --- |
| Unknown facts | `unknown_answer_fallback` + policy | `prompts.js`, compiler |
| Slow Gemini | Fillers / progress lines | `dynamicSpeech.js`, env `VOICE_FILLER` |
| Missing compile key | Local template on desk | `onboarding.ts` |
| Required escalate omitted | Backend injects escalate | `requiredEscalate.js` |
| Tool validation failure | Spoken error + repair | `toolExecution.js`, `conversationRepair.js` |
| After hours | `after_hours_mode` serve vs message | `businessHours.js`, context header |

---

## Brain state machine

`brainState.js` tracks per call:

- Intent, goal, goal status, missing slots
- Entities (name, phone, item, …) with confirmation flags
- Language detection and switches
- Repair failure count
- Resolution status and next best action

Observability: `logBrainTrace()` → stdout JSON (PII-redacted entities).  
Trace schema version: `1` (not agent version).

---

## Voice configuration (per tenant + env)

| Concern | Tenant | Env (process-wide) |
| --- | --- | --- |
| Voice ID | `soniox_voice_id` | Default from catalog |
| Pronunciation | `tts_lexicon` | `TTS_LEXICON_OVERRIDES` |
| STT vocabulary | Profile fields | `SONIOX_STT_CONTEXT*` |
| TTS speed | — | `SONIOX_TTS_SPEED`, `SONIOX_TTS_SPEED_SW` |
| Greeting mode | — | `VOICE_GREETING_MODE` |
| Barge-in tuning | — | `VOICE_BARGE_*`, `SONIOX_MAX_ENDPOINT_DELAY_MS` |

**Gap:** Env tuning is not recorded per call.

---

## Per-tenant configuration load path

```
Call start → ensureTenantPrompt()
  → db.getTenantProfile({ callSid })
  → buildSystemPrompt(profile)
  → parseAgentTools(profile.agent_tools)
  → createBrainState(profile)
  → buildBrainCapabilities(...)
  → publishSttContext(profile)
  → resolveSonioxVoice(profile.sonioxVoiceId)
```

---

## Greeting (first agent speech)

`dynamicSpeech.js` → `businessAssistantIntro.js`:

Brand-first English-default opener before caller speaks. Language match starts on caller's first turn.

Desk preview uses parallel TS module — see duplication in [`../governance/TECHNICAL_DEBT.md`](../governance/TECHNICAL_DEBT.md).

---

## Related documents

- [`BRAIN.md`](./BRAIN.md) — lane contract
- [`PROMPT_VERSIONING.md`](./PROMPT_VERSIONING.md) — traceability gap + future target
- [`../architecture/DATA_FLOW.md`](../architecture/DATA_FLOW.md)
- [`../governance/SOURCE_OF_TRUTH.md`](../governance/SOURCE_OF_TRUTH.md)
