---
owner: ops-billing
last_reviewed: 2026-10-19
---

# Billing stack review, 18 Oct 2026

Round 4 is the current verdict. Round 3, Round 2, and Round 1 are kept below it.

## Round 4

Final review of #780 before a production release. Review only. No SQL was applied to staging `sgcdncjxauhsbunobmob` or production `fjxcdccgyhnvnnlnovcl`. This review did not call Bachs. Local Postgres 16.15 ran the apply-order harness. The branch `cursor/billing-review-round4-7822` holds this document only. Do not merge it. Do not merge #788 or #793.

Since round 3, P1 through P8 are on production, #775 (`6edbba92`), #781 (`3e051899`), and #778 (`62b77ac1`) are on `main`, and the owner-price v2 import plus the beta repin and catalogue sync are on production. This review did not query production. Those statements are the operator's, and the SQL below was judged against a fresh local database that applied P1 through P10.

Reviewed head: #780 `cursor/invoice-pay-0c16` at `730f67aa`. `main` was merged at `49e7ea99`. Commits after the round 3 head `553f1830`:

| Commit | What it does |
| --- | --- |
| `63a6c578` | After cancel, read the Bachs session. Park an unattached checkout. |
| `209391b0` | Record the Bachs sandbox drill and the round 3 staging migrations. |
| `3dc0fd02` | Keep a credit total negative on the invoice history API and the PDF lines. |
| `d46115d5` | Move the live-checkout SQL into `invoice_pay_session.sql` after P8. |
| `49e7ea99` | Merge `main` (`8e0f0392`) into invoice pay. |
| `730f67aa` | Embed the invoice wordmark so Next's page-data trace can still find it. |

`2b31a3bc` is not an ancestor of `730f67aa`. The negative "Credits applied" print from that commit is not on the branch that will ship.

### Verdict

| Question | Verdict |
| --- | --- |
| (1) Merge `730f67aa` and apply P9 then P10, with payments off | **Yes**, with the conditions under (a). `BACHS_MODE` stays off. `assertBachsAllowed` also refuses `sk_live_` and any `SUPABASE_URL` that contains `fjxcdccgyhnvnnlnovcl` (`provider.js:52-71`), so this merge cannot call Bachs against the production database. `BILLING_NOTICES_SEND` stays off. |
| (2) Live money | **No.** Two code blockers, below. Owner and ops items stay separate and do not change that no. |

### (a) P9 and P10 after P8

Safe to apply on current production, in that order, with payments off. Neither file replaces `finalize_invoice`. A second apply of each file on the fresh database succeeded. The proof after P10 still issued `SCL-2026-000001` (paid 3667, receipt 3667), `SCL-2026-000002` (paid 0, credit `invoice-credit:<id>` of 167), and `SCL-2026-000003` (open 2320, receipt 2500, overpay credit 500).

P9 `docs/supabase/invoice_pay_session.sql` (489 lines):

- No tenant DML. No table grants. No RLS change. No `anon` execute.
- `revoke all` from `public`, `anon`, and `authenticated`, then `grant execute` to `service_role`, on `create_invoice_pay_attempt` (`:201-202`), `park_invoice_pay_attempt` (`:239-240`), `invoice_pay_attempt_by_checkout` (`:302-303`), `settle_invoice_pay_attempt` (`:335-336`), and `billing_payment_reconciliation` (`:487-488`).
- Drops and recreates `payment_attempts_one_pending_part` so the unique index covers `pending` and `pending_unattached` (`:28-31`). Drops and adds `payment_attempts_status_check` with `pending_unattached` added to the P5 set (`:33-36`). That is a short lock. Run the file in one transaction. A default `psql` session autocommits each statement, and a failure between the drop and the create would leave the table without the one-pending index.
- `create_invoice_pay_attempt` returns `unattached` for `pending_unattached`, and still returns `cancel` for an expired pending row with a null URL treated as in flight. `park_invoice_pay_attempt` accepts an `https` URL or a null URL, and only updates `pending` or `pending_unattached`. `invoice_pay_attempt_by_checkout` adds `live_part`. `settle_invoice_pay_attempt` accepts `pending_unattached`. Reconciliation is a report. It includes `cancelled`, `superseded`, `failed`, and `pending_unattached` in the credited-cancelled set.

