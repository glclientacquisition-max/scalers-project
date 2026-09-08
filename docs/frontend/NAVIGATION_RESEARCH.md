# Scalers navigation research

**Status:** Phase 6A of Frontend 2.0. Research and recommendation only.  
**Date:** 2026-08-30  
**Lane:** Desk UI/UX  
**Authority:** [`FRONTEND_CONSTITUTION.md`](./FRONTEND_CONSTITUTION.md), [`design-system/MASTER.md`](./design-system/MASTER.md), [`FRONTEND_RECONNAISSANCE.md`](./FRONTEND_RECONNAISSANCE.md)  
**Does not authorize:** UI, route, CSS, package, schema, or component changes.

This document answers one question:

> Which navigation architecture lets a Kenyan SME owner operate their receptionist and customer work with the least cognitive effort, on the devices they actually use, without breaking bookmarks or inventing a second Scalers?

It does not answer “what looks most modern.”

---

## 1. Executive summary

The current Owner Desk is a **six-item top bar** on `md+` and a **Menu drawer** below `md`. That desktop pattern is already a good fit for six peer destinations. The mobile pattern is the weak point: every destination is hidden, including daily work.

**Recommendation:** keep the desktop top bar. Replace the mobile hamburger as the *only* path to work with a **bottom bar of four high-frequency destinations plus More**. Do not add a desktop sidebar while there are only six top-level items. Do not group those six under OPERATE / RECEPTIONIST / BILLING. Do not rename Calls to Conversations or Business to Receptionist in this phase.

Mental model: the owner is **managing their receptionist’s work and the business it represents**, not “using Scalers.” Navigation should stay in business nouns (Calls, Requests, Appointments, Business, Wallet). Receptionist language belongs **inside** Business (Train, Test) and on Home (Line live / Number pending / Needs training), not as a seventh global tab until a distinct job exists.

Attention belongs on Home first. Nav badges only later, and only for **needs-action counts**, never totals, never fake Online.

---

## 2. Current Scalers navigation

### Owner shell (source of truth)

Files: `dashboard/src/app/(desk)/layout.tsx`, `dashboard/src/components/DeskNav.tsx`.

| Attribute | Today |
| --- | --- |
| Location | Sticky top header. Brand lockup left. Links right. |
| Desktop (`md+`) | Inline text links, always visible |
| Mobile (`<md`) | “Menu” / “Close” button. Overlay + dropdown list |
| Destinations | Overview `/home`, Calls `/calls`, Requests `/requests`, Appointments `/appointments`, Business `/settings`, Wallet `/wallet` |
| Account | Sign out in the same nav (desktop and drawer) |
| Active state | `aria-current="page"`; prefix match for nested routes |
| Width | Header and main share `max-w-desk` (72rem) |
| Nested nav | **Not** in the desk shell. Business settings has its own vertical sidebar |

Settings nested IA (keep): Updates, Catalog, Train (non-clickable header), Import, Test. Query params `?tab=` and `?panel=`. See [`pages/settings.md`](./design-system/pages/settings.md).

Super Admin is a **separate shell** (`AdminNav`, navy sidebar on large screens). Constitution forbids merging owner and admin navs.

### What is already correct

- Six labeled destinations, one word each, matching owner jobs.
- Nested knowledge IA is already a sidebar (mandate + constitution).
- Home is the attention surface (Phase 3).
- Calls / Requests / Appointments are peer operational lists (Phase 4).
- URLs are stable. Labels are product surface (constitution §16).

### What is weak

- Mobile hides **all six** destinations, including daily Calls.
- Nielsen Norman Group measured hidden navigation as worse than visible or combo navigation on both phone and desktop (discoverability drop, slower tasks). Scalers currently pays that cost on every phone session.
- Six items in a top bar still fit. A left sidebar would spend horizontal space that density-8 tables need, for little orientation gain.
- Sign out sits among destinations. It is an account action, not a workplace.

---

## 3. User task model

Designed user: Kenyan SME owner or operator. Time-poor. Mix of morning laptop check and phone follow-up.

Constitution order of questions (every screen):

