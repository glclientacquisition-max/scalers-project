# Phone wallet low-balance alert

Staff-only ops mail when the phone wallet runs low. Not owner copy.

## What alerts

- Thresholds: `VOICE_WALLET_ALERT_THRESHOLDS_KES`, default `500,100` (KES).
- One alert per downward crossing (balance at or under the threshold).
- A threshold re-arms when a reading shows the balance above it again.
- One drop past several thresholds sends one alert, naming the lowest one.
- **Empty wallet (zero or below) sends exactly one alert**: the existing
  "Scalers platform phone line down" mail, now with
  `Cause: Phone wallet is empty, top up to restore calls.` The cause line is
  also used when the vendor answers 402. "Wallet low" is suppressed for that
  reading, but every threshold it passed is marked crossed. So a drop from
  above KES 500 straight to 0 never fires "under 500" or "under 100" later on
  the same drop. Above zero the thresholds fire normally.
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
2. **Webhook: off by default (poll only).** `POST /voice/events` with kind
   `wallet.low_balance` or any `wallet.*` event answers 200 and ignores the body
   unless `VOICE_WALLET_WEBHOOK=on`. When on:
   - It sits behind the same `sautikitWebhookGuard` signature check as the other events.
   - It dedupes on body `event_id`, then `X-Sautikit-Event-Id`, then
     `X-Sautikit-Idempotency-Key`.
   - It feeds `data.balance_minor` into the same evaluator.

   **The subscription waits on the signing-secret confirmation.** See
   "Signing" below. Confirm it from the vendor docs or with a staging test
   delivery before subscribing or turning it on.

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

## Signing (read before subscribing)

What the vendor's public docs say, as read 2026-10-09:

- Workspace webhooks (`POST /v1/webhooks`) are signed with a **per-subscription
  secret**. It is 32 random bytes, returned once in the create response (and
  on `POST /v1/webhooks/{id}/rotate-secret`), and the vendor stores only a hash.
  So it will not be the secret Voice uses today for per-number call events.
- Per-number call events (`events_url` on the number's routing) carry the same
  header shape. The docs do not say where that secret comes from.
- The concepts page and the signature guide say:
  `X-Sautikit-Signature: t=<unix>,v1=<hex>`, with
  `HMAC-SHA256(secret, raw_body + "." + t)` and a 300 s skew. This matches
  `verifySautikitSignature`.
- The `wallet.low_balance` event page contradicts them. It shows HMAC over the
  raw body only, compared as a bare hex string, with headers
  `X-Sautikit-Idempotency-Key` / `X-Sautikit-Event` instead of
  `X-Sautikit-Event-Id` / `X-Sautikit-Event-Kind`.
- Retries also differ: 8 attempts over 30 s to 7 d (concepts) versus 5 over
  1 to 16 s (event page).

What that means here:

- With `SAUTIKIT_VALIDATE_WEBHOOKS=true`, the guard checks every
  `/voice/events` call against ONE secret (`SAUTIKIT_WEBHOOK_SECRET`, else
  `SAUTIKIT_VOICE_SIGNING_SECRET`).
- A workspace subscription to the same URL would fail with 401 unless the guard
  learns a second secret. Swapping in the new secret would break call events.
- Options, decided after the confirmation:
  - (a) accept either secret on `/voice/events`
  - (b) subscribe a separate path with its own secret

  Then run one staging test delivery and confirm which signature form arrives.

The vendor fires once per crossing of its single threshold. The 15 min poll
catches the lower thresholds.