P10 `docs/supabase/billing_mode_legal_pairs.sql` exists only on this head. The merge `49e7ea99` added it. It is not on either parent (`d46115d5`, `8e0f0392`) and it is not on `origin/main` (`33b24f1b`). The function body matches `main`'s `set_tenant_billing_mode` in `wallet_security_beta.sql`. The file also sets the comment and re-asserts the revoke and grant (`:110-111`). Apply is DDL. It does not update tenant rows and it does not change `billing_status`. On the throwaway database, setting soft while a subscription was beta raised `billing stays off while the business is on beta` and left `billing_status` as beta. `anon` and `authenticated` have no execute. `service_role` does. Existing illegal pairs are not rewritten.

Do not re-run `docs/supabase/invoice_pay.sql` (P5) after P9. P5's `settle_invoice_pay_attempt` rejects `pending_unattached`. P5's `invoice_pay_attempt_by_checkout` has no `live_part`, so the webhook would treat a live unattached collection as displaced and credit it instead of applying it. P5's status check drops `pending_unattached`. P5's unique index is `CREATE UNIQUE INDEX IF NOT EXISTS`, so the wider P9 index name can remain while the functions regress. Do not re-run the whole of P1. Re-applying only the P1 finalize installer after P8 printed a skip notice and left `SCL-`, `scalers.billing_write`, and `invoice-credit:`. The notice text now says it is leaving the `invoice_documents.sql` body in place (`billing_data_layer.sql:1466`). That sentence is stale. The skip predicate is still a body that contains `SCL-` (`:1464`). Re-applying `owner_billing_actions.sql` after P8, P9, and P10 printed `finalize_invoice already numbers SCL- with the freeze flag and the credit key` (`owner_billing_actions.sql:1208`) and left the letterhead, the flag, `SCL-`, the credit key, and the pin trigger. The README warning to re-apply P8 after an owner re-run is conservative. Re-applying P8 last is still safe.

### (b) Bachs no-cancel

The sequential path from round 3 is fixed and tested. `cancelCheckout` treats HTTP 404 and 409 as success (`provider.js:239`). `replaceExpiredAttempt` then always reads the session (`checkoutFlow.js:93-104`). An open or unreadable session is reused or blocked (`reuseOrBlock`, `:73-82`). A replacement is inserted only after a read that says the session is closed. `resumeUnattached` does the same for a parked row (`:117-124`). Tests: "does not open a second session when cancel succeeds and the checkout is still open" and "keeps an unattached session and reuses it on the next click" (`tests/invoicePay.test.js:590`, `:668`). The authors' sandbox drill in `209391b0` matches this: cancel returns 404, the session stays `open`, and none of DELETE, PATCH, or expire take it off `open`. This review did not repeat that drill.

A live unattached collection is applied. A displaced failed or unattached collection, once a newer live row exists, is credited once (`webhook.js:197-223`, test at `invoicePay.test.js:739`). The credit key is still one row per provider ref.

Two double-collect paths remain. Both are code blockers for live money.

1. Overlapping click while an attach failure has parked the attempt. `waitForAttached` returns as soon as `!inFlight && !reused` (`checkoutFlow.js:13-19`). A `pending_unattached` row is neither in flight nor reused, and the waiter does not call `resumeUnattached`. The caller then calls `createCheckout` again (`:200-217`). If that throws, the catch marks the attempt `failed` (`:218-220`), which frees `payment_attempts_one_pending_part`. The next click inserts a new pending row while the old Bachs session is still open. If `createCheckout` returns a new id and `attachCheckout` throws, `parkUnattached` stores the new id (`:231-237`) and the old session id is gone. A payment on the old id is unmatched. A local probe with a fake ledger showed both: one create, status `failed`, on the throw path; one create and a park of the new checkout id on the success path. Sequential second clicks are the tested path and are safe. This race is not covered by those tests.
2. A short or underpaid collection marks the attempt `succeeded` (`webhook.js:256-277`). The pay page then offers the remainder (`Pay KSh 320` in `tests/invoicePay.test.js:216`). The sandbox drill recorded that underpay leaves the Bachs session open (`payment_status` `requires_action`, `amount_remaining` set). A later collection on that same checkout id is the same `provider_ref`. The attempt is already `succeeded`, so the webhook returns duplicate (`webhook.js:252-253`) and does not credit the extra money. The new remainder session can also be paid. That is a second collection whose extra is not a credit. Overpay cannot be simulated in that sandbox (the API accepts only `success`, `failed`, and `underpaid`). That limit is a test gap, not a third defect.

