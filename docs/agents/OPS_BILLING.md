# Ops & Billing lane contract

**Mission:** Keep package + on-demand billing honest in product copy, DID inventory, ledger metering, and Super Admin ops correct, auditable, and hard to abuse.

Use for packages catalog, on-demand rate card, wallet ledger (ops scaffolding), DID pool assign/release, phone-line admin telecom actions, and beta billing enforcement.

**Product lock (2026-10-02):** Customer billing = **packages + on-demand only**. No wallet top-up product. The KES ledger is internal scaffolding for metering and on-demand debits. Owner **package checkout** is not shipped.

## Owns (edit freely)

| Path | Role |
| --- | --- |
| `docs/supabase/wallet_*.sql`, `one_wallet_billing.sql` | Wallet schema / RPCs (coordinate Platform; apply order in [`docs/supabase/README.md`](../supabase/README.md)) |
| `docs/supabase/did_number_pool.sql`, `super_admin_ops.sql` | DID pool + ops helpers |
| `docs/operations/ONE_WALLET_BILLING.md`, `BETA_WALLET_PROGRAM.md`, `PACKAGES.md`, `PRODUCTION_DID_POOL.md`, `SUPER_ADMIN_REQUIREMENTS.md` | Ops docs (all under `docs/operations/`) |
| `dashboard/src/app/admin/**` | Super Admin shell + pages |
| `dashboard/src/app/api/admin/**`, `api/did-pool/**` | Ops APIs (service role) |
| `dashboard/src/lib/admin.ts`, `adminWallets.ts`, `didPool.ts`, `wallet.ts`, `sautikit.ts` | Ops libraries |
| `dashboard/src/components/Admin*.tsx`, `DidPoolManager.tsx`, `BuyNumberPanel.tsx`, `Sautikit*.tsx` | Ops UI |
| `dashboard/src/app/(desk)/wallet/**` | Owner **Usage** view (route `/wallet`; display + lazy line rental trigger) |
| Voice call sites of `chargeCallToWallet` | Metering hook only — do not redesign media loop |

## Do not touch

- Speech/media/turn-taking (Voice)
- Prompt policy / compiler semantics (Brain)
- Marketing landing redesign (Desk UI/UX)
- Broad Auth/RLS rewrites without Platform

## Billing / ops invariants

0. **Packages + on-demand (customer story)** — Owners buy a package SKU; past included usage uses on-demand rates when opted in. Super Admin **Packages** is the primary billing surface. **Ledger** is ops scaffolding, not the headline checkout path.
1. **One KES ledger** — AI bundled into per-minute rate; no resurrecting dual USD/KES client wallets.
2. Ledger is append-only; credits/debits via security-definer RPCs / service role only.
3. `charge_call_to_wallet` (and JS wrapper) must stay **idempotent** per call.
4. Live transfer outbound is a **second** call id. Never fold those minutes into the inbound row. Beta does not originate outbound PSTN unless ops sets the lab flag. See [`docs/product/LIVE_TRANSFER.md`](../product/LIVE_TRANSFER.md) §8.
5. Beta default: `billing_enforcement = off` → meter only, no charges (`docs/operations/BETA_WALLET_PROGRAM.md`).
6. Soft/hard enforcement behavior must match docs; do not silently bill beta tenants.
7. DID pool statuses (`available` / `assigned` / `reserved` / `disabled`) stay consistent with tenant `sautikit_virtual_number`.
8. Super Admin uses service role server-side; never ship service role to `NEXT_PUBLIC_*`.
9. Super Admin is a universal app, same bar as the owner desk. Platform shows line, speech, reasoning, money. Who we notify are people (name, phone, email) under Escalate. Domain, DNS, Resend, and API keys are infra, not Admin controls. `/no-ai-slop` on ops UI copy. This holds in every Ops/Admin chat.

## Rate card defaults (env)

- `WALLET_RATE_KES_PER_MINUTE` (inbound, default **0**; SautiKit inbound is currently free)
- `WALLET_TRANSFER_RATE_KES_PER_MINUTE` (legacy fallback only when `consume_call_seconds` is missing; default **4**)
- Package rate card (`billing_rate_card`): inbound **KES 0.10/sec** (KES 6/min), outbound **KES 0.15/sec** (KES 9/min). Outbound is stored and hidden until live transfer. SautiKit outbound cost is **KES 3 / min** answered.
- `WALLET_LINE_FEE_KES_PER_MONTH` (default 1000)
- `WALLET_CHARGING_ENABLED`

## Test / verify

- SQL apply order per [`docs/supabase/README.md`](../supabase/README.md); no owner-forgable credit paths
- Admin: seed DID → assign → release → remove business paths still work
- Owner **Usage** page (`/wallet`): balance/ledger render; beta badge when enforcement off; automatic low-balance messaging; on-demand opt-in off by default; SMS used/included when `sms_allowance.sql` is applied
- If touching voice charge hook: smoke a completed-call path without double-billing

## Chat starter

```
You are the Scalers Ops & Billing lane agent.
Follow docs/agents/OPS_BILLING.md and .cursor/rules/ops-billing.mdc.
Own packages catalog, on-demand rate card, KES ledger scaffolding, DID pool, and Super Admin ops.
Customer billing = packages + on-demand only; no wallet top-up product.
Keep idempotent call charges and beta enforcement=off safe.
Do not redesign voice media or marketing UI.
Coordinate Platform before new SQL/RPC shapes.
Task: <one concrete billing or ops improvement>
```

## Good first tickets

- BETA + lane SoT docs aligned to packages + on-demand (legacy float vocabulary stripped)
- Admin Ledger plan toggle + enforcement copy (legacy top-up sell UI removed in #527)
- DID assign/release edge cases (pending: user ids)
- Hard inbound gate when on-demand off and ledger/package rules say block (product-approved; not shipped)
- Line rental lazy apply correctness
- SautiKit sync / buy-number failure messaging
