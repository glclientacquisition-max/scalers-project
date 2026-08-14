# Target module skeleton (future — not current layout)

> **Current state:** See [`docs/architecture/CURRENT_STATE.md`](./architecture/CURRENT_STATE.md).  
> Voice logic remains concentrated in `server.js` (~2,841 LOC). Partial extraction exists: `src/speech/`, `src/conversation/`, `src/sautikit/webhook.js`.

This tree is the **intended** production layout from
[`ARCHITECTURE_MIGRATION_BLUEPRINT.md`](./ARCHITECTURE_MIGRATION_BLUEPRINT.md).

**Done:** `src/lib/supabaseClient.js` + `src/db.js` replace SQLite. `src/speech/*` and `src/conversation/*` extracted.

```
src/
  lib/
    supabaseClient.js       # Phase 1 ✓
  db.js                     # Phase 1 ✓ — calls / transcripts / recordings
  config.js
  telephony/
    sautikitWebhook.js      # POST /voice/incoming → Stream XML
    sautikitEvents.js       # POST /voice/events → call.completed / recording.ready
    mediaStreamHandler.js   # wss /ws/media (audio.drachtio.org, PCM duplex)
  speech/
    sonioxStt.js
    sonioxTts.js
    fillers.js
  intelligence/
    llm.js
    prompts.js
    tools.js
  orchestrator/
    turnManager.js
    callSession.js
  notify/
    whatsapp.js
```

## Provider flags (planned — not implemented in `server.js`)

| Flag | Values | Notes |
| --- | --- | --- |
| `TELEPHONY_PROVIDER` | `twilio` \| `sautikit` | **Current:** SautiKit only (no flag). Legacy `/ws/relay` remains. |
| `WHATSAPP_PROVIDER` | `twilio` \| `sautikit` | **Current:** dispatch chain in `src/notifications/dispatch.js` |
| `LLM_PROVIDER` | `gemini` \| `openai` | **Current:** Gemini hardcoded |

## Stable DB surface

```js
await upsertCall({ callSid, fromNumber, toNumber })
await saveCallerInfo({ callSid, name, reason })
await appendTranscript({ callSid, transcript })
await attachRecording({ callSid, recordingUrl, recordingSid, sourceUrl, authHeader })
await getCall(callSid)
await markWhatsappSent(callSid)
```
