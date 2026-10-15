---
owner: ops-billing
last_reviewed: 2026-10-14
---

# Runbook: `sautikit_low` alert

> **Stub (2026-10-14).** Owner lane fills in exact steps after the next real alert. Format: symptom → check → fix → escalate → rollback.

## Symptom

Desk ops notice: SautiKit wallet at or below `platform_ops_settings.sautikit_warn_minor` (default 50000 minor); critical when empty.

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

- Voice clears the alert itself on recovery (`notePlatformOpsRecovered`). Desk notices resolve in Super Admin.
- TODO(ops-billing): rollback steps.
