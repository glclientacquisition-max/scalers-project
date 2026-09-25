# Instruction labels spoken aloud — `HD_ff24acf5207d` (2026-09-25)

Staging DID `+254709221536`, SHA `ba5b53f` (`cursor/ticket-done-sms-ping-679d`, not first-forward). After a truncated closer, Gemini spoke control text:

`spoken="NPFALSE"` then `spoken="ASRCORRECTIONPROMPT: The user's input seems truncated or quiet."` / `Ask for missing details or to repeat gently.` / `RETOTI: Sawa, Alvin.`

Desk transcript stored the same block. Later turns copied the format because raw `geminiParts` went back into history.

Fix: `src/speech/spokenInstructionLeak.js` strips those labels before TTS (`spokenStreamBuffer`, `prepareForTts`) and before Gemini history (`geminiVoice` clone). Prompt forbids reciting the tags. Follow-up: also strip `Speak this spelling once`, `VISIT COMMIT`, and `Name said` / `the caller said` narration. `You said` / `I said` stay.

---

# First-forward acceptance buckets (2026-09-25)

Do not treat raw hangup as Shy failed. Kenya flash under 3s with no speech is often airtime protocol, not an AI reject.

Classifier: `src/conversation/firstForwardAcceptance.js`. Persisted on `calls.summary.first_forward` (existing JSON). No dashboard chart.

| Bucket | Signal | Judge assistant? |
| --- | --- | --- |
| `flash` | Duration under 3s, no STT | No |
| `heard_greeting_drop` | Greeting PCM played, silent drop under 15s | No |
| `barged_job` | Barge-in with a job noun | Yes |
| `first_turn_goal` | Caller turn 1 has a goal, not empty / only hello / hangup | Yes |

Connect-to-greeting is a Voice log: `[voice-timing][sid] connect_to_greeting_pcm_ms=N cached=0|1`. That is answer/forward to first greeting PCM, not `first_pcm_ms` after the caller stops.

---

# Bare Okay. is not how-are-you (2026-09-16)

Live miss: freeze N1 `HD_d0f042f5d960` and N3 `HD_391a57aae9e9`. Closer `Okay.` matched `looksLikePhaticCallerTurn` because `okay|ok|fine|great` did not require `I'm`. Media path spoke the shared-line line `I'm well. Who is calling?` at 210–301 ms. NBA was `END` (N1) or `ASK_CLARIFICATION` (N3), not a how-are-you.

Fix: wellbeing answers require `I'm` / `I am`. Bare `Okay.` / `ok` / `fine` / `great` take the normal turn loop. `How are you doing, Shy?` still skips Gemini.

Do not crank TTS speed. Speech-guarantee on ANSWER (`I can't finish that just now`) is a later Voice ticket.

---

# Naturalness eval — how we will score roboticness (2026-09-16)

Owner ask: evaluate naturalness and eliminate roboticness.

**Method (do not retune first):** freeze staging `/healthz` `gitSha` + `voiceProfile`, run three scripted DID calls (phatic, barge, pace), score Voice IDs V1–V9 as pass/fail from recording + transcript + `spoken=` logs. Isolated TTS WAVs are a different test (`tts:listen-harness`).

Protocol + freeze knobs + historical SIDs: [`VOICE_NATURALNESS.md`](./VOICE_NATURALNESS.md). Scanner: `node scripts/score-voice-naturalness.js`.

Staging freeze knobs: `VOICE_PROFILE=balanced`, speed 1.0, gain 1.38, live transfer off, DID `+254709221536`. N1/N2 on SHA `abf6aa9` (`main` `#281`, 05:01Z). N3 on SHA `2c8fb51` (`main` `#282` desk Alerts, 05:18Z). Voice knobs did not move. Cutover from `23debf0`. Do not change speed or gain.

## Freeze call N1 — `HD_d0f042f5d960` (2026-09-16 05:06Z)

123s. Caller `+254790381872`. SHA `abf6aa9`. Recording URL empty; score from listen + desk transcript + `spoken=`.

| ID | Result | Evidence |
| --- | --- | --- |
| V1 | pass | Sentence-only flush. Greeting one stream. |
| V2 | pass | Filler cache warmup used `silent: true`. Thinking-ack `Mm-hmm.` cancelled when reply audio arrived. |
| V3 | pass | `spoken="Thank you, Alvin."` not `Al-vin`. |
| V4 | pass | `10 A M` is the AM spoken form, not a hyphen leak. |
| V5 | **fail** | Caller closer `Okay.` matched `looksLikePhaticCallerTurn`. Local line `I'm well. Who is calling?` at 242 ms. NBA was already `END`. |
| V6 | pass | No `idle_nudge`. |
| V7 | pass | `filler=1` on one turn only. |
| V8 | n/a | No slower/louder ask (that is N3). |
| V9 | pass | `At 10:00 AM` barged TTS (`outcome=barge_in`). No `I'm listening.` |

