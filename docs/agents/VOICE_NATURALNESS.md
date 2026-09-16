# Voice naturalness eval

**Lane:** Voice.  
**Job:** Decide whether the receptionist sounds like a person on a Kenya mobile, then change **one** Voice-owned cause. Do not guess MOS. Do not crank TTS speed.

Roboticness on this platform is almost never “Soniox at 1.0 sounds like a robot.” It is **turn-loop anxiety**: fragment TTS, a one-word `Sure.` as its own utterance, hyphenated say-forms, thinking-ack on “How are you?”, idle poke, or Gemini lists. Speed and gain stay frozen until three scored DID calls exist on one SHA.

Listen harness (`npm run tts:listen-harness`) scores **isolated** fixture strings. This doc scores **conversation**. Use both. Do not substitute one for the other.

## Freeze (do this first)

Staging Voice at last check (2026-09-16T05:01Z):

| Knob | Value | Source |
| --- | --- | --- |
| SHA | `abf6aa97329bb8df151f06d52eac78a9ef14995e` | `GET /healthz` `gitSha` |
| Branch | `main` (`#281` holding-line copy) | healthz |
| Profile | `balanced` | healthz `voiceProfile` |
| EN / SW speed | `1` / `1` | healthz |
| Gain | `1.38` | healthz |
| Live transfer | off | healthz `liveTransfer.executor` |
| DID | `+254709221536` | Done and Dusted, agent Shy |
| Caller | `+254790381872` | existing test line |

Prior SHA `23debf0` left staging at 05:01Z. Do not mix SIDs from before that cutover into this freeze.

Re-read `/healthz` immediately before the three calls. If `gitSha` moved, that is a new freeze. Do not mix SIDs across SHAs.

**Do not change** `VOICE_PROFILE`, `SONIOX_TTS_SPEED*`, `VOICE_TTS_GAIN`, `VOICE_FILLER`, or `VOICE_STREAM_EARLY_*` until the three freeze calls are scored.

## Evidence triad (every call)

A score without all three is incomplete.

1. **Recording** or a live listen on a phone speaker (not laptop). Many staging `calls.recording_url` rows are empty; if empty, the listen is the recording.
2. **Desk transcript** (`transcripts.speaker` / `text_content` plus `latency_ms` when present).
3. **Railway logs** for that SID: `spoken=`, `[voice-timing]`, `thinking-ack`, `idle_nudge`, speed-scale.

Compare transcript vs `spoken=`. Desk text is what Gemini wrote. `spoken=` is what Soniox received after `prepareForTts`. Robotic extra words (`Al-vin`) live in `spoken=`.

Offline scan (transcript JSON, no retune):

```bash
node scripts/score-voice-naturalness.js --file tests/fixtures/voice-naturalness-sample.json
```

A Voice fail exits 1. Brain notes do not. This scanner does not replace the listen.

## Voice pass / fail (not 1–5)

Fail the call on any Voice row that fires. Brain rows are a hand-off. They do not justify a TTS retune.