```text
WHAT NEEDS MY ATTENTION?
WHAT HAPPENED?
WHAT DID MY RECEPTIONIST HANDLE?
WHAT OPPORTUNITIES EXIST?
IS EVERYTHING WORKING?
WHAT SHOULD I DO NEXT?
```

Mapped to jobs:

| Job | Typical path | Device bias |
| --- | --- | --- |
| See what needs me | Overview, then a list | Both; phone in the morning |
| Triage a call / lead | Calls, call detail, WhatsApp | Phone-heavy |
| Handle a request | Requests | Phone or laptop |
| Confirm a visit | Appointments | Phone or laptop |
| Check the line | Overview strip, or Business Test | Laptop for Test; phone for status |
| Train / update knowledge | Business Train, Catalog, Import | Laptop |
| Add credit | Wallet, or Overview when low | Either |
| Change hours / identity | Business | Laptop |

Optimization target: **recognition → orientation → decision → action**. Not browse, not explore.

---

## 4. Frequency model

No product analytics were available in this repository. Frequencies below are **assumptions** from shipped IA, Home Command Center jobs, and constitution. They are not measured usage.

| Destination | Frequency | User intent | Urgency | Basis |
| --- | --- | --- | --- | --- |
| Overview | Daily (assumption) | What needs me; is the line working; one next action | High when new leads or line gaps exist | Phase 3 Home job; 8:00 AM test |
| Calls | Daily (assumption) | Review and act on call activity | High for New | Inbox is the operational benchmark; WhatsApp follow-up |
| Requests | Daily to several times a week (assumption) | Open / in-progress customer asks | Medium-high when Open | Peer list to Calls after Phase 4 |
| Appointments | Daily to several times a week (assumption) | Upcoming / pending visits | Medium-high near visit time | Peer list to Calls after Phase 4 |
| Business | Weekly, with spikes (assumption) | Train, catalog, hours, test | Low except when Needs training | Nested IA; not a morning triage surface |
| Wallet | Occasional, plus threshold spikes (assumption) | Balance, top up, ledger | High only when prepaid is low | Ops-owned; Home already surfaces low balance |

**Do not** treat all six as equal on a 390px screen. Do not hide the daily four behind Menu.

---

## 5. Competitive research

Evaluated on **navigation logic**, not visual copy. Evidence grades: high (official HIG / design system / NN/g study), medium (official product help), low (third-party writeups or inferred from screenshots).

### 5.1 Linear

| Lens | Finding |
| --- | --- |
| Location | Left sidebar; collapsible |
| Persistent | Issues / Inbox / views stay; settings is a destination |
| Hierarchy | Shallow. Favorites + teams, not a deep mega-menu |
| Primary action | Create issue (`C`) is global, not a nav tab |
| Attention | Inbox as work, not a decorative badge farm |
| Mobile | App exists; keyboard-first desktop is the culture |
| Orientation | Sidebar highlight + view title |
| Return | `G` chords and command menu |
| Frequency | Daily work in the sidebar; settings occasional |

