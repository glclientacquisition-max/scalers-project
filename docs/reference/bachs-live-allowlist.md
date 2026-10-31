---
owner: ops-billing
last_reviewed: 2026-10-19
---

# Business Assistant live payment allowlist

Live Bachs checkout for a business stays closed unless both of these are true:

- `BACHS_LIVE_ALLOWED` is the exact value `true`. That is the master switch. Anything else refuses live mode.
- The business has `billing_live_tenants.enabled` true, or its id is listed in `BACHS_LIVE_TENANT_ALLOWLIST`.

The env list is the compat fallback. `*` is the only value that opens every business. An unset, empty, or whitespace list opens none. A failed read of `billing_live_tenant_allowed` refuses the business. The env list is checked first, so a listed business does not wait on that read. That read runs on the production database when `BACHS_MODE=live` and the master switch is on. Sandbox mode still refuses the production database. The Payments page says "Hosting switch is off" when live mode or the master switch is closed, and "Not enabled" when the business row is off.

`admin_set_tenant_live_payments` is service role only. It requires a reason and an actor. It refuses to enable a business whose billing enforcement is off, or whose billing status is beta (a missing subscription counts as beta). Turning the row off is allowed. Each successful change writes `billing_audit_log` action `tenant_live_payments_set`.

The SQL file inserts no businesses.

P17 is [`docs/supabase/invoice_pay_live_allowlist.sql`](../supabase/invoice_pay_live_allowlist.sql), after P16. Staging project `sgcdncjxauhsbunobmob`: `invoice_pay_live_allowlist` (`20261019093619`). Production (`fjxcdccgyhnvnnlnovcl`): `20261019150641` via #820 `f6d7fee9`. Do not re-run it. P18 is `20261019150654` on the same apply. Only P19 is still outstanding.

`GET` and `POST /api/billing/live-tenants` call `requireSuperAdmin`. A signed-out visitor is redirected to `/admin/login`. That redirect is expected. The route does not return 401.

`GET /api/cron/billing-payment-retry` is called by pg_cron job `billing-payment-retry` every hour at :07 (migration `20261031040000_billing_pg_cron_reminders.sql`), through pg_net with the bearer secret held in Vault (`billing_cron_base_url`, `billing_cron_secret`). It is no longer in `dashboard/vercel.json` (Vercel Hobby allowed only one run a day). Missing pg_net or Vault secrets open one `billing_cron_unconfigured` ops notice and make no call. It sweeps open checkouts and retries unreadable reads only when `BACHS_MODE=live` and `BACHS_LIVE_ALLOWED` is exactly `true`. A closed gate returns 200 and does not call Bachs. The report route `GET /api/cron/billing-reconcile` is not scheduled. It returns counts and does not write. It does not call Bachs unless `BACHS_MODE` is `sandbox` or an allowed `live`. pg_cron job `billing-reconcile-daily` (03:40 UTC) logs the `billing_payment_reconciliation()` counts to `ops_audit_log` and opens a `billing_reconcile_mismatch` ops notice when anything does not match.
