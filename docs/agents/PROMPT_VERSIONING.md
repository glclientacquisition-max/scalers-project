# Prompt and agent versioning

**Status:** Current problem documented (2026-08-14)  
**Implementation:** NOT started — future architecture project.

---

## Current problem

**FACT:** A production call cannot be reliably mapped to the exact agent configuration that handled it.

### What is NOT captured on the call record today

| Configuration element | Where it lives at call time | Stored on `calls`? |
| --- | --- | --- |
| Compiled system prompt | `tenants.llm_system_prompt` (loaded into memory) | **No** |
| Runtime prompt layers (context header, brain injection) | Assembled in `prompts.js` | **No** |
| Model ID | `GEMINI_MODEL` env | **No** |
| Model parameters (temperature, tokens, thinking) | Env vars | **No** |
| Soniox voice ID | `tenants.soniox_voice_id` | **No** |
| TTS/STT settings (speed, barge, endpointing) | Env vars | **No** |
| Tool schema / marker protocol version | Code version | **No** |
| `agent_tools` toggles | `tenants.agent_tools` | **No** |
| Pronunciation lexicon snapshot | `tenants.tts_lexicon` | **No** |
| Platform git SHA | Deploy metadata | **No** |
| Brain trace | stdout only | **No** |

### What IS persisted (partial picture)

| Data | Table / field |
| --- | --- |
| Transcript utterances | `transcripts` |
| Call outcome | `calls.resolution`, `calls.primary_intent`, `calls.summary` |
| Caller name/reason | `calls.summary` JSON |
| Service requests | `service_requests` |
| Current tenant config | `tenants.*` (mutates after call) |

**INFERENCE:** Investigating a past call requires guessing which tenant config was active at call time if settings changed since.

### Brain trace limitation

`brainObservability.js` emits `version: 1` — this is the **trace JSON schema version**, not an agent release version. Traces go to **stdout only**, not Supabase.

---

## Future target

To answer: *"Exactly what version of the Scalers agent handled this customer's call?"*

Persist a **call agent snapshot** at call start (or first profile load):

```
Agent Registry entry
  + Prompt Version (hash of llm_system_prompt + compile metadata)
  + Model (provider + model ID + parameters)
  + Voice (soniox_voice_id + catalog version)
  + Tool Schema Version (marker protocol / toolExecution contract)
  + Business Configuration Snapshot (hash of relevant tenant columns)
  + Platform Git SHA (voice deploy commit)
  + Environment fingerprint (non-secret env keys affecting behavior)
```

### Proposed snapshot fields (design only — not implemented)

| Field | Example |
| --- | --- |
| `agent_registry_id` | `scalers-receptionist@2026.08.1` |
| `prompt_hash` | `sha256(llm_system_prompt)` |
| `prompt_compiled_at` | From tenant metadata (future column) |
| `model_id` | `gemini-3.6-flash` |
| `voice_id` | `7b197f3c-...` |
| `tool_schema_version` | `1` |
| `tenant_config_hash` | Hash of catalog, FAQs, hours, lexicon, tools |
| `platform_git_sha` | `5b875dc` |
| `env_fingerprint` | Hash of `VOICE_*`, `SONIOX_*` tuning keys |

Store on `calls` row or `call_agent_snapshots` child table.

---

## FUTURE ARCHITECTURE PROJECT — AGENT VERSION TRACEABILITY

**Do not implement in governance Phase 2.**

### Prerequisites

1. Platform lane designs schema (additive migration).
2. `src/db.js` gains `attachAgentSnapshot({ callSid, snapshot })` — stable API first.
3. Agent registry document or table defines semver for platform agent bundles.
4. Desk compile writes `prompt_compiled_at` + `prompt_hash` on tenant (optional).
5. Voice engine captures snapshot in `ensureTenantPrompt()` after profile load.

### Out of scope for first iteration

- Full prompt text duplication on every call (hash + registry ref sufficient).
- Vector embedding version tracking.
- A/B experiment framework.

---

## Interim mitigations (no schema change)

| Mitigation | Limitation |
| --- | --- |
| Avoid changing `llm_system_prompt` during active calls | Operational discipline only |
| Export brain traces to log drain | Still not tied to call ID in DB |
| Note deploy SHA in Railway at call time | Manual correlation |

---

## Related documents

- [`AGENT_ARCHITECTURE.md`](./AGENT_ARCHITECTURE.md)
- [`../governance/TECHNICAL_DEBT.md`](../governance/TECHNICAL_DEBT.md) (TD-P0-1)
- [`../database/DATABASE_GOVERNANCE.md`](../database/DATABASE_GOVERNANCE.md)
- [`BRAIN.md`](./BRAIN.md)
