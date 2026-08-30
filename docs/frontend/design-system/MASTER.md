# Scalers master design system

**Status:** Phase 2 of Frontend 2.0. Extracted from shipping desk screens. Not invented.  
**Date:** 2026-08-30  
**Authority:** [`FRONTEND_CONSTITUTION.md`](../FRONTEND_CONSTITUTION.md)  
**Baseline:** [`FRONTEND_RECONNAISSANCE.md`](../FRONTEND_RECONNAISSANCE.md)

This file is the **recipe book** for later UI phases. If a pattern is not here, search the files named below before creating one.

No UI ships from this phase. Do not add packages, tokens, fonts, or a component library to implement this document.

---

## How this system was made

```text
Existing Calls inbox
Existing Call detail
Existing Business settings
Existing tokens (globals.css + tailwind.config.ts)
Constitution
Taste analysis of what already ships
UI UX Pro Max analysis of operational UX
Ponytail reuse constraints
        ↓
THIS FILE
```

**Extract, do not invent.** New screens copy these recipes. Gaps are listed as debt for later phases, not as permission to design a second Scalers.

---

## Source screens

| Role | Route | Files |
| --- | --- | --- |
| Collection benchmark | `/calls` | `calls/page.tsx`, `CallsCommandCenter.tsx`, `Pagination.tsx` |
| Detail benchmark | `/calls/[id]` | `calls/[id]/page.tsx` |
| Knowledge IA benchmark | `/settings` | `BusinessSettingsShell.tsx`, `TenantForm.tsx`, `settingsUi.tsx` |
| Tokens | all desk | `globals.css`, `tailwind.config.ts`, `app/layout.tsx` |
| Shell | owner desk | `(desk)/layout.tsx`, `DeskNav.tsx` |

Do not treat Landing, Home (current stub), Requests, Appointments, or Admin as sources for the desk language. Landing is a separate marketing surface. Home, Requests, and Appointments **consume** this system in Phases 3–4.

---

## Advisor analysis (applied to what exists)

### Taste (redesign skill, filtered)

Scalers already avoids the usual AI-SaaS fingerprint on the desk: one accent, cool navy ink, DM Sans + Sora (not Inter), top bar (not a mandatory left dashboard rail), no purple mesh.

| Taste impulse | Applied? |
| --- | --- |
| Replace fonts with Geist/Outfit | **No.** Keep DM Sans + Sora. |
| Double the whitespace | **No.** Desk density is 8. That advice is for marketing. |
| Grain, mesh, overlapping depth | **No.** Desk stays flat surfaces + 1px `line`. |
| Break symmetry / zig-zag features | **No.** Operational lists stay predictable. |
| Tabular numbers on data | **Yes.** Calls filter counts already use `tabular-nums`. Keep. |
| Visible focus, hover, empty states | **Yes.** Copy Calls empty states and settings focus. |
| One accent | **Yes.** `#0096FF` only for primary action. |

Landing may stay atmospheric. Do not import landing rise/drift onto the desk.

### UI UX Pro Max (operational queries, not `--design-system`)

The generic `--design-system` pack (glass, Plus Jakarta, orange CTA) remains **rejected**.

Kept from UX search:

- Tables wrap in `overflow-x-auto` (Calls already does).
- Visible focus ring; never `outline-none` alone.
- Visible `<label>` or `sr-only` label (Calls search). No placeholder-only fields.
- Status as text or a real control (`LeadStatusToggle`), not color-only pills.
- Viewport meta already set in `layout.tsx`.

Discarded:

- Bulk checkbox column on Calls (YAGNI until owners ask).
- Card fallback for tables on mobile. Calls uses horizontal scroll. Keep that unless evidence shows it fails.

### Ponytail

Before any new primitive: copy a class string from `settingsUi.tsx` or a pattern from Calls. Do not add shadcn, Radix, icon packs, or a `Button.tsx` wrapper unless a later phase cannot reuse the existing strings.

Reuse these as-is:

