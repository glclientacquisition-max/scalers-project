# Silent DID test after #238 — Done and Dusted (2026-09-10)

Staging DID `+254709221536` (Shy). Caller `+254790381872`. Call `HD_0ae324d56f23` (~06:18 UTC, 48s). Staging `/healthz.gitSha=65883c8` (`#238` on `main`).

The line answered. The caller heard **no agent audio**. Transcript still stored a greeting and a reply (*I am doing great, thank you for asking!*). Railway:

```
⚠ Soniox voice not ready voice=7b197f3c-84b4-4404-986f-114e4dac1432 model=tts-rt-v1 status=missing
```

`tts-rt-v1` was removed 2026-08-31. Clone voices must be `ready` on `tts-rt-v2`. Staging did not pin `SONIOX_TTS_MODEL`; `#238` still defaulted to v1. TTS opened a stream and logged chunks, but Soniox returned no PCM.

Fix: default and remap to `tts-rt-v2` (even if env is still v1), recompute the clone when status is `missing`, log `silent stream` when a TTS stream terminates with 0 bytes.

Earlier the same morning `HD_7ef72820c4b5` (~06:13, pre-`#238` boot) still had a full conversation. Silence started on the v1-default deploy, not hangup.

---

# Speech naturality — Done and Dusted (2026-09-10)

Staging DID `+254709221536` (Shy) on `main` `#237` (`VOICE_PROFILE=balanced`, speed 1.0, gain 1.22). Caller `+254790381872`.

| Call SID | Duration | What the caller heard |
| --- | --- | --- |
| `HD_3bf5d73422fd` | 44s | Greeting → **Are you still there?** (5s) → **Alright.** (thinking-ack) → *I'm doing well, thank you!* + service pitch → **Are you still there?** again. Caller only said *How are you doing?* twice. |
| `HD_3fc0d4ba863a` | 13s | Greeting → idle nudge started → abandoned. |
| `HD_fa53b29c5cb0`, `HD_c393a3315e15`, `HD_a9ae13b3d120` | 31–39s | Same morning, other caller. Greeting then *Are you still there?* then hangup. Abandoned. |

**What “struggling” is (not volume, not TTS speed):** the agent works to keep the call alive instead of waiting like a person.

1. Idle check-in 5s after the greeting (*Are you still there?*) reads as anxiety. Four abandoned calls this morning stop there.
2. Thinking-ack *Alright.* on *How are you doing?* because `how` looks like a content question. Sounds like stalling.
3. TTS exclamation (*thank you!*) makes Soniox punch/strain, then the next streamed sentence restarts.

Voice fix: do not arm idle nudge until the caller has spoken; calmer line (*How can I help?*); default delay 10s; skip thinking-ack on phatic turns; speak `!` as `.`.

**Articulation (where the struggle is loudest):** we were flushing 5-word / comma fragments into Soniox. The model treats each fragment as a finished utterance, so words are over-enunciated then restarted. That is the sounding-out quality. Default is now sentence-only flush (Pipecat does the same: sentence aggregation) and `tts-rt-v2`. Do not turn `reduce_silence` on. Hyphenated owner names (`Kris-to-fa`) stay a Desk pronunciation issue.

Brain leftover (separate lane): *I'm doing well, thank you!* plus an unsolicited couch/carpet/mattress list still violates the 1-sentence / no-lists phone rule.

---

# Live transfer spike — Done and Dusted (2026-09-06)

Staging DID `+254709221536` (tenant Done and Dusted Cleaning). Owner set **Connect live call**. Team dest `+254790381872`.

| Call SID | Time (UTC) | Voice SHA | What happened |
| --- | --- | --- | --- |
| `HD_6f9424c1289a` | ~06:25 | `main` `ce1664b` | Settings saved. Dial did **not** run. Voice still old `main`, flag unset. NBA ESCALATE (“live transfer is unavailable”). SMS to Alvin. Caller was **the same number as the Dial dest**, so even on new Voice this call would skip Dial. |
| `HD_0a8d5911d055` | 06:38 | `4ed0654` | Caller `+254715715894` (different phone). Queued Dial `+254790381872`. SMS sent. TTS “Okay, stay on the line.” WS closed `reason=live_transfer` at 23s. **No StreamStopped on `/voice/incoming`.** Next incoming was `Completed` at 86s and was treated as call-setup (re-Stream), so Alvin never rang. Caller sat on dead air after the AI left. |
| `HD_ae71b5349f5e` | 06:51 | `6ca12f6` | Same caller. Queued Dial, SMS, “stay on the line,” WS close at 45s. **No POST `/voice/transfer`.** Completed ~20s later; then `/voice/incoming` returned Dial XML (`action=dial`) on an already-ended call. Duration 66s. Alvin did not ring. |
| `HD_4f14d4d55244` | 06:53 | `6ca12f6` | Repeat. Same pattern. Dial XML again on Completed (73s). Zero `/voice/transfer` hits this session. |

**Finding:** StreamStopped does not re-hit the voice URL. Verbs after `<Stream connect="true"/>` (Redirect) also do not run. Closing the media socket leaves the PSTN on dead air until hangup, then Completed. Cold Dial via webhook XML is not executable on this SautiKit Stream path. Next spike must use REST (`POST /v1/calls` into a conference) or live call-control, not another WS-close.

