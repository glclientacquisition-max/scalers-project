# 2026-10-24 post-top-up staging dials: triage (read-only)

- Tip: f120677b (#920 H-only weigher) · Railway `scalers staging` deploy 7abe8ad4 · tenant Done and Dusted df4ad9d8
- Sources: Supabase `sgcdncjxauhsbunobmob.voice_turn_traces` (created_at > 05:30Z), `railway logs --since 40m --lines 5000` pulled 09:1x EAT, `tenants.services_catalog` / `tenants.spoken_catalogue`, `/healthz`
- No dial, merge, restage, env change or messages from this note.

## Calls found
Only **2** calls reached staging between 08:30 and 09:10 EAT (Railway shows just 2 `Ringing`/`/voice/incoming`, both from +254790381872 → +254709221537). No trace and no log for a third dial. It either never reached Railway (PBX/carrier side) or it was a redial that didn't connect. Not investigated further.

| Call | Start (EAT) | Dur | Trace score |
|---|---|---|---|
| HD_a17139a56f0b | 09:04:40 | 80 s | 85.3 (late first audio on T4,5,6,8,9) |
| HD_87f73ce7003b | 09:07:01 | 52 s | 92.5 (language-mismatch flag on T4) |

## HD_a17139a56f0b (sw greeting; post-construction price)
| T | Caller STT | Rules | Model (cascade) | Spoken line / source | First PCM |
|---|---|---|---|---|---|
| 1-2 | "Uh, but in the corner— The corner could do," | held (unfinished) | – | – | – |
| 3 | same (merged after 1600 ms hold) | intent none, svc null; brain-trace location="Corner" (caller_explicit) | primary 3.6-flash 1005 ms, get_hours, agree=false | "Je, naongea na Alvin?" (sw, brain_v2_live) → **speak_failed, barge-in, nothing played** | – |
| 4 | "Could do earlier post-construction in a cage." | svc Post-Construction, intent none | **cascade=true, primary+backup timed out at 1800 ms, answeredBy=none** | "Yes, we do post-construction cleaning. Would you like to book?" (Train) | 2340 ms |
| 5 | "How much is it?" | price, svc bound | primary 1108 ms get_price agree=true | **"Post-construction cleaning is forty shillings."** | 2228 ms |
| 6 | "Really?" | none | primary check_availability | "Sorry, I didn't catch that…" (repair) | 2214 ms |
| 7-8 | "Is it really 40 shillings?" | none | primary get_price | "Sorry, I didn't catch that…" again | 2250 ms |
| 9 | "Is the post-construction cleaning— is it really 40 shillings?" | **availability** | primary get_price | "We serve Kitengela, Juja, Ongata Rongai, and Syokimau. Which place are you in?" | 2145 ms |
Caller hung up at 09:06:00.

**Break point: T5.** Live `services_catalog` has Post-Construction = **KSh 4,000** (fixed, owner-confirmed). The pinned spoken catalogue (`spoken catalogue pinned v=1 hash=30743476a313 stale=true`) still has `raw.price "KSh 40"`, `price.en=null`, `review: odd_price`. The mouth spoke a price the owner flagged for review, from a stale catalogue, and it was wrong by 100×. T6–T9 follow from that: the caller challenges the price, and the bot runs repair twice and then a coverage list. It never confirms or corrects the price and never offers a callback. Kericho/after-building were not asked on this call.

## HD_87f73ce7003b (en greeting; Kisumu + window explain)
| T | Caller STT | Rules | Model | Spoken | First PCM |
|---|---|---|---|---|---|
| 1-3 | partials, held/merged | – | – | – | – |
| 4 | "…come to Kisumu to my place for some window cleaning, and then … tell me more about the window cleaning and how you do it exactly. Is it possible?" | brain-trace: service Interior Window Cleaning, location **Kisumu** (unconfirmed); u.intents none | **cascade=true, both timed out 1801 ms, answeredBy=none** (via none:gemini-3.5-flash-lite) | **"Interior Window Cleaning."** (bare label) | 1467 ms |
| – | "Hello?" | – | – | `agent_question_replay reason=hear_again` → **replays the full greeting** "Done and Dusted, this is Shy. Welcome back…" | – |
Caller hung up at 09:07:53. finishCall outcome=no_action.

**Break point: T4.** Two failures:
(a) **Out-of-area: FAIL.** Kisumu is not in service_areas (Nairobi, Kiambu, Kitengela, Juja…). There was no area_out line ("We don't cover Kisumu yet…") and no callback offer. No coverage was invented, but the question went unanswered.
(b) **Explain: FAIL.** The spoken catalogue for Interior Window Cleaning has `explain.en = null` (issue `needs_owner_text`) and the service `notes` are empty. The explain/label template rendered just the name. Then the "Hello?" replay used the greeting as the "last question", which sounds like the call restarted.

## Scores vs expectations
| Call | (a) out-of-area honesty + callback | (b) explain | Overall |
|---|---|---|---|
| HD_a17139 | n/a (not asked); T9 gives a coverage list in answer to a price question | n/a | **FAIL**: wrong price (40 vs 4,000), 2× repair loop |
| HD_87f73c | **FAIL**: Kisumu ignored, no callback | **FAIL**: bare "Interior Window Cleaning." | **FAIL** |

## TTS-outage leftovers: ruled OUT
- The last Soniox `402 BILLING EXHAUSTED` lines are `greeting-warm` retries **before** 09:00 EAT. healthz `lastError.tts` = ok at 08:59:34 EAT, `billingExhausted:false`.
- Every agent line in both calls was rendered fresh by Soniox TTS (`begin stream=… chunk …`). There were no outage/HOLD clips played (`holdsQueued:0`), no fallback lines, and no 402 during calls. `outageClips` are loaded in memory (en/sw) but were not used.
- The one `speak_failed` (HD_a17 T3) was a barge-in on an idle-recycled socket, not billing.
- `greeting-warm … rendered=0 dropped=1` is a cache-warm miss only. Greetings still streamed at 533–676 ms.

## Common root cause
The mouth speaks **unreviewed or empty spoken-catalogue fields** as if they were facts. The pinned spoken catalogue v1 is `stale=true`, `status: draft`. Post-Construction carries `odd_price` "KSh 40" (live price 4,000), and Interior Window has `explain.en=null`. Neither case falls back to the live owner catalogue or to an honest line. On top of that, **the model cascade times out on long first turns** (both T4s: primary and backup both hit 1800 ms, answeredBy=none), so the weigher has nothing to bind Kisumu/area_out with and the Train template mouth goes out on its own.

## Ranked fixes (none applied)
1. **Price guard:** never speak a spoken-catalogue price whose `review` is set or `price.en` is null. Use the live `services_catalog.pricing.amount_ksh` (owner-confirmed) or say "let me have the team confirm the price". Also republish/re-pin the spoken catalogue for this tenant (it is stale and the 40 is wrong). That is a data/owner action; Alvin decides.
2. **Area-out before explain:** when brain-trace has an unconfirmed caller place that is not in service_areas (Kisumu), the rules mouth must emit `area_out` plus a callback offer even with the model ABSENT. Do not let the service label win.
3. **Explain fallback:** if `explain.en` is null and notes are empty, don't speak a bare label. Use the category line ("…we clean mattresses, sofas, carpets, windows") plus an offer of a callback for details.
4. **Hear-again replay:** "Hello?" after a reply must replay the last agent line, not the greeting.
5. **Repair loop:** "Really?" / "Is it really 40 shillings?" should route to price-confirm, not generic repair. Cap at one repair before price restate or escalation.
6. **Cascade timing:** both long first turns hit dual timeout at 1800 ms. Check primary/backup latency on long STT (no cap raise, per lock). First PCM of 2.1–2.3 s on every reply turn is "slow" on 5 turns.

## healthz (checked 09:1x EAT)
ok:true · gitSha f120677b · branch staging/v2-c0-opening-2026-10-21 · soniox stt/tts true · billingExhausted false · tts lastError ok (08:59:34 EAT) · gemini 3.6-flash configured.

Note: weigher decision tags (`state.trace.weigher`) are not persisted to voice_turn_traces or logged, so the action per turn is inferred from cascade/answeredBy (both T4s = model ABSENT → Train mouth).
