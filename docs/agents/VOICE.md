# Voice lane contract

**Mission:** Make live phone calls sound fast, natural, and interruptible on Kenya telephony (SautiKit + Soniox).

Use this when the task is about audio path, latency, barge-in, fillers, TTS pronunciation plumbing, or media WebSockets — not dashboard UI or wallet product rules.

## Owns (edit freely)

| Path | Role |
| --- | --- |
| `server.js` | Media WS (`/ws/media`), inbound Stream XML wiring, speak/barge/filler/stream turn loop |
| `src/speech/**` | Soniox STT/TTS, STT context, turn-taking, spoken buffer, TTS normalize, lexicon, Sheng rewrite |
| `src/sautikit/**` | Webhook signature / guards used by voice HTTP |
| `tests/ttsNormalize.test.js` | TTS prep unit tests |
| `tests/turnTaking.test.js` | Endpoint / barge-in unit tests |
| `tests/overlapHold.test.js` | Overlap queue + last-question replay |
| `tests/idleNudge.test.js` | Idle silence check-in after a committed question |
| `tests/spokenStreamBuffer.test.js` | LLM→TTS chunking tests |
| `tests/voiceWiring.test.js` | Static wiring checks for runtime voice paths |
| `tests/recordingEvents.test.js` | SautiKit `recording.ready` payload parse + REST fetch |
| `scripts/smoke-recording-webhook.js` | Live HTTP POST `/voice/events` recording envelopes |
| `tests/naturalnessScore.test.js` | Roboticness pass/fail scanner for live transcripts |
| `.env.example` | Voice/Soniox/turn-taking env knobs only |
| `docs/operations/WEBHOOK_TUNNEL.md` | Local tunnel for SautiKit media |
| `docs/agents/VOICE_DOWNTIME_AT_SCALE.md` | Multi-tenant speech-outage contract |
| `docs/agents/VOICE_NATURALNESS.md` | Live DID roboticness eval (pass/fail, freeze SHA) |
| `docs/product/CALL_MESSAGE_CONTRACT.md` | Owner vs caller post-call message contract |
| `docs/product/CALL_MESSAGE_GAP.md` | Live owner SMS vs excellence bar |

Also OK: small imports from `src/conversation/language.js` / `dynamicSpeech.js` **only** when needed for fillers, greetings, or language sticky behavior on the media path.

## Do not touch

- `dashboard/**` (Desk / Admin UI)
- `docs/supabase/**` and wallet RPCs (Platform / Ops)
- Prompt policy copy in `src/prompts.js` beyond what Voice already injects for latency (Brain owns conversation goals)
- Billing enforcement product rules (Ops) — Voice may call `db.chargeCallToWallet` but must not redesign rates/ledger

If a change needs a new DB column or RPC: stop and hand off to **Platform**.

## Architecture snapshot

```
SautiKit POST /voice/incoming → Stream XML (connect=true)
  → wss /ws/media (audio.drachtio.org, S16LE PCM)
  → Soniox STT → adaptive flush / barge-in
  → (optional filler) + Gemini turn (stream into TTS when VOICE_LLM_STREAM=on)
  → Soniox TTS → PCM frames back to SautiKit
  → /voice/events → transcript / recording / notify / wallet charge
```

Legacy `/ws/relay` (ConversationRelay) may still exist — do not expand it; production path is `/ws/media`.

## Invariants (do not break)

