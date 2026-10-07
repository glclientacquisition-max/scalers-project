# Voice hardening (HD_120c5b99e9e7)

Live staging call HD_120c5b99e9e7 (Done and Dusted, about 91 seconds) spoke an English name check on a Kiswahili lock, greeted the shop twice, flushed "Nilikuwa nauliza,", treated "Happy?" as a goal, and could leave a recording 404 with no status. The fixes sit in the turn machine, the language packs, and one turn-end policy. `server.js` calls those modules. It does not add another text filter.

## Language-locked lines

Name confirm, filler, repair, unclear, closing, and "Okay." / "Sawa." come from `src/speech/languages/{en,sw,sheng}.js`. `fileNameAskLine` uses `state.language.reply`, then a known `language.current`. A Kiswahili lock says `Je, naongea na Alvin?`. It does not say `Am I speaking with Alvin?`.

## Stages

`greeting` → `identity` → `serve` → `closing`, in `planStageSpeech`.

After the opener has played, identity is one pack confirm and does not say the shop again. Serve answers, or asks `Nikusaidie vipi?` / `How can I help?`, without a second Habari. A later model sentence that greets the shop again is rewritten by `guardStageSentence` only when `voice.greetingPlayed` is set. Replay does not set that flag, so the six seeded scores stay on the recorded mouth.

Known services and a clear goodbye speak the pack immediately, the same way the cached greeting does. Gemini runs when the turn is not one of those.

## One turn end

`decideTurnEnd` in `src/speech/turnTaking.js` is the only end-of-turn decision. A Soniox endpoint on an unfinished phrase waits out the cap, then flushes. The cap is `VOICE_TURN_END_CAP_MS` (default 800, clamped to 700–900).

Unfinished marks: a trailing comma or dash, and a Kiswahili stem parked at the end (`nauliza`, `nilikuwa`, `ningetaka`, `naomba`, `um`, `ah`). "Nilikuwa nauliza," waits. "Ah, nilikuwa nataka kuchukua counter books." is complete, because `nilikuwa` is not at the end.

## First audio

Each caller turn logs `endpoint_to_language_ms`, `language_to_token_ms`, `token_to_sentence_ms`, `sentence_to_pcm_ms`, and `first_pcm_ms`. The TTS session is opened when media connects. The first JSON sentence goes to TTS when its quote closes, without waiting for `reply_language`.

Target: p50 `first_pcm_ms` ≤ 1200. The eval fails when a measured p50 is more than 200ms slower than `tests/fixtures/voice-eval-baseline.json` `firstPcmP50`. Missing samples are not a failure. The stored p50 is 1603, from the historical samples on HD_48631816b68c. That call is already over the target. The gate watches regression, not a rewrite of those old numbers.

## Weak first STT

A short or low-confidence first final, including "Happy?", does not set the call goal and does not ask the name. One pack line: `Samahani, hurudia?` or `Sorry, say that again?`. A second one on that opening stays quiet.

## Recording 404

After hangup, `fetchCallRecordingWithBackoff` retries on 404, 410, and 202. The retry is a `setTimeout`, not an await in front of wallet settle. If it is still missing, the call summary gets `recording_status: "missing"` and one `[recording-missing]` log line. There is no new column.

## Staging

On Railway service `scalers staging`:

- `VOICE_STRUCTURED_REPLY` stays `auto` or `on`.
- Leave `VOICE_GEMINI_LIVE` unset and `VOICE_ROLLOUT_TENANTS` empty.
- `VOICE_TURN_END_CAP_MS` is optional. Unset means 800.
- Apply `docs/supabase/voice_turn_traces.sql` by hand if that table is not there yet.
- No new SQL for recording status.

Place one staging call. The first name check should match the lock, the shop name should appear in the opener only, and a trailing "Nilikuwa nauliza," should not cut the caller off. A recording that never appears should show `recording_status: missing` on the call summary after the retries, and the wallet row should still settle.
