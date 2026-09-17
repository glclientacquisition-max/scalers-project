---
name: desk-motion
description: Constitution-safe desk motion. Use when adding animation, motion graphics, Lottie, Framer Motion, GSAP, ping, spinner, transitions, reduced-motion, or any movement on the owner desk or landing.
---

# Desk motion

Motion on Scalers is four named verbs. It is not motion graphics, Lottie, Framer Motion, GSAP, orbs, blobs, or page-wide loops.

Canon: `docs/frontend/design-system/MASTER.md` (Motion). Law: `docs/frontend/FRONTEND_CONSTITUTION.md` §1 reduced-motion, §8. Tokens and keyframes: `dashboard/src/app/globals.css`. Primitives: `dashboard/src/lib/deskMotion.ts`, `dashboard/src/components/ui/DeskLand.tsx`, `LivePing` in `deskRow.tsx`, `pendingSpinnerClass` in `deskChrome.ts`. Catalog: `dashboard/src/app/dev/motion/page.tsx`.

## Classify

Map the request to one verb. If it does not map, do not add motion.

| Verb | When | Primitive |
| --- | --- | --- |
| **pending** | Mutation in flight | `pendingSpinnerClass` on the control. Disable double submit |
| **live** | A thing is happening now (Live call, Home bulletin) | `LivePing`. One ping per region |
| **land** | A list row appeared while the owner is watching | `DeskLandScope` + `DeskLandSurface`. First paint never lands |
| **press** | Primary button down | Already on `btnPrimary` (`active:scale-[0.99]`). Do not add elsewhere |

Landing marketing may keep `.landing-rise` / `.landing-drift`. Desk never uses those classes.

## Add

1. Reuse the primitive. Do not invent a fifth keyframe.
2. Put new motion CSS only in `globals.css` beside the existing desk keyframes, named `--motion-*`, killed in the same `prefers-reduced-motion` block.
3. Wire **land** with a `scopeKey` that changes when the list is a different pile (filter, page, query). Live insert on the same pile is one or two ids.
4. Keep `DeskDialog` enter-static.
5. Extend `tests/deskMotion.test.js` for every new wiring.

Done when MASTER still lists only these verbs, reduced-motion kills the new class, and the test file is green.

## Refuse

Lottie, Framer Motion, GSAP, animate.css, decorative canvas, glass shimmer, landing-rise on desk, `animate-pulse` except the pronunciation recording dot, a second live loop, row enter-stagger, dialog zoom, skeleton shimmer that invents numbers.
