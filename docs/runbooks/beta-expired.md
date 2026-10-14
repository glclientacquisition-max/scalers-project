---
owner: ops-billing
last_reviewed: 2026-10-14
---

# Runbook: `beta_expired` alert

> **Stub (2026-10-14).** Owner lane fills in exact steps after the next real alert. Format: symptom → check → fix → escalate → rollback.

## Symptom

Desk ops notice: one or more businesses whose beta ended.

## Check

- Admin › Businesses (beta end date).
- Is it prod or staging? Prod Voice `scalers-project-production.up.railway.app`, staging `scalers-staging-staging.up.railway.app`.

## Likely causes and fix

- Decide package or extension with Alvin.
- TODO(ops-billing): exact fix steps.

## Escalate

- Prod writes, env changes, restarts or top-ups need Alvin's explicit yes.
- TODO(ops-billing): who to page and where.

## Rollback / recovery

- Voice clears the alert itself on recovery (`notePlatformOpsRecovered`). Desk notices resolve in Super Admin.
- TODO(ops-billing): rollback steps.
