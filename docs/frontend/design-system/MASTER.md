# Scalers design system (MASTER)

**Status:** Canon for `dashboard/`  
**Date:** 2026-09-17  
**Law:** [`FRONTEND_CONSTITUTION.md`](../FRONTEND_CONSTITUTION.md) + `.cursor/rules/scalers-design-ux.mdc`  
**Chat client (not shipped):** [`WHATSAPP_BUSINESS_FRONTEND.md`](../WHATSAPP_BUSINESS_FRONTEND.md)

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
| Desk header | `--desk-header-h` | `0` at every width. Phone lockup removed. |
| Desk tab bar | `--desk-tabbar-h` | `4rem` below `md`, `0` from `md`. Phone ticket chat (`[data-ticket-chat]`) also sets `0`. Matches `DeskTabBar` min-height. |
| Desk tab clearance | `--desk-tabbar-clearance` | Phone: tab bar plus `safe-area-inset-bottom` plus `1.5rem`. From `md`: `2.5rem`. Phone ticket chat: `0`. Phone `main` padding, `scroll-padding-bottom`, and sticky bottom chrome use this. |
| Max width | | `max-w-desk` (72rem) |
| Radius | | `rounded-panel` (0.875rem) |
| Motion fast | `--motion-fast` | 150ms named transitions |
| Motion land | `--motion-land` | 900ms one-shot wash |
| Motion live | `--motion-live` | 1.4s live ping loop |

**Dialect:** Prefer `text-ink`, `bg-surface`, `border-line`, filled primary `bg-accent-fill text-accent-on-fill`. Never hardcode hex in desk components: `accent` (ribbon, focus, tab underline), `accent-deep` (links, small text), `accent-fill` ramp (filled buttons). Migrate `text-[var(--ink)]` when touching a file. Do not global-replace.

---

## Dark mode

The desk (`app/(desk)`) ships a dark palette; marketing, auth, onboarding, and admin stay light.

- **Token-driven.** Dark redefines the same CSS variables (`--bg`, `--card`, `--ink`, `--line`, `--accent`, fills, status colors). Components never write `dark:` variants; they reference tokens and flip for free.
- **Scoped.** Dark tokens apply only inside `.desk-theme` (the desk layout root, mirrored on `dev/inbox` for visual tests). Activation: `<html data-theme="dark|light">` set by the pre-paint script in `app/layout.tsx`, or `prefers-color-scheme` when no explicit choice. Both selectors live in `globals.css` and must stay in sync.
- **Choice is per-device.** `ThemePicker` (Profile → Appearance) writes `localStorage["scalers-desk-theme"]` (`system` default) and applies instantly. Never a tenant setting, never server state.
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

## Super Admin

Ops console (`/admin`) keeps a labeled navy sidebar on `lg+`, horizontal nav below `lg`. Owner desk uses a compact icon rail (`DESK_LINKS`) on `md+` and bottom tabs below `md`. Admin stays light. Do not copy the ops sidebar onto `(desk)`. Page note: [`pages/admin.md`](pages/admin.md).

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

Page frame is owned by `(desk)/layout.tsx`: `px-4 pt-4 sm:px-6 sm:pt-6`. Below `md`, `main` also clears `--desk-tabbar-clearance`. Child pages start at `mt-0`. Double padding is a defect.

---

## Type

- Body: DM Sans
- Display: Sora on `h1–h3` and `.font-display`
- Page title: nested records use `pageTitleClass` (`clamp(1.5rem, 2.4vw, 2rem)` semibold). List roots (Inbox, Contacts, Usage) use `deskListTitleClass` (`text-3xl sm:text-4xl` semibold, Sora via `font-display`). Not sticky. Overview stacks a compact Scalers lockup (`BrandLockup` `size="sm"`, name Scalers, not `markOnly`) over a modest workspace `h1` (`text-lg font-semibold text-ink min-w-0 truncate`), then a muted date (`text-sm text-ink-soft`). Phone and `md+` share that stack. The rail keeps its own mark. Profile keeps a compact `text-xl` hub title.
- Table: `text-sm`
- Meta: `text-xs uppercase tracking-wide text-ink-soft`

---

## Components

