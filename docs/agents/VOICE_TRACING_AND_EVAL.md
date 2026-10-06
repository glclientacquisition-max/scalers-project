# Voice tracing and eval

Phase 1 of the voice rebuild. This measures what a call did. It does not change what the caller hears.

Later phases plug in here:

| Phase | What changes | What stays |
| --- | --- | --- |
| 2. Structured Gemini output | Shipped behind `VOICE_STRUCTURED_REPLY`. Replay scores the structured mouth. See [`VOICE_STRUCTURED_REPLY.md`](./VOICE_STRUCTURED_REPLY.md). | Trace stages, fixtures, the gate |
| 3. Tool state machine | Pass `respond` into `replayCall`. Recorded mode can keep the old model text. Live mode calls the new brain. | Same scorecard |
| 4. Split `server.js` | Move the `voiceTrace.note*` calls with the stage they describe. The record shape does not change. | `createVoiceTrace` |
| 5. Gemini Live | Add a `model` stage with `provider: 'gemini-live'`. Do not add a column. | JSON payload |
| 6. Per-tenant rollout | `VOICE_TRACE` stays on in staging. Production stays off until a tenant flag says otherwise. | The same table |

## Store

Production and staging persist traces in `public.voice_turn_traces` (JSONB). One row per caller turn, plus one call row.

Why a table, not only a file: Railway disk is ephemeral, and the score CLI has to load a call id from any machine after the call ends. The payload is JSON so a new model is another stage, not a migration. JSONL and memory sinks exist for tests and for a laptop without Supabase. They use the same writer.

Apply [`docs/supabase/voice_turn_traces.sql`](../supabase/voice_turn_traces.sql) in the Supabase SQL editor on staging. Deploy does not run it. If the table is missing, the call still proceeds and the process logs `[voice-trace] insert failed` once.

Rows are service role only. There is no owner policy. `pii` is `transcript`. The writer redacts emails and phone numbers of 8 digits or more (`[phone:last4]`). Names stay, because the scorecard has to see a repeated name ask.

## Flag

| Env | Meaning |
| --- | --- |
| `VOICE_TRACE` | `auto` (default), `on`, or `off`. `auto` is on unless the Railway environment name contains `prod`, or `NODE_ENV=production` and there is no Railway name. Staging and preview stay on. |
| `VOICE_TRACE_SINK` | `auto` (default), `supabase`, `jsonl`, or `memory`. `auto` uses Supabase when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set. |
| `VOICE_TRACE_JSONL` | File path when the sink is jsonl. Default `data/voice-traces.jsonl`. |

Writes are fire-and-forget. A trace error never throws into the call. `finishCall` waits for turn writes, then writes the call row.

## Trace schema

`schemaVersion` is `1`.

Turn record (`schema: scalers.voice.turn`):

- `callId`, `tenantId`, `turnIndex`, `pii`, `at`, `voiceId`
- `caller.text`, `caller.language`, `caller.confidence`
- `stages[]`, in order. Each stage has `stage`:

| stage | Fields |
| --- | --- |
| `stt` | `kind` interim or final, `text`, `tokens[]` with `text`, `final`, `language`, `startMs`, `endMs` |
| `turn_end` | `decision` flush, hold, skip, drop, queue, replay. `reason` |
| `language` | `detected`, `sticky`, `confidence` |
| `model` | `phase` request or output. Request stores `provider`, `model`, `promptId`, `promptVersion`, `language`. It does not store the prompt body. Output stores `outputText`, `chars`, `spokenEmitted`. |
| `transform` | `name`, `reason`, `before`, `after`, `dropped` |
| `canned` | `path`, `text`. Paths include `greeting`, `file_name_ask`, `visit_read`, `hear_again`, `speech_repair`, `llm_recovery`. |
| `tts` | `text` sent toward TTS, `before`, `language`, `voiceId` |
| `barge_in` | `reason` |
| `latency` | `callerStopToModelFirstTokenMs`, `callerStopToFirstTtsPcmMs`, `structuredFirstSentenceMs` (parser time until the first JSON sentence, not network audio) |
| `outcome` | `value` such as `ok`, `barge_in`, `speech_repair`, `early_return`, `unlogged` |

Call record (`schema: scalers.voice.call`): `startedAt`, `endedAt`, `turnCount`, `voiceId`, `sttModel`, `ttsModel`, and greeting stages.

