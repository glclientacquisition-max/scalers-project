# Target module skeleton (Phase 2+)

This tree is the **intended** production layout from
[`ARCHITECTURE_MIGRATION_BLUEPRINT.md`](./ARCHITECTURE_MIGRATION_BLUEPRINT.md).
Modules are introduced incrementally behind provider flags; do not delete
Twilio/`server.js` paths until Phase 5 cutover.

```
src/
  config.js
  telephony/
    sautikitWebhook.js      # POST /voice/incoming → Stream XML
    sautikitEvents.js       # POST /voice/events → call.completed / recording.ready
    mediaStreamHandler.js   # wss /ws/media (audio.drachtio.org, PCM duplex)
  speech/
    sonioxStt.js
    sonioxTts.js
    fillers.js              # EN / SW / Sheng instant replies
  intelligence/
    llm.js
    prompts.js
    tools.js
  orchestrator/
    turnManager.js
    callSession.js
  db/
    supabase.js             # same exports as root db.js
  notify/
    whatsapp.js
```

## Provider flags (planned)

| Flag | Values | Default during migration |
| --- | --- | --- |
| `TELEPHONY_PROVIDER` | `twilio` \| `sautikit` | `twilio` until Phase 4 proven |
| `DB_BACKEND` | `sqlite` \| `supabase` | `sqlite` until Phase 1 verified |
| `WHATSAPP_PROVIDER` | `twilio` \| `sautikit` | `twilio` until messaging cutover |
| `LLM_PROVIDER` | `gemini` \| `openai` | `gemini` |

## Stable DB surface (do not break)

```js
upsertCall({ callSid, fromNumber, toNumber })
saveCallerInfo({ callSid, name, reason })
appendTranscript({ callSid, transcript })
attachRecording({ callSid, recordingUrl, recordingSid })
getCall(callSid)
markWhatsappSent(callSid)
```

Any Supabase adapter must implement these so orchestrator code stays unchanged.