| Pattern | Implementation |
| --- | --- |
| Primary button | `btnPrimary` in `deskChrome.ts`: fill `#005CCC`, `min-h-11`, white label. Focus ring `#0096FF`. Compose taller hits with `btnPrimaryFill` (sticky Save). `settingsPrimaryButtonClass` aliases `btnPrimary`. Action dock: `deskHitClass` + `btnDock` (`h-12 w-12`). |
| Ghost / secondary | `btnGhost`: border-line, ink text |
| Focus | `focusRing`: `focus:outline-none focus:ring-2 focus:ring-[#0096FF]` |
| Filter tabs | `FilterTabs` + `filterTabClass`. Underline, `min-h-11`, active `border-[#0096FF] text-[#005CCC]`. Inbox List/Work, Today/Week, and Contacts sort (Last call · Name) share this. Contacts segments All · Saved · Unsaved use `InboxFilterPills` (filled active pill, same DESIGN as Inbox purpose). Inbox purpose piles (Needs you / Visits / Holds / …) stay Inbox-only nouns. |
| Person-file KPI | `ContactKpiStrip` on `/contacts/[id]`. Flex row. Cards only when sourced. Interactions = ticket/call rows. Visits done = jobs `done`. Customer since = `N mo` from earliest stamp. Hide when unknown or 0. No wallpaper, Online, or mock counts. |
| List row | `DeskRowHit` in `deskRowHit.tsx`. Parent `relative`. Body `deskRowMutedClass`. Trailing verb `deskRowActionClass`. No Call, Open, or View column. Anatomy: `RowIdentity` circle (neutral, initials or person glyph, never tinted by state), identity plus **one** preview line (`deskPreviewClass` / `truncate`), timestamp right. Needs you rows may add one muted next-step line (`inboxNeedsYouNextStep`) under the preview. Same recipe as the Action dock. Unread (customer event after last open) is `RowStateDot` (brand blue, sits with the timestamp; `LivePing` when the row is live and unread) plus `deskRowWeightClass` (semibold while unread, medium once opened). Needs you is a pile and nav badge, not the dot. A row that appears while watching uses `DeskLandSurface`. No opacity dimming. Full hangup copy is on the call, not in the list. |
| Preview truncate | `deskPreviewClass` (`min-w-0 truncate`) on list copy. Table cells that hold that copy use `deskPreviewCellClass` (`w-full max-w-0`) so the column takes leftover width and the ellipsis can fire. Never `overflow-wrap: anywhere` on a preview. Home queue units stay count nouns. A single short slot (`Tue 14:00`) may replace the unit. A hangup sentence may not. |
| Pagination | `ui/Pagination.tsx` (`min-h-11` hits) |
| Field | `deskFieldClass`. Settings: `settingsFieldClass` = `mt-1` + `deskFieldClass` |
| Sticky save | `settingsStickyHeaderClass` under `--desk-header-h`. Profile is an inner rail (`lg:w-[13.5rem]`) plus a fluid panel. |
| Dialog | `DeskDialog`: overlay, Escape, focus restore. No enter animation. |
| Desk hint | `DeskHint`. Navy name chip on hover, pointer, and keyboard focus for icon-only hits. Portaled. Escape and scroll dismiss. The control keeps `aria-label`. |
| Desk rail | `DeskRail` in `DeskNav.tsx`. `md+` only. `w-[4.5rem]`. Same `DESK_LINKS` as the phone tabs (Overview, Inbox, Contacts, Usage, Profile). Icon-only 44px hits, `DeskHint` names. Needs you badge on Inbox. Mark-only Scalers at the top. Sign out lives on Profile, not at the rail foot. |
| Desk tab bar | `DeskTabBar` in `DeskNav.tsx`. Same `DESK_LINKS` as the `md+` icon rail. Fixed, `md:hidden`, icon + label, `min-h-12`, `aria-current`. Stays on nested contact screens. Hidden on phone ticket chat (`/calls/[id]`, `data-ticket-chat`). `DeskBack` remains the escape. Sign out lives on Profile. Inbox Needs you count is a 16px corner overlay on the Inbox icon (`deskNavBadgeClass`: `-top-1 -end-1`, `h-4 min-w-4`). Ribbon gradient `from-accent to-accent-fill` (`#0096FF` → `#005CCC`), `text-accent-on-fill`. `1`–`9`, then `9+`. Hidden at 0. `aria-label` includes the count (`Inbox, 3 need you`). Not a second control. |
| Empty state | `deskEmptyClass`. Title + one link. No marketing paragraph |
| Owner error | `DeskError` + `ownerFacingError`. Never SQL files, RLS dumps, or repo paths. Log raw diagnostics with `logDeskError`. |
| Crash | `DeskCrash` + Try again. `(desk)/error.tsx`, `app/error.tsx`, `global-error.tsx`. Never dump `error.message`. |
| 404 | `app/not-found.tsx`. Overview is the recovery link. |
| WhatsApp | Brand-blue fill + white glyph when it is the page CTA (`variant="primary"`). List trailing icon: green glyph on `#25D366`, `h-12 w-12`, `rounded-xl` (`variant="icon"`). No extra WhatsApp mark next to the name. |
| Inbox Action dock | Trailing cell only. Requested visit: Confirm. Confirmed visit: Done. Open hold: Done. Return or intent-only with a number: Call then WhatsApp. Intent-only never Confirm or Done. Every control is `h-12 w-12`. Icon-only Call, WhatsApp, and More show `DeskHint`. Never Open, View, SMS, email, or Archive in this cell. |
| Contact strip | `ContactStrip` on `/calls/[id]` header. Same family as the Contacts Phase 1 list row: `RowIdentity`, name or Unsaved / Name this caller, one `contactListSubline` (`deskPreviewClass`). Allowed facts: Unsaved, phone, last call, call/WA opened stamp. Call + WhatsApp when a number exists (`deskHitClass`, `tel:` / `wa.me`, `data-contact-strip-reach="opened"`). No `callId` write-back. No `lead_status` or Needs you invent. No Meta theater. Tap identity opens `/contacts/[id]`. Same row at every width. Never Online, last seen, presence, sent, or delivered. |
| Ticket Action dock | Full-width row under the split on `/calls/[id]`. Mark done, Call, WhatsApp, Ping teammate. Same `deskHitClass` hits plus a visible label. Not in More. Confirm and hold Done stay on their banners. |
| Ticket thread | One conversation stream on `/calls/[id]`. Alignment is who. Stamp once per Nairobi minute. Keep Critic-true delivery/escalation facts. Drop lifecycle pills and per-bubble speaker labels. FAQ ideas is muted text, not a chip. Contact strip stays #383. |
| Inbox overflow | md+ More and right-click. Pin / Unpin, Mark done on return calls, Archive or Unarchive. No Select (checkboxes stay visible). Phone hides More (`hidden md:inline-flex`). Long-press enters the header select bar. Mute, Assign, Label, Delete, Mark unread, and Snooze stay off this list. Archive opens from a list row, not a filter chip. Desktop menu right-aligns to More (`placeInboxOverflowMenu`) so it does not cover the dock. Ticket ⋮ is Archive or Unarchive only, portaled to `document.body`, 44px rows, same placer. |
| Inbox archived | WhatsApp folder. `InboxArchivedPhoneRow` / `InboxArchivedTableRow` at the top of the list when the count is above zero. Glyph plus Archived plus count. Tap opens `/calls?purpose=archived`. Not in `purposeFilters`. After Archive, `InboxArchiveToast` offers Undo for 5s. No toast on Unarchive. |
| Call | `CallLink` (`tel:` deep link, the device dialer places the call). List dock only. Rounded handset glyph (`data-icon="handset"`), brand `text-accent-deep`, muted tile `h-12 w-12` bordered with a light accent wash. Sits left of WhatsApp. `DeskHint` label Call. Never a filled primary, never a desk-telephone silhouette. |
| Ticket split | `InboxTicketView` from `lg`. Summary `18rem` floor, `22rem` default, `32rem` cap. Drag or arrow keys. 1px gutter, 24px hit. Reclamps on resize. Stored in `localStorage["scalers-ticket-split"]`. Double-click resets. Phone and `md` keep one stacked scroller. |
| Line chip | Live / Pending / Needs training. Never “Online” |

