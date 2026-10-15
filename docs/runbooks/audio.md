---
owner: voice
last_reviewed: 2026-10-14
---

# Runbook: `audio` alert

> **Stub (2026-10-14).** Owner lane fills in exact steps after the next real alert. Format: symptom → check → fix → escalate → rollback.

## Symptom

Line-unavailable clip upload to SautiKit failed (`notePlatformOpsDegrade('audio')` from `src/sautikit/lineUnavailableAudio.js`).

## Check

- Voice logs `upload failed:`; `/healthz` `outageClips`.
- Is it prod or staging? Prod Voice `scalers-project-production.up.railway.app`, staging `scalers-staging-staging.up.railway.app`.

## Likely causes and fix

- SautiKit `POST /v1/uploads/audio` errors; key scope.
- TODO(voice): exact fix steps.

## Escalate

- Prod writes, env changes, restarts or top-ups need Alvin's explicit yes.
- TODO(voice): who to page and where.

## Rollback / recovery

- Voice clears the alert itself on recovery (`notePlatformOpsRecovered`). Desk notices resolve in Super Admin.
- TODO(voice): rollback steps.
