---
owner: ops-billing
last_reviewed: 2026-10-19
---

# Invoice pay

How Desk pays an open invoice, and how the owner reads invoices and receipts. The pay page needs no login. The token is the capability. A business with `billing_enforcement` off, or `billing_status` beta, gets no link.

SQL is [`docs/supabase/invoice_pay.sql`](../../supabase/invoice_pay.sql), then [`docs/supabase/invoice_documents.sql`](../../supabase/invoice_documents.sql), then [`docs/supabase/billing_company.sql`](../../supabase/billing_company.sql), then [`docs/supabase/invoice_pay_session.sql`](../../supabase/invoice_pay_session.sql), then [`docs/supabase/billing_mode_legal_pairs.sql`](../../supabase/billing_mode_legal_pairs.sql), then [`docs/supabase/invoice_pay_held.sql`](../../supabase/invoice_pay_held.sql), then [`docs/supabase/invoice_pay_collections.sql`](../../supabase/invoice_pay_collections.sql), then [`docs/supabase/invoice_pay_checkout_total.sql`](../../supabase/invoice_pay_checkout_total.sql), then [`docs/supabase/invoice_pay_checkout_review.sql`](../../supabase/invoice_pay_checkout_review.sql), then [`docs/supabase/invoice_pay_checkout_review_round8.sql`](../../supabase/invoice_pay_checkout_review_round8.sql), then [`docs/supabase/invoice_pay_checkout_review_round9.sql`](../../supabase/invoice_pay_checkout_review_round9.sql), then [`docs/supabase/invoice_pay_live_allowlist.sql`](../../supabase/invoice_pay_live_allowlist.sql). Staging (`sgcdncjxauhsbunobmob`) has P5 through P17 (`invoice_pay_checkout_review` `20261019034233`, `invoice_pay_checkout_review_round8` `20261019042439`, `invoice_pay_checkout_review_round9` `20261019045940`, `invoice_pay_live_allowlist` `20261019093619`). Production has P5 through P8 as of commit `553f1830`, and P9 and P10 (owner confirmed 19 Oct). The remaining production apply is P11 `invoice_pay_held.sql`, then P12 `invoice_pay_collections.sql`, then P13 `invoice_pay_checkout_total.sql`, then P14 `invoice_pay_checkout_review.sql`, then P15 `invoice_pay_checkout_review_round8.sql`, then P16 `invoice_pay_checkout_review_round9.sql`, then P17 `invoice_pay_live_allowlist.sql`. If `finalize_invoice` changes, re-apply `billing_company.sql` last.

VAT and KRA eTIMS are off. `invoices.tax_kes` stays null. The page, the invoice, and the receipt do not show a tax line.

## Numbers

`finalize_invoice` in `billing_company.sql` is the only copy that should remain after the P1–P8 apply order. It sets `scalers.billing_write`, assigns `SCL-YYYY-NNNNNN` for the Africa/Nairobi year, and copies `billing_company` onto the invoice. It refuses a beta tenant. A negative draft becomes one `tenant_credits` row (`invoice-credit:<id>`) and a paid zero invoice, with no receipt. The counter moves only when a draft is issued. Drafts stay unnumbered. A recorded payment (`matched`, `partial`, or `over`) issues `RCT-YYYY-000001` once and queues a payment-received notice. A later overpay updates that receipt's amount and keeps the number. An issue payment does not get a receipt.

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

When the Bachs gate refuses (live mode, a live key, or the production database), the page still loads. A payable invoice keeps the business, the number, the total, and the due date, and shows `Online payment isn't available yet. Contact support@scalers.co.ke` with no Pay button. An unknown token still says `This link is not valid`. An expired link still says `This link has expired`.

