# Platform UI/UX audit

**Date:** 2026-09-19  
**Lane:** Desk UI/UX (read-only)  
**Branch:** `cursor/platform-ui-audit-7d03`  
**Law:** `FRONTEND_CONSTITUTION.md`, `design-system/MASTER.md`, `.cursor/rules/scalers-design-ux.mdc`, page notes under `docs/frontend/design-system/pages/`

Method: route-by-route code review against constitution; spot-check of dev harness routes (`/dev/inbox`, `/dev/desk-shell`, `/dev/motion`) and responsive patterns (`md` table / `lg` split). No product code changed.

---

## Do first (top 8)

| # | Lane | Fix |
| --- | --- | --- |
| 1 | **Desk** | Rebuild `/calls/[id]` as `lg+` split pane: summary / actions left, transcript right; stack below `lg`. |
| 2 | **Desk** | After Archive on ticket, return via `inboxReturnHref` (preserve pile, search, page, view). |
| 3 | **Desk** | Home Work row 1: label `Return calls` (niche copy), link `purpose=needs` or a return-only pile; stop using `purpose=human` for a row labeled "Needs you". |
| 4 | **Desk** | Archived `DeskBack`: restore prior `purpose`, `page`, `view`, `week`, `day`, not only `q`. |
| 5 | **Desk** | Contacts phone list: one preview line (`deskPreviewClass`); move phone to meta or table-only column. |
| 6 | **Desk** | Onboarding: remove `e.g.` placeholders; shrink step chrome; add explicit exit (Sign in / Overview). |
| 7 | **Desk** | Pronunciation panel: replace `text-[var(--accent)]` links with `text-accent-deep`; trim instructional subcopy. |
| 8 | **Ops** | Super Admin: primary CTAs `bg-accent-fill` (`#005CCC`), not ribbon `#0096FF`; strip SQL paths from owner-visible errors. |

---

## Owner desk

### `/home` (Overview)

| Screen | Problem | Why (constitution) | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Work queue row 1 | Label is **Needs you** but `href` is `purpose=human` and count is `toReturn` only | Home spec: three queues are return calls, holds, visits. Inbox **Needs you** is the full open-work pile. Label/filter/count disagree (Hick, single source of truth) | **High** | Rename row to niche return label; link to the correct pile (`needs` or dedicated return filter); align count |
| Work queue row 1 | CTA when returns exist routes to `purpose=human`, not **Needs you** | Same mismatch; owner lands on Human subset, not the briefing queue they tapped | **Med** | Use same pile as row link |
| Next to return | Block is `hidden lg:block` | By design on desktop; mobile owners get no "next return" card | **Low** | Optional compact row under Work on phone |
| Live updates card | Home now mounts `DailyBulletinPanel` (Post update + Clear) | Two filled blues: Post update docked to the field, aside CTA for work | **Low** | Keep one persist path; do not add a Manage ghost |

### `/calls` (Inbox list)

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| List | `DeskDataTable` `min-w-[720px]` forces horizontal scroll on narrow `md` tablets | One composition should not clip primary work | **Med** | Tighten columns or stay on phone rows until `lg` |
| Archived back | `DeskBack` only passes `q`; drops `purpose`, `page`, view params | Back law: restore pile/search/page | **Med** | Build href from stored return state or `document.referrer` pattern via query |
| Bulk select checkbox | Desktop checkbox is `opacity-0` until row hover | Touch-first / no hover-only actions | **Med** | Long-press path exists; expose Select on phone toolbar without hover |
| Pagination | Prev/Next only (no page jump) | Acceptable for v1; large tenants scroll many pages | **Low** | Add page input when `totalPages > 5` |
| Empty / error | `DeskError`, `deskEmptyClass`, archived entry row | Aligned with MASTER | — | — |
| Loading | `(desk)/loading.tsx` spinner only | Aligned | — | — |

### `/calls/[id]` (ticket)

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Layout | Single scrolling thread; no summary left / transcript right at `lg+` | Constitution + `call-detail.md` job: decide + reply; split pane from `lg` | **High** | Two-column grid: left = Want/Done/mood, job/hold editors, recording meta; right = transcript thread |
| Archive (More) | `router.push("/calls")` after archive | Loses pile, search, page, visit List/Work view | **High** | `router.push(inboxReturnHref(ret))` or pass return query through ticket |
| Back | `DeskBack` label always **Inbox**; `href` preserves context via `inboxReturnHref` | Label OK per page note; href OK | **Low** | — |
| Jump to latest | Filled `#005CCC` FAB competes with Confirm/SMS dock | Von Restorff: one primary per viewport when banner+dock visible | **Med** | Ghost or icon-only FAB when action dock is shown |
| SMS dock | `textarea rows={2}` | Aligned | — | — |

