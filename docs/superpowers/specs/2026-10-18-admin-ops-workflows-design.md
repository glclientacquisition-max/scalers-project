---
owner: desk
last_reviewed: 2026-10-18
---

# Super Admin ops workflows (design)

**Audience:** Alvin + one operator (no roles).  
**Goal:** Run Scalers end-to-end from Super Admin: queue → shop → confirm → Activity, on phone or desktop, without a vendor console.

**Charter:** Frontend 2.0, [`SUPER_ADMIN_REQUIREMENTS.md`](../../reference/operations/SUPER_ADMIN_REQUIREMENTS.md), Desk/Ops lane contracts.

## Principles

1. **Workflow-first** — Today is the door; each tab is one job, not a database browser.
2. **Shop hub** — `/admin/businesses/[id]` is the place for line, plan, package, charges, lifecycle (not a stack of shop sheets on the list).
3. **Short confirms** — Assign, release, lifecycle stay in `ConfirmSheet` / action sheets; list keeps quick Assign for waiting rows only.
4. **Honest data** — No invented KPIs; Today compares to last week same weekday where counts exist; gaps say why.
5. **Two operators** — Activity records Better Auth username; prod uses `ADMIN_OPERATORS=user:code` (Platform PR).
6. **No collision** — Do not merge draft #697; cherry-pick ideas on `main`. Billing depth waits on #775/#778.

## Navigation (unchanged URLs)

| Route | Job |
| --- | --- |
| `/admin` | Today: status, Needs you, call volume |
| `/admin/businesses` | Search, filter, Needs you (waiting) |
| `/admin/businesses/[id]` | One shop: all actions |
| `/admin/quality` | Call quality (nav label **Quality**) |
| `/admin/billing` | Money posture; row → `/admin/billing/[tenantId]` |
| `/admin/packages` | Catalog |
| `/admin/numbers` | Pool |
| `/admin/platform` | Line, people, notices |
| `/admin/activity` | Audit |
| `/admin/voices` | Voice catalog (Settings in More) |

## Shop page sections

1. Status stamp and number  
2. Quality link when badge exists  
3. Notify, created  
4. Activity link  
5. Package, plan, charges (sheets)  
6. Assign / release (rules unchanged)  
7. Suspend, archive, restore (ConfirmSheet + reason)

## Today visuals

- Reuse `QualitySpark` / week-over-week copy only when `CallCount` is non-null.  
- No revenue or invoice tiles (not built).

## Security (Platform lane, parallel)

- Drop legacy HMAC cookie after Better Auth sign-in (or stop setting it).  
- No `dev-admin-secret` in production.  
- Tighten Better Auth `trustedOrigins`.  
- Require per-operator codes in prod.

## Out of scope (this program)

- Invoices, M-Pesa checkout (#780+).  
- Business edit, members, owner reset (follow-up Ops/Platform).  
- RBAC inside Super Admin.  
- Vendor/DNS/API keys on product UI.

## Success

- Operator completes: waiting shop → assign → plan → check quality, without hunting nested sheets.  
- Every write in Activity with username.  
- Playwright/axe on shop route at 360/390.  
- `npm run test:mvp`, dashboard lint + build green.