The button starts a hosted checkout. Bachs success and cancel URLs use a return id (`/pay/return/<id>`), not the pay token. The return id expires 24 hours after the attempt is created. It cannot start a charge. After that, the page says `This link has expired`. The pay page cookie keeps the token on this browser so a split invoice can still take the next part. Bachs may append `?checkout_id=` onto the success query. The page reads `checkout_id` from either shape and ignores a checkout that belongs to another invoice. That screen says `Checking payment` until money is on this invoice. `Payment received` appears only when the invoice is fully paid. A paid part of a split says `Part 1 of 2 received, KSh X still due` and keeps the next Pay button. The return never marks the invoice paid by itself.

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

`POST /api/pay/<token>/checkout` calls the gate before it inserts an attempt. When the gate refuses, the response is 503 `{ "error": "payments_unavailable" }` and no checkout is created. The page drops the Pay button and shows the same sentence as above. In live mode the same request also checks `BACHS_LIVE_TENANT_ALLOWLIST`. An unset, empty, or whitespace list refuses every business with the same 503. `*` is the only value that allows every business. A listed id is an exact match.

Create sends `expires_in_minutes` (60, capped at 1440), `reference` (the attempt id), and `customer` `{email, name, phone_number}` when any of those are known. If the response omits `expires_at`, it is derived from `expires_in_minutes` before the attempt is attached. One live attempt per invoice part is locked with the invoice row (`pending` or `pending_unattached`). A second tap while that row has no URL yet waits for it. An expired pending attempt stays pending until its Bachs session is cancelled and then read. A cancel that returns success is not treated as void: the page GETs the session. A session that is still open is reused when its URL is stored. A session that is still open without a URL, or that cannot be read, blocks with `Previous payment still processing.` No second attempt is inserted for that part. A read that says the session is closed marks the row cancelled and then inserts the next attempt. If attach fails, the session id is stored and the row becomes `pending_unattached`. A follow-up cancel that also fails leaves that row in place. The next click reads the stored session and reuses it or blocks. A second click that is still waiting does the same when it sees `pending_unattached`: it reads that session and reuses or blocks. It does not create another checkout for that row. A thrown create does not mark the row failed while a session id is already stored. `park_invoice_pay_attempt` raises `checkout session is already parked` if a different session id is already stored. The same id may refresh the URL. The row is marked failed only when that cancel succeeds and the read says the session is closed, and only when no session id was stored before that create. After a short collection, the succeeded checkout holds the part until a read says the Bachs session is closed, including after `checkout_expires_at`. The next click reads Bachs before it inserts. An open session is reused. An unreadable session blocks with `Previous payment still processing.` A read that says the session is closed sets `checkout_closed_at`, stamps the expiry in the past, keeps the session id, and then a remainder checkout can start for what is still due. The succeeded row is not cancelled. An open checkout-total review blocks that next insert with `checkout total needs review`. The page shows `Previous payment still processing.` A pending or held session is still returned. `resolve_checkout_total_review` lifts the hold and does not move money. It writes `_billing_audit` with the signed-in admin and a reason. Super Admin resolves it from the business billing page, after a confirm, with a reason of at least 3 characters. A reference is single-use, including after expiry. The checkout URL must be https.

`GET /v1/checkout-sessions/{id}` returns `payment_status` and `charge`. It does not return `checkout_url`. The top-level checkout `amount` is the price the customer was asked to pay. Money collected is `charge.amount_paid` on that response. A successful read with `charge` null means nothing has been collected yet. A thrown read, a 404, or a charge with no `amount_paid` is unreadable: the event is stored and nothing is applied. A currency other than KES is an issue for manual review. The hold path is different: a 404 there means the session is closed, so a held checkout can be released.

Bachs has not confirmed that `charge.amount_paid` is the sum of every M-Pesa collection on that checkout. The question to ask Bachs: when a customer pays one checkout in more than one M-Pesa collection (an underpay then the rest, or two equal collections), does `GET /v1/checkout-sessions/{id}` return one charge whose `amount_paid` is the sum of every collection on that checkout, or only the latest charge? If there can be more than one charge per checkout, which endpoint returns every charge for that `checkout_id`? `GET /v1/payments` documents only `limit`, `offset`, and `status_filter`, not `checkout_id`. Do not sum that list.

