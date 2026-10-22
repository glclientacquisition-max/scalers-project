---
owner: ops-billing
last_reviewed: 2026-10-22
---

# Scalers Super Admin: full rebuild research (IA, design system, modules, analytics, plan)

> **Status: parked, plan only, not approved for build (Alvin, 22 Oct 2026 08:23 EAT).**
> Source of the parked decision: relayed by Scalers Chief / Platform; not recorded elsewhere in the repo (unverified in repo).
> Copied verbatim from the Ops & Billing box brief `briefs/admin-rebuild-research.md` on 22 Oct 2026, with secrets and personal data redacted (see the PR body). Paths under `/workspace/` are box paths and are not in the repo.

Prepared 21 Oct 2026, ~17:30 EAT, by Ops & Billing for Alvin (approved the full rebuild on 21 Oct). Research only: no code was changed and nothing was written to a database.
Evidence: `origin/main` @ `200d9c27` (20 Oct 20:20 EAT) of glclientacquisition-max/scalers-project, read through `/workspace/a4-sender` after `git fetch` (not modified). It builds on `/workspace/briefs/billing-best-practice-research.md` (§3 to §8) and `/workspace/briefs/payments-end-to-end-map.md`. Sources are cited inline and listed in §S.

How to read this: §0 is the summary. §1 to §5 describe how an ops and revenue admin should work, based on the research. §6 compares ours with that. §7 is the build plan. §8 has the wireframes. §9 lists the decisions.

---

## 0. Summary

