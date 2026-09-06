# ADR-0004 — Live human transfer via cold Dial after Stream stop

## Status

**Proposed**

## Context

Owners want some calls forwarded to a real person instead of a WhatsApp/SMS callback. Scalers already implements **async escalation** (name + reason → `team_directory` → notify → honest confirm). Brain already has a `TRANSFER` action, but Voice hardcodes `liveTransfer: false` because there is no executor on the SautiKit Stream path.

SautiKit supports `<Dial>` to E.164 (same destination authorization as `POST /v1/calls`) and re-invokes `voice_callback_url` when a Stream starts or stops. The current handler returns empty XML on those edges so a second `<Stream/>` does not re-fork the call.

Warm transfer via Conference plus an outbound agent leg is documented by SautiKit but costs a second PSTN call and needs hold/whisper behavior the media loop does not have.

## Decision

1. Keep **callback escalate** as the default product (`handoff_mode = callback`).
2. Implement **v1 live transfer** as a **cold Dial**: stop `/ws/media`, then on StreamStopped return `<Dial>` to one directory mobile. CallerId is the tenant DID.
3. Enable the Brain `liveTransfer` capability only when a global env flag, tenant preference, open hours, and a valid directory E.164 all pass. Preference alone never claims a transfer.
4. Always persist escalate + best-effort SMS **before** Dial so a missed ring is still a known lead.
5. On Dial failure, `<Say>` + hangup. Do not re-open Stream in v1.
6. Defer warm conference / whisper / DTMF 0 to v2.

Canonical spec: [`../LIVE_TRANSFER.md`](../LIVE_TRANSFER.md).

## Alternatives considered

| Alternative | Why not for v1 |
| --- | --- |
| Stay on async escalate only | Does not meet the “forward the live call” request |
| Warm conference + outbound `POST /v1/calls` | Better briefing UX; higher cost and orchestration risk before Dial is proven |
| Twilio-style WS `transfer` message | Production telephony is SautiKit Stream, not ConversationRelay |
| Dial while Stream is still connected | Undocumented; risk of mixed audio and double media |
| Model-supplied phone numbers | Hallucination / toll-fraud risk; directory only |
| Auto-enable for all tenants with a team phone | Breaks one-person shops that cannot pick up |

## Consequences

- Voice must change `/voice/incoming` skip-stream behavior: empty Response **or** Dial/Say, never a surprise second Stream.
- A **lab spike** on staging is mandatory before `VOICE_LIVE_TRANSFER=on`. If WS close hangs up the caller, this ADR is revisited (Redirect or conference).
- Ops must confirm Dial destinations are authorized and that wallet events cover the outbound leg.
- Desk copy must stay honest until the executor and flag are on.
- Multiple lanes are involved; ship as sequenced PRs (Platform → Voice → Brain → Desk → Ops), not one mixed PR.

## Date

2026-09-06

## Related systems

- `server.js` `/voice/incoming`, `/ws/media`
- `src/conversation/brainPolicy.js`, `nextBestAction.js`, `escalation.js`
- `tenants.handoff_mode`, `tenants.team_directory`
- [`../ESCALATION.md`](../ESCALATION.md)
- SautiKit Dial: https://sautikit.com/developers/voice-actions/dial
