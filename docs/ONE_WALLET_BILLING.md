# One-wallet billing (KES prepaid)

## Goal

Replace dual wallets (telecom KES + AI USD) with a **single prepaid KES wallet**.
AI cost is included in the per-minute retail rate — not a separate client balance.

## Constraints and how we solve them

| Constraint | Solution |
|---|---|
| Existing dual balances in production | One-time backfill: `wallet_balance_kes = telecom_kes + round(ai_usd × 130)` |
| Kenyan SMB payment rails | Wallet is KES-only; M-Pesa/Paystack top-up slots into `topup` ledger kind later |
| Free-beta tenants at balance 0 | Default `billing_enforcement = soft`: debit (may go negative), **do not block calls** |
| Hangup webhooks fire more than once | `charge_call_to_wallet` is idempotent per `call_id` |
| Duration can arrive after first terminal event | First non-zero charge wins for v1; later duration upgrades do not double-bill |
| Monthly line fee with no cron yet | Lazy `apply_line_rental` when Wallet page loads (unique per `YYYY-MM`) |
| Need audit trail | Append-only `wallet_ledger`; balance is cached on `tenants.wallet_balance_kes` |
| Owners must not forge credits | Ledger writes only via `security definer` RPCs granted to `service_role` |
| Rate still a product choice | Env/constants: `WALLET_RATE_KES_PER_MINUTE` (default 15), `WALLET_LINE_FEE_KES_PER_MONTH` (default 1000) |

## Rate card (client-facing)

| Line item | Ledger kind | Amount |
|---|---|---|
| Receptionist minutes | `call_charge` | `round(minutes × rate)` KES |
| Line rental | `line_rental` | Fixed KES / calendar month (UTC) |
| Ops seed / correction | `admin_adjustment` | Signed KES |
| Future M-Pesa | `topup` | Positive KES |

## Apply order

1. Apply `docs/supabase/wallet_metering.sql` if not already applied (adds dual columns + old RPC).
2. Apply `docs/supabase/one_wallet_billing.sql`.
3. Deploy dashboard + voice engine.
4. Set optional env on Railway:

```bash
WALLET_CHARGING_ENABLED=true
WALLET_RATE_KES_PER_MINUTE=15
WALLET_LINE_FEE_KES_PER_MONTH=1000
```

## Later (not in this PR)

- M-Pesa / Paystack STK top-up → `topup` ledger rows
- Hard enforcement on inbound when balance ≤ 0
- Nairobi-TZ month boundaries
- COGS-based rate tuning (Soniox + Gemini)
