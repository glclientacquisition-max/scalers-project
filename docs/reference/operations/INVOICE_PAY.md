---
owner: ops-billing
last_reviewed: 2026-10-18
---

# Invoice pay

How Desk pays an open invoice, and how the owner reads invoices and receipts. The pay page needs no login. The token is the capability. A business with `billing_enforcement` off, or `billing_status` beta, gets no link.

SQL is [`docs/supabase/invoice_pay.sql`](../../supabase/invoice_pay.sql), then [`docs/supabase/invoice_documents.sql`](../../supabase/invoice_documents.sql), then [`docs/supabase/billing_company.sql`](../../supabase/billing_company.sql). Applied on staging (`sgcdncjxauhsbunobmob`) as of 18 Oct. Not on production. Production waits for a backup and Alvin's GO.

VAT and KRA eTIMS are off. `invoices.tax_kes` stays null. The page, the invoice, and the receipt do not show a tax line.

## Numbers

`finalize_invoice` assigns `SCL-YYYY-000001` for the Africa/Nairobi year and copies `billing_company` onto the invoice. The counter moves only when a draft is issued. Drafts stay unnumbered. A recorded payment (`matched`, `partial`, or `over`) issues `RCT-YYYY-000001` once and queues a payment-received notice. An issue payment does not get a receipt.

## Token

`mint_invoice_pay_token(invoice_id uuid, rotate boolean default false)`

Service role only. Not granted to `anon` or `authenticated`.

- The invoice is open, something is still owed, and the business is not archived.
- `billing_enforcement` off, or `tenant_subscriptions.billing_status` beta, raises `beta tenants have no pay link`. `finalize_invoice` raises the same way for beta.
- The raw token is returned once: `pay_` plus 32 random bytes, base64url. Only the sha256 hex is stored. It expires in 7 days.
- A second mint without rotate raises `pay link already exists`.
- Rotate revokes the active token, then mints a new one. The old link is expired.
- The audit row records the invoice and the expiry. It does not record the raw token.

`pay_invoice_by_token(token text)` returns the page facts, including the owner name, email, and phone when the business has them. A phone that starts with `pending:` is omitted. Service role only.

## Page

Route: `/pay/<token>` on the Desk app host (`https://app.scalers.co.ke/pay/<token>`). No login. The page is `noindex`.

It shows the business name, the invoice number, the KSh total, and the due date in East Africa time. It does not show VAT.

One filled button: `Pay KSh X`. X is the next unpaid part. Above KSh 150,000 the page also shows `Part 1 of N`. M-Pesa's per-transaction cap is KSh 150,000. Parts sum to the invoice. The invoice is paid when the paid total reaches the invoice total.

The button starts a hosted checkout. Bachs success and cancel URLs use a one-time return id (`/pay/return/<id>`), not the pay token. The return id cannot start a charge. The pay page cookie keeps the token on this browser so a split invoice can still take the next part. Bachs may append `?checkout_id=` onto the success query. The page reads `checkout_id` from either shape and ignores a checkout that belongs to another invoice. That screen says `Checking payment` until money is on this invoice. `Payment received` appears when this invoice has a payment applied, including a paid part of a split. The return never marks the invoice paid by itself.

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

Create sends `expires_in_minutes` (60, capped at 1440), `reference` (the attempt id), and `customer` `{email, name, phone_number}` when any of those are known. If the response omits `expires_at`, it is derived from `expires_in_minutes` before the attempt is attached. A failed attach marks the attempt failed and cancels the session. One pending attempt per invoice part is locked with the invoice row. A second tap while that row has no URL yet waits for it. An expired pending attempt is cancelled, and its Bachs session is cancelled, before a new attempt is inserted. A reference is single-use, including after expiry. The checkout URL must be https.

`getCheckout` returns `payment_status` and `charge`. It does not return `checkout_url`. Reconciliation reads `payment_status`.

## Webhook

`POST /api/billing/bachs/webhook`

