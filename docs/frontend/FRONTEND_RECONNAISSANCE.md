# Scalers frontend reconnaissance

**Status:** Phase 0 of Frontend 2.0. Documentation only. No UI changes.  
**Successor:** Phase 1 constitution is [`FRONTEND_CONSTITUTION.md`](./FRONTEND_CONSTITUTION.md).  
**Date:** 2026-08-30  
**Branch base:** `main` @ `0d7ea1b`  
**Lane:** Desk UI/UX (`docs/agents/DESK_UX.md`)  
**Mission:** Scalers Frontend 2.0 brief (Principal Product Design + Frontend Architecture). Product vision: **the operating console for a business's AI receptionist.**

Inspected in this pass: `dashboard/` routes, layouts, tokens, shared primitives, owner pages, admin chrome, auth/onboarding, data libs, tests, Cursor rules, and three advisor skills (UI UX Pro Max, Taste, Ponytail). Skills are advisors. Scalers product rules win.

---

## Design read (Taste, adapted)

> **Reading this as:** operational B2B SaaS console for Kenyan SME owners, used at 8:00 AM to see what the receptionist did and what needs a human. Language: calm, precise, dense. Foundation: existing Scalers tokens (ribbon blue `#0096FF`, navy `#0A192F`, DM Sans + Sora). Not a marketing landing redesign. Not a generic AI dashboard.

Taste default dials (`8 / 6 / 4`) are for landings. They do **not** apply to the desk. Desk overrides:

| Dial | Landing (keep) | Desk (target) |
| --- | --- | --- |
| Variance | 5 | 3 (preserve shells; no novelty redesign) |
| Motion | 3 | 2 (state, drawers, confirmation only) |
| Density | 4 | 8 (tables, inline actions, cockpit) |

UI UX Pro Max `--design-system` search returned **glassmorphism, Plus Jakarta Sans, orange CTA `#EA580C`**. Rejected. That is the generic SaaS pack this product must not become. Keep `#0096FF`, existing type, no frosted glass, no orange accent.

Ponytail constraint on all later work: search existing components first; no new packages; no `TenantForm` split unless a visual change cannot ship safely without it.

---

## A. Current architecture

### Runtime

| Item | Fact |
| --- | --- |
| App | Next.js 16 App Router, React 19, Tailwind 3.4 |
| Package | `dashboard/` (`dashboard` npm name). Not a monorepo workspace. |
| Deploy | Vercel, root directory `dashboard` |
| Auth (owners) | Supabase SSR + RLS (`dashboard/src/lib/auth.ts`, `(desk)/layout.tsx`) |
| Auth (ops) | Legacy HMAC cookie `DASHBOARD_PASSWORD` (`isLegacyAuthenticated`) |
| Middleware | **None.** Gates live in layouts and page redirects. |
| Component library | **None.** No shadcn, Radix, or icon package. |
| Tests | **None** in `dashboard/`. Lane gate is `npm run lint` + `npm run build`. |
| Dependencies | `@supabase/ssr`, `@supabase/supabase-js`, `next`, `react`, `react-dom` only |

### Route map

```text
/                         LandingPage  (redirect /home or /admin if signed in)
/login                    Owner + legacy ops form
/signup                   Workspace create
/onboarding               4-step wizard if tenantNeedsOnboarding
/home                     Owner overview (underdeveloped)
/calls                    Inbox table + filters     ← UX benchmark
/calls/[id]               Split-pane call detail    ← UX benchmark
/requests                 Service requests (cards)
/appointments             Visit bookings (cards)
/settings                 Business knowledge shell  ← IA benchmark
/wallet                   Prepaid KES + ledger
/admin/*                  Super Admin (separate shell)
/dev/pronunciation        Local harness if DASHBOARD_OPEN=true
```

### Shells (must stay split)

| Shell | Layout | Nav | After login |
| --- | --- | --- | --- |
| Owner | `(desk)/layout.tsx` sticky header | Overview, Calls, Requests, Appointments, Business, Wallet | `/home` (onboarding first if blank prompt) |
| Super Admin | `admin/layout.tsx` navy sidebar | Overview, Wallets, Businesses, Numbers, Voices | `/admin` |

