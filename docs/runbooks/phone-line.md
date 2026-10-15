---
owner: platform
last_reviewed: 2026-10-14
---

# Runbook: `phone_line` alert

> **Stub (2026-10-14).** Owner lane fills in exact steps after the next real alert. Format: symptom → check → fix → escalate → rollback.

## Symptom

Desk ops notice: phone line health is "attention" (`dashboard/src/lib/platformOpsModel.ts` kind `phone_line`).

## Check

- Super Admin Today/ops strip; SautiKit number webhooks point at the right Railway host.
- Is it prod or staging? Prod Voice `scalers-project-production.up.railway.app`, staging `scalers-staging-staging.up.railway.app`.

## Likely causes and fix

- Webhook URL drift; SautiKit outage.
- TODO(platform): exact fix steps.

## Escalate

- Prod writes, env changes, restarts or top-ups need Alvin's explicit yes.
- TODO(platform): who to page and where.

## Rollback / recovery

- Voice clears the alert itself on recovery (`notePlatformOpsRecovered`). Desk notices resolve in Super Admin.
- TODO(platform): rollback steps.
