---
name: desk-motion
description: Constitution-safe desk motion. Use when adding animation, motion graphics, Lottie, Framer Motion, GSAP, ping, spinner, transitions, reduced-motion, or any movement on the owner desk or landing.
---

# Desk motion

Motion on Scalers is five named verbs. It is not motion graphics, Lottie, Framer Motion (`motion` / `motion/react`), GSAP, orbs, blobs, or page-wide loops.

Canon: `docs/frontend/design-system/MASTER.md` (Motion). Law: `docs/frontend/FRONTEND_CONSTITUTION.md` §1 reduced-motion, §8. Tokens and keyframes: `dashboard/src/app/globals.css`. Primitives: `dashboard/src/lib/deskMotion.ts`, `dashboard/src/components/ui/DeskLand.tsx`, `DeskNotice.tsx`, `LivePing` in `deskRow.tsx`, `pendingSpinnerClass` and `deskShiftClass` in `deskChrome.ts`. Catalog: `dashboard/src/app/dev/motion/page.tsx`.

## Classify

Map the request to a **surface type**, then to one verb. If it does not map, do not add motion.

| Type | Verb | Primitive |
| --- | --- | --- |
| **Shell** (rail, header, tabs) | none | Static. Never animate rail width or `h-dvh`. |
| **List** (Inbox, Contacts, ledger) | **land** + **shift** | `DeskLandScope` / `DeskLandSurface` on live insert. Hover: `deskShiftClass`. Stable keys. No stagger. |
| **Detail** (ticket, profile) | none | Instant record swap. |
| **Notice** (toast, Saved, Archive undo) | **shift** | `DeskNotice` + `useNotify`. Opacity + `translateY` only, `--motion-fast`. |
| **Modal** (dialog, menu, hint) | none | `DeskDialog` enter-static. |
| **State** (tabs, badges, filters) | **shift** | `filterTabClass` / `deskShiftClass`. No `layoutId`. |
| **Empty / loading** | **pending** or none | Spinner on route pending. Empty is static. |
| **Numbers** | none | Instant `tabular-nums`. |
| **Form** | **shift** | Focus/border. Errors mount instantly. |
| **Route** | none | No page fade. |

| Verb | When | Primitive |
| --- | --- | --- |
| **pending** | Mutation in flight | `pendingSpinnerClass` on the control. Disable double submit |
| **live** | A thing is happening now (Live call, Home bulletin) | `LivePing`. One ping per region |
| **land** | A list row appeared while the owner is watching | `DeskLandScope` + `DeskLandSurface`. First paint never lands |
| **shift** | Hover, focus, selected, color, and notice enter/exit | `deskShiftClass` or `DeskNotice`. Named properties only, 150ms (`--motion-fast`) |
| **press** | Primary button down | Already on `btnPrimary` (`active:scale-[0.99]`). Do not add elsewhere |

Landing marketing may keep `.landing-rise` / `.landing-drift`. Desk never uses those classes.

## Add

1. Reuse the primitive. Do not invent a new keyframe. For hover and selected, use `deskShiftClass`, not `transition`, `transition-all`, or `transition-colors duration-300`. Notice enter/exit is `.desk-notice` in `globals.css` (already the shift family).
2. Put new motion CSS only in `globals.css` beside the existing desk keyframes, named `--motion-*`, killed in the same `prefers-reduced-motion` block. Honor `usePrefersReducedMotion` on any new presence primitive.
3. Wire **land** with a `scopeKey` that changes when the list is a different pile (filter, page, query). Live insert on the same pile is one or two ids.
4. Keep `DeskDialog` enter-static. Do not add the View Transitions API on desk routes.
5. One toast pattern: `DeskNotice` / `useNotify`. `InboxArchiveToast` wraps `DeskNotice`. Do not add a second toast.
6. Extend `tests/deskMotion.test.js` for every new wiring.

Done when MASTER still lists only these verbs, reduced-motion kills the new class, and the test file is green.

## Refuse

Lottie, Framer Motion, the `motion` package, `motion/react`, GSAP, animate.css, decorative canvas, glass shimmer, landing-rise on desk, `animate-pulse` except the pronunciation recording dot, a second live loop, row enter-stagger, dialog zoom, overlay fade, skeleton shimmer that invents numbers, `transition-all`, page crossfades, `layoutId`, springs, number count-up, animating width/height/top/left/margin/box-shadow on notices. Remote ui-skills motion packs (`improve-animations`, `12-principles-of-animation`, `fixing-motion-performance`) lose to this file.
