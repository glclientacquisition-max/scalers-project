---
owner: desk
last_reviewed: 2026-10-19
status: proposed
---

# Super Admin list-first IA (proposal)

Owner review 19 Oct 2026 after billing hub v2 on staging/preview. Not implementation. No SQL. No Voice.

Charter: [`FRONTEND_2_0_CHARTER.md`](../explanation/frontend/FRONTEND_2_0_CHARTER.md). Lane: [`DESK_UX.md`](../reference/lanes/DESK_UX.md). Kit: `ListRow`, `Segmented`, `Pagination` (`dashboard/src/components/ui/Pagination.tsx`).

This proposal **replaces the card-first billing rule** in [`admin-billing-hub-plan.md`](admin-billing-hub-plan.md) §2 for directory screens. Cards stay only for a count that you tap to open a **list**. The work itself is always a list.

---

## 1. Who this is for

A Super Admin who runs the platform like a small ops desk for many shops: assign a line, find who is overdue, grant minutes, issue or find an invoice, change a published package price.

They are not configuring Resend, Bachs keys, or Railway. They open Admin at 08:00 EAT and need **who, how much, what to do next**.

Success: every primary screen is a named list with filters, search, and the same pager. Opening a shop shows **the job first**. Secondary tools fold. Today and Billing use the same row recipe. Catalog is one place with one job.

---

## 2. What is wrong today (from the live screens)

The kit already says the right thing. The screens do not follow it.

Charter list rule: **identity, one preview line, when, one Stamp, compact actions**. Tables only for numeric admin data. Pages already have `ListRow` and `Pagination`. Most admin surfaces ignore both.

### Lists that are not lists

| Surface | What you get | What an ops admin expects |
| --- | --- | --- |
| Billing Needs you | Mix bar + four **cards**. Copy says "Pick a queue to see shops." | A filterable **shop list**, same as Businesses |
| Packages | Three tabs (Versions / Businesses / Catalogue) plus a Billing **Catalog** button that redirects | One **Plans** list: Starter, Growth, Scale, Trial |
| Shop hub | 20+ equal `ListRow`s (Created, Notify, Usage, Owner opted in, Invoices twice) | Line and Money first. History folded |
| Today | Three stacks of rows with no rank. Volume rows that say "Not yet" | One **work list**. Volume as one quiet strip, or gone |
| Invoices / Payments | Real work, **off the rail**. Payments is Bachs/hosting switches | Invoices as a Billing tab. Payments infra off the product page |

### Shop after you tap a business

Current order: Line (status, number, quality, assign, release) → Shop (details, notify, created, activity, recording) → Money (card + package + plan + live payments + usage + opt-in + invoice list + charges + grant + history + invoices again) → Line state (suspend/archive) → People.

Primary jobs (assign a number, change package, grant minutes, collect an invoice) sit at the same weight as **Created** and **Owner opted in**.

### Visuals that do not decide

- Billing **Commercial mix** bar: Beta vs Charging. Pretty. Does not tell you who to open.
- Billing **Open invoices** strip: KSh total, not a link.
- Today **Volume today**: counts without a next tap that matches the number.
- Package **Catalogue** tab: live SKU editor next to a version editor. Two sources of truth on one page.

### Pagination

Only Businesses pages (25, client slice, custom Previous/Next). Invoices cap at 200 with "Latest 200." Billing shops, Today, Packages businesses, shop invoices, charges, history: no pager. The kit `Pagination` component is unused on Admin.

---

## 3. Approaches

### A. Polish in place

Keep card-first Needs you. Add links on the invoice strip. Hide a few shop rows. Leave Packages as three tabs.

**Faster.** Does not fix the grammar. Catalog stays confusing.

### B. One list grammar, fold the shop, split Billing by job (recommended)

Same `ListRow` + `Segmented` + `Pagination` on Businesses, Billing, Invoices, Plans, Today, Numbers, Activity. Shop becomes a **short stack + More**. Billing has three **lists**: Shops, Invoices, Plans. Payments infra leaves the product page.

**Fits the charter.** Matches how the owner already described the job. Presentation only.

### C. New admin information architecture from a blank map

Rename rail destinations, merge Quality into Today, rebuild Packages SQL-facing editor.

**Wrong now.** Too much surface. Mixes presentation with Platform/Ops contracts.

**Recommendation: B.** Ship in four presentation PRs. No SQL. No Voice.

---

## 4. The list grammar (every directory)

One recipe. If it is people, shops, invoices, numbers, or plans, it is this.

```
[Header: noun]
[Segmented filters]
[Search]
[ListRow list]
[Pagination: 1-25 of N · Previous · Next]
```

**ListRow:** name · one preview · when · one Stamp · one row action if needed (Assign, Pay link).

**Pager:** always `Pagination` from the kit. Page size **25**. Noun matches the list (`shop`, `invoice`, `plan`, `number`). Prefer `?page=` in the URL on server lists (invoices, businesses once the query is paged). Client slice is fine until a list is slow.

**Filters:** `Segmented` underline tabs. Never cards as the only way to see rows.

**Empty:** names the next action. No instructional subheaders.

Do **not** invent a second card grid for directories.

---

## 5. Shop fold (after you open a business)

The page opens on **the work**, not a settings dump.

### Always visible

