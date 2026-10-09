# Platform ops alerts (speech | reasoning | telephony)

**Lane:** Voice  
**Owner path unchanged:** `src/speech/speechOutageNotify.js` (per-tenant owner SMS once per cooldown)

## Problem

Owners already get one downtime SMS per business. Scalers ops still learned about platform speech, reasoning, or telephony failures too late (for example Soniox 402 mid-call).

## What fires

| Kind | Detect | Hook |
| --- | --- | --- |
| `speech` | Soniox STT/TTS billing exhausted | `noteSonioxProviderError` → `notePlatformOpsDegrade('speech')` |
| `reasoning` | Gemini credits depleted or denied | `noteGeminiProviderError` → `notePlatformOpsDegrade('reasoning')` |
| `telephony` | SautiKit wallet empty or HTTP 402 on `/v1/wallet` | `probeSautikitWallet` on boot + interval |

One alert per kind while that lane stays degraded. Cooldown backstop: `VOICE_PLATFORM_OPS_COOLDOWN_MS` (default 1800000). Recovery clears the latch so a later incident can alert again.

## Recipients

**Email only for now.** No SMS or WhatsApp for platform ops alerts.

1. **Super Admin list (source of truth).** Voice reads `public.platform_ops_settings` (row `id = 1`): `people[].email` first, else the `emails` array. Same rule as Desk `loadOpsSettings`. SQL: `docs/supabase/platform_ops_notices.sql` then `platform_ops_people.sql`. Read through the Voice service-role client, cached `VOICE_PLATFORM_OPS_RECIPIENTS_CACHE_MS` (default 180000, 3 minutes), so an Admin edit reaches Voice within a few minutes without a redeploy.
2. **Fallback.** `SCALERS_OPS_ALERT_EMAILS` on Voice when the table is missing, the Admin list is empty, or the read fails (a warning names the error).
3. **Empty.** If both are empty, Voice logs `[platform-ops] ops alert list is EMPTY` and the alert reaches nobody.

`SCALERS_OPS_ALERT_PHONES` and Admin phone numbers are ignored for now. Code: `src/notifications/platformOpsRecipients.js`. Dispatch: `dispatchToStaff` with `{ sms: false, whatsapp: false, email: true }`. Ledger kinds: `platform_ops_speech`, `platform_ops_reasoning`, `platform_ops_telephony` (platform-billed).

## Health surface (Desk Platform board)

`GET /healthz`:

- `soniox.lastError`, `gemini.lastError`, `telephony.lastError`
- `platformOps.dryRun`, `platformOps.cooldownMs`

## Staging proof

1. Add an email under Super Admin Escalate on staging (or set `SCALERS_OPS_ALERT_EMAILS` on staging Voice).
2. Option A — dry-run: `VOICE_PLATFORM_OPS_DRY_RUN=true`, trigger Soniox 402 or:
   ```bash
   curl -sS -X POST "$VOICE_HOST/internal/platform/ops-alert" \
     -H "x-voice-internal-secret: $VOICE_INTERNAL_SECRET" \
     -H 'content-type: application/json' \
     -d '{"kind":"speech","message":"staging probe"}'
   ```
   Check Railway logs for `[platform-ops] DRY_RUN`.
3. Option B — live once: same curl without dry-run; confirm one email/SMS to the ops list.

Telephony wallet: `POST /internal/telephony/wallet-probe` with the same secret.

**Staging PASS ≠ prod GO.** Prod needs the same env vars and Alvin sign-off.

## Out of scope

- Public status page
- Per-call ops SMS
- Merging into owner `speechOutageNotify`

## Desk scheduled check (Admin notices)

Separate from the Voice alerts above. Desk opens and resolves `platform_ops_notices` and emails the Admin list from a Vercel cron, not from page load.

- Route: `dashboard/src/app/api/cron/ops-alerts/route.ts`, scheduled `*/10 * * * *` in `dashboard/vercel.json`. Vercel runs crons on the production deployment of each project only.
- Auth: `Authorization: Bearer $CRON_SECRET`. No `CRON_SECRET` (or one under 16 characters) means every call gets 401.
- Once per notice: the run claims `notified_at` (null to now) before it sends; a failed send releases the claim. Recovery mail goes once, from the run that resolves the notice, and only if the opening alert was sent. Acked notices are not mailed.
- Dry run: `OPS_ALERTS_DRY_RUN` unset or anything but `false` sends nothing and claims nothing, so the first live run still sends each open notice once. Missing `RESEND_API_KEY` / `OPS_EMAIL_FROM` also counts as dry run.
- Recipients: `platform_ops_settings` row only (people emails, else `emails`). No `SCALERS_OPS_ALERT_EMAILS` fallback here.
- Admin Today and Platform only read notices; neither sends.
