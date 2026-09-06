# One-wallet billing (KES prepaid)

## Goal

Replace dual wallets (telecom KES + AI USD) with a **single prepaid KES wallet**.
AI cost is included in the per-minute retail rate — not a separate client balance.

## Constraints and how we solve them

| Constraint | Solution |
|---|---|
| Existing dual balances in production | One-time backfill: `wallet_balance_kes = telecom_kes + round(ai_usd × 130)` |
| Kenyan SMB payment rails | Wallet is KES-only; M-Pesa/Paystack top-up slots into `topup` ledger kind later |
| Free-beta tenants | Default `billing_enforcement = off` (whitelist): meter only, **no charges**. See `BETA_WALLET_PROGRAM.md` |
| Hangup webhooks fire more than once | `charge_call_to_wallet` is idempotent per `call_id` |
| Duration can arrive after first terminal event | First non-zero charge wins for v1; later duration upgrades do not double-bill |
| Monthly line fee with no cron yet | Lazy `apply_line_rental` when Wallet page loads (unique per `YYYY-MM`) |
| Line lapses when client misses renewal | `line_rental_grace.sql` tracks `line_paid_through`; wallet may go negative during `line_grace_days`; only then ops suspends the DID |
| Need audit trail | Append-only `wallet_ledger`; balance is cached on `tenants.wallet_balance_kes` |
| Owners must not forge credits | Ledger writes only via `security definer` RPCs granted to `service_role` |
| Rate still a product choice | Env: inbound `WALLET_RATE_KES_PER_MINUTE` (default **0**), outbound transfer `WALLET_TRANSFER_RATE_KES_PER_MINUTE` (default **4**), line `WALLET_LINE_FEE_KES_PER_MONTH` (default 1000) |

## Rate card (client-facing)

| Line item | Ledger kind | Amount |
|---|---|---|
| Receptionist minutes (inbound) | `call_charge` | **KES 0** (`round(minutes × 0)`) |
| Live transfer outbound | `call_charge` on a **second** `calls` row | **KES 4 / min** (`WALLET_TRANSFER_RATE_KES_PER_MINUTE`). Never fold into the inbound `call_id`. Beta does not originate outbound. See [`LIVE_TRANSFER.md`](./LIVE_TRANSFER.md) §8. |
| Line rental | `line_rental` | Fixed KES / calendar month (UTC) |
| Ops seed / correction | `admin_adjustment` | Signed KES |
| Future M-Pesa | `topup` | Positive KES |

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
WALLET_LINE_FEE_KES_PER_MONTH=1000
```

## Apply after one_wallet_billing

Also apply `docs/supabase/wallet_security_beta.sql` (RPC locks, column protection, ops audit, beta defaults).

Then apply `docs/supabase/wallet_soft_spend_limit.sql` (optional soft-budget columns).

Then apply `docs/supabase/wallet_on_demand_alerts.sql` (automatic low-balance live alerts + on-demand opt-in).

Then apply `docs/supabase/line_rental_grace.sql` (line paid-through, grace window, suspend RPC).

## Prepaid alerts + on-demand (Cursor-like)

| Piece | Behavior |
|---|---|
| Prepaid balance | Paid wallet money used first for call + line charges |
| Automatic live alerts | WhatsApp/email when balance drops under `wallet_low_balance_kes` (default 200) and again at ≤ 0. No owner soft-limit setup required. |
| On-demand usage (opt-in) | Default **off**. When prepaid ≤ 0 and on-demand off → further call charges pause until top-up. When on → keep charging (overdraft). |
| Soft inbound block | Separate hard-enforcement step (not this migration) |

Owners enable on-demand on Desk → Wallet. Alerts fire from the voice charge path after each completed call debit.

## Line rental grace (2026-09-03)

Clients pay Scalers a monthly line fee at our retail rate, not SautiKit's cost. Beta is free.

| State | Condition | Line |
| --- | --- | --- |
| Beta (`billing_enforcement = off`) | Always | Live. No charge. |
| Active | `now() <= line_paid_through` | Live. |
| Grace | `line_paid_through < now() <= line_paid_through + line_grace_days` | Live. Wallet may go negative. |
| Suspended | Past grace | Ops runs `suspend_line_for_nonpayment`. DID becomes `disabled`, not `available`. |

`apply_line_rental` extends `line_paid_through` by one month per charge and sets `line_status = active`. Annual plans are the same RPC called with 12 months when pricing is set.

## Later

- M-Pesa / Paystack STK top-up → `topup` ledger rows
- Hard enforcement on inbound when balance ≤ 0 and on-demand off
- Automatic line-expiry alerts (T-7 / T-1) from the voice notify stack
- Annual / official subscription pricing (product decision)
- Nairobi-TZ month boundaries
- COGS-based rate tuning (Soniox + Gemini)
