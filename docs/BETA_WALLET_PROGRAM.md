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

Separate from ops `billing_enforcement`: owners may **opt in** to a monthly soft spend budget on Desk → Wallet, and set their own KES amount. Soft = warn only (50/80/100%); never blocks calls. Off by default. See `docs/ONE_WALLET_BILLING.md` and `docs/supabase/wallet_soft_spend_limit.sql`.

## Security (wallet_security_beta.sql)

- Wallet columns RPC-only (trigger + column grants)
- Ledger append-only
- Money RPCs service_role only (revoked from anon/authenticated)
- Line fee amount fixed server-side
- Ops audit log for credits and plan changes
