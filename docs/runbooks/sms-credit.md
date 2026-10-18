---
owner: ops-billing
last_reviewed: 2026-10-18
---

# Runbook: `sms_credit` alert

Staff notice from the ops cron. Not an owner or caller message.

## Symptom

Admin shows SMS. The notice says credits are below the warn line (default 100), at or below the critical line (default 20), or at 0.

## Check

- The cron reads getbalance on the server. It does not use the public Voice health URL.
- `OPS_SMS_CREDIT_WARN_BELOW` and `OPS_SMS_CREDIT_CRITICAL_AT` on Desk. Unset means 100 and 20.
- Prod and staging share one SMS account. A staging notice is about that shared balance.

## Likely causes and fix

- Top up the SMS account. Alvin does that. This repo does not move money.
- A failed probe does not alert and does not clear an open notice.

## Escalate

- Top-ups, env changes, and production mail need Alvin's explicit yes.

## Rollback / recovery

- The notice re-arms when a later reading is above that level. It does not send a recovery mail.
- A failed recovery mail is not retried. The notice is already resolved.
- Stopping the pass is `OPS_ALERTS_DRY_RUN` left unset (dry run) or removing `CRON_SECRET`. Staging never sends. Contract: [`OPS_ALERTS_ENDPOINT.md`](../reference/operations/OPS_ALERTS_ENDPOINT.md).
