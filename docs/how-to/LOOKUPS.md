---
owner: voice
last_reviewed: 2026-10-18
---

# Fact lookups

Code answers a price, a travel fee, opening hours, a payment number, or the services list before the model is called. The answer is already speech in the caller's language. Sheng is treated as Swahili. Anything not on file, or not confirmed, is the cannot-answer line from [fact references](FACT_REFS_AND_VALUE_HASH_BACKFILL.md).

All three flags default off. Nothing here is live until Alvin turns a flag on.

## Flags

| Name | Default | Effect |
| --- | --- | --- |
| `VOICE_LOOKUPS` | off | Comma list: `price`, `fee`, `hours`, `pay`, `services`. `on` or `all` enables every kind. `area_fee` is an alias of `fee`. |
| `VOICE_LOOKUP_TOOL` | off | Gemini function `lookup` for a turn the router did not answer. The tool speech is said as returned. If the lookup is not back in 1.5 seconds the caller hears a short ack, then the cannot-answer line. |
| `VOICE_PERSONA_ONLY_PROMPT` | off | The Desk-compiled prompt keeps tone and identity. Prices, clocks and payment numbers in that prompt are removed. Money-as-digits rules stay on `VOICE_FACT_REFS` only. |

## What a turn may use

The router answers only when the intent and the entity are both in this turn. "How much is sofa cleaning?" is a price. "How much is the travel fee to Kileleshwa?" is a fee, and the sofa price is not carried over.

The one carry-over is a bare re-ask of the same item: "How much is it?" repeats the last price, and "Travel fee?" repeats the last fee. A cut-off "How much is the." is the services list, not the last price. "Uh, okay" and "I need your help" stay on the model path.

A local answer is stored once, with `spokenAnswer` and `turn_id`, so the next turn does not say it again.

## Prices

Price speech calls `normalisePrice` in `src/conversation/factPrice.js` and speaks only what that returns. A catalogue row uses `pricing_mode` (`fixed`, `from`, `range`, or `quote`; legacy `ask` is `quote`), `price`, and `price_max`. When those fields are absent, the same function reads the legacy price text.

`quote`, `unknown`, and a non-numeric price such as "Ask" are never spoken. They use the cannot-answer line.

## Not on file

`pickUnknownAnswerLine` chooses, in order: `unknown_answer_spoken` when its source matches, then `unknown_answer_fallback` in the caller's language, then "Let me check with the team and get back to you." / "Wacha niulize timu kisha nikujulishe." Every line passes the callbacks-only check. A held tenant (`holdGate.allowed === false`, other than a missing provenance RPC) gets that line for every kind.

## Speech checks

Lookup speech is not re-read for numbers, places, or comma-shaped lists. With `VOICE_LOOKUPS` or `VOICE_LOOKUP_TOOL` on, model text is still checked, with three changes:

- A hedge or a booked/transferred claim is dropped as a whole sentence, or kept whole when cutting it would leave a fragment.
- A services dump is kept when every item names something in the catalogue. Items that are not catalogue names are dropped. The drop reason names the gate, including `service_dump→slop` when the help line is then dropped as filler.
- A sentence that starts lower-case, starts with a dangling word ("with", "to", "for"), or is shorter than three words (unless it is a short ack) is replaced whole by the cannot-answer line. Reason: `sentence_fragment`.

Transfer, booking, names, holds, privacy and language checks stay. The payment-number backstop stays for model text. Flag off is the previous behaviour.

## Gate

`npm run eval:release` replays the fact-refs set with lookups forced off, then the fixtures in `evals/replay/fixtures/` with lookups on. False deletions may not rise above `evals/replay/baseline.json`. Invented facts, a wrong not-on-file line, a callbacks-only break, and a Swahili language miss must stay at zero. Lookup brain time p95 must stay at or under 50 ms.

`npm run test:lookups` is part of `npm run test:voice`.
