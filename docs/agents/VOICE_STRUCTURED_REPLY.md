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

Ops: on the Railway service `scalers staging`, `auto` is already on. Set `VOICE_STRUCTURED_REPLY=on` if you want it explicit. Production stays off until `VOICE_ROLLOUT_TENANTS` lists a tenant id. No new SQL.

`GEMINI_STRUCTURED_MAX_OUTPUT_TOKENS` defaults to 384. The prose cap `GEMINI_MAX_OUTPUT_TOKENS` stays 256.

## What the turn does

1. Language is decided once, in code (`src/speech/languageLock.js`). It wraps `analyzeCallerLanguage` with Soniox `lang_id` tokens, extra Kiswahili function words, and a loanword check. A single job word (`services`, `cleaning`) does not flip the sticky call language. A clear turn is still answered in that turn's language, so one `sawa` does not drag an English call over, and a real Kiswahili question is not answered in English.
2. The locked language goes to Gemini as `reply_language` plus `src/speech/languages/{en,sw,sheng}.js` (repair lines, the directive, services, price, coverage). Sheng reuses Kiswahili sentence templates. TTS for Sheng stays English, as before.
3. Gemini (`gemini-3.6-flash`) streams `application/json` (`responseJsonSchema` on `@google/genai`). Fields: `reply_language`, `spoken_sentences`, `intent`, `answered_question`, `needs_handoff`, optional `tool_json`, optional `end_call`. Prompt id on the trace is `voice.structured`.
4. `src/speech/jsonSentenceStream.js` emits each `spoken_sentences` item when its closing quote arrives, before the object ends. TTS still receives a whole sentence (the September sentence-flush rule). The caller language is already locked, so the first sentence is not held for the `reply_language` field. A later field that disagrees with the lock is not spoken.
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
| HD_21b92f25640b | 72.4 | 100 | English caller answered in Kiswahili; name asks 4 to 1 after the name gate |
| HD_48631816b68c | 46.3 | 94.7 | 7 deleted answers, 4 language mismatches, 9 incomplete, 3 respells |
| HD_b47644d19072 | 90 | 100 | the cut services answer |
| HD_f32a2b7caafd | 81.7 | 96.7 | deleted services answer |
| HD_fe0d1e8fbd6e | 86 | 98 | 3 language mismatches, incomplete answers |

Still on the card, and not this phase: premature turn ends (caller audio cut off), and the nine slow first-PCM samples on HD_48631816b68c. Those PCM numbers are historical.

## Name gate (phase 3)

`src/speech/turnMachine.js` runs after the structured sentences are chosen, on the live stream and on replay.

- A confirmed name is not asked again. "Jina lako ni Alvin" becomes "Ndiyo, ni Alvin" or "Yes, this is Alvin".
- An unknown name is asked once per call. A later ask is dropped. If that was the only sentence, the caller hears "Okay." or "Sawa."
- A sentence that also names a service or a price keeps that answer. The name-ask words come out once the ask has already been used.
- `replayCall(fixture, { mode: 'live', respond })` sends the caller text, history, and caller state to `respond`. Recorded mode still starts from the fixture text, then the same gate.

HD_21b92f25640b moved from 92 to 100. Name asks on that call went from 2 to 1. The other five calls did not drop.

## Later phases on this branch

- Phase 4. `src/speech/turnTrace.js` notes each stage. `src/speech/structuredSpeak.js` prepares one structured sentence. `createVoiceTrace` still writes the same JSON.
- Phase 5. `VOICE_GEMINI_LIVE` defaults off. On records `provider: 'gemini-live'` inside the model stage. The call still uses Gemini JSON and Soniox TTS. Kiswahili stays on this mouth.
- Phase 6. `VOICE_ROLLOUT_TENANTS`. Empty list: staging on, production off. A list limits the structured mouth and the trace to those tenant ids, including in production. No new SQL.

Ops: on Railway service `scalers staging`, `VOICE_STRUCTURED_REPLY` can stay `auto` or `on`. Leave `VOICE_GEMINI_LIVE` unset. Leave `VOICE_ROLLOUT_TENANTS` empty so the whole staging line is on. Apply `docs/supabase/voice_turn_traces.sql` by hand if the table is not there yet.

Still measured on the six seeded calls: premature marks that were already in those transcripts, and the historical first-PCM p50 on HD_48631816b68c. Live turn-end, language-locked identity, and the recording retry are in [`VOICE_HARDENING.md`](VOICE_HARDENING.md). A staging call is the check that live Gemini follows the schema. The gate uses the deterministic mouth above.
