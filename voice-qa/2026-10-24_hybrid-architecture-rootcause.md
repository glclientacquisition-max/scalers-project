# 2026-10-24 Hybrid architecture root cause (read-only)

Scope: HD_a17139a56f0b, HD_87f73ce7003b on f120677b. **Data path / price dropped** (Alvin: KSh 40 was the live value at call time; 40 was spoken correctly). Correction to the earlier note: its "wrong price" finding and fix 1 are withdrawn.
Sources: code `/workspace/wt-v2c0` @ f120677b, `voice_turn_traces`, Railway logs (pulled about 09:10 EAT).

## Root cause (one statement)
The hybrid has no system-owned resolution step. Each turn goes through a **first-match-wins regex router** (`machine.js` runTurn) that returns **one template line** for the first intent it recognises. Facts and playbook obligations the caller raised in the same turn (an out-of-area place, a callback, feasibility) are not held as turn state. They are checked only inside particular branches, such as the booking-slot validator. The model is meant to fill that gap, but it runs as **three-plus uncoordinated Gemini calls per turn** under a serial cascade whose backup leg can never finish. When the model is ABSENT, nothing resolves what the template router skipped.

## Q2: dual cascade timeouts
| Evidence | Detail |
|---|---|
| Serial cascade, starved backup | `modelShadow.js:203-214`: `primaryBudget = 1800 − MIN_BACKUP_MS(250) − SLACK(80) = 1470 ms`. Backup gets at most ~330 ms of the leftover wall. The file's own note (`modelShadow.js:13`) says "backup warm often >2s". So when the primary misses 1470 ms, **dual timeout is guaranteed by construction**, not by load. Both T4s: `primaryTimedOut:true, backupTimedOut:true, latencyMs 1800/1801, answeredBy:none`. |
| Not prompt length | Input tokens are about constant: 4402–4629 on answered turns (trace `tokens.in`). Caller text is 7–61 chars on answered turns. Call 1 T4 timed out on a **45-char** turn, while T9 (61 chars) answered in 780 ms. The roughly 4.4k-token prompt is dominated by the static system prompt + catalogue (`buildModelRequest`, `modelShadow.js:130-135`). `cached:0` on every turn: no context caching of the static prefix. |
| Primary latency band | Answered turns: 780, 1005, 1108, 1143, 1279 ms. The P50 of about 1.1 s sits close to the 1470 ms primary budget, so any jitter falls into dual timeout. |
| Duplicate model calls per turn | In `mode=on`, `liveTurn.js:159` starts `shadow.begin()` (its own `cappedCascade`, `modelShadow.js:311`, with its own history). `liveTurn.js:166` then hands the machine **a second, separate `cappedCascade`** (different request via `machine.js:713 buildRequest`). `liveTurn.js:172` adds a `classify` call (gemini-3.5-flash-lite, 1200 ms timeout, `liveTurn.js:48-57`), fired whenever rules find no known intent (`classifyAsk.js:51`). That makes up to **5 concurrent Gemini requests per turn** on one key. The persisted `brain_v2_model` stage is the **shadow** copy. The cascade the mouth actually consulted is pushed only to in-memory `state.trace` (`machine.js:731`) and never reaches traces or logs. |
| Late launch | Both calls are only consulted after the merged final. Call 2 sat through 3 "unfinished hold 1600 ms" merges (logs: `unfinished turn, reply waits 1600ms` ×3) before any model request began, even though partial STT already had "come to Kisumu … window cleaning" about 5 s earlier. |
| Serial after the race | `machine.js:864` waits up to 750 ms (mouth fail-fast), then `machine.js:930` **awaits `classify` serially** (up to 1200 ms). That fits `first_chunk_ms ≈ 1965–2023` on every reply turn, even when the primary answered in about 1.1 s. |
| Fail-fast leaks work | `machine.js:752-762`: after fail-fast the cascade keeps running in the background. The next turn's calls start while the previous turn's are still in flight (call 1 T3 → T4 back-to-back after a barge-in). |

