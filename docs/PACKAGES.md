# Package entitlements

**Status:** Super Admin catalog at `/admin/packages` (username + access code). Voice consume and owner checkout later.  
**Lanes:** Ops & Billing (numbers, Admin). Platform (columns/RPCs).

A package is a set of **included counters** written onto the tenant. Enforcement is one consume RPC per bucket. Assigning "Starter = 500 SMS + 100 emails + 5 seats" is a write of those numbers, not a new send path.

## Buckets

| Bucket | Included column | Used | Overage | Now |
| --- | --- | --- | --- | --- |
| Tenant SMS | `sms_included_units` (default 200) | `sms_used_units` via `consume_sms_units` | Wallet on-demand | **Enforced** (`sms_allowance.sql`) |
| Tenant email | `email_included_units` (default 100) | `email_used_units` | Same on-demand when gated | **Reserved.** Meter on `notify_sends`. Do not block yet. |
| Team seats | `seat_included` (default 5) | Count of `tenant_members` | **No.** Hard cap. | **Reserved.** Do not block invites yet. |
| Inbound minutes | `minutes_included` | `seconds_used` | KES 0.05/sec (KES 3/min) | Catalog. Voice consume later. Prepaid wallet still live. |
| Line / DID | `line_paid_through` | Monthly `apply_line_rental` | Grace, then suspend | Live |
| Staff WhatsApp | `whatsapp_included_units` | `whatsapp_used_units` | KES 2 / send | Catalog. Consume later. Meta bills Scalers. |

Platform wallet and outage messages never consume tenant SMS or email.

Seats are login accounts (`tenant_members`), not People directory rows (`team_directory`).

## Rules

1. Package assign (`assign_tenant_package`) sets included columns. Owners cannot PATCH them. Protect trigger is RPC-only.
2. Period reset (future) zeroes `*_used_units`. Seats are a live count, not a used column.
3. Per-bucket top-up (future) increments included. Same stop rule.
4. Beta (`billing_enforcement = off`) meters and never blocks.
5. Paid + on-demand off: usage buckets stop at included. Seats refuse a sixth login even if on-demand is on.
6. New pack items (voice minutes as units, extra DIDs) get the same two-column + consume shape. Do not invent a second quota system.

## Not this slice

- Owner M-Pesa pack checkout
- `consume_email_units` or invite-time seat check
- Email or seat rows on the Wallet page

SQL: [`docs/supabase/package_entitlements.sql`](./supabase/package_entitlements.sql), [`package_catalog.sql`](./supabase/package_catalog.sql). SMS enforcement: [`sms_allowance.sql`](./supabase/sms_allowance.sql). Super Admin: `/admin/packages` after the existing username + access code.