1. **Subprotocol** `audio.drachtio.org` and **raw PCM** (not Twilio base64 mu-law).
2. Stream responses must use **`connect="true"`** or the leg drops.
3. Prefer **16 kHz** bidirectional sampling aligned with Soniox.
4. First audible agent audio target: roughly **≤ 800–1200 ms** after caller stops (p50 mindset).
5. Barge-in must cancel TTS + clear queued playback; avoid false cancels on backchannels / echo.
6. Spoken agent lines that play to the caller should land in the transcript.
7. Keep `db.js` orchestration surface stable (`upsertCall`, `appendTranscript`, `attachRecording`, `chargeCallToWallet`, …).
8. Greeting must await tenant profile. Play a cached tenant greeting clip when present so TTS-ready wait is not dead air. If TTS is not ready and there is no cache: existing downtime clip, then hangup. Never mute. Never speak a default-name opener. Never call `speakText` while `tts` is still null. Log `connect_to_greeting_pcm_ms` from answer/forward to first greeting PCM. TTS connect runs in parallel with tenant fetch.
9. Action turns (`CREATE_REQUEST` / `CAPTURE` / `ESCALATE` / `TRANSFER`) speak an immediate progress line before Gemini+tools; do not leave dead air. `TRANSFER` / `liveTransfer` is **not** executable until conference REST in [`../LIVE_TRANSFER.md`](../product/LIVE_TRANSFER.md) rings a human and `VOICE_LIVE_TRANSFER=on`. Do not close Stream for cold Dial. Do not claim a bridge from the media loop. SautiKit outbound cost is KES 3/min answered; tenant outbound on the package rate card is KES 9/min and is not offered until live transfer ships (Ops owns rates).
10. Filler cancel must target **only** the filler `stream_id` (plus generation bump). Never `tts.cancel()` with no id while a reply stream is prefetched. A thinking-ack is per turn when that turn's first audio is still late. Do not latch it for the rest of the call.
11. Soniox **402 billing exhausted** is a speech-provider outage, not a turn-policy miss. Play the catalog-voice downtime recording (same voice as that line's greeting), then espeak if that clip is missing. Do not call Gemini TTS on billing. Hang up. Do not log the line as spoken unless PCM was sent. The default-clone WAVs in `src/speech/pcm/` are required in git so a cold boot at 402 still speaks. Surface `soniox.lastError` plus `soniox.outageClips` (including `packaged.missing`) on `/healthz`. Key clips by catalog voice × language. Keep the spoken line voice-generic. Alert each owner at most once per cooldown. See [`VOICE_DOWNTIME_AT_SCALE.md`](./VOICE_DOWNTIME_AT_SCALE.md).
12. Gemini **credits depleted / denied** is a reasoning outage, not speech. STT and TTS still work. Keep the line open, ask for a name, save it, and alert the owner once per cooldown. Surface `gemini.lastError` on `/healthz`. Do not retry depleted credits on the next turn.
13. SautiKit / DID down is a **telephony** outage. No webhook reaches Voice. Do not try to speak. Follow the bridge playbook in [`VOICE_DOWNTIME_AT_SCALE.md`](./VOICE_DOWNTIME_AT_SCALE.md#telephony-down-bridge-playbook): notify owner once, forward or re-point the DID, verify one test call before marking it back.
14. A presented number that matches no business is rejected with `<Reject/>`. Do not answer as another tenant. The first-active-tenant fallback runs only when the webhook carried no number. `TENANT_ID` still pins a single-tenant host.
15. When `isTelephonyBillingExhausted()` is true, a new `POST /` or `POST /voice/incoming` returns `<Reject/>` before Stream. No `/ws/media`. The caller hears the carrier reject. The flag is set only by an empty prepaid balance or wallet HTTP 402 (`walletProbe.js`). Probe HTTP errors, including 403, timeouts, and never-probed state do not set it, so the gate stays open until `SAUTIKIT_API_KEY` can read `GET /v1/wallet`. A later healthy probe clears the flag so calls resume without a restart. `/healthz` `telephony.lastError.billingExhausted` is that flag. In-flight lifecycle webhooks still return empty `<Response/>` and do not re-Stream.

## Env knobs (Voice)

See `.env.example` — key ones:

## Env knobs (Voice)

See `.env.example` — key ones:

- `SONIOX_API_KEY`, `SONIOX_SAMPLE_RATE`, `SONIOX_TTS_MODEL` (default `tts-rt-v2`; retired `tts-rt-v1` remaps so clones are not silent; curated voices: voice engine `src/data/soniox-voices.json`, desk mirror `dashboard/src/data/soniox-voices.json`; per-tenant pick in `tenants.soniox_voice_id`)
- `SONIOX_STT_CONTEXT` (per-tenant vocabulary; default on), `SONIOX_STT_CONTEXT_MAX_TERMS`
- `VOICE_GREETING_MODE`, `VOICE_FILLER`, `VOICE_FILLER_DELAY_MS`, `VOICE_FILLER_CACHE`
- `VOICE_PROFILE` (`balanced` | `snappy`), `VOICE_TTS_GAIN`, `SONIOX_TTS_SPEED`, `SONIOX_TTS_SPEED_EN`, `SONIOX_TTS_SPEED_SW`
- `VOICE_LLM_STREAM`, `VOICE_STREAM_EARLY_CHARS` / `WORDS` (default 0: sentence-only TTS flush)
- `VOICE_FLUSH_MIN_MS`, `VOICE_FLUSH_MAX_MS`, `VOICE_IDLE_NUDGE_MS` (default 10000; not armed until the caller has spoken)
- `VOICE_BARGE_GRACE_MS`, `VOICE_BARGE_EARLY_MS`, `VOICE_BARGE_MIN_CHARS`
- Soniox endpointing: `SONIOX_MAX_ENDPOINT_DELAY_MS`, `SONIOX_ENDPOINT_SENSITIVITY`, …

## Caller file on the call

Voice does not own the caller file. Brain binds the speaker. Voice does four things on the media path.

1. **Unfinished flush.** `decideTurnEnd` is the only end-of-turn rule. An open phrase (Kiswahili frame such as `Nilikuwa nataka kujua`, a trailing comma, or a trailing dash) waits one cap of about 700–900ms, including across a Soniox endpoint. `applyTurnEnd` then calls `flushUtterance(decision)` so `unfinished` is not dropped. The flush passes `unfinished`, `weak`, and `weakStt` into `observeCallerTurn` and into first-forward. Brain #586 honors those fields in `isRejectedGoalText`, so that text does not become the goal or `first_turn_goal`. If Brain exports `isUnfinishedCallerStem` or `isUnfinishedCallerUtterance`, Voice calls that. Voice does not write the goal.

2. **Speak gate.** `gateCallerFileSpeech` runs before TTS. Open rows, a vocative file name, and `Yes, {name}` stay quiet until `caller.nameConfirmed` is true. A parallel `speaker` object does not override that flag. The identity ask may say the pending name, and `lockFileNameAsk` speaks it in the caller's current language. Voice does not set `nameConfirmed`. A grounded file fact is authorized once into a SpeakPacket (`src/speech/speakPacket.js`) before the name ask and before a Brain END farewell. Tiers are `public` (price, catalogue, hours, coverage, and a real service fact), `step_up` (identity), and `private` (a booking ladder, an open file row, an empty detail fallback). Brain stores those public facts on `conversation.speakSlots` (`outcome`, `line`, `language`) while the name ask is still due. Voice commits each slot before the name ask, speaks the fact first, then calls `drainSpokenSpeakSlots` with the lines it spoke so a spoken slot is removed. A slot still there after name Yes is spoken then, price ahead of another catalogue, and the name is not asked again. Private text is not committed. Public facts speak first, with no second outcome allowlist. Identity trails them. The name ask is last. A committed public packet is not dropped by a later name policy or by END. `speakText` skips the file gate for a line that packet already committed. If a public packet is still unsaid when they confirm the name, that Yes speaks it and does not ask the name again. END does not hang up on a turn that still has an unsaid public packet. The first services catalogue is `planCatalogueMouth`. A services ask speaks the Phase 0 local line once (`na` / `and`, one breath, one `speakText`) and returns before Gemini, so first audio stays on the local path and Gemini does not re-list that turn. That includes a clear services ask the name gate also takes: the list is spoken, then the name ask. A later Yes speaks that same line only when the list is still pending. Once `catalogueListed` is set, a detail ask and a name Yes do not speak the full list again. An on-file price speaks from the file (`outcome=price`, `groundFilePriceLine`, or a `service_facts` line) when the ask names the service or an earlier caller turn did. `VOICE_GEMINI_CATALOGUE=on` is a staging listen of that blend. Default off is the same local line. Tear the flag down after the score. Do not period-pace the list. Do not invent a service or a price. Do not turn on `VOICE_STREAM_EARLY_CHARS` or `VOICE_STREAM_EARLY_WORDS`. `stripSpokenInstructionLeaks` drops spaced control labels such as `CATALOGUE MOUTH` before TTS, with or without a colon. A catalogue ask is public in a mixed sw/en turn as well as in English, and that packet is committed before the name ask. A post-gen mouth cannot replace an unsaid public list with a closer. A spoken offer or question is not stripped, and that offer is the pending ask a short yes (`sawa`, `yes`, `ok`, `ndio`) resolves. A tool-only Gemini turn speaks the tool outcome, not hear-again. Soniox `enable_language_identification` tags set the call language, with Kiswahili keywords when the tags are empty. Gemini catalogue flags stay off. Early flush stays 0. A hyphen, en dash, or to, hadi, or mpaka span in the tenant file grounds both numbers. A spoken note for the team, including a statement, is the pending offer in any supported language, and a short yes while that offer is open is consent. A coverage answer for an area outside the list ends with that note question in the caller's language, and a list on file is never described as missing. A joined place token and a locative -ni bind to that place. ndani and kwako are not places. A final in the short post-close window merges into the next caller turn. A dropped sentence records its reason, and a price range is not stored as a phone.

3. **Punctuation.** `prepareForTts` strips commas, periods, question marks, dashes, and ellipses before Soniox chunks. Intra-word hyphens in say-forms stay. Soniox must not read those marks aloud in English or Kiswahili. A serial list (catalogue or any other tenant) is joined with `and` or `na` first, so stripping the commas does not turn the names into one run-on. The catalogue emitter uses that conjunction only before the last name: Kiswahili and Sheng `na`, English `and`. The spoken name is the service name. Notes and parentheses stay off that line. `paceSpokenLists` does not treat a trailing `, na zingine` or `, and more` as the list conjunction when the names already use `, and` or `, na`, and it does not rejoin an item that already contains `and` or `na`. A catalogue turn does not `pushText` once per period or question mark. The local line is one `speakText`. Gemini does not speak that list, so the turn does not arm `catalogueBreath`.

4. **Tool hold.** A line from `src/speech/toolHold.js` plays only after a tool call has started. English and Kiswahili packs rotate from the call id and turn count. Each line is at most about five words and states no job status. After the tool returns, write tools still use the existing confirmation. A file read (`open_items`, `file_lookup`, `get_enquiry`) speaks that result, or the empty-file line when `nameConfirmed` is true and the result is empty. No tool means no hold. Barge-in cancels the hold follow-up.

5. **Brain END.** When `nextBestAction` is `END` and no public SpeakPacket is still unsaid, `runBrainEndClose` in `src/speech/callClose.js` closes the idle nudge, speaks one farewell in the call language (`Asante. Kwaheri.` or `Thank you. Goodbye.`), then closes the media socket with `end_call`. `farewellHangupDelayMs` waits out PCM that is still queued on the bridge, so the last word is not cut. Gemini does not run on that turn. An idle nudge armed earlier does not fire. A later caller flush does not start another turn. Brain still decides when the action is `END`. An unsaid public packet speaks on that turn instead of the farewell, and the call stays up.

6. **Line check.** While a question is still waiting (`lastAgentAskedQuestion`), a bare `hello` / `hi` / `hey` is `hear_again` in `decideCallerEvent`. The media path replays the committed ask. It is not a soft backchannel. The same words with no question waiting stay `backchannel` and `ignore`. `callerEventClearsIdle` leaves the idle nudge armed on an ignore or a skip that does not queue and does not replay. After a question replay, the nudge is armed again.

Land this with Brain #586 (`cursor/caller-file-goal-summary-4c74`). Do not rewrite `docs/product/CALLER_FILE_MODEL.md` or `docs/agents/CALLER_IDENTITY_AND_SUMMARY.md` here. Stack with #584 if that pull request is still open. On merge, keep `flushUtterance(decision)` so `decision.unfinished` is not dropped.

## Test gate (required before PR)

```bash
npm run test:voice
```

Runs: TTS normalize → spoken stream buffer → turn-taking → wiring, then the voice eval gate (`npm run test:voice-eval`).

Tracing and the regression scorecard: [`VOICE_TRACING_AND_EVAL.md`](./VOICE_TRACING_AND_EVAL.md). Apply [`docs/supabase/voice_turn_traces.sql`](../supabase/voice_turn_traces.sql) by hand on staging before traces persist. The writer does not throw if the table is missing.

For media/webhook local bring-up: `npm start` + `npm run tunnel:cloudflared` (see `docs/operations/WEBHOOK_TUNNEL.md`).

Staging DID tests require the pull request on Railway staging first. Opening a pull request into `main` runs `.github/workflows/stage-pull-request.yml`, which rebuilds `cursor/staging-voice-468b` as `main` plus every open pull request, including one that targets another feature branch. That stacked pull request joins on the next rebuild. Confirm `GET /healthz` `gitSha` is that staging tip. Closing the pull request takes it off the practice line. A one-off deploy can still use `.github/workflows/staging-voice-deploy.yml`. Merge to `main` only after that staging call.

Gemini 3 Flash turns must replay model `parts` (including thought signatures) on the next request. Do not flatten signed parts into one text part, and do not speak a canned booking line to hide a failed Gemini turn. If Gemini is down (403/429 billing), ask for a name and take a callback. Do not invent a booking. Do not retry depleted credits.

## Chat starter (paste into new Voice chats)

```
You are the Scalers Voice lane agent.
Follow docs/agents/VOICE.md and .cursor/rules/voice.mdc.
Only change speech/media/turn-taking paths.
Do not edit dashboard/, docs/supabase/, or rewrite prompt policy.
Run npm run test:voice before finishing.
Task: <one concrete voice bug or improvement>
```

## Speed & consistency

Program plan: [`VOICE_SPEED_CONSISTENCY.md`](./VOICE_SPEED_CONSISTENCY.md)  
Target: first audible audio usually **≤ 800–1200 ms** after the caller stops, with stable pacing.

## Naturalness (roboticness)

Do not crank TTS speed to sound more human. Freeze `/healthz` `gitSha` + `voiceProfile`, run three scripted DID listens, score Voice IDs V1–V9 as pass/fail from recording + transcript + `spoken=` logs.

Protocol: [`VOICE_NATURALNESS.md`](./VOICE_NATURALNESS.md). Scanner: `node scripts/score-voice-naturalness.js --file turns.json`. Isolated-string listen pass remains `npm run tts:listen-harness`.

OSS setups that already sound human, and which pieces transfer onto Soniox: [`../specs/voice-human-naturalness-research.md`](../specs/voice-human-naturalness-research.md). Same note maps start-of-call pace, cross-call speed, instruction leaks, quality drift, and sentence-only flush. Do not crank speed from that note. Do not enable `VOICE_STREAM_EARLY_*`.

## Good first tickets

- Staging spike: Stream-stop → `<Dial>` (see [`../LIVE_TRANSFER.md`](../product/LIVE_TRANSFER.md) Spike 0). Do not enable `liveTransfer` until that spike is green.
- Phase 2 from `VOICE_SPEED_CONSISTENCY.md` (media clear, interim barge, cached ack PCM)
- Kenya TTS pronunciation edge cases (money, names, Sheng)
- Extract media session from `server.js` toward `src/telephony/mediaStreamHandler.js` without behavior change
