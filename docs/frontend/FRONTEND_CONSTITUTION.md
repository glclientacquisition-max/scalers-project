# Scalers frontend constitution

**Status:** Phase 1 of Frontend 2.0. Authoritative for owner desk, marketing, auth, and onboarding UX.  
**Date:** 2026-08-30  
**Lane:** Desk UI/UX  
**Baseline:** [`FRONTEND_RECONNAISSANCE.md`](./FRONTEND_RECONNAISSANCE.md)  
**Does not override:** Voice, Brain, Platform, Ops behavioral contracts; [`SCALERS_ENGINEERING_PRINCIPLES.md`](../governance/SCALERS_ENGINEERING_PRINCIPLES.md)

This document exists so future engineers and agents extend **one** Scalers, instead of five lookalikes.

No UI ships from this file. Implementation starts at Phase 3, using [`design-system/MASTER.md`](./design-system/MASTER.md).

---

## 1. Authority

```text
SCALERS PRODUCT VISION
        ↓
FRONTEND CONSTITUTION          ← this file
        ↓
SCALERS DESIGN SYSTEM          ← docs/frontend/design-system/MASTER.md
        ↓
PAGE-SPECIFIC UX RULES
        ↓
IMPLEMENTATION
```

External skills (UI UX Pro Max, Taste, Ponytail) are **advisors**. They must not introduce a new font, palette, component library, or visual language without an explicit Scalers decision.

