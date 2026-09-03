# Clone-voice downtime clips

WAV files here are 16 kHz mono PCM, spoken with the Scalers Soniox clone
(`7b197f3c-84b4-4404-986f-114e4dac1432`), the same voice as the live greeting.

Render after Soniox billing works:

```bash
SONIOX_API_KEY=... node scripts/render-outage-clips.js
```

Runtime load order: in-memory warm cache, then `/tmp`, then these packaged files.
Do not commit espeak or Gemini stand-ins here.
