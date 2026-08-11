# Voice lane contract

**Mission:** Make live phone calls sound fast, natural, and interruptible on Kenya telephony (SautiKit + Soniox).

Use this when the task is about audio path, latency, barge-in, fillers, TTS pronunciation plumbing, or media WebSockets — not dashboard UI or wallet product rules.

## Owns (edit freely)

| Path | Role |
| --- | --- |
| `server.js` | Media WS (`/ws/media`), inbound Stream XML wiring, speak/barge/filler/stream turn loop |
| `src/speech/**` | Soniox STT/TTS, turn-taking, spoken buffer, TTS normalize, lexicon, Sheng rewrite |
| `src/sautikit/**` | Webhook signature / guards used by voice HTTP |
| `tests/ttsNormalize.test.js` | TTS prep unit tests |
| `tests/turnTaking.test.js` | Endpoint / barge-in unit tests |
| `tests/spokenStreamBuffer.test.js` | LLM→TTS chunking tests |
| `tests/voiceWiring.test.js` | Static wiring checks for runtime voice paths |
| `.env.example` | Voice/Soniox/turn-taking env knobs only |
| `docs/WEBHOOK_TUNNEL.md` | Local tunnel for SautiKit media |

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

## Env knobs (Voice)

See `.env.example` — key ones:

- `SONIOX_API_KEY`, `SONIOX_VOICE`, `SONIOX_SAMPLE_RATE`
- `VOICE_GREETING_MODE`, `VOICE_FILLER`, `VOICE_FILLER_DELAY_MS`
- `VOICE_LLM_STREAM`, `VOICE_FLUSH_MIN_MS`, `VOICE_FLUSH_MAX_MS`
- `VOICE_BARGE_GRACE_MS`, `VOICE_BARGE_EARLY_MS`, `VOICE_BARGE_MIN_CHARS`
- Soniox endpointing: `SONIOX_MAX_ENDPOINT_DELAY_MS`, `SONIOX_ENDPOINT_SENSITIVITY`, …

## Test gate (required before PR)

```bash
npm run test:voice
```

Runs: TTS normalize → spoken stream buffer → turn-taking → wiring.

For media/webhook local bring-up: `npm start` + `npm run tunnel:cloudflared` (see `docs/WEBHOOK_TUNNEL.md`).

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

- Phase 2 from `VOICE_SPEED_CONSISTENCY.md` (media clear, interim barge, cached ack PCM)
- Kenya TTS pronunciation edge cases (money, names, Sheng)
- Extract media session from `server.js` toward `src/telephony/mediaStreamHandler.js` without behavior change