**Verdict:** this is a sequencing/design flaw, not the cap. The backup budget is structurally unreachable. There are duplicate shadow + machine cascades plus a classify call per turn. Classify runs serially after the race. The model is consulted only on the final merged text. Raising the cap would only hide this.

## Q3: why the template fallback skips area/callback
| Evidence | Detail |
|---|---|
| Area-out lives only in the booking validator | `machine.js:236-248`: the `area_out` + `create_handoff` callback line is emitted only inside the slot validator, when `s.place` is set **during a booking collect**. The `coverage` handler (`machine.js:605-636`) answers only when intent is `coverage`. |
| First-match-wins return | `machine.js:987`: `if (u.intents.includes('explain') && u.service) … return out(...)`. Call 2 T4 matched explain ("tell me more about the window cleaning", `nlu.js:21`) and **returned immediately**. brain-trace had `location:{value:"Kisumu", source:caller_explicit}`, which was never consulted: no branch before 987 checks a stated place against areas unless the intent is book/coverage (`machine.js:851`). |
| Explain template with no fact | Interior Window has no notes and no explain text, so `receipts.js:98-99` falls through to `${svcName}.` and the caller heard "Interior Window Cleaning." No "unknown" branch, no callback ladder. |
| Same pattern in call 1 | T6/T8 "Really? / Is it really 40 shillings?" went to the generic `cutOff`/repair branch (`machine.js:991-998`). T9 rules tagged `availability` and the router returned the coverage list, because location "Corner" was carried as an entity. Each turn is one regex verdict → one template. |
| Playbook state is model- or branch-local | The callback ladder (`machine.js:349-357`) and the weigher escalate (`machine.js:929, 1160`) fire only from specific collect/escalate paths. `HW.shouldApplyR7aSeed` (`machine.js:925`) is skipped when `answeredBy:none`. So with the model ABSENT, **no component asks "what did the caller raise that we owe an answer to?"** |

## Q4: one architectural break?
Yes. The "system speaks" layer chooses **a template**, not **a resolution**. Its inputs are a regex intent plus raw catalogue/spoken fields. It has no turn-level model of:
- the obligations the caller raised (place → in/out of area, feasibility "is it possible?", explain, price), and
- which of those can be answered from confirmed facts and which need an honest miss plus a callback.

The model was bolted on as a proposal source (`SYSTEM` prompt: "the server speaks fixed templates"). It can only nudge the router through R7a seeds, and only when it answers in time, which the cascade design makes unreliable on exactly the hard turns. The weigher (`hybridWeigher.js`) weighs *which path speaks*, not *what must be resolved*.

## What a structural fix looks like (design only)
1. **Turn resolver owned by the system (before any mouth).** Each final (and stable partial) produces a `TurnAsk` set: `{place?, service?, asks:[explain|price|feasible|book|…]}` from rules + any model proposal that arrived. Each ask resolves against confirmed facts into `answered(fact) | unknown(→callback) | out_of_scope(→area_out + callback)`. Every ask in the set must get a resolution before any line is composed. Out-of-area is a fact check on any stated place, not a booking-slot validator.
2. **Playbook as an explicit state machine** (enquiry → resolve → offer → close) whose transitions are driven by resolutions. A callback/ladder is a transition when any ask resolves `unknown`/`out_of_scope`, independent of whether the model answered.
3. **Mouth = composer over resolutions** (ordered: honesty first, area_out → explain/price → offer). Templates render resolutions; they never pick the topic. "Bare label" becomes impossible because an empty fact resolves to `unknown`.
4. **One model call per turn, parallel and early.** A single request (no separate shadow + machine + classify). Start it speculatively on stable partials. Cache the static prefix (system + catalogue) with context caching. Make the cascade **parallel or hedged** (start backup at ~T+600 ms if the primary hasn't answered) rather than serial with a 330 ms leftover. Cancel the previous turn's in-flight work on a new final. Persist the call the mouth actually consumed.
5. **The model's role narrows to filling `TurnAsk`** (extraction/disambiguation). Its absence degrades extraction quality, never resolution or the playbook.

No code, env, merge, dial or message changes made.
