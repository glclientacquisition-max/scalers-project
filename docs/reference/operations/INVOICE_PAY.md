---
owner: ops-billing
last_reviewed: 2026-10-18
---

# Invoice pay

How Desk pays an open invoice. The page needs no login. The token is the capability. A business with `billing_enforcement` off (beta) gets no link.

SQL is [`docs/supabase/invoice_pay.sql`](../../supabase/invoice_pay.sql). Run it after [`billing_data_layer.sql`](../../supabase/billing_data_layer.sql). It is not applied on staging or production. Production waits for a backup and Alvin's GO.

## Token

`mint_invoice_pay_token(invoice_id uuid, rotate boolean default false)`

Service role only. Not granted to `anon` or `authenticated`.

- The invoice is open, something is still owed, and the business is not archived.
- `billing_enforcement` off raises `beta tenants have no pay link`.
- The raw token is returned once: `pay_` plus 32 random bytes, base64url. Only the sha256 hex is stored. It expires in 7 days.
- A second mint without rotate raises `pay link already exists`.
- Rotate revokes the active token, then mints a new one. The old link is expired.
- The audit row records the invoice and the expiry. It does not record the raw token.

`pay_invoice_by_token(token text)` returns the page facts. Service role only.

## Page

Route: `/pay/<token>` on the Desk app host (`https://app.scalers.co.ke/pay/<token>`). No login. The page is `noindex`.

It shows the business name, the invoice number, the KSh total, VAT (total minus subtotal, including KSh 0), and the due date in East Africa time.

One filled button: `Pay KSh X`. X is the next unpaid part. Above KSh 150,000 the page also shows `Part 1 of N`. M-Pesa's per-transaction cap is KSh 150,000. Parts sum to the invoice. The invoice is paid when the paid total reaches the invoice total.

The button starts a hosted checkout. Coming back adds `return=1` and `checkout_id`. That screen says `Checking payment` and keeps asking until the webhook has settled the attempt. `Payment received` appears only after that attempt is succeeded. The return never marks the invoice paid.

Other states, with no pay button:

| State | Title |
| --- | --- |
| Paid, and the caller did not just return from this checkout | Paid |
| Void | This invoice is void |
| Revoked or past `expires_at` | This link has expired |
| Enforcement off | This invoice cannot be paid here |
| Draft or uncollectible | This invoice is closed |
| Unknown token | This link is not valid |
| Amount or currency did not match | This payment needs a check |

A failed or cancelled checkout stays payable and says `Payment was not completed.`

## Webhook

`POST /api/billing/bachs/webhook`

Checks `X-Bachs-Timestamp` and `X-Bachs-Signature` (or `X-Bachs-Signature-V2`) as HMAC-SHA256 of `{timestamp}.{raw body}`. Stores the raw event with `record_payment_event`, one row per provider event id. A retry increments `attempts` and does not insert a second event.

`apply_payment` runs once, keyed by the checkout id, for the part amount in KES. A second event for the same checkout does not pay again.

A KES amount that does not match the part, a collection that is only USD, or `collection.underpaid` is an issue (`record_payment_issue`, `match_status = issue`). The invoice stays open and `amount_paid_kes` does not move. `checkout.completed` with no KES amount waits, so a later `collection.succeeded` can still apply.

The KES charged is `payments.amount_kes`. When Bachs also sends a USD settlement, that is `settled_amount_minor` and `settled_currency`. A fee is stored only when the payload includes one. The 3.5% mobile-money rate is not invented.

`BACHS_MODE=live` returns 403 and applies nothing. A missing or bad signature returns 401. A handler error returns 500 so Bachs can retry. Their docs say up to 5 attempts.

Do not register a webhook until the SQL is applied and the owner has sandbox keys.

- Staging, later: `https://scalers-staging.vercel.app/api/billing/bachs/webhook`
- Production, after GO: `https://app.scalers.co.ke/api/billing/bachs/webhook`

Events to register: `checkout.completed`, `collection.succeeded`, `collection.failed`, `collection.underpaid`, `checkout.expired`.

## Provider

`BACHS_MODE` is `off`, `sandbox`, or `live`. Unset is off. Off uses the mock and sends no money. Sandbox needs `BACHS_API_KEY` and talks only to `https://sandbox-api.bachs.io`. A live key (`sk_live_`), live mode, and the production database are refused. Do not put keys in the repo.

## Reconciliation

`billing_payment_reconciliation()` lists attempts pending for more than 30 minutes, and invoices or attempts whose status disagrees, including issue rows. It changes nothing.

`node scripts/billing-payment-reconcile.js` prints that report. It refuses the production project. In sandbox it may read checkout status and add a disagreement row. It still does not write.

## What the owner provides for Bachs

1. An account at [https://app.bachs.io](https://app.bachs.io).
2. KYC so M-Pesa (`MOMO_KES`) is enabled.
3. A sandbox API key (`sk_sandbox_...`) as `BACHS_API_KEY`. Not a live key.
4. The webhook signing secret as `BACHS_WEBHOOK_SECRET`.
5. The webhook URL above, for the events listed.
6. Leave `BACHS_MODE=off` until those exist. Then `sandbox` on staging only. Never `live` from this draft.

## Desk later

This change does not add the owner Plan screen. When that screen is built, it calls `mint_invoice_pay_token` for an open invoice on a business with billing enforcement on, and shows the returned link once. It does not build the token in the browser.