`collection.failed` still marks only `status = 'pending'` (`webhook.js:166-170`). A `pending_unattached` row is left for the next click. A later collection on a failed row is credited once a newer live row exists, and applied when `live_part` is true. That path has a credit. It is not a third blocker.

`getCheckout` returns null on HTTP 404 (`provider.js:253`). `checkoutIsOpen(null)` is false, so a 404 read is treated as closed and the code may insert a replacement. A network error is unreadable and blocks. A live sandbox session does not 404, so the cancel-404-then-GET-open path is the one that matters, and that path reuses or blocks.

### (c) Negative amounts and credits

`3dc0fd02` is on the branch. `toCents` accepts a leading minus. `formatKsh` prints `KSh -1,000`. A negative split is empty, so there is no pay part. The history API shows negative line totals and clamps the balance and the pay link to zero when nothing is owed. The document test "keeps a credit total negative and does not offer pay" expects line and total `KSh -1,000`, amount due `KSh 0`, and an empty pay label and pay URL. `payView` then says the invoice cannot be paid here. `minorUnits` rejects cents below zero (`webhook.js:121-124`), so a negative charge is not applied.

`2b31a3bc` is not on this head. `documents.js` prints "Credits applied" only when `creditsAppliedKes` is greater than zero, and the value is `money(credits)`, which is a positive amount (`documents.js:144`, `:183`). A negative credits figure is omitted. Amount due still floors at zero. That is a display gap. It is not a payment-math bug and it is not a live-money blocker.

### (d) The invoice freeze in the pay SQL tests

`invoices_freeze` is unchanged against `main`. The diff of that trigger is empty. `tests/invoicePaySql.test.js` opens a draft by `set_config('scalers.billing_write', '1', false)`, runs the update, and clears the flag in `finally` (`:16-21`). It does not drop the trigger. A new test expects `/set only by finalize_invoice/` when the flag is unset (`:43-59`). On the throwaway database, a number or status write without the flag was rejected, and the same write with the flag succeeded. That is the sanctioned path. It does not weaken #775.

`invoicePaySql.test.js` was not executed here. `@electric-sql/pglite` is not installed. The judgment is the test diff plus the SQL probe.

### (e) The merge of main

Parents of `49e7ea99` are `d46115d5` and `8e0f0392`. `origin/main` has since moved to `33b24f1b`. No conflict markers remain. `foundation_bootstrap.sql` lines that contain `====` are comments.

`billing_data_layer.sql` on the tip is byte-identical to `origin/main` (blob `5c796cf6`). The pre-merge file named `billing_company.sql` in the skip notice. The merged notice names `invoice_documents.sql` (`:1466`). The skip still leaves an `SCL-` body in place, which the re-apply probe confirmed. Comment regression only.

`billingNoticeSend.js` kept `main`'s already-sent settlement and a slightly safer env read. Sends stay off unless `BILLING_NOTICES_SEND=on`.

P9 and P10 do not replace `finalize_invoice`. The pin trigger and `rate_missing` were still present after the owner re-apply. No new money-function regression in finalize.

`730f67aa` embeds a base64 JPEG in `wordmark.js` because the Next trace rewrites `__dirname`. It does not change amounts.

### What the tests did

Throwaway database `billing_apply_order_proof` only. `sudo -u postgres psql`. Never Supabase. Working tree `/tmp/invoice-pay-730f67aa` at `730f67aa`.

