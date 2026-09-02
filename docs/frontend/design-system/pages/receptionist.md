# Business Assistant (existing fields only)

**Job:** Make the Business Assistant feel like an operational person, using data that already exists.  
**Not a new route.** Prefer Settings Test + identity + Home line strip.

See [`MASTER.md`](../MASTER.md), [`settings.md`](./settings.md), [`home.md`](./home.md), [`BUSINESS_ASSISTANT_LANGUAGE_SYSTEM.md`](../../BUSINESS_ASSISTANT_LANGUAGE_SYSTEM.md).

Receptionist is a possible spoken role and a possible default `agent_name`. It is not the product name.

## Allowed sources

| Concept | Source |
| --- | --- |
| Name | `tenant.agent_name` |
| Voice | `soniox_voice_id` / label, Test preview |
| Languages | Product default (en / sw / sheng). No picker unless one exists |
| Knowledge | Catalog, FAQs, hours, locations (Settings) |
| Behavior | Tone, tools, when a human is needed, after-hours |
| Escalation | Team directory |
| Line | `sautikit_virtual_number` (live vs `pending:`) |
| Ready | `assessMvpAnswerReadiness` |
| Test | `TestLinePanel` |

## Forbidden

- Online / last-seen pulse
- New backend controls
- A second settings IA
- Capability matrix
- Assistant avatar, orb, or waveform

Phase 7 is a language pass on existing Test + identity + Home readiness. It is not a new product.