| ID | Fail if | Evidence | Owner |
| --- | --- | --- | --- |
| V1 | Fragment TTS. A non-sentence chunk plays, then the rest restarts. | `spoken=` chunk with no `.?!` then the continuation; early-flush env not 0 | Voice stream buffer |
| V2 | `Sure.` / `Great.` / `Alright.` / `I'm listening.` as its own Soniox utterance | two `spoken=` lines; scanner V2 | Voice stream buffer |
| V3 | Hyphenated given name (`Al-vin`) | `spoken=` vs closer line | Voice lexicon sanitizer |
| V4 | TTS reads hyphen, full stop, slash, or `e.g.` | recording + `spoken=` still has the leak | Voice `polishPunctuation` |
| V5 | Thinking-ack on “How are you doing, Shy?” | `thinking-ack` log on a phatic turn | Voice matcher |
| V6 | Idle “Are you still there?” before the caller has spoken, or during a pause they asked for | `idle_nudge` log | Voice idle nudge |
| V7 | Filler every turn | `filler=1` on most `voice-timing` rows | Voice filler |
| V8 | Claims “I’ll speak louder” (Voice has no caller-driven gain) or types `...` instead of stepping `ttsSpeedScale` | next agent line vs speed-scale log | Voice speed control |
| V9 | Caller says wait / stop, agent talks anyway (“I'm listening”) | barge then a new TTS stream | Voice decision table |
| B1 | Service list on a greeting / how-are-you | transcript; scanner B1 | **Brain** |
| B2 | Name re-ask after the caller already gave it | transcript | **Brain** |
| B3 | Invented holding line (“Take your time”) | transcript | **Brain** |

Latency stays on the A5 sheet (`first_pcm_ms` 800–1200 p50). Slow is not the same as robotic. Do not “fix” roboticness by raising `SONIOX_TTS_SPEED`.

## Three freeze scripts

Same DID, same SHA, phone speaker. Keep `VOICE_LIVE_TRANSFER` off.

### N1. Phatic, then one job

1. Dial. Hear the greeting.
2. “How are you doing, Shy?”
3. Pause two seconds.
4. “Carpet cleaning tomorrow in Rongai. I am Alvin.”

**Pass:** one short well, then help. No V2/V5/V6. No catalogue recitation on step 2 (B1 → Brain). Name is Alvin, not Al-vin (V3).

### N2. Barge, then finish

1. After greeting, start a long request and talk over her.
2. Say **wait**.
3. Then: “Sorry. Pet stain removal, Thursday at 10.”

**Pass:** wait silences her (V9). Next audio is after the real request, not “I'm listening.” No fragment restart (V1).

### N3. Pace and money

1. “How much for couch cleaning?”
2. “Can you speak slower?”
3. Hear the next line.
4. “Normal speed.”

**Pass:** logs show speed scale step down then reset to 1. She does not type `...` (V8). She does not claim a volume change. Amounts come out as shillings words (clarity, not MOS). Profile stays `balanced`.

If N1 fails, still run N2 and N3 on the same SHA. The set is the measurement.

N1 detail: [`LIVE_CALL_FINDINGS.md`](./LIVE_CALL_FINDINGS.md). Do not retune until N2 and N3 are scored.

## After the three calls

1. Fill one A5 sheet per SID (`docs/operations/beta_voice_eval_checklist.md`). Paste Voice IDs into Naturalness. Leave the 1–5 box blank.
2. Run the scanner on the transcript JSON. Attach Voice fails.
3. Pick **one** Voice ID that failed. One PR. Do not mix Brain lists into that PR.
4. If all Voice IDs pass and the call still “sounds off,” it is Brain wording or Soniox clone timbre. Hand Brain a SID. Do not retune gain/speed to hide it.

## Historical inventory (not the freeze)

These SIDs trained the rubric. They are mixed SHAs. Do not average them into the freeze score.

| SID | When | What sounded robotic | Lane |
| --- | --- | --- | --- |
| `HD_3f7ed2a5f526` | 2026-09-10 | `Al-vin` after Done and Dusted; `Sure.` / `I'm listening.`; em dash; couch/carpet/mattress on how-are-you | Voice V2/V3/V4/V5 + Brain B1. Fixes in #241 / #238 / #267 / #274 |
| `HD_3bc36952c96f` | 2026-09-15 | “How are you doing, Shy?” → “I'm well, thanks. How can I help?” at 226 ms | Voice/Brain pass on V5 |
| `HD_825754f95b1f` | 2026-09-15 | Catalogue list **after** “Which service do you offer?” | Not B1 (asked). Clarity OK |
| `HD_5c2a3acde2da` | 2026-09-15 | “Improve your volume” → claimed louder (V8). “Speak slower” / “talk faster” (speed control exists; confirm logs on next freeze). “Let me think” then agent kept pitching | V8 + V9 / Brain pitch |
| `HD_f266ffce5b4f` | 2026-09-15 | Name confirm loop (“is this Alvin”) then a visit save | Brain B2 |
| `HD_f38e482f1d92` | 2026-09-15 | Apology loop, repeated owner name | Brain wording, not TTS |

Shipped Voice work that already targets this (do not redo before the freeze): sentence-only flush, tiny-lead-in hold, `Al-vin` collapse, punctuation net, idle nudge only after the caller has spoken, skip thinking-ack on named how-are-you, caller-requested speed scale.

## Related

- A5 sheet: [`docs/operations/beta_voice_eval_checklist.md`](../operations/beta_voice_eval_checklist.md)
- Speed program (do not crank): [`VOICE_SPEED_CONSISTENCY.md`](./VOICE_SPEED_CONSISTENCY.md)
- Live SID log: [`LIVE_CALL_FINDINGS.md`](./LIVE_CALL_FINDINGS.md)
- Brain CX map (lists, phatic): [`CALLER_EXPERIENCE_EXCELLENCE.md`](./CALLER_EXPERIENCE_EXCELLENCE.md) F7
