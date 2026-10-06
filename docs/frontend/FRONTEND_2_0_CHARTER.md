# Scalers Frontend 2.0 Charter

**Status:** Authoritative. Supersedes the phase table in `FRONTEND_CONSTITUTION.md` §10 and the "no UI until constitution" gate in `FRONTEND_RECONNAISSANCE.md`.
**Scope:** Every screen a human sees: marketing, auth, onboarding, owner desk, Super Admin.
**Owner:** Frontend 2.0 program (Desk lane, expanded to admin presentation).
**Date:** 2026-09-30
**Decision authority:** Alvin gave full makeup access on 2026-09-30. This charter is that access written down.

---

## 0. Why this exists

Batches A through D patched a frontend whose foundation was never designed. Every patch added another exception: another radius, another chip color, another 48px box, another class string. The result reads as generated, not built. The honest audit is in §2. The fix is not another batch. It is a foundation, a component kit, one shell, and a rebuild of each surface on top of it, in an order that keeps production working the whole way.

The bar is not "better than before." The bar is: an owner in Nairobi opens this at 08:00 on a mid-range Android and it feels as obvious and as fast as WhatsApp, Instagram, or Truecaller. Nothing to learn. Nothing to forgive.

---

## 1. The bar, measured

"Facebook quality" is not a mood. It is a list of things those apps do that we do not. Each item below is a pass/fail check at the end of the program.

| Dimension | What Meta-grade apps do | Pass condition for Scalers |
| --- | --- | --- |
| Identity | One typeface family, weight carries hierarchy, the brand lives in the mark and the color, not in a display font | App uses the system UI stack. One accent. Mark appears once per screen, in the shell. No wordmark inside pages. |
| Type scale | 5 or 6 sizes total, every size has a reason | Exactly: 11 (caption), 13 (meta), 15 (body), 17 (title), 22 (page), 28 (display, marketing only). Tabular numerals on every number. |
| Color | One accent, neutral surfaces, status is a dot or a weight change, never a rainbow of chips | At most 3 semantic colors in a viewport (attention, ok, neutral). Zero hex literals in `.tsx`. |
| Surfaces | Lists are one surface with hairlines. Cards exist only where elevation means something | No `border + shadow + white` wrapper around list rows. Sheets and menus get shadow. Nothing else does. |
| Shape | 3 radii, used by role | 6px (chips, inline fields), 10px (controls), 16px (sheets, dialogs), full (avatars, dots). Nothing else. |
| Actions | Row actions are compact icon circles; the one primary action per screen is a filled bar | Call and WhatsApp are 44px circular tonal hits. Confirm and Done are labeled tonal buttons. One filled `#005CCC` per viewport. |
| Navigation | Phone: bottom tabs, filled icon when active. Desktop: rail or top bar. Same list everywhere | One `AppShell` for desk and admin. Tabs below `md`, rail on `md+`. Active icon is the solid variant. |
| Lists | Name, one preview line, timestamp, one glance state | One `ListRow` recipe shared by Inbox, Contacts, Admin lists. Tables only for numeric admin data. |
| Speed | Under 2.5s LCP on a mid-range Android over fast 3G. No font flash | System font (zero font bytes in app). Per-route client JS under 150KB gz. Skeleton for every async region. |
| States | Loading, empty, error, offline, and permission states are designed, not defaulted | Every route has `loading.tsx` with a shaped skeleton, an empty state that names the next action, and an inline error with retry. |
| Motion | Under 300ms, ease-out, only where it explains a change | Existing five verbs stay (pending, live, land, shift, press). Easing `cubic-bezier(0.23, 1, 0.32, 1)`. Nothing animates on keyboard actions. |
| Accessibility | Focus rings, 44px hits, names on icon buttons, dialogs trap focus, menus arrow-navigate | Behavior primitives come from Base UI. Axe passes on the eight core routes. |
| Dark mode | Full parity, not a color swap on half the app | Every primitive reads tokens. Admin and auth get dark too. |
| Proof | Nothing ships on a description | Playwright visual gate at 360, 390, 768, 1280 for the eight core routes, run in CI against `/dev/*` fixtures. |

---

## 2. Honest audit (evidence: headless Chrome at 390 and 1280, 2026-09-30)

What the screenshots show, in order of damage:

1. **No type system.** 357 uses of `text-sm`, 256 of `text-xs`, then a cliff to `text-2xl`. Everything between 14px and 24px is missing, so pages have a giant title and a wall of 13px. Two Google fonts (DM Sans, Sora) load on every route for a console that should feel native.
2. **Chip rainbow.** Inbox rows carry Live (blue), Human asked (orange), Confirm visit (blue outline), Visit not booked (blue), Hold not saved (green), Hold (green). Six outlined pills in one column. The eye has nothing to rank.
3. **Two visual grammars for one action row.** A blue outlined phone square next to a solid green WhatsApp square next to a solid blue "Confirm" square with 11px text that clips at 390. Three styles, one job.
4. **Border plus shadow plus white on everything.** 38 instances of `rounded-2xl border border-line bg-surface`. The Home "Work" block is three empty white rows with no counts. Appearance is three giant radio cards.
5. **Radius roulette.** `rounded-xl` 97, `rounded-2xl` 67, `rounded-lg` 46, `rounded-full` 38, `rounded-md` 11, plus `rounded-panel`. Six radii with no role.
6. **Gradient wash on the body.** Two radial gradients painted behind every page. This is the single most recognizable generated-UI tell and it costs paint on low-end GPUs.
7. **Page titles jammed into the corner.** "Inbox" at 30px with zero top padding, then a search field, then pills, then a table with checkboxes nobody uses.
8. **Product wordmark inside pages.** Overview stacks the Scalers lockup, a date, then the work. The rail already has the mark. The page should open on the work.
9. **Two products in one repo.** Admin is a navy sidebar with white text and a completely different rhythm from the desk. Same company, different app.
10. **Hand-rolled behavior.** Dialogs, menus, and tooltips are custom (`InboxRowOverflow` is 416 lines). Focus management, escape handling, and arrow keys are inconsistent by construction.
11. **Class-string design system.** `deskChrome.ts` exports 20 strings that components concatenate. No component boundary means no place to fix a button once.
12. **Monoliths.** `TenantForm.tsx` 2264 lines, `PronunciationCoach.tsx` 1413, `InboxTicketView.tsx` 735. 84 files are `"use client"`. Hydration cost is paid on pages that are mostly static.
13. **33 hex literals** in components despite a token layer. The tokens exist; nothing enforces them.
14. **Proof by node test on class strings.** 16 `desk*.test.js` files assert that a string contains `h-12 w-12`. None open a browser. That is how a clipped "Confirm" shipped.

What is sound and stays: the route map (`/home`, `/calls`, `/contacts`, `/wallet`, `/settings`, `/admin/*`), Auth and RLS boundaries, the owner versus admin shell split, the safe-area and tab-bar clearance math, `DeskLoadError` and `DeskCrash` recovery, the desk motion verbs, the copy voice (short, verb-first, no dashes), and the brand palette (`#0096FF` mark, `#005CCC` action, `#0A192F` ink).

---

## 3. Rules torn off, and why

Each rule below is removed or replaced on merge of this charter. The always-on rule file `.cursor/rules/scalers-design-ux.mdc` is rewritten to match.

