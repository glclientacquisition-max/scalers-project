# Brain turn resolver v2: structural design (pre-implementation)

- **Status:** DESIGN ONLY. No code, PR, env, dial or message is authorised by this document.
- **Owner:** Brain lane. Voice-lane items are marked **[VOICE HANDOFF]**. Caller-facing words belong to Prompt; this spec gives criteria only.
- **Base:** staging tip `18dc48bd` (#923 resolver + #921 with flags off).
- **Evidence:**
  - `voice-qa/2026-10-24_18dc48bd-dials.md` (HD_babe6cdffdc7)
  - `voice-qa/2026-10-24_post-topup-dials.md` (HD_87f73ce7003b, HD_a17139a56f0b)
  - `voice-qa/2026-10-24_hybrid-architecture-rootcause.md`
  - `voice-qa/2026-10-24_v1-vs-v2-model-handling.md`

## 0. Problem statement (what 18dc48bd proved)
| Finding | Evidence | Design consequence |
|---|---|---|
| The model is useful when it arrives. | T5: partial start, 838 ms, correct `service_id`, honest resolver line | Keep the single structured call. Make it arrive. |
| The model never arrives when started on the final. | 9/9 turns: `waitedMs≈750`, `attempts:[]`, then aborted (`turnModel.js:161,177`) | The start must move earlier on every turn (§1), and the wait must be conditional (§4). |
| Removing the cascade/classify rescue left hollow turns with nothing. | T8–T10 coverage loop: `rules_degrade HOLLOW, model ABSENT` (`liveTurn.js` mode=on: `model:null`, `classify:null`) | We need a rescue that does not depend on the current turn's model (§3). |
| Conversation memory is ad hoc. | T6 "how much is it?" lost the service (`turnResolver.js:58`, `lastService` only on challenge). T11 the offer was already cleared, and "Definitely no." was missed (`nlu.js:9`). | A single owned state object with explicit readers and writers (§2). |
| The trace hides in-flight work. | `attempts:[]` when the call is cut | An attempt is logged at *start*, not at *finish* (§5). |

Measured on HD_babe (from `voice_turn_traces` STT stages):
- **Final-token stability is useless as a signal.** Soniox finalised tokens 0–14 ms before the last event on 7/9 turns.
- The interim text reached 60 % of the final words **238–733 ms** before the last STT event on short turns (n=7), and 1.1–2.4 s on long or stumbling turns.
- Voice then waits `turn_end wait ≈470–480 ms (await_endpoint)` before Brain sees the final.
- So an interim-started call gets roughly **700–1200 ms** of head start over the current final start. The model's first field takes about **840 ms** (n=1 here; v1 first token p50 1100 / p90 1383 ms).

**Conclusion: early start alone is break-even at best on short turns.** The design must also (a) shrink model time-to-field, (b) not block the mouth on the model when rules are confident, and (c) give the system a next-turn use for late fields.

---

## 1. Early model start on every turn

### 1.1 Definition of a "stable partial"
Brain receives `partial(text, meta)` events from Voice (§1.6). A partial is **stable**, and may fire a model call, when **all** of the following hold:
1. **Content floor:**
   - at least **3 content words** after dropping fillers (`uh, um, like, so, eh, ehh, aah, sasa, ati, yaani`) and false-start repeats ("I— I");
   - **or** at least 1 word that matches a catalogue or area entity (the "Interior." case);
   - **and** at least **12 chars** after normalising.
2. **Debounce:** the normalised text has not changed for **≥ 180 ms** (STT interim cadence is about 110–120 ms on HD_babe, so this means one or two unchanged interims).
3. **Growth rule:** the text is not a strict prefix of the last fired text plus fewer than 2 new content words (this stops a fire on every new word).
4. **Not in a guarded phase:**
   - no `readback` with a pending write (yes/no is rules-owned there; §2);
   - no `name_confirm` awaiting yes/no unless the partial already has ≥ 3 content words;
   - the agent is not speaking an un-barged line (Voice signal `agentSpeaking && !bargeIn`).
5. **Language:** Soniox language confidence ≥ 0.8 for the partial, or the sticky language is set.

Voice's existing **unfinished hold** is a special case. It always counts as stable (it is already debounced by 1600 ms).

### 1.2 Re-fires on a changed partial
Every call carries `fireText` (normalised). On each new stable partial `p`:

| Relation of `p` to the in-flight `fireText` | Action |
|---|---|
| Equal | No-op. |
| `p` extends `fireText` by < 2 content words and adds no new entity or ask keyword | Keep the call (**merge**). Its fields stay eligible only if §1.4 verification passes on the final. |
| `p` adds an entity, an ask keyword (`how much`, `how`, `where`, `cover`, `book`, `no`, `yes`…), or ≥ 2 content words | **Supersede.** Start a new call and keep the old one running until the new one has a field or the old one finishes, whichever is first; then abort the old one. Cap: **at most 2 in flight**. A 3rd fire aborts the oldest. |
| `p` is not a prefix (STT rewrote earlier words) | Supersede (same rules). |

Per-turn request budget: **max 3 model requests per turn**, counting retries (v1 policy) and supersedes. Past the budget, no new fire; the final reuses the newest call. *(This changes the "one call per turn" rule from #923. It is open question Q1.)*

### 1.3 First turn (no Brain object yet)
- Create the Brain live object **at media connect**, when the profile is ready (`opening_prefetch ready`, ~700 ms after answer), not lazily on the first final. The object is cheap: state plus a turn-model registry keyed by `callSid` (already exists, `turnModel.forCall`).
- Prewarm happens at the same moment: the TLS GET and the static-prefix build. The static prefix is per tenant and memoised, so the first request is byte-identical to later ones.
- If a partial arrives before the profile, it is queued (only the latest is kept) and fired on profile ready if still stable.

### 1.4 Using early fields on the final
On the final text `F`:
- If a call's `fireText` equals `F`, use it.
- Else, if `fireText` is a prefix of `F` and `F` adds no ask keyword or entity, use its fields; the asks are a subset.
- Else, use its fields only for what is verified against `F`: service id ⇒ the row's name or alias appears in `F`; place ⇒ the place string appears in `F`. Asks from a stale call are **dropped**; rules asks on `F` win.
- Fields never carry facts, only ids and enums (unchanged from #923).

### 1.5 Budget: getting the model ahead of the final
The target is the first field before the final on ≥ 80 % of turns with ≥ 3 content words. Levers, in order:
1. **Shrink time-to-field:**
   - Emit `note_turn` with `asks` first: the property order in the schema, so the first streamed functionCall part is usable.
   - `maxOutputTokens` ≤ 64 and minimal thinking (already set).
   - Static prefix ≤ ~1.5 k tokens. History ≤ 2 caller turns plus the state note (§2.5), not 4.
2. **Start earlier:** §1.1 (stable partial at ~3 content words, not at hold).
3. **Pick the fastest model for extraction:** measure `gemini-3.6-flash` against `gemini-3.5-flash-lite` time-to-first-functionCall (open question Q2).

### 1.6 Measurements needed before build sign-off
| Metric | Source | Needed n |
|---|---|---|
| Time from the stable partial (per the §1.1 rule) to the final STT event, per turn | `voice_turn_traces` STT stages (offline replay of the rule) | ≥ 100 turns across ≥ 10 calls |
| Voice endpoint wait (final STT → Brain run) | `turn_end wait` log / a new trace field | same |
| Model time-to-first-field, per model id, cold and warm | new `attempt.firstFieldMs` (§5) | ≥ 50 per model |
| Fraction of turns where early fields == final fields | §1.4 verification outcome | ≥ 100 |

### 1.7 [VOICE HANDOFF] What Voice must expose
1. `brainLive.partial({ text, lang, langConfidence, interimSeq, msSinceSpeechStart, agentSpeaking, bargeIn })` on **every** STT interim. This is cheap, and Brain does the stability gating itself so the rule lives in one lane.
2. Create the Brain live object at profile-ready (§1.3), for both owned and live paths (`server.js` ~4531/4592).
3. `brainLive.final(...)` is unchanged (`run`). Voice also passes `endpointWaitMs` and `heardAtMs` (the last STT event time), so the trace can compute head start.
4. On call close, `turnModel.endCall` (already merged).
5. There is no change to the turn_end / unfinished-hold timing in this design. Voice may later shorten `await_endpoint` once §4 lands (separate Voice decision).

---

## 2. System-owned conversation state

### 2.1 Schema (`state.conv`, one object, Brain-only writer)
```
conv = {
  service:      { id, name, setBy: 'rules'|'model'|'file', turn } | null   // current topic service
  lastFact:     { kind: 'price'|'explain'|'coverage'|'hours'|'possible', serviceId|null, value, status: 'answered'|'unknown'|'out_of_area', turn } | null
  offer:        { type: 'book'|'callback'|'confirm_name'|'more_help', serviceId|null, reason: 'unknown_fact'|'out_of_area'|'after_answer'|'after_price', turn, repeats: 0 } | null
  callback:     { status: 'none'|'offered'|'accepted'|'declined'|'created', reason, serviceId|null, place|null, handoffId|null } 
  area:         { text, status: 'listed'|'out_of_area'|'unknown'|null, turn } | null
  name:         (unchanged: existing name-lock rules: slots.name, nameConfirmed, sharedLine; conv only mirrors read-only)
  asks:         [{ kind, serviceId|null, place|null, status: 'open'|'answered'|'unknown'|'deferred', fromTurn }]   // queue
  playbook:     'enquiry'|'resolve'|'offer'|'collect'|'readback'|'commit'|'callback_collect'|'close'
  repairCount:  int     // consecutive repair lines
  lateFields:   { turn, fields } | null   // §3.3
}
```
Existing fields (`state.phase`, `pending`, `slots`, `intent`) stay as they are for the booking write flow. `conv.playbook` mirrors `phase` for `collect/readback/commit`, and `phase` is still the authority for writes, so the C1 propose → read-back → yes → commit chain is not touched.

### 2.2 Writers and lifetime
| Field | Written by | When | Cleared |
|---|---|---|---|
| `service` | resolver (rules or verified model service); booking slot fill; caller-file row on a returning-caller confirm | a turn names a service | The caller names a different service (replace). Not cleared by price or coverage turns. Ends on close. |
| `lastFact` | resolver, after compose | every info answer | replaced on the next info answer |
| `offer` | playbook step (resolver or machine) | when a line ends in an offer | accepted, declined, superseded by a new offer, or **2 turns** with no reference (expiry) |
| `callback` | playbook on a callback offer; the C1 commit receipt for `create_handoff` | offer / accept / decline / receipt | not cleared within the call; `declined` blocks re-offering for 3 turns |
| `area` | resolver areaCheck | a place is named | replaced by a new place |
| `asks` | resolver collect | each turn: new asks are appended, resolved asks marked | an answered ask is dropped next turn; a `deferred` ask is kept until answered or 3 turns pass |
| `repairCount` | machine repair path | +1 on a repair line, 0 on any non-repair line | — |
| `lateFields` | turn model when fields land after the reply (§3.3) | late completion | consumed or dropped on the next turn |

### 2.3 How the resolver reads it
| Caller pattern | Rule |
|---|---|
| Pronoun or elliptic ask ("how much is it", "how is it done", "is it possible", "bei yake", "inafanywa aje") with no service named | Use `conv.service` if it was set within the last **3 turns**. Else ask which service (one question). |
| Price challenge ("really?", "is it really 40", "kweli?") | If `lastFact.kind=price`, restate the same fact for `lastFact.serviceId`, confirm it is from the list, and offer `book`. **Never** a repair line. |
| **Yes** (rules `yes`, or a fixed acceptance list) with an `offer` open | `book` → the existing booking collect. `callback` → C1 propose `create_handoff` (read-back, then commit). `confirm_name` → the existing name lock. `more_help` → ask what else. |
| **No** (widened, §3.2) with an `offer` open | `book`/`callback` → mark declined, acknowledge, and ask if there is anything else (`offer=more_help`). `more_help` declined → close per the end-call rules. Never a repair line. |
| No / yes with **no** offer open | Treat as an answer to the last agent question if the Voice `agentAwaitingReply` is set. Else hollow (§3). |
| A new ask while an offer is open | Answer the ask first. Keep the offer, unless the new answer ends with its own offer; one offer per line (composer rule). The old offer goes back into `asks` as deferred only for a callback with reason `unknown_fact`/`out_of_area`. |
| Coverage ask ("coverage", "which areas", "mnafika wapi") with no place | Resolve as `coverage` against the listed areas. With a place: areaCheck → listed / out_of_area (+ callback) / unknown (+ callback). |
| Follow-up "and X?" after an answer | Same ask kind as `lastFact.kind`, with the new service or place. |

### 2.4 Playbook statechart
```
            ┌──────────── new ask (any state except readback/commit) ───────────┐
            ▼                                                                    │
 [enquiry] ──ask──▶ [resolve] ──all answered──▶ [offer:book] ──yes──▶ [collect] ──slots──▶ [readback] ──yes──▶ [commit] ──receipt──▶ [close?/more_help]
                       │                         │   └─no──▶ [more_help] ──no──▶ [close]
                       │                         └─(2 turns no ref)──▶ [enquiry]
                       └─any unknown/out_of_area──▶ [offer:callback] ──yes──▶ [callback_collect] ──(name/phone known)──▶ [readback:create_handoff] ──yes──▶ [commit] ──▶ [more_help]
                                                     └─no──▶ callback.declined ──▶ [more_help]
 [readback] ──no──▶ [collect] (fix slot)      [readback] ──new ask──▶ answer, stay in [readback] (re-ask read-back)
 [any] ──repairCount≥2──▶ [offer:callback reason=repair]   (stops the loop: HD_babe T8–T10, HD_a17)
```
Invariants:
- A callback never needs the model.
- Exactly one open offer.
- A write only happens in `commit` with the minted confirm token (unchanged).
- A **2nd consecutive repair is not allowed** to repeat the same line: it moves to the callback offer.

### 2.5 Per-turn fact note to the model (from `conv`, names only)
`service name | last ask kind | open offer type | area status`. No prices, notes or descriptions (unchanged rule). This replaces the 4-turn history; history is cut to the last 2 caller turns.

---

## 3. Late or absent model: the fallback

### 3.1 What replaces the removed classify rescue
A hollow turn (rules intent empty, or an intent without its required entity) goes in this order, with no freeform text at any step:
1. **State inference (§2.3):** pronoun → `conv.service`; yes/no → open offer.
2. **Early model fields** if verified (§1.4), with **no extra wait** (§4).
3. **Closed fast classifier** over the final text. This is the existing `classifyAsk` route, re-enabled for hollow turns only:
   - closed label set equal to the `note_turn` asks enum plus `yes`/`no`/`none`;
   - its own cap **≤ 400 ms**, shared with the §1.2 request budget;
   - it may be the same model call as `note_turn` if one is already in flight (it is reused, not duplicated).
4. **Late fields from the previous turn** (§3.3): only to re-scope the deferred ask, never to re-answer.
5. **Repair:** at most once in a row. The 2nd consecutive repair becomes a callback offer (§2.4).

### 3.2 Rules coverage gaps to close (Brain rules; words to Prompt)
| Gap | Evidence | Criterion |
|---|---|---|
| "coverage" and its variants | HD_babe T8–T10, `nlu.js:23` | "coverage / your coverage / areas you cover / where do you work / mnafika wapi / mnafanyia wapi" → `coverage` intent. |
| No anywhere in a short reply | T11 "Definitely no.", `nlu.js:9` (start-anchored only) | A no word in a reply of ≤ 4 words with no ask keyword → `no`. Also "definitely not / not now / no thanks / hapana asante / sitaki". The same widening for yes ("sure / definitely / go ahead / sawa / ndio"). |
| Pronoun price or explain | T6 "how much is it?" | Handled by §2.3. Rules mark `pronounRef=true` so the resolver knows to bind it. |
| Service word heard as a name | T3 "Interior." → "Thanks, Interior." | In `name_confirm`, a reply that matches a catalogue or area entity is **not** a name; route it as a service mention. (This is the existing name lock; the guard only adds to it.) |
| Price challenge wording | HD_a17 | Already in #923 (`PRICE_CHALLENGE`). Keep it, and add the Swahili "kweli? / ni kweli 40?". |

### 3.3 Late-model reuse on the next turn
- If `note_turn` lands after the reply is decided, store `conv.lateFields` (with `turn`). It is **not aborted** at `reply_decided` any more (today `turnModel.js:177` aborts it). Instead the call is allowed to finish within the cap, so the fields and latency are measured.
- On the next turn, late fields may only:
  - fill `conv.service` when the next turn is pronoun-only;
  - add a deferred ask the reply missed, which the composer may raise once as "you also asked about …" (criterion only; Prompt words it).
- They never trigger a write, and never override that turn's rules or fields.

---

## 4. Wait policy
Wait a **variable** amount, decided at the final:

| Condition at the final | Wait for fields |
|---|---|
| Rules are TRAIN_TRUE (confident intent plus entity) and the turn is single-ask | **0 ms.** Speak the rules or resolver line now. Fields only trace and feed `lateFields`. |
| Readback / yes-no on an open offer / name confirm | **0 ms** (rules own these). |
| Early call has its first field already | 0 ms (use it). |
| Hollow turn and an early call is in flight, started ≥ 300 ms ago | Wait until **min(expected remaining, 450 ms)**. Expected remaining = p50 time-to-field − elapsed. |
| Hollow turn and no call in flight (or started < 300 ms ago) | Run the §3.1 chain. Classifier cap 400 ms. No second 750 ms wait. |
| Multi-ask detected by rules (≥ 2 ask keywords) | Wait up to 450 ms for fields (fields improve the asks queue). Else resolve from rules. |

The hard ceiling stays at **HARD_CAP 1800 ms** for the call itself. The **mouth-blocking wait is ≤ 450 ms**, replacing the flat 750 ms. If a mouth wait exceeds 300 ms, Voice's existing filler policy applies (Voice-owned; unchanged).

---

## 5. Traceability (one `brain_v2_model` stage plus one `brain_v2_turn` stage per turn)
- **Attempts are logged at start:** `{ id, model, firedOn:'partial'|'final', fireTextHash, startedAtMs (rel. to the final), status:'in_flight'|'ok'|'empty'|'error:<kind>'|'cancelled:<why>'|'late', firstFieldMs, doneMs }`. `cancelled` gives the reason: `superseded`, `stale`, `call_end`, `budget`.
- **Turn stage `brain_v2_turn`:**
  - `path`: `resolver` | `rules` | `state_infer` | `early_fields` | `classifier` | `late_fields` | `repair` | `callback_escalation`;
  - `rulesStrength` (TRAIN_TRUE/HOLLOW…), `waitPolicy` (the §4 row id), `waitedMs`;
  - `headStartMs` (final heardAt − first fire), `endpointWaitMs` (from Voice);
  - `asks[]` with status, `offerBefore→offerAfter`, `playbookBefore→playbookAfter`.
- **State diff:** a `conv` diff per turn, as JSON-patch-like `[{path, from, to}]`, with names and ids only and no prices or notes.
- The weigher tag (`state.trace.weigher`) is persisted on the row. Today it is only in memory (noted in the post-topup review).
- No PII beyond what `voice_turn_traces` already holds (redacted per the existing `pii` column).

---

## 6. Acceptance suite
These are replay tests in `tests/` (stand-in model, scripted latencies) plus a staging dial check. A case passes on the **state and path assertions**, not on exact wording (Prompt owns the words). The criteria are given in brackets.

| ID | Source | Script | Must hold |
|---|---|---|---|
| A1 | HD_babe T5 | "Window cleaning is done, so." (unfinished) | explain unknown → [category named, no description invented] + callback offer; path=resolver; fields from the partial |
| A2 | HD_babe T6 | then "And by any chance, how much is it?" | price bound to `conv.service` (Interior Window Cleaning); no "which service" |
| A3 | HD_babe T8–T10 | "Oh, and, uh, what's your coverage?" ×3 | coverage answered from the listed areas on the 1st ask; never a booking re-ask; no repair line |
| A4 | HD_babe T11 | after a book or callback offer: "Definitely no." | offer declined; `more_help`; no repair |
| A5 | HD_babe T3 | in name confirm: "Interior." | not saved or used as a name; treated as a service mention |
| A6 | HD_87f73ce7003b | Kisumu + window cleaning + "how you do it exactly" + "is it possible" | out_of_area + explain-unknown + exactly one callback offer |
| A7 | HD_a17139a56f0b | price → "Really?" → "Is it really 40?" ×2 | price restated each time [source-confirmed], no repair, no coverage list |
| A8 | multi-ask | explain + price + possible (+ place listed) | every ask resolved, in the fixed order, one offer |
| A9 | model timeout | model never answers | the reply on the rules/state path with mouth wait ≤ 450 ms; trace shows attempt `in_flight→late` or `error` |
| A10 | supersede | partial A ("how much"), partial B ("how much is sofa"), final B | ≤ 2 in flight; A `cancelled:superseded`; fields from B |
| A11 | callback accept | after a callback offer: "yes" | C1 create_handoff read-back → yes → commit; `callback.status=created` |
| A12 | repair escalation | 2 unintelligible turns | the 2nd is a callback offer, not the same repair |
| A13 | first turn | a partial before Brain exists | queued and fired on profile-ready; the first-turn trace has `firedOn:partial` |
| A14 | late fields | fields land after the reply; next turn "how much is it?" | `lateFields` binds the service; no write |
| A15 | existing harness | `npm run test:brain` + v2 suites | only the pre-existing failures |

**Latency targets** (staging dials; at least 3 dials of ≥ 8 turns, mixed short and long turns):
- **p90 caller-stop → first agent audio ≤ 1300 ms. p50 ≤ 1000 ms.** Today on 18dc48bd: p50 1190 / p90 1453 (n=9); v1 p90 2408.
- Model fields used on ≥ 60 % of turns that had ≥ 3 content words.
- Mouth wait p90 ≤ 300 ms.

Measurement method:
- `voice_turn_traces.latency.callerStopToFirstTtsPcmMs` (Voice clock, from the last caller STT event to the first PCM out).
- Turns that ended on the unfinished hold are reported separately with the hold added back.
- Barged turns are excluded from first-audio but counted for the "fields used" rate.

---

## 7. Risks, scope, ship order, open questions

### Risks
- **More requests and cost:** partial fires raise requests per turn, from 1 up to 3. Mitigations: debounce, the growth rule, the 2-in-flight cap and the budget. Cost is measured per turn in the trace (`tokens`).
- **Stale fields applied to the wrong words:** mitigated by the §1.4 verification (substring check on service and place, asks dropped).
- **State bugs that persist across turns** (a wrong `conv.service` sticking): it expires after 3 turns, is replaced whenever the caller names a service, and is traced as a diff.
- **Wider yes/no rules flipping a meaning** ("no, I mean…"): limited to ≤ 4-word replies with no ask keyword.
- **The Voice seam** (partials on every interim) adds a hot-path call. It must stay non-blocking (fire-and-forget, try/catch), like the existing hold seam.

### Out of scope
- Caller-facing wording (Prompt).
- Explicit Gemini `cachedContents` (needs an env/API change).
- Voice endpoint timings.
- Billing and packages.
- The price-data item (40 vs 4,000).
- Prod, Aris, #894.
- Raising HARD_CAP.

### Phased ship order (each phase is a separate draft PR, staging only, flags default off)
1. **P1, rules and state, no model change:** the `conv` schema plus the §2.3 readers, the §3.2 gaps, repair → callback escalation (A2–A5, A7, A11, A12), and the §5 turn stage plus state diffs. *This fixes most of HD_babe with the model off.*
2. **P2, wait policy and trace:** the §4 conditional wait (removes the flat 750 ms), attempt-at-start logging, and `lateFields` with no abort at reply (A9, A14).
3. **P3, early start [VOICE HANDOFF]:** the partial seam on every interim, the stability gate, supersede/merge, and Brain creation at profile-ready (A10, A13). Then measure §1.6.
4. **P4, hollow-turn classifier:** re-enable the closed classifier under the shared budget (A3 when the rules miss).
5. **P5, tuning:** model id choice (Q2), prefix size, history 2.

### Open questions for Alvin
- **Q1. Model calls per turn: allow up to 3 (partial supersedes plus retries) instead of strictly 1?** This is needed for early start to work on longer turns. Cost is roughly ≤ 2× the current extraction tokens.
- **Q2. Extraction model: may we pick by measured speed** (likely `gemini-3.5-flash-lite` as primary for `note_turn`, with `3.6-flash` as backup), if accuracy on the replay suite is equal?
- **Q3. Repair escalation: after 2 failed understandings in a row, offer a callback** instead of a third "didn't catch that"? Yes/no.
- **Q4. Order: ship P1 (rules and state) before any model or Voice work,** even though it leaves first-audio latency about where it is (p90 ~1.45 s) until P2?

## Decisions (Alvin, 24 Oct 2026 10:25 EAT — accepted, YES to Q1–Q4)
- Q1: up to 3 model requests per turn is OK.
- Q2: extraction model chosen by measured speed — gemini flash-lite primary, 3.6-flash backup — if equal on the replay suite.
- Q3: after 2 consecutive failed understandings, offer a callback.
- Q4: ship rules + state first (Phase 1), behind BRAIN_V2_CONV_STATE (default off).
