---
owner: ops-billing
last_reviewed: 2026-10-18
---

# Billing stack review, 18 Oct 2026

Round 2 is the current verdict. Round 1 is kept below it.

Review only. No SQL applied. No production access. The four pull-request branches were not pushed.

Reviewed heads:

| PR | Branch | Head | What it adds |
| --- | --- | --- | --- |
| #775 | `cursor/billing-data-layer-cc4b` | `65e7935b` | Subscriptions, invoices, payments, notices, quarantine |
| #781 | `cursor/owner-billing-actions-5c64` | `3c086b26` | Plan change, proration, seats, spend limit, call debit |
| #780 | `cursor/invoice-pay-0c16` | `f4ede208` | Pay tokens, Bachs checkout, webhook, splits, receipts |
| #778 | `cursor/admin-package-versions-b52e` | `965461f4` | Admin moves, beta switch, version fields |

#780 and #781 and #778 are siblings on top of #775. This review was written from `f4ede208` (#775 + #780 in the tree) and from `git show` of the other two heads. Staging project `sgcdncjxauhsbunobmob` was not queried. Production `fjxcdccgyhnvnnlnovcl` was not opened.

## Round 2

Re-review only. The four pull-request branches were not pushed. No SQL was applied to staging `sgcdncjxauhsbunobmob` or production `fjxcdccgyhnvnnlnovcl`. Local Postgres 16.15 ran the harnesses. The integration branch `cursor/billing-review-round2-7822` merges the four heads below and was used only to run tests.

| PR | Branch | Round 2 head |
| --- | --- | --- |
| #775 | `cursor/billing-data-layer-cc4b` | `be16ad70` |
| #781 | `cursor/owner-billing-actions-5c64` | `c0e0afe3` |
| #780 | `cursor/invoice-pay-0c16` | `5d003dfd` |
| #778 | `cursor/admin-package-versions-b52e` | `cee8e054` |

### Safe for prod schema apply, and safe for live money?

The merged stack is not safe to apply as a production schema, and it is not safe to take live M-Pesa. One new blocker stops every invoice: after P1, later copies of `finalize_invoice` write the number and status without `scalers.billing_write`, and `invoices_freeze` rejects the write.

| PR | Safe for prod schema apply | Safe for live money |
| --- | --- | --- |
| #775 | **Conditional.** P1 and P2 can land on a database whose backfill finds a published version for every subscription. The script raises and rolls back otherwise (`billing_data_layer.sql:457-461`). The down script drops the layer. Do not re-run P1 after P6. | **No.** P1 can issue an `SC-` invoice. Once P4, P6, or `billing_company.sql` replaces `finalize_invoice`, no invoice can be issued. |
| #781 | **No**, once #775 is applied. The owner harness dies inside `owner_change_plan` because its `finalize_invoice` cannot pass the freeze. The extra-seat backfill itself disables both freeze triggers, writes KSh 500, and turns them back on. | **No.** Beta metering and the spend share are in this file. Invoices from a plan change cannot be issued, and the seat credit cannot commit. |
| #780 | **No**, once #775 is applied. P5 (pay attempts) applies. P6 and `billing_company.sql` both replace `finalize_invoice` and both omit `scalers.billing_write`. | **No.** A cancelled attempt can still be collected, that money is stored as an issue and is not credited, and a second checkout can collect the same invoice. "Payment received" shows when any KES is already applied. |
| #778 | **Yes, last.** The editor harness applied the file twice and then `package_version_owner_prices.sql` twice. It does not turn enforcement on. Set `package_editor_enabled` false before any production apply, as the file header says. | **No.** Do not turn a business active until the invoice freeze is fixed and an active business without a pin is refused. |

### What the tests did

Throwaway databases only. `sudo -u postgres psql`. Never Supabase.

