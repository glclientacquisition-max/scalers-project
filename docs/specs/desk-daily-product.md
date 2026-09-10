# Desk as a daily product (research)

**Status:** Research. No UI ships from this file.  
**Date:** 2026-09-10  
**Lane:** Desk UI/UX  
**Baseline:** `origin/main` DeskNav is Overview, Inbox, Contacts, Business, Wallet. Shell is a sticky top bar plus a phone hamburger drawer.  
**Authority:** [`FRONTEND_CONSTITUTION.md`](../frontend/FRONTEND_CONSTITUTION.md) outranks this spec. Where this spec asks to change chrome, that is a **constitution amendment**, not a silent restyle.

---

## Verdict

Do **not** rebuild Scalers as a new dashboard. Do **not** install a second visual language (shadcn Linear clone, glass, Inter, sidebar-from-a-template).

The products people open every day (Linear, Stripe Dashboard, Superhuman, iOS Phone / WhatsApp) share **discipline**, not a look:

1. One job per screen.
2. Dense, predictable lists.
3. Instant response to tap and type.
4. Navigation that does not hide on the device you actually use.
5. Honest data. No fake Online. No KPI wallpaper.

Scalers already decided this in the constitution (density 8, `#0096FF`, DM Sans + Sora, tables over cards, 8:00 AM test). The gap is **shell + phone + speed**, not a missing component library.

**Most effective method:** keep tokens and recipes; rebuild only the **app shell** so one nav source adapts (bottom tabs on phone, top links on `md+`); then harden Inbox and Home against real thumbs; then add keyboard command search. Measure with the 8:00 AM test on a 390px phone, not a Figma moodboard.

---

## What “universal” actually means here

Universal is not “works if you pinch-zoom the desktop site.”

| Surface | Owner job | Shell that matches |
| --- | --- | --- |
| Phone, one thumb | See who needs me, open the call, WhatsApp back | 4 to 5 bottom tabs, 44px targets, `safe-area-inset-bottom` |
| Tablet | Same jobs, more table | Top bar or short rail; tables may h-scroll |
| Laptop | Triage a list, teach the receptionist | Top bar (already ships). Split pane on call detail `lg+` |

Kenyan SME owners will use this between jobs, often on a phone. A hamburger **Menu** that hides Inbox is the opposite of a daily app.

Constitution §16 currently says: top bar + mobile drawer; do not add a second desk sidebar in Phases 3 to 5. A phone **bottom bar** is not a second sidebar. It is the same four destinations, presented for the thumb. That needs an explicit product yes before code.

---

## What world-class apps do (copy decisions, not pixels)

### Linear

- Density without chrome. Rows ~36 to 44px. Hairline borders, not card galleries.
- Keyboard-first (`cmdk` on the web). Fuzzy jump to any entity.
- Optimistic UI: the click paints immediately; the network catches up.
- One accent. Marketing site and app are related, not identical.

Do **not** copy: dark AMOLED canvas, violet `#5E6AD2`, 256px left rail, Geist/Inter.