Command palette (`Cmd+K`) is documented as the way to do *anything you forgot how to reach*. It is an **accelerator**, not the only nav. [Linear joining docs](https://linear.app/docs/joining-your-team-on-linear), [Linear search](https://linear.app/docs/search). Evidence: medium.

**Transfer:** keep daily work one tap away; put create/test in context, not as a sixth peer tab. **Do not transfer:** keyboard-as-primary, dense nested favorites. SME owners are not issue-tracker power users.

### 5.2 Slack

| Lens | Finding |
| --- | --- |
| Location | Hybrid: left navigation bar (Home, Activity, Later, …) + conversation sidebar |
| Persistent | Channel list in Home; Activity is the mention inbox |
| Attention | Bold = unread; **number badge = mention / DM** (higher stakes). Official help. |
| Mobile | Tabs analog to Home / DMs / Activity; unread bubbles |

[Slack notification guide](https://slack.com/help/articles/360025446073-Guide-to-Slack-notifications), [sidebar preferences](https://slack.com/help/articles/212596808-Adjust-your-sidebar-preferences). Evidence: high for badge semantics.

**Transfer:** distinguish “something happened” from “you must act.” Scalers should not bold every historical call. **Do not transfer:** a channel list as the product. Scalers is not a chat OS.

### 5.3 Notion

Sidebar as a **file tree of pages**. Frequency is “resume a document,” not “clear an inbox.” Evidence: medium (product behavior). **Little transfer.** Scalers destinations are jobs, not a wiki.

### 5.4 Shopify (Polaris)

Official: **Frame + Navigation for global destinations; Top bar must not provide global nav**; search and user menu live in the top bar; nested merchant IA is large enough to need a sidebar. [Polaris Top bar](https://polaris.shopify.com/components/internal-only/top-bar) (best practice: “Not provide global navigation… Use the navigation component instead”). Evidence: high.

Shopify has dozens of admin objects (Orders, Products, Customers, Analytics, …). **That** is why they sidebar. Scalers has six. Copying Shopify’s chrome without Shopify’s IA is cargo-cult.

**Transfer:** search and account in chrome, destinations in a dedicated nav region; contextual save already exists on Business. **Do not transfer:** a permanent left rail for a six-item product.

### 5.5 Stripe

Public design system is for **Dashboard apps** (drawer next to Stripe pages), not the internal dashboard IA. Third-party writeups describe a **job-labeled sidebar** (Payments, Customers, Billing) with global search. [Stripe Apps design](https://docs.stripe.com/stripe-apps/design). Evidence: medium for Apps; low for undocumented internal dashboard.

**Transfer:** labels as jobs the owner came to do. Scalers already does this (Calls, not Transcripts).

### 5.6 Intercom / Zendesk / HubSpot

Support products put **Inbox** (or tickets) as the primary workplace, with a **local sidebar of views** and a conversation pane. Global product nav is separate from the inbox filter list. [Intercom inbox customization](https://www.intercom.com/help/en/articles/7911926-customize-the-inbox-to-suit-you-and-how-you-work-best). Evidence: medium.

**Transfer:** Calls already is the inbox; call-detail split pane is the conversation. Keep global nav shallow; keep list filters *inside* the page (Calls tabs), not as extra global destinations.

### 5.7 Microsoft Teams

Left **app rail** (Chat, Teams, Calendar, Calls, …) plus nested list. Peer products as icons. Evidence: medium.

**Transfer:** a small set of peer workplaces. **Do not transfer:** icon-only rail on desktop (Scalers labels must stay words; constitution rejects emoji-as-icons and icon-only without names).

### 5.8 YouTube

Desktop: left destinations. Mobile: **bottom bar** (Home, Shorts, Subscriptions, You / Library). Adaptive by device. Evidence: medium (platform convention, not a paper).

**Transfer:** same IA, different chrome per device. Strong precedent for Model E.

### 5.9 Airbnb / Uber

Airbnb mobile: Explore, Wishlists, Trips, Inbox, Profile. Uber: map-first, not a console. Evidence: low-medium.

**Transfer:** 5 bottom destinations mapped to consumer jobs. **Do not transfer:** explore/discovery as a primary Scalers job.

### 5.10 WhatsApp

Bottom (or equivalent) **Chats / Updates / Communities / Calls**. Chats is the workplace. Evidence: medium (shipped consumer pattern; Meta does not publish an IA paper).

**Transfer:** the most frequent conversation list is persistent. For Scalers, that analog is **Calls**, not a social feed.

### 5.11 Paystack (African merchant dashboard)

Official rebuild: left nav grouped into **Payments** (daily: Transactions, Customers, Refunds, …) vs **Products** (modules you enabled), plus Audit / Developers at the bottom, Command Center at the top. They **interviewed merchants** because ten years of growth had produced a nav that reflected Paystack’s org chart. [Paystack: finding your way around the new Dashboard](https://support.paystack.com/en/articles/9040258). Evidence: high for their research method; medium for visual chrome.

**Transfer:** group only when the list reflects **how the merchant thinks**, and only after the list is long. Paystack grouped because they had *too many* items. Scalers does not. Inventing OPERATE / BILLING for six links repeats the problem Paystack just escaped, in reverse.

### 5.12 Flutterwave / M-Pesa / Safaricom

Flutterwave merchant dashboard is a left nav of payment objects (inferred; no public IA spec found). **Evidence: low.**

M-Pesa Super App / Safaricom: consumer money jobs on **bottom tabs** (home, send/pay, account). **Evidence: low** (no official HIG). Useful only as a reminder that Kenyan phone users already know persistent bottom destinations for high-frequency money tasks. Wallet in Scalers is **not** that frequent; do not put Wallet in the four mobile tabs unless analytics later show otherwise.

### 5.13 HubSpot / Zendesk (brief)

Both grew **large left navs** because CRM/support object counts exploded. Evidence: low-medium. Lesson is the same as Shopify/Paystack: sidebar is a response to **breadth**, not a badge of seriousness.

---

## 6. Instagram analysis

Instagram’s bottom bar is effective because of **principles**, not because it is a bottom bar.

Observed principles (product behavior + 2025–2026 tab reorder coverage; **Evidence: medium**, not a usability study):

1. **High-frequency destinations stay persistent.** Home, Reels, DMs, Search, Profile are always there.
2. **Nav is spatially stable.** Tabs do not reshuffle per page. Muscle memory forms.
3. **Shallow IA.** Five peers. Settings live under Profile, not as a sixth equal tab.
4. **The bar reflects what the company wants people to do.** Mosseri’s public comments tie tabs to DMs, Reels, and recommendations as growth surfaces. Nav encodes **strategy**, not a generic template.
5. **Creation is an action, not always a destination.** The + control has moved in and out of the bar. Actions can live in the top chrome.
6. **Icons become shortcuts** after heavy daily use. First-run still needs labels (Apple HIG: include tab labels).

### What transfers to Scalers

- Persist the **daily work** destinations on mobile.
- Keep IA shallow. Put Train/Test under Business, as Profile hides settings.
- Keep Test receptionist as an **action** (Home CTA, Business Test), not a global tab.
- Prefer spatial stability over novelty.

### What does not transfer

- Icon-only tabs as the desktop system. Desk is a dense console; words scan faster for infrequent weekly destinations (Business, Wallet).
- Browse / discover / create loops. Scalers is monitor / triage / follow up / configure.
- Algorithmic “time spent” as the success metric. Scalers succeeds when the owner **finishes work and leaves**.
- A center tab reserved for the company’s growth format (Reels). Scalers has no analog and should not invent one.

**Conclusion:** do not copy Instagram’s bar. Copy “high-frequency work is visible and stable.”

---

## 7. Consumer vs B2B comparison

| | Consumer social (Instagram) | Operational B2B (Scalers) |
| --- | --- | --- |
| Session goal | Browse, discover, create, return | Monitor, triage, follow up, manage, configure |
| Success | Time in app, return rate | Time **out** of app after the queue is clear |
| Information | Infinite feed | Finite work queues |
| Destinations | Peer content modes | Peer **objects** (calls, requests, visits) plus config and money |
| Attention | Unread social; FOMO | Needs-action operational items |
| Device | Phone-first | Phone **and** laptop; tables on desktop |
| Density | Media-full bleed | Density 8, `max-w-desk` tables |
| Nav chrome cost | Bottom bar is cheap vs video | Sidebar is expensive vs a 760px-min table |

A pattern that maximizes consumption will **fight** Scalers. A pattern that maximizes clearing a queue (inbox, tickets, orders) will fit. That is Intercom Inbox, Shopify Orders, Paystack Transactions, Scalers Calls: **object lists as workplaces**, global nav only to switch workplace.

---

## 8. Navigation models considered

### Model A. Current top navigation

```text
Overview | Calls | Requests | Appointments | Business | Wallet
```

Desktop: visible. Mobile: Menu drawer.

### Model B. Persistent left sidebar (ungrouped)

Same six links, always in a left column on desktop; typically a drawer on mobile.

### Model C. Grouped sidebar

```text
OPERATE    Overview, Calls, Requests, Appointments
RECEPTIONIST    Business
BILLING    Wallet
```

Section labels as non-clickable headers (settings Train pattern).

### Model D. Hybrid (persistent primary + contextual Business)

Global nav only for operational workplaces. Business keeps **existing** nested sidebar. Wallet as a global but visually quieter destination. No extra grouping headers.

### Model E. Responsive adaptive

Desktop: visible destination list (top bar **or** sidebar).  
Mobile: bottom bar of 3–5 high-frequency items + More.

Evaluated as: **desktop keeps today’s top bar; mobile becomes bottom + More.** That is the variant that matches evidence without spending table width.

### Model F. Task-oriented

```text
Work    Receptionist    Business    Billing
```

Calls / Requests / Appointments nested under Work. Only included because the brief asked; research does **not** support it at six destinations (extra tap on daily objects; constitution prefers current nouns).

---

## 9. Weighted decision matrix

Weights from the brief. Scores 1–10. Not forced to a fashionable answer.

| Criterion | Wt | A Top | B Sidebar | C Grouped | D Hybrid | E Adaptive | F Tasks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Discoverability | 20% | 6 | 8 | 7 | 8 | 9 | 5 |
| Task speed | 20% | 6 | 7 | 6 | 8 | 8 | 5 |
| Desktop usability | 15% | 8 | 7 | 7 | 8 | 8 | 6 |
| Mobile usability | 15% | 4 | 5 | 4 | 6 | 9 | 7 |
| Cognitive load | 10% | 7 | 7 | 5 | 8 | 8 | 5 |
| Scalability | 10% | 4 | 7 | 8 | 8 | 8 | 9 |
| Constitution fit | 5% | 9 | 6 | 5 | 8 | 8 | 3 |
| Implementation risk (higher = safer) | 5% | 10 | 6 | 5 | 7 | 6 | 4 |
| **Weighted** | | **6.25** | **6.85** | **6.15** | **7.65** | **8.25** | **5.70** |

### Score notes

**A Discoverability 6 / mobile 4.** Desktop links are visible (NN/g: visible beats hidden). Mobile Menu matches the hamburger penalty ([NN/g hamburger study](https://www.nngroup.com/articles/hamburger-menus/): hidden nav worse on phone and desktop; >20% discoverability drop vs visible/combo).

**B Desktop 7 not 9.** Sidebar helps when destinations exceed what a bar can hold (Shopify, Paystack). Six words already fit. Sidebar competes with `min-w-[760px]` tables and `max-w-desk`.

**C Cognitive 5.** Chunking helps long lists. Six items plus three headers is **more** to parse, not less. Paystack grouped after merchant research on a *bloated* nav, not a six-item one.

**D** Strong because it matches the real split: operate vs configure. Settings sidebar already exists; do not duplicate it globally.

**E** Highest because it fixes the measured-class problem (hidden mobile nav) without a desktop chrome tax. Apple HIG: tab bar for peer top-level sections,  few tabs, labels on, no overflow More if avoidable. [Apple tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars). Material 3: navigation bar for compact windows, about 3–5 destinations. [M3 navigation bar](https://m3.material.io/components/navigation-bar/specs).

**F Constitution 3.** Constitution §16: do not rename to Conversations / Receptionist for style. “Work” hides Calls. Extra hierarchy slows the 8:00 AM path.

**Miller 7±2 is not used as a cap.** NN/g: menu length is not “7 because of short-term memory”; visible menus are recognition, not recall ([NN/g: how many items in a navigation menu](https://www.nngroup.com/videos/number-items-navigation-menu/), [UX Myths #23](https://uxmyths.com/post/931925744/myth-23-choices-should-always-be-limited-to-seven)). The mobile **tab** cap of 3–5 is a **thumb and overflow** constraint (Apple: avoid More), not Miller.

---

## 10. Desktop recommendation

**Keep Model A’s desktop chrome:** sticky top bar, text labels, six destinations, `max-w-desk`.

Why not a sidebar on desktop now:

- Six items are fully visible. NN/g: if you do not need to hide nav, do not.
- Density 8 and Calls tables need width.
- Nested Business nav already occupies a sidebar **inside** `/settings`. A second global sidebar plus a local one is two rails.
- Super Admin already uses a large-screen sidebar. Copying it onto the owner desk blurs the shell split.

When to reopen a desktop sidebar: **when a seventh persistent destination is real** (not speculative Analytics), or when a compact laptop cannot fit six words plus Sign out. Then prefer a **labeled rail**, not icon-only.

Account: move Sign out out of the destination row into a small account control (still in the header). Do not implement in 6A.

---

## 11. Mobile recommendation

**Replace the Menu-as-only-nav pattern** with:

```text
Overview    Calls    Requests    More
```

or, if product later measures Appointments as equally daily:

```text
Overview    Calls    Appointments    More
```

**Default assumption (no analytics):** Overview, Calls, Requests, More. Appointments, Business, Wallet, Sign out live in More.

Rationale:

- Morning phone job is “what needs me” (Overview) then “the call list” (Calls).
- Requests is the other open-work queue. Appointments is time-sensitive but often fewer rows; More is acceptable until data says otherwise.
- Apple: do not overflow into More if you can avoid it. Four tabs plus More is the minimum honest split for six destinations.
- Keep **text labels** under icons (HIG). Do not ship icon-only.
- Keep the tab bar visible while scrolling lists (HIG: hiding it loses orientation). Exception: call-detail primary CTA and full-screen Test may hide or overlay it; decide in 6B with the split-pane exception.
- Do not put Wallet in the four unless low-balance is the dominant mobile job (Home already warns).

Thumb zone: bottom bar is the reachable persistent control. Today’s Menu is top-end (Fitts: small, far, extra tap).

---

## 12. Receptionist implications

### Mental model

Stronger model: **“I am managing my receptionist”** (a working teammate), not “I am using Scalers.” Constitution: operating console for a business’s AI receptionist. Recon: owner manages a receptionist, not an AI settings panel.

That does **not** mean a global tab named Receptionist, Agents, Brain, or AI.

| Owner language | Where it belongs |
| --- | --- |
| Line live / Number pending / Needs training | Home (already) |
| Train, Test, Catalog | Business nested nav (already) |
| Agent name, tone, hours | Business Train panels (already) |
| Fake Online / AI active | Forbidden (constitution, recon, this brief) |

### Should Business remain top-level?

**Yes, for now.** Business is the owner’s word for “the company knowledge and the person who answers the phone.” Splitting Receptionist vs Business vs Train at the **global** level creates a second settings IA, which Phase 6 receptionist spec forbids ([`pages/receptionist.md`](./design-system/pages/receptionist.md): not a new route by default; no second settings IA).

A future split is justified only if owners cannot find Test/Train under Business in testing. Then the honest structure is:

```text
Operate: Overview, Calls, Requests, Appointments
Receptionist: still /settings, possibly retitled later
Billing: Wallet
```

Still **no** new URLs. Title change only, after evidence.

Phase 6B (receptionist UX) should change **language and grouping inside existing fields**, not add a seventh global destination.

---

## 13. Attention / badge strategy

NN/g: badges are **passive indicators**. They are easy to miss and easy to overuse. Slack (official): bold = unread activity; **number = mention / you must look**. Home already answers “what needs me.”

| Signal | Use on nav? | When |
| --- | --- | --- |
| Total calls / all-time count | No | Noise; lists already show totals |
| Unread | Not until a real unread/seen field exists | Do not fake |
| Needs action (e.g. New leads, Open requests) | Maybe later | Only if the number changes the next tap vs opening Overview |
| Line pending / needs training | No badge | Home strip; truthful states only |
| Online / AI active | Never | No backend signal |

If badges ship later:

- Count = **actionable queue size**, tenant-wide head count (same semantics as list tabs), not “3” of mixed urgency.
- Accessible name: “Calls, 3 new,” not color-only.
- Clear when the owner has processed the queue, not when they merely opened the app.
- Do not badge Wallet with balance. Badge only a **true** unpaid/blocked state if product defines one.

Until then, **Home is the attention model.** Nav stays calm.

---

## 14. Global actions

| Action | Placement | Not |
| --- | --- | --- |
| Test receptionist | Business Test + Home derived CTA | Global tab, header FAB |
| Add credit | Wallet primary; Home when low | Persistent header button for everyone |
| Notifications | Out of scope as a destination. Overview is the in-product inbox of work. SMS/WhatsApp/email already notify off-desk | A bell that lists engineering events |
| Help | Later: account/More. Not a seventh destination | Intercom-style always-on messenger required for 6B |
| Account / Sign out | Header account control (desktop); More (mobile) | Peer of Calls |

Primary **page** actions stay on the page (Reply on WhatsApp, Save, Top up). Global nav does not steal the one primary per screen.

---

## 15. Future scalability

Likely future domains (do **not** add now): Receptionist (language), Knowledge, Channels, Contacts, Automations, Analytics, Campaigns, Team, Integrations, Billing, Settings.

Absorption plan:

1. Keep **object workplaces** at the top: Calls, Requests, Appointments, and later Contacts only if it is a real entity with a list job.
2. Keep **configuration** under Business (or a later retitled Receptionist URL-stable `/settings`).
3. Keep **money** under Wallet / Billing.
4. Put rare tools in **More** (mobile) and in an account or overflow (desktop) until a destination earns a permanent slot.
5. Add a desktop sidebar **when the visible destination count no longer fits a top bar**, not before.
6. Never add AI / Brain / Agents / Intelligence as categories.

Paystack’s lesson: delay modules until the core nav matches how merchants think. Do not pre-create empty slots.

---

## 16. Implementation considerations

No implementation in this phase. Notes for 6B+ only.

| Topic | Note |
| --- | --- |
| Routes | Keep `/home` `/calls` `/requests` `/appointments` `/settings` `/wallet` |
| Bookmarks | Visual IA may change; URLs must not |
| `DeskNav.tsx` | Desktop can stay. Mobile needs a new persistent bar; do not keep two competing mobiles (bar + hamburger of the same six) |
| Settings sidebar | Untouched nested IA |
| `--desk-header-h` | Mobile bar needs a matching bottom safe-area token later; do not invent in 6A |
| Active state | Reuse `aria-current="page"` |
| Accessibility | Tab labels, 44px targets, visible focus (Phase 5 ring) |
| Tests | Extend Phase 5 source tests for labels and hrefs; no dashboard E2E today |
| Admin | Do not reuse owner bottom bar |

### Migration complexity by model

| Model | Complexity | Why |
| --- | --- | --- |
| A (status quo) | LOW | Already shipped |
| E mobile-only (recommended first slice) | MEDIUM | New chrome, padding, call-detail overlap, a11y |
| D | MEDIUM | Mostly information, little chrome if desktop top stays |
| B desktop sidebar | HIGH | Layout, tables, `max-w-desk`, visual conflict with settings sidebar |
| C | HIGH | B plus extra IA |
| F | HIGH | Nested routes or fake hierarchy; label rewrite |

---

## 17. Risks

| Risk | Mitigation |
| --- | --- |
| Bottom bar covers Reply on WhatsApp / sticky player | 6B must test call detail and audio player; constitution already allows mobile stack |
| More becomes a junk drawer | Only Business, Wallet, Appointments (if not in the four), account |
| Desktop sidebar fashion request | Defer until destination count requires it |
| Renaming Business → Receptionist too early | Wait for Phase 6 receptionist language pass + owner testing |
| Badges without unread semantics | Do not ship |
| Copying Admin navy sidebar onto owner desk | Forbidden shell merge |
| Command palette as the way to find Calls | Owners on phone will not discover it; keep visible nav |

---

## 18. Final recommendation

Ship **Model E (adaptive)** in this specific form:

- **Desktop:** Model A (current top bar). Six words stay.
- **Mobile:** four persistent destinations + More.
- **Nested:** Business settings sidebar unchanged.
- **Labels:** unchanged through the first nav chrome change.
- **Receptionist:** language inside existing surfaces, not a new global item.
- **Attention:** Home first; badges later and only needs-action.
- **Command palette:** optional later accelerator, never a replacement.

This is the only model that raises mobile task speed without spending desktop table width or inventing hierarchy.

---

## 19. What NOT to copy

- Instagram’s exact tabs, icon-only desktop, or growth-driven center tab
- Linear’s keyboard-first identity as a requirement for SME owners
- Slack’s channel list as information architecture
- Shopify/Stripe/Paystack **left rails** without their object breadth
- Super Admin’s navy sidebar
- Fake Online presence
- AI / Brain / Agents nav groups
- Hamburger on desktop ([NN/g: do not hide desktop nav](https://www.nngroup.com/articles/menu-design/))
- Miller 7 as a menu-size law
- Command palette as primary navigation

---

## 20. Proposed next phase (Phase 6B)

Phase 6B should **not** start with a desktop sidebar.

Proposed 6B scope (chrome only, after product agrees):

1. Mobile bottom bar: Overview, Calls, Requests, More.
2. More: Appointments, Business, Wallet, Sign out.
3. Desktop top bar unchanged (including labels and order).
4. Safe area and overlap audit: call detail CTA, audio player, sticky Save.
5. No route changes. No receptionist rename. No badges. No command palette.
6. Receptionist UX (language/grouping on Test + identity + Home strip) can land in the same program **as a separate PR** so nav chrome stays reviewable.

If 6B is receptionist-only (existing fields), **do not** implement bottom nav in that PR. Navigation chrome is optional and separable.

---

## Sources

Prefer official / NN/g / HIG / design systems. Weak sources marked in place.

- Nielsen Norman Group, [Hamburger Menus and Hidden Navigation Hurt UX Metrics](https://www.nngroup.com/articles/hamburger-menus/)
- Nielsen Norman Group, [Menu-Design Checklist](https://www.nngroup.com/articles/menu-design/)
- Nielsen Norman Group, [Basic Patterns for Mobile Navigation](https://www.nngroup.com/articles/mobile-navigation-patterns/)
- Nielsen Norman Group, [Indicators, Validations, and Notifications](https://www.nngroup.com/articles/indicators-validations-notifications/)
- Nielsen Norman Group, [The 3-Click Rule for Navigation Is False](https://www.nngroup.com/articles/3-click-rule/)
- Apple, [Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)
- Material Design 3, [Navigation bar](https://m3.material.io/components/navigation-bar/specs), [Navigation rail](https://m3.material.io/components/navigation-rail/overview)
- Shopify Polaris, [Top bar](https://polaris.shopify.com/components/internal-only/top-bar)
- Slack Help, [Guide to Slack notifications](https://slack.com/help/articles/360025446073-Guide-to-Slack-notifications)
- Linear Docs, [Joining your team](https://linear.app/docs/joining-your-team-on-linear), [Search](https://linear.app/docs/search)
- Paystack Support, [Finding your way around the new Paystack Dashboard](https://support.paystack.com/en/articles/9040258)
- Stripe, [Design your app](https://docs.stripe.com/stripe-apps/design)
- Intercom Help, [Customize the Inbox](https://www.intercom.com/help/en/articles/7911926-customize-the-inbox-to-suit-you-and-how-you-work-best)
- UX Myths, [Choices should always be limited to 7+/-2](https://uxmyths.com/post/931925744/myth-23-choices-should-always-be-limited-to-seven)

Repo: `DeskNav.tsx`, `(desk)/layout.tsx`, `BusinessSettingsShell.tsx`, `businessSettingsNav.ts`, constitution §16–19, MASTER §6.7, recon shells table, `pages/receptionist.md`.

---

```text
RECOMMENDED MODEL

Desktop:
Sticky top bar. Six text destinations in current order.
No left sidebar until destination count no longer fits.

Mobile:
Bottom bar: Overview, Calls, Requests, More.
More: Appointments, Business, Wallet, account/Sign out.
Labels required. Do not icon-only.

Primary destinations:
Overview, Calls, Requests, Appointments

Secondary destinations:
Business, Wallet

Contextual navigation:
Business settings sidebar (Updates, Catalog, Train, Import, Test). Unchanged.

Global actions:
Test and Top up stay page/Home contextual.
Sign out moves toward account/More (not a workplace).
No notification bell in 6B.
Command palette later as accelerator only.

Attention model:
Home Command Center is the attention surface.
No nav badges until needs-action counts are defined and real.
Never Online / AI active.

Why:
Fixes hidden-nav cost on the owner’s phone without taxing density-8 desktop tables
or inventing hierarchy for six items.

Why not the alternatives:
A alone leaves mobile weak.
B/C spend width and (C) add headers the list is too short to need.
F hides Calls behind Work and fights constitution labels.
Instagram/Linear/Slack chrome without their jobs.

Migration risk:
MEDIUM for mobile bottom bar.
LOW if desktop is left as-is.
HIGH if desktop sidebar is included in the same slice.

Phase 6B:
Either receptionist language on existing fields (separate PR),
or mobile bottom bar + More with desktop unchanged.
Not both in one undifferentiated redesign.
Do not add routes, badges, Online, or a command palette.
```