`settingsFieldClass`, `settingsDenseFieldClass`, `settingsTableFieldClass`, `settingsStickyHeaderClass`, `settingsActionClass`, `settingsGhostButtonClass`, `settingsChipClass`, `ExpandTextarea`, `TrashButton`, `ToolSwitch`, `Pagination`, `CallsToolbar` (as the filter+search template), `BrandLockup`, `LeadStatusToggle`, `MarkLeadDoneButton`, `WhatsAppLink` / `waMeHref`.

---

## 1. Tokens (canonical, already shipped)

Do not add a second palette. Prefer Tailwind names over `text-[var(--ink)]`.

| Role | CSS | Tailwind |
| --- | --- | --- |
| Brand / primary | `--brand` `#0096FF` | `brand`, `accent`, `bg-[#0096FF]` |
| Brand deep | `--brand-deep` `#005CCC` | `brand-700`, `accent-deep`, `text-[#005ccc]` |
| Accent wash | `--accent-soft` `#EAF6FF` | `accent-soft`, `bg-[#0096FF]/10` |
| Navy / ink | `--ink` `#0A192F` | `ink`, `brand-900` |
| Ink muted | `--ink-soft` `#4A5B73` | `ink-soft` |
| Canvas | `--bg` `#F4F7FB` | `surface-canvas` |
| Muted fill | `--bg-deep` `#E8EEF6` | `surface-muted` |
| Card | `--card` `#FFFFFF` | `surface` |
| Line | `--line` `#D5DEE9` | `line` |
| Warn | `--warn` `#C2410C` | `warn` / `warn-soft` |
| Ok | `--ok` `#15803D` | `ok` / `ok-soft` |
| Lead (in progress) | `--lead` `#B98A1F` | `lead` |
| WhatsApp (glyph only) | `--whatsapp` `#25D366` | `whatsapp` |

Also shipped: `shadow-focus`, `shadow-lift`, `rounded-panel` (0.875rem), `max-w-desk` (72rem), `--desk-header-h` (4.25rem / 4.5rem from `sm`).

Body canvas wash (radial brand tints) is global in `globals.css`. Do not add more gradients on desk components.

---

## 2. Type (extracted)

Fonts: **DM Sans** `--font-sans`, **Sora** `--font-display`. Loaded in `app/layout.tsx`. `h1–h3` and `.font-display` use Sora with `letter-spacing: -0.02em`.

| Use | Recipe (from shipping screens) |
| --- | --- |
| Page title | `font-display tracking-tight text-ink text-[clamp(1.75rem,5vw,2.25rem)]` (Calls) or `text-3xl sm:text-4xl` (call detail) |
| Section title | `font-display text-xl tracking-tight text-ink` (settings panel heading) |
| Body | `text-sm` or `text-base leading-relaxed text-ink` |
| Metadata | `text-xs font-medium uppercase tracking-wide text-ink-soft` |
| Filter count | `tabular-nums text-xs` |
| Phone / SID | `font-mono text-sm text-ink` |

Do not use landing-scale `text-5xl` / `md:text-6xl` on the desk.

---

## 3. Layout

**Owner shell** (`(desk)/layout.tsx`):

- Sticky header, `border-b border-line/80 bg-surface/95 backdrop-blur`
- Inner: `mx-auto flex max-w-desk … px-4 py-3 sm:px-6 sm:py-3.5`
- Main: `mx-auto w-full min-w-0 max-w-desk px-4 py-6 sm:px-6 sm:py-10`

Pages must not add a second page gutter. Appointments currently does (`px-4 py-10` inside main). That is Phase 4 debt.

**Settings local chrome:** sidebar `lg:w-56` + `flex-1` content. Sticky save uses `settingsStickyHeaderClass` under `--desk-header-h`.

**Call detail:** `grid grid-cols-1 gap-8 lg:grid-cols-12`. Aside `lg:col-span-4 lg:sticky lg:top-24`. Transcript `lg:col-span-8`. Stacks on small screens (constitution exception).

**Collection table:** `overflow-x-auto rounded-2xl border border-line bg-surface` wrapping `<table className="w-full min-w-[760px] text-left text-sm">`.

---

## 4. Color of action (constitution rule, extracted conflict)

