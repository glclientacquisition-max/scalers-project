---
owner: ops-billing
last_reviewed: 2026-10-18
---

# Billing read models for Desk

What the admin console and the owner dashboard can read after `docs/supabase/billing_data_layer.sql`. The owner desk has no pay button. A public pay page is a separate token link ([`INVOICE_PAY.md`](./INVOICE_PAY.md)). No prices beyond the versions already on the account. The trial row is not a priced plan.

## Owner (signed in, own business only)

Select is allowed. Insert and update are not, except marking a notice read.

| Read | What it is |
| --- | --- |
| `billing_subscription_read` | Pinned package version, `billing_status`, `voicemail_until`, grandfathered `version_monthly_price_kes`. Price is the version, not the live catalogue row. |
| `tenant_subscriptions` | Same facts, plus the package clock `status` (`active` or `cancelled`). Do not treat that clock as paid or unpaid. |
| `invoices`, `invoice_lines` | Own invoices. Currency is KES. |
| `billing_notices` | Own billing messages (invoice due, trial ending, past due, trial ended, line suspended). `mark_billing_notice_read(id)` sets `read_at` once. |
| `billing_package_versions` | Published versions only. |

`billing_status` values: `beta`, `trialing`, `active`, `past_due`, `grace`, `suspended`, `cancelled`, `archived`. Current businesses with billing mode off are `beta`. That is not "active".

`allowances_placeholder` on the trial version is true. SMS 20 and email 30 are placeholders, not a decision. Trial minutes are 20 and the trial is 14 days. Price 0 is the free trial. The trial package is `is_active = false`, so the public catalogue hides it. An admin list that selects every package will still show the row. Do not present it as a plan for sale.

`voicemail_until` is the voicemail window after a trial ends or a line is suspended (default 7 days, `billing_lifecycle_settings.voicemail_hold_days`). Callers can leave a voicemail until then. After that, callers hear that the line is not available. The dashboard does not play either message.

Payments, payment attempts, credits, pay tokens, and the audit log are not owner reads.

## Public pay page

`/pay/<token>` is not an owner read and not an admin screen. The Desk server calls `pay_invoice_by_token` with the service role. `invoice_pay_tokens` stores the sha256 hex only. Anon and authenticated cannot mint or read tokens. A business with `billing_enforcement` off has no pay link. The page never marks an invoice paid. See [`INVOICE_PAY.md`](./INVOICE_PAY.md). The SQL is not applied yet.

## Admin (service role)

| Read | What it is |
| --- | --- |
| `payments`, `payment_attempts`, `payment_events` | Recorded money and the webhook inbox. No provider call lives here. |
| `tenant_credits`, `tenant_credit_balance` | Invoice credits (an overpay). Not a wallet balance. |
| `billing_audit_log` | Billing actions. The same actions are also in `ops_audit_log` (Activity). |
| `subscription_events` | Billing status changes. |
| `billing_lifecycle_settings` | Voicemail hold days. `shadow_invoices` stays true until a later invoice builder is switched on. |
| `billing_notice_outbox` | Pending and sending notices for the sender. |

`sautikit_did_pool.status = 'quarantine'` is not Available. `quarantine_until` is a reuse hold (30 days is a placeholder, not a decision). It is not the 7-day voicemail window. After `quarantine_until`, the number can be assigned again. `release_did_from_business` and `quarantine_pool_number` both clear `tenant_id` and store the business on `last_tenant_id`. Release also sets the business number to pending. Pool quarantine does not change the business number.

`billing_notice_outbox` includes `sending` rows. The sender claims with `claim_billing_notices` (pending, or sending whose `claimed_at` is null or older than 15 minutes) and settles with `settle_billing_notice`. A notice already sent stays sent. `claimed_at` is for the sender. Owners still read `billing_notices`.

## What this layer does not do

- It does not charge a card or a phone.
- It does not send SMS, WhatsApp, or email. Billing notices wait on the existing sender. Call and voicemail updates are a different check: `tenant_escalation_allowed`. When that is false, those updates stay in the Inbox.
- It does not answer or refuse a call. Voice reads `voicemail_until` later.
- Deleting a business still removes its notices, status events, and invoices. A payment or a credit blocks that delete. The billing audit log stays.
