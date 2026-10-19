---
owner: ops-billing
last_reviewed: 2026-10-19
status: proposed
---

# Super Admin billing IA research

Research for simpler admin billing that matches Scalers packages + on-demand, lowers cognitive load, and aligns with the shop hub and Today restructure (#787, #797).

## Problem (why it feels bad today)

Operators hit **the same jobs in three or four places** with **different layouts and words**:

| Job | Where it appears today |
| --- | --- |
| Shop has no package | Today Needs you, Packages Needs you, Billing list filters, Shop Money |
| Change package / period | `/admin/billing/[id]` (sections + buttons), Shop Package sheet, Packages Shops tab |
| Beta vs charging | Billing detail Charging section, Shop Plan sheet, Billing list KPIs + columns |
| On-demand rates | Billing detail read-only paragraph, Packages Rates sheet |
| Usage / minutes | Billing list columns, Billing detail Usage section, Shop (partially via charges) |
| Charge lines | Shop Charges sheet, Billing detail History |

The **Billing tab** adds a second business directory: four KPI tiles, a seven-column desktop table, filters (`Beta only`, `Charging only`, `Low minutes`, `Exhausted`), and a separate detail page that does not use `ListRow` / `ShopBlock` like the rest of admin.

**Copy leaks implementation:** "On-demand soft", "On-demand hard", "billing_enforcement", rate card numbers in prose. Ops contract (`docs/reference/lanes/OPS_BILLING.md`) says customer story is **packages + on-demand**; owners opt in on the desk.

**Docs vs product:** `docs/STATUS.md` still says "The admin billing console is not started" while `/admin/billing` and `/admin/packages` exist. **Invoices and pay links** have SQL and owner/pay UI on staging (`INVOICE_PAY.md`) but **no admin screen** for open invoices, mint pay link, or void.

**Requirements doc drift:** `SUPER_ADMIN_REQUIREMENTS.md` lists Calls and Settings nav; live admin uses Quality and Voices. It already says plan and charges belong on the **shop**; the Billing client page contradicts that.

## System truth (what admin must support)

From lane contract and read models (not aspirational UI):

1. **Catalog (platform):** package SKUs, published versions (#778, flag-gated), on-demand rate card. Visited rarely.
2. **Per business:** assign package + period, set plan (beta meter vs on-demand charging), grant included minutes, read usage buckets, read charge lines (`wallet_ledger`), audit in Activity.
3. **Beta default:** `billing_enforcement = off` → meter only, no charges. Production stays here until explicit go.
4. **Not in admin product UI:** wallet top-up, ledger repair, provider keys, env names, Bachs setup.
5. **Coming (staging, not prod):** issue invoice, pay token, M-Pesa pay page. Admin will need a thin **Invoices** surface when pay ships; not required for beta ops today.

Owner desk mirrors a subset: Plan, Billing (invoices when live), Usage (`/wallet` route). Admin should not duplicate the owner layout; it should **operate** the same facts with confirm sheets.

## Design options (design it twice)

### A. Shop-first money block (recommended)

**Idea:** One place per business for all money work: the shop hub **Money** block (extend #797 sections).

- **Today** keeps queue rows (no package, low minutes when product wants them).
- **Businesses** list opens shop; money work never requires `/admin/billing/[id]`.
- **Billing nav** becomes a **filtered queue** only: Segmented tabs `All | Needs you | Beta | Charging`, each row a `ListRow` → `/admin/businesses/[id]` (scroll to Money). No KPI grid, no table.
- **Packages** renamed in UI to **Catalog** (route can stay `/admin/packages`): Needs you links to shops; tabs `Packages | Rates` only; drop duplicate Shops tab (shops list is Businesses).
- **Package version editor** stays behind flag; collapsed under Catalog as today.

**Pros:** Matches SUPER_ADMIN_REQUIREMENTS §5, matches shop restructure, one mental model ("open the shop"). **Cons:** Long shop page; needs sticky section labels or in-page anchors.

### B. Billing tab as the only list; shop for line/people only

**Idea:** Keep `/admin/billing` as the canonical directory; remove Package/Plan/Charges from shop Money (line + number only).

**Pros:** Separates "money desk" from "line desk". **Cons:** Fights #787 shop hub; two hops for "fix this shop's package" when Today already sends you to the shop.

### C. Minimal change: unify components only

**Idea:** Keep three routes; refactor `AdminBillingDetailPanel` to reuse `ShopBlock` + `ListRow` + same sheets as `AdminShopPanel`.

**Pros:** Small diff. **Cons:** Does not remove duplicate directories or KPI noise; cognitive load stays high.

## Recommendation

**Ship A in two phases.**

### Phase 1 (UX, no new billing APIs)

1. Replace Billing list UI with Segmented queue + `ListRow` (mobile-first; drop seven-column table or keep table only for `md+` with three columns: Business, Plan, Minutes).
2. Redirect `/admin/billing/[tenantId]` → `/admin/businesses/[id]` with hash or query `?section=money` and expand Money block.
3. Move **Grant minutes** and **Usage** summary into shop Money as `ListRow`s (same sheets as today).
4. Rename user-facing strings: `Beta` / `Charging` instead of soft/hard; one line under Plan: "Meter only" vs "Charges past included when owner opted in".
5. Packages: remove Shops tab; Needs you rows link to shop; subtitle "Catalog and rates".
6. Update `SUPER_ADMIN_REQUIREMENTS.md` nav to Quality / Voices; note Billing tab = money queue.

### Phase 2 (when invoice pay is prod)

1. Add **Invoices** under Catalog or Money: list open/draft/paid for one business from shop; actions mint pay link, void (confirm sheets). No provider UI.
2. Today row type for overdue / draft blocking number (if product rules require it).
3. Remove STATUS line "admin billing console is not started" when Phase 1 ships.

## IA target (one screen each)

```text
Today          → queues (including package / minutes attention)
Businesses     → shop (Line · Shop · Money · Line state · People)
Billing tab    → money queue only (filter + search → shop Money)
Catalog        → SKUs, rates, versions (platform)
Activity       → audit (already records billing actions)
```

## Copy rules (Frontend 2.0 + no-ai-slop)

- Say **business**, never tenant.
- Say **Beta** and **Charging**, not enforcement modes.
- Say **Catalog** for platform packages; **Package** on the shop row.
- Do not show inbound/outbound KES on the shop unless operator opens **Rates** in Catalog or a "View rates" row.
- Empty Billing queue: "Nothing needs billing" with next action to open Catalog or Businesses.

## Success checks

- Assign package: Today or Businesses → shop → one sheet (no `/admin/billing/` route).
- Operator can describe path in one sentence: "I open the business; money is in Money."
- Playwright: Billing list uses `ListRow`; shop Money has Package, Plan, Charges, Grant minutes.
- Tests: update `adminToday.test.js` / billing guards if routes redirect.

## Out of scope

- Owner self-serve checkout, M-Pesa in admin, Bachs webhook config, SQL migrations, changing beta defaults on prod.

## References

- `docs/reference/lanes/OPS_BILLING.md`
- `docs/reference/operations/SUPER_ADMIN_REQUIREMENTS.md` §4–5
- `docs/reference/operations/BILLING_READ_MODELS.md`
- `docs/reference/operations/INVOICE_PAY.md`
- `dashboard/src/components/AdminBillingListPanel.tsx`, `AdminBillingDetailPanel.tsx`, `AdminShopPanel.tsx`, `AdminPackagesPanel.tsx`