- **What Admin is.** It's an operator console with three jobs: **run** businesses, numbers and quality; **collect** through invoices, payments and collections; and **understand** revenue, retention and margin. Today it's built from the owner Desk kit (ListRow lists, a 5.5rem icon rail, iOS type sizes). That is why money pages have no columns, totals, sorting or charts. The reference products (Stripe, Linear, Vercel, Chargebee, Polaris admin, Twilio console) all use the same pattern: a **labelled sidebar, then a dense table with saved views, then a detail drawer or page with a timeline**, plus a ⌘K palette and charts for monitoring.
- **IA (12 modules in 4 groups).** **Overview** · Operate: **Businesses, Numbers, Quality, Voices** · Money: **Billing (Invoices, Payments, Collections, Credit notes), Packages and pricing, Usage and costs** · Insights: **Analytics (Revenue, Retention, Collections, Margins, Usage)** · System: **Platform health, Notifications, Audit log, Settings**.
- **Design system.** I recommend a separate **"Scalers Ops" density layer**. It keeps the brand tokens (palette, system font, focus ring, light and dark, motion verbs, shell split) and adds its own type scale, spacing, status colours, chart palette and about 20 components. The model is macOS data-dense apps (sidebar, table, inspector), which match Apple HIG, Carbon and Polaris. This **amends Frontend 2.0 charter lines 36, 37, 80, 88 and 170**, so it needs sign-off from Desk Engineer and Scalers Chief.
- **Libraries.** **Recharts v3**, using the shadcn copy-and-own `ChartContainer` pattern with animation off, plus **TanStack Table v8** (headless), plus **TanStack Virtual** for long lists. Tremor is ruled out (unmaintained since Oct 2025, still on Recharts 2). visx is ruled out (too much custom code for a team our size). ECharts and Nivo are ruled out (bigger bundles, and we don't need canvas at our data volume).
- **Data gaps that block analytics.** We need a `billing_metrics_daily` nightly snapshot, a `call_costs` table (SautiKit, Soniox, Gemini, SMS and Bachs per call), `invoice_lines.kind` and `service_month` columns, the Bachs fee and net amount on `payments`, `subscription_events` covering every plan or status change, and an always-set `invoices.due_at`.
- **Plan.** 14 small PRs, each deployed to staging first, all behind `ADMIN_V2` (off by default), with the old pages kept until a module reaches parity. The order is **charter sign-off → tokens and kit → shell and IA → Businesses → Billing (with manual payment) → Platform data → Analytics → the rest → Overview last**.

---

## 1. Information architecture

### 1.1 What the research says about structure

- **Sidebar with labels, not an icon rail, once there are more than 5 destinations.** Apple HIG uses a sidebar for top-level navigation and a split view to show the hierarchy (sidebar → list → detail), with the current selection kept highlighted in every pane ([HIG Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars), [HIG Split views](https://developer.apple.com/design/human-interface-guidelines/split-views)). HIG recommends no more than 2 levels in a sidebar, using disclosure groups. Stripe, Linear, Vercel, Intercom and Zendesk all use a grouped, labelled left nav. Ours is a 5.5rem icon rail with 10px labels (`AdminNav.tsx` `AdminRail`), which is too small to scan once there are 12 destinations.
- **Find, compare, act.** NN/g: tables are for finding records, comparing values and acting on rows ([NN/g data tables](https://www.nngroup.com/articles/data-tables/)). Complex apps should keep context during multi-step work, using panels and drawers rather than page hops ([NN/g complex apps](https://www.nngroup.com/articles/complex-application-design/)).
- **Dashboards are for monitoring, on one screen.** Stephen Few defines a dashboard as the most important information, consolidated on one screen and understood at a glance ([Few, Why most dashboards fail](https://www.perceptualedge.com/articles/misc/WhyMostDashboardsFail.pdf)). NN/g: dashboards rely on preattentive cues such as position, length and colour, used sparingly ([NN/g preattentive](https://www.nngroup.com/articles/dashboards-preattentive/)). So the home Overview **monitors and routes**, and Analytics **explains**.
- **One object, one home.** Stripe gives every customer, invoice and payment a canonical page with a timeline and related objects ([Stripe Dashboard basics](https://docs.stripe.com/dashboard/basics)). Chargebee and ChartMogul drill down from every metric to the underlying events ([ChartMogul MRR movements](https://help.chartmogul.com/article/158-chart-mrr-movements)).
- **Global search and command.** Stripe uses ⌘K for search and `?` to list shortcuts ([Stripe Dashboard basics](https://docs.stripe.com/dashboard/basics)), and Linear's command menu is the main way power users work ([Linear redesign](https://linear.app/now/how-we-redesigned-the-linear-ui)). We already have `AdminGlobalSearch.tsx` and `/api/admin/search`.

### 1.2 Module list and nav

```
SCALERS OPS                                  ⌘K Search or run a command
──────────────
Overview                    /admin
OPERATE
  Businesses                /admin/businesses            (+ /[id] with tabs)
  Numbers                   /admin/numbers
  Quality                   /admin/quality               (keep, #603)
  Voices                    /admin/voices
MONEY
  Billing                   /admin/billing               → Invoices (default)
    Invoices                /admin/billing/invoices      (+ /[id])
    Payments                /admin/billing/payments      (+ /[id])
    Collections             /admin/billing/collections
    Credit notes            /admin/billing/credit-notes
  Packages and pricing      /admin/packages
  Usage and costs           /admin/usage
INSIGHTS
  Analytics                 /admin/analytics             → Revenue (default)
    Revenue · Retention · Collections · Margins · Usage
SYSTEM
  Platform health           /admin/platform              (merged #772)
  Notifications             /admin/notifications
  Audit log                 /admin/audit                 (absorbs /admin/activity)
  Settings                  /admin/settings
──────────────
Environment: PRODUCTION ●   (red bar on prod, blue on staging)   Alvin ▾
```

Notes on the nav:
- Group headings are plain sentence-case words (HIG sidebar sections), not tracked caps. They are shown in caps above only for readability in this ASCII sketch.
- **Manual payments** is an action on Payments and on an invoice ("Record payment"). It is not a separate module. Stripe does the same with "Mark as paid outside Stripe" ([Stripe invoicing](https://docs.stripe.com/invoicing/overview)).
- An **environment banner** is always visible, because production payments went live on Aris by hand on 20 Oct (see the payments map, §0). Twilio and Stripe both mark test and live mode across the whole UI ([Stripe test mode](https://docs.stripe.com/test-mode)).
- Phone (below `md`): a read-only Overview, Businesses and Invoices, plus approve and confirm actions. HIG says to consider a tab bar first on iPhone and convert to a sidebar on iPad ([HIG Sidebars](https://developer.apple.com/design/human-interface-guidelines/sidebars)). Money and number writes need at least `md` (768px), to prevent fat-finger money actions.

### 1.3 Why each module exists

| Module | Job it does | Justification | Replaces today |
| --- | --- | --- | --- |
| Overview | "Is anything wrong, and is money on track?" | Few's one-screen monitoring. Stripe Home pairs KPIs with a to-do list. | `/admin` "Today" (`AdminTodayPanel`) |
| Businesses | Find any business and act on it | Canonical object (Stripe Customers, Intercom Companies, Zendesk Organizations) | `/admin/businesses` ListRows |
| Numbers | DID inventory and its integrity | Twilio console "Phone numbers" is a top-level area. A number costs us KSh 500/month (SautiKit), so idle stock is money. | `/admin/numbers` `DidPoolManager` |
| Quality | Call quality traces | Already built (#603). Unique to a voice product. | keep |
| Voices | Voice catalog | Low frequency, but owners depend on it | keep, restyle |
| Billing › Invoices | Every SCL invoice: open, overdue, paid, void | Stripe/Chargebee invoice list | `/admin/billing/invoices` ListRows |
| Billing › Payments | Every receipt, Bachs or manual, plus reviews | Stripe Payments. Needed for reconciliation. | `/admin/billing/payments` |
| Billing › Collections | Dunning worklist by days overdue, with ladder stage | Chargebee dunning and Recurly windows ([Chargebee dunning](https://www.chargebee.com/docs/payments/2.0/dunning/dunning-v2)). The decided ladder (D+1 / D+14 / D+21 / D+45) needs a place to work it. | none |
| Billing › Credit notes | Corrections without editing finalised invoices | Stripe credit notes ([docs](https://docs.stripe.com/invoicing/dashboard/credit-notes)). KRA/eTIMS later needs numbered credit notes. | none |
| Packages and pricing | Package versions, rates, annual discounts, which businesses are pinned | Chargebee Product Catalog, Stripe Prices | `/admin/packages` `AdminPackageVersionsPanel` |
| Usage and costs | Minutes and messages per business, plus provider cost and balances | Twilio Usage, Vercel Usage. Our margins are blind today (map §A). | scattered (SautiKit panel, SMS panel) |
| Analytics | MRR, churn, NRR, ARPA, DSO, aging, margins, cohorts | ChartMogul, Baremetrics, Stripe Billing analytics | none |
| Platform health | Provider balances, probes, open notices | Merged #772 (supersedes #699) | `/admin/platform` keep |
| Notifications | Outbound billing notices and ops alerts: queue, sent, failed | We send invoices and reminders (decision 8 = yes). Ops must see what went to whom (Stripe "Emails" log on a customer). | none (`billing_notices` only in SQL) |
| Audit log | Who changed what, before and after, and why | Required for money and DID actions (Stripe Security history, Atlassian audit log). `ops_audit_log` + `billing_audit_log` exist. | `/admin/activity` |
| Settings | Runtime switches, operators, letterhead, dunning ladder, caps and tiers | Moves the switches off the Payments page (billing research A4) | scattered |

### 1.4 What lives on the home Overview

The Overview should fit on one 1280×800 screen with no scrolling (Few). Top to bottom:

1. **Environment and live-payment state** shown as data, for example "Live payments: On · 1 business allowed". It turns red when it is on in production.
2. **Needs attention** (a worklist of at most 8 rows, each with a count and a destination; this was the strongest part of the old "Today"). It covers overdue invoices, payments waiting for review, businesses waiting for a number, a provider balance under 7 days of runway, a quality drop, failed notices, and businesses at 90% of their cap.
3. **KPI strip** (6 tiles): MRR · Collected this month · Outstanding AR (with the overdue part) · Active paying businesses · Calls today (vs the same day last week) · Gross margin MTD. Each tile shows the value, the change, a 12-point sparkline (Tufte's word-sized graphic, [Tufte sparklines](https://www.edwardtufte.com/notebook/sparkline-theory-and-practice-edward-tufte/)) and a link.
4. **Two charts**: MRR over 12 months (area by plan), and calls per day for 30 days with answered vs message mode.
5. **Recent activity**: the last 6 audit events.

Anything that needs explanation belongs in Analytics, not on the home page.

---

## 2. A separate Admin design system: "Scalers Ops"

### 2.1 Why separate, and what stays shared

- **The job is different.** The Desk is phone-first, one task at a time, and glanceable (iOS rules: 15/17pt type, 44pt targets, ListRow). Admin is desktop-first, many records at once, and comparison-heavy. That is the macOS and iPadOS productivity model in HIG: multicolumn sortable tables, resizable columns, alternating rows, and an inspector ([HIG Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables)). This is how Alvin's "Apple/iOS rules are primary" applies here: **Apple's own guidance for data-dense apps is the macOS one**, not iPhone ListRows.
- **Precedent.** Shopify runs Polaris for merchant admin, separate from storefront themes. IBM Carbon defines 5 table densities (24 to 64px) for this reason ([Carbon data table](https://carbondesignsystem.com/components/data-table/usage/)). Twilio built Paste for its console ([Paste](https://paste.twilio.design/)). GitHub Primer's "product" components are separate from Primer Brand ([Primer DataTable](https://primer.style/product/components/data-table/guidelines/)). Linear's 2024 redesign raised density and contrast for its operator UI ([Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)).
- **Shared with Desk (do not fork):** palette roles (`--ink`, `--surface`, `--canvas`, `--line`, `--accent`, `--brand`), the system font stack `--font-sans` (SF on Apple), the focus ring, the light and dark token swap, the motion verbs (pending / live / land / shift / press, with no Framer, GSAP or Lottie), the shell split (`ADMIN_LINKS` never imports `DESK_LINKS`), and the auth model.
- **Separate:** the density and type tokens (`--ops-*`), status and chart colour tokens, and an `components/ops/**` kit used only under `/admin`.
- **Charter conflict.** `docs/explanation/frontend/FRONTEND_2_0_CHARTER.md` line 36 says "One `AppShell` for desk and admin". Line 37 and line 80 say "One `ListRow` recipe … Admin lists … Tables only for numeric data". Line 88 says "Same shell, same kit". Line 170 lists the old 6-item admin nav. **An amendment is needed:** "Admin uses the Ops density layer: same tokens and motion, own kit and shell geometry". This needs sign-off from Desk Engineer (the Frontend 2.0 owner) and Scalers Chief.
- **Why not a marketing-taste skill.** `design-taste-frontend` says it is "not for dashboards or app screens". I am only borrowing its anti-slop rules, and they are in §5: no eyebrows, no gradients, no shadows at rest, no tiny tracked caps, no emoji, no fake grey-bar dashboards, at most 2 faces, and tabular figures where numbers align.

### 2.2 Principles

1. **Density with air.** The default row is 36px (Carbon "sm" is 32 and "md" is 40), with a "Compact 28px" toggle per user. Primer recommends one data point per column, short headers, and right-aligned numbers ([Primer](https://primer.style/product/components/data-table/guidelines/)).
2. **Scan first.** Name, status and money sit in the first 3 columns. Status is never shown by colour alone: it always has a word (WCAG 1.4.1, [Atlassian Lozenge](https://atlassian.design/components/lozenge/usage)).
3. **Keyboard first.** ⌘K palette, `/` focuses search, `j`/`k` move rows, `Enter` opens, `Esc` closes the drawer, `?` lists shortcuts (Stripe, Linear). Every action can be reached without a mouse.
4. **Tabular numbers.** `font-variant-numeric: tabular-nums` on every number. Money is right-aligned with the currency in the column header ("Amount (KSh)"), and cells show `7,000`. Totals rows are bold.
5. **Status semantics are fixed platform-wide.** One meaning per colour (§2.3), and the same word everywhere.
6. **Every state is designed.** Loading uses a shaped skeleton (no spinners on tables) and reserves height to avoid layout shift. Empty states show the filter that caused them and one action ("No overdue invoices"). Errors say what failed plus "Try again" and keep the last good data visible ([NN/g error messages](https://www.nngroup.com/articles/error-message-guidelines/)). Partial states, for example when a provider balance is unknown, show "Unknown" and when it was last checked, never 0.
7. **Money and numbers are guarded.** Confirmation dialogs say the exact action and its consequence, buttons are named for the outcome, nothing destructive is the default, and dangerous actions need typed confirmation ([NN/g confirmation](https://www.nngroup.com/articles/confirmation-dialog/)). Every write records actor, before, after and reason.
8. **Show the data, not the instructions.** Data-ink first (Tufte), no decorative chart junk, and no paragraphs explaining a page.
9. **Prod is always obvious.** Persistent environment colour (§1.2).

### 2.3 Tokens

**Type (system stack, macOS-style sizes; HIG macOS body is 13pt):**

| Token | Size / line | Weight | Use |
| --- | --- | --- | --- |
| `ops-kpi` | 28 / 32 | 600, tabular | KPI value |
| `ops-title` | 20 / 26 | 600 | Page title (one per page) |
| `ops-heading` | 15 / 20 | 600 | Section, drawer title |
| `ops-body` | 13 / 18 | 400 | Table cells, forms (default) |
| `ops-label` | 12 / 16 | 500 | Column headers (sentence case), field labels |
| `ops-caption` | 11 / 14 | 400 | Axis ticks, timestamps, footnotes (never body text) |

That is five sizes in use, plus the KPI size. No monospace except IDs (`SCL-2026-000001`, call ids) inside `<code>`.

**Spacing:** 4px grid with steps 4, 8, 12, 16, 24, 32. Cell padding is 12px horizontal. Gaps between page sections are 24px.
**Radius:** 6 for controls and cells, 10 for cards, drawers and dialogs. Pills are fully round.
**Row heights:** 28 (compact) / 36 (default) / 44 (touch, below `lg`). The toolbar height matches the row height (Carbon rule).
**Elevation:** none at rest. Separate surfaces by tone (`--canvas` → `--surface` → `--surface-2`). Shadows only on floating layers: drawer, popover, dialog, palette.
**Width:** content is fluid to 1600px. Tables are full width, with a sticky header and sticky first column.

**Status colours (new semantic tokens; each has a fg, bg tint and word, in light and dark, AA 4.5:1):**

| Token | Meaning | Words that use it |
| --- | --- | --- |
| `--status-ok` (existing `--ok`) | Done, healthy | Paid, Active, Assigned, Healthy |
| `--status-info` (new, from `--accent`) | In progress, neutral attention | Open, Due soon, Sending, Draft |
| `--status-warn` (existing `--warn` #B13A0A) | Needs action soon | Overdue 1–13 d, Low balance, Payment review, At 90% cap |
| `--status-danger` (new, ~#B42318 / dark #F97066) | Service affected or money at risk | Overdue 14 d+, Message mode, Closed, Failed, Prod live banner |
| `--status-neutral` (`--ink-soft`) | Inactive, terminal | Void, Cancelled, Archived, Written off, Disabled |
| `--status-beta` (existing `--lead`) | Not billed | Beta, Shadow |

**Chart palette:** 8 categorical colours based on Okabe-Ito, which is colour-blind safe ([Okabe & Ito](https://jfly.uni-koeln.de/color/)), tuned to sit next to `--accent` in both themes as `--chart-1…8`. There is one sequential ramp (5 steps of accent) for cohorts and heatmaps, and one diverging pair (accent vs danger) for MRR movements. ChartMogul uses blue for growth and pink for loss ([ChartMogul](https://help.chartmogul.com/article/163-understanding-mrr-movements)).

### 2.4 Core components (`dashboard/src/components/ops/**`)

| Component | Spec (research basis) |
| --- | --- |
| `OpsShell` | Labelled, collapsible 232px sidebar (⌘\ toggles it) with grouped sections. Top bar has breadcrumb, ⌘K and the environment pill. Detail drawer slot on the right (HIG split view + inspector). |
| `DataTable` | TanStack Table. Sort on header click, clicking again reverses (HIG). Resizable, hideable and reorderable columns. Sticky header and first column. Totals row. Row click opens the drawer, ⌘-click opens a full page. Checkbox column only where bulk actions exist (charter rule, kept). URL-synced state (Polaris: one source of truth in URL params, [Polaris migrate](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/index-table)). Cursor pagination at 50 rows (Polaris) or virtualised (TanStack Virtual) for logs. CSV export of the current view. |
| `FilterBar` + `SavedViews` | Tabs of saved views ("Overdue", "Due this week", "Beta"…). At most 2–3 promoted filters plus "More filters". Applied filters show as removable chips with unambiguous words ("Low minutes", not "Low") ([Polaris index filters](https://polaris.shopify.com/components/selection-and-input/index-filters)). Date range presets: Today, 7 d, 30 d, This month, Last month, 12 m, Custom (EAT). |
| `BulkBar` | Replaces the filter bar when rows are selected, showing "3 selected" and verb + noun actions ("Send reminder", "Export invoices"). Row actions are disabled while it is active (Carbon). Selection is kept after a failure (Polaris). |
| `KpiTile` | Label, value (`ops-kpi`), change vs the prior period with a direction word ("▲ 12% vs Sep"), a 12-point sparkline, and a link. Any comparison is stated, with no bare arrows. A bullet graph is used when there is a target (Few, [bullet graph spec](https://www.perceptualedge.com/images/Bullet_Graph_Specification.pdf)). |
| `Sparkline` | 80×20 inline SVG with no axes. The last point is marked. Server-rendered (no client JS). |
| Charts | `TimeSeries` (line or area, stacked by plan), `BarPair` (invoiced vs collected), `Waterfall`/`DivergingBar` (MRR movements), `AgingBar` (stacked horizontal), `CohortHeatmap` (CSS grid, not a chart lib), `Histogram` (utilisation). All share one tooltip format and have legends, and none relies on colour alone. Each has a "View as table" toggle for accessibility, and Recharts `accessibilityLayer` is on by default in v3. |
| `StatusPill` | Dot plus word, using the semantic token. Quiet tint. One pill per status per row. |
| `MoneyCell` / `Money` | Integer minor units in, formatted with `Intl.NumberFormat('en-KE')`. "KSh 7,000" in prose and "7,000" in KSh-headed columns. Negatives shown as "−1,000" in danger only when they mean money owed. No floats in maths. Shows "KSh 0", never blank. |
| `Drawer` | 480–640px, from the right. Header (name, status, primary action), tabs, and a footer of actions. Deep-linkable (`?open=inv_…`). `Esc` closes it and focus returns to the row. |
| `DetailPage` | For Businesses and Invoices: a header (identity, status, key numbers, actions), then a tab strip, then content, with a right rail of facts. |
| `Timeline` | Ordered, timestamped events (EAT) with an actor, verb and object, plus a before → after diff for edits. Used by the audit log, the invoice history and the business history (Stripe event timeline). |
| `CommandPalette` | ⌘K. Built on `@base-ui/react` (already a dependency) Dialog + Combobox, not a second library. Searches businesses, numbers (E.164), invoices (SCL/RCT), and calls. Can also run commands: "Record payment", "Assign number", "Go to Collections". |
| `ConfirmDialog` | Three strengths. **Light** (reversible): one click plus a toast with undo. **Money/DID**: a dialog that states the effect in numbers ("Record KSh 7,000 cash for Esga · invoice SCL-2026-000014 becomes Paid"), needs a reason, and has the action button named for the outcome. **Destructive**: also requires typing the business name or `REMOVE` (keeps the existing teardown rule). Payments above KSh 20,000, credit notes above KSh 5,000 and all write-offs can later need a second operator (maker-checker). |
| `Field`, `Select`, `DateRange`, `Segmented` | Extend `components/ui` (`Field.tsx`, `DeskSelect.tsx`, `Segmented.tsx`) with an `ops` size. Labels are always visible and errors are inline. |
| `EmptyState`, `ErrorState`, `Skeleton` | Shaped to the component they replace. Empty: one line plus one action. |
| `Toast` / `DeskNotice` | Land verb. The success message names the object ("Payment recorded · RCT-2026-000002"). |
| `EnvBanner` | Prod: a 3px danger top bar plus the "Production" pill. Staging: accent. |

### 2.5 Chart library pick

| Library | Model | Size (gz, approx) | Pros | Cons | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Recharts v3** (3.8, Mar 2026) | React + SVG, declarative | ~116 KB | shadcn `chart` is built on it and moved to v3 in Mar 2026 ([shadcn chart](https://ui.shadcn.com/docs/components/base/chart), [PR #8486](https://github.com/shadcn-ui/ui/pull/8486)). CSS-variable theming (`var(--chart-1)`) fits our tokens. Accessible by default (`accessibilityLayer`, [v3.0](https://github.com/recharts/recharts/releases/tag/v3.0.0)). TS generics in 3.8. | SVG gets slow past ~2k points per series (we have about 12–400). Needs `"use client"`. | **Pick.** Disable animation (`isAnimationActive={false}`) to respect desk-motion. |
| Tremor | Copy-paste kit on Recharts + Radix | — | Dashboard-shaped blocks | Vercel acquired it in Jan 2025 and new work moved to shadcn. The repo has had no commits since 10 Oct 2025 and still uses Recharts 2.15 ([Vercel](https://vercel.com/blog/vercel-acquires-tremor), [issue #140](https://github.com/tremorlabs/tremor/issues/140)). | No. We can borrow layouts. |
| visx (Airbnb) | Low-level D3 primitives | ~25 KB | Smallest. Total control. Static SVG renders on the server. | We would build axes, tooltips and legends ourselves, which is weeks of Desk time | Only as a fallback for the waterfall if Recharts fights us |
| Nivo | D3 + React, SVG/Canvas | ~94 KB | Nice defaults, many types | Not RSC-native. Its theming is its own system, not our CSS variables. | No |
| Apache ECharts | Canvas, config objects | ~190 KB modular | 100k+ points, maps | Heavy. Imperative options sit outside React and Tailwind. Overkill at 7 businesses. | No (revisit past ~10k points per chart) |

Comparison sources: [LogRocket 2026](https://blog.logrocket.com/best-react-chart-libraries-2026/), [We.Inc guide](https://we.inc/guides/react-chart-libraries). Sparklines and the cohort heatmap are plain SVG or CSS rendered on the server, with no library.

### 2.6 Table library pick

**TanStack Table v8** ([tanstack.com/table](https://tanstack.com/table/latest)) is headless, so our markup and tokens stay ours. It handles sorting, filtering, column visibility, ordering, sizing, pinning, row selection, grouping and footers (totals), and supports server-side (manual) pagination and sorting, which we will need when lists grow. **TanStack Virtual** is for the audit log and call lists. Our existing `DeskDataTable.tsx` (a 16-line `<table>` wrapper) is not a table system. Paste and Polaris both separate "Table" (static) from "DataGrid/IndexTable" (interactive) ([Paste Table](https://paste.twilio.design/components/table)). We need the interactive kind.

---

## 3. Per-module page specs

The common rules apply to every module, so each spec below lists only what is specific. Every list page has a title with a count ("Invoices · 14"), saved views, a FilterBar, a DataTable with a totals row where it is money, a row that opens a Drawer, CSV export, and URL state. Every write goes through an Ops API with the service role, has a `ConfirmDialog` of the right strength, and writes an `ops_audit_log` row with actor, before, after and reason (`lib/adminAudit.ts` exists). Money and DID actions in production need an operator with the `money_write` role (§3.13).

### 3.1 Overview `/admin`
- **Answers:** Is anything broken? Who owes us? Are we growing?
- **Contents:** see §1.4.
- **Actions:** none inline. Each row links to where the work is done.
- **Safeguards:** read-only.

### 3.2 Businesses `/admin/businesses`
- **Answers:** Who are our businesses, what state are they in, and who needs action?
- **Saved views:** All · Paying · Beta · Overdue · Waiting for number · At 90% cap · Archived.
- **Columns:** Business · Status (Active / Beta / Past due / Message mode / Closed / Archived / Waiting for number) · Package (Starter v2 · Monthly) · Number (E.164) · Minutes (used / included, with a bar) · Messages (used / included) · MRR (KSh) · Open balance (KSh) · Oldest overdue (days) · Calls 30 d · Last call · Created.
- **Bulk actions:** Export, Send reminder (if overdue), Add tag.
- **Row actions:** Open, Copy number. Opening the business in Desk as its owner (read-only impersonation) is deferred.

**Business detail `/admin/businesses/[id]`** (`DetailPage`)
- **Header:** name, status pill, package, number, owner phone, billing contact, MRR, open balance. Primary action is context-aware: "Record payment" if it owes, "Assign number" if it is waiting.
- **Tabs:**
  1. **Summary:** usage this period, last 5 calls, open invoices, alerts.
  2. **Billing:** subscription (package version, period, enforcement, trust tier, cap, on-demand), invoices, payments, credit notes, "Change package" (upgrade prorated now, downgrade at period end, per decision 4).
  3. **Usage:** minutes, messages and on-demand by day, with cost and margin (once `call_costs` exists).
  4. **Number:** DID, history, release or reassign.
  5. **People:** owner, members, reset or transfer owner (existing `AdminShopPeople`).
  6. **Calls and quality:** links to Quality.
  7. **History:** a Timeline of all audit and billing events.
- **Safeguards:**
  - Suspend, archive and remove are Destructive (typed name). Remove also keeps the `REMOVE` rule and releases the DID.
  - Change package and enforcement are Money confirms that state the price difference and when it applies.
  - A business with open invoices cannot be archived without "Write off or keep open".

### 3.3 Numbers `/admin/numbers`
- **Answers:** How many numbers are free, who has which, and what idle stock costs us.
- **KPIs:** Available · Assigned · Reserved · Disabled · Idle rental (KSh/month, available × 500).
- **Columns:** Number · Status · Business · Since · Monthly rental (KSh) · Last call · Notes.
- **Actions:** Add number (E.164 validated with `libphonenumber-js`), Assign to waiting business, Release, Disable.
- **Safeguards:** All writes are DID confirms that state "+2547… moves from Esga to Available. Esga stops receiving calls now." Rules still enforced in SQL: double assignment is blocked, the platform sender `+2547XXXXXXXX` (redacted: platform DID) is locked (shown with a "Platform sender" pill and no actions), and a number cannot be released while a call is live. Every change is audited.

### 3.4 Quality `/admin/quality` and Voices `/admin/voices`
- **Quality:** keep the logic (`adminQuality*.ts`, 1,088 lines) and the routes. Restyle the index as a DataTable (Business · Calls · Answer rate · Median latency · Drop rate · Flags) and the call page as `DetailPage` + `Timeline`.
- **Voices:** a DataTable plus a preview player. Low priority.

### 3.5 Billing › Invoices `/admin/billing/invoices`
- **Answers:** What did we bill, what's unpaid, and what's late?
- **KPI strip:** Open (KSh) · Overdue (KSh, count) · Due in 7 days · Collected this month · Average days to pay.
- **Saved views:** All · Open · Overdue · Due this week · Paid · Draft · Void · Uncollectible.
- **Columns:** Number (SCL-…) · Business · Status · Type (Package / Extra usage / Proration / Seats / Manual) · Period · Issued · Due · Days overdue · Total (KSh) · Paid (KSh) · Balance (KSh) · Last reminder.
- **Totals row:** sums of Total, Paid and Balance.
- **Invoice detail:** a document preview (existing PDF route), lines, payments, a pay-link status (opened / started / paid), notices sent, and a Timeline.
- **Actions:** Record payment · Send reminder · Copy pay link · Create credit note · Void (draft or open only) · Mark uncollectible · Download PDF.
- **Safeguards:**
  - Finalised invoices are never edited. Changes go through a credit note (Stripe model).
  - Void and mark uncollectible are Destructive and need a reason.
  - Beta businesses cannot be invoiced; `finalize_invoice` already refuses them.

### 3.6 Billing › Payments `/admin/billing/payments`
- **Answers:** What came in, by which method, net of fees, and what needs review?
- **Saved views:** All · M-Pesa (Bachs) · Manual · Needs review · Refunded.
- **Columns:** Receipt (RCT-…) · Paid at (EAT) · Business · Invoice · Method (M-Pesa / Bank / Cash) · Reference (M-Pesa code / bank ref) · Gross (KSh) · Fee (KSh) · Net (KSh) · Status (Matched / Review / Overpaid → credit) · Recorded by.

**Record payment** (decision 12 = yes)
- **Fields:** invoice (searchable), amount, method, reference (required and unique per method), date received, note, and an optional attachment of a bank slip.
- **Behaviour:**
  - A partial payment leaves the balance open.
  - An overpayment goes to `tenant_credits`.
  - It issues an RCT receipt and a "Payment received" notice.
- **Safeguards:**
  - Money confirm with the amount re-typed.
  - A duplicate reference is refused.
  - Backdating more than 30 days needs a reason.
  - Above KSh 20,000, maker-checker once we have two operators.
- **Needs:** a Platform RPC `record_manual_payment` wrapping `apply_payment`. None exists today (map §C).
- **Review queue:** existing `resolve_checkout_review` ("book" or "nothing" plus a reason), styled as a table.
- **Reconciliation panel (later):** Bachs settlements vs payments.

### 3.7 Billing › Collections `/admin/billing/collections`
- **Answers:** Who is late, which stage of the ladder are they in, and what's next?
- **Layout:** an aging bar (Current / 1–13 / 14–20 / 21–44 / 45+ days, aligned to the decided ladder D+1, D+14, D+21, D+45), then a worklist.
- **Columns:** Business · Balance (KSh) · Oldest due · Days overdue · Stage (Extra usage paused / Message mode / Closed / Cancelled) · Next step and date · Last contact · Promise to pay (date) · Owner phone.
- **Actions:**
  - Send reminder now
  - Log contact (call or WhatsApp note)
  - Set promise-to-pay, which holds the next stage up to 7 days, at most once per invoice
  - Pause dunning, with a reason
  - Escalate to closed now
  - Reconnect, once paid in full; offers the KSh 500 reconnection fee if the line was closed (decision 11 advice)
- **Safeguards:**
  - Stage changes are Money confirms that say what the caller will experience ("Calls to +2547… will take messages only").
  - The ladder runs automatically. Manual overrides are audited and expire.

### 3.8 Billing › Credit notes `/admin/billing/credit-notes`
- **Columns:** CRN number · Invoice · Business · Reason (Duplicate / Service issue / Goodwill / Price error) · Amount (KSh) · Applied to (invoice balance / credit balance / refund) · Created by · Date.
- **Safeguards:**
  - Credit notes cannot exceed the invoice total minus earlier credit notes.
  - All credit notes are Money confirms with a reason.
  - Maker-checker above KSh 5,000 once there are two operators.
  - Numbered `CRN-YYYY-NNNNNN`, ready for eTIMS later.
- **Needs:** Platform tables `credit_notes` and `credit_note_lines`, plus a counter.

### 3.9 Packages and pricing `/admin/packages`
- **Answers:** What do we sell, at what price, and who is on which version?
- **Layout:** a matrix of package (Starter / Growth / Scale / Trial) × attribute (monthly, annual, minutes, messages, credits, seats, on-demand KSh/min in and out, cap share), one column per version. Below it, a "Businesses on this version" table.
- **Actions:** Draft new version, Publish, Move businesses to version, Archive version (existing `package-versions` API).
- **Display rule:** rates are shown per minute, with per second only in a tooltip (billing research A15).
- **Safeguards:**
  - Publish and move are Money confirms showing the MRR impact ("3 businesses · MRR +KSh 6,000 from 1 Nov").
  - Production edits sit behind the `package_editor_enabled` switch, which moves to Settings.
  - Prices are never edited in place on a published version.

### 3.10 Usage and costs `/admin/usage`
- **Answers:** What did each business use, what did it cost us, and how long do our provider balances last?
- **KPIs:** Minutes MTD · Messages MTD · On-demand KSh accrued (not yet invoiced) · Cost per minute (KSh, by provider) · Provider runway (days).
- **Tables:**
  - **By business:** minutes, included, utilisation %, messages, on-demand minutes and KSh, direct cost, margin %.
  - **By provider:** SautiKit, Soniox, Gemini, TextSMS, Meta, Bachs, with units, unit cost, total KSh MTD, balance and runway.
- **Flags:** utilisation above 90% (upgrade candidate), below 20% (churn risk), and beta fair-use alerts (decision 15).
- **Safeguards:** read-only, except "Set cap" and "Trust tier", which are Money confirms.

### 3.11 Analytics `/admin/analytics/*`
See §4.

### 3.12 Platform health, Notifications, Audit log
- **Platform health** (keep #772): provider probes, balances, open notices, alert contacts. Restyle as a status table: Provider · State · Last check · Balance · Runway · Notes.
- **Notifications:**
  - **Columns:** Sent at · To (business, contact) · Channel (SMS / WhatsApp / Email) · Template (Invoice issued / Due in 3 days / Due today / Overdue 3 d / Payment received / Stage change / Ops alert) · Status (Queued / Sent / Delivered / Failed) · Provider ref · Linked object.
  - **Actions:** Resend (Light confirm). Pause all billing notices is in Settings.
  - **Source:** `billing_notices`, `notify_sends`.
  - Every send shows exactly what went out (rendered body).
- **Audit log:**
  - **Columns:** When (EAT) · Operator · Action · Object · Business · Before → After · Reason · Source (Admin / SQL / cron / webhook).
  - **Filters:** operator, action type, business, date.
  - Append-only, with no edit or delete in the UI. CSV export.
  - **Source:** `ops_audit_log` + `billing_audit_log`, unioned in a Platform view `admin_audit_feed`.

### 3.13 Settings `/admin/settings`
- **Sections:**
  - Runtime switches: live payments mode, master, live allowlist, notices send, package editor, owner plan change, shadow invoices. These move from Billing › Payments.
  - Dunning ladder days.
  - Trust tiers and default caps.
  - Letterhead (name, address, KRA PIN later).
  - Operators and roles: `viewer`, `ops`, `money_write`, `owner`.
  - Short-call free threshold (15 s).
- **Safeguards:**
  - Every switch shows its current value, who set it, and when.
  - Production switch changes are Destructive (type `PRODUCTION`) and send an ops alert email.
  - Any toggle that starts real charging is two-step: the toggle, then a second confirm showing exactly which businesses become billable.

---

## 4. Analytics

### 4.1 Pages and charts

| Page | Charts (top → bottom) | Questions |
| --- | --- | --- |
| **Revenue** | KPI row (MRR · ARR · Net new MRR · Collected MTD · Extra-usage revenue · ARPA) → MRR stacked area by plan (12 m) → MRR movements diverging bar (new, expansion, reactivation up; contraction, churn down) → table of movements with drill-down to businesses | Are we growing, and from where? |
| **Retention** | Logo churn %, revenue churn %, GRR, NRR (trailing 12 m) → cohort heatmap (logo and revenue toggle) → churned-businesses table with reason | Do businesses stay and grow? |
| **Collections** | DSO, Collection rate, CEI, Overdue % → invoiced vs collected paired bars by month → AR aging stacked bar over time → payment funnel (issued → link opened → started → paid) | Do we get paid, and how fast? |
| **Margins** | Gross margin %, cost per minute → cost per minute by provider, stacked bar by month → margin per business sortable table (with a scatter of MRR vs margin %) | Is each business profitable? |
| **Usage** | Minutes and messages per day → utilisation histogram (share of businesses by % of included used) → on-demand minutes and KSh → beta shadow MRR | Are packages sized right? |

### 4.2 Formulas

These follow ChartMogul and Stripe definitions ([ChartMogul cheat sheet](https://chartmogul.com/saas-metrics/cheat-sheet/saas-metrics-cheat-sheet.pdf), [Stripe Billing analytics](https://docs.stripe.com/billing/subscriptions/analytics)). They exclude beta, trial and tax. Usage is reported separately from MRR (the Stripe convention).

| Metric | Formula |
| --- | --- |
| MRR | Σ normalised monthly package price for businesses in `active`, `past_due` or `grace` on the day (annual ÷ 12, discounts applied). Excludes beta, trial, suspended and cancelled. |
| ARR | MRR × 12 |
| Net new MRR | new + expansion + reactivation − contraction − churn (month) |
| Extra-usage revenue | Σ invoice lines where `kind = extra_usage`, by `service_month`. Accrued not invoiced = Σ ledger debits since the last invoice. |
| ARPA | MRR ÷ paying businesses. Also total monthly revenue (MRR + extra usage) ÷ paying. |
| Logo churn % | businesses moving paying → cancelled in the month ÷ paying at the start of the month |
| Revenue churn % | (churn + contraction MRR) ÷ MRR at the start |
| GRR | (start MRR − contraction − churn) ÷ start MRR, trailing 12 m, capped at 100% |
| NRR | (start MRR + expansion − contraction − churn) ÷ start MRR, trailing 12 m |
| Quick ratio | (new + expansion + reactivation) ÷ (contraction + churn) |
| LTV | ARPA × gross margin % ÷ monthly revenue churn % (shown only once n ≥ 10 paying, otherwise "Not enough data") |
| DSO | (AR at period end ÷ credit sales in the period) × days in the period ([Oracle DSO](https://docs.oracle.com/en/cloud/saas/financials/26d/faofc/days-sales-outstanding.html)) |
| CEI | (opening AR + invoiced − closing AR) ÷ (opening AR + invoiced − current, not-yet-due AR) × 100 ([Oracle CEI](https://docs.oracle.com/en/cloud/saas/financials/26b/faofc/collections-effectiveness-index-metrics.html)) |
| Collection rate | invoices due in the month that were paid within 30 days of the due date ÷ invoices due in the month (by KSh) |
| AR aging | open balance by days past `due_at`: Current, 1–13, 14–20, 21–44, 45+ (our ladder). A standard 0–30 / 31–60 / 61–90 / 90+ view can be toggled. |
| Cost per minute | Σ `call_costs.cost_kes` ÷ Σ billed minutes, per provider |
| Gross margin % (business, month) | (recognised revenue − direct cost) ÷ recognised revenue. Recognised revenue = package price for the month + extra usage for that service month − credit notes. Direct cost = Σ `call_costs` + SMS units × unit cost + DID rental 500 + Bachs fee. |
| Utilisation | seconds used ÷ (minutes included × 60) per period |
| Cohort retention | rows = first paid month, columns = months since, cell = % of the cohort still paying (logo) or % of starting MRR (revenue) |
| Beta shadow MRR | Σ the package price beta businesses would pay |

### 4.3 Refresh cadence

| Data | Cadence | How |
| --- | --- | --- |
| Overview "Needs attention", balances, live switches | On page load (server component, `no-store`) | Direct reads |
| KPI tiles for today and MTD | On page load, with a 60 s cache | Aggregate SQL views |
| Historic series (MRR, movements, churn, cohorts, margins) | **Nightly at 00:30 EAT** for the previous EAT day | pg_cron → `snapshot_billing_metrics(date)` writes `billing_metrics_daily`. Idempotent per (date, business). Backfill from `subscription_events` is best effort. Vercel Hobby limits crons to once a day (map §A), so this runs on pg_cron. |
| Provider costs (`call_costs`) | At hangup (Voice hook, idempotent per call + provider) with a nightly true-up | Voice writes the measured quantities. A nightly job fills in unit rates. |
| Bachs fees and settlement | From the webhook or checkout GET once Bachs exposes them, plus a weekly settlement import | Ask Bachs (billing research §10 item 18) |

Each chart shows when it was last refreshed in its footer: "Updated 00:31 EAT".

### 4.4 Data sources and what is missing

| Need | Have (schema) | Missing (Platform work) |
| --- | --- | --- |
| Current subscription state | `tenant_subscriptions`, `billing_package_versions` | — |
| Plan and status history | `billing_audit_log`, partial `subscription_events` | **`subscription_events` written on every plan change, status change, cancel and reactivate**, with price at the time (`mrr_before`, `mrr_after`) |
| Daily history | none | **`billing_metrics_daily`** (date, tenant_id, billing_status, package_version_id, mrr_kes, minutes_used, minutes_included, sms_used, on_demand_kes, open_ar_kes, overdue_kes, direct_cost_kes) |
| Invoice line types | `invoice_lines` (no kind) | **`invoice_lines.kind`** enum (package, extra_usage_inbound, extra_usage_outbound, extra_messages, proration, seats, reconnection, manual, credit) + **`service_month`** |
| Due dates | `invoices.due_at` (null on the prod test invoice) | NOT NULL on finalise |
| Payments, net of fee | `payments.amount_kes`, `fee_minor` (null) | **`fee_kes`, `net_kes`, `method`** (mpesa_bachs, bank, cash), `reference`, `recorded_by`; a unique (method, reference) |
| Manual payment write | `apply_payment` (SQL only) | **`record_manual_payment` RPC** (security definer, audited) |
| Credit notes | none (`tenant_credits` for overpayments only) | **`credit_notes`**, `credit_note_lines`, CRN counter |
| Per-call provider cost | `calls.duration`, `notify_sends.units` | **`call_costs`** (call_id, provider, quantity, unit, unit_cost_kes, cost_kes, source, unique (call_id, provider, unit)), plus Soniox seconds and Gemini tokens captured per call by Voice and Brain |
| Provider unit rates | none | **`provider_rates`** (provider, unit, cost, currency, fx_rate, valid_from) so USD costs convert to KES at a recorded rate |
| Pay funnel | `invoice_pay_tokens`, `payment_attempts`, `payments` | `invoice_pay_tokens.first_opened_at` |
| Dunning stage | `billing_status` | **`collection_cases`** (invoice or tenant, stage, next_action_at, promise_to_pay_at, paused_reason) |
| Notices | `billing_notices`, `notify_sends` | rendered body stored, plus a delivery status callback |
| Audit | `ops_audit_log`, `billing_audit_log` | **`admin_audit_feed`** view (union) + `source` column |
| Operator roles | `ADMIN_OPERATORS` env | **`admin_operators`** table with role, used by maker-checker |

---

## 5. Copy rules for Admin

Research basis: Polaris content guidelines (verb + noun, unambiguous filter labels) ([Polaris](https://polaris.shopify.com/components/tables/index-table)), NN/g confirmation and error guidance, Primer DataTable (short headers), and our house voice (short, verb-first, no dashes in UI text, "Business" not "Tenant").

1. **Show data, not descriptions.** A page has a title and a count, with no subtitle sentence. Delete lines like "SCL numbers, what was paid, and what is still due." and replace them with the KPI strip (billing research A2).
2. **No instructional paragraphs.** If a control needs explaining, rename the control. Help text sits behind an `(i)` tooltip and is at most 1 sentence.
3. **No AI slop.** Banned words: "seamlessly", "effortlessly", "powerful", "simply", "just", "unlock", "leverage", "insights" (as filler), "magic", "robust", "Oops", "Whoops", "Something went wrong" alone, "yet" as a hedge ("isn't available yet"), "Coming soon" rows, and exclamation marks. No emoji.
4. **No internal jargon in the UI:** mint, port, SKU, shop, tenant, RPC, enforcement soft or hard, shadow. Use: create, package (pick **Package** and use it everywhere, not "plan"), business, "Billing: Beta / Paying", "At cap: Extra usage / Message mode".
5. **Labels.**
   - Sentence case everywhere.
   - Column headers are nouns with units in brackets: "Amount (KSh)", "Duration (min)".
   - Buttons are verb + noun: "Record payment", "Send reminder", "Assign number".
   - Filters are self-explanatory: "Low minutes", "Out of minutes", "No package", "Payment review".
6. **Status words** come from the fixed list in §2.3 and are never synonyms ("Overdue", not "Late" on one page and "Past due" on another; "Past due" is only a subscription state).
7. **Numbers.**
   - KSh with thousands separators and no decimals unless they are non-zero (rates: "KSh 26/min").
   - Percentages to 1 decimal place.
   - Dates are "21 Oct 2026". Times are "17:30 EAT", 24-hour. Relative times ("3 d overdue") always come with the absolute date in a tooltip.
   - An empty value is shown as "None", or as "Unknown" plus when it was last checked. Never a bare "—" or 0 when we don't know.
8. **Confirm dialogs.** The title is the action and its object ("Record KSh 7,000 payment"). The body is one sentence of consequence with real numbers. Buttons are "Record payment" / "Cancel", never Yes/No.
9. **Errors** say what failed, whether money moved, and the next step: "Payment not recorded. Nothing changed. Try again." Show the error code in small text for support.
10. **Empty states** name the filter: "No overdue invoices", or "No invoices match 'Esga · Paid'. Clear filters."
11. **Never name suppliers to owners**, but do name them in Admin, where provider names are data (Bachs, SautiKit).
12. **Copy lives in one module per area** (`lib/ops/copy/*.ts`), reviewed against these rules. Add a lint test for the banned word list, extending the existing copy tests pattern.

---

## 6. Audit of the current Admin (origin/main @ 200d9c27)

### 6.1 What is there

The routes are under `dashboard/src/app/admin/(console)/`:
- Today `page.tsx`
- `activity`
- `billing` (hub), `billing/invoices[/id]`, `billing/payments`
- `billing/[tenantId]` and `billing/catalog`, which are **redirects only**
- `businesses[/id]`, `numbers`, `packages`, `platform`, `quality/**`, `voices`
- `wallets`, a **redirect to Businesses**

The nav (`lib/adminLinks.ts`) is Today, Businesses, Quality, Billing, Numbers, Platform, Activity, Voices, with Plans and Ledger filed under Billing. Shell: `components/AdminNav.tsx` (456 lines), a 5.5rem glass icon rail with 10px labels. On phone it shows 4 tabs plus More.

### 6.2 Keep (logic, APIs, models): rewire under new UI, don't rewrite

| Area | Files | Why keep |
| --- | --- | --- |
| Auth and host gate | `lib/adminGuard.ts`, `adminGate.ts`, `admin-auth.ts`, `admin-auth-plugin.ts`, `adminHost.ts`, `adminOperators.ts`, `app/admin/login/page.tsx`, `api/admin/session` | Correct split (Better Auth username + code, owner reject). **Fix:** `/api/admin/packages` and `/api/admin/billing` still accept the legacy HMAC cookie via `isLegacyAuthenticated` (`lib/auth.ts:36-53`). Remove that before any money UI ships (Platform). |
| Audit write | `lib/adminAudit.ts`, `adminActor*.ts`, `adminActivity*.ts` | Right shape (actor, before, after, reason). It becomes the Audit log feed. |
| Business actions | `lib/adminBusinessActions.ts` (381), `adminBusinessModel.ts`, `adminBusinessProfile.ts`, `api/admin/businesses/route.ts` (assign_next, release_did, suspend, unsuspend, archive, restore, update_profile, send_owner_reset, transfer_owner, save_recording_retention) | Complete action set. New UI calls the same API. |
| DID pool | `lib/didPool.ts`, `lib/sautikit.ts`, `api/did-pool/**`, `api/admin/buy-number`, `api/admin/sautikit-sync` | Integrity rules live here and in SQL |
| Billing reads and writes | `lib/adminBilling.ts` (492), `adminBillingHub.ts`, `adminBillingInvoices.ts`, `adminBillingPeriod.ts`, `adminBillingTypes.ts`, `adminInvoiceRead.ts`, `adminPayRead.ts` (551), `billingRuntimeSettings.ts`, `lib/invoicePay/**` (webhook, reconcile, pdf, documents, money, liveTenant) | Payment clearing via the Bachs GET and invoice lock is sound (map §C). Keep it all. |
| Billing API | `api/admin/billing/route.ts` (grant_minutes, assign_package, unassign_package, resolve_checkout_review, mint_pay_link, set_billing_mode), `billing/flags`, `billing/invoices/[id][/pdf]`, `billing/test-invoice`, `package-versions`, `packages` | Keep. Add actions (record_payment, credit_note, void, uncollectible, send_reminder, collection stage) behind new Platform RPCs. Rename `mint_pay_link` in the UI only. `api/admin/wallets` `set_billing_mode` duplicates the billing route, so retire it. |
| Today queue logic | `lib/adminTodayModel.ts`, `adminToday.ts`, `adminWaitingModel.ts`, `platformOpsModel.ts` (`mergeQueueRows`) | It becomes Overview "Needs attention" |
| Quality | `lib/adminQuality.ts`, `adminQualityModel.ts`, `api/admin/quality/**` | Keep fully |
| Platform | `lib/platformOps.ts`, `platformOpsModel.ts`, `platformRunBoardModel.ts`, `platformVoiceHealth.ts`, `api/admin/platform-ops` (#772) | Keep. Restyle only. |
| Search | `lib/adminGlobalSearch.ts`, `adminGlobalSearchModel.ts`, `api/admin/search` | Powers ⌘K |
| Tests | existing admin unit and e2e tests | Keep as the regression net. Add visual tests per module. |

### 6.3 Rebuild (presentation)

| File | Lines | Problem | Becomes |
| --- | --- | --- | --- |
| `components/AdminNav.tsx` | 456 | Icon rail, 10px labels, 8 items, no groups, glass chrome | `ops/OpsShell` + `ops/Sidebar` |
| `components/AdminTodayPanel.tsx` | 95 | Worklist only, no KPIs or charts | `ops/overview/*` |
| `components/AdminBusinessesPanel.tsx` | 280 | ListRow (lines 122, 206, 267). No columns, sort, money or usage. | `DataTable` Businesses |
| `components/AdminShopPanel.tsx`, `AdminShopMoneyPanel.tsx`, `admin/AdminShopPeople.tsx` | 552 + 692 + 159 | "Shop" naming. Money crammed into one panel via `?money=1`. | Business `DetailPage` tabs |
| `components/AdminBillingListPanel.tsx`, `AdminBillingFilterChips.tsx`, `AdminBillingDetailPanel.tsx` | 311 + 81 + 28 | Chips "Low/Out/Waiting/Reviews" are ambiguous (A11). ListRows. | Invoices / Collections tables + SavedViews |
| `components/AdminInvoiceList.tsx`, `AdminInvoiceDetail.tsx`, `AdminBillingShopInvoices.tsx` | 102 + 61 + 162 | ListRow for money, instructional empties (A7, A8), "mint" (A5) | Invoices DataTable + Invoice detail |
| `components/AdminPaymentsStatus.tsx` | 299 | Switches mixed with status. False "Collections stay off" (A1). | Payments table + Settings › Switches |
| `components/AdminPackagesPanel.tsx`, `AdminPackageVersionsPanel.tsx` | 397 + 1,018 | ListRows, per-second hints (A15), one 1,000-line file | Packages matrix + versions table |
| `components/DidPoolManager.tsx`, `SautikitTelecomPanel.tsx`, `SautikitSyncButton.tsx` | 399 + 177 + 72 | Mixed concerns | Numbers table + Usage › Providers |
| `components/AdminActivityPanel.tsx` | 158 | Feed only, no filters or diff | Audit log table + Timeline |
| `components/AdminPlatformOpsForm.tsx`, `PlatformRunBoard.tsx` | 498 + 64 | Form-heavy | Platform status table + Settings › Alerts |
| `components/AdminVoicesManager.tsx`, `admin/Quality*.tsx` | 276 + ~860 | Fine logic, Desk styling | Restyle on ops kit (last) |
| `components/admin/AdminPageHeader.tsx` | 11 | Title + subtitle sentence (encourages instructional copy) | `ops/PageHeader` (title + count + actions) |
| `lib/adminBillingCopy.ts`, `adminPayCopy.ts`, `adminBusinessUi.ts` | 214 + 300 + 111 | Copy drift (billing research A1 to A15) | `lib/ops/copy/*` per §5 |
| `components/ui/DeskDataTable.tsx` | 16 | A wrapper, not a table | Replaced by `ops/DataTable` for Admin (Desk keeps its own) |

### 6.4 Behaviour gaps the UI rebuild cannot fix alone

1. No recurring invoice builder (`shadow_invoices = true`).
2. No manual payment RPC.
3. No credit notes.
4. No dunning scheduler or `collection_cases`.
5. No `call_costs` or snapshot.
6. Legacy HMAC on money APIs.
7. Notices sender off.
8. `invoices.due_at` can be null.

Items 1 and 4 belong to the invoicing build (billing research §3 and §6). The rest are in the phases below.

---

## 7. Phased build plan

Rules for every PR:
- One lane per PR, kept small (< ~600 changed lines excluding tests).
- Draft PR into `main`, deployed to staging first, behind **`ADMIN_V2`** (staging on, prod off). New routes render under the new shell only when the flag is on, and old pages stay until a module reaches parity. Switching a module on in prod needs Alvin's approval per module.
- Each PR passes `npm run lint`, `build`, and the admin `test:e2e` (owner rejected, assign → release → reassign), plus Playwright screenshots at 1280 / 1440 / 768 in light and dark.
- SQL is Platform-first, hand-applied per `docs/supabase/README.md` to staging, then recorded in `MIGRATION_LEDGER.md`.

| Phase | PR(s) | Lane | Content | Gate / sign-off |
| --- | --- | --- | --- | --- |
| **0** | Docs PR | Desk (author with Ops) | Charter amendment (§2.1) + `docs/reference/design-system/OPS.md` (tokens, components, copy rules) + this IA | **Desk Engineer + Scalers Chief sign-off**, Alvin approval |
| **1** | A1 tokens · A2 kit | Desk | `--ops-*` type and spacing, status and chart tokens (light and dark). `ops/` primitives: StatusPill, Money, KpiTile, Sparkline, Skeleton, Empty/Error, ConfirmDialog (3 strengths), Drawer. Add `@tanstack/react-table`, `@tanstack/react-virtual`, `recharts@3`. Kit harness at `/admin/_kit` (staging only). | Desk visual gate, a11y (axe), no motion libraries |
| **2** | A3 DataTable · A4 Shell | Desk | DataTable + FilterBar + SavedViews (URL state, localStorage per operator for now) + BulkBar + CSV. OpsShell: sidebar groups, ⌘K on `api/admin/search`, EnvBanner, redirects from old routes. | e2e nav + owner-reject unchanged |
| **3** | P1 auth hardening | Platform | Remove the legacy HMAC from money and pricing APIs. `admin_operators` table + roles. | Before any money UI in prod |
| **4** | A5 Businesses list · A6 Business detail | Desk (presentation) + Ops (any new read model in `adminBusiness*`) | §3.2 on existing APIs | Parity checklist vs old page |
| **5** | P2 billing schema | Platform | `payments` method/reference/fee/net, `record_manual_payment` RPC, `invoice_lines.kind` + `service_month`, `due_at` NOT NULL on finalise, `credit_notes` + counter, `admin_audit_feed` view | Applied on staging, ledger updated |
| **6** | O1 Billing APIs | Ops | `api/admin/billing` actions: record_payment, create_credit_note, void, mark_uncollectible, send_reminder (all audited, idempotency keys) | Unit tests for each refusal path |
| **7** | A7 Invoices + detail · A8 Payments + Record payment · A9 Credit notes | Desk + Ops | §3.5, §3.6, §3.8 | Money confirm reviewed by Ops. Staging drill: record cash → receipt → notice queued. |
| **8** | P3 analytics data | Platform (+ Voice and Brain hooks) | `subscription_events` completeness, `billing_metrics_daily` + pg_cron 00:30 EAT, `call_costs` + `provider_rates`, Voice hangup cost write (idempotent), Soniox seconds and Gemini token capture | Backfill check on staging. Voice change reviewed by the Voice lane. |
| **9** | A10 Revenue · A11 Collections analytics · A12 Retention, Margins, Usage analytics | Desk + Ops (metric SQL views) | §4. Metric views as SQL functions with unit tests against fixtures. | Numbers reconcile with a hand calculation for staging fixtures |
| **10** | A13 Collections worklist | Ops + Desk (+ Platform `collection_cases`) | §3.7. Depends on the dunning scheduler from the invoicing build. | Ladder scenarios D+1 / 14 / 21 / 45 replayed on staging |
| **11** | A14 Numbers · A15 Packages · A16 Usage and costs | Desk + Ops | §3.3, §3.9, §3.10 | DID integrity e2e |
| **12** | A17 Notifications · A18 Audit log · A19 Settings (switches moved) | Desk + Ops | §3.12, §3.13 | Prod switch change has a typed confirm + alert |
| **13** | A20 Overview | Desk | §1.4. Built last so every tile links to a finished module. | Fits 1280×800 without scrolling |
| **14** | Cleanup | Desk + Ops | Remove old `Admin*Panel` components and `DeskDataTable` admin usages, retire `api/admin/wallets` `set_billing_mode`, flip `ADMIN_V2` default on | Alvin approval for the prod flip |

**Lane ownership (from `AGENTS.md`, `docs/agents/OPS_BILLING.md`, and charter line 88):**
- **Ops** owns behaviour, APIs and read models (`dashboard/src/app/api/admin/**`, `lib/admin*.ts`, `lib/invoicePay/**`) and the metric definitions.
- **Desk** owns presentation (`components/ops/**`, `app/admin/**` page composition, copy styling).
- **Platform** owns schema, RPCs, auth and cron.
- **Voice and Brain** own only the cost-capture hooks.
- **Scalers Chief** owns priority and the charter amendment.

**Critical path:** Phase 0 sign-off → 1 → 2 → 4 (first visible win) → 5 → 6 → 7 (money) → 8 → 9 (analytics). The Collections worklist (10) waits for the invoice builder and dunning scheduler from the invoicing work.

---

## 8. ASCII wireframes (1440px desktop)

### 8.1 Overview

```
┌ Sidebar ───────┬───────────────────────────────────────────────────────────────────────────┐
│ ● PRODUCTION   │ Overview                                   ⌘K Search…        Alvin ▾     │
│ Overview       ├───────────────────────────────────────────────────────────────────────────┤
│ Operate        │ Live payments: On · 1 business allowed (Aris Kenya)            Settings ›  │
│  Businesses    ├───────────────────────────────────────────────────────────────────────────┤
│  Numbers       │ Needs attention                                                            │
│  Quality       │ ● 2 invoices overdue · KSh 14,000                         Collections ›   │
│  Voices        │ ● 1 payment needs review · KSh 6,990                      Payments ›      │
│ Money          │ ● Soniox balance: 4 days left ($3.67)                     Platform ›      │
│  Billing       │ ● Esga at 97% of messages                                 Esga ›          │
│  Packages      │ ● 1 business waiting for a number                         Numbers ›       │
│  Usage & costs ├──────────────┬──────────────┬──────────────┬─────────────┬──────────┬───────┤
│ Insights       │ MRR          │ Collected MTD│ Outstanding  │ Paying      │ Calls    │ Margin│
│  Analytics     │ KSh 21,000   │ KSh 7,000    │ KSh 14,000   │ 3           │ 42 today │ 81.4% │
│ System         │ ▲ 7,000 vs S │ ▼ 2,000 vs S │ 9,000 overdue│ ▲ 1 vs Sep  │ ▲ 8 vs Wd│ ▼ 1.2 │
│  Platform      │ ▁▂▂▃▃▅▅▆▇    │ ▁▃▂▅▃▆▄▇     │ ▂▃▃▅▅▆▆▇     │ ▁▁▂▂▂▃▃▃    │ ▃▅▂▆▄▇▅▆ │ ▇▆▆▅▆ │
│  Notifications ├──────────────┴──────────────┴──────────────┼─────────────┴──────────┴───────┤
│  Audit log     │ MRR, 12 months (by package)                 │ Calls per day, 30 days         │
│  Settings      │  ▆▆▇▇ ███ Scale ▒▒ Growth ░░ Starter        │  ▂▃▅▆▃▂▅▆▇▅▃ answered  ░ msgs │
│                │  …area chart…                               │  …bar chart…                   │
│                ├─────────────────────────────────────────────┴────────────────────────────────┤
│                │ Recent activity   17:12 Alvin  Recorded payment RCT-2026-000002 · Esga  ›    │
│                │                   16:40 cron   Sent "Due in 3 days" · SCL-2026-000014   ›    │
└────────────────┴───────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Businesses list

```
Businesses · 7                                                   [Export]  [Add business]
[All 7] [Paying 1] [Beta 4] [Overdue 0] [Waiting for number 1] [At 90% cap 1] [+ Save view]
[Search name or number…]  [Status ▾] [Package ▾]  More filters    Columns ▾   Density ▾
┌───┬────────────────────┬──────────┬────────────┬──────────────┬───────────┬──────────┬────────┬──────────┬──────────┐
│ ☐ │ Business ▲         │ Status   │ Package    │ Number       │ Minutes   │ Messages │ MRR    │ Balance  │ Last call│
│   │                    │          │            │              │ used/incl │ used/incl│ (KSh)  │ (KSh)    │          │
├───┼────────────────────┼──────────┼────────────┼──────────────┼───────────┼──────────┼────────┼──────────┼──────────┤
│ ☐ │ Aris Kenya         │ ● Beta   │ Starter v2 │ +254 709 …536│ 98 / 300  │ 170 / 200│      0 │        0 │ 16:58    │
│ ☐ │ Esga               │ ● Beta   │ Starter v2 │ +254 7.. …   │ 106 / 300 │ 193 / 200│      0 │        0 │ 14:02    │
│ ☐ │ Done and Dusted    │ ● Waiting│ None       │ None         │   0 / 0   │   0 / 0  │      0 │        0 │ None     │
│ … │                    │          │            │              │           │          │        │          │          │
├───┼────────────────────┼──────────┼────────────┼──────────────┼───────────┼──────────┼────────┼──────────┼──────────┤
│   │ 7 businesses       │          │            │              │ 207       │ 363      │      0 │        0 │          │
└───┴────────────────────┴──────────┴────────────┴──────────────┴───────────┴──────────┴────────┴──────────┴──────────┘
Row click → drawer (summary + actions) · ⌘-click → full page · j/k move · Enter open
```

### 8.3 Business detail

```
‹ Businesses
Esga                         ● Beta   Starter v2 · Monthly   +254 7xx xxx xxx      [Record payment] [⋯]
Owner 07xx… · Billing contact billing@esga…   MRR KSh 0 (shadow 7,000) · Balance KSh 0 · Since 3 Sep
[Summary] [Billing] [Usage] [Number] [People] [Calls and quality] [History]
┌────────────────────────────────────────────────────────────────┬───────────────────────────────┐
│ Billing                                                        │ Facts                          │
│ Subscription   Starter v2 · 1–31 Oct · Beta (not billed)       │ Business id   7f3…  ⧉          │
│                Trust tier New · Cap KSh 3,500 · Extra usage Off│ Created       3 Sep 2026       │
│                                      [Change package] [Set cap]│ Package since 19 Oct (v2 move) │
│ Invoices                                                       │ Enforcement   Off              │
│ ┌──────────────────┬────────┬──────────┬──────────┬──────────┐ │ Number since  4 Sep            │
│ │ Number           │ Status │ Due      │ Total    │ Balance  │ │                                │
│ │ None             │        │          │          │          │ │ Last 5 audit events            │
│ └──────────────────┴────────┴──────────┴──────────┴──────────┘ │ 19 Oct 03:21 system  v1→v2 ›   │
│ Payments  None · Credit notes  None                            │ 04 Sep 11:02 Alvin  Assigned … │
└────────────────────────────────────────────────────────────────┴───────────────────────────────┘
```

### 8.4 Invoices

```
Billing   [Invoices] [Payments] [Collections] [Credit notes]
Invoices · 1                                                        [Export] [Create invoice]
┌──────────────┬──────────────┬──────────────┬──────────────┬──────────────────┐
│ Open         │ Overdue      │ Due in 7 days│ Collected Oct│ Avg days to pay  │
│ KSh 0        │ KSh 0 · 0    │ KSh 0        │ KSh 10       │ 0.0              │
└──────────────┴──────────────┴──────────────┴──────────────┴──────────────────┘
[All] [Open] [Overdue] [Due this week] [Paid] [Draft] [Void] [+ Save view]
[Search SCL number or business…] [Status ▾] [Type ▾] [Issued: This month ▾]
┌─────────────────┬────────────┬────────┬─────────┬──────────┬───────────┬───────────┬──────┬────────┬────────┬─────────┐
│ Number          │ Business   │ Status │ Type    │ Period   │ Issued    │ Due       │ Days │ Total  │ Paid   │ Balance │
│                 │            │        │         │          │           │           │ over │ (KSh)  │ (KSh)  │ (KSh)   │
├─────────────────┼────────────┼────────┼─────────┼──────────┼───────────┼───────────┼──────┼────────┼────────┼─────────┤
│ SCL-2026-000001 │ Aris Kenya │ ● Paid │ Manual  │ None     │ 21 Oct    │ None ⚠    │      │     10 │     10 │       0 │
├─────────────────┼────────────┼────────┼─────────┼──────────┼───────────┼───────────┼──────┼────────┼────────┼─────────┤
│ 1 invoice       │            │        │         │          │           │           │      │     10 │     10 │       0 │
└─────────────────┴────────────┴────────┴─────────┴──────────┴───────────┴───────────┴──────┴────────┴────────┴─────────┘
Drawer → [Record payment] [Send reminder] [Copy pay link] [Credit note] [Void] [PDF] · Lines · Payments · Timeline
```

### 8.5 Revenue analytics

```
Analytics   [Revenue] [Retention] [Collections] [Margins] [Usage]        Range: [Last 12 months ▾]  Updated 00:31 EAT
┌──────────┬──────────┬──────────────┬──────────────┬───────────────┬──────────┐
│ MRR      │ ARR      │ Net new MRR  │ Collected MTD│ Extra usage   │ ARPA     │
│ 21,000   │ 252,000  │ +7,000       │ 7,000        │ 1,040         │ 7,000    │
│ ▲ 50%    │          │ vs +0 Sep    │ ▼ 22% vs Sep │ 40 min        │ flat     │
└──────────┴──────────┴──────────────┴──────────────┴───────────────┴──────────┘
MRR by package (KSh)                                     MRR movements (KSh)
 30k ┤                              ▓▓                   +10k ┤      ██ new  ▒▒ expansion  ░░ reactivation
 20k ┤                         ▓▓▓▓▓▓▓                        ┤  ██  ██  ▒▒
 10k ┤               ░░░░░░░░░░░░░░░░                       0 ┼──────────────────────────────
   0 ┼──────────────────────────────────                     ┤      ▓▓ contraction  ▓▓ churn
     Nov  Jan  Mar  May  Jul  Sep  Oct                  −10k ┤
     ░ Starter  ▒ Growth  ▓ Scale        [View as table]       Nov … Oct            [View as table]
Movements, October                                                         [Export]
┌────────────┬──────────────┬───────────┬───────────┬─────────────────────────────┐
│ Type       │ Businesses   │ MRR (KSh) │ Share     │ Who                         │
├────────────┼──────────────┼───────────┼───────────┼─────────────────────────────┤
│ New        │ 1            │ +7,000    │ 100.0%    │ Aris Kenya ›                │
│ Expansion  │ 0            │ 0         │           │                             │
│ Churn      │ 0            │ 0         │           │                             │
└────────────┴──────────────┴───────────┴───────────┴─────────────────────────────┘
```

The figures in the wireframes are illustrative. The real numbers come from §4 once the snapshot exists. Aris is shown as beta in 8.2 because it went back to beta at 15:38 EAT.

---

## 9. Decisions for Alvin

1. **Ops density layer.** Approve "Scalers Ops" as a separate density layer: 13px body text and 28/36/44px rows. It uses the same brand tokens, font and light/dark modes. This means amending FRONTEND_2_0_CHARTER.md lines 36, 37, 80, 88 and 170 for `/admin` only.
2. **Chart library.** Recharts v3, using the shadcn chart pattern with animation off. Tremor, visx, Nivo and ECharts are rejected.
3. **Tables.** TanStack Table v8 plus TanStack Virtual, with one shared `<OpsTable>`.
4. **IA.** Four groups and twelve modules. Platform health (#772) becomes System › Platform health.
5. **MRR definition.** Count only active, non-beta subscriptions at their monthly-normalised list price. Show beta "shadow MRR" separately.
6. **Snapshot table.** Platform builds `billing_metrics_daily`, refreshed by a cron at 00:30 EAT. Until it exists, analytics pages carry a "Live estimate" label.
7. **Manual payments.** Add a `record_manual_payment` RPC that records fee, net, method and reference, and writes to the audit log. Admin must not write payments directly.
8. **Credit notes and collections.** Add the `credit_notes` and `collection_cases` tables in phase 5. Until then, voiding an invoice is the only correction path.
9. **Operators and audit.** Add an `admin_operators` table with roles (owner, ops, viewer) and an `admin_audit_feed` view. Destructive actions need a typed confirmation.
10. **Rollout.** Ship behind `ADMIN_V2`, staging first, one module per phase. Desk Engineer signs off presentation and Scalers Chief signs off behaviour. Retire the v1 routes after phase 14.

---

## S. Sources

Repo (read only, origin/main `200d9c27`, /workspace/a4-sender):
- `FRONTEND_2_0_CHARTER.md` lines 36, 37, 80, 88 and 170, the density and type rules that conflict with this brief.
- `app/admin/**`, `components/admin/**`, `lib/billing/**`, `supabase/migrations/**`. These are the audit paths in §6.
- PR #772, Platform health (merged). PR #699 was closed and #772 supersedes it.

Workspace briefs:
- `/workspace/briefs/billing-best-practice-research.md`
- `/workspace/briefs/payments-end-to-end-map.md`

Skills: super-admin-product, admin-end-to-end-polish, ui-ux-pro-max-scalers, scalers-context, ops-and-billing-lane, design-taste-frontend. design-taste-frontend says it is not for dashboards, which is why §2 sets its own rules.

External:
- Recharts: https://recharts.org and https://github.com/recharts/recharts (v3 release notes)
- shadcn/ui charts: https://ui.shadcn.com/charts
- TanStack Table: https://tanstack.com/table/latest
- TanStack Virtual: https://tanstack.com/virtual/latest
- Base UI: https://base-ui.com
- Tremor repository activity: https://github.com/tremorlabs/tremor (no maintenance since Oct 2025)
- Okabe and Ito colour-blind-safe palette: https://jfly.uni-koeln.de/color/
- SaaS metric definitions (MRR, NRR, churn, DSO): Stripe Billing analytics docs, https://docs.stripe.com/billing/subscriptions/analytics, and the ChartMogul metrics glossary, https://chartmogul.com/resources/saas-metrics/

**Not verified.** Production row counts and the figures in the wireframes come from earlier read-only context and were not checked again for this brief. The Tremor maintenance status, Recharts v3 API details and the charter line numbers should be checked again before phase 0 starts.
