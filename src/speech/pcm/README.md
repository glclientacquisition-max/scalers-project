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

`downtime-en.wav` and `downtime-sw.wav` are required in git. A warm cache
inside a running process is not a substitute: if Soniox is already at 402
on cold boot, Voice loads these files. Do not leave this folder with only
`.gitkeep`.

```bash
node scripts/check-outage-clips.js
```

That check fails when either file is missing or shorter than 800 ms.
`/healthz` `soniox.outageClips.packaged.missing` is true in that case even
if memory clips were warmed earlier in the process.

Staging warmed clone-voice clips on 2026-09-03 after Soniox credits landed (EN 174764 PCM bytes, SW 215724). Those files live in the running container only until this folder is filled.
