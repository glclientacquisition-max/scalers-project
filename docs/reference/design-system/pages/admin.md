---
owner: desk
last_reviewed: 2026-10-22
---

# Super Admin

**Route:** `/admin`  
**Job:** Ops console for platform, packages, businesses, numbers, voices, and call quality.

> **v2 (proposed, behind `ADMIN_V2`).** The rebuild IA and module registry are in [§ v2 IA and module registry](#v2-ia-and-module-registry-proposed) below. The design layer is [`OPS.md`](../OPS.md). Everything above that section describes v1, which stays the default until each module reaches parity.

**Chrome:** Icon rail on `md+`. Bottom tabs below `md`. Same account header as the owner desk: initials open `Appearance · <current>` (System / Light / Dark, On this device) and Sign out. The link list is `ADMIN_LINKS`: Today, Businesses, Calls, Billing, Numbers, Platform, Activity, Settings. It is not the owner desk list. Calls opens Quality (`/admin/quality`) until the Calls list exists. Activity (`/admin/activity`) lists every admin write, newest first: two filter rows (Business, Operator) open ChoiceSheets, and a row opens a Sheet with who, business, why, and before and after. The business sheet links to Activity filtered to that business. Settings opens Voices. Packages and the old Ledger sit under Billing. The phone bar shows Today, Businesses, Calls, Billing, and More. More opens a bottom sheet with Numbers, Platform, Activity, and Settings. The bar does not scroll sideways. A nested admin screen hides the phone tabs and shows one control named for the parent admin list. Quality records use the breadcrumb for that trip, so they do not also show the chevron. Hits are at least 44px. Focus ring is the brand ribbon. Filled primary is accent fill with an on-fill label.

Sign-in is `/admin/login` (username and access code). It uses the owner sign-in field density and stays off `/login`. Today (`/admin`) is a status line, one Needs you queue (including businesses whose quality is dropping), and today's calls against the same stretch last week. Plain rows, no KPI tiles, no telecom table. It reads only: the notice check and alert mail do not run on page load.

Quality (`/admin/quality`) opens with the title Quality and the line "Traced calls, worst first." The table is worst first: score, trend, top failure, Dropping with the reason in text, calls traced, last call. A phone row says "1 call" when the count is one, and Steady in muted text when the business is not dropping. Search by business name. 7 days and 30 days are underline tabs. Release before/after sits under the table. A business record has a breadcrumb back to Quality, then lists calls, repeat failures, and Couldn't answer. A call shows a breadcrumb back to Quality and to that business, then Score and the number in the same mark as each turn, failing checks, one diagnosis line, and a turn timeline. A failed tool keeps its name, and the word Failed uses the attention color. Ok stays in the body color. Save as test downloads a fixture. It does not write the repo. Reads use the service-role client on `public.voice_turn_traces` and the call recording. Each turn shows its stored score and failing checks. A turn or call with no stored checks says "Not logged", never "No failures". The timeline labels are Caller said, Heard, Language, Tool, Filler, Model output, Transforms, Spoken, Barge-in, and Latency. No vendor or model names show. Releases are named by label or first-call date, not the git SHA. Detected language uses the persisted field when it is there. Tool and filler rows say "Not logged" until those stages are stored. A filler says Played only when the stage stored played true. Couldn't answer lists questions from turns that ended in an error, a stream timeout, or a speech fallback (`speech_guarantee`, `speech_quiet`), or that played the recovery or unavailable line. A call with no recording, or a recording that returns 403 or 404, says "No recording for this call". Owner sessions never reach these routes.

Do not send an admin session into owner routes, or an owner session into admin routes.

## v2 IA and module registry (proposed)

Source: [`ADMIN_FOUNDATION_PLAN.md`](../../operations/ADMIN_FOUNDATION_PLAN.md) §3 and §5. Billing IA detail folded in from PR #812: [`admin-billing-ia-research.md`](../../../rfcs/admin-billing-ia-research.md) and [`2026-10-18-admin-ops-workflows-design.md`](../../../superpowers/specs/2026-10-18-admin-ops-workflows-design.md).

### Nav

Overview is home. 12 modules in 4 groups:

| Group | Module | Route | Step 1 state |
| --- | --- | --- | --- |
| Overview | Overview | `/admin` | Today's content inside the new shell |
| Operate | Businesses | `/admin/businesses` | v1 inside shell |
| | Numbers | `/admin/numbers` | v1 inside shell |
| | Quality | `/admin/quality` | v1 inside shell |
| | Voices | `/admin/voices` | v1 inside shell |
| Money | Billing (Invoices, Payments, Collections, Credit notes) | `/admin/billing/*` | Invoices and Payments v1; others hidden |
| | Packages and pricing | `/admin/packages` | v1 inside shell |
| | Usage and costs | `/admin/usage` | hidden |
| Insights | Analytics | `/admin/analytics/*` | hidden |
| System | Platform health | `/admin/platform` | v1 inside shell |
| | Notifications | `/admin/notifications` | hidden |
| | Audit log | `/admin/audit` | v1 Activity at `/admin/activity` until the audit feed exists |
| | Settings | `/admin/settings` | New: Settings › Security only |

Hidden means not in the nav, not in ⌘K, and the route 404s. No "Coming soon".

Billing mental model (from #812): three layers, never mixed in copy. **Package** is what a business is metered on. **Beta or Charging** is whether we charge yet. **Invoices and payments** are money collection. Admin surfaces state and exceptions; the system runs the rules. Package removal gets a UI (Remove package → confirm sheet: now or end of period, reason).

### Flag

- Same URLs for v1 and v2; no `/admin/v2` prefix. `/admin/login` is shared and unchanged.
- `ADMIN_V2`: `off` (default), `on`, or a comma list of usernames. The console layout reads it once and renders `OpsShell` or today's shell.

### Shell

- `md`+: 232px sidebar (collapses to 56), 48px top bar (breadcrumb, ⌘K, env pill, operator menu). Content to 1600px, 24px gutters. Right drawer 480 to 640px.
- Below `md`: top bar plus a sheet nav. Writes are allowed, with the same step-up rules as desktop (per Scalers Chief relaying Alvin, 22 Oct 16:55 EAT).
- Environment: 3px band plus a pill, Production (danger) or Staging (accent), from `ADMIN_ENV`. Unknown shows Production.
- Overlays: bottom sheet on phones, right drawer at `md`+. **No centred modals** (see [`OPS.md` §3](../OPS.md#3-overlays-locked-22-oct-2026)).

### Module registry contract

One typed list in `dashboard/src/lib/ops/modules.ts`. v1 keeps `adminLinks.ts` untouched.

| Field | Purpose |
| --- | --- |
| `id`, `label`, `group`, `href`, `children` | Nav, breadcrumb, ⌘K "Go to" |
| `status` | `hidden` / `v1` / `v2` |
| `attention` | Optional server function returning Needs-attention rows `{ severity, count, label, href }`. Overview merges them (max 8) |
| `intents` | Sensitive action ids from `lib/adminSensitive.ts` (see [`ADMIN_STEP_UP.md`](../../platform/ADMIN_STEP_UP.md)) |
| `owner` | Lane that owns the data and behaviour, for review routing |

A new module plugs in by adding one entry. It appears in the nav only when `status` is not `hidden`.
