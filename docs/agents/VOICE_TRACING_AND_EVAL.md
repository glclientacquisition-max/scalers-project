# Voice tracing and eval

Phase 1 of the voice rebuild. This measures what a call did. It does not change what the caller hears.

Later phases plug in here:

| Phase | What changes | What stays |
| --- | --- | --- |
| 2. Structured Gemini output | `polishSpokenReply` and the other mouth filters shrink or go away. Replay still calls the mouth. Scores should rise. | Trace stages, fixtures, the gate |
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
| `VOICE_RELEASE_LABEL` | Optional string stored on `release.label`. Empty means null. |

Writes are fire-and-forget. A trace error never throws into the call. `finishCall` waits for turn writes, then writes the call row.

## Trace schema

`schemaVersion` is `1`.

Turn record (`schema: scalers.voice.turn`):

- `callId`, `tenantId`, `turnIndex`, `pii`, `at`, `voiceId`
- `caller.text`, `caller.language` (sticky), `caller.sticky`, `caller.detected`, `caller.soniox`, `caller.confidence`
- `stages[]`, in order. Each stage has `stage`:

| stage | Fields |
| --- | --- |
| `stt` | `kind` interim or final, `text`, `tokens[]` with `text`, `final`, `language`, `startMs`, `endMs` |
| `turn_end` | `decision` flush, hold, skip, drop, queue, replay. `reason` |
| `language` | `detected`, `sticky`, `soniox`, `confidence` |
| `model` | `phase` request or output. Request stores `provider`, `model`, `promptId`, `promptVersion`, `language`. It does not store the prompt body. Output stores `outputText`, `chars`, `spokenEmitted`. |
| `transform` | `name`, `reason`, `before`, `after`, `dropped` |
| `canned` | `path`, `text`. Paths include `greeting`, `file_name_ask`, `visit_read`, `hear_again`, `speech_repair`, `llm_recovery`. |
| `tts` | `text` sent toward TTS, `before` (punctuation still on), `language`, `voiceId`. One stage per spoken sentence. Fillers are not `tts`. |
| `filler` | Thinking-ack or tool-hold audio. `text`, `before`, `language`. Not part of the scored reply. |
| `tool` | `name`, `status`, `args`. Args are a short summary (name, reason, item, when). Phones stay redacted. A consent block is `status: consent_blocked`. |
| `barge_in` | `reason` |
| `latency` | `callerStopToModelFirstTokenMs`, `callerStopToFirstTtsPcmMs` (first audio, including a filler), `firstReplyPcmMs` (first audio that is not a filler). |
| `outcome` | `value` such as `ok`, `barge_in`, `speech_repair`, `early_return`, `unlogged` |
| `speak_packet` | `tier` (`public`, `step_up`, or `private`), `outcome`, `text`, `committed`. Written when SpeakPacket commits a fact, and when a local line stays private. |
| `speak_slots` | `action` `enqueue` or `drain`, and `slots[]` with `outcome`, `line`, `language`. Enqueue is a slot Brain filled on this turn. Drain is a slot Voice removed because that line was spoken. |

Call record (`schema: scalers.voice.call`): `startedAt`, `endedAt`, `turnCount`, `voiceId`, `sttModel`, `ttsModel`, greeting stages, plus the fields below. `finishCall` writes them once. A reader does not recompute them.

| Field | Meaning |
| --- | --- |
| `score` | 0 to 100. The same call score the replay gate uses. Null if scoring threw. |
| `checks` | Per-check counts (`languageMismatch`, `incomplete`, `repeatedQuestion`, `silence`, `deletedAnswer`, `respelling`, `prematureTurn`, `slow`). Null if scoring threw. |
| `diagnosis` | One plain-English line naming the worst check and the turns, for example `Name asked 3 times (turns 4, 7, 9)`. `No failed checks.` when the card is clean. Null if scoring threw. |
| `release` | `{ gitSha, branch, label }`. `gitSha` is `RAILWAY_GIT_COMMIT_SHA`, or `GIT_SHA` when that is empty. `branch` is `RAILWAY_GIT_BRANCH`. `label` is `VOICE_RELEASE_LABEL` when set. |

The worst check is the one that costs the most points on this call (silence 30, a deleted answer 25, language or completeness 20, a repeated question up to 30, respelling capped at 3, a cut-off or a slow first audio 10). A scoring error logs `[voice-trace] score failed` once per process and leaves the three fields null. The call row is still written.

`finishCall` writes the call score onto the call row, then writes each turn's own `score`, `checks`, and `notes` onto that turn row. `score` and `checks` are columns and payload. `notes` are the reason strings for that turn, on the payload. Diagnosis and release stay on the call row. Turn rows leave `diagnosis` and `release` null. The Admin Quality tab reads the columns. The payload has the same score and checks.

