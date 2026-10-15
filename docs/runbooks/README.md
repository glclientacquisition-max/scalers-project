---
owner: ops-billing
last_reviewed: 2026-10-14
---

# Runbooks

One runbook per ops alert kind. Sources: Voice `src/notifications/platformOpsAlert.js` kinds (`speech`, `reasoning` (`llm`), `telephony`, `audio`) and Desk `platform_ops_settings.kinds` / `dashboard/src/lib/platformOpsModel.ts` (`speech`, `reasoning`, `phone_line`, `sautikit_low`, `pool_empty`, `beta_expired`). Owner wallet notifications (`wallet_low`, `wallet_empty`) go to business owners, not ops, and have no runbook.

| Alert kind | Runbook | Owner |
| --- | --- | --- |
| `speech` | [`speech.md`](speech.md) | platform |
| `reasoning` | [`reasoning.md`](reasoning.md) | brain |
| `telephony` | [`telephony.md`](telephony.md) | ops-billing |
| `audio` | [`audio.md`](audio.md) | voice |
| `phone_line` | [`phone-line.md`](phone-line.md) | platform |
| `sautikit_low` | [`sautikit-low.md`](sautikit-low.md) | ops-billing |
| `pool_empty` | [`pool-empty.md`](pool-empty.md) | ops-billing |
| `beta_expired` | [`beta-expired.md`](beta-expired.md) | ops-billing |

Adding an alert kind? Add its runbook in the same PR.
