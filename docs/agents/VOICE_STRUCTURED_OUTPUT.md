# Voice Phase 2: structured, language-locked output

Status: behind `VOICE_STRUCTURED_OUTPUT` (default **off**). With the flag off the
call path is byte-identical to main (`npm run test:voice` and the replay eval
output are unchanged). Background: P1-609b / P1-609c.

## Why

The filter mouth repairs Gemini prose after the fact: regexes, then more regexes
to fix what they broke. In HD_015b this deleted a correct price, glued TTS pieces
("laInterior"), read commas aloud, stacked questions and replied in Swahili to an
English caller. Phase 2 changes the contract instead of adding filters.

## Turn, with the flag on

1. **Language lock** (`structured/languageLock.js`). Before the request, the reply
   language is fixed from the Soniox language tag on the final, then the caller's
   words, then the sticky call language. Loanword-only turns ("sawa", "okay") keep
   the sticky language. The lock feeds the call's language state machine.
2. **Fact table** (`structured/facts.js`). Tenant data becomes cited rows:
   `svc:` service, `prd:` product, `cov:` coverage, `pol:` policy, `hrs:` hours,
   `loc:` location, `vis:` the caller's visit (only when the speaker is bound).
   Each row lists the numbers it backs. The rows go into the prompt.
3. **Request** (`structured/schema.js`, `structured/geminiTurn.js`). Same model,
   retry and backup loop as today (`nextGeminiStreamAttempt`), plus
   `responseMimeType: application/json` and `responseSchema`:

   ```
   { lang: enum[<locked>], intent, facts_used: [{kind, id}],
     say: string[1..3], tool?: {name, args_json}, end_call?: boolean }
   ```

   `propertyOrdering` puts `facts_used` before `say` so the facts are known before
   the first sentence streams. Tool calls and hang-ups are fields, not
   `###TOOL###` markers in prose. The server turns them back into the existing
   marker text so `parseGeminiResponse` → `applyToolsWithHold` is reused.
4. **Stream reader** (`structured/jsonStream.js`). A real top-level JSON scanner
   that yields each `say` item when its string closes.
5. **Verify each say item** (`structured/verify.js`) against `facts_used` and the
   table, not against regex lists:
   `empty`, `markup`, `language` (wrong language for the lock), `unbacked_number`
   (a number no cited row backs), `coverage_contradiction` / `coverage_unbacked`
   (judged per clause), `privacy_unbound` (visit data to an unverified speaker),
   `outcome_claim` ("booked", "sent" before the tool ran), `name_confirmed`.
6. **Engine** (`structured/turn.js`).
   - First failure with nothing spoken yet: **one corrective retry**. The
     correction is appended to the last user turn (Gemini 3 needs signed model
     turns, so no unsigned model turn is added).
   - Still failing: speak a data line built from the table (a price, a coverage
     answer) or the pack's "let me check" line once; otherwise drop with a trace.
   - Nothing spoken by the end: the language pack's **repair line**. Never a
     silent drop.
   - One question per reply: the first question is kept and spoken last; later
     ones are traced as `stacked_question`.
   - A short opener ("Sure.") waits for the next sentence to pass.
   - Barge-in aborts the turn.
7. **One sanitiser at the TTS boundary** (`structured/speechBoundary.js`):
   strip markup → force the locked pack's TTS language → Sheng rewrite →
   lexicon → spoken forms (numbers, phones, money) → marks. Commas and full stops
   are removed unless `VOICE_TTS_PROSODY_MARKS=on`; short lists get "and"/"na".
   Every piece after the first starts with a space (no glued words) and a piece
   with no letter or digit is refused. `sonioxTts.pushText` routes here when the
   session was opened structured.
8. **History** stores what was actually spoken: if the say array was spoken
   unchanged on the first attempt, Gemini's signed parts are kept verbatim;
   otherwise the rewritten JSON is stored with the thought signature.

## Old chain bypassed under the flag

Not layered: these do not run on structured turns.

- `polishSpokenDetail` / `guardSpokenReply`
- `gateCallerFileSpeech` as a filter (now the `privacy_unbound` verify check)
- `cutNoAiSlop`, `softenCataloguePunctuation`, `polishSpokenReply`
- `createSpokenStreamBuffer`, `joinSpokenPieces`, `isOrphanFragment`
- `prepareForTts` on structured pieces (replaced by `prepareStructuredPiece`)

Canned/early-return turns (greeting, fillers, transfer lines) still come from
code; they pass through the same boundary but are not regenerated (Phase 3).

## Knobs

| Variable | Default | Meaning |
| --- | --- | --- |
| `VOICE_STRUCTURED_OUTPUT` | off | Phase 2 mouth. Forces streaming on. |
| `GEMINI_STRUCTURED_MAX_OUTPUT_TOKENS` | 512 | JSON needs more room than prose. |
| `VOICE_TTS_PROSODY_MARKS` | off | Keep punctuation for Soniox prosody. |
| `VOICE_STRUCTURED_RESPELL` | off | Built-in syllable respellings in the boundary. |
| `VOICE_SIM_TAP` | off | Text tap for the simulator (needs `simulator:true` metadata). |

## Tests and eval

- `npm run test:structured-voice`: unit tests in `tests/structured/` and the
  structured replay gate (`node scripts/replay-voice-suite.js --mouth structured`).
  Part of `npm run test:voice`.
- `npm run test:phase2-acceptance`: the 7 HD_015b acceptance tests. With
  `VOICE_STRUCTURED_OUTPUT=on` they run against the structured mouth.
- Replay of a structured turn uses a sidecar in
  `tests/fixtures/voice-calls-structured/<callId>.json` (recorded Gemini JSON) or
  a labelled mock built from the recorded prose. Turns a mock cannot answer
  (a language regeneration) are reported as `needs_recording` and not scored.
  Record them with `--mouth structured --live --record` (needs `GEMINI_API_KEY`).
- Scorer checks added in M1: glued TTS pieces, letterless pieces, monologues,
  lost caller turns, stacked questions, deleted or replaced answers.

## Simulator

`scripts/voice-call-simulator.js` plays a scripted caller (espeak-ng or piper,
synthesised locally) into `/ws/media` in real-time 20 ms frames and records agent
audio, simTap text and first-audio latency. It refuses non-localhost targets
without `--allow-remote`. `--dry-run` only synthesises audio. Example script:
`tests/fixtures/voice-sim/dusted-en.json`.
