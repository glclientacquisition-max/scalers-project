---
owner: ops-billing
last_reviewed: 2026-10-18
---

# Invoice pay

How Desk pays an open invoice, and how the owner reads invoices and receipts. The pay page needs no login. The token is the capability. A business with `billing_enforcement` off (beta) gets no link.

SQL is [`docs/supabase/invoice_pay.sql`](../../supabase/invoice_pay.sql) then [`docs/supabase/invoice_documents.sql`](../../supabase/invoice_documents.sql). Both are applied on staging (`sgcdncjxauhsbunobmob`) as of 18 Oct. They are not on production. Production waits for a backup and Alvin's GO.

VAT and KRA eTIMS are off. `invoices.tax_kes` stays null. The page, the invoice, and the receipt do not show a tax line.

## Numbers

`finalize_invoice` assigns `SCL-YYYY-000001` for the Africa/Nairobi year. The counter moves only when a draft is issued. Drafts stay unnumbered. A recorded payment (`matched`, `partial`, or `over`) issues `RCT-YYYY-000001` once and queues a payment-received notice. An issue payment does not get a receipt.

## Token

`mint_invoice_pay_token(invoice_id uuid, rotate boolean default false)`

Service role only. Not granted to `anon` or `authenticated`.

- The invoice is open, something is still owed, and the business is not archived.
- `billing_enforcement` off raises `beta tenants have no pay link`.
- The raw token is returned once: `pay_` plus 32 random bytes, base64url. Only the sha256 hex is stored. It expires in 7 days.
- A second mint without rotate raises `pay link already exists`.
- Rotate revokes the active token, then mints a new one. The old link is expired.
- The audit row records the invoice and the expiry. It does not record the raw token.

`pay_invoice_by_token(token text)` returns the page facts, including the owner name, email, and phone when the business has them. A phone that starts with `pending:` is omitted. Service role only.

## Page

Route: `/pay/<token>` on the Desk app host (`https://app.scalers.co.ke/pay/<token>`). No login. The page is `noindex`.

It shows the business name, the invoice number, the KSh total, and the due date in East Africa time. It does not show VAT.

One filled button: `Pay KSh X`. X is the next unpaid part. Above KSh 150,000 the page also shows `Part 1 of N`. M-Pesa's per-transaction cap is KSh 150,000. Parts sum to the invoice. The invoice is paid when the paid total reaches the invoice total.

The button starts a hosted checkout. The success URL already has `?return=1`. Bachs may append `?checkout_id=` onto that query. The page reads `checkout_id` from either shape. That screen says `Checking payment` and keeps asking until the webhook has settled the attempt. `Payment received` appears only after that attempt is succeeded. The return never marks the invoice paid.

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

## Checkout

Create sends `expires_in_minutes` (60, capped at 1440), `reference` (the attempt id), and `customer` `{email, name, phone_number}` when any of those are known. The response `expires_at` is stored on the attempt. A checkout URL is reused only while `checkout_expires_at` is still in the future. After that, the next tap mints a new attempt and a new reference. A reference is single-use on the Bachs account, including after expiry.

`getCheckout` returns `payment_status` and `charge`. It does not return `checkout_url`. Reconciliation reads `payment_status`.

## Webhook

`POST /api/billing/bachs/webhook`

Checks `X-Bachs-Timestamp` and `X-Bachs-Signature` (or `X-Bachs-Signature-V2`) as HMAC-SHA256 of `{timestamp}.{raw body}`. The clock window is 300 seconds. Each retry is signed again. Bachs stops retrying about 80 minutes after the first try. Stores the raw event with `record_payment_event`, one row per provider event id. A retry increments `attempts` and does not insert a second event.

`apply_payment` runs once, keyed by the checkout id, for the part amount in KES. A second event for the same checkout does not pay again.

`collection.succeeded` with status `SUCCEEDED`, `ACCEPTED`, or `OVERPAID` records the payment when the KES amount is present. `OVERPAID` applies the received KES and the reconciliation report adds kind `overpaid`. It does not insert a second payment for the same checkout id.

`checkout.completed` applies only when `payment_status` is `paid` and the KES amount matches the part. Any other `payment_status` waits, so a later `collection.succeeded` can still apply.

A KES amount that does not match the part, a collection that is only USD, or `collection.underpaid` is an issue (`record_payment_issue`, `match_status = issue`). The invoice stays open and `amount_paid_kes` does not move.

The KES charged is `payments.amount_kes`. When Bachs also sends a USD settlement, that is `settled_amount_minor` and `settled_currency`. The fee is `processing_fee` and `processing_fee_currency`. A fee is stored only when the payload includes one. The 3.5% mobile-money rate is not invented.

A Bachs error logs `error_code` and `x-request-id`. It does not log the key or the request body.

`BACHS_MODE=live` returns 403 and applies nothing. A missing or bad signature returns 401. A handler error returns 500 so Bachs can retry.

Do not register a webhook until the owner has sandbox keys on Vercel Preview.

