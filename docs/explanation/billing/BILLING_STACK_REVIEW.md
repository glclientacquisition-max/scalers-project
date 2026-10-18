---
owner: ops-billing
last_reviewed: 2026-10-18
---

# Billing stack review, 18 Oct 2026

Review only. No SQL applied. No production access. The four pull-request branches were not pushed.

Reviewed heads:

| PR | Branch | Head | What it adds |
| --- | --- | --- | --- |
| #775 | `cursor/billing-data-layer-cc4b` | `65e7935b` | Subscriptions, invoices, payments, notices, quarantine |
| #781 | `cursor/owner-billing-actions-5c64` | `3c086b26` | Plan change, proration, seats, spend limit, call debit |
| #780 | `cursor/invoice-pay-0c16` | `f4ede208` | Pay tokens, Bachs checkout, webhook, splits, receipts |
| #778 | `cursor/admin-package-versions-b52e` | `965461f4` | Admin moves, beta switch, version fields |

#780 and #781 and #778 are siblings on top of #775. This review was written from `f4ede208` (#775 + #780 in the tree) and from `git show` of the other two heads. Staging project `sgcdncjxauhsbunobmob` was not queried. Production `fjxcdccgyhnvnnlnovcl` was not opened.

Failing tests that encode the required money outcomes live on `cursor/billing-review-tests-7822`. Command and result:

```text
node --test tests/billingReviewMoney.test.js tests/billingReviewContracts.test.js
# tests 14
# pass 0
# fail 14
```

## Safe to ship to prod?

No pull request in this set is safe to take live M-Pesa, and none is safe to turn billing enforcement on.

| PR | Verdict |
| --- | --- |
| #775 | **No.** Keep it as the staging schema the others sit on. Do not apply it to production until the pay and debit fixes below are in the same release. Re-applying this file after `invoice_documents.sql` puts invoice numbers back to `SC-` and the due-notice kind back to `platform_billing_invoice_due`. |
| #781 | **No.** A null spend cap uses half the monthly price and ignores `spend_limit_share_percent`. Call debit uses `billing_rate_card` id 1, not the pinned version rate, and it debits a business whose `billing_status` is still `beta` once enforcement is `soft` or `hard`. The extra-seat backfill raises if the #778 freeze is already installed and a published paid row still has a null seat price. |
| #780 | **No.** Two Pay clicks, or a second click after the 60 minute checkout expires, open two Bachs sessions. Paying both takes the money twice. A succeeded collection that is not an exact shilling match, and any `collection.underpaid`, leaves the invoice open. A payment against a void invoice is a silent HTTP 500 and is then dropped when Bachs stops retrying. Live mode is hard-refused today. Lifting that refuse without the fixes below would charge customers twice. |
| #778 | **No for turning billing on.** The editor does not itself create an invoice, and a move does not change `billing_status` or enforcement. `admin_set_tenant_billing_mode` accepts `billing_status = beta` together with enforcement `soft` or `hard`. After that confirmed write, #781 debits calls and applies the spend cap while the business is still beta. Version per-minute rates are not what the debit uses. |

## Blocker

### B1. Two live checkouts can both be paid

`create_invoice_pay_attempt` does not lock the invoice. It reuses a pending attempt only when that attempt already has a checkout URL and the checkout has not expired.

```378:405:docs/supabase/invoice_pay.sql
  select * into v_existing
  from public.payment_attempts
  where invoice_id = v_invoice
    and status = 'pending'
    and part_index = v_part.part_index
    and checkout_url is not null
    and checkout_expires_at is not null
    and checkout_expires_at > now()
  ...
  insert into public.payment_attempts (
```

The same rule is what the pay page runs, in `dashboard/src/lib/invoicePay/checkoutFlow.js:23-70` and in the in-memory copy at `tests/invoicePayMemory.js:113-148`. There is no unique partial index on `(invoice_id, part_index) where status = 'pending'`.