| Run | Result |
| --- | --- |
| `tests/sql/billing_apply_order/run.sh` | EXIT 0. P1 through P10, P9 twice, P10 twice, then the proof invoices above. The session index contains `pending_unattached`. `park_invoice_pay_attempt` exists. `set_tenant_billing_mode` contains the beta sentence. Re-applying the P1 finalize installer left `SCL-`, `scalers.billing_write`, and `invoice-credit:`. |
| Same database, after that | A draft write without `scalers.billing_write` was rejected. The same write with the flag succeeded. Soft enforcement on a beta subscription raised and left `billing_status` as beta. `anon` cannot execute `park_invoice_pay_attempt` or `set_tenant_billing_mode`. Re-applying `owner_billing_actions.sql` printed the skip notice and left the letterhead, the flag, `SCL-`, the credit key, and the pin trigger. |
| `node --test` of `invoicePay`, `invoiceDocuments`, `billingReviewContracts`, `billingReviewMoney` | 67 pass, 0 fail. |
| Fake-ledger probe of `startInvoiceCheckout` | Waiter returns the unattached row, then a thrown `createCheckout` marks the attempt failed (one create). A second `createCheckout` that returns a new id is parked over the old id (one create). |

### What remains before live money

Code, still in #780:

- When `waitForAttached` observes `pending_unattached`, resume or block that session. Do not call `createCheckout` again. A thrown create must not mark that parked attempt `failed`.
- After `apply_partial`, do not open a second hosted session while the first Bachs checkout is still open. A later collection on that checkout id must become exactly one credit of the extra, or the first session must be closed before a remainder checkout is created.
- Remove the production-ref refusal in `assertBachsAllowed` only after those two fixes, and only with Alvin's GO. Until then the merged code cannot pay against production, which is what verdict (1) relies on.

Owner and ops, not a code change:

- Bachs KYC, and a live key stored as an environment variable. Do not print it.
- `BACHS_MODE` stays off. `BILLING_NOTICES_SEND` stays off. `DESK_PLAN_CHANGE` stays off.
- Letterhead address, city, and KRA PIN stay null until the owner sets them.
- `package_editor_enabled` false, and no promote import, until Alvin's GO.
- Backup. Apply P9, then P10, each file in one transaction. Do not re-run P5 after P9. Do not re-run the whole of P1. Do not run `billing_data_layer_down.sql`. Do not re-run `wallet_security_beta.sql` to pick up the beta check. Do not touch DID `+254709221536`.

### New regressions

None in finalize, the pin trigger, or `rate_missing`. The merge's only billing-text regression is the stale P1 skip notice, and the installer still skips. The two live-money blockers are new relative to a claim that no double-collect path remains. The sequential cancel path that round 3 left open is closed.

---

## Round 3

Re-review only. The four pull-request branches were not pushed. No SQL was applied to staging `sgcdncjxauhsbunobmob` or production `fjxcdccgyhnvnnlnovcl`. Local Postgres 16.15 ran the harnesses. The integration branch `cursor/billing-review-round3-7822` merges the four heads below, plus the display-only commit `2b31a3bc`, and was used only to run tests. Do not merge it. Do not merge #788.

| PR | Branch | Round 3 head |
| --- | --- | --- |
| #775 | `cursor/billing-data-layer-cc4b` | `be16ad70` (unchanged) |
| #781 | `cursor/owner-billing-actions-5c64` | `6421aa45` (was `c0e0afe3`) |
| #780 | `cursor/invoice-pay-0c16` | `553f1830` (was `5d003dfd`), plus display-only `2b31a3bc` |
| #778 | `cursor/admin-package-versions-b52e` | `cee8e054` (unchanged) |

#780's apply-order proof was written against #781 at `c0e0afe3`. This round ran that same harness with the remote at `6421aa45`.

### Safe for prod schema apply, and safe for live money?

A first apply of P1 through P8, in that order, on a backed-up database, can land. It is not safe to take live M-Pesa yet. The invoice freeze is fixed. Two checkout paths can still leave two payable Bachs sessions.

