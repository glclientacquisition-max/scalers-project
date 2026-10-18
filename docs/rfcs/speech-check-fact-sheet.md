---
owner: voice
last_reviewed: 2026-10-18
---

# Speech check redesign: one fact sheet, value checks, repair not delete

**Status:** approved plan, build in progress on staging (18 Oct 2026). Approved by Alvin 18 Oct 15:07 EAT in Voice's chat ("execute end to end"); ownership rulings by Chief 15:08 EAT, price ruling the same afternoon. Every step is behind a flag that starts off, goes to staging first, and needs its own GO from Alvin for prod. Current state of each step lives in [`STATUS.md`](../STATUS.md) (section 4).

Full working notes (box, not in the repo): `/workspace/scalers/voice/research/2026-10-18_speech-guard-audit-and-industry.md` (audit and industry patterns) and `/workspace/scalers/voice/research/2026-10-18_fact-sheet-implementation-plan.md` (implementation plan, file and line references on `main` `2842c4f4`).

## Why: what the audit found

Prod trace window 9 Oct 20:18 to 18 Oct 13:17 EAT: 57 calls, 330 model turns, 3 tenants (Aris, Esga, Chapter One). Every drop was checked against the `tenants` row.

| Finding | Count |
| --- | --- |
| Number or place sentences the guard removed | **32** |
| ...with every number and place correct | **26** |
| ...where the prompt's own clock was 3 minutes stale | 5 |
| ...correct hours plus a false "closed tomorrow" (removed for the correct numbers, not the false claim) | 1 |
| Invented numbers or places the guard caught | **0** |
| "I don't have that on file" spoken | **7**, all false (the answer was on file) |
| Turns where a sentence was removed and nothing replaced it (silence) | **30** |

Kiswahili everyday words ("kabla", "karibuni", "salama") were fuzzy-matched as unknown place names and cut. The counts are a floor: local replies and the final-path polish are not traced as guard transforms.

**Root cause.** The guard decides whether a fact may be spoken by guessing from the caller's wording (`looksLikeHoursAsk`, `NUMBER_ASK` and other regex tables), not by checking the value against the right key on file. It reads none of the compiled knowledge: it builds its own view from the raw tenant row with every `HH:MM` removed. So it blocks correct facts and would still pass a real error ("open Saturday 9:30 to 6" for Aris passes, because the numbers are on file, though Saturday is closed).

**How the KB is compiled today.** On every Settings save (and onboarding, ingest, FAQ-from-call, catalogue import) Desk's `compileReceptionistPrompt` turns the owner/confirmed facts into one prose block, `tenants.llm_system_prompt` (local template first, then a Gemini rewrite). That works for the model but has no structure, version or hash, and it still carries contradictions such as Aris's FAQ "closed on Monday" next to a Monday 09:30–18:00 grid.

**What leading voice platforms do** (Google, Amazon, PolyAI, Sierra, Vapi, Retell, Bland and others; sources in the audit file): exact facts come from structured data and are rendered by code; heavier model checks run in parallel or after the call, not blocking speech; on a failure they repair, re-route or hand off, never go silent. Amazon notes its model-based checks are weaker outside English, which favours exact value matching for Kiswahili.

## Design