The webhook treats the Bachs checkout id as `provider_ref` (`dashboard/src/lib/invoicePay/webhook.js:186`). Two checkout ids are two payments. `apply_payment` caps the invoice at its total and inserts the extra as a tenant credit (`docs/supabase/billing_data_layer.sql:1550-1585`, key `overpay:<provider>:<ref>`). That credit is not an M-Pesa refund. The customer has been collected twice.

`tests/invoicePay.test.js:470` asserts the unsafe case: after 61 minutes it mints a second reference and leaves the first attempt pending. A customer who still has the first STK prompt, or who pays both links, is charged twice. On a KSh 200,000 invoice the first slice is KSh 100,000. Two first slices collect KSh 200,000 and mark the invoice paid, with the second KSh 100,000 sitting as an internal credit. A second click on a KSh 1,000 invoice collects KSh 2,000.

The window is any overlap before `attach_invoice_pay_checkout` commits (double tap, two tabs) and any new attempt after `checkout_expires_at` (default 60 minutes, max 1440). Bachs references are single-use, so the replacement cannot reuse the first session. The first session stays payable until Bachs expires it.

Repro, now failing on purpose:

- `tests/billingReviewMoney.test.js` "reuses one checkout when Pay is clicked twice" failed with `actual: 2`, `expected: 1` Bachs `createCheckout` calls.
- "cancels the expired pending checkout" failed with attempt status `pending`, expected `cancelled`.
- "does not collect more than the invoice when two checkouts are both paid" failed with `collected 200000 cents` against a KSh 1,000 invoice.

Exact fix, in one transaction inside `create_invoice_pay_attempt`:

1. `select * from public.invoices where id = v_invoice for update`.
2. Treat any `pending` attempt for that invoice and part as in flight, including a row whose `checkout_url` is still null.
3. When the existing checkout is expired, set that attempt to `cancelled` in the same transaction, and cancel the Bachs session before inserting another row.
4. Add `create unique index ... on public.payment_attempts (invoice_id, part_index) where status = 'pending'`.
5. In `handlePayWebhook`, do not apply a collection for an attempt whose status is `cancelled`.

## High

### H1. A succeeded collection that is not the exact part is dropped, and that checkout can never be corrected

`decidePayment` in `dashboard/src/lib/invoicePay/webhook.js:81-112`:

- `collection.underpaid` returns `issue` before the amount is read (line 83).
- `collection.succeeded` with status `SUCCEEDED`, `ACCEPTED`, `paid`, `complete`, or `completed` applies only when the KES cents equal the part (lines 109-112).
- Status `OVERPAID` applies the received KES (line 108) even when it does not equal the part. One cent over with status `SUCCEEDED` does not.

An `issue` row does not increase `amount_paid_kes` (`docs/supabase/invoice_pay.sql` `record_payment_issue`). The attempt is then marked `issue` (`webhook.js:237-244`). The next event on that same checkout returns at `webhook.js:183-185` because the attempt status is `issue`, or at `webhook.js:187-191` if any payment row already uses that checkout id as `provider_ref`. Bachs will not get another checkout id for that reference. The invoice stays open. The next Pay click mints a new session (B1) and the customer pays the full remainder again.

Money: a KSh 1,000.01 STK against a KSh 1,000 invoice is taken and not credited. A KSh 400 `collection.underpaid` is taken and not credited. The customer can then pay KSh 1,000 on a new link. Collected KSh 1,400.01, invoice credited KSh 1,000, first collection stuck as `issue`.

Repro, failing:

- "applies a SUCCEEDED collection that is one cent over the part" got `action` `issue`, expected `apply`.
- "credits the shillings received on collection.underpaid" got `action` `issue`. The invoice stayed at `0`.
- "applies a later exact KES collection after an earlier issue" left the invoice `open` after a USD-only event followed by an exact KES event on the same checkout.

Exact fix in `decidePayment` and `handlePayWebhook`:

- A terminal collection with KES cents greater than or equal to the part applies the part and credits the extra through the existing overpay path.
- `collection.underpaid` with a positive KES amount applies that amount as `partial`.
- An `issue` attempt with no applied payment must still accept a later exact KES event on that checkout. Do not use an issue row as the idempotency key that blocks a still-open invoice. Keep idempotency on a real applied `(provider, provider_ref)`.

### H2. Money collected against a void or replaced invoice is thrown away

`apply_payment` raises `invoice cannot be paid` for `void` and `uncollectible` (`docs/supabase/billing_data_layer.sql:1535-1536`) and raises for a draft (line 1538). It raises before the insert, so there is no payment row and no unmatched credit.

`handlePayWebhook` does not catch that error (`dashboard/src/lib/invoicePay/webhook.js:213`). The route turns every throw into HTTP 500 and logs nothing:

```41:42:dashboard/src/app/api/billing/bachs/webhook/route.ts
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
```

`record_payment_event` has already committed in its own RPC (`dashboard/src/lib/invoicePay/ledger.ts` calls it before `apply_payment`). Bachs retries for about 80 minutes and then stops. After that the collection exists only inside `payment_events`. The M-Pesa debit is real. The ledger has no payment.

These four pull requests do not void an open invoice themselves. The hole is any later void, replace, or draft rewind of an invoice that still has a live checkout. Severity stays High because the money is already collected by the time the raise happens.

Repro: `tests/billingReviewMoney.test.js` "records a voided invoice collection" throws `invoice cannot be paid` from `webhook.js:213`. The route contract test fails because the catch is empty.

Exact fix:

- In `handlePayWebhook`, catch `invoice cannot be paid`, call `record_payment_issue` (or insert `match_status = 'unmatched'`) with the KES amount, and return 200.
- In the route, log the error message without the secret, the raw body, or the API key. Return 200 for that specific error so Bachs stops retrying a collection that can never apply. Return 500 only when the row was not stored.

### H3. The default spend cap ignores the published share, and it still applies while status is beta

`billing_spend_limit_kes` on #781 (`docs/supabase/owner_billing_actions.sql:1238-1266`) returns null only when `billing_enforcement` is `off` (lines 1253-1254). It does not read `billing_status`. When `soft_spend_limit_kes` is null it returns `round(v_monthly * 0.5, 0)` (line 1266).

#778 stores `spend_limit_share_percent` on the version (default 50, editable on a draft; the freeze at `package_version_editor.sql:326` locks it once published). Starter version 2 is KSh 7,000. A published share of 20 percent must cap on-demand at KSh 1,400. This function caps at KSh 3,500. The business can be debited KSh 2,100 past the price the admin published.

The same function returns a cap for `billing_status = beta` whenever enforcement is `soft` or `hard`. That enforces a limit on a beta business, which this review treats as a charge.

`owner_change_plan` does check both flags and returns without an invoice (`owner_billing_actions.sql:828`). The spend function does not.

Repro: `tests/billingReviewContracts.test.js` "defaults the spend cap from spend_limit_share_percent" fails. The function body has `v_monthly * 0.5` and does not contain `spend_limit_share_percent`.

Exact fix, replace line 1266 and the enforcement-only guard:

```sql
if coalesce(v_tenant.billing_enforcement, 'off') = 'off'
   or exists (
     select 1 from public.tenant_subscriptions s
     where s.tenant_id = p_tenant_id and s.billing_status = 'beta'
   ) then
  return null;
end if;
-- ...
return round(v_monthly * v_share / 100, 0);
```

Read `v_share` from the pinned `billing_package_versions.spend_limit_share_percent`. Refuse a null share rather than substituting 50 in this function. The version default of 50 already covers a new row.

### H4. Call debit uses the legacy rate card and ignores `billing_status = beta`

`consume_call_seconds` on #781 (`owner_billing_actions.sql:1641-1660`):