| Run | Result |
| --- | --- |
| `tests/sql/billing_data_layer/run.sh` | EXIT 0. Second apply of P1 after an SCL body printed `finalize_invoice already numbers SCL-; leaving the invoice_documents.sql body in place` (`billing_data_layer.sql:1532`). |
| `tests/sql/owner_billing_actions/run.sh` | EXIT 3. `10_scenarios.sql:567`: `invoice number and status are set only by finalize_invoice`, from `invoices_freeze` line 11, called by owner `finalize_invoice` line 40, called by `owner_change_plan`. |
| `tests/sql/package_version_editor/run.sh` | EXIT 0. |
| Fresh database `billing_stack_p1_p7`, files in the P1–P7 order from `docs/supabase/README.md` (lines 174–182), then `billing_company.sql` because that file also replaces `finalize_invoice` | After P1: open invoice `SC-2026-000001`, body sets `billing_write`. After P4: freeze error, body has the credit path and `SC-`, no `billing_write`. After P6: freeze error, body is `SCL-`, credit path gone. After `billing_company.sql`: freeze error. After P7: freeze error (the editor does not replace finalize). A negative draft then raised the same freeze error and left `tenant_credits` at 0. |
| `node --test tests/billingReviewMoney.test.js tests/billingReviewContracts.test.js` on the merged tree | 23 tests, 23 pass. |
| Other billing node tests on the merged tree (`invoicePay`, `invoiceDocuments`, `ownerBillingActions`, `planProration`, `billingNoticeSend`, `billingDataLayerReview`, `billingModeContracts`, `packageVersionEditor`, `packageRates`, `packageOverage`, `packageStateRules`, `packageUsageAlerts`, `grantPackageMinutes`, `adminBillingCleanup`, `billingStateModel`) | 141 pass. `tests/inboundBillingGate.test.js` failed to load because `express` is not installed in this environment. |
| `tests/packageUsage.test.js` | 5 failures are desk copy regexes. The seconds-to-minutes case passed. |
| `tests/invoicePaySql.test.js` | Not run. `@electric-sql/pglite` is not installed. |

### Finding status

