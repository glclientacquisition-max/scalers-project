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

Comma-separated env on **Voice** (not tenant `team_directory`):

- `SCALERS_OPS_ALERT_PHONES` — E.164 or local Kenya numbers
- `SCALERS_OPS_ALERT_EMAILS` — ops inbox list

Uses the same channel ladder as other staff alerts (`dispatchToStaff`: SMS → WhatsApp → email). Ledger kinds: `platform_ops_speech`, `platform_ops_reasoning`, `platform_ops_telephony` (platform-billed).

## Health surface (Desk Platform board)

`GET /healthz`:

- `soniox.lastError`, `gemini.lastError`, `telephony.lastError`
- `platformOps.dryRun`, `platformOps.cooldownMs`

## Staging proof

1. Set `SCALERS_OPS_ALERT_EMAILS` (or phones) on staging Voice.
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