`.cursor/rules/scalers-design-ux.mdc` is a compact execution checklist. It remains `alwaysApply`. Where it conflicts with this constitution, **do not silently rewrite the mandate**. Report the conflict and follow the constitution for product intent until the mandate is amended in a dedicated governance change. Known conflicts are in [§19](#19-known-conflicts-with-existing-rules).

---

## 2. Product vision

> **Scalers is the operating console for a business's AI receptionist.**

The owner is managing a working member of the team.

Not: configuring an AI toy.  
Not: browsing an analytics template.  
Not: a pile of disconnected CRUD screens.

Every owner screen must help answer, in this order:

```text
WHAT NEEDS MY ATTENTION?
WHAT HAPPENED?
WHAT DID MY RECEPTIONIST HANDLE?
WHAT OPPORTUNITIES EXIST?
IS EVERYTHING WORKING?
WHAT SHOULD I DO NEXT?
```

The 8:00 AM test: if an owner cannot see what needs them and what to do next in seconds, the screen failed.

---

## 3. Character

Scalers should feel: calm, precise, operational, dense, trustworthy, modern, human, business-focused, premium without flash.

It must not feel: gimmicky, generic-AI, card-heavy, template-generated, enterprise-bloated, or visually noisy.

Rejected as default decoration (allowed only if they serve hierarchy or interaction):

- glassmorphism, mesh gradients, glow, blobs
- excessive rounding, shadows, or animation
- oversized display type on the desk
- decorative AI imagery or "magic" chrome
- floating ornaments

Landing may be atmospheric. The desk must not copy landing atmosphere.

---

## 4. Desk design dials

Desk defaults (Taste landing `8 / 6 / 4` do not apply):

| Dial | Value | Meaning |
| --- | --- | --- |
| Variance | **3** | Character is allowed. Layouts stay predictable. |
| Motion | **2** | Functional only. See [§12](#12-motion). |
| Density | **8** | Operational cockpit. Tables over galleries. |

Landing is a separate marketing surface. Do not apply desk density to the first viewport, or landing motion to the desk.

---

## 5. Density and collections

Scalers is an operational B2B console.

Prefer: tables, compact rows, filters, inline actions, status, progressive disclosure, split panes where they help.

**Operational collections default to dense lists or tables.** The Calls inbox is the current reference.

Use a card when grouping or a decision/summary actually needs a bounded surface (Home attention item, wallet balance, live update). Do not wrap every record in a padded card.

Whitespace separates concepts. It is not luxury padding.

---

## 6. Actions

| Rank | Treatment |
| --- | --- |
| Primary | Largest hit target. Fill `#0096FF`. One per screen. |
| Secondary | Neutral outline, ghost, or text. |
| Destructive | Muted until confirmed. Warn color, not competing primary. |

Channel identity is not the product primary. **WhatsApp:** button fill `#0096FF`; green `#25D366` on the glyph only.

Submit controls dock to the fields they complete. Global save stays sticky, top-right, under the desk header (`settingsStickyHeaderClass` pattern).

---

## 7. Brand, type, tokens

Existing tokens are canonical. Extend them deliberately. Do not start a parallel palette or a second type stack.

| Role | Value | Prefer |
| --- | --- | --- |
| Brand / primary | `#0096FF` | `bg-[#0096FF]`, `accent`, `brand` |
| Brand deep | `#005CCC` | `accent-deep`, `brand-700` |
| Navy / ink | `#0A192F` | `text-ink`, `brand-900` |
| Ink soft | `#4A5B73` | `text-ink-soft` |
| Canvas | `#F4F7FB` | `bg-surface-canvas` |
| Surface | `#FFFFFF` | `bg-surface` |
| Line | `#D5DEE9` | `border-line` |
| Warn / ok / lead / WhatsApp | existing CSS vars | `warn`, `ok`, `lead`, `whatsapp` |

Prefer `text-ink`, `bg-surface`, `border-line` over `text-[var(--ink)]` when the Tailwind map already expresses the value. Do not mass-replace in this phase.

Type: **DM Sans** (UI), **Sora** (titles). Reject Plus Jakarta Sans, Inter, or other substitutions unless product explicitly changes the brand.

Type must work in dense tables, metadata, short titles, and numeric emphasis. Do not use marketing-scale display type on desk pages.

Focus convention today:

```text
focus:outline-none focus:ring-2 focus:ring-[#0096FF]
```

Future primitives may wrap this. Visible keyboard focus is required either way.

---

## 8. Layout

- One page gutter from the shell (`p-4` to `p-6`). Pages must not add a second `px-4 py-10` inside `(desk)/layout.tsx`. Appointments currently double-pads; that is debt for Phase 4, not a pattern.
- Do not nest `max-w-*` without a reason. Home’s extra `max-w-3xl` is debt.
- Operational data should use available width.
- Responsive behavior is per page: what stays, what collapses, what becomes a drawer, what scrolls horizontally, which action stays primary. Mobile is not "desktop narrower."
- Call-detail split pane (summary left, conversation right) is protected on `lg+`. Stacking on small screens is an accepted exception. Do not redesign it to prove a new pattern.

---

## 9. Page jobs

One primary job per page. Do not fill empty space with unrelated widgets.

| Page | Job |
| --- | --- |
| Home `/home` | What needs attention, what happened, is the line working, one next action |
| Calls `/calls` | Review and act on call activity |
| Call detail `/calls/[id]` | Understand and act on one interaction |
| Requests `/requests` | Process service requests |
| Appointments `/appointments` | Manage visit bookings |
| Business `/settings` | Teach and configure the receptionist |
| Wallet `/wallet` | Balance, usage, top-up |
| Super Admin `/admin/*` | Operate the platform (separate shell) |
| Landing `/` | Brand and conversion. Not the desk. |

---

## 10. Home (Command Center) principles

Do not implement Home here.

Intended order:

1. **What needs me?** New call leads.
2. **What happened?** Today and follow-up activity from real counts.
3. **Is it working?** Only real state: line live, number pending, needs training. Never a manufactured Online pulse.
4. **Next action?** One meaningful CTA.

Phase 3 default: Home shows **new call leads only**. Requests and appointments join after Phase 4 unifies those lists.

No analytics four-up that does not click through to work. No fake metrics. Every number needs a source. `assessMvpAnswerReadiness` and `TriageLeadCard` are existing candidates to evaluate, not requirements to keep or delete in this phase.

---

## 11. Source of truth and data

> **Never manufacture product state for visual completeness.**  
> **The UI must reflect the actual system, not the desired system.**

Forbidden in production UI: fake Online, fake activity, fake analytics, fake customer counts, fake receptionist performance, fake readiness, hard-coded operational numbers, optimistic status without reconciliation.

If a capability has no trustworthy source:

1. Name the missing source.
2. Do not show a misleading state.
3. Document the dependency.
4. Defer the UI.

If data is loading or missing: truthful loading, truthful error/unavailable, or omit. Do not invent a number.

Live "Online" has no backend source today. Allowed labels from real fields: **Line live**, **Number pending**, **Needs training**.

---

## 12. Motion

Desk motion = 2/10.

Allowed: state change, loading, confirmation, drawer/dialog, live events backed by real data (bulletin ping).

Forbidden: decorative loops, entrance theatre on desk, animating everything.

Respect `prefers-reduced-motion`. Landing motion stays on landing.

---

## 13. Receptionist and knowledge

Language: **your receptionist**, not "AI configuration."

The owner should feel: **I am teaching my receptionist how my business works.**

Expose only what the backend supports today: identity, voice, languages, knowledge, behavior, escalation, hours, test. Do not invent controls for capabilities that do not exist.

Settings IA is grouped by owner job. Same tabs and panels. Do not flatten into one form.

```text
General     Updates · Assistant · Team
Knowledge   Catalog · FAQs · Import
Operations  Hours · Locations · Policies
Line        Tools & voice · Pronunciation · Test
```

Section titles are non-clickable. `Train` remains the verb (Save & train). Do not mandate a `TenantForm` rewrite to ship visual work. Split that file only if a later phase cannot ship safely without it.

---

## 14. Copy

Short, direct, human, operational, useful.

No marketing inside workflows. No fake enthusiasm. No implementation jargon (`apply docs/supabase/…` is an error fallback, not owner copy).

No em dashes (—) or en dashes (–) in UI strings, placeholders, or empty states. Hyphens in compound words are fine.

Prefer **Assigning your number** over **Opening your line…**.  
Prefer **WhatsApp alerts unavailable** over **Coming soon — WhatsApp alerts are being wired.**

Do not rewrite copy in this phase.

---

## 15. Accessibility

Not polish. Required on every interactive control:

- Keyboard operation
- Visible focus ([§7](#7-brand-type-tokens))
- Semantic HTML and names
- Errors next to the field
- Honest disabled states
- Contrast that holds on canvas and surface
- Touch targets at least 44px on primary actions
- `prefers-reduced-motion`

Icon-only controls need an accessible name. Do not use emoji as UI icons.

---

## 16. Navigation

Current owner labels are product surface. Keep them through Phase 5:

```text
Overview · Calls · Requests · Appointments · Business · Wallet
```

Do not rename to Conversations / Receptionist / Settings for style. Bookmarks and habit matter.

Owner and Super Admin shells stay split. Never merge those navs.

Nested navigation (Business settings) uses a vertical sidebar. Section titles (`General`, `Knowledge`, `Operations`, `Line`) are non-clickable: `uppercase`, `tracking-wide`, `text-gray-500`, no hover.

Desk chrome today is a top bar and a mobile drawer. Do not add a second desk sidebar in Phases 3–5.

---

## 17. Protected patterns

Do not replace these without a clear UX reason. Preserve does not mean never improve.

1. Owner vs Super Admin shell split
2. Calls table, filters, search, empty states
3. Call-detail split pane (`lg+`); mobile stack allowed
4. Settings sidebar
5. Settings section headers as non-clickable (`General`, `Knowledge`, `Operations`, `Line`)
6. Sticky Save
7. Existing brand tokens
8. Landing first viewport (one composition)
9. `textarea rows={2}` with focus expand
10. Onboarding gate for blank/default prompts
11. `mvpAnswerReadiness` as a capability to evaluate later
12. `TriageLeadCard` as a Home candidate to evaluate later
13. `settingsUi.tsx` field, chip, switch, trash patterns
14. `Pagination` (extend, do not replace)

---

## 18. Engineering

Before creating anything: search existing components, patterns, utilities, dependencies, then native browser behavior. Then the minimum new code.

No new packages to obtain a UI pattern. No second token, button, input, modal, type, or nav system.

No speculative abstraction. No silent changes to auth, schema, wallet, DID, SIP, voice, Brain, or billing.

Visual/UX debt (tokens, focus, card lists, fluff, CTA color) is not the same as architectural debt (`TenantForm` size, missing dashboard tests, schema fallbacks). Refactor architecture only when it blocks safe UX, not because a file is large.

Future UI slices must pass TypeScript, ESLint, Next build, and relevant tests. Add tests for critical flows when behavior warrants them. Current zero dashboard unit/E2E coverage is technical debt. Do not solve it in Phase 1.

Changes: small, reviewable, reversible, one concern. Prefer separate commits for redesign, design-system plumbing, bug fixes, refactors, and tests.

A UI change is done when it solves a real owner problem, uses real data, has empty/loading/error states, follows these rules, reuses existing patterns, and is verified (lint, build, tests, critical-flow check). Looking good is not done.

---

## 19. Known conflicts with existing rules

Do not silently edit `.cursor/rules/scalers-design-ux.mdc` to hide these. Amend that file in a later governance PR if product agrees.

| Topic | Mandate (alwaysApply) | Constitution | Resolution until mandate is amended |
| --- | --- | --- | --- |
| Split pane | "Never stack them vertically." | Call detail may stack on small screens. | Follow constitution. Desktop remains split. |
| Nested nav | Nested nav must be a vertical sidebar. | Settings already is. Desk chrome is a top bar through Phase 5. | Sidebar rule applies to nested settings, not a second desk shell. |
| Custom CSS | No one-off CSS for layout/chrome. | Landing rise/drift already lives in `globals.css`. | No new desk chrome CSS. Do not delete landing motion in a drive-by. |

Desk nav label is **Business** (route `/settings`). Older docs sometimes say Settings. Use the shipped label.

---

## 20. Super Admin

Separate operational surface. Preserve the shell and the auth gate.

Frontend 2.0 does not fix: HMAC cookie auth, missing middleware, wallet RPCs, DID assignment, ops security. Token alignment may happen in Phase 5 chrome only.

---

## 21. Roadmap

```text
Phase 0  Reconnaissance          DONE
Phase 1  Constitution            DONE
Phase 2  Design system           THIS TREE (docs/frontend/design-system/)
Phase 3  Home Command Center
Phase 4  Requests + Appointments → Calls pattern; deep links
Phase 5  Tokens, focus, copy, auth chrome
Phase 6  Receptionist UX from existing fields
Phase 7  Knowledge UX; TenantForm split only if required
```

Do not pull later phases into this one. UI starts at Phase 3, using [`design-system/MASTER.md`](./design-system/MASTER.md).

---

## 22. What this document does not authorize

- UI edits, token migrations, Home redesign, list unification
- Wiring `mvpAnswerReadiness` or `TriageLeadCard`
- `TenantForm` decomposition
- New npm packages
- Backend, schema, auth, voice, Brain, billing, DID changes
- Fake Online or other invented state
- Renaming owner nav before Phase 6 (and only then with a product decision)