| ID | Status | Evidence |
| --- | --- | --- |
| B1 | Partly | `create_invoice_pay_attempt` locks the invoice (`invoice_pay.sql:388`) and treats any pending row as in flight, including a null URL (`:408-443`). An expired row is set `cancelled` in that call and the function returns `cancel: true` without inserting the replacement (`:416-431`). Unique partial index `payment_attempts_one_pending_part` (`:64-66`). The #784 overlapping-pay and expired-cancel tests passed. `checkoutFlow.js:55-62` swallows `cancelCheckout` errors and then calls `createAttempt` again. The SQL row is already cancelled, so the unique index allows the new pending row. A failed cancel leaves the old Bachs session payable. This review did not call that endpoint. |
| H1 | Partly | `decidePayment` applies a positive `collection.underpaid` as `apply_partial` (`webhook.js:84-87`). `got >= expected` applies or `apply_overpaid` (`:112-114`). `OVERPAID` below the part is `apply_partial` (`:116`). The one-cent-over and underpaid #784 tests passed. A short terminal `SUCCEEDED` (`got < expected`, not overpaid) is still `issue` (`:117`). An issue row is not treated as applied (`:220-221`), so a later exact event can apply (`invoice_pay.sql:913`). If Bachs never sends that second event, the short collection stays an issue and is not credited. |
| H2 | Fixed | The webhook catch records an issue and returns 200 (`webhook.js:247-255`). The route logs the message and returns 200 for `invoice cannot be paid` and `draft invoices are not payable` (`dashboard/src/app/api/billing/bachs/webhook/route.ts:41-46`). The #784 test passed. The catch body is `{ ok: true }` and does not include `action: "issue"`. |
| H3 | Fixed | `billing_spend_limit_kes` returns null when enforcement is off or `billing_status` is beta (`owner_billing_actions.sql:1405-1412`). Otherwise it uses the pinned `spend_limit_share_percent` (`:1426-1442`). A null share coalesces to 50 (`:1432`). After P7 the column is `not null default 50` (`package_version_editor.sql:126`), so a stored null cannot exist. A missing version returns null (`:1439-1440`), which is no cap. See deviation (c). |
| H4 | Partly | Enforcement off or `billing_status` beta debits 0 (`owner_billing_actions.sql:1822-1824`). A pinned version uses `inbound_kes_per_second` / `outbound_kes_per_second` (`:1841-1848`). There is no rate-card fallback. A missing row or a missing column becomes `coalesce(v_rate, 0)` (`:1850`) and the seconds are still metered. See deviation (a). |
| H5 | Fixed | The extra-seat backfill disables `billing_package_versions_freeze` and `billing_package_versions_freeze_seat`, sets starter/growth/scale null seats to 500, and enables both triggers (`owner_billing_actions.sql:60-101`). P7 last is documented. The editor harness passed, including a second apply of owner prices. |
| H6 | Fixed | `consume_sms_units` is revoked from `public`, `anon`, and `authenticated`, granted to `service_role`, and caps units at 30 (`owner_billing_actions.sql:2094-2100`). Beta or enforcement off meters without a debit (`:1996`). The #784 contract test passed. The SMS price still comes from `billing_rate_card` id 1. That is a price source, not a member wallet debit. Deviation (b) is `reserve_notify_send`, a different function. |
| H7 | Partly | `adjust_payment_overpay` locks the payment, raises `amount_kes`, and inserts a credit for the delta only (`invoice_pay.sql:883-906`). The #784 test passed. The receipt trigger is `AFTER INSERT` only (`invoice_documents.sql:437-440`), so the receipt keeps the first amount. The adjust function does not change `invoices.amount_paid_kes`. The extra is a credit, not a second payment row. New finding N2. |
| H8 | Partly | The owner `finalize_invoice` keeps a negative total, inserts one `tenant_credits` row with key `invoice-credit:<id>`, and would mark a paid zero invoice (`owner_billing_actions.sql:1192-1222`). That function does not set `scalers.billing_write`. On the merged stack the freeze raises and the credit rolls back (owner harness, and the P1–P7 probe: negative draft, `tenant_credits` count 0). P6 and `billing_company.sql` replace the function and drop the credit branch. `roll_package_periods` reads the pinned version (`package_period_rollover.sql:214-252`). |
| H9 | Fixed | `admin_set_tenant_billing_mode` allows only `(beta, off)` or `(active, soft|hard)` and requires `p_confirm` (`package_version_editor.sql:1739-1756`). `set_tenant_billing_mode` refuses enforcement other than `off` while status is beta and does not set status to active (`wallet_security_beta.sql:348-357`). The admin billing route's `set_billing_mode` action calls `confirmTenantBillingMode`. The #784 contract tests passed. This function does not require a pin. See deviation (a). |
| M1 | Fixed | `sendClaimedBillingNotices` sets `ledger.keyBase` to `row.idempotency_key` (`src/billing/billingNoticeSend.js:48`). The #784 test passed. `BILLING_NOTICES_SEND=on` remains the gate. |
| M2 | Partly | P1 refuses to replace a body that already contains `SCL-` (`billing_data_layer.sql:1460-1467`). The data-layer harness printed that notice. P4's `CREATE OR REPLACE` is unconditional and writes `SC-` without `billing_write` (`owner_billing_actions.sql:1170-1237`). The owner file header says to re-apply it after the consume and notify SQL. That re-apply after P6 puts `SC-` back and still omits the flag. P6 and `billing_company.sql` also replace finalize unconditionally. |
| M3 | Fixed | `checkoutFlow.js:121` sets expiry to now plus 60 minutes when Bachs omits `expiresAt`. Attach failure marks the attempt failed and best-effort cancels (`:128-136`). SQL attach still requires `expires_at` and `https://` (`invoice_pay.sql:519-524`). |
| M4 | Partly | The success URL is `/pay/return/${returnId}` (`checkoutFlow.js:91`). The #784 raw-token test passed. `return_id` is unique (`invoice_pay.sql:60-62`) and has no expiry and no rotation. `pay_invoice_by_return` is service role only (`:861-862`), so the id does not start a charge. `payView` sets "Payment received" when a returning checkout succeeded and `amountPaidKes > 0`, while the invoice can still be payable (`view.js:69-72`). The next-part label stays on that screen. See deviation (d). |
| M5 | Fixed in the trigger | `invoices_freeze` raises when a draft update sets a number or a non-draft status unless `scalers.billing_write` is `1` (`billing_data_layer.sql:763-768`). The #784 contract test passed. The functions that must set the flag do not. That is N1. |
| M6 | Partly | P2 is its own script (`NOT VALID`, `VALIDATE`, `SET NOT NULL`). The data-layer harness applies it twice and passes. `billing_data_layer_down.sql` exists and drops the layer. Indexes are still `CREATE INDEX` without `CONCURRENTLY`. `invoice_pay.sql:56` still adds `updated_at timestamptz not null default now()`. `now()` is volatile. On a first apply `payment_attempts` is empty and the rewrite is cheap. Re-adding that column on a populated table rewrites it. `package_version_id` stays nullable. P2 sets `billing_status` not null only. |
| M7 | Fixed for the free switch | Same-interval upgrade with `days_left = 0` waits for renewal (`owner_billing_actions.sql:941-954`). Monthly to annual on that day still charges the full year (`:982-994`). See deviation (e). |
| L1 | Fixed | `toCents` returns null for a JavaScript number (`dashboard/src/lib/invoicePay/money.js:13`). The #784 test passed. |
| L2 | Fixed | Attach refuses a URL that is not `^https://` (`invoice_pay.sql:519-520`). |
| L3 | Unchanged | `billing_add_months` granted to `authenticated` is date math. It does not write money. |
| L4 | Fixed | `payments_issue_receipt` is revoked from `public`, `anon`, and `authenticated` (`invoice_documents.sql:434-435`). The trigger still runs as the table owner. The #784 test passed. |
| L5 | Fixed | `ledgerAlreadySent` settles the notice sent when the notify ledger says `instance_already_sent` or `already_sent` (`billingNoticeSend.js:10-13` and `:51`). The #784 notice test passed. |

