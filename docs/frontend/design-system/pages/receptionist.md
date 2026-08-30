# Receptionist (existing fields only)

**Job:** Make the receptionist feel like an operational person, using data that already exists.  
**Not a new route in Phase 6 by default.** Prefer Settings Test + identity + Home “working” strip.

See [`MASTER.md`](../MASTER.md), [`settings.md`](./settings.md), [`home.md`](./home.md).

## Allowed sources

| Concept | Source |
| --- | --- |
| Name | `tenant.agent_name` |
| Voice | `soniox_voice_id` / label, Test preview |
| Languages | Product default (en / sw / sheng). No picker unless one exists |
| Knowledge | Catalog, FAQs, hours, locations (Settings) |
| Behavior | Tone, tools, handoff, after-hours |
| Escalation | Team directory |
| Line | `sautikit_virtual_number` (live vs `pending:`) |
| Ready | `assessMvpAnswerReadiness` |
| Test | `TestLinePanel` |

## Forbidden

- Online / last-seen pulse
- New backend controls
- A second settings IA

Phase 6 is a language and grouping pass on existing Test + identity, plus Home readiness. It is not a new product.
