---
owner: ops-billing
last_reviewed: 2026-10-18
---

# Ops alert endpoint

Staff notices for the Business Assistant platform. Not an owner or caller message. Voice calls this. Desk does not schedule it: Vercel Hobby runs a cron at most once a day, and a `*/10` schedule fails the deploy.

In flight, not on prod. This note lives here so it does not collide with the STATUS edit in #768.

## Contract for the Voice caller

`GET /api/cron/ops-alerts`

Header: `Authorization: Bearer <CRON_SECRET>`

`CRON_SECRET` must be at least 16 characters. A missing header, a wrong secret, or a shorter secret returns 401 and writes nothing. Compare in constant time.

| Status | Body | Meaning |
| --- | --- | --- |
| 401 | `{ "ok": false }` | Bearer missing or wrong. |
| 200 | `{ "ok": true, "dryRun", "recipients", "opened", "resolved", "sent", "wouldSend", "quieted", "failed" }` | One pass finished. Counts only. No balances, no addresses, no notice text. |
| 500 | `{ "ok": false, "error": "Check failed." }` | The pass threw. Safe to call again. |

`dryRun` is true unless `OPS_ALERTS_DRY_RUN` is `false`, `0`, `off`, or `no`, ops mail is configured, and the host is not staging. Staging is the Supabase ref `sgcdncjxauhsbunobmob`, Vercel project `prj_koYxAaXjOZ9QYA7hVB2SUOEAmyoB`, or a `scalers-staging` host. Staging never sends, even with dry run off.

Suggested interval: every 10 minutes. Overlapping calls are safe.

## Idempotency

- One open or acked row per `kind` (unique index). A second insert of the same kind does nothing.
- Mail claims `notified_at` only while it is null. The caller that sets it is the one that sends.
- A second pass sees `notified_at` set and does not send again.
- A failed send clears that claim, so the next pass can send once.
- Ledger reason `already_sent` keeps the claim. Reason `in_flight` (a pending row, not a sent one) does not: the claim is released and a later pass retries.
- A notice opened more than `OPS_ALERTS_STALE_HOURS` ago (default 6) is claimed and not mailed. Turning dry run off does not send the old backlog in one go. A notice opened inside the window still mails once.
- Phone wallet re-arms only when the balance is strictly above the threshold plus `OPS_ALERTS_REARM_MARGIN` (default `0.10`, so KES 100 holds until the balance is above KES 110).
- Phone wallet top-up: one "topped up" mail (subject `Scalers ops: Money topped up`) when the highest open wallet threshold re-arms. With 500 and 100 that is above KES 550. Lower thresholds, the empty notice, and the legacy `sautikit_low` row resolve quietly when a threshold notice carries the mail, so one top-up sends one mail.
- Staging phone wallet: when `SAUTIKIT_STAGING_WALLET_KEY` (a wallet.read-only key for the staging workspace) is set on prod Desk, the same pass reads that wallet too. Kinds `sautikit_low:staging:<minor>` and `sautikit_low:staging:empty`, thresholds `OPS_STAGING_WALLET_ALERT_THRESHOLDS_KES` (default `300`), same dedupe, re-arm and top-up mail. Label "Staging money". The Money toggle covers both. Unset key: staging kinds hold and nothing opens.
- Speech and reasoning notices are recorded for Admin and are not mailed from here. Voice `notePlatformOpsDegrade` owns those mails.
- Recovery mail goes out once, only if the opening notice was actually sent and the signal asks for it. A failed recovery mail is not retried. The notice is already resolved. The next downward crossing opens a new notice.

## What this pass reads

Phone wallet: SautiKit `GET /v1/wallet` with the API key, and the staging wallet with `SAUTIKIT_STAGING_WALLET_KEY` when set. TextSMS: server-side `getbalance`. Neither uses the public Voice health URL.