### Deviations

**(a) Unpinned on-demand is KSh 0.** After a successful P1 there is no product path that leaves an existing subscription without a pin. The backfill fills a null pin only on rows whose `billing_status` is still null (`billing_data_layer.sql:429-446`), then raises if any row still has a null status or a null pin (`:457-461`). An insert with a null pin fills the latest published version or raises (`package_version_editor.sql:450-457`). The guard blocks a later change of a non-null pin unless `scalers.billing_version_move` is set (`:417-422`). `admin_move` writes `p_version.id` under that flag. `admin_set_tenant_billing_mode` and the transition to active do not check the pin (`package_version_editor.sql:1760-1781`). The column stays nullable. `consume_call_seconds` prices a missing rate as 0 and still adds the seconds (`owner_billing_actions.sql:1850-1854`). A hand update under `scalers.billing_admin_move` can store null because the pin trigger returns before the null fill (`package_version_editor.sql:447-448`).

Recommend: `admin_set_tenant_billing_mode` raises when the new status is `active` and `package_version_id` is null. `consume_call_seconds` for an active on-demand business raises `rate_missing` when the pinned rate is absent, and does not meter those seconds as free. Do not treat a legal published rate of 0 as missing: `inbound_kes_per_second` is `not null` and `>= 0` (`billing_data_layer.sql:167`).

**(b) `reserve_notify_send` is still granted to signed-in members.** This is not the H6 wallet debit. The function does not call `_wallet_apply_delta`. A member can reserve only caller SMS for their own tenant (`owner_billing_actions.sql:2177-2184`). `p_units` is `greatest(coalesce(p_units, 1), 1)` with no cap of 30 (`:2174`). A successful reserve increments `sms_used_units` by that count (`:2315-2318`). The spend check uses `billing_rate_card.sms_kes` and, when that rate is 0, does not stop the reserve (`:2205-2214`). Real KES still requires service-role `consume_sms_units`. Rank this Medium: a member can inflate the SMS counter and insert a pending `notify_sends` row. Revoke `authenticated`, or cap units at 30 the same way `consume_sms_units` does. `settle_notify_send` releases the counter on failure and also does not debit the wallet.

**(c) Null `spend_limit_share_percent` falls back to 50.** That matches the column default. After P7 the column is `numeric not null default 50` (`package_version_editor.sql:126`). The coalesce matters when the column is absent (P4 before P7) or when the select finds no version, and in the second case the function returns null because `v_monthly` is null (`owner_billing_actions.sql:1432-1440`). Accept this. It does not block a schema apply.

**(d) Late money on a cancelled attempt, the return id, and "Payment received".** A collection on a cancelled attempt with positive KES calls `recordIssue` with reason `cancelled` and returns 200 `{ action: "issue" }` (`webhook.js:197-206`). It does not call `applyPayment` and it does not insert `tenant_credits`. The row is stored. A replay of that same checkout does not apply it again. `billing_payment_reconciliation` lists `payments.match_status = 'issue'` (`invoice_pay.sql:768-775`), so ops can see the row. It does not become a credit by itself.

The customer can still be double-paid. `create_invoice_pay_attempt` marks the expired row cancelled and returns. `checkoutFlow.js:55-62` then best-effort calls `cancelCheckout`, swallows every error, and opens a new pending attempt. The comment on those lines says a cancel failure must not open a second live row. The code opens one. The unique index allows it because the first row is no longer `pending`. If the old Bachs session is still payable, the customer can pay both. The old checkout becomes an issue. The new checkout applies. There is no automatic credit for the cancelled collection. This review did not call the undocumented cancel endpoint, so whether Bachs actually voids the session is unproven. The money path in this repo does not repair a late collection.

"Payment received" is set for a returning succeeded checkout whenever `amountPaidKes > 0` (`view.js:69-72`), including a split whose invoice is still payable. The next part label remains. The return id is a stable bearer (`ret_` plus 32 bytes, unique index, no expiry). It resolves status. It does not start a charge.

This fails the bar for live money. Store the late collection as now, and also insert one `tenant_credits` row keyed by the checkout id so a second successful checkout cannot leave the customer paid twice with no credit. Keep the issue row so ops can see it. Show "Payment received" only when the invoice status is `paid`.

**(e) Negative draft, and monthly to annual on the last day.** The negative-draft credit is the right shape and the idempotency key is `invoice-credit:<id>`. It cannot commit: the owner finalize raises against the freeze, and P6 plus `billing_company.sql` delete the credit behavior. A paid zero invoice would not insert a payment, so the receipt trigger would not fire, if that function could commit. Ship the credit inside the finalize that also sets `scalers.billing_write` and numbers `SCL-`.

