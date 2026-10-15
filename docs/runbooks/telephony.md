---
owner: ops-billing
last_reviewed: 2026-10-14
---

# Runbook: `telephony` alert

> **Stub (2026-10-14).** Owner lane fills in exact steps after the next real alert. Format: symptom → check → fix → escalate → rollback.

## Symptom

SautiKit wallet probe says billing exhausted (`notePlatformOpsDegrade('telephony')` from `src/sautikit/walletProbe.js`).

## Check

- Admin › Telecom wallet balance; `/healthz` telephony health.
- Is it prod or staging? Prod Voice `scalers-project-production.up.railway.app`, staging `scalers-staging-staging.up.railway.app`.

## Likely causes and fix

- Top up SautiKit prod workspace `e0e57aa5` (Alvin). #616 rejects inbound at zero.
- TODO(ops-billing): exact fix steps.

## Escalate

- Prod writes, env changes, restarts or top-ups need Alvin's explicit yes.
- TODO(ops-billing): who to page and where.

## Rollback / recovery

- Voice clears the alert itself on recovery (`notePlatformOpsRecovered`). Desk notices resolve in Super Admin.
- TODO(ops-billing): rollback steps.