| PR | Safe for prod schema apply | Safe for live money (sandbox to live) |
| --- | --- | --- |
| #775 `be16ad70` | **Yes, as P1 and P2, first.** P2 is three statements. On production, run each in its own transaction. Do not re-run the whole of P1 after P7: the published feature freeze rejects that seed. Re-running only the finalize installer after P8 leaves the canonical body. The down script drops the layer. | **No.** |
| #781 `6421aa45` | **Yes, as P4, after P1 and P2 and before P8.** The owner harness applies the file twice and passes, including the pin refusal, `rate_missing`, a published rate of 0, and the reserve cap. Re-running the file after P8 prints `finalize_invoice already numbers SCL- with the freeze flag and the credit key` and leaves the letterhead body, the beta refusal, and the pin trigger. | **No.** |
| #780 `553f1830` plus `2b31a3bc` | **Yes, as P5, P6, and P8, with P8 last.** P6 does not define `finalize_invoice`. P8 is the body that issued `SCL-2026-000001` through `000003` on the fresh database. `2b31a3bc` only prints a credit as a negative amount on the document. | **No.** |
| #778 `cee8e054` | **Yes, as P7, after the extra-seat backfill and before P8.** The editor harness applies the file twice and the owner-price seed twice. It does not replace `finalize_invoice` and it does not drop `tenant_subscriptions_c_require_version_pin`. Set `package_editor_enabled` false before any production apply. Do not run the promote script on production. | **No.** |

### What the tests did

Throwaway databases only. `sudo -u postgres psql`. Never Supabase. Remotes were `be16ad70`, `6421aa45`, `553f1830`, and `cee8e054`.

| Run | Result |
| --- | --- |
| `tests/sql/billing_apply_order/run.sh` | EXIT 0. P1 through P8, then the proof: `SCL-2026-000001` paid 3667 with receipt `RCT-2026-000001` for 3667; `SCL-2026-000002` paid 0 with credit `invoice-credit:<id>` of 167; `SCL-2026-000003` open 2320 with receipt `RCT-2026-000002` for 2500 and an overpay credit of 500. Re-applying the remote P1 finalize installer printed the skip notice. The installed function still contained `SCL-`, `scalers.billing_write`, and `invoice-credit:`. |
| Same database, after P8 | `credit_cancelled_collection` twice for one provider ref left exactly one `tenant_credits` row of 1500. Clearing `package_version_id` on an active row, with `scalers.billing_transition` set, raised `active billing requires a pinned package version`. The pin trigger was still present. |
| Same database, re-apply of `owner_billing_actions.sql` after P8 | Skip notice as above. The installed function still had `issuer_legal_name`, the freeze flag, `SCL-`, `invoice-credit:`, and `beta tenants have no pay link`. The pin trigger was still present. |
| `tests/sql/billing_data_layer/run.sh` | EXIT 0. |
| `tests/sql/owner_billing_actions/run.sh` | EXIT 0. This is the harness that died on the freeze in round 2. |
| `tests/sql/package_version_editor/run.sh` | EXIT 0. |
| Billing node tests on the merge | 109 pass, 12 fail in one `node --test` run. The failures are a CJS load of `adminBillingCleanup` (`export type`), two contract checks that still look for the old installer sentence and for the P1–P7 table under the heading that now only points at it, three Usage-page copy regexes, and TypeScript files. Those TypeScript files pass under `node --experimental-strip-types` (25 pass, 0 fail, including owner actions and the editor). `invoicePay`, `invoiceDocuments`, `billingReviewMoney`, and `billingReviewContracts` passed in the first run. |
| `tests/invoicePaySql.test.js` | Not run. `@electric-sql/pglite` is not installed. |
| `tests/inboundBillingGate.test.js` | Failed to load. `express` is not installed in this environment. |

### Finding status

