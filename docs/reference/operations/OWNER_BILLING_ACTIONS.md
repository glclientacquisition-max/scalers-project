---
owner: ops-billing
last_reviewed: 2026-10-18
---

# Owner billing actions

The calls Scalers Desk makes when an owner changes a plan, buys seats, or sets a spend limit. Screens stay off unless `DESK_PLAN_CHANGE` is the exact value `on`. This document is the contract. It does not charge a card and it does not call a payment provider.

SQL: [`docs/supabase/owner_billing_actions.sql`](../../supabase/owner_billing_actions.sql). The Desk module is `dashboard/src/lib/ownerBillingActions.ts`. It uses the Supabase service role on the server. Production project `fjxcdccgyhnvnnlnovcl` is refused before any call. Staging is `sgcdncjxauhsbunobmob`.

Beta businesses (`billing_enforcement` off, which is every current production business, or `billing_status` beta) get `code: beta`. No proration invoice, no seat line, no spend-limit hold.

## Who can call

The SQL checks `tenant_members.role` is `owner` or `admin`. The Desk action checks the same thing first, and also the flag and the database URL.

Desk refusal codes, before SQL:

| Code | When |
| --- | --- |
| `disabled` | `DESK_PLAN_CHANGE` is not `on` |
| `production_refused` | The Supabase URL contains `fjxcdccgyhnvnnlnovcl` |
| `sign_in` | No signed-in user |
| `no_workspace` | No current business |
| `forbidden` | Role is not owner or admin |
| `rpc_failed` | The database call failed. The message does not include the database error |

## Prices

Read from `billing_package_versions`. Nothing in the functions hard-codes a plan price.

Annual price = `round(monthly_price_kes * 12 * (100 - annual_discount_percent) / 100)` to a whole shilling. The discount is on the version row.

Day proration uses Africa/Nairobi dates. `days_in_period` is the end date minus the start date, at least 1. `days_left` is the end date minus today, clamped to `0..days_in_period`. Amount = `round(price_kes * days_left / days_in_period, 0)` (half away from zero). The net is charge minus credit and is never below 0. No cash refund.

An upgrade credits the unused part of the current term and charges the new plan for those same days. Monthly to annual credits the unused days of the current month and charges the full annual price, because the new year starts today. Extra seats already on the business are included in both prices.

Reference numbers, not constants in the functions: Starter 7,000 a month, Growth 18,000, Scale 35,000. Annual 69,720 / 194,400 / 378,000 (17 percent, 10 percent, 10 percent). Seats 3 / 8 / 20. Extra seat 500 a month on the version row (`extra_seat_monthly_kes`).

Worked example, 10 of 30 days, 7,000 to 18,000: credit 2,333, charge 6,000, net 3,667.

## Shared result

Every SQL action returns jsonb:

| Field | Meaning |
| --- | --- |
| `ok` | boolean |
| `code` | see below |
| `replayed` | true when the same idempotency key is sent again. No second audit row and no second invoice |
| `message` | one sentence Desk can show |

Writes take `p_tenant_id uuid`, `p_actor uuid`, `p_idempotency_key text`. A blank key is `idempotency_key_required`. The same key used for a different action is `idempotency_conflict`. A replay returns the stored result with `replayed: true`.

Successful writes and business-rule refusals are audited in `billing_audit_log` (and `ops_audit_log`). A forbidden caller and an idempotency conflict are audited too. A replay is not audited again.

## owner_preview_plan_change(tenant, actor, sku, period)

Read only. No idempotency key. Same classification as the write.

## owner_change_plan(tenant, actor, sku, period, idempotency_key)

| Code | ok | What happened |
| --- | --- | --- |
| `beta` | true | Nothing changed |
| `not_found` | false | No such business |
| `forbidden` | false | Caller is not owner or admin |
| `idempotency_key_required` | false | Blank key |
| `idempotency_conflict` | false | Key already used for another action |
| `invalid_period` | false | Period is not `month` or `year` |
| `no_package` | false | No active package clock |
| `not_active` | false | `billing_status` is not `active` |
| `package_not_found` | false | SKU has no published version |
| `not_for_sale` | false | Inactive package, or trial |
| `same` | true | Already on that plan and period. Does not cancel a scheduled change |
| `seats_exceed_plan` | false | Members plus pending invites (owner included) exceed the target version's seats. Also returns `seats_included` and `seats_used`. Pending columns stay empty |
| `no_renewal` | false | A scheduled change has no term end and no period end |
| `scheduled` | true | Downgrade, or annual to monthly. No invoice. `pending_change` is `downgrade` or `period_change`. `effective_at` is the term end, or the usage period end when there is no term. `credit_kes`, `charge_kes`, and `total_kes` are 0 |
| `upgraded` | true | Applied now. Returns the quote fields plus `invoice_id` |

