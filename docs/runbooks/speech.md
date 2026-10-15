---
owner: platform
last_reviewed: 2026-10-14
---

# Runbook: `speech` alert

> **Stub (2026-10-14).** Owner lane fills in exact steps after the next real alert. Format: symptom → check → fix → escalate → rollback.

## Symptom

Soniox STT/TTS degraded (Voice `notePlatformOpsDegrade('speech')` from `src/speech/sonioxProviderHealth.js`; Desk notice kind `speech`).

## Check

- `/healthz` → `soniox.lastError`, `billingExhausted`. Railway Voice logs `[platform-ops] alerted kind=speech`.
- Is it prod or staging? Prod Voice `scalers-project-production.up.railway.app`, staging `scalers-staging-staging.up.railway.app`.

## Likely causes and fix

- Soniox billing/credits; outage clips play (`outageClips`). See [`../explanation/voice/VOICE_DOWNTIME_AT_SCALE.md`](../explanation/voice/VOICE_DOWNTIME_AT_SCALE.md).
- TODO(platform): exact fix steps.

## Escalate

- Prod writes, env changes, restarts or top-ups need Alvin's explicit yes.
- TODO(platform): who to page and where.

## Rollback / recovery

- Voice clears the alert itself on recovery (`notePlatformOpsRecovered`). Desk notices resolve in Super Admin.
- TODO(platform): rollback steps.
