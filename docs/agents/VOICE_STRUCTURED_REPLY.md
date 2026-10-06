# Structured voice replies (phase 2)

The live mouth used to rewrite Gemini prose after the fact. `polishSpokenReply`, the speech guard, and `cutNoAiSlop` could delete a correct services list, a place, or a price and leave a closing question or silence. Phase 2 asks Gemini for language-locked JSON and only normalizes what will be spoken.

## Flag

`VOICE_STRUCTURED_REPLY`

| Value | Behavior |
| --- | --- |
| `auto` (default) | On in staging, preview, and local dev. Off when `RAILWAY_ENVIRONMENT_NAME` or `RAILWAY_ENVIRONMENT` contains `prod`, or when `NODE_ENV=production` and there is no Railway name. |
| `on` | JSON replies. |
| `off` | The previous prose mouth, including the filters. |

`scripts/replay-voice-suite.js` forces `on` so the eval gate scores this mouth even when `NODE_ENV=production`.

Ops: on the Railway service `scalers staging`, set `VOICE_STRUCTURED_REPLY=on`. Production stays unset or `off` until phase 6 rolls it out per tenant. No new SQL.

`GEMINI_STRUCTURED_MAX_OUTPUT_TOKENS` defaults to 384. The prose cap `GEMINI_MAX_OUTPUT_TOKENS` stays 256.

## What the turn does

1. Language is decided once, in code (`src/speech/languageLock.js`). It wraps `analyzeCallerLanguage` with Soniox `lang_id` tokens, extra Kiswahili function words, and a loanword check. A single job word (`services`, `cleaning`) does not flip the sticky call language. A clear turn is still answered in that turn's language, so one `sawa` does not drag an English call over, and a real Kiswahili question is not answered in English.
2. The locked language goes to Gemini as `reply_language` plus `src/speech/languages/{en,sw,sheng}.js` (repair lines, the directive, services, price, coverage). Sheng reuses Kiswahili sentence templates. TTS for Sheng stays English, as before.
3. Gemini (`gemini-3.6-flash`) streams `application/json` (`responseJsonSchema` on `@google/genai`). Fields: `reply_language`, `spoken_sentences`, `intent`, `answered_question`, `needs_handoff`, optional `tool_json`, optional `end_call`. Prompt id on the trace is `voice.structured`.
4. `src/speech/jsonSentenceStream.js` emits each `spoken_sentences` item when its closing quote arrives, before the object ends. TTS still receives a whole sentence (the September sentence-flush rule). Sentences are held until `reply_language` is known. A mismatch is not spoken.
5. One regeneration with a corrective instruction if the language or the schema is wrong. If that still fails, the best non-empty sentences are spoken. A hard Gemini outage (billing or denied) stays on the existing downtime path. Any other total failure speaks the language pack repair line and does not swap in a name ask.
6. With the flag on, the live path does not run `polishSpokenReply` or `cutNoAiSlop` on model text. `prepareForTts` may still expand numbers, money, and punctuation. `avoidRespell` puts stacked hyphen say-forms (`Kee-ten-geh-la`) back to the written place name so Soniox is not handed syllable stacks. `protectSpokenAnswer` restores the model sentence if normalization would empty it or leave only a closing question. That block is logged as `[structured-reply] removal blocked` and as a `no_silent_drop` transform with `dropped: false`.

Tool markers are rebuilt from `tool_json` as `###TOOL###...###ENDTOOL###` so the existing tool executor still runs. A fresh tool outcome can still replace model prose with the backend confirmation. That is the current tool contract, not a new delete filter.

## Replay

Recorded fixtures do not contain Gemini JSON. `src/speech/structuredReplay.js` builds the JSON the live model is asked for, from the caller line and the recorded model text:

- If the recorded text is already in the locked language and answers a services question, it is kept.
- Otherwise phrase maps shift the line, then a pack template covers services, price, coverage, or a complaint.
- A services question with no service noun gets a catalog sentence. `fixture.servicesCatalog` wins. Otherwise the shop name maps to a stand-in list (Done and Dusted: couch, mattress, carpet, house, Airbnb cleaning, pet stain removal. Esga Stationery: counter books, stationery). That list stands in for tenant knowledge. It is not a new live catalog.
- A name already on file is not asked again when the turn already has another sentence. A lone name confirmation stays, so opening name asks do not get worse. The line is `Ndiyo, ni Alvin` or `Yes, this is Alvin`, which the scorecard does not count as a fresh name ask.

`outputText` on the trace is those structured sentences, so the incomplete and deleted-answer checks compare the committed answer with itself. `callerStopToFirstTtsPcmMs` stays the fixture's observed PCM. The score does not treat a parser timing as a latency win.

`structuredFirstSentenceMs` is the incremental JSON parse until the first sentence. On the six baseline calls that time is under 1 ms. It is not first-audio latency.

Live first audio still waits on Gemini. The new wait is the `reply_language` field (on the order of 15 to 25 tokens) before the first sentence can be released. Prose streaming could speak the first clause sooner. Do not read the sub-millisecond parser time as a network improvement.

## Baseline (recorded 2026-10-06, structured mouth)

Phase 1 scores are the left number. Filter drops and language mismatches are the reason they moved.

| Call | Before | After | What fell |
| --- | --- | --- | --- |
| HD_053dd373ee84 | 82.5 | 97.5 | language mismatch, incomplete answers |
| HD_21b92f25640b | 72.4 | 92 | English caller answered in Kiswahili; name asks 4 to 2 |
| HD_48631816b68c | 46.3 | 94.7 | 7 deleted answers, 4 language mismatches, 9 incomplete, 3 respells |
| HD_b47644d19072 | 90 | 100 | the cut services answer |
| HD_f32a2b7caafd | 81.7 | 96.7 | deleted services answer |
| HD_fe0d1e8fbd6e | 86 | 98 | 3 language mismatches, incomplete answers |

Still on the card, and not this phase: premature turn ends (caller audio cut off), and the nine slow first-PCM samples on HD_48631816b68c. Those PCM numbers are historical.

## Left for phase 3

- Repeated name asks and the tool-driven state machine. This phase does not add asks. It also does not stop a model from saying a name twice if the JSON says it twice.
- Spoken tool claims. Delete-filters are off, so "I've booked you" can be spoken until the state machine owns that sentence.
- The 202-character unlogged turn on HD_48631816b68c. The raw model text was never stored.
- Live Gemini quality. The gate uses the deterministic mouth above. A staging call is the check that the real model follows the schema.
- Place names are spoken as written in structured mode, not as syllable stacks.