| Rank | Extracted recipe | Notes |
| --- | --- | --- |
| Primary | `inline-flex min-h-12 items-center justify-center rounded-xl bg-[#0096FF] px-6 py-3 text-base font-semibold text-white hover:bg-[#0088e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF] focus-visible:ring-offset-2` | Home next action; settings Save is the same fill, `min-h-14` |
| Secondary | `settingsActionClass` or Calls empty-state: `inline-flex rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-[#005ccc] hover:border-[#0096FF]` | |
| Ghost | `settingsGhostButtonClass` | Calls Search |
| Destructive / mute | `MarkLeadArchiveButton` icon: `text-ink-soft hover:bg-surface-muted`; `TrashButton` hover `text-warn` | Not a red filled button |
| WhatsApp **canonical** | Blue fill, green glyph (`TriageLeadCard`) | Constitution |
| WhatsApp **current detail** | `bg-[#25D366]` full button | Debt. Phase 5 or Home reuse of `TriageLeadCard` |

One primary per screen.

---

## 5. Focus

**Constitution / mandate target:** `focus:outline-none focus:ring-2 focus:ring-[#0096FF]`

**Shipped settings fields:** `outline-none focus:border-[#0096FF] focus:ring-2 focus:ring-[#0096FF]/40`

Until Phase 5, **copy `settingsFieldClass`**. Do not invent a third ring. Do not ship `outline-none` without a ring or `shadow-focus`.

---

## 6. Components (recipes, not new files)

### 6.1 Page header + filters

Copy `CallsToolbar`:

1. Title left, optional search right (`min-h-11`, `type="search"`, `sr-only` label).
2. `nav` with `border-b border-line`.
3. Tab links: `min-h-11 border-b-2 px-3 text-sm font-medium`. Active: `border-[#0096FF] text-[#005ccc]`. Idle: `border-transparent text-ink-soft`.
4. Counts in `tabular-nums`.

Requests already has a weaker version of this (status + type as two tab rows). Appointments uses chips. Phase 4: both become this toolbar.

### 6.2 Table

From `/calls`:

- Wrapper: `mt-6 overflow-x-auto rounded-2xl border border-line bg-surface`
- Head: `border-b border-line bg-surface-muted/70 text-ink-soft`, `th` `px-4 py-3 font-medium`
- Body row: `border-t border-line/70 hover:bg-surface-muted/30`; urgent `bg-warn-soft/60`
- Cells: `px-4 py-3.5`
- Row primary link: `font-medium text-[#0096FF] hover:text-[#005ccc]` (“Open”)
- Inline WhatsApp: `WhatsAppLink` (green glyph on the number, not a full-width CTA in the table)

### 6.3 Empty collection

From `EmptyCalls`: `mt-6 border-y border-line py-10 text-center`. Title `font-display text-xl tracking-tight text-ink`. Optional one secondary or primary link. No illustration, no marketing paragraph.

Pending-number variant: `border-[#0096FF]/30 bg-[#0096FF]/5` plus primary “Train assistant”. Deep link must be `?tab=train`, not `#train` (current href is debt).

### 6.4 Pagination

Use `Pagination` (`DEFAULT_PAGE_SIZE = 25`). Do not write a second pager.

### 6.5 Split pane

Call detail: summary + primary CTA left (sticky on `lg`), conversation right. Cards inside the left pane are allowed for **one interaction’s** grouping. Do not use that card stack as the collection pattern.

### 6.6 Forms

Use `settingsUi.tsx`:

- Default field: `settingsFieldClass`
- Dense / table cell: `settingsDenseFieldClass` / `settingsTableFieldClass`
- Textarea: `rows={2}` + `ExpandTextarea` or `compactTextareaExpandHandlers`
- Choice: `settingsChipClass` (identity/tone already)
- Toggle: `ToolSwitch`
- Remove: `TrashButton` (icon + `aria-label`)

Sticky save: `settingsStickyHeaderClass` + `TenantSettingsSaveButton`.

### 6.7 Nested nav

