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
| `tests/spokenStreamBuffer.test.js` | LLM→TTS chunking tests |
| `tests/voiceWiring.test.js` | Static wiring checks for runtime voice paths |
| `.env.example` | Voice/Soniox/turn-taking env knobs only |
| `docs/WEBHOOK_TUNNEL.md` | Local tunnel for SautiKit media |
| `docs/agents/VOICE_DOWNTIME_AT_SCALE.md` | Multi-tenant speech-outage contract |

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
8. Greeting must await tenant profile + TTS ready — never speak a default-name opener, and never call `speakText` while `tts` is still null. TTS connect runs in parallel with tenant fetch.
9. Action turns (`CREATE_REQUEST` / `CAPTURE` / `ESCALATE` / `TRANSFER`) speak an immediate progress line before Gemini+tools; do not leave dead air. `TRANSFER` / `liveTransfer` is **not** executable until conference REST in [`../LIVE_TRANSFER.md`](../LIVE_TRANSFER.md) rings a human and `VOICE_LIVE_TRANSFER=on`. Do not close Stream for cold Dial. Do not claim a bridge from the media loop. SautiKit outbound cost is KES 3/min answered; tenant outbound is KES 4/min (Ops owns rates).
10. Filler cancel must target **only** the filler `stream_id` (plus generation bump). Never `tts.cancel()` with no id while a reply stream is prefetched.
11. Soniox **402 billing exhausted** is a speech-provider outage, not a turn-policy miss. Play the catalog-voice downtime recording (same voice as that line's greeting), hang up, and surface `soniox.lastError` plus `soniox.outageClips` on `/healthz`. Key clips by catalog voice × language. Keep the spoken line voice-generic. Alert each owner at most once per cooldown. See [`VOICE_DOWNTIME_AT_SCALE.md`](./VOICE_DOWNTIME_AT_SCALE.md).
12. Gemini **credits depleted / denied** is a reasoning outage, not speech. STT and TTS still work. Keep the line open, ask for a name, save it, and alert the owner once per cooldown. Surface `gemini.lastError` on `/healthz`. Do not retry depleted credits on the next turn.
13. SautiKit / DID down is a **telephony** outage. No webhook reaches Voice. Do not try to speak. Follow the bridge playbook in [`VOICE_DOWNTIME_AT_SCALE.md`](./VOICE_DOWNTIME_AT_SCALE.md#telephony-down-bridge-playbook): notify owner once, forward or re-point the DID, verify one test call before marking it back.

## Env knobs (Voice)

See `.env.example` — key ones:

## Env knobs (Voice)

See `.env.example` — key ones:

- `SONIOX_API_KEY`, `SONIOX_SAMPLE_RATE` (curated voices: voice engine `src/data/soniox-voices.json`, desk mirror `dashboard/src/data/soniox-voices.json`; per-tenant pick in `tenants.soniox_voice_id`)
- `SONIOX_STT_CONTEXT` (per-tenant vocabulary; default on), `SONIOX_STT_CONTEXT_MAX_TERMS`
- `VOICE_GREETING_MODE`, `VOICE_FILLER`, `VOICE_FILLER_DELAY_MS`, `VOICE_FILLER_CACHE`
- `VOICE_LLM_STREAM`, `VOICE_FLUSH_MIN_MS`, `VOICE_FLUSH_MAX_MS`
- `VOICE_BARGE_GRACE_MS`, `VOICE_BARGE_EARLY_MS`, `VOICE_BARGE_MIN_CHARS`
- Soniox endpointing: `SONIOX_MAX_ENDPOINT_DELAY_MS`, `SONIOX_ENDPOINT_SENSITIVITY`, …

## Test gate (required before PR)

```bash
npm run test:voice
```

Runs: TTS normalize → spoken stream buffer → turn-taking → wiring.

For media/webhook local bring-up: `npm start` + `npm run tunnel:cloudflared` (see `docs/WEBHOOK_TUNNEL.md`).

Staging DID tests require the PR commit on Railway staging first. Run `.github/workflows/staging-voice-deploy.yml`, then confirm `GET /healthz` `gitSha`. Do not merge to `main` to get a Voice test.

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

## Good first tickets

- Staging spike: Stream-stop → `<Dial>` (see [`../LIVE_TRANSFER.md`](../LIVE_TRANSFER.md) Spike 0). Do not enable `liveTransfer` until that spike is green.
- Phase 2 from `VOICE_SPEED_CONSISTENCY.md` (media clear, interim barge, cached ack PCM)
- Kenya TTS pronunciation edge cases (money, names, Sheng)
- Extract media session from `server.js` toward `src/telephony/mediaStreamHandler.js` without behavior change
