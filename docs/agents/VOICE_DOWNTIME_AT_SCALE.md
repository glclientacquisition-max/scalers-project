# Voice downtime at scale

**Lane:** Voice  
**Status:** Contract for platform outages when Scalers hosts many businesses  
**Companion:** [`SONIOX_BILLING_SILENCE_2026-09-02.md`](./SONIOX_BILLING_SILENCE_2026-09-02.md)

Two different platform failures share one rule: the caller dialed one business, and the owner should not get one text per call.

| Failure | What still works | Caller hears | Owner line |
| --- | --- | --- | --- |
| **Speech down** (Soniox 402 / fatal STT or TTS) | Nothing. Cannot hear or speak. | Catalog-voice clip: short downtime, call back. Hang up. | `{Business} line downtime. Callers heard a short message and were asked to call back.` |
| **Reasoning down** (Gemini credits 403/429, denied, timeout) | STT and TTS still work. | Live voice: "Okay, I can't finish that just now. May I have your name so I can reach them?" Save name. Confirm. | `{Business} line is taking names only. Callers are asked for a name so the team can call back.` |

Do not say Soniox, Gemini, billing, or "technical issue" to the caller. Do not invent a booking.

## Three audiences

| Who | Channel | Cadence | Job |
| --- | --- | --- | --- |
| Caller | Phone, that tenant's catalog voice | Every affected call | Speech down: hear the same person, call back, leave. Reasoning down: give a name, know the team will call back. |
| Owner | SMS, then WhatsApp, then email | Once per business per kind per cooldown (default 30 min), and only if a caller actually hit that DID | Know their line is degraded. Not one text per abandoned call. |
| Ops | `/healthz` + Railway logs | Once per process incident | See `soniox.lastError.billingExhausted`, `soniox.outageClips`, and `gemini.lastError`. |

## Speech down: caller line

Shared catalog voices serve many tenants. Agent names differ. Pre-rendered audio cannot say "this is Lynn" or name a shop.

Keep one voice-generic sentence:

- EN: `Hello. This line is on a short downtime. Please call back in a few minutes.`
- SW: `Habari. Simu hii ina downtime fupi. Tafadhali piga tena baada ya dakika chache.`

The caller already dialed that DID. Voice continuity is the identity. A wrong name is worse than no name.

English until the caller has spoken. Then match EN or SW. Hang up after the clip. STT is also dead, so do not ask for a name or take a callback.

## Reasoning down: caller line

STT and TTS are alive. Keep the line open. The same receptionist asks for a name and saves it.

- EN: `Okay, I can't finish that just now. May I have your name so I can reach them?`
- SW: `Sawa, siwezi kumaliza hiyo sasa hivi. Niambie jina lako ndio niwasiliane nao.`

After a name: `Okay, I have your name. I'll have the team reach you.` Do not promise a booking.

## Clip model (voice × language, not tenant × language)

Key clips by curated `soniox_voice_id` and language.

1. Boot warms the platform default voice only.
2. First live PCM for another catalog voice warms that voice (60s debounce).
3. Playback order: that voice's clip → default clone clip → espeak → Gemini TTS.
4. Packaged `src/speech/pcm/downtime-{en,sw}.wav` is the default clone only.

Do not render N tenants × 2 languages at boot. Do not bake `agent_name` into a clip.

## Owner line

`src/speech/speechOutageNotify.js` sends at most one alert per `tenant.id` per kind (`speech` or `llm`) per `VOICE_OUTAGE_OWNER_COOLDOWN_MS` (default 1800000). Claim the slot before send so two overlapping calls do not double-text.

No vendor names. No "add funds" (that is wallet, a different incident). Uses the tenant notify stack (SMS → WhatsApp → email).

## Ops

`GET /healthz`:

- `soniox.lastError.billingExhausted`
- `soniox.outageClips` (default voice ready flags plus per-voice map)
- `gemini.lastError` (`billingExhausted`, `denied`, last error kind)

Desk Super Admin banner and a public status page are **Desk / Ops** follow-ups. Voice does not add UI.

## What not to do

- Per-call owner SMS
- A unique downtime script per business
- Holding the caller for a human while speech is down
- Inventing a booking or a callback when STT cannot hear
- Retrying depleted Gemini credits on the next turn
