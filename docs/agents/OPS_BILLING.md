# Ops & Billing lane contract

**Mission:** Keep prepaid KES billing, DID inventory, and Super Admin ops correct, auditable, and hard to abuse.

Use for wallets, ledger, DID pool assign/release, SautiKit admin telecom actions, and beta billing enforcement.

## Owns (edit freely)

| Path | Role |
| --- | --- |
| `docs/supabase/wallet_*.sql`, `one_wallet_billing.sql` | Wallet schema / RPCs (coordinate Platform; apply order in [`docs/supabase/README.md`](../supabase/README.md)) |
| `docs/supabase/did_number_pool.sql`, `super_admin_ops.sql` | DID pool + ops helpers |
| `docs/ONE_WALLET_BILLING.md`, `BETA_WALLET_PROGRAM.md`, `PRODUCTION_DID_POOL.md`, `SUPER_ADMIN_REQUIREMENTS.md` | Ops docs |
| `dashboard/src/app/admin/**` | Super Admin shell + pages |
| `dashboard/src/app/api/admin/**`, `api/did-pool/**` | Ops APIs (service role) |
| `dashboard/src/lib/admin.ts`, `adminWallets.ts`, `didPool.ts`, `wallet.ts`, `sautikit.ts` | Ops libraries |
| `dashboard/src/components/Admin*.tsx`, `DidPoolManager.tsx`, `BuyNumberPanel.tsx`, `Sautikit*.tsx` | Ops UI |
| `dashboard/src/app/(desk)/wallet/**` | Owner wallet view (display + lazy line rental trigger) |
| Voice call sites of `chargeCallToWallet` | Metering hook only — do not redesign media loop |

## Do not touch

- Speech/media/turn-taking (Voice)
- Prompt policy / compiler semantics (Brain)
- Marketing landing redesign (Desk UI/UX)
- Broad Auth/RLS rewrites without Platform

## Billing / ops invariants

1. **One prepaid KES wallet** — AI bundled into per-minute rate; no resurrecting dual USD/KES client wallets.
2. Ledger is append-only; credits/debits via security-definer RPCs / service role only.
3. `charge_call_to_wallet` (and JS wrapper) must stay **idempotent** per call.
4. Beta default: `billing_enforcement = off` → meter only, no charges (`docs/BETA_WALLET_PROGRAM.md`).
5. Soft/hard enforcement behavior must match docs; do not silently bill beta tenants.
6. DID pool statuses (`available` / `assigned` / `reserved` / `disabled`) stay consistent with tenant `sautikit_virtual_number`.
7. Super Admin uses service role server-side; never ship service role to `NEXT_PUBLIC_*`.

## Rate card defaults (env)

- `WALLET_RATE_KES_PER_MINUTE` (default 15)
- `WALLET_LINE_FEE_KES_PER_MONTH` (default 1000)
- `WALLET_CHARGING_ENABLED`

## Test / verify

- SQL apply order per [`docs/supabase/README.md`](../supabase/README.md); no owner-forgable credit paths
- Admin: seed DID → assign → release → remove business paths still work
- Owner Wallet page: balance/ledger render; beta badge when enforcement off; automatic low-balance messaging; on-demand opt-in off by default
- If touching voice charge hook: smoke a completed-call path without double-billing

## Chat starter

```
You are the Scalers Ops & Billing lane agent.
Follow docs/agents/OPS_BILLING.md and .cursor/rules/ops-billing.mdc.
Own wallet/ledger, DID pool, and Super Admin ops.
Keep one KES prepaid wallet, idempotent call charges, and beta enforcement=off safe.
Do not redesign voice media or marketing UI.
Coordinate Platform before new SQL/RPC shapes.
Task: <one concrete billing or ops improvement>
```

## Good first tickets

- Admin wallet credit + plan toggle UX clarity
- DID assign/release edge cases (pending: user ids)
- Hard enforcement when balance ≤ 0 (product-approved)
- Line rental lazy apply correctness
- SautiKit sync / buy-number failure messaging
