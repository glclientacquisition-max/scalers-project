# Platform ops alerts — Voice slice acceptance

**Date:** 2026-10-02  
**Lane:** Voice (Slice B)  
**Staging PASS ≠ prod GO**

## Automated

```bash
npm run test:soniox-errors
npm run test:wiring
```

Covers cooldown per kind, dry-run mode, Soniox billing hook, telephony wallet probe, and `/healthz` telephony + `platformOps` fields.

## Staging dry-run (once)

On staging Voice Railway:

1. Set `SCALERS_OPS_ALERT_EMAILS` (or phones) to the ops list.
2. Set `VOICE_PLATFORM_OPS_DRY_RUN=true`.
3. Redeploy, then:

```bash
curl -sS -X POST "https://scalers-staging-staging.up.railway.app/internal/platform/ops-alert" \
  -H "x-voice-internal-secret: $VOICE_INTERNAL_SECRET" \
  -H 'content-type: application/json' \
  -d '{"kind":"speech","message":"staging acceptance probe"}'
```

Expect JSON `ok: true`, `channel: dry_run`. Railway log line: `[platform-ops] DRY_RUN kind=speech`.

4. Confirm `GET /healthz` includes `telephony.lastError` and `platformOps.dryRun: true`.

## Prod

Requires Alvin GO, ops env on production Voice, and `VOICE_PLATFORM_OPS_DRY_RUN` unset or false.