| ID | Status | Evidence |
| --- | --- | --- |
| N1 | Fixed | P8 `finalize_invoice` sets `scalers.billing_write` around the number and status write (`billing_company.sql:135-153`). The proof issued three `SCL-` invoices after the full order, including a negative draft that became one credit and a paid zero invoice. |
| N2 | Fixed | `payments_issue_receipt_update` runs after `amount_kes` changes (`invoice_documents.sql:398-408`). `issue_invoice_receipt` updates the existing receipt and returns it (`:322-330`). The proof receipt for the 2320 invoice is 2500, with a 500 overpay credit, one receipt number. |
| N3 | Partly | A collection on an attempt already marked `cancelled` or `superseded` records an issue and calls `credit_cancelled_collection` (`webhook.js:197-215`). The key is `cancelled:<provider>:<provider_ref>`, `on conflict do nothing` (`invoice_pay.sql:969-975`). The SQL probe and the `invoicePay` test both left one credit, and the invoice `amount_paid_kes` stayed 0. The expired-checkout path reuses or blocks (below). A failed attach still marks the attempt `failed` and swallows a cancel error (`checkoutFlow.js:183-191`). A later click can open a second session. A payment on the `failed` attempt is applied, not credited. |
| N4 | Fixed | A short terminal `SUCCEEDED` with `got > 0` and `got < expected` returns `apply_partial` (`webhook.js:117`). |
| N5 | Fixed | Beta or enforcement off still debits 0 (`owner_billing_actions.sql:1998-2000`). P8 refuses to finalize a beta tenant (`billing_company.sql:97-102`). `mint_invoice_pay_token` refuses `billing_status = 'beta'` (`invoice_pay.sql:253`). The owner harness's beta call charged 0. |
| B1 | Partly | The swallowed-then-replace path is gone. `replaceExpiredAttempt` cancels, and on a throw it reads the session (`checkoutFlow.js:53-85`). An open session with a URL is returned (`reused: true`). An unreadable session throws `previous payment still processing` and does not insert. The `invoicePay` tests cover both. The unique pending index still allows one pending row plus one cancelled or failed row. Two payable Bachs sessions remain possible when cancel returns success and the session is still open (the code does not GET after a success), and when attach fails and the follow-up cancel also fails. This review did not call Bachs. |
| H1 | Fixed | The short terminal path is N4. Positive underpay and one-cent over still apply. |
| H4 | Fixed | `consume_call_seconds` no longer uses `coalesce(v_rate, 0)`. A null pin, a null rate, or a missing column returns `rate_missing` before `seconds_used` is updated (`owner_billing_actions.sql:2029-2039`). A published 0 still meters (`:2041-2044`, and the owner harness). |
| H7 | Fixed | Same evidence as N2. The first notice stays. Notices are append-only. |
| H8 | Fixed | P8 inserts one `tenant_credits` row keyed `invoice-credit:<id>`, zeroes the invoice, and marks it paid (`billing_company.sql:113-137`). The proof did that for 167. The owner installer keeps the same branch and skips a body that already has the flag, `SCL-`, and the credit key (`owner_billing_actions.sql:1197-1210`). |
| M2 | Fixed | P1's installer skips a body that contains `SCL-`. Re-running `owner_billing_actions.sql` after P8 does not replace that body (probe above). #780's README still says to re-apply P8 after an owner re-run. That instruction is now conservative: the owner installer already leaves P8 in place. Re-applying P8 last is still safe. |
| M4 | Fixed | The Bachs URL carries `ret_` (`checkoutFlow.js:146-147`). New rows set `return_expires_at` to 24 hours (`invoice_pay.sql:484`). `pay_invoice_by_return` rejects a null or past expiry (`:898`). `payView` says "Payment received" only when `lookup.state` is `paid` (`view.js:47-51`). A paid part of a split says `Part N of M received, … still due` and keeps the next Pay label (`:70-84`). `2b31a3bc` prints `Credits applied` as `-${money}` (`documents.js:19-20, 148`). It does not change the amount due. |
| M6 | Partly | `updated_at` is added nullable, backfilled, then `SET DEFAULT now()`, then `SET NOT NULL` (`invoice_pay.sql:73-84`). Indexes are still `CREATE INDEX` without `CONCURRENTLY`. `package_version_id` stays nullable. The pin trigger is the guard on the next write, not a `NOT NULL` on the column. |
| M7 | Partly | Same-interval upgrade with `days_left = 0` still waits for renewal. Monthly to annual on that day still charges the full year. That year charge is the existing rule (deviation e). |

### Deviations

