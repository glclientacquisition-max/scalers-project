---
owner: ops-billing
last_reviewed: 2026-10-18
---

# Runbook: `sautikit_low` alert

> **Stub (2026-10-14).** Owner lane fills in exact steps after the next real alert. Format: symptom → check → fix → escalate → rollback.

## Symptom

Desk ops notice. The phone wallet crossed a threshold (default KES 500 and KES 100, plus Admin low-money). An empty wallet is one notice. A repeat reading does not open another. The notice stays open until the balance is above the threshold plus 10 percent (`OPS_ALERTS_REARM_MARGIN`, default 0.10). Voice calls `GET /api/cron/ops-alerts` ([contract](../reference/operations/OPS_ALERTS_ENDPOINT.md)).

## Check

- Admin › Telecom wallet.
- Is it prod or staging? Prod Voice `scalers-project-production.up.railway.app`, staging `scalers-staging-staging.up.railway.app`.

## Likely causes and fix

- Top up before it reaches zero.
- TODO(ops-billing): exact fix steps.

## Escalate

- Prod writes, env changes, restarts or top-ups need Alvin's explicit yes.
- TODO(ops-billing): who to page and where.

## Rollback / recovery

- Voice clears its own speech and reasoning mail on recovery (`notePlatformOpsRecovered`). Desk does not send those. Desk wallet notices resolve when the balance is above the recovery line.
- A failed recovery mail is not retried. The notice is already resolved. The next time the balance crosses down, a new notice can mail.
- TODO(ops-billing): rollback steps.
