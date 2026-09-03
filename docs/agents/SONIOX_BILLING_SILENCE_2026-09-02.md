# Live incident — business assistant silent (Soniox 402)

**Date:** 2026-09-02  
**Lane:** Voice  
**Environment:** Railway **staging** (`scalers staging`), DID `+254709221536`  
**Tenant:** Done and Dusted Cleaning Services (agent Shy)

## What callers heard

The line answered. The assistant did not speak. Callers hung up in 5–11 seconds. Desk resolution: `abandoned`. Language stayed `unknown` (STT never produced a final).

## Evidence

Staging Railway logs, same pattern on three recent calls:

| Call SID | Time (UTC) | Duration | STT | TTS |
| --- | --- | --- | --- | --- |
| `HD_20e63f37fc5b` | 2026-09-01 14:15 | 5s | 402 | 402 then 400 stream not found |
| `HD_989cf945dcb5` | 2026-09-02 07:24 | 11s | 402 | 402 then 400 |
| `HD_64c87c46467b` | 2026-09-02 08:33 | 8s | 402 | 402 then 400 |

Canonical TTS failure (08:33):

```
[soniox-stt][HD_64c87c46467b] error: 402 Organization balance exhausted. Please either add funds manually or enable autopay.
[soniox-tts][HD_64c87c46467b] session open ...
[ws/media][HD_64c87c46467b] greeting ... How can I help?
[ws/media][HD_64c87c46467b] tts prep ...
[soniox-tts][HD_64c87c46467b] begin stream=...
[soniox-tts][HD_64c87c46467b] error: 402 Organization balance exhausted.
[ws/media][HD_64c87c46467b] TTS speak failed: Organization balance exhausted.
[soniox-tts][HD_64c87c46467b] error: 400 Stream ... not found. Send a start message first.
```

Brain/greeting path was healthy: tenant prompt loaded, English intro composed, `speakText` ran. **No PCM left the media socket.**

Last working conversational calls on this DID were 2026-08-31 (STT finals, intents, one escalation). First 402 cluster: 2026-09-01 14:15.

Production Railway (`scalers-project`) last successful deploy: 2026-08-13. No production media logs in the 2026-09-01..02 window. Staging is the live test DID.

## Root cause

Soniox **organization balance exhausted** (HTTP 402) on the shared `SONIOX_API_KEY`. Both realtime STT and TTS reject the first authenticated message. The WebSocket still opens, so Voice treated TTS as ready (`ttsReadyPromise` resolved on socket open), generated a greeting, then swallowed `TTS speak failed` and left dead air.

This is **not** a prompt, barge-in, or Gemini hang. Gemini-down recovery cannot speak either: it also goes through Soniox TTS.

## Why the transcript lied

`speakText` caught the 402 and returned. The greeting IIFE still pushed `Agent: <greeting>` into the in-memory transcript. The caller never heard it.

## Patch (this PR)

1. Classify Soniox 402 as billing/fatal (`src/speech/sonioxErrors.js`).
2. Fail the TTS session on billing so later `speak()` does not retry a dead provider.
3. Record last STT/TTS error on `GET /healthz` → `soniox.lastError.billingExhausted`.
4. On billing/fatal STT or TTS: speak one emergency line (espeak-ng in the Docker image, else Gemini TTS) and hang up. Do not log a greeting as spoken unless Soniox actually accepted audio.
5. Desk `/api/tts/preview` returns a billing message instead of "Soniox returned no audio".

## Ops follow-up (required to restore conversation)

Checked again **2026-09-02 16:59 UTC** (and `/healthz` at 17:57 UTC): Soniox is **still 402** on staging. The API key is present and valid. The organization has no credit. Payments have not landed on this account yet.

Add funds or enable autopay on the Soniox organization that owns `SONIOX_API_KEY`, then:

1. Confirm `GET /healthz` `soniox.lastError.billingExhausted` is false after a test call.
2. Place a DID test: greeting audible, STT finals in logs, caller can interrupt.
3. After one successful TTS turn, Voice warms clone-voice downtime clips so the next outage still sounds like the same person.

Until Soniox is funded, callers hear the emergency path (espeak today; clone-voice recording once clips are warmed or packaged).
