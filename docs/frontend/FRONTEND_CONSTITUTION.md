# Scalers Frontend Constitution

**Status:** Authoritative for owner desk + marketing UI  
**Lane:** Desk UI/UX  
**Date:** 2026-09-06  
**Incorporates:** `.cursor/rules/scalers-design-ux.mdc` (does not replace it)  
**Evidence date:** 2026-09-06  

This document is the product design law. The mandate file stays the short always-on rule. This file explains *why*, sets measurable spacing and contrast, and binds later UI work.

**Product sentence:** A calm operational console for a Kenyan SME owner at 08:00 EAT. Navy ink, ribbon-blue action, dense tables, one primary task per screen. The owner manages a receptionist, not an AI settings panel.

---

## 0. How to use this

1. Apply `.cursor/rules/scalers-design-ux.mdc` on every string and component.
2. If this file and a trend pack conflict, this file wins.
3. If this file and live Auth/RLS, wallet RPCs, or prompt compile conflict, those contracts win.
4. Tokens live in `dashboard/src/app/globals.css` and `dashboard/tailwind.config.ts`. Usage canon is `docs/frontend/design-system/MASTER.md`.
5. Do not invent a second typeface, a second primary color, or a second list layout.

---

## 1. Scientific and psychological sources

Cross-referenced. Product rules win when sources disagree.

| Principle | Source | What we take | What we reject |
| --- | --- | --- | --- |
| Working memory ~4 chunks | Cowan, *The Magical Number 4*, BBS 2001; Nielsen, *Cognitive Load Is a Budget* (2025) | Home answers at most four questions. Nav stays at six top items. | Miller 7±2 as a dashboard widget quota |
| Cognitive load types | Sweller 1988; Sweller, van Merriënboer, Paas 1998 | Cut **extraneous** load (fluff, dual layouts, dead fetches). Spend **germane** load on “what needs me.” | Decorative mesh, glass, competing CTAs |
| Fitts’s law | Fitts 1954; WCAG 2.2 SC 2.5.8 / 2.5.5; Apple HIG 44pt; Material 48dp + 8dp gap | Primary CTA: largest hit, `#0096FF`, docked to its field. Floor **44×44 CSS px** for primary/secondary actions. Table icon actions: **32×32** minimum (passes 24×24 AA if isolated). | Tiny adjacent ghost buttons |
| Hick’s law | Hick 1952; Hyman 1953 | One layout per dataset. One primary action per screen. Nested nav uses a sidebar with non-clickable category headers. | A second desk sidebar while 6 top tabs already exist |
| Gestalt: proximity, similarity, common region, continuity | Wertheimer; Carbon spacing overview; Atlassian spacing | Related items sit on the 8px scale (8–12px). Groups use 16–24px. Sections use 32–48px. Tables share one chrome. | Card stacks for the same job as a table |
| Von Restorff (isolation) | von Restorff 1933 | Only the primary action is saturated blue. Archive/Cancel/Remove stay ghost or icon. | Two blue buttons in one viewport |
| Serial position / F-pattern | Nielsen Norman Group eyetracking | First line: line status + greeting. First block: work waiting. Metrics after work. | Analytics four-up that does not click into work |
| Progressive disclosure | Nielsen; Sweller element interactivity | `textarea rows={2}` then expand. Settings panels stay hidden until chosen. | All Train fields on one scroll |
| Jakob’s law | Nielsen | Calls table is the inbox idiom. Requests and Appointments copy it. | Novel card masonry |
| Tesler’s law | Tesler | Complexity stays in compile/save, not in owner copy. | “Train your receptionist in short steps” |
| Aesthetic-usability | Kurosu & Kashimura 1995; Tractinsky | Calm light canvas, 1px lines, no novelty chrome. | Glassmorphism, Plus Jakarta, orange CTA |
| Peak-end rule | Kahneman | Empty and error states must still name the next action. | Dead ends and hash links that 404 the intent |
| Doherty threshold | Doherty & Thadhani 1982 | Pending spinners on mutations. No landing-style rise on desk. | Page-wide animation |
| Color / contrast | WCAG 2.2 SC 1.4.3, 1.4.11 | Ink `#0A192F` on canvas. Link text `#005CCC`. `#0096FF` on white is **~3.09:1** (fails AA body text; passes AA large text). Never use `#0096FF` for small links. White on `#0096FF` is the same ratio: primary buttons use **≥16px semibold** and **min-height 44px**. | Brand-blue body copy |
| Touch / Kenya mobile | Apple 44pt; Material 48dp; WCAG 2.5.8 24px | Design for one-thumb morning triage on a mid-range Android. Container `px-4` / `sm:px-6`. | Hover-only actions |
| Reduced motion | WCAG 2.2 SC 2.3.3 | `prefers-reduced-motion` already kills landing motion. Desk adds no new loops except the existing bulletin ping. | Orbs, drift, blobs on desk |

---

## 2. Mandate restated (binding)

From `.cursor/rules/scalers-design-ux.mdc`:

1. **Copy:** No fluff, no instructional subheaders, no em/en dashes in UI strings. Labels are verbs or nouns the owner already knows.
2. **Density:** Tables over stacked cards for Calls, Requests, Appointments, catalogs. Split pane for call detail (summary left, transcript right). Desktop side-by-side; mobile may stack the same two panes.
3. **Action:** Primary CTA `#0096FF`, largest hit. Sticky Save top-right under the desk header. Secondary actions muted.
4. **Nav:** One layout per dataset. Sidebar category titles: `uppercase tracking-wide text-gray-500` (or `text-ink-soft`), no hover, not links.
5. **Tech:** Tailwind utilities only for layout/chrome. Focus: `focus:outline-none focus:ring-2 focus:ring-[#0096FF]`. Container padding `p-4`–`p-6`.

