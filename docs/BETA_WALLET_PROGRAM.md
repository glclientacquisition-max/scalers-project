# Beta wallet program

## Model

| Mode (`billing_enforcement`) | Charges? | Blocks calls? | Use for |
|---|---|---|---|
| `off` | No (meter only) | No | **Beta whitelist** |
| `soft` | Yes | No | Prepaid after graduation |
| `hard` | Yes | Later (inbound gate) | Paid + enforcement |

New workspaces default to **`off`** (beta).

Ops graduates a workspace: Admin → **Wallets** → Plan → `soft` (or `hard`).
The Plan panel confirms before leaving beta (real charges start) and before waiving a negative balance on return to beta.

When moving to beta, ops can **waive negative balance** (trial credit) so soft-era debt disappears.

## Soft spend limit (owner)

Optional monthly budget columns may exist (`wallet_soft_spend_limit.sql`) but are **not** the primary control. Preferred Cursor-like model:

1. **Automatic live alerts** when prepaid is running low / empty (WhatsApp/email — no soft-limit setup).
2. **On-demand usage** opt-in on Desk → Wallet when prepaid hits zero (`wallet_on_demand_alerts.sql`).

## Security (wallet_security_beta.sql)

- Wallet columns RPC-only (trigger + column grants)
- Ledger append-only
- Money RPCs service_role only (revoked from anon/authenticated)
- Line fee amount fixed server-side
- Ops audit log for credits and plan changes