| | Status | Judgment |
| --- | --- | --- |
| (a) | Fixed | `tenant_subscriptions_c_require_version_pin` refuses `billing_status = 'active'` with a null `package_version_id` (`owner_billing_actions.sql:1873-1888`). It does not look at `scalers.billing_transition` or `scalers.billing_admin_move`. P7 does not drop it. The probe after P7, P8, and an owner re-apply still raised. `rate_missing` does not meter the seconds. A published rate of 0 still meters. `admin_set_tenant_billing_mode` still does not read the pin itself; the trigger is what stops the status write. |
| (b) | Fixed, grant kept on purpose | `reserve_notify_send` caps SMS at `least(greatest(coalesce(p_units, 1), 1), 30)` (`owner_billing_actions.sql:2366-2368`) and is still granted to `authenticated` and `service_role` (`:2537-2540`). A member JWT may reserve only caller SMS for its own tenant (`:2372-2379`). The function does not call `_wallet_apply_delta`. That is acceptable for live money. It is not a wallet debit. A member can still add 30 units per new idempotency key. That is metering, capped per call. |
| (c) | Unchanged | A null share falls back to 50, which matches the column default. A missing version returns null, which is no cap. Accept. |
| (d) | Fixed for the credit and the copy | A cancelled collection is one credit, not an invoice payment. "Payment received" is only for a paid invoice. A split part names the part and the amount still due. The return id expires after 24 hours. The remaining double-session paths are B1 and N3, not this deviation. |
| (e) | Fixed for the credit | The negative-draft credit commits. The full-year charge on a last-day month-to-year change stays the commercial rule. |

### Two payable sessions

The expired-checkout path does not. Cancel throws, GET says open: the same checkout is reused and no second pending row is inserted. Cancel throws, GET throws: the click is rejected and the pending row stays. Both are tested.

These paths can still leave two payable sessions:

1. `cancelCheckout` returns without throwing, and the Bachs session is still payable. The code treats that as closed, marks the attempt cancelled, and inserts a new pending row (`checkoutFlow.js:84-85`). There is no GET after a successful cancel. Whether the undocumented cancel voids a session was not checked against Bachs.
2. `attachCheckout` throws. The attempt is marked `failed`, and a cancel error is ignored (`checkoutFlow.js:183-191`). The next click inserts a new pending row. The old session can still be paid. That payment is applied to the invoice, because the attempt is `failed`, not `cancelled`. The new session can be paid as well.

The unique index stops two pending rows for one part. It does not stop a cancelled or failed row whose Bachs session is still payable.

### What remains before live money

Code, still in these pull requests:

- After a cancel that returns success, read the session. If it is still open, reuse it or block. Do not insert a second attempt.
- If attach fails and the cancel also fails, do not open another checkout for that part. Keep the attempt in a state the next click reuses or blocks, the same way an unreadable expired session is blocked.
- Run one sandbox collection, one cancel, one underpay, one overpay, and one split above KSh 150,000 against the code that will ship, before `BACHS_MODE` is turned to live. This review did not call Bachs.

Owner and ops, not a code change:

- Bachs KYC, and a live key stored as an environment variable. Do not print it.
- `BACHS_MODE` stays off live until the sandbox drill above and Alvin's GO.
- Letterhead address, city, and KRA PIN are null. They stay off the document until the owner sets them.
- `BILLING_NOTICES_SEND` stays off until the owner wants the outbox to send.
- `DESK_PLAN_CHANGE` stays off.
- `package_editor_enabled` false on production, and no promote import, until Alvin's GO.
- Backup, then P1–P8 in order. P2's three statements in their own transactions on production. Do not run `billing_data_layer_down.sql`. Do not touch DID `+254709221536`.

### New regressions

None in the money functions. #781's pin trigger and `rate_missing` still work after P7 and after P8's canonical finalize. The owner harness that failed in round 2 now passes. The three Usage copy failures are the same desk-page regexes as round 2; seconds-to-minutes passed. The two billing-data-layer contract failures are the merged README heading and the installer comment, which now name P8. The remote P1 installer, which the apply-order harness uses, still skips an `SCL-` body.

---


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
