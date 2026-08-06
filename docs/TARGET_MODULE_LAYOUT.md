# Target module skeleton (Phase 2+)

This tree is the **intended** production layout from
[`ARCHITECTURE_MIGRATION_BLUEPRINT.md`](./ARCHITECTURE_MIGRATION_BLUEPRINT.md).

**Phase 1 done:** `src/lib/supabaseClient.js` + `src/db.js` replace SQLite.

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

## Provider flags (planned)

| Flag | Values | Notes |
| --- | --- | --- |
| `TELEPHONY_PROVIDER` | `twilio` \| `sautikit` | Default `twilio` until Phase 4–5 |
| `WHATSAPP_PROVIDER` | `twilio` \| `sautikit` | Twilio until messaging cutover |
| `LLM_PROVIDER` | `gemini` \| `openai` | Default `gemini` |

## Stable DB surface

```js
await upsertCall({ callSid, fromNumber, toNumber })
await saveCallerInfo({ callSid, name, reason })
await appendTranscript({ callSid, transcript })
await attachRecording({ callSid, recordingUrl, recordingSid, sourceUrl, authHeader })
await getCall(callSid)
await markWhatsappSent(callSid)
```
