---
owner: ops-billing
last_reviewed: 2026-10-14
---

# Runbook: `pool_empty` alert

> **Stub (2026-10-14).** Owner lane fills in exact steps after the next real alert. Format: symptom → check → fix → escalate → rollback.

## Symptom

Desk ops notice: no available DIDs and at least one business waiting for a number.

## Check

- Admin › Numbers.
- Is it prod or staging? Prod Voice `scalers-project-production.up.railway.app`, staging `scalers-staging-staging.up.railway.app`.

## Likely causes and fix

- Buy/prepare DIDs and add to pool: [`../how-to/PRODUCTION_DID_POOL.md`](../how-to/PRODUCTION_DID_POOL.md). Never use `+254709221536`.
- TODO(ops-billing): exact fix steps.

## Escalate

- Prod writes, env changes, restarts or top-ups need Alvin's explicit yes.
- TODO(ops-billing): who to page and where.

## Rollback / recovery

- Voice clears the alert itself on recovery (`notePlatformOpsRecovered`). Desk notices resolve in Super Admin.
- TODO(ops-billing): rollback steps.