1. **Identity:** name, number or Waiting, package, status Stamp.
2. **Line:** Number. Assign if waiting. Quality score as a link.
3. **Money:** package, minutes used / included, period end, open invoice count (link to that shop's invoices).
4. **One primary action** for the current state, filled once:
   - Waiting → Assign
   - Low / exhausted → Grant minutes
   - Overdue invoice → Invoices
   - Live + no package → Assign package
   - Else → no filled button; rows are enough

### Folded under More (Sheet or a disclosure, default closed)

Created, notify number, recording retention, activity, charges, history, live-payments switch, charging switch, owner opt-in (read-only), grant when not the primary, remove package, suspend, archive, people reset/transfer.

People (members) stay as a **list** below More, or a People row that opens a list. Not eight settings rows in the first viewport.

**Invoices appear once.** Either the Money preview + "Invoices" row to `/admin/billing/invoices?business=`, or the embed. Not both.

---

## 6. Today

Today is a **work list**, not a dashboard.

| Keep | Change |
| --- | --- |
| Platform one-row health | Keep. Tap opens Platform. |
| Needs you rows with a Stamp and a shop/quality/invoice href | Keep. Same `ListRow` as Businesses. |
| Group labels (Alerts, Line, Package, Quality) | Keep as list captions, not cards. |
| Volume today block | Cut from the first viewport. Optional quiet line under the header: "12 calls today" linking Quality. Drop "Not yet" rows. |

Overdue invoices stay in Alerts and **open the invoice or shop invoices list**, not only `?money=1`.

Cap visible rows at 25 + pager if the queue grows. Overdue loader cap of 12 becomes a real invoice filter on the Invoices list.

---

## 7. Billing (the three destinations)

Today the operator hits **Catalog**, **Invoices**, and **Payments**. Catalog redirects to Packages. Invoices and Payments are not on the rail. Packages has Versions + Businesses + Catalogue.

### Proposed Billing tabs (one Segmented on `/admin/billing`)

| Tab | Job | Rows |
| --- | --- | --- |
| **Shops** | Who is on what, who needs a package or minutes | Businesses with billing stamps. Filters: Needs you, All, Beta, Charging. **List first.** Needs you is a filter, not a card wall. |
| **Invoices** | What is owed | Current invoice list. Filters: Open, Overdue, Paid, Draft. Open-KES total is a header line **and** a link into Overdue/Open. |
| **Plans** | What we sell | One list: Trial, Starter, Growth, Scale. Preview: monthly KSh · minutes · published version. Tap: edit the **published** version (existing editor). Drafts sit on the plan detail, not a sibling Catalogue tab. |

**Kill the word Catalog** in Admin. The rail already has Billing. The button on the hub that says Catalog goes away.

**Payments page:** keep the route for now. Remove it from operator chrome. Checkout reviews stay on Billing → Shops filter **Needs attention** (or a fourth filter **Reviews** if that queue is busy). Bachs keys, webhook secret, hosting switches stay off this product page (charter: vendor setup is infra).

**Package editor / signup trial flags:** Settings-like rows on **Plans** header, not on Payments.

**Ledger** (`/admin/wallets`): stay filed under Billing parent, opened from a shop's folded Charges, not a third mystery tab.

### Needs you (Billing Shops)

Same shops as today (no package, low minutes, exhausted, period ending). Shown as **filtered ListRows** with counts on the Segmented control. No "pick a card" step.

Commercial mix bar: **remove** from Needs you. If we keep a mix, it is one caption on All: "42 beta · 18 charging".

---

## 8. Plans (replaces Catalog)

An admin changing a Fortune-500-style price list needs:

1. See the four live plans and the price that **new shops pin**.
2. Open one plan, see published vs draft.
3. Publish a draft with confirm.

They do not need a parallel "Catalogue" SKU editor on the same screen as versions.

**Phase 1 (this remake):** hide or retire the Catalogue tab in the UI. Versions list becomes the Plans list (one row per SKU, latest published price). Businesses-on-a-plan becomes a filter on that plan's detail, or a Segmented on Plans: **Plans | Shops on plans**.

**Do not** change publish RPCs or `billing_packages` vs versions in this program. Presentation only. Ops/Platform if a later PR deletes the legacy SKU editor for real.

---

## 9. Where this applies (Admin, then owner only if it shares the kit)

**In scope:** Today, Businesses list + shop hub, Billing (shops / invoices / plans), Numbers, Activity, Quality index (already list-like; add pager).

**Out of scope:** Voice, SQL, owner Desk IA (except owner Billing summary staying a short card). Owner settings fold can follow the same More pattern in a later ticket.

---

## 10. Ship order (one PR each)

| PR | Surface | Proof |
| --- | --- | --- |
| **1** | Shared Admin list: `Pagination` on Businesses (replace custom pager), Billing Shops as a list (drop card-first gate), Today drops Volume block | Playwright 390/1280, existing billing/today class tests updated |
| **2** | Shop fold: primary stack + More. Invoices once. | Shop fixture `/dev/admin-shop` |
| **3** | Billing tabs Shops / Invoices / Plans. Remove Catalog button. Payments chrome removed from hub. | `/dev/admin-billing`, invoice list pager |
| **4** | Plans list from versions; hide Catalogue tab | Packages fixture |

Rollback = revert that PR. No flags required (presentation).

---

## 11. Copy (no-ai-slop)

Use nouns the operator already says: shop, line, package, invoice, plan, overdue, grant.

Do not use: Catalog, commercial mix, pick a queue, platform snapshot, Needs attention (unless the row is a checkout review; then **Reviews**).

No em dashes in UI strings.

---

## 12. Decision asked

Approve **approach B** and the four-PR order, or say which PR to cut.

If yes: next step is an implementation plan for **PR 1 only** (list grammar + Billing Shops + Today trim). Shop fold and Plans wait their turn.