Monthly to annual on the last day charges the full annual price, and the unused-month credit is 0 because `days_left` is 0 (`owner_billing_actions.sql:941-954` and `:982-994`). That matches the existing rule that a year is not prorated. The round 1 bug was the same-interval upgrade that switched the plan for KSh 0. That path now waits for renewal. Accept the full-year charge.

### New bugs

**N1. Blocker. No invoice can be issued after P1 once a later file replaces `finalize_invoice`.** `invoices_freeze` rejects a draft update that sets `invoice_number` or a non-draft status unless `scalers.billing_write` is `1` (`billing_data_layer.sql:763-768`). P1's own function sets the flag (`:1502-1504`) and the probe issued `SC-2026-000001`. The owner function (`owner_billing_actions.sql:1214-1223`), the documents function (`invoice_documents.sql:260-266`), and the company function (`billing_company.sql:100-113`) update number and status without the flag. The P1–P7 probe raised `invoice number and status are set only by finalize_invoice` after P4, after P6, after `billing_company.sql`, and after P7. The negative-draft credit inserted in the same owner function rolled back with it (`tenant_credits` count 0). `billing_company.sql` also refuses a beta subscription with the string `beta tenants have no pay link` (`:74-79`) and requires `billing_company.legal_name` (`:86-88`). If that file is applied it wins over P6, and it still cannot pass the freeze.

Exact fix: one `finalize_invoice`. It sets `scalers.billing_write` before the update, numbers `SCL-YYYY-000001`, copies the letterhead, and on a negative total inserts the `invoice-credit:<id>` credit and marks the invoice paid at 0. P4, P6, and `billing_company.sql` must not replace that body with a copy that omits the flag. Re-applying `owner_billing_actions.sql` must not put `SC-` back.

**N2. Medium. An overpay adjustment does not rewrite the receipt.** `adjust_payment_overpay` updates the payment and inserts the delta credit (`invoice_pay.sql:894-906`). `payments_issue_receipt` runs `AFTER INSERT` only (`invoice_documents.sql:437-440`). The receipt and the payment-received notice stay at the first amount. The customer is not double-credited. The document understates the collection. Re-issue the receipt when the stored amount rises, or include the credit on the same document.

**N3. High. A cancelled attempt plus a replacement checkout can collect twice with no credit.** This is deviation (d). The first collection is stored as `match_status = issue`. The second applies. Ops can see the issue in `billing_payment_reconciliation`. Nothing turns it into `tenant_credits`.

**N4. Medium. A short terminal SUCCEEDED stays an issue until a later exact event.** `webhook.js:117`. The money is stored. It is not applied and it is not credited. A later exact event on the same checkout can apply because an issue row is replaceable (`invoice_pay.sql:913` and `webhook.js:220-221`). If that event never arrives, the shillings sit in the issue report.

**N5. The beta pair and the pay link agree. The debit agrees. The invoice function in `billing_company.sql` uses the pay-link error string.** `admin_set_tenant_billing_mode` and `mint_invoice_pay_token` both refuse beta and enforcement off (`package_version_editor.sql:1748-1756`, `invoice_pay.sql:216-225`). `consume_call_seconds` debits 0 for that pair (`owner_billing_actions.sql:1822-1824`). That part is consistent. `billing_company.sql:74-79` then refuses to finalize any invoice for a beta tenant with `beta tenants have no pay link`, which is the wrong gate on an issue function, and it still hits N1 before that check can matter for a non-beta tenant.

### What round 2 did not re-open

HMAC, `timingSafeEqual`, the 300 second skew, empty-secret 401, live-mode 403, pay-token entropy, invoice and receipt reads by session tenant, admin SQL not executable by `authenticated`, seat counting, extra seat KSh 500, and the `BILLING_NOTICES_SEND` gate were checked in round 1 and the new heads do not undo them. The #784 suites that cover the return URL, the overpay adjust, the notice key, and the beta pair passed on this merge. No Bachs sandbox call was made. Whether the cancel endpoint voids a session is unknown.

## Round 1 record

The heads and the ship table below are the first review. Round 2 replaces the ship verdicts.

Failing tests that encode the required money outcomes live on `cursor/billing-review-tests-7822`. Command and result:

```text
node --test tests/billingReviewMoney.test.js tests/billingReviewContracts.test.js
# tests 23
# pass 0
# fail 23
```

## Safe to ship to prod?

No pull request in this set is safe to take live M-Pesa, and none is safe to turn billing enforcement on.

