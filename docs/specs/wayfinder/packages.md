# Wayfinder: package billing

**Destination:** Owners buy a monthly or annual package with included buckets. Exhausted buckets continue only if on-demand is on, or the owner upgrades. Super Admin owns the catalog behind a second access code.  
**Lane:** Ops & Billing (numbers, Admin). Platform (SQL/RPC). Desk (Usage). Voice (consume minutes on hangup).  
**Status:** Discussing. No schema or strip until the frontier is empty.  
**Companion:** [`../../PACKAGES.md`](../../PACKAGES.md), [`../../ONE_WALLET_BILLING.md`](../../ONE_WALLET_BILLING.md)

## Decisions so far

- Package is the product. KES wallet is on-demand overage and ops corrections only.
- Three paid SKUs: Starter, Growth, Scale. Monthly and annual. Annual is the same included numbers, paid once, reset each Nairobi month.
- v1 buckets: minutes, SMS, email, seats, one DID, staff WhatsApp utility.
- One minute pool. Inbound and live-transfer share included minutes.
- Seats are a hard cap. Never on-demand.
- One on-demand toggle for minutes, SMS, email, staff WA.
- Minutes exhaust + on-demand off: the caller still gets an answer. We meter. We do not debit. Owner is alerted. SMS/email/WA can stop.
- SMS exhaust may fall through to WhatsApp, then email, until that bucket is gone.
- Beta stays `billing_enforcement = off` until a Free SKU exists.
- Ops assigns SKUs first. Owner self-serve checkout is later.
- Staff WhatsApp is Meta utility only. Meta bills Scalers directly. SautiKit adds no WhatsApp markup. SautiKit wallet is voice only.
- `wa.me`, wallet/outage alerts, and inbound WhatsApp acks are never a tenant pack unit.
- On-demand overage (locked retail):
  - Staff WhatsApp: **KES 2** / send
  - SMS: **KES 1** / segment
  - Email: **KES 1** / send
  - Inbound minutes: **KES 2** / min, **per second** (`seconds × 2 / 60`)
  - Outbound / live-transfer: **KES 0.10** / sec (**KES 6** / min)
- Super Admin has a Packages panel that edits SKU names, monthly and annual prices, included numbers, and these overage rates, and assigns a SKU to a business.
- That panel is behind a **second access code**, on top of Super Admin login (`DASHBOARD_PASSWORD`). Not the owner desk.

## Not yet specified

- Default included numbers and monthly KES prices (panel-editable; straw table only).
- Annual multiplier (recommendation: 10× monthly).
- Inbound money rounding (KES 2/60 is repeating).
- Billing-code storage, TTL, and who holds it.
- Mid-period upgrade money.
- When to drop prepaid columns.

## Out of scope

- Owner M-Pesa checkout.
- Per-tenant WABA / Embedded Signup.
- Marketing WhatsApp templates.
- Extra DIDs as a v1 add-on.
- Hard inbound reject when minutes are empty.
- Soft spend limit (already dead UI).

## Straw defaults (editable in Super Admin)

| | Seats | Minutes | SMS | Email | Staff WA | DID |
| --- | --- | --- | --- | --- | --- | --- |
| Starter | 2 | 300 | 200 | 100 | 200 | 1 |
| Growth | 5 | 800 | 500 | 250 | 500 | 1 |
| Scale | 10 | 2000 | 1500 | 500 | 1000 | 1 |

Prices: founder types them in the panel. Company Brain band is about KES 1.5k–5k/mo.

## Frontier

### task / Billing admin second door

Super Admin login is not enough to change prices. A second code unlocks `/admin/packages`. Server env. Not `NEXT_PUBLIC_*`. Session after unlock.

### task / Per-second inbound rounding

`seconds × 2 / 60` needs a money rule (ceil second, then 2-decimal KES, or ceil to whole KES).

### task / Write SQL after this map is confirmed

`billing_packages`, `tenant_subscriptions`, `minutes_included` / `minutes_used`, `consume_minutes`, `consume_email_units`, period reset, package assign. Do not DROP prepaid columns in the first apply.
