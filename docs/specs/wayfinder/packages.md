# Wayfinder: package billing

**Destination:** Owners buy a monthly or annual package with included buckets. Exhausted buckets continue only if on-demand is on, or the owner upgrades. Super Admin owns the catalog at `/admin/packages` after the existing username + access code login.  
**Lane:** Ops & Billing (numbers, Admin). Platform (SQL/RPC). Desk (Usage). Voice (consume minutes on hangup, later).  
**Status:** Control plane shipping. Owner Usage and Home read remaining buckets. Voice consume and prepaid strip are later.  
**Companion:** [`../../PACKAGES.md`](../../PACKAGES.md), [`../../supabase/package_catalog.sql`](../../supabase/package_catalog.sql)

## Decisions so far

- Package is the product. KES wallet is on-demand overage and ops corrections only.
- Three paid SKUs: Starter, Growth, Scale. Monthly and annual. Annual = monthly × 12 × (1 − discount %). Discount lives on the rate card. Admin types it.
- v1 buckets: minutes, SMS, email, seats, one DID, staff WhatsApp utility.
- One minute pool. Inbound and live-transfer share included minutes.
- Seats are a hard cap. Never on-demand.
- One on-demand toggle for minutes, SMS, email, staff WA.
- Minutes exhaust + on-demand off: the caller still gets an answer. We meter. We do not debit.
- SMS exhaust may fall through to WhatsApp, then email, until that bucket is gone.
- Beta stays `billing_enforcement = off` until a Free SKU exists. Assigning a package does not leave beta. Wallets Plan still does that.
- Ops assigns SKUs from Super Admin. Owner checkout is later.
- Staff WhatsApp is Meta utility only. Meta bills Scalers directly. SautiKit wallet is voice only.
- `wa.me`, wallet/outage alerts, and inbound WhatsApp acks are never a tenant pack unit.
- On-demand defaults:
  - Staff WhatsApp: KES 2 / send
  - SMS: KES 1 / segment
  - Email: KES 1 / send
  - Inbound: **KES 0.05 / sec** (KES 3 / min). Whole seconds, money to 2 decimals.
  - Outbound / live-transfer: **KES 0.10 / sec** (KES 6 / min)
- Super Admin login is username + access code (`/admin/login`, `ADMIN_OPERATORS` or `ADMIN_ACCESS_CODE`). That session opens Packages. No third password.
- `/admin/packages` edits rates, SKU included numbers, monthly KES, annual discount %, and assigns a package to a business.

## Not yet specified

- Founder monthly prices (type them in the panel; seed is 0).
- Mid-period upgrade money.
- `consume_minutes` / `consume_email_units` / WhatsApp consume on the voice path.
- When to drop prepaid columns.

## Out of scope

- Owner M-Pesa checkout.
- Per-tenant WABA.
- Marketing WhatsApp templates.
- Extra DIDs as a v1 add-on.
- Hard inbound reject when minutes are empty.

## Straw included defaults (editable in Super Admin)

| | Seats | Minutes | SMS | Email | Staff WA | DID |
| --- | --- | --- | --- | --- | --- | --- |
| Starter | 2 | 300 | 200 | 100 | 200 | 1 |
| Growth | 5 | 800 | 500 | 250 | 500 | 1 |
| Scale | 10 | 2000 | 1500 | 500 | 1000 | 1 |

## Frontier

### task / Apply package_catalog.sql

Ops applies [`package_catalog.sql`](../../supabase/package_catalog.sql) on staging, then production. Until then `/admin/packages` shows the setup error.

### task / Wire consume on hangup

Replace `charge_call_to_wallet` as the owner meter with per-second consume. Later PR.

### task / Usage page reads package remaining

Desk Usage and Home show package name and remaining buckets. Admin Businesses shows the assigned package. Done in the Usage meter PR.