One typed **fact sheet** per call, built by Brain from the same provenance rules the Desk compiler uses (GIGO readers plus #761 `trustedHours`): hours per day with today/tomorrow, current time and date, prices per item, branches and address tokens, coverage, and the unknown list. Three consumers read it: the prompt (a real FACT CARD), the speech check, and the ready-made lines. `llm_system_prompt` stays as persona and policy text.

A sentence passes when its values match the sheet **for the key it names** (the day, item or branch), on any turn, whatever the question was. A failed sentence is replaced with that key's ready-made line in the caller's language (en, sw, Sheng). "Not on file" only when the key is truly absent. A question turn never ends silent. No model call on the speech path; budget under 1 ms per sentence.

## Steps (flag, owner)

Each step: flag off by default, staging first, its own GO for prod, 0 live calls at merge, `/healthz` plus an Aris check, a STATUS line. Flags are on only when the value is exactly `on` (or `shadow`).

| Step | What | Flag | Owner |
| --- | --- | --- | --- |
| 0 | Replay suite: the 32 prod drops + 2 staging drops (HD_af5868852bc7) + synthetic invented cases in en/sw/Sheng; old and new guard side by side; baseline must reproduce the audit | none (tests only) | Voice |
| 1 | Fact sheet built per call and traced; no speech change. Needs #761 merged with its flag off | `BRAIN_FACT_SHEET` | Brain |
| 2 | New value check in shadow, logs verdicts only | `VOICE_FACT_GUARD=shadow` | Voice |
| 3 | Hours and clock checked by day on any turn; wording gate retired for these | `VOICE_FACT_GUARD=on` | Voice (Brain reviews the `speechGuard.js` hook) |
| 4 | Repair, not delete; true "not on file" only; never silent on a question turn; `spokenFacts` lines | `VOICE_FACT_REPAIR` | Voice (Brain adds templates to `factLine.js`) |
| 5 | Local hours line uses the day the caller named (fixes "And on Saturday… are you open?" → "closed today") | `VOICE_LOCAL_HOURS_CONTEXT` | Voice |
| 6 | Prices bound to the item; places matched against the business's own addresses (no fuzzy matching on our speech); Kiswahili promise forms added to the saved-claim check | `VOICE_FACT_GUARD_PRICES`, `VOICE_PLACE_TENANT_FIRST` | Voice |
| 7 | FACT CARD in the prompt; contradicting FAQs out of LIVE GROUND TRUTH and the Desk compile; Desk "Check this" card | `BRAIN_FACT_CARD` | Brain + Desk |
| 8 (optional) | Async grounding monitor after TTS; delete bypassed code after 2 weeks clean | separate GO | Voice |

**Unconfirmed-price gate** (runs alongside step 6): `canSpeakPrice` in `src/conversation/pricingTrust.js` (Brain), behind `BRAIN_PRICE_CONFIRM_GATE` (on only when exactly `on`; off keeps today's behaviour; the flag check is the caller's job). It returns true when the row has no `pricing` record (legacy row), `pricing.confirmed === true`, or `pricing.source` is in Desk's closed owner-typed set; under `FACT_HASH_MODE` a meta hash mismatch forces false. A range counts as a price. When false, the slot falls to the existing `price_unknown` line ("the team will confirm the price"). Voice wires its two price paths to it: `catalogueMouth.fileServicePriceLine` and `speechGuard.groundFilePriceLine`.

## Rulings (Chief of Scalers, 18 Oct 15:08 EAT)

1. **Ownership.** Voice owns the value checks in `src/speech/factGuard.js` and the wording in `src/speech/spokenFacts/`. Brain keeps the claim checks in `src/conversation/speechGuard.js` (saved/job-close/hold/transfer claims, D199 name rules, coverage, slop) and the fact sheet builder (`src/conversation/factSheet.js`), and reviews the single hook from `speechGuard.js` into `factGuard.js`. After that hook, neither lane edits the other's file. Recorded in [`AGENTS.md`](../../AGENTS.md), [`BRAIN.md`](../reference/lanes/BRAIN.md) and [`VOICE.md`](../reference/lanes/VOICE.md).
2. **Unconfirmed prices are not facts.** A `pricing.confirmed=false` price (that is not owner-typed or legacy, per `canSpeakPrice`) is never spoken as fact. The assistant says the team will confirm the price. The owner confirms prices through Desk's "Check this" card.
3. **#761** merges with `BRAIN_TRUSTED_HOURS` off first (Alvin's GO 15:12 EAT in Chief's chat); the build proceeds staging-first, flags off.

## What happens to open drafts

- **#759** (hours-guard intent): superseded. Not merged on its own; its Brain-intent signal moves into step 3 key binding and its tests into the step 0 fixtures.
- **#741** (time answer): the "a time ask always gets the trusted time" part folds into step 4; its summary/outcome parts keep their own flag.
- **#761** (Brain trusted hours): prerequisite for step 1; `trustedHours.js` becomes the sheet's hours section.

## Open risks

- With `FACT_HASH_MODE` on and no backfill, the sheet reads most facts as unconfirmed and "not on file" returns. The sheet must follow the same env value as the compile; step 1 tests both modes.
- Free-text facts (FAQ answers, policy text) stay outside value binding; numbers in them pass only when no typed key covers the category. Rate logged in shadow.
- Sheng money and number words are used only after Alvin verifies them.
