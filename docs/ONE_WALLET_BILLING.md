# One-wallet billing (KES ledger)

## Product positioning (2026-10-02)

**What owners buy:** package subscription (included minutes, SMS, seats, one phone line) plus optional **on-demand** usage past included. Configure packages and on-demand rates in Super Admin → **Packages**.

**What the wallet is:** an internal **KES ledger** for metering, on-demand debits, line rental, and ops adjustments. Customer money path is **packages + on-demand**; owner **package checkout** (M-Pesa/Paystack) is not shipped. The ledger stays ops scaffolding, not a float top-up product. Super Admin → **Ledger** (`/admin/wallets`) is ops scaffolding: balance, credits, enforcement mode.

## Goal

Replace dual wallets (telecom KES + AI USD) with a **single KES ledger** used for metering and on-demand overage.
AI cost is included in the per-minute retail rate — not a separate client balance.

## Constraints and how we solve them

| Constraint | Solution |
|---|---|
| Existing dual balances in production | One-time backfill: `wallet_balance_kes = telecom_kes + round(ai_usd × 130)` |
| Kenyan SMB payment rails | Ledger is KES-only; future owner checkout (M-Pesa/Paystack) is separate from this ops ledger |
| Free-beta tenants | Default `billing_enforcement = off` (whitelist): meter only, **no charges**. See `BETA_WALLET_PROGRAM.md` |
| Hangup webhooks fire more than once | `charge_call_to_wallet` is idempotent per `call_id` |
| Duration can arrive after first terminal event | First non-zero charge wins for v1; later duration upgrades do not double-bill |
| Monthly line fee with no cron yet | Lazy `apply_line_rental` when Desk → **Usage** loads (`/wallet`; unique per `YYYY-MM`) |
| Line lapses when client misses renewal | `line_rental_grace.sql` tracks `line_paid_through`; wallet may go negative during `line_grace_days`; only then ops suspends the DID |
| Need audit trail | Append-only `wallet_ledger`; balance is cached on `tenants.wallet_balance_kes` |
| Owners must not forge credits | Ledger writes only via `security definer` RPCs granted to `service_role` |
| Rate still a product choice | Env: inbound `WALLET_RATE_KES_PER_MINUTE` (default **0**), outbound transfer `WALLET_TRANSFER_RATE_KES_PER_MINUTE` (default **4**), line `WALLET_LINE_FEE_KES_PER_MONTH` (default 1000) |

## Rate card (client-facing)

| Line item | Ledger kind | Amount |
|---|---|---|
| Receptionist minutes (inbound on-demand) | `call_charge` via `consume_call_seconds` | **KES 6 / min** (`billing_rate_card` 0.10/sec) past included minutes. Included seconds are free. SautiKit inbound is currently free. |
| Live transfer outbound | `call_charge` on a **second** `calls` row | **KES 9 / min** stored (`billing_rate_card` 0.15/sec). Not offered until live transfer. SautiKit costs **KES 3 / min**. Never fold into the inbound `call_id`. Beta does not originate outbound. See [`LIVE_TRANSFER.md`](./LIVE_TRANSFER.md) §8. |
| Line rental | `line_rental` | Fixed KES / calendar month (UTC) |
| Ops seed / correction | `admin_adjustment` | Signed KES |
| Future owner pack payment (not shipped) | ops credit / entitlement (ledger may use `topup` kind technically) | Per package SKU — not a float top-up sell path |

## Apply order

Full project order: [`docs/supabase/README.md`](./supabase/README.md) (wallet section steps 16–18).

1. Apply `docs/supabase/wallet_metering.sql` if not already applied (adds dual columns + old RPC).
2. Apply `docs/supabase/one_wallet_billing.sql`.
3. Deploy dashboard + voice engine.
4. Set optional env on Railway:

```bash
WALLET_CHARGING_ENABLED=true
WALLET_RATE_KES_PER_MINUTE=0
WALLET_TRANSFER_RATE_KES_PER_MINUTE=4
WALLET_LINE_FEE_KES_PER_MONTH=1000
```

Package on-demand reads `billing_rate_card`, not these env rates. The env outbound default 4 applies only when `consume_call_seconds` is missing.