`SettingsSidebar`: container `rounded-2xl border border-line bg-surface p-2`. Links `rounded-lg px-3 py-2 text-sm`. Active `bg-[#0096FF]/10 text-[#005ccc]`. Section header `pointer-events-none … text-xs font-bold uppercase tracking-wider text-gray-500` (`Train`).

### 6.8 Status

Lead steps: `LeadStatusToggle` (New / Followed Up / Done) with warn / lead / ok fills when active. Do not recolor these without a product reason.

### 6.9 KPI tiles

Home `MetricCard` is a **link tile**, not a dashboard widget: `min-h-[5.5rem] rounded-2xl border px-3 py-3 text-center`, label uppercase tracking, value `font-display`. Warn state uses `border-warn/45 bg-warn-soft`. Use only when the number is real and the href goes to work. Do not add decorative sparkline KPIs.

### 6.10 Attention row (evaluate)

`TriageLeadCard` exists, unused. Brand-blue WhatsApp CTA, muted Done/Archive. Phase 3 Home may reuse it for new leads. If it is too card-like next to Calls density, prefer a table row that reuses Calls cells instead of drawing a new card.

---

## 7. Copy

Constitution §14. Product strings: short, no em/en dashes, no “Coming soon”, no “Opening your line…”.

Error fallbacks that mention `docs/supabase/…` are engineer-facing debt, not a pattern to copy into owner empty states.

---

## 8. Motion

Desk = 2. Allowed: `disabled:opacity-60`, save spinner (`animate-spin` on Save), bulletin ping on Home (real live update), mobile nav overlay, `prefers-reduced-motion` already on landing classes.

Do not add `landing-rise` to desk pages.

---

## 9. Accessibility (minimum)

Extracted from what the good screens already do, plus constitution:

- `aria-current="page"` on nav and filter tabs
- `aria-label` on filter `<nav>` and icon buttons
- `sr-only` on search label
- `role="radiogroup"` / `role="radio"` on settings chips
- Primary actions `min-h-11` or larger (`min-h-12` / `min-h-14`)
- Contrast: ink on canvas/surface; white on `#0096FF`

Gaps (Phase 5): many auth/onboarding inputs lack the ring; icon Done/Archive have labels (good) but `h-9` hit area is under 44px.

---

## 10. Responsive

| Surface | Extracted behavior | Keep |
| --- | --- | --- |
| Desk nav | Inline `md+`, Menu drawer below | Yes |
| Calls table | Horizontal scroll, `min-w-[760px]` | Yes |
| Call detail | Stack, then 4/8 split at `lg` | Yes |
| Settings | Sidebar stacks above content until `lg` | Yes |
| Save | Full width on small, `sm:w-auto` | Yes |

Do not convert Calls to stacked cards on mobile.

---

## 11. What this system does not include

Do not create these unless a later phase proves a source and a job:

- Live Online indicator
- Contacts
- New fonts or color tokens
- Modal/drawer primitive (none ships; native or a first copy from an existing panel)
- Chart library
- Toast system
- Dark mode
- Super Admin visual redesign (token alignment only in Phase 5)

---

## 12. Debt to consume (not redesign)

| Debt | Source | Phase |
| --- | --- | --- |
| Requests/Appointments are cards | those pages | 4 |
| Appointments double padding + fluff + em dash | `appointments/page.tsx` | 4 |
| Related call → `/calls` not `/calls/{id}` | appointments | 4 |
| `/settings#train` / `#test` | `calls/page.tsx` | 4 |
| Token dialect `text-[var(--ink)]` | auth, onboarding, appointments, admin | 5 |
| Call-detail WhatsApp green fill | `[id]/page.tsx` | 5 |
| Focus ring `/40` vs mandate solid | `settingsUi` vs constitution | 5 |

---

## 13. Implementation rule for Phases 3–7

1. Open this file and the page spec in `pages/`.
2. Copy the named recipe or import the named module.
3. If neither exists, stop. Do not invent a third button.
4. Real data only.
5. Lint, build, critical-flow check.

Page specs: [`pages/`](./pages/). They record **jobs and deltas**, not a second visual language.
