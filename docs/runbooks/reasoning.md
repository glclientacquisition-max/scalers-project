---
owner: brain
last_reviewed: 2026-10-14
---

# Runbook: `reasoning` alert

> **Stub (2026-10-14).** Owner lane fills in exact steps after the next real alert. Format: symptom → check → fix → escalate → rollback.

## Symptom

Gemini (LLM) degraded (`notePlatformOpsDegrade('reasoning')` from `src/conversation/geminiProviderHealth.js`; `llm` maps here; Desk notice `reasoning`).

## Check

- Railway Voice logs for Gemini errors; Google AI Studio status and quota.
- Is it prod or staging? Prod Voice `scalers-project-production.up.railway.app`, staging `scalers-staging-staging.up.railway.app`.

## Likely causes and fix

- Quota/billing on the Gemini key; provider outage.
- TODO(brain): exact fix steps.

## Escalate

- Prod writes, env changes, restarts or top-ups need Alvin's explicit yes.
- TODO(brain): who to page and where.

## Rollback / recovery

- Voice clears the alert itself on recovery (`notePlatformOpsRecovered`). Desk notices resolve in Super Admin.
- TODO(brain): rollback steps.