## Webhook

`POST /api/billing/bachs/webhook`

Checks `X-Bachs-Timestamp` and `X-Bachs-Signature` (or `X-Bachs-Signature-V2`) as HMAC-SHA256 of `{timestamp}.{raw body}`. The clock window is 300 seconds. Each retry is signed again. Bachs stops retrying about 80 minutes after the first try. Stores the raw event with `record_payment_event`, one row per provider event id. A retry increments `attempts` and does not insert a second event.

The webhook is only a trigger. It does not sum amounts across event ids, receipts, or charge ids. On any signed event for a checkout it calls `GET /v1/checkout-sessions/{id}` and reconciles from `charge.amount_paid`, the cumulative collected total for that checkout. `payment_attempts.collected_total_seen_kes` is the total already applied. The delta is the new total minus that seen total. Under the invoice lock, the delta is applied to the invoice up to the amount due. The excess is one `tenant_credits` row keyed `checkout-total:<provider>:<checkout id>:<cumulative cents>`, so a replay of the same total is a no-op. One payment row is stored per checkout (`provider_ref` and `bill_ref` are the checkout id). Its amount is the cumulative total, and a later higher total updates that receipt. Invoice paid plus those credits equals the Bachs total. A later report below the seen total does not reverse the payment or the credit. It writes one review issue (`collected_total_decreased`) keyed `checkout-total-review:<provider>:<checkout id>:lower:<seen cents>:<get cents>`, alerts staff, and keeps the next checkout closed until `resolve_checkout_total_review`. A new receipt, or a charge id this checkout has not applied, is the same kind of review (`collected_total_short`) when the GET total does not rise by at least that event's own amount. The books stay where they were. The review ref is not the checkout id, so a later trusted `reconcile_checkout_total` can still update the real payment. The placeholder charge id `ch_<checkout id>` is kept. It is not a real receipt or charge id. When an event has no real receipt or charge id, a GET total that rises, or a GET total that stays the same after money was already applied, writes one review issue (`collected_identity_missing`). The placeholder stays on that review ref. A replay of the same reading is a duplicate. A GET of 0 when nothing has been collected stays a wait, so an expired or failed checkout can still close. An event amount equal to that checkout's price is not the collection amount. A GET rise is applied. A new real id with no rise, after money was seen, is still a review. `checkout.completed` and `collection.succeeded` can arrive in either order. Both read the same total. Resolve requires `book` or `nothing`. `book` applies the stored reading, or a fresher live GET when the gate is open, up to the amount due, and credits the excess. `nothing` leaves the books and then allows a new checkout for what is still due. A replay does not book again. A lower fresh total does not resolve and does not reverse the books.

A collected total below the part is `apply_partial`. A total that covers the part is applied even when a later part of a split invoice is still open. A total of 0 does not pay the invoice. `checkout.expired` on a pending attempt with nothing collected marks that attempt cancelled. `collection.failed` on a pending attempt with nothing collected marks it failed.

If Bachs cannot be read, the event stays stored with `payment_events.needs_retry` and the webhook returns 200 with `action: retry`. Nothing is guessed from the event body. A later readable settle clears the flag, including when that settle opens a review. An unreadable retry leaves the flag set.

A charge whose currency is not KES is an issue (`record_payment_issue`, `match_status = issue`, no KES amount). The invoice stays open. A payment against a void, uncollectible, or draft invoice is stored the same way and the webhook answers 200. Money on a cancelled or superseded attempt, or on a `failed` or `pending_unattached` attempt that is no longer the live part, is still reconciled onto that invoice up to the amount due. The excess is the same checkout-total credit. Those attempts are not marked succeeded, so a held session is not reopened. If the failed or unattached attempt is still the live part, it is marked succeeded after the total is applied. The route logs the error message and does not log the body or the secret.