| PR | Verdict |
| --- | --- |
| #775 | **No.** Keep it as the staging schema the others sit on. Do not apply it to production until the pay and debit fixes below are in the same release. Re-applying this file after `invoice_documents.sql` puts invoice numbers back to `SC-` and the due-notice kind back to `platform_billing_invoice_due`. |
| #781 | **No.** A null spend cap uses half the monthly price and ignores `spend_limit_share_percent`. Call debit uses `billing_rate_card` id 1, not the pinned version rate, and it debits a business whose `billing_status` is still `beta` once enforcement is `soft` or `hard`. `consume_sms_units` stays executable by any member JWT and now debits the wallet. A seat-removal credit is floored off the draft total. The monthly roll writes catalogue seats and minutes back over the pinned version. The extra-seat backfill raises if the #778 freeze is already installed and a published paid row still has a null seat price. |
| #780 | **No.** Two Pay clicks, or a second click after the 60 minute checkout expires, open two Bachs sessions. Paying both takes the money twice. A succeeded collection that is not an exact shilling match, and any `collection.underpaid`, leaves the invoice open. `checkout.completed` with `payment_status: paid` then drops a later `OVERPAID` on the same checkout, so the extra shillings never become a credit. A payment against a void invoice is a silent HTTP 500 and is then dropped when Bachs stops retrying. The Bachs success URL carries the raw pay token. Live mode is hard-refused today. Lifting that refuse without the fixes below would charge customers twice. |
| #778 | **No for turning billing on.** The editor does not itself create an invoice, and a move does not change `billing_status` or enforcement. `admin_set_tenant_billing_mode` accepts `billing_status = beta` together with enforcement `soft` or `hard`. The older admin action `set_billing_mode` still calls `set_tenant_billing_mode`, which writes enforcement and leaves status `beta`. After either write, #781 debits calls and applies the spend cap while the business is still beta. Version per-minute rates are not what the debit uses. |

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

### H6. Any member JWT can debit the SMS wallet

On `main`, `consume_sms_units` is already granted to `authenticated` and, when on-demand is on, only increments `sms_used_units`. It does not touch the wallet (`docs/supabase/sms_allowance.sql:160-172` and `:190-193` on `main`).

#781 replaces that function and, in the on-demand branch, calls `_wallet_apply_delta` for `overage_units * sms_kes` (`owner_billing_actions.sql:1828-1869`). The grant is unchanged (`:1897-1900`): revoked from `public` and `anon`, granted to `authenticated` and `service_role`. The only caller check is membership (`:1770-1774`), not owner. `p_units` is `greatest(coalesce(p_units, 1), 1)` (`:1757`), with no upper bound. The function does not read `billing_status`.

`billing_spend_allows_charge` returns true when `billing_spend_limit_kes` is null (`:1431-1432`). `_wallet_apply_delta` has no balance floor. A member of a tenant whose enforcement is `soft` or `hard`, with on-demand on and no spend cap, can post one RPC and drive the wallet negative. Where the cap exists, one call can spend the whole remaining cap without an SMS being sent.

Repro, as a staff JWT for that tenant: `POST /rest/v1/rpc/consume_sms_units` with `{"p_tenant_id":"<tenant>","p_units":1000000}`. Another tenant's id raises `not allowed`. The contract test fails because the revoke list is `public, anon` and the grant still says `to authenticated, service_role`.

Exact fix: `revoke all ... from public, anon, authenticated` and grant `service_role` only. Cap `p_units` at the segment count the notify sender actually passes. Return the beta meter branch when `billing_status` is `beta`, same as enforcement `off`. Keep the wallet debit on the service-role notify path only.

### H7. `checkout.completed` then `OVERPAID` drops the extra shillings

`checkout.completed` applies when `payment_status` is `paid` and the KES amount equals the part. It stores `attempt.amountKes`, not a larger collected amount (`webhook.js:88-93` and `:211-212`), and marks the attempt `succeeded`. A later `collection.succeeded` with status `OVERPAID` hits the duplicate return at `webhook.js:183-184`. `apply_payment` will not replace the smaller row for the same checkout id (`billing_data_layer.sql:1522-1528`).

Money: the customer pays KSh 150 on a KSh 100 invoice. If the completed event arrives first with KSh 100, the books show an exact payment. The KSh 50 never becomes `tenant_credits`, and reconciliation does not see `status = OVERPAID`. The reverse order is fine: `OVERPAID` first credits the received amount.

A separate hole on the same line: status `OVERPAID` with a positive KES amount below the part is applied (`webhook.js:108`) before the equality check. That under-credits and then locks the checkout the same way as H1.