Owners hitting `/admin` redirect to `/home`. Legacy cookie hitting desk redirects to `/admin`.

### Data for Home (real sources only)

Already queried on `/home`:

| Query | Used? | Notes |
| --- | --- | --- |
| Tenant row | Yes | Name, wallet, bulletin, DID |
| Calls today (Nairobi day start) | Yes | KPI |
| `lead_status = new` count | Yes | KPI |
| `lead_status = contacted` count | Yes | KPI |
| `lead_status` all / done / archived counts | **No** | `void`ed |
| 40 newest `new` calls | **No** | `void needsRes`. Was for a triage list that is gone |

Available **without new schema**, not on Home today:

| Source | What it answers |
| --- | --- |
| `assessMvpAnswerReadiness()` in `mvpAnswerReadiness.ts` | Is the receptionist ready? DID, prompt, hours, location, FAQs, notify. **Zero call sites.** |
| `tenant.sautikit_virtual_number` | Line live vs `pending:` vs missing |
| `tenant.agent_name`, `soniox_voice_id`, `tts_lexicon` | Who/voice, not live presence |
| `service_requests` (`status=open`) | Open holds/orders |
| `appointments` (`status=requested`) | Visit requests waiting |
| `liveBulletinItems(daily_bulletin)` | Already on Home |

**Not available (do not fake):** live "Online" presence, per-call agent version, Contacts entity, real-time call-in-progress. Phase 6 receptionist "● Online" must not ship until a backend signal exists. Until then: **Line live / Number pending / Needs training**, from DID + `assessMvpAnswerReadiness`.

### Large files (do not split unless a later phase cannot ship without it)

| File | LOC | Role |
| --- | --- | --- |
| `TenantForm.tsx` | 2197 | All Train + Catalog panels, one form, hidden sections |
| `PronunciationCoach.tsx` | 1455 | Practice / library / Gemini scan |
| `KnowledgeIngestPanel.tsx` | 716 | Import paste/URL |
| `PronunciationGeminiScan` lib + actions | ~1350 | Brain/desk pronunciation |

### Missing product surfaces

No `/contacts`. No `loading.tsx`. Only `settings/error.tsx`. No desk-wide empty/loading primitive.

---

## B. Current design system

Tokens already exist. The job is to **canonize usage**, not invent a second system.

### Color (`globals.css` + `tailwind.config.ts`)

| Token | Value | Tailwind |
| --- | --- | --- |
| Brand / accent | `#0096FF` | `brand`, `brand-500`, `accent` |
| Brand deep | `#005CCC` | `brand-700`, `accent-deep` |
| Navy / ink | `#0A192F` | `brand-900`, `ink` |
| Ink soft | `#4A5B73` | `ink-soft` |
| Canvas | `#F4F7FB` | `surface-canvas` |
| Card | `#FFFFFF` | `surface` |
| Line | `#D5DEE9` | `line` |
| Warn | `#C2410C` | `warn` |
| Ok | `#15803D` | `ok` |
| Lead | `#B98A1F` | `lead` |
| WhatsApp | `#25D366` | `whatsapp` |

Focus shadow token: `shadow-focus`. Radius: `rounded-panel` (0.875rem). Max width: `max-w-desk` (72rem). Header height: `--desk-header-h`.

### Type

- Body: **DM Sans** (`--font-sans`)
- Display: **Sora** (`--font-display`) on `h1–h3` and `.font-display`
- Page titles: `font-display` + `clamp(...)` or `text-3xl sm:text-4xl`
- Metadata: `text-xs uppercase tracking-wide text-ink-soft`

Do not add Plus Jakarta Sans or a third family.

### Layout

- Desk: sticky header, `max-w-desk`, `px-4 py-6 sm:px-6 sm:py-10`
- Settings sticky save sits under `--desk-header-h`
- Admin: `lg:w-72` navy aside, content `max-w-5xl`
- Landing: full-bleed brand-900, one composition (keep)

