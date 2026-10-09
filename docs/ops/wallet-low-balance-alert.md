# Phone wallet low-balance alert

Staff-only ops mail when the phone wallet runs low. Not owner copy.

## What alerts

- Thresholds: `VOICE_WALLET_ALERT_THRESHOLDS_KES`, default `500,100` (KES).
- One alert per downward crossing (balance at or under the threshold).
- A threshold re-arms when a reading shows the balance above it again.
- One drop past several thresholds sends one alert, naming the lowest one.
- A balance-unknown reading never alerts and never re-arms. That covers probe
  HTTP errors, 402, timeouts, and a missing balance field.
- Mail goes to the Admin ops list (Super Admin > Platform > Escalate, falling
  back to `SCALERS_OPS_ALERT_EMAILS`). It is email only, with the subject
  "Scalers platform phone wallet low" and ledger kind `platform_ops_wallet`.
- `VOICE_PLATFORM_OPS_DRY_RUN=true` logs `[platform-ops] DRY_RUN kind=wallet …`
  and sends nothing.
- To turn it off, either:
  - set the Admin "Money" toggle (`platform_ops_settings.kinds.sautikit_low`) to false, or
  - set `VOICE_WALLET_LOW_ALERT=off`.

## Inputs

1. **Poll** (`src/sautikit/walletProbe.js`): `GET /v1/wallet` every
   `VOICE_TELEPHONY_WALLET_PROBE_MS` (15 min). It runs only when `SAUTIKIT_API_KEY` is set.
2. **Webhook** (`POST /voice/events`, kind `wallet.low_balance` or any `wallet.*`):
   - It sits behind the same `sautikitWebhookGuard` signature check as the other events.
   - It ACKs 200 at once.
   - It dedupes on `event_id`, then the `X-Sautikit-Idempotency-Key` header.
   - It then feeds `data.balance_minor` into the same evaluator.

Both inputs share one crossing latch, so the same crossing alerts once
whichever input sees it first. A webhook older than a newer reading (by
`occurred_at`) is ignored, so a late retry after a top-up cannot re-alert.

## State (restart-safe)

The state is in `docs/supabase/voice_wallet_low_balance.sql`. It holds:

- `voice_wallet_alert_state`: one row per threshold.
- `voice_webhook_events`: event_id dedupe.
- Three service-role RPCs.

Deploy does not apply it. Until it is applied, Voice warns once and uses
in-process state, so a restart can re-alert.

## Vendor setup (needs Alvin's GO and a key with the right scope)

`scripts/setup-wallet-low-balance-webhook.js` is a dry run by default. It prints:

- `POST /v1/webhooks {"url": "<voice>/voice/events", "events": ["wallet.low_balance"]}`
- `PATCH /v1/wallet/threshold {"threshold_minor": 50000}` (docs example. One guide
  says PUT, so use `--threshold-method PUT` if PATCH is rejected.)

To send them it needs both `--apply` and `WALLET_WEBHOOK_SETUP_CONFIRM=yes`. Run it
with `railway run` so the key comes from the service env and is never printed.
Response fields that look secret are redacted.

Before subscribing, check the signing secret:

- With `SAUTIKIT_VALIDATE_WEBHOOKS=true`, the guard verifies every
  `/voice/events` call with `SAUTIKIT_WEBHOOK_SECRET` (else
  `SAUTIKIT_VOICE_SIGNING_SECRET`).
- If the new workspace webhook signs with a different secret, other events
  would start failing with 401.
- Confirm which secret the vendor uses for workspace webhooks first.

The vendor fires once per crossing of its single threshold. The 15 min poll
catches the lower thresholds.
