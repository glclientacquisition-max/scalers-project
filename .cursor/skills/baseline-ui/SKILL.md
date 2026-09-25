---
name: baseline-ui
description: Fast desk UI cleanup. Spacing, hierarchy, typography, density, and AI chrome. Use for a polish pass on owner-desk or landing UI. Keep Scalers tokens. Do not add Framer Motion, Base UI, or a new palette.
---

# Baseline UI (Scalers)

Source: [ibelick/ui-skills](https://github.com/ibelick/ui-skills) `baseline-ui` (MIT). Constraints kept where they match constitution. Stack mandates rewritten.

## Tokens

Ribbon, focus, tab underline: `#0096FF`. Filled primary: `#005CCC` plus white label. Ink and canvas stay the desk tokens in `globals.css`. One accent per view.

No second typeface. No second primary. No gradient, glow, glass, or purple wash unless the constitution already names that landing class.

## Stack

Tailwind utilities already in the repo. Reuse `dashboard/src/components/ui/*` and `deskChrome.ts`. Do not add `motion/react`, Framer Motion, GSAP, `tw-animate-css`, Base UI, Radix, or React Aria.

`cn` is fine where the file already uses it.

## Interaction

Destructive work uses the existing confirm pattern (`DeskDialog` or the current alert). Errors sit next to the action. Do not block paste.

Hits stay 44px (`deskHitClass` / `h-12 w-12` for Confirm, Done, Call, WhatsApp). List verbs share `btnDock`. Focus: `focus:outline-none focus:ring-2 focus:ring-[#0096FF]`.

`textarea` defaults to `rows={2}`.

## Layout

Tables over stacked cards for Calls, Requests, Appointments, catalogs, Teams. One list per dataset. Phone uses the list row. `md+` uses the table. Split pane from `lg`. Same two panes stack below `lg`.

Preview cells: `deskPreviewClass` / `deskPreviewCellClass`. One ellipsis line. No `overflow-wrap: anywhere` on a preview.

`min-w-0` on text columns. Container `p-4` to `p-6`.

## Type

`tabular-nums` on money, counts, and timestamps. `truncate` or one-line clamp on list previews. `text-balance` on a marketing heading is fine. Do not invent `tracking-*` on desk.

## Motion

Only `/desk-motion`. No animation unless the verb maps. Compositor props only when that skill says so.

## Empty and chrome

Empty state: one next action, no sub-explanation. No instructional subtitle. No em dash or en dash in the string.

Icon-only buttons need `aria-label`. Decorative SVG: `aria-hidden`.

## Review output

`/baseline-ui <file>`: quote the line, one-sentence why, concrete fix. Do not restyle the page into a different product.
