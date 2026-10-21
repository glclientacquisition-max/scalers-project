---
owner: ops-billing
last_reviewed: 2026-10-19
---

# Runbook: payments go live

Staging first. Production stays off. This runbook names switches and the order to flip them. It does not charge, move money, or change Bachs account settings.

Code on `main` already settles a checkout from `GET /v1/checkout-sessions/{id}` `charge.amount_paid`, writes one payment row, issues one receipt, and marks the invoice paid. This follow-up closes three gaps that still block a real live payment. P19 is not applied on staging or production.

VAT and KRA eTIMS stay off. `tax_kes` stays null.

## Gaps

1. **`amount_paid` is unconfirmed.** Bachs documents `charge.amount_paid` as the amount received so far. The owner reads that as a running total. Bachs has not confirmed a second M-Pesa collection on the same checkout. A single payment is safe either way. A second collection whose own amount is larger than the rise in that total is not applied on arrival. It opens one review (`collected_total_short`). Staff `book` adds the seen total plus that collection, once. Staff `nothing` leaves the books (the running-total reading: the money was already in the GET). A replay of `book` does not book again. An event amount equal to the checkout price is not a collection amount. A passed total below the stored GET is refused. A GET that falls still opens `collected_total_decreased` and does not reverse the books. SQL is P19 [`invoice_pay_amount_paid_either.sql`](../supabase/invoice_pay_amount_paid_either.sql), after P16. Not applied.
2. **A missed webhook never settled in live mode.** Live reconcile used to retry only `payment_events.needs_retry`. An open checkout with no event row stayed unpaid. Live mode now sweeps `pending`, `pending_unattached`, and `succeeded` attempts and applies `charge.amount_paid` through `reconcile_checkout_total`. The same total a second time is a no-op. A business that is not allowlisted is skipped. Sandbox and off do not run this sweep.
3. **The retry cron cannot run every 15 minutes here.** This Vercel account is Hobby. A cron that runs more than once a day fails the deployment. `5e4813d7` scheduled `7,22,37,52 * * * *`, and both Vercel projects failed, so production Desk stayed on the previous deploy. `dashboard/vercel.json` now calls `GET /api/cron/billing-payment-retry` once a day at 03:07 UTC (`7 3 * * *`). The handler returns 200 and does not call Bachs unless `BACHS_MODE=live` and `BACHS_LIVE_ALLOWED` is exactly `true` and `CRON_SECRET` matches. Production with payments off does not call Bachs. `GET /api/cron/billing-reconcile` stays out of `vercel.json`. It is a read-only report.

Still required before any live shilling moves, and not done by this change:

- Apply P19 only. Production already has P1 through P18. P11 through P16 landed 2026-10-19 08:11-08:13 UTC as versions `20261019081159` through `20261019081339`. P17 is `20261019150641`. P18 is `20261019150654`. Both of those came in with #820 `f6d7fee9`. Staging has P11 through P18 and does not have P19. Never re-run P5, P9, P11, P12, P14, P15, P16, P17, or P18.
- Set the env names below. Register the webhook only after a signed test returns 200. A 401 or 403 is a permanent refusal, so Bachs will not retry it.
- Allowlist one non-beta test business. `admin_set_tenant_live_payments` refuses a beta business and a business with enforcement off.
- Letterhead address, city, and KRA PIN are still unset. They do not block collection. They do leave those lines off the invoice.

## Env names

Names only. No values in the repo, in chat, or in this file.

Vercel project for the test: `scalers-staging` (Preview). Production project `scalers-project` stays closed.

| Name | Role |
| --- | --- |
| `BACHS_MODE` | `off`, `sandbox`, or `live`. Unset is off. |
| `BACHS_LIVE_ALLOWED` | Master switch. Live mode runs only when this is exactly `true`. |
| `BACHS_LIVE_TENANT_ALLOWLIST` | Exact tenant ids, comma-separated. Unset, empty, or whitespace opens none. `*` opens every business. Do not use `*` for the test. |
| `BACHS_API_KEY` | Sandbox key while `BACHS_MODE=sandbox`. Live key only while `BACHS_MODE=live` on Preview. |
| `BACHS_WEBHOOK_SECRET` | Signs `X-Bachs-Timestamp` and `X-Bachs-Signature` (or `X-Bachs-Signature-V2`). |
| `CRON_SECRET` | Bearer token for the retry cron. |
| `SUPABASE_URL` | Staging project `sgcdncjxauhsbunobmob` for the test. |
| `NEXT_PUBLIC_SUPABASE_URL` | Same project as `SUPABASE_URL`. |
| `SUPABASE_SERVICE_ROLE_KEY` | The reconcile script only. Not a browser key. |
| `BILLING_NOTICES_SEND` | Leave unset. Notices stay off. |

Do not set `BACHS_MODE=live` or `BACHS_LIVE_ALLOWED` on `scalers-project` until P19 is on production and Alvin says GO. P1 through P18 are already there. Do not re-run them.

## Order to flip

