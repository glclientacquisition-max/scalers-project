# Scalers design system (MASTER)

**Status:** Canon for `dashboard/`  
**Date:** 2026-09-14  
**Law:** [`FRONTEND_CONSTITUTION.md`](../FRONTEND_CONSTITUTION.md) + `.cursor/rules/scalers-design-ux.mdc`

Page notes only record deltas. Do not copy this file into every page spec.

---

## Tokens

Defined in `dashboard/src/app/globals.css` and `dashboard/tailwind.config.ts`.

| Meaning | CSS | Tailwind |
| --- | --- | --- |
| Brand | `--brand` `#0096FF` | `brand` / `accent` |
| Brand deep / link | `--brand-deep` `#005CCC` | `brand-700` / `accent-deep` |
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
| Desk tab bar | `--desk-tabbar-h` | `4rem` below `md`, `0` from `md`. Matches `DeskTabBar` min-height. |
| Desk tab clearance | `--desk-tabbar-clearance` | Phone: tab bar plus `safe-area-inset-bottom` plus `1.5rem`. From `md`: `2.5rem`. Phone `main` padding, `scroll-padding-bottom`, and sticky bottom chrome use this. |
| Max width | | `max-w-desk` (72rem) |
| Radius | | `rounded-panel` (0.875rem) |

**Dialect:** Prefer `text-ink`, `bg-surface`, `border-line`, filled primary `bg-accent-fill text-accent-on-fill`. Never hardcode hex in desk components: `accent` (ribbon, focus, tab underline), `accent-deep` (links, small text), `accent-fill` ramp (filled buttons). Migrate `text-[var(--ink)]` when touching a file. Do not global-replace.

---

## Dark mode

The desk (`app/(desk)`) ships a dark palette; marketing, auth, onboarding, and admin stay light.

- **Token-driven.** Dark redefines the same CSS variables (`--bg`, `--card`, `--ink`, `--line`, `--accent`, fills, status colors). Components never write `dark:` variants; they reference tokens and flip for free.
- **Scoped.** Dark tokens apply only inside `.desk-theme` (the desk layout root, mirrored on `dev/inbox` for visual tests). Activation: `<html data-theme="dark|light">` set by the pre-paint script in `app/layout.tsx`, or `prefers-color-scheme` when no explicit choice. Both selectors live in `globals.css` and must stay in sync.
- **Choice is per-device.** `ThemePicker` (Settings menu, This device) writes `localStorage["scalers-desk-theme"]` (`system` default) and applies instantly. Never a tenant setting, never server state.
- **Fills invert.** On bright fills (accent, warn, ok, lead) the label is `text-accent-on-fill`: white on deep blue in light, deep navy on bright fills in dark. `#0096FF` text on dark is `accent-deep` (`#6BC2FF`).
- **Inherited ink.** `body` sits outside `.desk-theme`, so its `color` is computed from light `--ink`. `.desk-theme` sets `color` and `caret-color` from `--ink`. Form controls (input/textarea/select) pin `color` and autofill `-webkit-text-fill-color` so typed characters never inherit navy onto a dark field. Field class strings include `text-ink` and `placeholder:text-ink-soft/70`.

| Token role | Light | Dark |
| --- | --- | --- |
| Canvas `--bg` | `#F4F7FB` | `#0A1420` |
| Card `--card` | `#FFFFFF` | `#122236` |
| Ink `--ink` | `#0A192F` | `#E9EFF7` |
| Soft ink `--ink-soft` | `#4A5B73` | `#9DAFC6` |
| Line `--line` | `#D5DEE9` | `#24374F` |
| Accent `--accent` | `#0096FF` | `#2AA8FF` |
| Link `--accent-deep` | `#005CCC` | `#6BC2FF` |
| Fill `--accent-fill` | `#005CCC` | `#1F9FFF` |
| On fill `--accent-on-fill` | `#FFFFFF` | `#062033` |

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

Page frame is owned by `(desk)/layout.tsx`: `px-4 pt-6 sm:px-6 sm:pt-10`. Below `md`, `main` also clears `--desk-tabbar-clearance`. Child pages start at `mt-0`. Double padding is a defect.

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
| Primary button | `btnPrimary` in `deskChrome.ts`: fill `#005CCC`, `min-h-11`, white label. Focus ring `#0096FF`. Compose taller hits with `btnPrimaryFill` (sticky Save). `settingsPrimaryButtonClass` aliases `btnPrimary`. |
| Ghost / secondary | `btnGhost`: border-line, ink text |
| Focus | `focusRing`: `focus:outline-none focus:ring-2 focus:ring-[#0096FF]` |
| Filter tabs | `FilterTabs` + `filterTabClass`. Underline, `min-h-11`, active `border-[#0096FF] text-[#005CCC]`. Inbox and Contacts share this. |
| List row | `DeskRowHit` in `deskRowHit.tsx`. Parent `relative`. Body `deskRowMutedClass`. Trailing verb `deskRowActionClass`. No Call, Open, or View column. Anatomy: `RowIdentity` circle (neutral, initials or person glyph, never tinted by state), two-line body, timestamp right. Needs-you state is `RowStateDot` (brand blue, sits with the timestamp) plus `deskRowWeightClass` (semibold while open, medium once handled). No opacity dimming. |
| Pagination | `ui/Pagination.tsx` (`min-h-11` hits) |
| Field | `deskFieldClass`. Settings: `settingsFieldClass` = `mt-1` + `deskFieldClass` |
| Sticky save | `settingsStickyHeaderClass` under `--desk-header-h` |
| Dialog | `DeskDialog`: overlay, Escape, focus restore. No enter animation. |
| Desk tab bar | `DeskTabBar` in `DeskNav.tsx`. Same `DESK_LINKS` as the `md+` header links. Fixed, `md:hidden`, icon + label, `min-h-12`, `aria-current`. Sign out stays in the header. |
| Empty state | `deskEmptyClass`. Title + one link. No marketing paragraph |
| Owner error | `DeskError` + `ownerFacingError`. Never SQL files, RLS dumps, or repo paths. Log raw diagnostics with `logDeskError`. |
| WhatsApp | Brand-blue fill + white glyph when it is the page CTA (`variant="primary"`). List trailing icon: green glyph on `#25D366`, `h-11 w-11`, `rounded-xl` (`variant="icon"`). No extra WhatsApp mark next to the name. |
| Call | `CallLink` (`tel:` deep link, the device dialer places the call). List dock only, icon-only, muted: `h-11 w-11` bordered, sits left of the WhatsApp icon. Never a column, never a filled button. |
| Line chip | Live / Pending / Needs training. Never “Online” |

---

## States

| State | Treatment |
| --- | --- |
| Loading | No route `loading.tsx`. Do not fake skeletons that invent numbers |
| Empty | `deskEmptyClass`. Title + one link |
| Error | `DeskError`: `border-warn/40 bg-warn-soft text-warn`, `role="alert"` |
| Pending mutation | `pendingSpinnerClass` on the control. Disable double submit |
| Focus | 2px brand ring, visible on keyboard |
| Reduced motion | No new desk loops. Primary press scale is `motion-reduce:active:scale-100` |

---

## Motion

Landing only: `.landing-rise`, `.landing-drift`. Desk default is none. Bulletin ping already shipped. Primary buttons may press-scale (`active:scale-[0.99]`, named properties, 150ms). `DeskDialog` does not animate in.

---

## Do not add

shadcn, Radix, icon packs, Plus Jakarta, orange CTA, glass panels, purple mesh, a second desk sidebar, a hamburger drawer for primary destinations, fake Online.
