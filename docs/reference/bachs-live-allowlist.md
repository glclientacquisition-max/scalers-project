---
owner: ops-billing
last_reviewed: 2026-10-19
---

# Business Assistant live payment allowlist

Live Bachs checkout for a business stays closed unless both of these are true:

- `BACHS_LIVE_ALLOWED` is the exact value `true`. That is the master switch. Anything else refuses live mode.
- The business has `billing_live_tenants.enabled` true, or its id is listed in `BACHS_LIVE_TENANT_ALLOWLIST`.

The env list is the compat fallback. `*` is the only value that opens every business. An unset, empty, or whitespace list opens none. A failed read of `billing_live_tenant_allowed` refuses the business. The env list is checked first, so a listed business does not wait on that read.

`admin_set_tenant_live_payments` is service role only. It requires a reason and an actor. It refuses to enable a business whose billing enforcement is off, or whose billing status is beta (a missing subscription counts as beta). Turning the row off is allowed. Each successful change writes `billing_audit_log` action `tenant_live_payments_set`.

The SQL file inserts no businesses. Production is not part of this change.

P17 is [`docs/supabase/invoice_pay_live_allowlist.sql`](../supabase/invoice_pay_live_allowlist.sql), after P16. The only apply is staging project `sgcdncjxauhsbunobmob`: `invoice_pay_live_allowlist` (`20261019093619`). The table is empty.

The report route `GET /api/cron/billing-reconcile` is not in `vercel.json`. It returns counts and does not write. It does not call Bachs unless `BACHS_MODE` is `sandbox` or an allowed `live`.