In live mode the settle path checks `BACHS_LIVE_TENANT_ALLOWLIST` the same way checkout does. A collection for a business that is not on the list is recorded as an issue (`live_not_allowlisted`) for manual review. It is not applied and it is not dropped. The webhook still answers 200 so Bachs does not retry forever.

The KES charged is `payments.amount_kes`. When Bachs also sends a USD settlement, that is `settled_amount_minor` and `settled_currency`. The fee is `processing_fee` and `processing_fee_currency`. A fee is stored only when the payload includes one. The 3.5% mobile-money rate is not invented.

A Bachs error logs `error_code` and `x-request-id`. It does not log the key or the request body.

`BACHS_MODE=live` returns 403 and applies nothing unless `BACHS_LIVE_ALLOWED=true`. A missing or bad signature returns 401. A handler error returns 500 so Bachs can retry, except `invoice cannot be paid`, which returns 200 after the issue row is stored.

Do not register a webhook until the owner has sandbox keys on Vercel Preview.

- Staging: `https://scalers-staging.vercel.app/api/billing/bachs/webhook`
- Production, after GO: `https://app.scalers.co.ke/api/billing/bachs/webhook`

Events to register: `checkout.completed`, `collection.succeeded`, `collection.failed`, `collection.underpaid`, `checkout.expired`.

## Provider

`BACHS_MODE` is `off`, `sandbox`, or `live`. Unset is off. Off uses the mock and sends no money. Sandbox needs `BACHS_API_KEY` and talks only to `https://sandbox-api.bachs.io`. A live key (`sk_live_`) in sandbox mode is refused. Sandbox mode on the production database is refused.

Live mode talks to `https://api.bachs.io` only when `BACHS_LIVE_ALLOWED` is the exact value `true`. Without that flag, live mode, a live key, and the production database are refused. `BACHS_LIVE_TENANT_ALLOWLIST` is required in live mode. Unset, empty, and whitespace refuse every business. A comma-separated list allows those tenant ids by exact match. `*` is the only value that allows every business. Checkout create and webhook settle both check it, including when the caller does not pass an env object. A collection for a business that is not on the list is stored for manual review. Do not put keys in the repo.

Set the sandbox names on Vercel Preview (staging). Leave live mode off there.

| Variable | Staging | Production, only for the first live test |
| --- | --- | --- |
| `BACHS_MODE` | `sandbox` | `live` |
| `BACHS_LIVE_ALLOWED` | leave unset | `true` |
| `BACHS_LIVE_TENANT_ALLOWLIST` | leave unset (sandbox does not use it) | one tenant id. Unset refuses every business. `*` allows every business |
| `BACHS_API_KEY` | sandbox key, entered in the dashboard | live key, entered in the dashboard |
| `BACHS_WEBHOOK_SECRET` | webhook signing secret | live webhook signing secret |
| `BILLING_NOTICES_SEND` | leave unset | leave unset |

The owner sets those names on the Vercel project `scalers-project` (production) and `scalers-staging` (preview). No key belongs in git.

## Documents

An issued invoice has an HTML view and a PDF. Both are A4. The header has the Scalers wordmark on the left. On the right: Invoice, the number, the issue date, the due date, and a status pill (Open, Paid, Overdue, or Void). From and Bill to are two columns. The line table headers are Description, Qty, Unit price, and Amount. The billing period sits under the plan line. Totals are right aligned: Subtotal, Credits applied when any were applied (printed as a negative amount, for example -KSh 600), Total, Amount paid, and Amount due. When a pay URL is passed, the page includes a Pay KSh link and a short M-Pesa note. Above KSh 150,000 that link is the next M-Pesa part (Part 1 of 2, and so on). A live invoice does not embed the pay token, so the link is absent there. The footer has the support contact, the invoice number, and Page x of y. There is no VAT line.

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

