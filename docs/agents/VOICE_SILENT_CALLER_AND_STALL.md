# VOICE_SILENT_CALLER_PROMPT + VOICE_MEDIA_STALL_WATCHDOG

Flagged fixes for greeting abandons (`HD_31d827427104`, `HD_1af0738130bc`,
`HD_226f814d7ab0`, `HD_9ed756701096`). Both default **off**.

| Flag | on |
| --- | --- |
| `VOICE_SILENT_CALLER_PROMPT` | After greeting playback, arm a one-shot "Hello, can you hear me?" / "Halo, unanisikia?" at ~5s, even before the caller's first utterance. |
| `VOICE_MEDIA_STALL_WATCHDOG` | Log `media_stall` when no binary frame arrives for ~2s while the socket is open. |

With both off, idle nudge still requires `heardCallerUtterance` (main behaviour).
