# Beta wallet program

## Model

| Mode (`billing_enforcement`) | Charges? | Blocks calls? | Use for |
|---|---|---|---|
| `off` | No (meter only) | No | **Beta whitelist** |
| `soft` | Yes | No | Prepaid after graduation |
| `hard` | Yes | Later (inbound gate) | Paid + enforcement |

New workspaces default to **`off`** (beta).

Ops graduates a workspace: Admin → **Wallets** → Plan → `soft` (or `hard`).

When moving to beta, ops can **waive negative balance** (trial credit) so soft-era debt disappears.

## Security (wallet_security_beta.sql)

- Wallet columns RPC-only (trigger + column grants)
- Ledger append-only
- Money RPCs service_role only (revoked from anon/authenticated)
- Line fee amount fixed server-side
- Ops audit log for credits and plan changes
