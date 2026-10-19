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

`GET /api/cron/billing-payment-retry` is in `dashboard/vercel.json` once a day at 03:07 UTC (`7 3 * * *`). This Vercel account is Hobby. A cron that runs more than once a day fails the deployment, which is what `7,22,37,52 * * * *` did on `5e4813d7`. It sweeps open checkouts and retries unreadable reads only when `BACHS_MODE=live` and `BACHS_LIVE_ALLOWED` is exactly `true`. A closed gate returns 200 and does not call Bachs. The report route `GET /api/cron/billing-reconcile` is not in `vercel.json`. It returns counts and does not write. It does not call Bachs unless `BACHS_MODE` is `sandbox` or an allowed `live`.
