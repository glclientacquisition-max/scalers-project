# Voice downtime at scale

**Lane:** Voice  
**Status:** Contract for platform outages when Scalers hosts many businesses  
**Companion:** [`SONIOX_BILLING_SILENCE_2026-09-02.md`](./SONIOX_BILLING_SILENCE_2026-09-02.md)

Three platform failures share one rule: the caller dialed one business, and the owner should not get one text per call.

| Failure | What still works | Caller hears | Owner line |
| --- | --- | --- | --- |
| **Speech down** (Soniox 402 / fatal STT or TTS) | Nothing. Cannot hear or speak. | Catalog-voice clip: short downtime, call back. Hang up. | `{Business} line downtime. Callers heard a short message and were asked to call back.` |
| **Reasoning down** (Gemini credits 403/429, denied, timeout) | STT and TTS still work. | Live voice: "Okay, I can't finish that just now. May I have your name so I can reach them?" Save name. Confirm. | `{Business} line is taking names only. Callers are asked for a name so the team can call back.` |
| **Telephony down** (SautiKit balance, DID suspended, webhook gone) | Nothing reaches Voice. No webhook, no `/ws/media`. | Carrier network message. We cannot speak. | `{Business} number is offline. We are restoring it.` |

Do not say Soniox, Gemini, SautiKit, billing, or "technical issue" to the caller. Do not invent a booking.

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

## Telephony down: bridge playbook

SautiKit is the SIP/webhook edge. When it stops, `POST /voice/incoming` never fires. Voice cannot answer with a clip because the call never reaches the process. The carrier message the caller hears is outside our control.

**Goal of the bridge:** keep the business reachable while the number is dead, and restore the number without a new DID for the owner to publish.

1. **Detect.** A missing `voice/incoming` on a live DID, a SautiKit 402 on admin actions, or a DID that stops routing is a telephony outage. `/healthz` cannot see it because no call arrives. Ops watches SautiKit balance and DID state.
2. **Tell the owner once.** Same cooldown as speech/llm (`speechOutageNotify`, kind `speech`). Line: `{Business} number is offline. We are restoring it.`
3. **Bridge the caller.** Point the affected DID's voice callback at a reachable fallback, or forward the number at the carrier. Options in order:
   - SautiKit account restored / balance topped up. Preferred. No caller-facing change.
   - Re-point the same DID to a backup voice URL on a second host that serves the same Stream XML. Caller keeps the same number.
   - Carrier-level forward from the dead DID to a working DID or the owner's mobile. Caller hears a ring, not downtime.
4. **Owner phone as last resort.** If no backup voice path exists, the owner alert includes a temporary contact line so the business can post it on WhatsApp status / door.
5. **Restore and verify.** One test call to the DID. Confirm `/ws/media` opens and the greeting plays before telling the owner it is back.

Do not keep a silent failed DID. Do not assign a new DID as the "fix" unless the old one is surrendered. `TELEPHONY_PROVIDER` failover is planned, not built.

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
- Answering a telephony outage with a spoken clip (no call reaches us)
- Handing the owner a new DID instead of restoring or forwarding the old one
