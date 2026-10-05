---
name: UI UX Pro Max (Scalers)
description: >-
  Use when designing, building, or reviewing Scalers Desk or Super Admin UI —
  layout, components, tokens, accessibility, density, tables, forms,
  Next/Tailwind/shadcn — subordinate to Frontend 2.0, MASTER tokens, and
  desk-motion.
---
# UI UX Pro Max (Scalers)

Distilled UI/UX checklist for **Scalers owner Desk** and **Super Admin**. Upstream inspiration: nextlevelbuilder `ui-ux-pro-max`. This skill does **not** invent a parallel design system — Scalers already has one.

## Authority order (always)

1. `docs/frontend/FRONTEND_2_0_CHARTER.md` (and constitution where still referenced)
2. MASTER / design tokens in `dashboard` (CSS variables — **no raw hex in components**)
3. `.cursor/skills/desk-motion/SKILL.md` — motion verbs only: **pending / live / land / shift / press**
4. Desk kit: `dashboard/src/components/ui/**`, shell, ListRow, Segmented, IconButton, Empty, DeskNotice
5. This skill (tips only; never overrides 1–4)

**Forbidden on Desk/Admin:** Framer Motion, Remotion, GSAP, Lottie, ad-hoc spring libraries, marketing scroll choreography.

**Copy:** Say **Business** not Tenant in Admin UI. Zero fluff; no em/en dashes in UI text. Dense operational tables are OK on Admin.

Also load [Desk lane](sand-workflow:desk-lane) and [Admin end-to-end polish](sand-workflow:admin-end-to-end-polish) when the work is Admin.

## When to apply

Use for: new Desk/Admin pages, refactoring shared components, spacing/typography/contrast reviews, form and table UX, responsive shell work, a11y passes, chart readability.

Skip for: Voice/Brain logic, SQL/RPC contracts, package ledger math, non-visual infra.

## Stack (fixed)

| Layer | Choice |
| --- | --- |
| App | Next.js (`dashboard/`) on Vercel |
| Style | Tailwind + Scalers tokens |
| Primitives | shadcn-style `components/ui` — extend kit, don’t fork |
| Shell | `AppShell`; owners `(desk)` + `DESK_LINKS`; ops `/admin/*` + `ADMIN_LINKS` — never merge |

Do not recommend Vue/Svelte/Flutter/SwiftUI/Three.js/GSAP stacks for Desk work.

## Priority rules (1 → 10)

| P | Category | Must | Avoid |
| --- | --- | --- | --- |
| 1 | Accessibility | Contrast ≥ 4.5:1; focus rings kept; labels / aria on IconButton; keyboard nav | Removing focus; icon-only without accessible name |
| 2 | Interaction | 44×44 touch targets where phone UI; loading feedback via **pending**; notices via `DeskNotice` | Hover-only affordances; 0ms silent state flips |
| 3 | Performance | Lazy heavy panes; reserve space (CLS); virtualize long lists | Layout thrash; animating width/height |
| 4 | Visual system | MASTER tokens; kit components; SVG/Lucide icons | Hex in JSX; emoji-as-icon; mixing marketing chrome into Admin |
| 5 | Layout | One composition phone→desktop; split panes from `lg`; Playwright 360/390/768/1280 | Horizontal scroll; fixed-px shells; controls that resize by label length |
| 6 | Type and color | Tokenized type scale; semantic colors; primary CTA and ribbon via tokens only | Body text under 12px; gray-on-gray; inventing palettes |
| 7 | Motion | desk-motion only (pending/live/land/shift/press); overlays are the `Sheet` bottom drawer; respect `prefers-reduced-motion` | GSAP/Framer/Lottie/Remotion; scroll-pin theater; a centered dialog |
| 8 | Forms | Visible labels; inline errors; docked Save patterns | Placeholder-as-label; errors only at page top |
| 9 | Navigation | Predictable back; shell split preserved; deep links to desk routes | Merging owner + admin nav/sessions |
| 10 | Charts and tables | Dense tables OK; legends/tooltips; not color-alone | Marketing dashboard fluff on Admin; decorative chart junk |

## Workflow (Scalers)

### 1. Frame the surface

- Owner Desk vs Super Admin? (shell + link list)
- Primary job: scan table, act on row, configure, approve-first send?
- Density: Admin → dense; marketing landing → brand-first (not this skill’s main focus)

### 2. Read existing law before inventing

1. Frontend 2.0 charter + `.cursor/rules/scalers-design-ux.mdc`
2. Existing page in `(desk)` or `admin` closest to the task
3. `components/ui` primitives already used nearby
4. desk-motion skill for any feedback motion

Do **not** create a competing design-system MASTER. Scalers MASTER tokens win.

### 3. Build from kit

- Prefer `ListRow`, `Segmented`, `IconButton`, shaped skeletons, `Empty` with next action
- Tables: operational density, sticky headers if long, clear primary action per row
- Admin labels: **Businesses**, packages, numbers, voices — never “Tenants” in UI copy

### 4. Next / Tailwind / shadcn tips

- Server Components by default; client only for interactivity
- Compose variants with existing ui patterns; don’t add a second component library
- Use semantic token classes over arbitrary values
- Suspense + skeletons for async panes; avoid layout jump
- Forms: controlled fields with visible labels; disable submit while **pending**

### 5. Motion (desk-motion only)

| Verb | Use |
| --- | --- |
| pending | In-flight save/fetch |
| live | Subtle “this is updating” presence |
| land | Arrival of new content/notice |
| shift | Layout reflow between related states |
| press | Pressable feedback on controls |

No page-load hero animations. No GSAP presets. No Lottie loaders.

### 6. Pre-delivery checklist

- [ ] Tokens only (no new hex)
- [ ] Kit-first; no one-off styling that fights AppShell
- [ ] Shell split intact (owner vs admin)
- [ ] Admin says Business not Tenant
- [ ] Motion only pending/live/land/shift/press
- [ ] No Framer / Remotion / GSAP / Lottie
- [ ] Focus rings + keyboard path work
- [ ] Dense table readable at 1280 and usable at 390
- [ ] `npm run lint` / `build` / relevant `test:e2e` in `dashboard/`
- [ ] Honest copy (no live Dial / M-Pesa claims)

## Anti-patterns

- Generating a fresh design system that ignores Scalers tokens
- Marketing glassmorphism on operational Admin screens
- Installing motion stacks “for polish”
- Softening Admin into consumer marketing density

## Handoffs

| Need | Lane |
| --- | --- |
| RPC / wallet / DID assign behavior | Ops |
| Auth / RLS / membership | Platform |
| Prompt / compile semantics | Brain |
| TTS / media | Voice |