Brain notes (do not retune Voice for these): shared-line card asked who is calling on how-are-you; `Alvin.` hit speech-guarantee `Okay, I can't finish that just now. May I have your name so I can reach them?`; visit saved as carpet / Thursday 10 AM.

Voice next: stop treating bare `Okay` as how-are-you. N3 reproduced the same V5 miss three times.

## Freeze call N2 — `HD_b4cb560bae33` (2026-09-16 05:11Z)

166s. Same SHA `abf6aa9`. Script was barge+wait then pet stain Thursday 10. STT first turn was `Sorry. Pet stain removal.` No `wait` token. Barge still fired later on overlap.

| ID | Result | Evidence |
| --- | --- | --- |
| V1 | pass | Sentence chunks, no fragment restart. |
| V2 | pass | No solo `Sure.` / `I'm listening.` |
| V3 | pass | `Alvin` in `spoken=`. |
| V4 | pass | `10 A M` spoken form only. |
| V5 | pass | Closer `No.` skipped as non-substantive. No how-are-you replay. |
| V6 | pass | No idle poke. |
| V7 | pass | `filler=1` on thinking-ack / one barge, not every turn. |
| V8 | n/a | N3. |
| V9 | pass (barge) / incomplete (wait) | Multiple `outcome=barge_in`, streamed reply discarded, stale TTS 400 ignored. `wait` never reached STT. |
| Speech guarantee | **fail** | After `Yeah, I'm Alvin.` Gemini emitted 0 spoken chars (`save_caller_info` succeeded). Voice spoke `Okay, I can't finish that just now. May I have your name so I can reach them?` on `action=ANSWER`. Caller then asked why. Same canned line as N1. |

Brain notes: shared-line identity loop; catalogue recitation on `Aside from carpet cleaning`; landmark saved as `SaidI`.

## Freeze call N3 — `HD_391a57aae9e9` (2026-09-16 05:20Z)

80s, complete. SHA `2c8fb51` (`#282` desk Alerts). Voice knobs still balanced / 1.0 / 1.38 / live transfer off. Recording URL empty; score from listen + desk transcript + `spoken=` / speed-scale logs. Filler warmup used `silent: true`.

Script: couch price, then slower, then slower again, then normal speed.

| ID | Result | Evidence |
| --- | --- | --- |
| V1 | pass | Sentence chunks. Price + name-ask in one stream. No fragment restart. |
| V2 | pass | Thinking-ack `Alright.` cancelled when reply PCM arrived. Warmup `Mm-hmm.` / `Sawa.` / `Poa.` were `silent: true`. |
| V3 | pass | No hyphenated given name in `spoken=`. |
| V4 | pass | Desk text `Couch cleaning is Ksh 600 per seat.` Wire `spoken="Couch cleaning is six hundred shillings per seat."` |
| V5 | **fail** ×3 | Closer `Okay.` three times. Each hit `phatic local reply` `I'm well. Who is calling?` at `first_pcm_ms` 210 / 207 / 301. NBA was `ASK_CLARIFICATION` (shared-line name), not how-are-you. |
| V6 | pass | No `idle_nudge`. |
| V7 | pass | `filler=1` on the price turn only. |
| V8 | **pass** | `caller speed request=slower scale=0.85` then `0.7`. Wire `speed=0.85 (scale=0.85)` / `speed=0.7 (scale=0.7)`. `normal speed` → `request=reset scale=1` / `speed=1`. Model said it would speak slower; the wire actually changed. No `...`. No volume claim. |
| V9 | pass | Second slower ask barged the first slow line (`outcome=barge_in`). No `I'm listening.` |

Brain notes (do not retune Voice): shared-line card kept `ASK_CLARIFICATION` / “who is speaking” on every turn after the price, including the speed requests. Caller `Who are you?` got `I am Shy from Done and Dusted Cleaning Services. May I please know who is speaking?`

**Freeze verdict:** do not crank `VOICE_PROFILE` / speed / gain. Next Voice PR is V5 (`looksLikePhaticCallerTurn` must not match bare `Okay` / `ok`). Later Voice ticket: speech-guarantee must not speak the reach-them name-ask on `ANSWER` when Gemini emitted 0 chars (N1/N2).