### Shared primitives (reuse these)

| Primitive | Path | Use as |
| --- | --- | --- |
| Field / chip / sticky header / `rows={2}` textarea | `settingsUi.tsx` | Canonical form chrome |
| Pagination | `ui/Pagination.tsx` | Only consumer: Calls. Extend to Requests/Appointments |
| Calls toolbar | `CallsCommandCenter.tsx` | Filter + search pattern |
| Brand lockup | `brand/BrandMark.tsx` | All chrome |
| Lead status / Done / Archive | `LeadStatusToggle`, `MarkLeadDoneButton` | Inbox actions |
| WhatsApp helper | `WhatsAppLink.tsx` | `wa.me` only; fill color is a product decision |
| Triage row | `TriageLeadCard.tsx` | **Orphan.** Brand-blue WhatsApp CTA. Evaluate before delete |
| Readiness scorer | `mvpAnswerReadiness.ts` | Home "is it working?" |

### Interaction patterns that already work

1. Dense table + tab filters + inline actions (`/calls`)
2. Split pane: summary left, transcript right (`/calls/[id]`, stacks on small screens)
3. Nested settings: non-clickable `Train` header + panel links
4. Sticky global Save (`TenantSettingsSaveButton`)
5. Compact textarea: `rows={2}`, expand on focus
6. Onboarding gate for blank/default prompts

---

## C. Design-system drift

### Token access (two dialects)

Canonical: `text-ink`, `bg-surface`, `border-line`, `bg-[#0096FF]`.

Legacy: `text-[var(--ink)]`, `border-[var(--line)]`, `bg-[var(--accent)]`. Heavy in auth, onboarding, appointments, admin, Test, ingest, pronunciation.

Do not global-replace. Migrate per page in Phase 5.

### Focus

Mandate: `focus:outline-none focus:ring-2 focus:ring-[#0096FF]`.

Reality: settings fields use `focus:ring-[#0096FF]/40`. Login/signup/onboarding often `focus:border-accent` + `shadow-focus` only. Many inputs have no ring.

### Primary CTA

Mandate: largest hit, `#0096FF`.

| Screen | Primary | Color |
| --- | --- | --- |
| Home | Process Pending Leads | Brand blue |
| Settings | Save & train | Brand blue |
| Call detail | Reply on WhatsApp | **WhatsApp green** |
| Inbox table | Number + green glyph | Green icon, not a full-width CTA |
| `TriageLeadCard` (unused) | Reply on WhatsApp | **Brand blue** (matches mandate) |
| Landing | Create workspace | White on navy (acceptable on dark marketing) |

### Density

Calls = table. Requests + Appointments = stacked cards. Catalog in settings = tables. Two layouts for the same class of work.

### Copy / dash rule

Visible UI (not comments):

- Appointments subtitle: "Visit requests your receptionist booked from home-services calls."
- Appointments row: em dash between name and service
- Notify: "Coming soon — WhatsApp alerts are being wired"
- Onboarding pending: "Opening your line…"
- Calls empty: "How to test"
- WhatsApp prefill (outbound message, still owner-facing): "Thanks for calling — how can we help you?"

### Navigation / deep links

- Desk is a **top bar** (6 items). Mandate wants nested nav in a **sidebar**. Do not add a second desk sidebar in Phase 3. Settings already has the nested sidebar. Desk chrome change is later, if at all (Hick: 6 items is the load).
- `/settings#train` and `/settings#test` from Calls empty states. Real routes are `?tab=train` and `?tab=test`. Hash is dead.
- Appointments "Related calls" goes to `/calls`, not `/calls/{id}`.
- Nav label "Calls" vs page title "Inbox".

### Layout bugs

- Appointments double-pads (`layout` + page `px-4 py-10`)
- Home extra `max-w-3xl` inside `max-w-desk`
- Requests "Open" count is **current filter result**, not tenant-wide open count
- Home still fetches unused lead rows