### `/contacts`

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Phone list rows | Name + phone + last reason (3 lines) | List preview = one truncated line (`deskPreviewClass`) | **Med** | Phone in meta or mono subline inside one clamped block |
| Desktop table | Four columns, no Open column | Aligned | — | — |
| Header actions | Import CSV, phonebook, Add contact | Aligned; no back needed (top nav) | — | — |
| Pagination | Same `Pagination` as Inbox; preserves `saved` filter | Aligned | — | — |

### `/contacts/[id]`

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Layout | Notes left, timeline right at `lg+` | Aligned with contacts page note | — | — |
| Back | `DeskBack` → Contacts, Inbox, or Call from query | Aligned | — | — |
| Timeline What cell | Headline + optional detail (2 lines) | Detail is on-record, not list; acceptable on detail | **Low** | Clamp detail to one line with expand on row tap |
| Last reason card | `CallSummaryCard` in bordered card | Card OK on detail; not a list violation | — | — |

### `/contacts/import`

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Back | `DeskBack` → Contacts | Aligned | — | — |
| Copy | **CSV. Max 500 rows.** | Zero fluff | — | — |

### `/settings` (Business Profile)

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Mobile sub-panels | `SettingsBackLink` → Business Profile (`lg:hidden`) | Aligned; desktop uses rail | — | — |
| Menu index | No back (root of Business) | Correct | — | — |
| Sticky Save | `SettingsPageHeader` + `TenantSettingsSaveButton` on form tabs | Aligned | — | — |
| Pronunciation | Link uses `text-[var(--accent)]` (#0096FF) | AA body/link law: small links `#005CCC` / `accent-deep` | **Med** | Token `text-accent-deep` |
| Pronunciation | Title **Pronunciation Overrides**; helper copy under Practice | Slightly instructional; not Agent Persona level | **Low** | Shorten to **Pronunciation** |
| Theme | Appearance in menu + device picker | Aligned | — | — |

### `/wallet`

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Hierarchy | Balance `text-3xl sm:text-4xl`, then facts | Aligned with wallet page note | — | — |
| Layout | Large bordered cards for balance + ledger | Wallet is not a table product; acceptable density | **Low** | Optional ledger as dense table |
| Top up | Header `btnPrimary` | Aligned | — | — |
| Warn states | `bg-warn-soft` when low/empty | Aligned | — | — |

### `/requests`, `/appointments`

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Both | Redirect to `/calls?purpose=hold` and `job` | Constitution: filter Inbox, no second list | — | — |

### Desk shell (global)

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Nav | Single `DESK_LINKS`; bottom tabs `< md`, top links `md+` | Aligned | — | — |
| No left rail | Settings uses inner sidebar only | Aligned | — | — |
| `DeskBack` | Sticky under header; 44px `min-h-11` | Aligned | — | — |
| Dark theme | `.desk-theme` token flip | Aligned with MASTER | — | — |
| 404 | Recovery → Overview | Aligned | — | — |

---

## Landing / marketing

### `/` (`LandingPage`)

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Hero CTA | Primary is white fill on navy, not `#005CCC` | Desk mandate is `#005CCC` for filled primary; landing may differ | **Low** | Use brand-deep fill or document marketing exception |
| Copy | Subhead is two sentences; no em/en dash | Mostly aligned | — | — |
| Brand | Scalers mark + name in first viewport | Aligned | — | — |
| Motion | `landing-rise` / `landing-drift` | Allowed on marketing | — | — |
| Auth path | Sign in header link | Flow to `/login` works | — | — |

### `brand/**`

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| `BrandLockup` / `BrandWordmark` | DM Sans + Sora via layout | Aligned | — | — |
| Header `sm` lockup | Icon `h-8 w-8` (32px) in desk header | Below 44px but decorative/nav brand, not action | **Low** | — |

---

## Auth / onboarding

### `/login`

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Back | No link back to `/` marketing | Minor dead end for logged-out users | **Low** | Muted **Scalers home** link |
| CTA | `btnPrimary` Sign in | Aligned | — | — |
| Links | Hardcoded `text-[#005CCC]` | Prefer `text-accent-deep` token | **Low** | Tokenize |
| Focus | `deskFieldClass` / focus ring | Aligned | — | — |

### `/signup`

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Copy | **Lead alerts go here.** under phone | Light fluff | **Low** | Remove or fold into label |
| Flow | Check email → sign in link | Aligned | — | — |
| CTA | `btnPrimary` | Aligned | — | — |

### `/onboarding`

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Placeholders | `e.g.` in services/hours textareas | Settings/onboarding copy ban on `e.g.` prefixes | **Med** | Example lines without `e.g.` |
| Step chrome | Numbered circles `h-8 w-8` (32px) | Below 44px action floor | **Med** | `min-h-11` targets or decorative-only |
| Tone options | `TONE_OPTIONS` blurbs defined but not shown | Dead copy in bundle | **Low** | Delete unused blurbs |
| Back | Step Back is text link on step > 0 only | No escape to desk/sign out mid-wizard | **Med** | Sign out link in header |
| Card | Heavy shadow + padded card vs desk density | Slight aesthetic drift from desk | **Low** | Match `rounded-2xl border border-line` desk surfaces |
| Finish | Redirect to `/home` when complete | Aligned | — | — |

---

## Super Admin (Ops lane)

> Flagged for **Ops & Billing**. Desk should not redesign behavior; styling-only fixes need Ops agreement.

### `/admin/**` shell

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Layout | Fixed **left sidebar** on `lg+` | Owner desk bans left rail; admin is separate shell (OK) but inconsistent chrome | **Low** (Ops) | Document admin as ops console exception |
| Mobile nav | Horizontal scroll nav under header | Usable; no bottom tabs | **Low** (Ops) | — |
| Back | No `DeskBack`; rely on sidebar | OK for admin IA | — | — |

### `/admin` (overview)

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| KPI grid | Four-up stacked cards | Gestalt: cards where a dense table could serve ops lists | **Med** (Ops) | Table for businesses/numbers attention rows |
| Primary CTA | `bg-[var(--accent)]` (#0096FF) | Filled primary should be `#005CCC` | **Med** (Ops) | `bg-accent-fill text-accent-on-fill` |
| Errors | Surfaces `docs/supabase/*.sql` paths | Owner/ops facing errors should not expose repo paths | **High** (Ops) | Generic message + log internally |
| Attention list | **Manage →** arrow link | Minor; not desk pattern | **Low** (Ops) | Row tap or muted text link |

### `/admin/businesses`

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Page | Title only; panel in card stack | Ops-dense table likely in `AdminBusinessesPanel` | **Med** (Ops) | Audit panel for table vs cards |
| Back | None | Relies on sidebar | — | — |

### `/admin/numbers`

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Page | `BuyNumberPanel` + `DidPoolManager` stacked | Vertical sprawl on long pools | **Med** (Ops) | Dense table for pool rows |
| Errors | SQL migration hint in UI | Same as overview | **High** (Ops) | Generic error |

### `/admin/wallets`

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Title | `text-3xl` vs other admin `text-2xl` | Inconsistent hierarchy | **Low** (Ops) | One admin title class |

### `/admin/voices`

| Screen | Problem | Why | Severity | Proposed fix |
| --- | --- | --- | --- | --- |
| Title | `text-4xl` | Oversized vs desk `pageTitleClass` clamp | **Low** (Ops) | `text-2xl` admin standard |

---

## Cross-cutting constitution notes

| Topic | Status |
| --- | --- |
| Typefaces (DM Sans / Sora) | Shipped |
| `textarea rows={2}` default | Shipped in settings, SMS, onboarding |
| Em/en dash in **UI strings** | Rare in components; some `e.g.` and ops SQL hints remain |
| Hardcoded `#005CCC` / `#0096FF` in desk | Present in a few components; prefer `deskChrome` tokens |
| Inbox list recipe (one preview, action dock) | Largely shipped |
| Split pane call detail | **Not shipped** |
| `DESK_LINKS` single nav | Shipped |
| Live inbox subscription in shell | Shipped via `LiveInbox` |

---

## Screens with adequate back navigation

| Route | Back |
| --- | --- |
| `/calls?purpose=archived` | Inbox (`DeskBack`) |
| `/calls/[id]` | Inbox (contextual `href`) |
| `/contacts/[id]` | Contacts / Inbox / Call |
| `/contacts/import` | Contacts |
| `/settings?tab=*` (mobile) | Business Profile |
| `/settings` form panels (mobile) | Business Profile via `SettingsPageHeader` |

## Screens correctly without back

`/home`, `/calls` (default), `/contacts`, `/settings` menu, `/wallet`, `/login`, `/signup`, `/`, admin routes (sidebar).

---

## Dev harness (sanity)

With `DASHBOARD_OPEN=true`, `/dev/inbox`, `/dev/desk-shell`, and `/dev/motion` exist for visual regression of list recipe, shell, and motion verbs. Not a substitute for owner data paths above.

---

*End of audit. Desk lane owns rows marked Desk; Ops lane owns Super Admin.*