---

## States

| State | Treatment |
| --- | --- |
| Loading | `(desk)/loading.tsx`: `pendingSpinnerInkClass` only. No skeletons, no invented numbers |
| Empty | `deskEmptyClass`. Title + one link. No workspace: `DeskNoWorkspace` |
| Error | `DeskError`: `border-warn/40 bg-warn-soft text-warn`, `role="alert"`. Home inbox load failure uses this, not a zero queue. Call/contact query failure uses this, not 404. Holds or visits failing while calls load: same banner, lists stay. |
| Crash | `DeskCrash`. Try again. Never a stack trace |
| Offline | `DeskOffline` under the desk header. `No connection.` Hidden when online. |
| Pending mutation | `pendingSpinnerClass` on the control. Disable double submit |
| Live | `LivePing` on a Live stamp and the Home bulletin. One ping per region |
| Land | `DeskLandScope` + `DeskLandSurface`. First paint never lands. Filter/page swaps do not flash |
| Shift | `deskShiftClass`. Color, fill, border, shadow, opacity, transform, filter. 150ms. Not layout |
| Focus | 2px brand ring, visible on keyboard |
| Reduced motion | Kills live ping, land wash, landing rise/drift, pending spinner, shift, and notice enter/exit. Press scale is `motion-reduce:active:scale-100`. Global duration fallback in `globals.css`. |