Monthly to annual applies now. Annual to monthly waits for `term_end`, which is after the current usage month, so the monthly rollover does not apply it early.

`upgraded` also returns `credit_kes`, `charge_kes`, `total_kes`, `days_left`, `days_in_period`, `package_sku`, `period`. The invoice is finalized (`status` open, number `SC-YYYY-NNNNNN`) and has a negative credit line and a positive charge line. `billing_source` is `proration`. Finalizing queues an invoice-due notice. It does not collect money.

## owner_cancel_plan_change(tenant, actor, idempotency_key)

| Code | ok | What happened |
| --- | --- | --- |
| `beta` | true | Nothing changed |
| `nothing_scheduled` | true | No pending change |
| `change_cancelled` | true | Pending columns cleared. The current plan stays |

Plus the shared gate codes.

## owner_set_extra_seats(tenant, actor, extra_seats, idempotency_key)

`extra_seats` is the new total of extra seats, 0 to 100, not a delta. Price is `extra_seat_monthly_kes` on the pinned version. A yearly plan annualizes that price with the version discount. The prorated amount is a line on a draft invoice (`billing_source` next). It is not finalized and nothing is collected. A removal is a negative line. The invoice total is never below 0. `seat_included` becomes version seats plus extra seats.

| Code | ok | Extra fields |
| --- | --- | --- |
| `beta` | true | Seats unchanged |
| `invalid_seats` | false | |
| `seat_price_missing` | false | Version has no extra-seat price |
| `seats_in_use` | false | `seats_included`, `seats_used`. People already on the business do not fit |
| `same` | true | `extra_seats` |
| `seats_updated` | true | `extra_seats`, `delta`, `unit_kes`, `amount_kes`, `invoice_id`, `days_left`, `days_in_period`, `seat_price_kes` |

## owner_set_spend_limit(tenant, actor, limit_kes, idempotency_key)

Null or 0 stores null and means half the pinned monthly price. A number is rounded to a whole shilling and must be from 500 to 1,000,000.

| Code | ok | Extra fields |
| --- | --- | --- |
| `beta` | true | Column unchanged |
| `invalid_spend_limit` | false | |
| `spend_limit_updated` | true | `soft_spend_limit_kes`, `effective_limit_kes` |

## Spend limit and usage

`billing_spend_limit_kes(tenant)` is null when billing is off. Otherwise the stored `soft_spend_limit_kes`, or half the pinned monthly price when that column is null.

`billing_period_on_demand_kes` sums on-demand `call_charge` and `sms_charge` rows in the current usage period (`wallet_ledger.metadata.on_demand` = `true`).

`billing_spend_allows_charge(tenant, amount)` is true for beta (the caller still does not debit). When the amount would pass the limit, it returns false and sets `tenants.spend_limit_blocked` for this usage period. A later charge in the same period does not write a second audit row.

`billing_on_demand_open(tenant)` is read only. Beta returns the on-demand flag. A held period, or a spend that is already at the limit, returns false.

The stop matches on-demand off:

- `consume_call_seconds` still meters the call already in progress and does not debit once the limit would be passed. The next inbound call is refused after the directory sees `spend_limit_blocked`.
- `consume_sms_units` and `reserve_notify_send` do not take an overage SMS.
- `tenant_escalation_allowed` stays `(uuid) returns (allowed boolean, reason text)`. Past the minute allowance, a closed spend limit returns `minutes_cap`, so WhatsApp and call updates stay in the Inbox. Billing notices are not gated by it.
- Inbound answering inside the included minutes is unchanged. A missing `spend_limit_blocked` column fails open to the previous on-demand flag.

The hold clears when `current_period_start` changes.

Re-apply `owner_billing_actions.sql` after `package_minute_consume.sql`, `notify_send_reserve_settle.sql`, or `billing_data_layer.sql`. Those files own the original function bodies. This file replaces them with the spend-limit hook.

## Apply

Staging first. Production copy: [`docs/supabase/prod/owner_billing_actions.sql`](../../supabase/prod/owner_billing_actions.sql). Do not run it until a backup and Alvin's GO.