## Apply after one_wallet_billing

Also apply `docs/supabase/wallet_security_beta.sql` (RPC locks, column protection, ops audit, beta defaults).

Then apply `docs/supabase/wallet_soft_spend_limit.sql` (optional soft-budget columns).

Then apply `docs/supabase/wallet_on_demand_alerts.sql` (automatic low-balance live alerts + on-demand opt-in).

Then apply `docs/supabase/line_rental_grace.sql` (line paid-through, grace window, suspend RPC).

Then apply `docs/supabase/sms_allowance.sql` after `notify_send_ledger.sql` (included SMS + same on-demand toggle).

Then apply `docs/supabase/package_entitlements.sql` (reserved email + seat included columns; no gate).

## On-demand alerts and opt-in

| Piece | Behavior |
|---|---|
| Ledger balance | Used for on-demand debits and line charges when enforcement is on |
| Automatic live alerts | WhatsApp/email when balance drops under `wallet_low_balance_kes` (default 200) and again at ≤ 0. No owner soft-limit setup required. |
| On-demand usage (opt-in) | Default **off**. Package included minutes and SMS are not a ledger debit. Past the cap with on-demand off: the next inbound call is rejected, tenant SMS stops, no usage debit. Past the cap with on-demand on: answer and debit the rate card once `package_minute_consume.sql` is applied. Until that RPC exists, `charge_call_to_wallet` still runs and pauses only when the ledger balance is already 0. |
| Soft inbound block | Separate hard-enforcement step (not this migration) |

Owners enable on-demand on Desk → **Usage** (`/wallet`). Alerts fire from the voice charge path after each completed call debit. The same toggle covers included SMS (`sms_allowance.sql`).

## SMS included and stop at cap

Staff SMS and caller SMS share one tenant bucket. Ledger, line-outage, and speech or assistant outage SMS stay Scalers-paid and are never gated.

| Piece | Behavior |
|---|---|
| Included SMS | Default **200** segments (`tenants.sms_included_units`). Packages later replace this number. |
| Meter | `sms_used_units` increments via `consume_sms_units` before each tenant SMS. Ledger `notify_sends.overage` is true when the send is past included. |
| Stop at cap | Paid + on-demand **off**: skip tenant SMS. Staff WhatsApp / email / desk note still try. Escalate still saves. |
| On-demand | Same desk toggle as minutes. Tenant SMS continues past included and debits `sms_kes` after `package_minute_consume.sql`. |
| Beta (`billing_enforcement = off`) | Meter only. Never block. Never debit. |

Missing `consume_sms_units` fails open so staging still sends until the SQL is applied. On-demand off never debits SMS.

Package buckets (email, seats, later SKUs): [`PACKAGES.md`](./PACKAGES.md). Columns reserved in `package_entitlements.sql`. Do not gate email or invites yet.

## Line rental grace (2026-09-03)

Clients without a package pay Scalers a monthly line fee at our retail rate, not the carrier wholesale cost. Beta is free. A business with an assigned package does not get this fee: the monthly price already includes the number.

| State | Condition | Line |
| --- | --- | --- |
| Beta (`billing_enforcement = off`) | Always | Live. No charge. |
| Active | `now() <= line_paid_through` | Live. |
| Grace | `line_paid_through < now() <= line_paid_through + line_grace_days` | Live. Ledger may go negative. |
| Suspended | Past grace | Ops runs `suspend_line_for_nonpayment`. DID becomes `disabled`, not `available`. |

`apply_line_rental` extends `line_paid_through` by one month per charge and sets `line_status = active`. Annual plans are the same RPC called with 12 months when pricing is set.

## Later

- Package SKUs that write included SMS / email / seats. See [`PACKAGES.md`](./PACKAGES.md)
- Owner package checkout (M-Pesa/Paystack) — not ops ledger top-up as the primary product
- Hard enforcement on inbound when balance ≤ 0 and on-demand off
- Automatic line-expiry alerts (T-7 / T-1) from the voice notify stack
- Annual / official subscription pricing (product decision)
- Nairobi-TZ month boundaries
- COGS-based rate tuning (Soniox + Gemini)