- Lines 1642-1644 set the amount to 0 only when `billing_enforcement = 'off'`.
- Lines 1648-1655 read `billing_rate_card` where `id = 1`.

The published version rates (Starter inbound KSh 26 a minute stored per second, Growth 25, Scale 24, outbound 34) are not read. Publishing a version price does not change the wallet debit. A business with `billing_status = beta` and enforcement `soft` is debited.

`admin_set_tenant_billing_mode` allows that pair. After the confirm check it rejects only `active` plus enforcement `off` when the previous status was `beta` (`package_version_editor.sql:1741-1760`). `beta` plus `soft` is written. STATUS on #778 records a rolled-back probe that set enforcement to `soft` and left status `beta`. The function would commit that write outside a probe transaction.

`mint_invoice_pay_token` has the same hole for pay links: it refuses enforcement `off` only (`docs/supabase/invoice_pay.sql:206-208`). `finalize_invoice` checks neither flag (`billing_data_layer.sql:1428`, replaced by `invoice_documents.sql:229`). Owner plan and seat wrappers do check both, so they will not open a proration invoice while status is beta. A direct service-role `finalize_invoice` on a beta tenant will still number the invoice and queue a notice. Once enforcement is `soft`, the pay link mints.

Repro: the contract test "debits on-demand seconds from the pinned package version" fails. `consume_call_seconds` contains `from public.billing_rate_card` and does not contain `billing_status = 'beta'` or `billing_package_versions`. The billing-mode test fails because the function has no `if p_billing_status = 'beta' and p_enforcement is distinct from 'off'`.

Exact fix:

- In `consume_call_seconds`, if enforcement is `off` or `billing_status` is `beta`, set the amount to 0 and do not read a rate.
- Otherwise take `inbound_kes_per_second` or `outbound_kes_per_second` from the pinned `billing_package_versions` row. Do not fall back to `billing_rate_card` for a tenant who has a pinned version.
- In `admin_set_tenant_billing_mode`, raise unless the pair is (`beta`, `off`) or (`active`, `soft` or `hard`).
- In `mint_invoice_pay_token` and `finalize_invoice`, raise when `billing_status` is `beta`, same as enforcement `off`.

### H5. The #781 extra-seat backfill hits the #778 freeze

#778 `billing_package_versions_freeze` raises `published package version is frozen` when `extra_seat_monthly_kes` changes on a non-draft row (`package_version_editor.sql:327` and `:343`). There is no bypass GUC.

#781 then runs, on every apply:

```55:60:docs/supabase/owner_billing_actions.sql
update public.billing_package_versions v
set extra_seat_monthly_kes = 500
from public.billing_packages p
where p.id = v.package_id
  and p.sku in ('starter', 'growth', 'scale')
  and v.extra_seat_monthly_kes is null;
```

That `UPDATE` is not wrapped in `disable trigger`. The seat-price trigger in the same file is created after the update, so it does not protect this statement. The editor trigger does.

On current staging the paid rows are already 500, so a re-run matches zero rows and does not fire. Production has neither script. Apply #778 first, publish paid versions with a null seat price, then apply #781: the statement raises and the migration stops halfway. The contract test fails because the 800 characters before `set extra_seat_monthly_kes = 500` do not disable `billing_package_versions_freeze`.

Exact fix: around that update, `alter table public.billing_package_versions disable trigger billing_package_versions_freeze`, run the update, then `enable trigger`. Apply #781's backfill before #778 only if you also keep this disable, because a later re-apply of #781 must still succeed after the freeze exists.

## Medium

### M1. A reclaimed billing notice can send twice across an hour boundary

`claim_billing_notices` reclaims a `sending` row whose `claimed_at` is null or older than 15 minutes (`docs/supabase/billing_data_layer.sql:1080-1094`). It does not change `idempotency_key`.

