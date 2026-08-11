# Live call findings — Ngong Hills Hotel (2026-08-11)

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

6. **`latency_ms` always null** + transcript rows share one timestamp → hard to prove live speed. Persist per-turn timing next.
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
| Write `latency_ms` + turn timestamps from `voice-timing` | Prove p50 first-audio on real DID calls |
| Staging checklist from these scenarios | Booking mid-sentence, barge wait/stop, SW switch |

## Success criteria for next live test

- Caller can finish “I’d like to book an executive room and…” without agent cutting in on `and`.
- Saying **“wait / stop”** silences agent; next agent audio only after a real new request.
- One greeting only; closed/open matches hotel reality.
- Name + reason captured on a clean booking call under ~60s.