Soniox realtime sessions send `enable_language_identification: true`. Per-token tags are `sw`, `en`, or `sheng`. Language hints alone do not fill `token.language`. HD_0789461c5319 had `language: null` on every token because that flag was off. The trace stores the Soniox language on `caller.soniox` and the language stage, next to the keyword `detected` value and the sticky language. The scorer uses the Soniox language when any tag is present. It uses the keyword fallback only when every tag is empty. It does not count both.

Prompt identity lives in `src/prompts.js` as `VOICE_SYSTEM_PROMPT_ID` (`voice.system`) and `VOICE_SYSTEM_PROMPT_VERSION`. Bump the version when the prompt text changes. Do not put the prompt in the trace.

## Replay

`src/speech/replayVoice.js` does not load `server.js`. It runs the same mouth the call uses: `polishSpokenReply`, empty-turn repair, `cutNoAiSlop`, `prepareForTts`. Tool marker blocks are removed before that mouth, the same way a live turn speaks `spokenText` and not the tool JSON. The model stage still stores the raw text.

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
| `languageMismatch` | The whole spoken reply is not the caller's language. When Soniox tagged the turn (`caller.soniox`, the language stage, or STT token languages), that language is the caller language and the keyword fallback is not also checked. When every tag is empty, the caller language is `caller.detected` or the language stage, then the caller text. It does not use the sticky language. A reply is not English just because it contains one job loanword such as cleaning. `mixed` matches either side. Sheng matches Kiswahili. A bare sawa or okay is neutral. One mismatch per turn. |
| `incomplete` | Spoken characters are under half the model prose (model at least 40 characters), or the caller asked for services and the spoken reply has no service noun. Tool marker blocks are not prose. |
| `repeatedQuestion` | Name or identity asked more than once, or the same question appears again. Questions are read from the model prose or from `tts.before`, where the question mark is still present. A name ask is not also counted as a question. Call-level. |
| `silence` | Caller text and no spoken reply, and the turn was not held, skipped, or a backchannel such as Okay, and did not end in `barge_in`. A filler is not a reply. |
| `deletedAnswer` | A transform dropped a service or name line, or the model prose named one and the spoken reply does not, or a question in the model prose (or a dropped transform) is missing from the whole spoken reply, or a sentence was dropped with reason `unbound_place` or `unsaid_number`. |
| `respelling` | Hyphenated English-style spellings on a Kiswahili mouth (`Kee-ten-geh-la`). |
| `prematureTurn` | Caller text ended on a dash or comma, or was cut mid-phrase, and the turn flushed. A late token dropped (`turn_end` grace/ignore) or merged after the turn closed (`late_final`) counts as a cut. |
| `slow` | `firstReplyPcmMs` later than 1200 ms. When that field is absent, the scorer uses `callerStopToFirstTtsPcmMs`, which is the reply on older fixtures. A filler with no reply is not slow. Missing latency is skipped. |

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

**Prod calls.** Prod Voice runs with traces off (`VOICE_TRACE` auto is off on a `prod` Railway environment) and the prod database has no `voice_turn_traces` table. Score a prod call from its stored transcript:

```bash
node scripts/score-voice-call.js <calls.id or HD_sid> --transcripts      # reads calls, transcripts, appointments
node scripts/score-voice-call.js <calls.id> --rows call.json             # same, from an exported JSON bundle
```

`--rows` takes `{ call: { id, created_at }, transcripts: [{ speaker, text_content, created_at }], openVisits: [...], agentName, businessName }`. Transcript turns carry only the spoken text, so latency, language tags, and deleted-answer checks are weaker there.

### Call-level checks (`src/speech/callChecks.js`)

| Check | Fails when | Weight |
| --- | --- | --- |
| `visitMissed` | The caller asks what visits or bookings they have and the reply reads none (no "you have ... <day/time>") and does not say nothing is open. With `openVisits` known, "nothing open" while visits are open also fails. | 20 |
| `dateWrong` | A spoken "today/tomorrow/leo/kesho is <day>", "<weekday>, <date> <month>", or the good morning/afternoon/evening greeting disagrees with the Africa/Nairobi calendar at that turn (turn `at`, else the call time). | 20 |
| `nameLock` | After the caller's name is locked (a yes to "Am I speaking with X?" / "Ni X ninaongea naye?", or "my name is X" / "naitwa X"), the agent asks for the name again, calls the caller another name, or saves another name in `save_caller_info`. | 15 |

They add to the call penalty (capped at 45) next to the repeated-question penalty, and their notes land on the turn that failed.

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
| `HD_0789461c5319` | Staging, 2026-10-07 20:49Z (23:49 EAT). Done and Dusted. First call with `voice_turn_traces`. |

Today's code is expected to score badly. That is the baseline.