`sendClaimedBillingNotices` sends only when `BILLING_NOTICES_SEND` is exactly `on` (`src/billing/billingNoticeSend.js:15-17`). Kinds `platform_billing_*` are billed to the platform because `billedTo` treats any kind that starts with `platform_` as platform (`src/notifications/sendLedger.js:37`). They do not burn tenant message credits.

The dispatch ledger is `{ tenantId, kind }` only (`billingNoticeSend.js:32`). `personKey` then falls through to `ops:<tenant>:<kind>:<person>:<hour>` (`sendLedger.js:442`). A reclaim in the next hour gets a new notify idempotency key. The owner can receive a second "invoice issued" or "payment received" message. It is a duplicate text, not a second M-Pesa charge.

Repro: the notice test expected `ledger.keyBase` `platform_billing_invoice_issued:inv1` and got `undefined`.

Exact fix: pass `ledger.keyBase` as `row.idempotency_key`. That key is stable for the life of the notice. Keep the `BILLING_NOTICES_SEND` gate.

### M2. Re-applying the data-layer file undoes #780 invoice numbers

`billing_data_layer.sql:1457` sets `SC-YYYY-000001` and queues `platform_billing_invoice_due` (lines 1471-1472). `invoice_documents.sql:258` replaces `finalize_invoice` with `SCL-YYYY-000001` and `platform_billing_invoice_issued` (lines 272-273). `CREATE OR REPLACE` keeps the later body only until someone runs the older file again.

#781's apply-order row calls `owner_billing_actions.sql` step 33j and says a later re-apply of the older consume SQL drops the spend-limit hook. #780's apply-order row calls `invoice_pay.sql` step 33j. The two sibling branches claim the same step number for different files. A merge that concatenates those rows will apply one of them in the wrong place.

Exact fix: one apply order, after all four merge. Suggested sequence: `billing_data_layer.sql`, then the #781 extra-seat backfill with the trigger disabled, then `owner_billing_actions.sql`, then `invoice_pay.sql`, then `invoice_documents.sql`, then `package_version_editor.sql`. Never re-apply `billing_data_layer.sql` or the pre-#781 consume SQL after that. Add a header comment on `finalize_invoice` in the data layer: do not run this file after `invoice_documents.sql`.

### M3. A checkout response without `expires_at` orphans a live session

`BachsPayProvider` sets `expiresAt: json.expires_at || null` (`dashboard/src/lib/invoicePay/provider.js:219`). `attach_invoice_pay_checkout` raises when expiry is null (`docs/supabase/invoice_pay.sql:447-449`). `startInvoiceCheckout` catches only `createCheckout` (`checkoutFlow.js:62-65`). The attach throw leaves the attempt `pending` with a null URL, and the Bachs session already exists. The next click takes the B1 path and opens a second session. If Bachs already pushed an STK to `customer.phone_number`, both sessions can collect.

This is unproven against the sandbox response shape. The code path is unconditional when `expires_at` is absent.

Exact fix: if the create response omits `expires_at`, set it from `expires_in_minutes` (the request already sends 60, capped at 1440) before attach. On attach failure, mark the attempt `failed` and cancel the session id.

## Low

### L1. `toCents` of a JavaScript number uses `toFixed(2)`

`dashboard/src/lib/invoicePay/money.js:12-14`. In Node, `(1.005).toFixed(2)` is `"1.00"`. Webhook amounts that arrive as strings with at most two decimal places are fine. A numeric `1000.005` would be short by one cent and then hit H1.

Exact fix: reject `typeof amount === "number"` in `toCents`. Callers already have decimal strings.

### L2. SQL attach allows `http://`

`invoice_pay.sql:444` uses `^https?://`. The JS provider requires `https://` (`provider.js:210-213`). Only a service-role caller of the SQL function can attach an `http` URL.

Exact fix: change the SQL check to `^https://`.

### L3. `billing_add_months` is granted to `authenticated`