Checks `X-Bachs-Timestamp` and `X-Bachs-Signature` (or `X-Bachs-Signature-V2`) as HMAC-SHA256 of `{timestamp}.{raw body}`. The clock window is 300 seconds. Each retry is signed again. Bachs stops retrying about 80 minutes after the first try. Stores the raw event with `record_payment_event`, one row per provider event id. A retry increments `attempts` and does not insert a second event.

`apply_payment` runs once for an applied checkout id. A second event for the same checkout does not pay again. An issue row is not that key: a later exact KES event on the same checkout still applies. A collection on a cancelled attempt is stored as an issue and does not raise `amount_paid_kes`.

A terminal collection whose KES is at least the part applies the part and credits the extra. `collection.underpaid` with KES above 0 applies that amount as a partial. `OVERPAID` below the part takes the same partial path. `checkout.completed` then a larger `OVERPAID` updates the payment to the larger amount and credits the difference.

`checkout.completed` applies only when `payment_status` is `paid` and the KES amount is at least the part. Any other `payment_status` waits, so a later `collection.succeeded` can still apply.

A KES amount below the part on `collection.succeeded`, or a collection that is only USD, is an issue (`record_payment_issue`, `match_status = issue`). The invoice stays open. A payment against a void, uncollectible, or draft invoice is stored the same way and the webhook answers 200. The route logs the error message and does not log the body or the secret.

The KES charged is `payments.amount_kes`. When Bachs also sends a USD settlement, that is `settled_amount_minor` and `settled_currency`. The fee is `processing_fee` and `processing_fee_currency`. A fee is stored only when the payload includes one. The 3.5% mobile-money rate is not invented.

A Bachs error logs `error_code` and `x-request-id`. It does not log the key or the request body.

`BACHS_MODE=live` returns 403 and applies nothing. A missing or bad signature returns 401. A handler error returns 500 so Bachs can retry, except `invoice cannot be paid`, which returns 200 after the issue row is stored.

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

Sample renders use the prices the owner locked for those examples: Growth monthly KSh 18,000, extra seats KSh 500, inbound minutes KSh 25, message credits KSh 1. Proration, credits applied, and the bill-to on the samples stay example. The package catalogue is unchanged. The sample pay link is `https://app.scalers.co.ke/pay/example-token`.

## Letterhead

One row, `billing_company` where `id = 1`, is the only place the letterhead is edited. It is not an environment variable. `finalize_invoice` is SQL and cannot see Vercel env, and a later edit must not rewrite invoices that are already issued.

Confirmed values, seeded by `billing_company.sql` (a re-run does not overwrite a later edit):

| Field | Value |
| --- | --- |
| Legal name | Scalers Ventures |
| Product | Business Assistant |
| Phone | +254119774470 |
| Email | support@scalers.co.ke |
| Address | unset |
| City | unset |
| KRA PIN | unset |

Address, city, and KRA PIN are omitted from the invoice and the receipt while they are blank. There is no placeholder and no empty label. Once a value is stored, the next issued invoice prints it as its own line. The order is legal name, product, address, city, KRA PIN, phone, email. The footer is the email and the phone.

Issuing copies the row onto `invoices.issuer_legal_name`, `issuer_product`, `issuer_phone`, `issuer_email`, `issuer_address`, `issuer_city`, and `issuer_kra_pin`. The PDF and the HTML render that snapshot. A draft has those columns null and shows the current row, which is what will be copied. A receipt uses the same snapshot as its invoice.

Change it in the SQL editor. No code change. The next issued invoice picks it up. Invoices already issued keep the old snapshot.

```sql
update public.billing_company
set address = '...', city = '...', kra_pin = '...', updated_at = now()
where id = 1;
```

`legal_name`, `product`, `phone`, and `email` use the same update. The table is service role only. Owners read the snapshot on their own invoices.

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
7. Address, city, and KRA PIN, when those exist. Legal name, phone, and billing email are already on `billing_company`. See Letterhead. Update that row. Do not change issued invoices by hand.

## Desk later

This change does not add the owner Plan screen. Billing history uses the API above. The pay link is the POST. Desk shows it once and does not store the raw token.