Repro: the test "credits the extra when checkout.completed is followed by OVERPAID" got `duplicate: true` after a KSh 100 completed event and a KSh 150 `OVERPAID` event. The stored payment stayed KSh 100.

Exact fix: if a later event on the same checkout has a larger KES amount and status `OVERPAID`, update the payment row to that amount and insert `tenant_credits` for the difference. Do not treat `OVERPAID` below the part as a full apply. Use the underpaid path in H1.

### H8. A seat-removal credit is deleted, and the monthly roll puts catalogue allowances back

`owner_set_extra_seats` stores a removal as a negative line (`owner_billing_actions.sql:1193-1196`) because `billing_prorate_kes` ignores negatives. `_owner_next_invoice_line` then sets the draft total to `greatest(sum(lines), 0)` (`:1085-1088`). Remove 1 seat, 10 of 30 days, unit KSh 500. The line is `round(500 * 10 / 30, 0) = -167`. The draft total becomes 0. The KSh 167 is not copied onto a renewal invoice and is not a wallet credit.

`_owner_apply_allowances` sets `seat_included` from the pinned version plus extra seats (`:710-715`). `roll_package_periods` later calls `_tenant_set_allowances` (`docs/supabase/package_period_rollover.sql:261-264`), which writes `billing_packages.seats` (`docs/supabase/package_state_rules.sql:193`). Catalogue Starter is 2 seats. Version 2 Starter is 3. After the roll, `seat_included` is 2, `extra_seats` is unchanged, and the draft still bills the extra seats. Invites stop at the catalogue cap. The business paid for seats the cap rejects. Minutes move the same way: a Scale version pinned at 1,600 is put back to the catalogue 2,000, so 400 minutes that should have been overage are included.

The seat-total test fails because the function still contains `greatest(v_sum, 0)`. The roll test fails because `roll_package_periods` does not mention `billing_package_versions`.

Exact fix: let a negative line reduce `total_kes` below zero, and turn a negative draft into a `tenant_credits` row when the invoice is issued, or store the removal as a credit with its own idempotency key. Change `roll_package_periods` to copy minutes, seats, and message allowances from the pinned `billing_package_versions` row plus `extra_seats`, not from `billing_packages`.

### H9. The old admin mode switch turns charging on and leaves status `beta`

`POST /api/admin/billing` action `set_billing_mode` still calls `setTenantBillingMode` (`dashboard/src/app/api/admin/billing/route.ts:117-131`). That RPC is `set_tenant_billing_mode` (`dashboard/src/lib/adminWallets.ts:60`), which updates `tenants.billing_enforcement` and does not touch `tenant_subscriptions.billing_status` (`docs/supabase/wallet_security_beta.sql:348-359`). It is service-role only (`:535-536`). The ops cookie is the gate. A note of 3 characters is the only extra check. There is no pair rule.

New rows default to `billing_status = beta` (`billing_data_layer.sql:436`) and enforcement `off`. After this action sets `soft`, status stays `beta`, and H4 debits. `admin_set_tenant_billing_mode` is not the only writer. The contract test fails because `set_tenant_billing_mode` does not mention `billing_status` or `tenant_subscriptions`.

Exact fix: make `set_tenant_billing_mode` raise when the requested enforcement is not `off` and the subscription is still `beta`, and require the caller to set status to `active` in the same transaction. Point the admin route at `admin_set_tenant_billing_mode` with `p_confirm` true, or delete the old action once that function is the only writer.

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

### M4. The Bachs return URL is a bearer, and a foreign checkout paints "Payment received"

`startInvoiceCheckout` sets `successUrl` to `/pay/${token}?return=1` (`dashboard/src/lib/invoicePay/checkoutFlow.js:37-38`). The token is stored only as a hash (`invoice_pay.sql:222-227`). Bachs receives the raw token in the success and cancel URLs, so Bachs logs and the browser history hold a bearer that `pay_invoice_by_token` honors until expiry or rotate. The test "does not put the raw pay token on the Bachs success URL" failed because `successUrl.includes(token)` is true.

`loadPayView` loads whatever `checkout_id` is on the query after the token lookup (`dashboard/src/lib/invoicePay/loadPay.ts:16-22`). `invoice_pay_attempt_by_checkout` does not compare invoice ids (`invoice_pay.sql:479-497`). `payView` turns `status = succeeded` into state `received` and title "Payment received" while the looked-up invoice is still `payable` (`view.js:64-69`). It does not mark the invoice paid. A customer who opens `/pay/<token-for-A>?return=1&checkout_id=<succeeded-checkout-for-B>` sees a paid screen for an open invoice and may not pay A.