On #781 this is a pure date function. It does not write money. Leave the grant, or revoke it for consistency with the other billing functions. Not a charge path.

## Checked, and holding

These were inspected and are not findings.

- HMAC is SHA-256 over `` `${timestamp}.${rawBody}` ``, hex, `crypto.timingSafeEqual` after a length check (`dashboard/src/lib/invoicePay/signature.js:14-34`). The route reads `request.text()` before verify (`route.ts:26-39`). An empty secret returns 401 (`webhook.js:130`). A body that changes does not verify. V1 (`x-bachs-timestamp` + `x-bachs-signature`) and V2 (`t=`, `v1=`) are both checked (`signature.js:41-67`). Skew is 300 seconds (`signature.js:6`). The code comment says each retry is signed again. This review did not re-test Bachs retry signing, so the 300 second window is not flagged against the 80 minute retry life.
- `BACHS_MODE=live`, an `sk_live_` key, and the production project ref are refused before a checkout or a webhook apply. The webhook route returns 403 when mode is `live` (`route.ts:13-15`). The provider error log records the error code, request id, and status, not the key or the body.
- The same checkout id cannot double-credit. `payments` is unique on `(provider, provider_ref)`. `apply_payment` locks the existing row and returns it (`billing_data_layer.sql:1522-1527`). `payment_events` is unique on `(provider, event_key)`. Two concurrent deliveries of one checkout: one winner, one unique violation, retry is then a no-op. That is not B1. B1 is two checkout ids.
- Pay token is `pay_` plus 32 random bytes, only the SHA-256 hex is stored, expiry is 7 days, one active token per invoice, rotate revokes. Token functions set `search_path` to `public, extensions`. Execute is revoked from `public`, `anon`, and `authenticated`.
- Invoice, receipt, and pay-link reads in the dashboard filter by the session tenant after `assertBachsAllowed()`. The public `/pay/[token]` page reads by token hash and does not mark an invoice paid. The return URL only shows attempt status. Reconciliation is a report. It does not settle.
- Admin package routes use the admin cookie (`isLegacyAuthenticated` is `isAdminAuthenticated`). SQL `admin_*` functions are service-role only. Moves and billing-mode require `p_confirm` true and write `billing_audit_log`. `packageEditorWritesAllowed` is false when the Supabase URL contains `fjxcdccgyhnvnnlnovcl` unless `ADMIN_PACKAGE_EDITOR_ALLOW_PROD` is `on`. The actor is the admin session, not the request body. A version move must not change `billing_status` or enforcement, and `system_move` skips beta.
- Seat count is members plus pending unexpired invites. The owner is a member, so the owner is counted once. Extra seat backfill value is KSh 500. Proration is whole shillings, half away from zero, Nairobi dates. A published per-minute price round-trips through the editor's per-second storage for the current catalogue (26, 25, 24, 34, and trial 6 per minute). The debit still ignores those rates (H4). That display check is not a billing check.
- Invoice numbers: `update ... last_number = last_number + 1` holds the counter row. Drafts stay unnumbered. Void keeps the number. Receipts are `RCT-YYYY-000001`, one per payment, and the trigger skips `issue` (`invoice_documents.sql:417-429`). Gapless under concurrency for a single counter row. Not safe if two files fight over `finalize_invoice` (M2).
- `DASHBOARD_OPEN=true` still bypasses the admin cookie. That hole is older than these four pull requests. Do not enable it on a host that can call these RPCs.

## What was not done

- No Bachs sandbox call in this review. Amount, currency, expiry, and signature facts are the ones given for 18 Oct 2026, checked against the code paths above.
- No staging SQL. Whether a published row on staging still has a null `extra_seat_monthly_kes` was taken from #778 STATUS (paid rows are 500). The freeze hazard is the production apply, not a second staging backfill.
- No test here executes the SQL. The contract tests read the function text. The money tests drive the JS webhook and the in-memory ledger that copies the SQL reuse rule.