Study: [Linear design notes](https://github.com/marcus/marcus-skills/blob/main/skills/linear-design-patterns/references/linear-design-system.md), [cmdk](https://github.com/pacocoursey/cmdk).

### Stripe Dashboard

- Few primary destinations. Money work is a table, not tiles.
- Loading is skeleton of the real layout, not a spinner in a void.
- No competing CTAs.

### Superhuman / Gmail

- Inbox is the product. Everything else is a filter or a detail.
- Primary action is huge and local (Reply). Scalers already docks WhatsApp in brand blue.

### Native phone apps

- Bottom tabs, labels under icons, active state obvious.
- One overflow (“More”) if you exceed five tabs.
- Content scrolls under a thin top context bar, not under a tall marketing header.

Industry nav rule of thumb (2026 SaaS writeups): top bar is fine for **3 to 6** desktop sections; phone needs **bottom tabs or the product feels like a website**. Scalers on `main` has five desktop links. That is already a valid phone tab set if Contacts stays daily. If Contacts is rare, it belongs under More, not in the thumb row.

---

## What to reject (AI-slop fingerprint)

Already banned by constitution and MASTER. Repeat so a rebuild does not “tastefully” reintroduce them:

- Glass, mesh, glow, blobs, grain
- Plus Jakarta / Inter / Outfit as a “premium” swap
- Orange or purple CTA packs from generic `--design-system` skills
- Four KPI tiles that do not click through to work
- Fake Online / fake analytics
- Card wrapping every row
- Illustration empty states
- A new `Button.tsx` + Radix stack “so we can move faster”
- Dual padding (`layout` gutter plus page `px-4 py-10`)

Vercel `react-best-practices` and `shadcn` skills will nudge toward shadcn. For this repo they are **advisors**. MASTER: search `settingsUi.tsx` and Calls first; no new packages unless a later phase cannot reuse native HTML.

---

## Current product vs that bar

| Already good | Gap that kills daily use |
| --- | --- |
| Tokens, type, density 8 | Phone nav is hamburger. Five destinations hidden behind Menu |
| Inbox table + call-detail split on `lg` | Table `min-w-[760px]` + h-scroll is not a phone layout. Constitution allows a real phone row recipe; we never shipped one |
| One primary CTA, WhatsApp blue fill | Header + drawer eat vertical space; no `safe-area` padding |
| Honest Line live / pending / training | No command palette; no optimistic Done/Archive |
| Next.js 16 App Router, Server Components | Desk has almost no interaction tests. Lane gate is lint + build only |

Do not replace Calls/Inbox as the collection benchmark. Extend it.

---

## Architecture to keep

```text
Next.js App Router (dashboard/)
  (desk)/layout.tsx     one owner shell
  DeskNav               one LINKS array, two presentations
  pages                 one job each (constitution §9)
  settingsUi + Calls    recipes, not a new kit
Supabase SSR + RLS      real data only
```

**One nav source of truth.** Same `LINKS` (or a `primary` vs `overflow` split) renders:

- `md+`: current horizontal links
- `<md`: `position: fixed` bottom tabs, `padding-bottom: env(safe-area-inset-bottom)`, `min-h-11`, `aria-current="page"`
- Main gets `pb-*` so the last Inbox row is not hidden under the bar

Use **container queries** on the Inbox table wrapper (`@container`) so a stacked row layout can appear when the *table* is narrow, not only when the viewport is. Shopify Polaris and modern CSS already treat this as the way components survive split panes.

Do **not** fork a second nav tree for mobile. That is how labels drift.

Local-first Linear (IndexedDB + MobX) is the wrong rewrite for this stack. Steal **optimistic mutations** only: Done/Archive/lead status should paint before the server round trip, then reconcile. Keep RSC for first paint.

---

## Skills (this repo and Cursor)

Use, in this order:

1. [`docs/frontend/FRONTEND_CONSTITUTION.md`](../frontend/FRONTEND_CONSTITUTION.md)
2. [`docs/frontend/design-system/MASTER.md`](../frontend/design-system/MASTER.md)
3. [`.cursor/rules/scalers-design-ux.mdc`](../../.cursor/rules/scalers-design-ux.mdc)
4. [`docs/agents/DESK_UX.md`](../agents/DESK_UX.md)
5. Cursor `nextjs` + `react-best-practices` for waterfalls, bundles, a11y (not for restyling)
6. Taste / UI UX Pro Max / Ponytail as **advisors only** (already filtered in MASTER)

Do not run a skill `--design-system` pack. It will propose glass and a foreign palette.

Human skills that matter more than another npm library: information architecture, Fitts (44px primaries), Hick (few nav items), Gestalt (alignment, not cards), writing short operational copy, and actually using the desk on a phone every morning.

---

## Tools and GitHub repos (when, not by default)

| Need | Use | Do not use it for |
| --- | --- | --- |
| Command jump later | [pacocoursey/cmdk](https://github.com/pacocoursey/cmdk) | Restyling the desk |
| Phone sheet (filters) | Native `<dialog>` first. [vaul](https://github.com/emilkowalski/vaul) only if dialog fails a11y | A drawer for primary nav (tabs beat drawers) |
| Focus and keyboard primitives | Browser first; [Base UI](https://github.com/mui/base-ui) only if we outgrow native | Importing all of shadcn |
| Density reference | Linear app + Stripe Dashboard (study, do not fork CSS) | [pacifio/ui Atlas](https://github.com/pacifio/ui) dark AMOLED kit |
| Tokens | Existing `globals.css` + Tailwind 3.4 | A second token pipeline |
| Verify | Real device or 390 / 768 / 1280 in the browser tools. Constitution: looking good is not done | Screenshot-only PRs |

No new package in the shell phase unless native HTML cannot do tabs + `aria-current`.

---

## Most effective sequence (do this, in order)

A big-bang “Frontend 3.0” will produce AI slop. Ship like Linear: small, weekly, one concern.

### 0. Product decision (blocking)

Amend constitution §16: phone primary nav is a bottom tab bar of at most five items; desktop stays the top bar; still no left desk rail. Until that amendment, agents must not invent a sidebar or a tab bar.

### 1. Shell only (highest leverage)

- One `LINKS` list
- Bottom tabs on small screens, safe area, main padding
- Overflow: Sign out stays in a small header control, not a sixth tab
- Verify Overview, Inbox, Contacts, Business, Wallet, call detail on 390 and 1280

### 2. Inbox on a phone

- Below a container-width threshold, each row becomes a dense block: Work, Who, one When line, Open + WhatsApp as 44px targets
- Do not switch to padded cards. Keep Calls cell language
- Filters stay a horizontal scroll of tabs (already the CallsToolbar recipe)

### 3. Home 8:00 AM on a phone

- Attention list first. Aside (line + one CTA) below, not a second desktop column squeezed
- No new metrics

### 4. Response, not decoration

- Optimistic lead status
- Honest loading (row skeletons that match the table)
- `prefers-reduced-motion`

### 5. Command palette (after the shell is boring and fast)

- Jump to Inbox filters, a call, Business sections
- cmdk styled with existing tokens, not Linear violet

### 6. Still later

- Keyboard on desktop Inbox (j/k) 
- Dashboard tests for nav + Inbox row
- Do not split `TenantForm` unless settings cannot ship

---

## How we know it worked

A Kenyan owner on a phone, 8:00 AM:

1. Opens `scalers-staging.vercel.app` (or prod later)
2. Sees what needs them without opening Menu
3. Taps a call, reads Summary, hits Reply on WhatsApp
4. Does that in seconds, every weekday, without being taught

If they still hunt for Inbox, the rebuild failed, no matter how original the type looks.

---

## Out of scope

Voice, Brain, wallet ledger rules, DID pool, Super Admin chrome merge, new fonts, dark mode as a prerequisite, React Native. Dark theme is not required for daily use; contrast and density are.
