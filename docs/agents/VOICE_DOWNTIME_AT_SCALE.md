# Voice downtime at scale

**Lane:** Voice  
**Status:** Contract for live speech outages when Scalers hosts many businesses  
**Companion:** [`SONIOX_BILLING_SILENCE_2026-09-02.md`](./SONIOX_BILLING_SILENCE_2026-09-02.md)

Soniox STT/TTS use one platform key. A 402 or fatal speech error takes every live line down together. Callers still dial one business. Communication must stay correct for both facts.

## Three audiences

| Who | Channel | Cadence | Job |
| --- | --- | --- | --- |
| Caller | Phone, that tenant's catalog voice | Every affected call | Hear the same person as the greeting. Know to call back. Leave. |
| Owner | SMS, then WhatsApp, then email | Once per business per cooldown (default 30 min), and only if a caller actually hit that DID | Know their line played a downtime message. Do not get a text per abandoned call. |
| Ops | `/healthz` + Railway logs | Once per process incident | See `billingExhausted` and which catalog-voice clips are warm. |

Do not add a fourth voice (espeak or Gemini) unless no clone-voice clip exists. Do not say Soniox, billing, Scalers engineering, or "technical issue" to the caller.

## Caller line

Shared catalog voices serve many tenants. Agent names differ. Pre-rendered audio cannot say "this is Lynn" or name a shop.

Keep one voice-generic sentence:

- EN: `Hello. This line is on a short downtime. Please call back in a few minutes.`
- SW: `Habari. Simu hii ina downtime fupi. Tafadhali piga tena baada ya dakika chache.`

The caller already dialed that DID. Voice continuity is the identity. A wrong name is worse than no name.

English until the caller has spoken. Then match EN or SW. Hang up after the clip. STT is also dead, so do not ask for a name or take a callback.

## Clip model (voice × language, not tenant × language)

Key clips by curated `soniox_voice_id` and language.

1. Boot warms the platform default voice only.
2. First live PCM for another catalog voice warms that voice (60s debounce).
3. Playback order: that voice's clip → default clone clip → espeak → Gemini TTS.
4. Packaged `src/speech/pcm/downtime-{en,sw}.wav` is the default clone only.

Do not render N tenants × 2 languages at boot. Do not bake `agent_name` into a clip.

## Owner line

`src/speech/speechOutageNotify.js` sends at most one alert per `tenant.id` per `VOICE_OUTAGE_OWNER_COOLDOWN_MS` (default 1800000). Claim the slot before send so two overlapping calls do not double-text.

Copy:

`{Business} line downtime. Callers heard a short message and were asked to call back.`

No vendor names. No "add funds" (that is wallet, a different incident). Uses the tenant notify stack (SMS → WhatsApp → email).

## Ops

`GET /healthz`:

- `soniox.lastError.billingExhausted`
- `soniox.outageClips` (default voice ready flags plus per-voice map)

Desk Super Admin banner and a public status page are **Desk / Ops** follow-ups. Voice does not add UI.

## What not to do

- Per-call owner SMS
- A unique downtime script per business
- Holding the caller for a human while speech is down
- Inventing a booking or a callback when STT cannot hear