Exact fix: put a one-time return id in the Bachs URL, not the pay token. In `loadPayView`, ignore a checkout whose `invoice_id` is not the token's invoice. `payView` should say "Payment received" only when `lookup.state` is `paid`.

### M5. A draft update can occupy the next invoice number

`invoices_freeze` returns `new` for every update while `old.status = 'draft'` (`billing_data_layer.sql:747-748`). A service-role update can set `status = 'open'` and `invoice_number = 'SCL-2026-000006'` without touching `billing_invoice_counters`. `finalize_invoice` then does `last_number = last_number + 1` (`invoice_documents.sql:254-258`). If that string is already taken, the unique violation aborts the transaction and the increment rolls back. Every later finalize retries the same number and fails. `authenticated` has select only, so this is a service-role path. The contract test fails because the draft branch does not reject a non-null `invoice_number` or a status other than `draft`.

Exact fix: in the draft branch, raise when `new.invoice_number is not null` or `new.status is distinct from 'draft'`. Number and status changes go through `finalize_invoice` only.

### M6. `tenant_subscriptions` takes a lock when the data layer is applied

`billing_data_layer.sql:451-452` sets `billing_status` not null after the backfill at `:412-433`. That is an existing table, so the alter takes `ACCESS EXCLUSIVE` for the check. `invoice_pay.sql:55` adds a column with `default now()` on `payment_attempts`. `now()` is volatile, so PostgreSQL will rewrite the table rather than use a metadata-only default. On a first production apply `payment_attempts` is empty and the rewrite is cheap. `tenant_subscriptions` is not empty. Indexes in these scripts are `CREATE INDEX` without `CONCURRENTLY`, which is legal in the SQL editor transaction and blocks writes for the build. There is no down script. A second run of the status backfill updates only nulls, so it does not reset status.

Exact fix: apply on staging first, in a quiet window, with a backup. Add the `payment_attempts` column as nullable, backfill, then set the default, if the table is already large. Do not run `SET NOT NULL` on `tenant_subscriptions` inside a long transaction that also rebuilds indexes.

### M7. An upgrade on the last day of the period switches the plan and charges KSh 0

`billing_period_days` returns `days_left = 0` when today is the Nairobi end date (`owner_billing_actions.sql:250-268`). `billing_prorate_kes` then returns 0. `owner_change_plan` updates the plan and allowances before the invoice (`:943-961`). The invoice function returns null when charge and credit are both 0 (`:742-743`). Upgrade Starter to Scale on that date: KSh 0 charged, Scale minutes applied, until `roll_package_periods` runs. Same-day on the first day of a 31-day month is a full charge (`days_left = 31`). 31 Oct against a 1 Nov end is `days_left = 1`. Those two match the integer proration and are not this bug.

Exact fix: when `days_left = 0`, schedule the upgrade at the next period instead of applying it now, or charge the full new period price.

## Low

### L1. `toCents` of a JavaScript number uses `toFixed(2)`

`dashboard/src/lib/invoicePay/money.js:12-14`. In Node, `(1.005).toFixed(2)` is `"1.00"`. Webhook amounts that arrive as strings with at most two decimal places are fine. A numeric `1000.005` would be short by one cent and then hit H1.

Exact fix: reject `typeof amount === "number"` in `toCents`. Callers already have decimal strings.

### L2. SQL attach allows `http://`

`invoice_pay.sql:444` uses `^https?://`. The JS provider requires `https://` (`provider.js:210-213`). Only a service-role caller of the SQL function can attach an `http` URL.

Exact fix: change the SQL check to `^https://`.

### L3. `billing_add_months` is granted to `authenticated`

On #781 this is a pure date function. It does not write money. Leave the grant, or revoke it for consistency with the other billing functions. Not a charge path.

### L4. `payments_issue_receipt` is granted to `PUBLIC`

`invoice_documents.sql:417-437` creates the trigger function and does not revoke it. PostgreSQL grants `EXECUTE` to `PUBLIC` on a new function. A direct `select public.payments_issue_receipt()` errors because `NEW` is not assigned, and it does not issue a receipt. `issue_invoice_receipt` is revoked (`:414-415`). The contract test fails because there is no `revoke all on function public.payments_issue_receipt()`.

Exact fix: revoke from `public`, `anon`, and `authenticated` after the create. The trigger still runs as the table owner.

### L5. Inside the same hour, a reclaimed notice can be marked failed after it was sent

M1 covers the next-hour duplicate. Inside the same hour the notify key matches, the second dispatch returns no channel, and `billingNoticeSend.js:34` settles the row `failed`. The customer already got the message. The row says failed. Fix is the same `keyBase`: a replay must settle `sent` when the notify ledger says the send already exists.

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
