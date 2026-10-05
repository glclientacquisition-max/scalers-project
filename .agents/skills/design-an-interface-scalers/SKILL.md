---
name: Design an interface (Scalers)
description: >-
  Use when exploring multiple radically different shapes for a Desk or Super
  Admin module, component API, or screen composition — design it twice before
  coding. Subordinate to Frontend 2.0, MASTER tokens, and desk-motion.
---
# Design an interface (Scalers)

Based on Ousterhout’s **Design It Twice** (via mattpocock `design-an-interface`): the first UI or module shape is unlikely to be best. Generate **3+ radically different** designs, compare in prose, then recommend — before implementation.

Scoped to **Scalers Desk** and **Super Admin** surfaces under Frontend 2.0.

Also load [UI UX Pro Max (Scalers)](sand-workflow:ui-ux-pro-max-scalers) for the visual checklist, and [Desk lane](sand-workflow:desk-lane) / [Admin end-to-end polish](sand-workflow:admin-end-to-end-polish) when relevant.

## Authority order (always)

1. Frontend 2.0 charter / constitution
2. MASTER tokens — no raw hex
3. desk-motion only: **pending / live / land / shift / press**
4. Existing kit (`components/ui`, AppShell, ListRow, Segmented, Empty, DeskNotice)
5. This exploration recipe

**Hard constraints for every design option:**

- No Framer Motion, Remotion, GSAP, or Lottie on Desk/Admin
- Owner overlays are the `Sheet` bottom drawer (swipe down). Do not design a centered dialog
- Admin UI says **Business** not Tenant
- Dense operational tables OK; no marketing fluff on Admin
- Owners stay on `(desk)` + `DESK_LINKS`; ops on `/admin/*` + `ADMIN_LINKS` — never merge shells/sessions
- Prefer Next.js + Tailwind + existing shadcn-style primitives

## When to use

- New Desk/Admin screen or shared component with unclear public API
- Refactor that changes how callers compose a module
- User says “design it twice”, “explore shapes”, or “compare approaches”
- Choosing between table-first vs card-first vs wizard for an operational task

Skip when: the change is a typo/token tweak; Ops/Platform already fixed the server contract and UI is a thin bind; Voice/Brain-only work.

## Workflow

### 1. Gather requirements

- [ ] What job does this module/screen finish for the owner or Super Admin?
- [ ] Who calls it?
- [ ] Key operations (list, filter, assign, approve-first send, docked save, …)
- [ ] Constraints (Frontend 2.0, density, shell split, a11y, existing patterns)
- [ ] What stays hidden vs exposed?

Write a short problem-space blurb, then proceed to parallel designs.

### 2. Generate designs (parallel)

Spawn **3+** explorations. Each must be **radically different**. Assign a distinct constraint:

| Pass | Constraint |
| --- | --- |
| 1 | Minimize surface: 1–3 entry points / primary actions max |
| 2 | Maximize flexibility: many filters, extensions, secondary actions |
| 3 | Optimize the most common case: make the default path trivial |
| 4 (optional) | Kit-pure: only existing primitives; zero new atoms |
| 5 (optional) | Density-first Admin table vs guided owner flow |

Each design outputs: composition signature, usage example, what stays hidden, motion verbs (allowed only), trade-offs.

### 3. Present designs

Show each sequentially: signature → usage → hides → motion map. Do not implement yet.

### 4. Compare (prose, not score tables)

Contrast simplicity, depth, common-case ease vs misuse risk, locality when Ops/Platform contracts shift, kit fit, Admin honesty (Business wording, dense tables), shell safety.

### 5. Synthesize

Recommend one design (or a hybrid). Be opinionated. Ask only if a real product fork remains. Then implement under Desk lane rules — still no forbidden motion stacks.

## Evaluation criteria

- Interface simplicity
- General-purpose vs specialized (avoid god panels)
- Implementation efficiency under RSC / server-action boundaries
- Depth: small surface, significant behavior behind it

## Anti-patterns

- Near-clone options — enforce radical difference
- Skipping comparison
- Implementing during exploration
- Winning with flashy forbidden motion
- Designing a merged owner+admin mega-shell
- Using Tenant in Admin-facing copy

## Example foci

- Inbox row actions: inline approve-first vs detail drawer vs dedicated ticket page
- Super Admin Businesses list: dense table + row menu vs multi-pane inspector
- Settings / Train: single long form vs segmented sections with docked Save
- Shared `Empty` + next action vs custom per-route empty art (prefer kit)