Prompt identity lives in `src/prompts.js` as `VOICE_SYSTEM_PROMPT_ID` (`voice.system`) and `VOICE_SYSTEM_PROMPT_VERSION`. Bump the version when the prompt text changes. Do not put the prompt in the trace.

## Replay

`src/speech/replayVoice.js` does not load `server.js`. With `VOICE_STRUCTURED_REPLY` off it still runs `polishSpokenReply`, empty-turn repair, `cutNoAiSlop`, and `prepareForTts`. The eval script forces the flag on and runs `speakStructuredTurn` (`src/speech/structuredReplay.js`): a deterministic stand-in for Gemini JSON, then the same normalize-only mouth. It does not call the network. `--live` still asks Gemini.

```bash
npm run voice:replay
node scripts/replay-voice-suite.js --live
```

`--live` needs `GEMINI_API_KEY`. CI uses recorded mode only. Recorded mode speaks `turns[].model.outputText`. A missing `outputText` with `canned.text` speaks that line. `unlogged: true` is a turn whose raw model text was never stored. It is omitted from the score so a missing log cannot fail the gate forever.

A later brain passes `respond` to `replayCall(fixture, { mode: 'live', respond })`.

## Score

`src/speech/voiceScore.js` scores each turn, then the call.

| Check | When it counts |
| --- | --- |
| `languageMismatch` | Reply language is not the caller language. `mixed` matches either side. Sheng matches Kiswahili. A bare sawa or okay is neutral. |
| `incomplete` | Spoken characters are under half the model text (model at least 40 characters), or the caller asked for services and the spoken line has no service noun. |
| `repeatedQuestion` | Name or identity asked more than once, or the same question spoken again. Call-level. |
| `silence` | Caller text and no spoken line, and the turn was not held. |
| `deletedAnswer` | A transform dropped a line that named a service or stated the caller's name, or the model had that and the spoken line does not. |
| `respelling` | Hyphenated English-style spellings on a Kiswahili mouth (`Kee-ten-geh-la`). |
| `prematureTurn` | Caller text ended on a dash or comma, or was cut mid-phrase, and the turn flushed. |
| `slow` | First TTS PCM later than 1200 ms. Missing latency is skipped. |

Call score is the average turn score, minus up to 30 for repeated questions. A turn marked `unlogged` is left out of the average.

Latency budget is the voice lane target: first audible audio within 800 to 1200 ms after the caller stops. The gate uses 1200 ms.

## Regression gate

Seeded calls live in `tests/fixtures/voice-calls/`. The baseline is `tests/fixtures/voice-eval-baseline.json`.

```bash
npm run test:voice-eval
```

`npm run test:voice` runs this last. The gate fails when a call score drops, or any check count rises. A higher score and a lower count pass. New check names are allowed 0 until the baseline is updated.

```bash
node scripts/replay-voice-suite.js --update-baseline
```

Do that only after a phase that is supposed to move the numbers, and commit the new baseline in the same PR.

## Score a live call

After Alvin hangs up on staging (and the SQL has been applied):

```bash
npm run voice:score -- HD_xxxxxxxx
node scripts/score-voice-call.js HD_xxxxxxxx --file data/voice-traces.jsonl
```

The Supabase path needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment. It reads `voice_turn_traces` for that `call_id`.

## Seeded calls

The fixtures are built from Railway logs and the transcript rows on 2026-10-06. Where Gemini's raw text was not logged, the fixture uses the TTS original, a `spoken_drop` preview, or marks the turn `unlogged`. The 202-character loss on `HD_48631816b68c` is a historical note (`spokenEmitted` 0). It is not a permanent gate failure, because the text is not in the logs and later phases cannot replay it until a new call stores it.

| Call | Where |
| --- | --- |
| `HD_48631816b68c` | Staging, 2026-10-06 09:11Z (12:11 EAT). Done and Dusted. |
| `HD_053dd373ee84` | Staging, 08:24Z. |
| `HD_f32a2b7caafd` | Staging, 08:26Z. |
| `HD_b47644d19072` | Staging, 08:36Z. |
| `HD_fe0d1e8fbd6e` | Staging, 08:04Z. |
| `HD_21b92f25640b` | Production, 2026-10-05 19:12Z. Esga Stationery. |

Today's code is expected to score badly. That is the baseline.