---

## Motion

Five desk verbs. Skill: `.cursor/skills/desk-motion/SKILL.md`. Tokens: `--motion-fast` 150ms, `--motion-land` 900ms, `--motion-live` 1.4s, `--motion-ease`. Class names and `DESK_*_MS` live in `dashboard/src/lib/deskMotion.ts`. No Framer Motion, `motion/react`, springs, or ad-hoc durations.

| Verb | Primitive | Loop? |
| --- | --- | --- |
| **pending** | `pendingSpinnerClass` | Yes, on the control, `motion-reduce:animate-none` |
| **live** | `LivePing` (`.desk-live-ping`) | Yes. Live call stamp and Home bulletin only |
| **land** | `DeskLandScope` + `DeskLandSurface` (`.desk-just-landed`) | No. One-shot wash after first paint |
| **shift** | `deskShiftClass` (`.desk-shift`). Notice enter/exit: `DeskNotice` (`.desk-notice`) | No. Named properties, `--motion-fast` |
| **press** | `btnPrimary` `active:scale-[0.99]` | No |

Map a surface to a type, then to a verb. Do not invent a per-page animation.

| Type | Surfaces | Motion |
| --- | --- | --- |
| Shell | `DeskRail`, phone header, tab bar | None. Rail width is static `4.5rem`. Do not animate `h-dvh` or scroll containers. |
| List | Inbox queue, Contacts, wallet ledger | `land` on a live insert after first paint. Row hover/selected: `shift`. Stable keys (`item.id`). No enter-stagger. No layout reorder. |
| Detail | Ticket transcript, contact profile, action dock | Instant swap. Key the route by record id. Panel chrome does not slide. |
| Notice | Archive undo, Saved | `DeskNotice` + `useNotify`. Enter `translateY(12px)`, exit `translateY(8px)`, opacity. Transform only. `role="status"`. One pattern. |
| Modal | `DeskDialog`, overflow menu, `DeskHint` | Enter-static. No scale, no overlay fade. |
| State | Filter tabs, badges, chips | `shift` / `filterTabClass`. No `layoutId`. |
| Empty / loading | `deskEmptyClass`, `(desk)/loading.tsx` | Empty is static. Route pending is the ink spinner. No skeleton pulse. No `animate-pulse` except the pronunciation recording dot. |
| Numbers | Wallet balance, Home counts, call duration | Instant `tabular-nums`. No count-up. |
| Form | Fields, field errors | Focus/border: `shift`. Errors mount instantly next to the field. No shake. |
| Route | Overview, Inbox, Contacts, Usage, Profile | Instant. The new page's lists land on later inserts only. |

Landing marketing only: `.landing-rise`, `.landing-drift`. Desk never uses those classes. `DeskDialog` does not animate in. Catalog: `/dev/motion` when `DASHBOARD_OPEN`. Reduced motion: named kills plus a global `animation-duration` / `transition-duration` fallback.

---

## Do not add

shadcn, Radix, icon packs, Plus Jakarta, orange CTA, glass panels, purple mesh, a second nav tree, a hamburger drawer for primary destinations, fake Online, Lottie, Framer Motion, the `motion` package, GSAP, landing-rise on desk.
