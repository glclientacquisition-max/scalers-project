# Scalers design system (MASTER)

**Status:** Canon for `dashboard/`  
**Date:** 2026-09-10  
**Law:** [`FRONTEND_CONSTITUTION.md`](../FRONTEND_CONSTITUTION.md) + `.cursor/rules/scalers-design-ux.mdc`

Page notes only record deltas. Do not copy this file into every page spec.

---

## Tokens

Defined in `dashboard/src/app/globals.css` and `dashboard/tailwind.config.ts`.

| Meaning | CSS | Tailwind |
| --- | --- | --- |
| Brand | `--brand` `#0096FF` | `brand` / `brand-500` / `bg-[#0096FF]` |
| Brand deep / link | `--brand-deep` `#005CCC` | `brand-700` / `text-[#005CCC]` |
| Navy ink | `--ink` `#0A192F` | `ink` / `brand-900` |
| Soft ink | `--ink-soft` `#4A5B73` | `ink-soft` |
| Canvas | `--bg` `#F4F7FB` | `surface-canvas` |
| Card | `--card` `#FFFFFF` | `surface` |
| Line | `--line` `#D5DEE9` | `line` |
| Accent wash | `--accent-soft` `#EAF6FF` | `accent-soft` / `brand-50` |
| Warn | `--warn` `#C2410C` | `warn` |
| Ok | `--ok` `#15803D` | `ok` |
| Lead | `--lead` `#B98A1F` | `lead` |
| WhatsApp glyph | `--whatsapp` `#25D366` | `whatsapp` |
| Focus glow | `--shadow-focus` | `shadow-focus` |
| Desk header | `--desk-header-h` | `top-[var(--desk-header-h)]` |
| Desk tab bar | `--desk-tabbar-h` | `3.25rem` below `md`, `0` from `md`. Phone `main` padding and sticky bottom chrome use this plus `safe-area-inset-bottom`. |
| Max width | | `max-w-desk` (72rem) |
| Radius | | `rounded-panel` (0.875rem) |

**Dialect:** Prefer `text-ink`, `bg-surface`, `border-line`, `bg-[#0096FF]`. Migrate `text-[var(--ink)]` when touching a file. Do not global-replace.

**Shared class strings:** `dashboard/src/components/ui/deskChrome.ts`. Settings fields stay in `settingsUi.tsx` but must use the same focus ring.

---

## Spacing (8px)

| Token | rem | px | Tailwind |
| --- | --- | --- | --- |
| `--space-1` | 0.25 | 4 | `1` |
| `--space-2` | 0.5 | 8 | `2` |
| `--space-3` | 0.75 | 12 | `3` |
| `--space-4` | 1 | 16 | `4` |
| `--space-5` | 1.25 | 20 | `5` |
| `--space-6` | 1.5 | 24 | `6` |
| `--space-8` | 2 | 32 | `8` |
| `--space-10` | 2.5 | 40 | `10` |

Use Tailwind utilities. CSS variables exist so sticky chrome and docs stay aligned.

Page frame is owned by `(desk)/layout.tsx`: `px-4 pt-6 sm:px-6 sm:pt-10`. Below `md`, `main` also clears `--desk-tabbar-h` plus `safe-area-inset-bottom`. Child pages start at `mt-0`. Double padding is a defect.

---

## Type

- Body: DM Sans
- Display: Sora on `h1–h3` and `.font-display`
- Page title: `clamp(1.5rem, 2.4vw, 2rem)` semibold. Inbox matches Home and Settings.
- Table: `text-sm`
- Meta: `text-xs uppercase tracking-wide text-ink-soft`

---

## Components

| Pattern | Implementation |
| --- | --- |
| Primary button | `btnPrimary` in `deskChrome.ts`: `#0096FF`, `min-h-11`, white label |
| Ghost / secondary | `btnGhost`: border-line, ink text |
| Focus | `focusRing`: `focus:outline-none focus:ring-2 focus:ring-[#0096FF]` |
| Filter tabs | Underline tabs, `min-h-11`, active `border-[#0096FF] text-[#005CCC]` |
| Data table | `DeskDataTable`: `rounded-2xl border border-line`, cells `px-4 py-3.5` |
| Pagination | `ui/Pagination.tsx` (`min-h-11` hits) |
| Field | `settingsFieldClass` + full brand ring |
| Sticky save | `settingsStickyHeaderClass` under `--desk-header-h` |
| Desk tab bar | `DeskTabBar` in `DeskNav.tsx`. Same `DESK_LINKS` as the `md+` header links. Fixed, `md:hidden`, icon + label, `min-h-12`, `aria-current`. Sign out stays in the header. |
| Empty state | Horizontal rules, title, one action. No marketing paragraph |
| WhatsApp | Brand-blue fill when it is the page CTA. Green glyph. Compact table icon may stay green. |
| Line chip | Live / Pending / Needs training. Never “Online” |

---

## States

| State | Treatment |
| --- | --- |
| Loading | None desk-wide yet. Do not fake skeletons that invent numbers |
| Empty | Title + one link |
| Error | `border-warn/40 bg-warn-soft text-warn` |
| Pending mutation | Spinner on the control. Disable double submit |
| Focus | 2px brand ring, visible on keyboard |
| Reduced motion | No new desk loops |

---

## Motion

Landing only: `.landing-rise`, `.landing-drift`. Desk: bulletin ping already shipped. Nothing else.

---

## Do not add

shadcn, Radix, icon packs, Plus Jakarta, orange CTA, glass panels, purple mesh, a second desk sidebar, a hamburger drawer for primary destinations, fake Online.