Signed-in owner, own business only. The server uses the service role filtered by that tenant. A client cannot pass a tenant id. Invoice, receipt, PDF, and HTML reads do not call the Bachs gate. A live key, live mode, and the production database still refuse checkout and the webhook.

| Method | Path | What Desk gets |
| --- | --- | --- |
| GET | `/api/billing/invoices` | Invoices, lines, and receipts. Money is `KSh 7,000`. A credit total is `KSh -1,000`. `credits_applied` prints the stored positive amount as a negative, for example `-KSh 600`. Amount due is floored at `KSh 0`, and `pay_link_path` is omitted when nothing is owed. |
| GET | `/api/billing/invoices/:id` | One invoice. `?format=html` is the invoice page. |
| GET | `/api/billing/invoices/:id/pdf` | Invoice PDF. |
| POST | `/api/billing/invoices/:id/pay-link` | `{ pay_path: "/pay/<token>" }` once. A second call is 409 `Pay link already issued`. |
| GET | `/api/billing/receipts/:id` | Receipt JSON. `?format=html` or `?format=pdf`. |
| GET | `/api/billing/receipts/:id/pdf` | Receipt PDF. |

Desk builds the Billing screen. This API does not.

## Reconciliation

`billing_payment_reconciliation()` lists attempts pending for more than 30 minutes, invoices or attempts whose status disagrees, issue rows, and overpaid checkouts. It changes nothing.

`node scripts/billing-payment-reconcile.js` prints that report. Sandbox, and only sandbox, then settles pending, pending-unattached, and succeeded attempts from `getCheckout` `charge.amount_paid`. It does not read event amounts. An unreadable read is skipped. Live mode, including the production project, does not run that sweep. It retries only `payment_events` rows with `needs_retry`, through the same `settle_checkout_reading` path, and only when `BACHS_LIVE_ALLOWED=true` and the business is on `BACHS_LIVE_TENANT_ALLOWLIST`. A business that is not on the list is skipped and stays flagged. A second run of an already settled event does nothing.

`GET /api/cron/billing-payment-retry` is the same live retry. It requires `Authorization: Bearer` matching `CRON_SECRET`. A closed gate returns 200 and does not call Bachs. Sandbox mode returns 200 and does not retry. The route is not in `dashboard/vercel.json`, so Vercel does not call it. Once P14 is on that database, `CRON_SECRET` is set, and live payments are intended, the schedule is minute 7, 22, 37, and 52 (`7,22,37,52 * * * *`). Until then, run `node scripts/billing-payment-reconcile.js` with the live env. Do not turn the job on in production from this change.

## Sandbox drill (19 Oct 2026, 02:18 EAT)

Against `https://sandbox-api.bachs.io` only, with the staging preview `BACHS_MODE=sandbox` key. No live key, no `api.bachs.io`, no production database. The key is not in this repo.

The rows were a synthetic tenant, `Invoice Pay Drill`, number `pending:invoice-pay-drill`, enforcement `soft`, subscription `active` (not beta), on starter's package id only as a foreign key. It is not one of the six staging businesses. Five drafts were finalized, then the tenant was deleted. Issued notices were `skipped` / `no recipient` and were deleted with the tenant. Nothing was sent. No payment, attempt, token, receipt, or credit row was written. The six businesses and the letterhead row were unchanged. `billing_invoice_counters` for 2026 stays at 5, so `SCL-2026-000001` through `SCL-2026-000005` are not reused. After cleanup: 0 invoices, 0 notices, 0 attempts.

Phone `+254700000099`. Email `drill@example.com`. Hosted creates used the same body as the pay client: `pricing.currency` KES, `payment_method_types` `MOMO_KES`, public example.com return URLs. Collection, underpay, and the overpay attempt used custom checkout (`ui_mode: custom`) plus `POST .../confirm` with `simulated_outcome`, because that is the sandbox API for a result. Hosted M-Pesa results are page controls (succeed, fail, underpaid), not a request field.

