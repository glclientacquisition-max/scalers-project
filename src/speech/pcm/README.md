# Clone-voice downtime clips

WAV files here are 16 kHz mono PCM for the **platform default** clone
(`7b197f3c-84b4-4404-986f-114e4dac1432`). Other catalog voices warm at runtime.
Do not put tenant names in these files. See `docs/agents/VOICE_DOWNTIME_AT_SCALE.md`.

Render after Soniox billing works:

```bash
SONIOX_API_KEY=... node scripts/render-outage-clips.js
```

Runtime load order: in-memory warm cache, then `/tmp`, then these packaged files.
Do not commit espeak or Gemini stand-ins here.
