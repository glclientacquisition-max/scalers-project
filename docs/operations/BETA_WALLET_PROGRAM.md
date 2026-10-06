# Beta billing enforcement (packages + on-demand)

Billing modes are **product controls** for metering and on-demand debits. They are not a wallet top-up product or a graduation into float top-up.

## Model

| Mode (`billing_enforcement`) | Charges? | Blocks calls? | Use for |
|---|---|---|---|
| `off` | No (meter only) | No, until package minutes are used up **and** on-demand is off | **Beta whitelist** |
| `soft` | Yes (on-demand past included when opted in) | No | **On-demand soft** — debit scaffolding; ledger debits; do not block at zero |
| `hard` | Yes | Later (inbound gate not shipped) | **On-demand hard** — charge; future inbound block when product-approved |

New workspaces default to **`off`** (beta).

Ops changes enforcement: Admin → Businesses → shop → Plan → Beta or On-demand. On-demand writes `soft`. Hard inbound block is not wired.

When moving back to beta, ops can **waive negative balance** (trial credit) so on-demand-era debt disappears.

## Alerts and on-demand (desk)

Package **included minutes** are the primary cap story. Ledger balance and low-balance alerts are **ops scaffolding** when enforcement is on.

1. **Automatic live alerts** when ledger balance is low or at zero (WhatsApp/email — no soft-limit setup required).
2. **On-demand usage** opt-in on Desk → **Usage** (`/wallet`) past included minutes (`wallet_on_demand_alerts.sql`). The same toggle continues tenant SMS after included units (`sms_allowance.sql`).

## Security (wallet_security_beta.sql)

- Wallet columns RPC-only (trigger + column grants)
- Ledger append-only
- Money RPCs service_role only (revoked from anon/authenticated)
- Line fee amount fixed server-side
- Ops audit log for credits and plan changes