- Staging: `https://scalers-staging.vercel.app/api/billing/bachs/webhook`
- Production, after GO: `https://app.scalers.co.ke/api/billing/bachs/webhook`

Events to register: `checkout.completed`, `collection.succeeded`, `collection.failed`, `collection.underpaid`, `checkout.expired`.

## Provider

`BACHS_MODE` is `off`, `sandbox`, or `live`. Unset is off. Off uses the mock and sends no money. Sandbox needs `BACHS_API_KEY` and talks only to `https://sandbox-api.bachs.io`. A live key (`sk_live_`), live mode, and the production database are refused. Do not put keys in the repo.

Set these on Vercel Preview (staging). Leave them off production.

| Variable | Staging value |
| --- | --- |
| `BACHS_MODE` | `sandbox` |
| `BACHS_API_KEY` | sandbox key, entered in the dashboard |
| `BACHS_WEBHOOK_SECRET` | webhook signing secret |
| `BILLING_NOTICES_SEND` | leave unset |

## Documents

An issued invoice has an HTML view and a PDF. Both are A4. The header has the Scalers wordmark on the left. On the right: Invoice, the number, the issue date, the due date, and a status pill (Open, Paid, Overdue, or Void). From and Bill to are two columns. The line table headers are Description, Qty, Unit price, and Amount. The billing period sits under the plan line. Totals are right aligned: Subtotal, Credits applied when any were applied, Total, Amount paid, and Amount due. When a pay URL is passed, the page includes a Pay KSh link and a short M-Pesa note. Above KSh 150,000 that link is the next M-Pesa part (Part 1 of 2, and so on). A live invoice does not embed the pay token, so the link is absent there. The footer has the support contact, the invoice number, and Page x of y. There is no VAT line.

A receipt uses the same frame. It leads with Paid KSh X on the payment date, then the method (M-Pesa), the reference, the invoice it settles, and the same line items.

Sample renders use the prices the owner locked for those examples: Growth monthly KSh 18,000, extra seats KSh 500, inbound minutes KSh 25, message credits KSh 1. Proration, credits applied, the bill-to, and the company address on the samples stay example. The package catalogue is unchanged. The sample pay link is `https://app.scalers.co.ke/pay/example-token`.

Company lines that are not in the repo are labelled example: address, city, KRA PIN, phone, and billing email. The owner supplies these before a customer invoice:

- Legal company name, if it is not Scalers
- Physical address
- City
- KRA PIN
- Phone
- Billing email

## Notices

Issuing an invoice queues `platform_billing_invoice_issued`. `enqueue_invoice_due_soon` and `enqueue_invoice_overdue` queue the reminders. A receipt queues `platform_billing_payment_received`. Invoice mail prefers email when `alert_email` is set. The rows wait in `billing_notices`.

`sendClaimedBillingNotices` is the send path. It calls the existing `dispatchAlert`. Kinds that start with `platform_` are platform billed, so they do not burn message credits. It claims nothing unless `BILLING_NOTICES_SEND=on`. Leave that unset.

## Owner history API

Signed-in owner, own business only. The server uses the service role filtered by that tenant. A client cannot pass a tenant id. Live mode and the production database return 503.

| Method | Path | What Desk gets |
| --- | --- | --- |
| GET | `/api/billing/invoices` | Invoices, lines, and receipts. Money is `KSh 7,000`. Open invoices include `pay_link_path`. |
| GET | `/api/billing/invoices/:id` | One invoice. `?format=html` is the invoice page. |
| GET | `/api/billing/invoices/:id/pdf` | Invoice PDF. |
| POST | `/api/billing/invoices/:id/pay-link` | `{ pay_path: "/pay/<token>" }` once. A second call is 409 `Pay link already issued`. |
| GET | `/api/billing/receipts/:id` | Receipt JSON. `?format=html` or `?format=pdf`. |
| GET | `/api/billing/receipts/:id/pdf` | Receipt PDF. |

Desk builds the Billing screen. This API does not.

## Reconciliation

`billing_payment_reconciliation()` lists attempts pending for more than 30 minutes, invoices or attempts whose status disagrees, issue rows, and overpaid checkouts. It changes nothing.

`node scripts/billing-payment-reconcile.js` prints that report. It refuses the production project. In sandbox it may read `payment_status` and add a disagreement row. It still does not write.

## What the owner provides for Bachs

1. An account at [https://app.bachs.io](https://app.bachs.io).
2. KYC so M-Pesa (`MOMO_KES`) is enabled.
3. A sandbox API key (`sk_sandbox_...`) as `BACHS_API_KEY`. Not a live key.
4. The webhook signing secret as `BACHS_WEBHOOK_SECRET`.
5. The webhook URL above, for the events listed.
6. `BACHS_MODE=sandbox` on Vercel Preview. Never `live` from this draft.
7. The company details listed under Documents.

## Desk later

This change does not add the owner Plan screen. Billing history uses the API above. The pay link is the POST. Desk shows it once and does not store the raw token.