---

# Transcript verification — last-call residuals (2026-09-14)

Owner ask: verify the punctuation / figure / currency fixes against the last transcript.

Method: pulled both post-merge staging calls (`9f6b94d5`, 146 turns, 21:13 UTC; `a2c0c86c`, 34 turns, 21:17 UTC) and ran all 54 agent turns through the merged `prepareForTts` net, scanning for survivals (dashes, slashes, `&`/`=`, dot chains, currency codes, long digit runs, parens, exclamations).

Verified fixed on real lines:

| Model wrote on the call | Caller now hears |
| --- | --- |
| `kwa Ksh 1500 hadi 2000 kulingana na size` | `kwa shilingi elfu moja mia tano hadi shilingi elfu mbili kulingana na size` |
| `bei ni Ksh 2000 kila moja` | `bei ni shilingi elfu mbili kila moja` |
| `I don't have that exact detail — I can note it…` | em dash becomes a comma pause |
| `Tuko wazi hadi 6 PM` (SW) | `Tuko wazi hadi saa 6 jioni` |
| `from 8 AM` | `from 8 A M` |
| `Have a good night!` | period, no punched exclamation |
| `Sawa... Chris... Unahitaji...` (slow-down attempt) | single periods, no spoken dots |

Two residuals the verification caught, now fixed:

1. `saa 3:00 usiku` → `saa saa 3 asubuhi usiku` — the 24h safety net read `3:00` as a 24h clock, doubled `saa`, and contradicted the stated period (`asubuhi usiku`). New `expandSwahiliClockTimes` claims numeric clocks carrying a Swahili period word (`asubuhi|mchana|jioni|usiku|alfajiri`) before the 24h net: `saa 3:00 usiku` → `saa 3 usiku`, `saa 3:30 usiku` → `saa 3 na dakika 30 usiku`.
2. `godoro (mattress cleaning) kesho` — parentheses survived verbatim. `polishPunctuation` now rewrites parenthetical asides as comma pauses.

Regression: 2 new `tests/ttsNormalize.test.js` cases, fixtures `52`–`53`. `npm run test:voice` green.

Not a TTS matter, logged for Brain: the model wrote `saa dodoma jioni` (a city name where a number belongs) while correcting hours confusion.

Follow-up from the owner: on the `a2c0c86c` call the caller asked "slower" / "polepole" ten-plus times and the model's only pacing tool was typing `...` between words — which the net turns into staccato full-stop pauses while the word rate stays the same. Shipped real in-call speed control:

1. `src/speech/speedControl.js` — `detectSpeedRequest` classifies the caller turn (`slower` / `slow down` / `too fast` / `polepole` / `ongea haraka` / `normal speed` / `kama kawaida`, …). Guards: bare `haraka` (`kuja haraka` = come quickly) and bare `slow` do not trigger.
2. Per-call `ttsSpeedScale` in `server.js` steps 0.15 per request (floor 0.7, ceiling 1.3, reset on "normal speed"), applied on every speak path (`speakText`, LLM→TTS stream prefetch and fallback) via `beginSpeak({ speedScale })`; the Soniox start frame gets `speed = clampSpeed(profile × scale)`.
3. Filler PCM cache bypasses once the scale leaves 1 — cached acks were rendered at the old pace.
4. Prompt: the model is told speed adjusts by itself and to never use `...` for pacing.

Default-speed guarantees (owner ask: normal speed stays the default, consistently):

- Every call starts at scale 1 — the scale is per-connection state in the media handler, so a slowed pace never leaks into the next call.
- Scale 1 is exactly the profile speed (`speedEn`/`speedSw`, both 1.0 on balanced); the wire sends the identical value as before this feature.
- The scale only moves on an explicit caller request and holds steady between them; one stream keeps one speed, so a sentence never changes pace mid-utterance.
- "slower" then "faster" returns to exactly 1; "normal speed" / "kama kawaida" resets to 1 from any step.
- The legacy SautiKit prompt WebSocket has no Soniox TTS and is untouched.

Regression: `tests/speedControl.test.js` (detector, stepping, wire speed) added to `npm run test:voice`.

---

# Currency read wrong — stranded codes, k-shorthand, silent cents (2026-09-14)

Owner report: before merging the figures fix, work currency deeply too.

Audit of the money path in `prepareForTts` (`expandMoney` and friends), realistic Kenyan forms:

| Caller heard | Text that survived the net |
| --- | --- |
| "kay ess aitch five hundred shillings" | `KSh 500/-`, `KSh 500/=`, `Bei ni Ksh 2,500/=` — the receipt rule claimed the amount but left the currency code stranded, spelled out letter by letter. |
| "kay ee ess five kay" | `KES 5k` — Kenyan k-shorthand (`50k`, `1.5k`) never expanded, so the money rule saw `5` and gave up on the `k`. |
| "shillings five thousand" | `Shillings 5,000` — `shillings` was not a recognized prefix word. |
| "you ess dee one hundred" | `USD 100`, `$100`, `100 dollars` — no dollar handling at all (Airbnb / tour quotes). |
| "one thousand two hundred shillings" for `KSh 1,200.50` | cents were silently truncated — wrong amount for an M-Pesa payment. |
| "five hundred shillings to eight hundred" | `KSh 500 to 800` — only dash ranges converted; the `to` / `hadi` joiner left the right side a numeral. |
| "1000000 shillings" | `KSh 1,000,000` — the number-to-words ladder stopped below a million. |

Fix (Voice, net layer):

1. Receipt shorthand and receipt ranges now absorb an optional currency prefix, so `KSh 500/-` is one match and no code is stranded.
2. `expandKThousands` — `5k` → `5000`, `1.5k` → `1500` as digits before money runs, so `KES 5k` becomes `five thousand shillings`. Guards keep `5km` and `10kg` intact.
3. `shillings` joins the prefix word list.
4. USD support — `USD 100`, `US$100`, `$100`, `100 dollars` → `one hundred dollars` (SW `dola …`).
5. Cents are spoken, never truncated: `KSh 1,200.50` → `one thousand two hundred shillings and fifty cents` (SW `… na senti hamsini`). Exact amounts matter for M-Pesa.
6. Range joiner accepts `to` and `hadi` alongside dashes.
7. `numberToEn` / `numberToSw` climb to a billion (`one million`, `milioni mbili …`).

Protected per fixture: `5km away`, `10kg bag`, bare quantities, phones, identifiers.

Regression: 7 new cases in `tests/ttsNormalize.test.js`, 8 new universal fixtures (`44`–`51`), fixture `03` updated to lock spoken cents. `npm run test:voice` green.

---

# Figures read wrong — till numbers, compact ranges, 24/7 (2026-09-14)

Owner report: the workflow behind figures does not perform — numbers come out wrong on calls.

Audit of the same `prepareForTts` net, figure forms this time:

| Caller heard | Text that survived the net |
| --- | --- |
| "five hundred nineteen thousand four hundred eighty three" | `Pay to till number 5194830` — till / paybill / account / order / reference / code digit runs were never expanded. Broken for Kenyan payment flows. |
| "thirty hyphen forty" | `30-40 minutes`, `1-2 days` — compact digit ranges with unit words kept the dash. |
| "twenty four slash seven" | `24/7` — slash survived. |

Fix (Voice, net layer):

1. `expandIdentifiers` — keyword-led digit runs speak digit-by-digit. Strong keywords (`order`, `reference`, `ref`, `code`, `account`, `a/c`, `paybill`) accept 4+ digits; weak ones (`till`, `number`, `no`) need 5+ so `open till 2026` stays a year and `till 9pm` stays a time. `pin` is deliberately excluded — a spoken PIN is a security bug upstream, not something to pronounce clearly.
2. `expandNumberUnitRanges` — `30-40 minutes` → `30 to 40 minutes`, `1-2 days` → `1 to 2 days` (SW `hadi`). Scoped to duration/quantity unit words; money, clock, and day ranges are claimed earlier.
3. `24/7` → `24 7`.

Protected per fixture: `We sold 100 units`, `Shop No. M4`, `Can I order 2 pizzas`, money (`KSh 45,000` → words), phones, decimals, dates.

Regression: 7 new cases in `tests/ttsNormalize.test.js`, 6 new universal fixtures (`38`–`43`). `npm run test:voice` green.

---

# Punctuation read aloud — full stops and hyphens (2026-09-14)

Owner report: the business assistant literally says "full stop" and "hyphen" on calls.

Audit of the shared `prepareForTts` net (every spoken path funnels through it: `server.js` speakText, Soniox `pushText`, filler cache, desk preview). What reached Soniox verbatim before this fix:

| Leak heard | Text that survived the net |
| --- | --- |
| "hyphen" / "dash" | Spaced ASCII hyphens: `sofa cleaning - carpet cleaning`, bullet leaks `Services: - Sofa - Carpets`. Only em/en dashes were neutralized. |
| "hyphen" between times | `3:00pm-4:00pm` — `expandTimes` spoke each side but left the dash: `3 P M-4 P M`. |
| "full stop full stop full stop" | Spaced dot chains `Wait . . . let me check` — the collapsers only caught adjacent dots. |
| "full stop" | Double period with a space (`3,000. . Thank you`), numbered lists (`1. Book 2. Confirm`). |
| "e full stop g full stop" | `e.g.` / `i.e.` leaks (prompt bans them; the net did not enforce). |
| "slash" / "ampersand" | `and/or`, `Done & Dusted`. |

Fix (Voice, net layer only — prompts untouched):

1. `expandTimeRanges12h` runs first in `expandSpokenForms`: `3pm-4pm` / `3:00 p.m. - 4:30 p.m.` / `3-4pm` speak both sides with `to` / `hadi`. Optional `saa` prefix is consumed so SW never doubles (`saa 8 asubuhi hadi saa 4 jioni`).
2. `polishPunctuation` (last pass, after expanders claimed their ranges): spaced hyphens → comma; dot chains and floating periods attach/collapse; numbered-list markers → comma (lookbehind keeps `15,000.` and `3.5` intact); `e.g.` → `for example`, `i.e.` → `that is`; `and/or` → `and or`; `&` → `and`.
3. Intra-word hyphens (`M-Pesa`, `Roo-ee-roo`, `check-in`) carry no spaces and are untouched — lexicon say-forms depend on them. Domains (`examplebusiness.co.ke`), slash dates, `Shop No. M4`, percents unchanged per fixture.

Regression: 12 new cases in `tests/ttsNormalize.test.js`, 6 new universal fixtures (`32`–`37`). `npm run test:voice` green.

---

# Name-ask loop vs visit SOP — Done and Dusted corpus (2026-09-14)

Live and staging calls kept asking for a name after the caller had already given it (`HD_6c44c4b430d7`, `HD_6851d9481091`; Sprint B: ask name once after value). That stalled the home visit SOP (service → name → when → landmark → `create_appointment`).

Causes in Brain state:

1. `extractName` only matched `my name is` / `naitwa`, so `I'm Alvin` never filled the slot.
2. `missingGoalSlots` ignored `caller.name` if the entity row lagged.
3. CALL STATE injected “Got it, {name}. Is that right?” every unconfirmed turn, so Gemini re-asked the name instead of the next visit slot.
4. Hear-again (`Pardon?`) told the model to repeat the last question, which was often the name ask.

Fix: capture spoken name forms; treat `caller.name` as filling the name slot; never re-ask a known name; continue the visit SOP; hear-again repeats the next missing slot, not the name.

---

# Spoken leaks — Done and Dusted `HD_3f7ed2a5f526` (2026-09-10)

Staging DID `+254709221536` (Shy). Caller `+254790381872`. 116s. Audio stayed up (`tts-rt-v2`).

What TTS actually sent (not only the desk transcript):

| Heard / leaked | Source |
| --- | --- |
| Extra word after **Done and Dusted Cleaning Services** | Tenant lexicon `alvin` → `Al-vin`. Closer: *Thank you for calling Done and Dusted Cleaning Services, Al-vin.* Soniox speaks that as a second name. |
| `Alright.` on *How are you doing, Shy?* | Thinking-ack. Phatic matcher missed the trailing name. |
| `Sure.` then a new utterance | Gemini `Sure!` + question. Stream flush treated `Sure.` as a finished line. Same for `Great.` and `I'm listening.` |
| Em dash | *I don't have that exact detail — we specialize…* Gemini leak. `polishPunctuation` did not strip `—`. |
| Couch / carpet / mattress list | Brain 1-sentence / no-lists leftover. Voice does not rewrite prompts. |
| `###ENDCALL###` | Stripped (95 chars in, 81 spoken). Did not leak. |

Voice fix: collapse `Al-vin` to `Alvin` on the say-form sanitizer (keep `Air-tel` / `Kris-to-fa`); hold `Sure.` / `I'm listening.` until the next sentence; speak dashes as a comma; skip thinking-ack when how-are-you includes the agent name.

---

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

Brain leftover (separate lane): *I'm doing well, thank you!* plus an unsolicited couch/carpet/mattress list still violates the 1-sentence / no-lists phone rule. Follow-up: skip Gemini on phatic turns and speak a local well-then-help line (`pickPhaticReply`). Do not list jobs.

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