---

## 3. Spacing law (8-point grid)

Base unit **8px**, same as IBM Carbon, Atlassian, and Material. Tailwind already encodes this (`space-2` = 8px). Do not invent a parallel scale.

| Role | px | Tailwind | Use |
| --- | --- | --- | --- |
| Hairline / icon gap | 4 | `gap-1` / `p-1` | Icon to label inside a control |
| Related (Gestalt proximity) | 8 | `gap-2` | Chips in a row, stacked field + hint |
| Control padding | 12 | `px-3 py-2.5` | Inputs, filter tabs |
| Group / cell | 16 | `px-4` / `gap-4` | Table cell padding, form field stack |
| Block | 24 | `mt-6` / `gap-6` | Title to table, filter to list |
| Section | 32–40 | `py-8` / `mt-8` | Rare on desk. Prefer 24. |
| Page frame | 16 / 24 | `px-4 py-6 sm:px-6 sm:py-10` | Desk `main` only. Pages do not double-pad. |

**Proximity rule:** If two controls complete one task, they sit ≤16px apart (Fitts + docking). If they are different tasks, ≥24px.

**Common region:** A table, a filter bar, and its empty state share one visual region (same border/background language). Do not wrap each row in its own card.

---

## 4. Type and color

| Role | Token | Notes |
| --- | --- | --- |
| Body | DM Sans `--font-sans` | 14px (`text-sm`) default in tables |
| Display | Sora `--font-display` | `h1`–`h3` and page titles only. Desk titles `text-3xl sm:text-4xl`, not marketing clamp explosions |
| Meta | `text-xs uppercase tracking-wide text-ink-soft` | Non-clickable sidebar headers |
| Primary fill | `#0096FF` | Buttons, active tab underline, focus ring |
| Primary text on light | `#005CCC` | Links, active tab label |
| Ink | `#0A192F` | Body |
| Canvas | `#F4F7FB` | Page |
| Surface | `#FFFFFF` | Tables, forms |
| Line | `#D5DEE9` | 1px |
| Ok / Warn / Lead | `#15803D` / `#C2410C` / `#B98A1F` | Status only |
| WhatsApp glyph | `#25D366` | Icon on white/canvas only. On the blue CTA use a white glyph (green-on-blue fails SC 1.4.11). |

No Plus Jakarta Sans. No third family. No purple.

---

## 5. Interaction floors

| Control | Minimum |
| --- | --- |
| Primary CTA | `min-h-11` (44px), full width on mobile when it is the page task |
| Filter tab | `min-h-11`, `px-3` |
| Text input | `min-h-11`, `focus:ring-2 focus:ring-[#0096FF]` |
| Icon-only (Done, Archive) | `h-8 w-8` (32px) with ≥8px gap to neighbors |
| Destructive | Ghost or icon. Never same weight as primary |

---

## 6. Information architecture

Keep URLs and nav labels through the current phase: Overview, Calls, Requests, Appointments, Business, Wallet.

| Route | Job | Layout |
| --- | --- | --- |
| `/home` | What needs me. What happened. Is the line working. One next action. | Command Center |
| `/calls` | Inbox benchmark | Dense table |
| `/calls/[id]` | Decide + reply | Split pane; WhatsApp CTA brand-blue fill, green glyph |
| `/requests` | Same job as Calls | Same table language |
| `/appointments` | Same job as Calls | Same table language |
| `/settings` | Train knowledge | Existing sidebar IA |
| `/wallet` | Prepaid KES | Token-only from this lane |

**Line status (no fake Online):** `Line live` / `Number pending` / `Needs training` from DID + `assessMvpAnswerReadiness`.

**Deep links:** `businessSettingsHref("train")` and `businessSettingsHref("test")`. Never `/settings#train`.

---

## 7. Copy voice

- Scan, do not educate.
- Prefer “Requests”, “Open”, “Reply on WhatsApp”, “Save”.
- Ban: em dash, en dash, “How to test” as a story, “Coming soon” filler.
- WhatsApp prefill is owner-facing: no dashes.

---

## 8. Motion and chrome

- Desk: state, drawer, pending spinner, existing bulletin ping.
- Landing may keep rise/drift behind `prefers-reduced-motion`.
- No glass on desk. Header may keep light `backdrop-blur`.
- Radius: `rounded-xl` / `rounded-2xl` / `rounded-panel`. Not pill-everything.

---

## 9. What this constitution is not

- Not a Super Admin redesign.
- Not a Contacts product (no route until Platform owns the entity in UI scope).
- Not a voice, wallet-ledger, or prompt-compiler change.
- Not permission to split `TenantForm.tsx` unless a panel cannot ship otherwise.

---

## 10. Implementation order (still in force)

| Phase | Output |
| --- | --- |
| 1 | This file |
| 2 | `docs/frontend/design-system/MASTER.md` + page notes |
| 3 | Home Command Center |
| 4 | Requests + Appointments → Calls table; deep links; fluff |
| 5 | Remaining token/focus/auth chrome |
| 6 | Receptionist from existing fields only |
| 7 | Knowledge language on current settings IA |