Staging Voice is on `cursor/live-transfer-spec-3c65`. `/healthz` shows `liveTransfer.executor=true`, `ignoreHours=true` (Sunday hours bypass). Production Voice was not retargeted.

**Do not repeat the WS-close spike.** Staging `VOICE_LIVE_TRANSFER` is **off** again so callers get SMS + AI on the line, not dead air.

Next build: conference hold + `POST /v1/calls` into the same room ([SautiKit call-center guide](https://sautikit.com/developers/guides/build-a-call-center-with-conferences)). That is a dedicated Voice spike. Do not turn the env flag on until Alvin’s phone rings.

---

# Live call findings — Ngong Hills Hotel (2026-08-11)

Later incident (assistant silent, Soniox 402 billing): [`SONIOX_BILLING_SILENCE_2026-09-02.md`](./SONIOX_BILLING_SILENCE_2026-09-02.md).

Later incident (mid-call mute after barge-in): staging `HD_5de59f6babc7` (2026-09-04). Caller overlapped the next question. Barge-in cancelled TTS. Soniox `400 Stream … not found` then marked the whole TTS session dead. Gemini still wrote the reply; the caller heard silence. Desk transcript stored the unheard line. Fix: treat that 400 as a stale stream, not a provider outage.

Analyzed production calls on DID `+254709221536` (agent **Zara**) after Voice Phase 1–2 merges.

## Calls reviewed

| Call SID | Time (UTC) | Duration | Outcome |
| --- | --- | --- | --- |
| `HD_0cdf315f02e9` | 04:36 | 48s | Primary test — barge chaos, reason only |
| `HD_4667f03f825d` | 04:33 | 42s | Language flip / greeting mix |
| `HD_6c44c4b430d7` | 04:29 | 92s | Name-ask loop, slow progress |
| `HD_6851d9481091` | 04:08 | 130s | Better (Mr. Felix + Wi‑Fi), still sticky name asks |

## What the primary call sounded like (`HD_0cdf315f02e9`)

Reconstructed behavior:

1. Caller starts booking an executive room mid-sentence (`…room,and.`).
2. Agent answers with invented holding lines: *“Take your time. I'm right here whenever you're ready.”* (twice).
3. Caller tries to interrupt: *“No, wait—”*, *“Wait.”*, *“Stop, stop, stop.”*
4. Agent keeps re-entering with “I'm listening…” / later a **second closed-hours greeting**.
5. Lead saved with **reason only** — no name. Call ends frustrated.

## Root causes (prioritized)

### P0 — Voice turn-taking

1. **Incomplete STT flushed as final**  
   `"I'd like to make a booking of an executive room,and."` ends with `and.` — our incomplete detector treated trailing `.` as “complete”, so we ran a turn on a mid-thought fragment.

2. **Interrupt-only finals still burn a Gemini turn**  
   After barge-in, finals like `Wait.` / `Stop, stop, stop.` still hit the LLM, which invents more speech (“I'm listening…”), so the agent talks *again* instead of yielding.

3. **Barge-in still feels weak in the wild**  
   Phase 2 `killAudio` + interim accumulation helped detection, but the post-barge reply path re-opens speech too eagerly.

### P0 — Brain / knowledge (hand-off)

4. **Holding / stall lines**  
   “Take your time…” is not in our fillers — Gemini invented it, against the phone rules. Needs stronger prompt ban + post-filter.

5. **Closed vs hotel-open confusion**  
   Structured `hours_schedule` is office hours 08:00–18:00, while location text says hotel open 05:00–20:00. At 07:36 EAT the CONTEXT HEADER says CLOSED — accurate to schedule, wrong for a hotel front desk. Fix structured hours / “office vs property” semantics (Brain + Desk).

### P1 — Consistency / ops

6. **`latency_ms` was always null** + transcript rows share one timestamp → hard to prove live speed. Media now writes `first_pcm_ms ?? first_chunk_ms` onto the first agent line after each caller turn. Prove p50 on a staging DID next.
7. **Language sticky failures** (04:33): Swahili opener then English re-greetings in one call.
8. **Name-ask loop** when caller answers FAQs first — Brain turn policy.

## Way forward

### Sprint A — Voice (this PR)

| Fix | Why |
| --- | --- |
| Treat trailing `and.` / `but.` / comma tails as incomplete | Stop mid-thought turns |
| Skip Gemini on interrupt-only utterances (`wait` / `stop` / `no wait`) | After barge, **listen**, don’t talk |
| Extend flush delay when incomplete | Give caller time to finish booking sentence |

### Sprint B — Brain (separate lane)

| Fix | Why |
| --- | --- |
| Ban holding lines in prompt + strip if model emits them | Kill “take your time / one moment” |
| Prefer answer-first; ask name once after value | Stop name-ask loops |
| Clarify hotel open vs reservations office hours | Stop false “we're closed” at 7am |

### Sprint C — Platform / Voice metrics

| Fix | Why |
| --- | --- |
| Persist `latency_ms` from `voice-timing` on media flush | Prove p50 first-audio on real DID calls |
| Staging checklist from these scenarios | Booking mid-sentence, barge wait/stop, SW switch |

## Success criteria for next live test

- Caller can finish “I’d like to book an executive room and…” without agent cutting in on `and`.
- Saying **“wait / stop”** silences agent; next agent audio only after a real new request.
- One greeting only; closed/open matches hotel reality.
- Name + reason captured on a clean booking call under ~60s.
