# Voice speed & consistency — way forward

**Goal:** Calls should feel **consistently snappy** — first agent audio usually within **~800–1200 ms** after the caller stops, without sounding rushed, cut-off, or randomly slow.

This is a Voice-lane program. Brain owns reply *content*; Voice owns *when* and *how* audio starts and stops.

---

## What “good” means

| Dimension | Target |
| --- | --- |
| **Speed (p50)** | First audible audio ≤ 800–1200 ms after end-of-utterance |
| **Speed (p90)** | ≤ ~1800 ms (no long silent dead-air) |
| **Consistency** | Same call shouldn’t swing between “instant” and “awkward pause”; pacing, barge-in, and pronunciation feel stable |
| **Clarity** | Kenya EN/SW/Sheng still clear on mobile — do **not** win speed by overspeeding TTS |

---

## Where time actually goes today

```
Caller stops
  → Soniox endpoint + local adaptive flush     (~300–900 ms)
  → Gemini first tokens                        (~300–800 ms)
  → Stream buffer waits for sentence/clause    (~0–400 ms)  ← often hidden latency
  → Soniox TTS beginSpeak + first PCM          (~100–300 ms)
  → (optional) thinking-ack at ~400–550 ms if LLM is slow
```

**Consistency killers we see in the path:**

1. First TTS waits for a full sentence (or 28-char comma clause) before speaking.
2. Opening a TTS stream only after the first chunk (serial setup).
3. Endpoint/flush defaults that sometimes wait nearly a full second on short answers.
4. Filler cancel / overlap races (partially fixed in PR #74).
5. No per-turn timing logs → hard to know if a “slow call” was STT, LLM, or TTS.

---

## Principles

1. **Measure before guessing** — every turn logs stage timings.
2. **First audio beats perfect sentence** — speak a short clause ASAP; finish the thought in the next chunk.
3. **Warm the pipe** — prefetch TTS while Gemini starts; don’t pay setup on the critical path.
4. **Stable defaults > clever one-offs** — tune env defaults so every deploy feels the same.
5. **Don’t sacrifice Kenya clarity** — TTS speed stays ≤ ~1.0; Swahili can stay slightly slower.
6. **Filler is a safety net, not the product** — auto ack only when first audio is late; prefer real reply audio.

---

## Phased plan

### Phase 1 — Foundation (this PR)

Ship the levers that raise *average* speed and reduce variance without live A/B infra:

| Change | Why |
| --- | --- |
| Per-turn timing logs (`voice-timing`) | See STT→LLM→TTS splits in Railway logs |
| Prefetch TTS at turn start | Remove beginSpeak from first-chunk critical path |
| Earlier stream flush (shorter clause / word flush) | First audio before full sentence |
| Filler stop without killing prefetch streams | Avoid cancelling the reply TTS we just warmed |
| Tighter defaults (endpoint, flush, filler delay) | More consistent snappy feel |
| Slightly tighter Gemini voice config | Shorter, more stable spoken lines |

**Success signal:** logs show `first_pcm_ms` clustering under ~1200 on typical turns; fewer “silent then dump” turns.

### Phase 2 — Consistency hardening

| Change | Why | Status |
| --- | --- | --- |
| True SautiKit media clear (`killAudio`) on barge-in | Stop talk-over after interrupt | Done |
| Accumulate interim STT for barge decisions | Fewer missed “wait/stop” interrupts | Done |
| Don’t flush mid-thought (`…and.`) / skip interrupt-only Gemini turns | Live DID `HD_0cdf315f02e9` | Done |
| Cached micro-ack PCM per locale (optional) | Instant ack when LLM is actually slow | Next |
| Greeting always instant + tenant warm before first PCM | No default-name greeting flash | Next |
| Extract media session from `server.js` | Safer iteration on turn loop | Next |

Live evidence + next Brain hand-offs: [`LIVE_CALL_FINDINGS.md`](./LIVE_CALL_FINDINGS.md).

### Phase 3 — Operate like a product

| Change | Why |
| --- | --- |
| Persist turn timings (or sample to Supabase/log drain) | p50/p90 over real Kenya calls |
| Env “voice profile” (`balanced` / `snappy`) | One-knob deploy tuning |
| Regression checklist on staging DID | Manual script: yes/no, name, barge, SW switch |

---

## Recommended production defaults (Phase 1)

```bash
VOICE_LLM_STREAM=on
VOICE_GREETING_MODE=instant
VOICE_FILLER=auto
VOICE_FILLER_DELAY_MS=400
SONIOX_MAX_ENDPOINT_DELAY_MS=700
VOICE_FLUSH_MIN_MS=300
VOICE_FLUSH_MAX_MS=1200
SONIOX_TTS_SPEED=0.95
SONIOX_TTS_SPEED_SW=0.92
GEMINI_THINKING_LEVEL=MINIMAL
GEMINI_MAX_OUTPUT_TOKENS=120
# stream buffer (code defaults): earlyFlushChars=18, earlyFlushWords=5
```

---

## What we will *not* do

- Crank TTS to 1.2+ (mushy on Safaricom/Airtel).
- Force a filler every turn (robotic; hurts consistency).
- Rewrite Brain prompt policy in Voice PRs (hand off content issues).
- Optimize for lab Wi-Fi only — judge on real DID calls.

---

## How to read timing logs

Look for:

```
[voice-timing][callSid] turn_ms=… endpoint_to_llm_ms=… first_chunk_ms=… first_pcm_ms=… filler=0|1
```

| Pattern | Likely cause |
| --- | --- |
| High `endpoint_to_llm_ms` | STT / local flush too patient |
| High `first_chunk_ms` with low LLM wait | Stream buffer holding too long |
| High `first_pcm_ms` after chunk | TTS setup / Soniox |
| `filler=1` often | Reply path still slow — fix LLM/TTS, don’t lower filler forever |

---

## Ownership

- **Voice lane:** this doc + media/STT/TTS/turn-taking changes
- **Brain lane:** if replies are long-winded or inconsistent in *wording*
- **Platform:** only if we persist metrics to Supabase