1. Confirm production already has P1 through P18. Apply P19 by hand on staging first, after a backup and Alvin's GO, then on production only after a second GO. Never re-run P5, P9, P11, P12, P14, P15, P16, P17, or P18.
2. Pick one staging business that is not beta and has enforcement on. Not a production line. Never `+254709221536`.
3. On Vercel Preview, set `BACHS_API_KEY` and `BACHS_WEBHOOK_SECRET`. Set `BACHS_MODE=sandbox`. Leave `BACHS_LIVE_ALLOWED` unset. Leave `BILLING_NOTICES_SEND` unset.
4. Send one signed POST and one badly signed POST to `https://scalers-staging.vercel.app/api/billing/bachs/webhook`. Good signature returns 200. Bad signature returns 401 and writes no payment. Do this before the URL is registered at Bachs.
5. Register that URL for `checkout.completed`, `collection.succeeded`, `collection.failed`, `collection.underpaid`, and `checkout.expired`.
6. For the KSh 10 test window only: set `BACHS_MODE=live` and `BACHS_LIVE_ALLOWED` to exactly `true`. Allowlist that one business, either with `admin_set_tenant_live_payments` (reason required) or with `BACHS_LIVE_TENANT_ALLOWLIST` set to that id alone. `GET` and `POST /api/billing/live-tenants` send a signed-out visitor to `/admin/login`. That redirect is expected. The route does not return 401. Sign in as Super Admin before calling it.
7. Run the KSh 10 test below. Verify. Reconcile.
8. Roll back unless Alvin says the test business stays live.

## KSh 10 live test

A person runs this. Do not script a charge from CI or from an agent.

The owner-approved production run, on the one business named Jirani, is [`ksh10-live-test-jirani.sql`](ksh10-live-test-jirani.sql). Run ENABLE, then ISSUE, then open the pay URL the ISSUE notice prints. RESTORE puts that business back on beta with enforcement off and live payments off. It does not delete the invoice or a booked payment. This pull request does not run that file and does not apply it. P19 stays unapplied. One collection of KSh 10 does not need P19.

1. Allowlist the one test business from the step above. Leave every other business off.
2. Issue one open invoice for KSh 10 on that business. Mint the pay link once. The raw token is shown once.
3. Open `/pay/<token>`. Pay KSh 10 with M-Pesa (`MOMO_KES` hosted checkout). One collection.
4. If Bachs refuses KSh 10, stop. The minimum live amount is unconfirmed. Do not raise it without Alvin.

One KSh 10 collection matches both readings of `amount_paid`. Do not send a second collection on that checkout during this test.

## Verify

On the staging database, for that checkout:

- `payment_attempts.collected_total_seen_kes` is 10.
- One `payments` row for that checkout id, `match_status` `matched` (or `partial` if something else is still owed). Not a second row for the same event.
- One receipt `RCT-YYYY-NNNNNN`. A replay keeps that number.
- The invoice status is `paid` and the amount due is 0.
- No `tenant_credits` row for that checkout.
- The webhook event is stored and `needs_retry` is false.
- Posting the same signed body again does not add a payment or a receipt.

If the GET cannot be read, the webhook returns 200 with `action: retry` and sets `needs_retry`. Bachs will not retry a 200. The cron or the script below must pick it up.

## Reconcile

- `select * from billing_payment_reconciliation();` lists stale attempts, status disagreements, issue rows, and overpaid checkouts. It writes nothing.
- `node scripts/billing-payment-reconcile.js` with the Preview env. In live mode it sweeps open checkouts, then retries `needs_retry`. A business that is not allowlisted is skipped. A second run of the same total does nothing.
- `GET /api/cron/billing-payment-retry` with `Authorization: Bearer` matching `CRON_SECRET` does the same sweep, then the same retry. A closed gate returns 200 `payments_closed` and does not call Bachs. Sandbox returns 200 `not_live` and does not sweep.
- A second M-Pesa receipt on the same checkout, when the GET total does not rise by that amount, opens a review. Do not choose `book` or `nothing` until Bachs confirms which reading is true for that payment. `book` treats the event as new money. `nothing` treats the GET as already complete.

## Rollback

1. Unset `BACHS_LIVE_ALLOWED`, or set it to any value other than `true`.
2. Set `BACHS_MODE` back to `sandbox` or `off`.
3. Turn off the allowlist row (`admin_set_tenant_live_payments`, enabled false, with a reason) and clear `BACHS_LIVE_TENANT_ALLOWLIST`.
4. Leave the webhook URL, or remove that URL in the Bachs dashboard if you want new events to stop. Do not change other provider settings from this runbook.
5. Do not reverse a payment that already booked. A later GET below the seen total opens a review and does not reverse the books.
6. Production stays: `BACHS_MODE` unset or `off`, `BACHS_LIVE_ALLOWED` unset, allowlist empty. The scheduled cron no-ops while the gate is closed.

Contract: [`INVOICE_PAY.md`](../reference/operations/INVOICE_PAY.md). Allowlist: [`bachs-live-allowlist.md`](../reference/bachs-live-allowlist.md).