| Old rule | Verdict | Replacement |
| --- | --- | --- |
| Two typefaces (DM Sans body, Sora display) in the app | Removed | System UI stack in the app (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`). Sora stays for marketing display only. Kenyan Android renders Roboto, the same face WhatsApp shows. Zero font bytes on the desk. |
| Hardcode every `textarea` to `rows={2}` | Relaxed | `Textarea` primitive starts at two rows and auto-grows (`field-sizing: content`, capped at half the viewport). A field may pass a larger `rows` when a paste box is the point. |
| Global Save sticky top right | Replaced | Save docks to the form. Phone: sticky footer above the tab bar. Desktop: end of the section it saves. Top-right sticky fights the thumb zone. |
| `deskHitClass` 48×48 box for Confirm, Done, Call, WhatsApp; "label length does not change the hit" | Replaced | Call and WhatsApp: 44px circular tonal `IconButton`. Confirm and Done: labeled tonal `Button` size `sm` (36px tall, 44px hit via padding). A word in an 11px 48px square clips. |
| Dense tables over cards for every list; `md+` uses the table | Refined | One `ListRow` recipe at every width for Inbox, Contacts, and admin entity lists (name, one preview line, when, one glance state, compact actions). Tables only for numeric data (wallet ledger, DID pool, packages). No checkboxes unless bulk actions exist on that screen. |
| Overview opens with `BrandLockup` over `h1` over date | Removed | Pages open on the work. The mark lives in the shell once. |
| Filter chips as filled pills with counts (`deskRateCardClass`) | Replaced | `Segmented` control (underline tabs, count as muted numeral). Instagram, Mail, and WhatsApp all use underline tabs. |
| Appearance as three large cards | Replaced | `Segmented` inside the account menu. Instant apply. |
| Radial gradient washes on `body` and dark desk | Removed | Flat canvas. `#F4F7FB` light, `#0B1220` dark. |
| Class-string exports as the design system | Replaced | Components in `dashboard/src/components/ui/`. The strings stay exported from the same files during migration and are deleted when the last caller is gone. |
| Hand-rolled dialog, menu, tooltip, select | Replaced | Base UI (`@base-ui/react`) for behavior, Tailwind for looks. |
| Inline SVG icons per component | Replaced | Heroicons (`@heroicons/react`), outline 24 for nav and rows, solid 24 for the active tab, mini 20 for inline. One stroke weight. |
| "Desk lane leaves `Admin*` panels to Ops unless pure styling" | Replaced | Frontend 2.0 owns admin presentation. Ops still owns behavior, RPC calls, and wallet logic. Same shell, same kit. |
| "Do not install impeccable, Anthropic frontend-design, shadcn" (`.cursor/skills/README.md`) | Removed | Installed 2026-09-30. See §7. |
| Phase table in `FRONTEND_CONSTITUTION.md` §10; "no UI until constitution" | Superseded | §6 of this charter. |
| Proof by class-string node tests | Demoted | Kept as unit guards. The gate is Playwright visual and axe at four widths. |

Rules that stay, restated once:

- Copy: verbs and nouns the owner already knows. No filler. No em or en dashes in UI strings. Sentence case.
- Color: `#005CCC` is the only filled action color. `#0096FF` is the mark, the focus ring, and the active indicator. Never `#0096FF` for text.
- Hits: 44px floor on every control. Icon-only controls carry a visible name on hover and focus.
- Nav: one link list per shell. Tabs below `md`, rail on `md+`. Nested screens hide tabs and lead with Back.
- Layout: one composition per dataset that reflows. Split pane from `lg`. `min-w-0` on text columns.
- Motion: pending, live, land, shift, press. Under 300ms. Reduced motion respected.
- Auth: Supabase SSR and RLS for owners. Service role never reaches the browser. Owner and admin shells never merge navigation.

---

## 4. Foundation (Phase 1 deliverable)

### 4.1 Tokens (`globals.css`, consumed by `tailwind.config.ts`)

Semantic roles only. Raw values appear once, in `:root` and `[data-theme="dark"]`.

```
Color roles
  --canvas          page background            #F4F7FB   dark #0B1220
  --surface         rows, sheets, fields       #FFFFFF   dark #121C2C
  --surface-2       pressed, hover, tonal bg   #E9EEF5   dark #1A2638
  --hairline        1px separators             #DDE4EE   dark #24324A
  --ink             primary text               #0A192F   dark #E9EFF7
  --ink-2           secondary text             #4A5B73   dark #9DAFC6
  --ink-3           timestamps, placeholder    #5B6D85   dark #8496B0   (4.5:1 on every surface)
  --accent          filled action, links       #005CCC   dark #3D9BFF
  --accent-tonal    tonal button bg            #E3EEFF   dark #12294A
  --accent-on       label on accent            #FFFFFF   dark #071426
  --brand           mark, focus ring, active   #0096FF   dark #2AA8FF
  --attention       needs the owner            #C2410C   dark #F4955A
  --attention-tonal                            #FDF0E8   dark #2B1A12
  --ok              done, live                 #15803D   dark #4ADE80
  --ok-tonal                                   #E8F5EE   dark #122A1C
  --whatsapp        glyph only                 #25D366
Radius     rounded-md 6px (chips, tooltip)  rounded-xl 10px (controls, fields, menus)  rounded-2xl 16px (sheets, cards)
           Legacy rounded-sm/lg/3xl/panel collapse onto those three in tailwind.config.ts; no page edits needed.
Elevation  --shadow-sheet 0 12px 32px -12px rgb(10 25 47 / .28)
           --shadow-menu  0 8px 24px -8px rgb(10 25 47 / .24)
Type       --t-caption 11/14  --t-meta 13/18  --t-body 15/22  --t-title 17/24  --t-page 22/28  --t-display 28/32
Z          --z-sticky 10  --z-tabbar 20  --z-sheet 30  --z-menu 40  --z-toast 50
Motion     --ease-out cubic-bezier(0.23, 1, 0.32, 1)  --fast 150ms  --sheet 240ms
```

Tailwind maps these to `bg-canvas`, `bg-surface`, `text-ink-2`, `rounded-xl`, `text-body`, `shadow-sheet`, `z-menu`. Every colour token goes through `color-mix()` so opacity modifiers (`bg-ink/40`, `ring-brand/40`) work in both themes. ESLint warns on `#[0-9a-f]{3,8}` in `className`, `text-[Npx]`, and `rounded-3xl` in `.tsx` (Phase 1: warn; Phase 8: error).

### 4.2 Primitives (`dashboard/src/components/ui/`)

Each is one file, one component, tokens only, dark-safe, keyboard-safe. Behavior from Base UI where the browser does not provide it.

| Primitive | Role | Replaces |
| --- | --- | --- |
| `Button` | `variant: primary | tonal | ghost | danger`, `size: sm | md | lg`, `pending` | `btnPrimary`, `btnGhost`, `btnDone`, `btnDock*` |
| `IconButton` | 44px circle, `tone: neutral | accent | whatsapp | ok`, required `label` | phone and WhatsApp squares, overflow triggers |
| `Field`, `Input`, `Textarea`, `Select` | label, hint, error, auto-grow textarea | `deskFieldClass`, `settingsUi` field wrappers |
| `Segmented` | underline tabs with counts, scrollable on phone, `aria-selected` | `deskRateCardClass`, `FilterTabs`, `ThemePicker` cards |
| `Stamp` | glance state: dot plus text, `tone: attention | ok | neutral` | six colored chips |
| `Avatar` | initials or image, 32/40/48, circle | `InboxRowAvatar`, contact circles |
| `ListRow` | avatar, title, one preview line, when, stamp, trailing actions; link or button | `InboxItemRow`, `ContactListRow`, `deskRow*` |
| `PageHeader` | title, optional back, optional trailing action, consistent top rhythm | ad hoc `h1` blocks, `DeskIndexLead`, `DeskRecordLead` |
| `Sheet` | bottom drawer at every width, width-capped from `sm`; swipe down to dismiss; Base UI Drawer | `DeskDialog` |
| `Menu` | Base UI Menu, origin-aware scale, arrow keys | `InboxRowOverflow` menus, `DeskAccountMenu` |
| `Tooltip` | Base UI Tooltip, instant after first | `DeskHint` |
| `Toast` | keep `DeskNotice` API, restyle on tokens | same |
| `Empty` | icon, one line, one action | `deskEmptyClass` blocks |
| `Skeleton` | shaped placeholders for row, header, table | none today |
| `Table` | numeric admin data only, sticky head, tabular numerals | `DeskDataTable` |

### 4.3 Shell

One `AppShell` in `src/components/shell/`:

- Props: `links` (icon outline, icon solid, label, href, badge), `account` slot, `children`.
- Below `md`: fixed bottom tabs, solid icon when active, badge as a 16px dot with numeral, safe-area padding. Hidden on nested routes (existing `data-desk-nested` and `data-ticket-chat` contract stays).
- `md+`: 72px icon rail, tooltip names, account at the foot.
- Desk uses `DESK_LINKS`. Admin uses `ADMIN_LINKS` (Overview, Businesses, Wallets, Numbers, Packages, Voices). Admin on phone uses the same tabs with the last two under More.
- Light and dark for both shells. Admin loses the navy sidebar.

### 4.4 Dependencies added

`@base-ui/react`, `@heroicons/react`, `@playwright/test` and `@axe-core/playwright` (dev). Nothing else. No Framer Motion, no Radix, no shadcn runtime (the shadcn skill is used for patterns, not packages). Tailwind stays on 3.4 for this program; the token layer is CSS variables so a v4 move later is mechanical.

---

## 5. Architecture rules for every rebuilt surface

1. **Server first.** A route is a server component that loads data and renders `ListRow`s. Only the interactive leaf is `"use client"`. Target: `"use client"` file count under 40 when the program ends.
2. **One data load per route.** Parallel fetches with `Promise.all`. No fetch inside a row.
3. **Streaming with shape.** Every route ships `loading.tsx` built from `Skeleton` in the exact shape of the loaded view. No spinners on route load.
4. **Errors stay inline.** `error.tsx` per segment renders `DeskCrash`. Data failures render `DeskLoadError` in place. Never a blank page.
5. **Forms post to server actions** with `useActionState`, pending on the button, error under the field.
6. **No monolith over 400 lines.** `TenantForm` becomes one panel component per settings section. `PronunciationCoach` and `InboxTicketView` split by responsibility.
7. **Tokens or nothing.** ESLint enforces no hex, no arbitrary radius, no arbitrary `text-[Npx]`.
8. **Every screen at four widths.** 360, 390, 768, 1280 in Playwright, light and dark, before a PR is marked ready. `dashboard/e2e/structure.spec.ts` checks no horizontal overflow, no control under 24px (under 44px attached as a warning), and zero serious or critical axe violations, then attaches a full-page screenshot per route and width. Routes in its `strict` list fail the run; legacy routes report findings as `debt` annotations until their phase lands, then move to `strict`. Run `npm run test:e2e` (starts its own server on 3077) or `E2E_BASE_URL=http://localhost:3020 npm run test:e2e` against a running dev server with `DASHBOARD_OPEN=true`.

---

## 6. Build order

Each phase is one PR off `main`, staged, re-accepted, merged. Production keeps working after every merge because old surfaces keep their old classes until their phase replaces them.

| Phase | PR | Ships | Done when |
| --- | --- | --- | --- |
| 0 | Charter | This file, rewritten always-on rule, skills installed, lane contract updated | Merged |
| 1 | Foundation | Tokens, system font, flat canvas, Heroicons, Base UI, all primitives in §4.2, ESLint bans, Playwright gate wired to `/dev/*` fixtures with `DASHBOARD_OPEN=true` | Primitives render in a `/dev/kit` page at four widths, light and dark. Existing pages unchanged. |
| 2 | Shell | `AppShell` for desk and admin, account menu on `Menu`, Appearance as `Segmented`, admin recolored | Both shells pass the visual gate. No navy sidebar. |
| 3 | Inbox | `/calls` on `ListRow`, `Segmented` filters, `Stamp` states, `IconButton` actions, ticket view split into header, thread, dock, composer | Six chip colors become three tones. Nothing clips at 360. |
| 4 | Home and Contacts | `/home` opens on work with counts, `/contacts` list and file on `ListRow` and `PageHeader` | No wordmark in page. Every Home row has a count and a destination. |
| 5 | Settings | `TenantForm` split into panels, `Field` primitives, docked Save, sidebar with non-clickable headers | Largest settings file under 400 lines. |
| 6 | Admin | Businesses, Wallets, Numbers, Packages, Voices on `Table` and `ListRow` inside `AppShell` | Admin passes the gate in light and dark. |
| 7 | Entry | Login, signup, onboarding, landing on tokens; landing keeps Sora and its motion | Entry routes pass the gate. |
| 8 | Hardening | Skeleton per route, axe on eight routes, bundle budget check, delete dead class strings and old components | Budget met. Zero exports left in `deskChrome.ts`. |

---

## 7. Skills installed for this program (2026-09-30)

Canonical copies in `.agents/skills/`, linked into `.cursor/skills/`, pinned in `skills-lock.json`.

| Skill | Use it when |
| --- | --- |
| `frontend-design` (Anthropic) | Starting a surface. Plan tokens and layout before code. Self-critique against the generated-UI tells list. |
| `redesign-existing-projects`, `design-taste-frontend`, `high-end-visual-design`, `minimalist-ui` (leonxlnx) | Auditing an existing surface. The audit checklist in §2 came from these. |
| `emil-design-eng`, `review-animations` (Emil Kowalski) | Any motion, press state, sheet, or menu. Easing and duration rules. |
| `impeccable` (pbakaus) | Polish pass on a finished surface. |
| `accessibility` (Addy Osmani) | Before marking a phase ready. |
| `shadcn` | Component API shape and composition patterns. Patterns only; no runtime install. |
| Already present: `web-design-guidelines`, `vercel-react-best-practices`, `next-best-practices`, `desk-motion`, `no-ai-slop`, `reticle`, `fixing-accessibility`, `baseline-ui`, `improve-ui` | As before. `desk-motion` still wins on motion vocabulary. |
| `ui-taste`, `ios-design` ([uizze.sh](https://uizze.sh/)) | Hierarchy and iPhone navigation reference while polishing a screen. Tokens, `Sheet`, and `desk-motion` still win. |

---

## 8. Definition of done for the program

- Every row in §1 passes.
- `deskChrome.ts` is deleted.
- `.cursor/rules/scalers-design-ux.mdc` is under 40 lines and describes the kit, not exceptions.
- A new engineer can build a new screen from `PageHeader`, `ListRow`, `Segmented`, `Button`, `Sheet`, and `Empty` without reading a rule file.