### Motion / CSS

Landing rise/drift in `globals.css` is the only justified custom CSS. `prefers-reduced-motion` already kills it. Do not add glass, blobs, or page-wide animation.

---

## D. UX opportunities (ranked by owner value)

The 8:00 AM test: *"Your receptionist is working. Here's what happened. Here's what needs you. Here's what to do next."*

| Rank | Opportunity | Why | Phase |
| --- | --- | --- | --- |
| 1 | **Home as Command Center** | First screen after login. Today: four KPIs + one button. Dead fetches. README promises a triage list that is gone. Real data already in tenant + call counts + unused readiness helper + unused `TriageLeadCard`. | 3 |
| 2 | **Unify Requests + Appointments with Calls** | Same job (filter, act, WhatsApp). Second layout. Double pad, fluff, broken related-call link, wrong Open count. | 4 |
| 3 | **Fix Settings deep links** | Empty-state CTAs miss Train/Test. One-line href fix. | 4 or with 3 |
| 4 | **Call-detail primary CTA** | Mandate + unused card already say brand-blue WhatsApp. Green fill is the drift. Glyph can stay WhatsApp green. | 5 (or with 3 if Home reuses the card) |
| 5 | **Token + focus + copy pass** | Auth, onboarding, appointments, admin chrome. Highest visual inconsistency, lower task-completion impact. | 5 |
| 6 | **Receptionist as an entity** | Differentiator. Must not invent Online. Can surface Line / Voice / Test from existing fields. | 6 |
| 7 | **Business knowledge language** | Settings IA is already strong. Teach "I am training my receptionist" without splitting `TenantForm`. | 7 |

Not ranked (out of lane / no backend): Super Admin rewrite, wallet RPC, DID assignment, prompt compile, Contacts, live presence.

---

## E. Existing assets to preserve

Do not redesign for novelty:

1. Owner vs Super Admin shell split
2. Calls table, filters, search, empty states
3. Call-detail split pane (mobile stack OK)
4. Settings sidebar + non-clickable Train header
5. Sticky Save
6. Brand tokens, DM Sans / Sora, ribbon mark
7. Landing first viewport (one composition)
8. `rows={2}` expandable textareas
9. Onboarding gate
10. `settingsUi.tsx` field/chip/trash/switch classes
11. `Pagination` (extend, don't replace)
12. `assessMvpAnswerReadiness` (wire, don't rewrite)
13. `TriageLeadCard` until Home proves it is or is not the attention row
14. `BrandLockup` / `BrandWordmark`

---

## F. Technical risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| `TenantForm` 2k LOC client component | Easy to regress compile/save. Hidden panels still mount state. | Visual work without split. Split only if a panel cannot ship otherwise. |
| Pronunciation + ingest monoliths | Easy to break TTS lexicon writes | Phase 6/7 only; no drive-by |
| Schema fallbacks in UI | Calls retries three SELECT shapes. Missing SQL shows "apply docs/supabase/…" | Keep fallbacks. Do not assume columns. |
| JS/TS intro + lexicon duplication | Desk preview can diverge from live voice | Do not "fix" by merging packages in a UI PR |
| No dashboard tests | Home/list changes can ship unguarded | Add focused tests with the first behavioral slice |
| `eslint-config-next` 15 vs Next 16 | Lint noise | Note in Phase 5; don't mix with Home |
| Legacy admin cookie | Weak ops auth | Out of scope. Chrome-only if touched |
| `DASHBOARD_OPEN` | Skips login | Do not broaden. Dev pronunciation page already gated |
| Service role | Must never hit `NEXT_PUBLIC_*` | Preserve. No new browser admin clients |
| Fake Online status | Product lie | Only DID + readiness until Platform adds presence |
| Nav rename (Conversations / Receptionist) | Breaks bookmarks, mental model | Keep current labels through Phase 5 |

---

## G. Proposed Scalers design direction

### One sentence

A **calm operational console**: navy ink, ribbon blue action, dense tables, one primary task per screen. The owner manages a receptionist, not an AI settings panel.

### Visual

- Light canvas `#F4F7FB`, white surfaces, 1px `line` borders
- Primary action always `#0096FF` on white (WhatsApp: blue fill, green glyph)
- Type: Sora for titles, DM Sans for UI. No oversized display on desk
- Radius: keep `rounded-xl` / `rounded-2xl` already in use; do not go pill-everything
- No glass, no mesh gradients on desk, no glow, no floating orbs, no purple
- Landing may keep atmospheric navy. Desk may not copy it

### UX structure (evolve toward, do not rename routes yet)

```text
/home          Command Center     what happened / what needs me / is the line working
/calls         Conversations      benchmark inbox (keep URL)
/requests      Opportunities      same table language as Calls
/appointments  Opportunities      same table language as Calls
/settings      Knowledge          keep IA; language shift in Phase 7
/settings?tab=test  Receptionist test  already exists
/wallet        Billing            ops-owned; token-only
```

### Home Command Center (Phase 3 target)

Answer, in order, with **real data only**:

1. **What needs me** — New leads (and later open requests if the query is cheap). Reuse `TriageLeadCard` or a table row that matches Calls density. If zero: show the next useful action (train / test / caught up), not an empty marketing card.
2. **What happened** — Today's call count, followed-up count (already fetched).
3. **Is it working** — Line live / pending / needs training via DID + `assessMvpAnswerReadiness`. Wallet warn if prepaid low. Live bulletin if present.
4. **What to do next** — One primary CTA (Process pending leads, or Test line, or Train), not four competing buttons.

No dead fetches. No fake "Online". No analytics-style four-up that does not click through to work.

### Lists

Calls is the template: horizontal table, status tabs with counts, search if needed, muted secondary actions, pagination.

### Motion

Only: live bulletin ping (already), drawer, button pending spinner, reduced-motion respected. No landing-style rise on desk.

---

## H. Proposed frontend roadmap

Matches the mission phases. Small PRs. No backend/schema/auth/billing/voice/Brain behavior.

| Phase | Output | UI? |
| --- | --- | --- |
| **0** | This document | No |
| **1** | `docs/frontend/FRONTEND_CONSTITUTION.md` | No |
| **2** | `docs/frontend/design-system/MASTER.md` + page notes only where they differ | No |
| **3** | Home Command Center (flagship) | Yes |
| **4** | Requests + Appointments → Calls pattern; deep links; fluff; related-call href; Open count | Yes |
| **5** | Tokens, focus, buttons, empty states, auth/onboarding/admin chrome copy | Yes |
| **6** | Receptionist UX from existing fields + Test tab. No speculative Online | Yes |
| **7** | Knowledge language on current settings IA. `TenantForm` split only if required | Yes |

Phase 3 commit shape: `feat(frontend): establish home command center`  
Phase 4: `fix(frontend): unify operational list density`

Super Admin is not a redesign target. Token alignment only if it falls out of Phase 5 shared classes.

---

## I. Files to create or change

### Phase 0 (this PR)

| Path | Action |
| --- | --- |
| `docs/frontend/FRONTEND_RECONNAISSANCE.md` | Create |

### Phase 1 (next, docs)

| Path | Action |
| --- | --- |
| `docs/frontend/FRONTEND_CONSTITUTION.md` | Create. Authoritative UX + engineering principles. Must incorporate `.cursor/rules/scalers-design-ux.mdc` rather than fork it. |

### Phase 2 (docs)

| Path | Action |
| --- | --- |
| `docs/frontend/design-system/MASTER.md` | Create. Tokens, type, layout, components, states, motion. |
| `docs/frontend/design-system/pages/home.md` | Create. Command Center spec. |
| `docs/frontend/design-system/pages/calls.md` | Short. Document as the benchmark, do not redesign. |
| `docs/frontend/design-system/pages/call-detail.md` | Short. Preserve split pane; CTA color decision. |
| `docs/frontend/design-system/pages/requests.md` | Create. Table unification. |
| `docs/frontend/design-system/pages/appointments.md` | Create. Table unification. |
| `docs/frontend/design-system/pages/receptionist.md` | Create. Existing-data-only. |
| `docs/frontend/design-system/pages/settings.md` | Short. Preserve IA. |

Do not duplicate MASTER into every page file.

### Phase 3 (UI, after constitution + Home page spec)

| Path | Likely change |
| --- | --- |
| `dashboard/src/app/(desk)/home/page.tsx` | Command Center. Drop unused fetches. Wire readiness. |
| `dashboard/src/components/TriageLeadCard.tsx` | Reuse or extract a denser row; do not delete first |
| `dashboard/src/lib/mvpAnswerReadiness.ts` | Call from Home. Copy hints may need dash-rule pass |
| `dashboard/README.md` | Align Home description with reality |

### Phase 4

| Path | Likely change |
| --- | --- |
| `dashboard/src/app/(desk)/requests/page.tsx` | Table + real open count + Pagination |
| `dashboard/src/app/(desk)/appointments/page.tsx` | Table, remove fluff/em dash/double pad, `/calls/{id}` |
| `dashboard/src/app/(desk)/calls/page.tsx` | `?tab=` deep links only |
| `dashboard/src/components/ui/Pagination.tsx` | Reuse |

### Phase 5 (illustrative, not a dump)

Auth + onboarding + `settingsUi` focus class + notify copy + WhatsApp prefill + admin token dialect. Prefer shared class strings over per-file hex.

### Do not touch in Frontend 2.0 UI phases

`server.js`, `src/speech/**`, `src/conversation/**` (except if Desk copy-only), `docs/supabase/**`, wallet RPCs, DID assignment, `promptCompiler` semantics, Super Admin behavior.

---

## J. Questions requiring product decisions

Only items that cannot be resolved from the repo. Defaults below are what implementation will use if nobody contradicts them.

### 1. Home attention mix

Should Command Center show **only new call leads**, or also open requests and requested appointments in one queue?

**Default:** New call leads in Phase 3 (data + `TriageLeadCard` already exist). Add request/appointment rows in Phase 4 after those lists are tables, so Home does not invent a third row style.

### 2. WhatsApp primary button color

Mandate and unused `TriageLeadCard`: `#0096FF`. Call detail today: `#25D366`.

**Default:** Brand-blue fill, WhatsApp glyph. Recognition stays in the icon. Primary task color stays Scalers.

### 3. Desk information architecture labels

Mission IA uses Command Center / Conversations / Receptionist. Current nav: Overview / Calls / Business.

**Default:** Keep URLs and nav labels through Phase 5. Rename only in Phase 6 if the receptionist surface is real. Do not ship two names for one dataset.

### 4. Receptionist "Online"

No presence API.

**Default:** Never show a live pulse. Show **Line live**, **Number pending**, or **Needs training** from DID + `assessMvpAnswerReadiness`.

### 5. Contacts

No table/route.

**Default:** Out of scope until Platform owns a contacts source of truth.

No other blockers. Token migration, list density, deep links, and Home layout are design decisions already constrained by the mandate and this recon.

---

## Advisor skill application (so later phases do not "follow the skill")

| Skill | Take | Discard |
| --- | --- | --- |
| **UI UX Pro Max** | Contrast, 44px targets, visible focus, reduced-motion, no emoji-as-icon, labels on icon buttons | Glassmorphism, Plus Jakarta, orange CTA, Hero+Features desk layout, raw `--color-primary` rename |
| **Taste** | Anti-slop, design read, preserve-on-redesign, no purple mesh | Landing variance/motion/density defaults applied to desk; extra component libraries |
| **Ponytail** | Reuse ladder, no new deps, no speculative `TenantForm` split, native `search`/`date` where they exist | Cutting validation, a11y, or error states to save lines |

---

## Next step

Phase 2 design system: [`design-system/MASTER.md`](./design-system/MASTER.md). Still no UI. Phase 3 is Home.
