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
10. Filler cancel must target **only** the filler `stream_id` (plus generation bump). Never `tts.cancel()` with no id while a reply stream is prefetched.
11. Soniox **402 billing exhausted** is a speech-provider outage, not a turn-policy miss. Play the catalog-voice downtime recording (same voice as that line's greeting), hang up, and surface `soniox.lastError` plus `soniox.outageClips` on `/healthz`. Key clips by catalog voice × language. Keep the spoken line voice-generic. Alert each owner at most once per cooldown. See [`VOICE_DOWNTIME_AT_SCALE.md`](./VOICE_DOWNTIME_AT_SCALE.md).
12. Gemini **credits depleted / denied** is a reasoning outage, not speech. STT and TTS still work. Keep the line open, ask for a name, save it, and alert the owner once per cooldown. Surface `gemini.lastError` on `/healthz`. Do not retry depleted credits on the next turn.
13. SautiKit / DID down is a **telephony** outage. No webhook reaches Voice. Do not try to speak. Follow the bridge playbook in [`VOICE_DOWNTIME_AT_SCALE.md`](./VOICE_DOWNTIME_AT_SCALE.md#telephony-down-bridge-playbook): notify owner once, forward or re-point the DID, verify one test call before marking it back.
14. A presented number that matches no business is rejected with `<Reject/>`. Do not answer as another tenant. The first-active-tenant fallback runs only when the webhook carried no number. `TENANT_ID` still pins a single-tenant host.

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

2. **Speak gate.** `gateCallerFileSpeech` runs before TTS. Open rows, a vocative file name, and `Yes, {name}` stay quiet until `caller.nameConfirmed` is true. A parallel `speaker` object does not override that flag. The identity ask may say the pending name, and `lockFileNameAsk` speaks it in the caller's current language. Voice does not set `nameConfirmed`. When the name ask takes the turn, `linesBeforeNameAsk` speaks a public local answer first (catalogue, hours, coverage, identity) and the name ask last. That answer is not dropped. A booking ladder and an open file row are not spoken there. Gemini still owns the catalogue when the name ask does not take the turn.

3. **Punctuation.** `prepareForTts` strips commas, periods, question marks, dashes, and ellipses before Soniox chunks. Intra-word hyphens in say-forms stay. Soniox must not read those marks aloud in English or Kiswahili.

4. **Tool hold.** A line from `src/speech/toolHold.js` plays only after a tool call has started. English and Kiswahili packs rotate from the call id and turn count. Each line is at most about five words and states no job status. After the tool returns, write tools still use the existing confirmation. A file read (`open_items`, `file_lookup`, `get_enquiry`) speaks that result, or the empty-file line when `nameConfirmed` is true and the result is empty. No tool means no hold. Barge-in cancels the hold follow-up.

5. **Brain END.** When `nextBestAction` is `END`, `runBrainEndClose` in `src/speech/callClose.js` closes the idle nudge, speaks one farewell in the call language (`Asante. Kwaheri.` or `Thank you. Goodbye.`), then closes the media socket with `end_call`. Gemini does not run on that turn. An idle nudge armed earlier does not fire. A later caller flush does not start another turn.

6. **Line check.** While a question is still waiting (`lastAgentAskedQuestion`), a bare `hello` / `hi` / `hey` is `hear_again` in `decideCallerEvent`. The media path replays the committed ask. It is not a soft backchannel. The same words with no question waiting stay `backchannel` and `ignore`. `callerEventClearsIdle` leaves the idle nudge armed on an ignore or a skip that does not queue and does not replay. After a question replay, the nudge is armed again.

Land this with Brain #586 (`cursor/caller-file-goal-summary-4c74`). Do not rewrite `docs/product/CALLER_FILE_MODEL.md` or `docs/agents/CALLER_IDENTITY_AND_SUMMARY.md` here. Stack with #584 if that pull request is still open. On merge, keep `flushUtterance(decision)` so `decision.unfinished` is not dropped.

## Test gate (required before PR)

```bash
npm run test:voice
```

Runs: TTS normalize → spoken stream buffer → turn-taking → wiring.

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