| Case | Invoice | Session | Result |
| --- | --- | --- | --- |
| Collection | SCL-2026-000001, KSh 1,000 | `chk_EtETcFcM12cZmJOp` | `simulated_outcome=success`. Confirm `201` `3af8822e-2ad9-4ed8-bc8d-1e0a3f564e73`. GET `9d56cc35-f0bf-4bc8-be4c-e4f2edfdd2b2`: session `completed`, `payment_status` `succeeded`, charge `succeeded`, `amount_paid` `1000.00`. |
| Cancel | SCL-2026-000002, KSh 1,500 | `chk_Z5Tgi5myjj5i325Z` | Create `201` `ffd058b1-decc-4121-b501-e475ac84f28a`, status `open`. GET before `f8ff8b7e-d17c-4be9-b767-d9c52852a871`. `POST /v1/checkout-sessions/{id}/cancel` `404` `NOT_FOUND` `a3294288-62d6-4a2e-9f36-a22466974b06`. GET after `a2008721-b31a-4167-a98b-c32a4d45ba58`: still `open`, `payment_status` `requires_payment_method`, charge `open`, `amount_paid` `0.00`. The route does not void the session. |
| Underpay | SCL-2026-000003, KSh 2,000 | `chk_oAm3Rzf0PFzHOkdx` | `simulated_outcome=underpaid`. Confirm `201` `337c31b3-dfaf-48fb-9656-124e4639f74e`. GET `cd12cfc3-ad71-439f-bf63-ef72bf44ae5c`: session stayed `open`, `payment_status` `requires_action`, charge `underpaid`, `amount_paid` `1400.00`, `amount_remaining` `600.00`. |
| Overpay | SCL-2026-000004, KSh 2,500 | `chk_KZjG3TERFeUmPa2b` | `simulated_outcome=overpaid` refused. Confirm `400` `VALIDATION_ERROR` `153defff-31a9-4608-ba98-91cb69fc7ae1`: `simulated_outcome` must be `success`, `failed`, or `underpaid`. GET `94cb2bec-664a-4537-9c6e-20e1478e6c4a`: still `open`, `amount_paid` `0.00`. Overpay cannot be simulated. |
| Split | SCL-2026-000005, KSh 200,000 | `chk_L1whw5ryGM6ftSNi`, `chk_6uQQ4FT7UsteSMco` | `invoice_kes_parts` returned `100000, 100000`. Two hosted sessions, KSh 100,000 each. Create `201` `c3a3d92b-8a21-4713-b63f-bd3675b5c58a` and `f1a9f9e3-16e3-43d7-b45f-30254efd3196`. Both `open`. |

The same `POST .../cancel` on the two split sessions (`e266ae28-092b-4f84-adf0-fd1db69b7994`, `30f79224-5592-4f22-b310-9b5f84c786b1`) and on the custom overpay session (`781f411a-739a-42a5-ae97-b84f3d1f5a04`) was also `404`. The session stayed `open`. `DELETE` on the cancel session was `405` `7109a021-6ade-4d5b-9211-2a08d4c7d591`. `PATCH` with `status: cancelled` was `400` `01b18d32-df51-4809-9cf3-ade8b70d334d` (it asked for `currency` and `payment_method`). `POST .../expire` was `404` `8e61fc8f-1e97-4d9c-a4d0-e25f4dc0f0a2`. None of those changed the session off `open`.

The pay client treats HTTP 404 from that cancel path as success, then GETs the session. Because the sandbox leaves it `open`, the next click reuses the stored URL or blocks with `Previous payment still processing.` It does not insert a second attempt. A real void is not available on this sandbox route. The hosted cancel and split sessions expire at `2026-10-18T23:48:55Z`. The custom underpay and overpay sessions used the 60-minute default and expire at `2026-10-19T00:18:58Z`. No staging invoice was marked paid from these charges.

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
