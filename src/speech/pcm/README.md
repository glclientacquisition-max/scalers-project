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

Staging warmed clone-voice clips on 2026-09-03 after Soniox credits landed (EN 174764 PCM bytes, SW 215724). Those files live in the running container only until this folder is filled.

## Line-unavailable clips (not outage clips)

`line-unavailable-en.v1.wav` and `line-unavailable-sw.v1.wav` are played (via SautiKit `<Play>`) to callers of an archived or suspended business, before any Stream (#639). Same voice and render path as the downtime clips. Voice uploads them to SautiKit and refreshes the signed URLs; see `src/sautikit/lineUnavailableAudio.js`. A new recording gets a new name (`.v2`).
