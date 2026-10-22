---
owner: desk
last_reviewed: 2026-10-22
status: proposed
---

# Ops design layer (`/admin` only)

The Ops layer is the dense design layer for the Super Admin console. It sits on top of [`MASTER.md`](MASTER.md): same brand colours, same system font, same light and dark themes, same Base UI behaviour. It changes density, type size and adds status, environment and chart tokens. It is never imported by owner Desk routes.

Source: [`ADMIN_FOUNDATION_PLAN.md`](../operations/ADMIN_FOUNDATION_PLAN.md) §2 and [`ADMIN_REBUILD_RESEARCH.md`](../operations/ADMIN_REBUILD_RESEARCH.md) §2. Charter amendment: [`FRONTEND_2_0_CHARTER.md` §11](../../explanation/frontend/FRONTEND_2_0_CHARTER.md#11-admin-amendment-ops-layer-2026-10-22).

Status: **proposed**. Needs Alvin's yes on question 9 of the plan before any Ops UI merges.

## 1. Scope

| In | Out |
| --- | --- |
| `/admin/**` under the v2 shell (`ADMIN_V2`), `/admin/_kit` on staging | Owner Desk, `/login`, marketing, email templates |
| `dashboard/src/styles/ops.css`, `dashboard/src/components/ops/**`, `dashboard/src/lib/ops/**` | Forks of `components/ui/**`. Where an Ops control is a Desk control at a smaller size it gets a `size="ops"` variant reviewed by Desk |
| `ops-` prefixed Tailwind keys (additive only) | Changing any existing Tailwind key or `globals.css` token |

## 2. Tokens

All tokens are CSS variables scoped to `.ops-theme` in `dashboard/src/styles/ops.css`. New hex values live only in that file. No hex in `.tsx`.

| Group | Tokens | Values |
| --- | --- | --- |
| Type | `--ops-text-kpi`, `-title`, `-heading`, `-body`, `-label`, `-caption` | 28/32 600 · 20/26 600 · 15/20 600 · 13/18 400 · 12/16 500 · 11/14 400. `.ops-num` sets tabular numerals. |
| Space | `--ops-space-1…6` | 4, 8, 12, 16, 24, 32 |
| Density | `--ops-row-compact`, `--ops-row`, `--ops-row-touch` | 28, 36, 44. Below `lg` interactive rows use 44. |
| Radius | reuse `sm` 6, `lg` 10 | Controls and cells 6; cards, sheets, drawers 10; pills full |
| Surface | reuse `--canvas`, `--surface*`, `--hairline` | Separate by tone, not lines. Shadow only on sheet, drawer, popover, palette |
| Status | `--ops-status-{ok,info,warn,danger,neutral,beta}-{fg,bg}` | Every pill carries the word, never colour alone (WCAG 1.4.1) |
| Environment | `--ops-env-prod`, `--ops-env-staging` | 3px band plus a pill with the word. Unknown env shows Production |
| Chart | `--ops-chart-1…8`, `--ops-chart-seq-1…5`, `--ops-chart-up`, `--ops-chart-down` | Categorical, sequential and diverging sets in both themes |
| Motion | none new | Desk motion verbs only. No motion packages. Charts never animate |

Contrast gate: every `fg` on its `bg`, and body ink on every surface, is 4.5:1 or better in both themes. A unit test parses `ops.css` and fails the build otherwise.

## 3. Overlays (locked 22 Oct 2026)

**No centred modals in Admin.** This is the same rule as the owner Desk.

| Width | Pattern |
| --- | --- |
| Below `md` (phone) | Bottom sheet (`ConfirmSheet` pattern): grab handle, title, facts, actions at the thumb |
| `md` and up | Right side drawer, 480 to 640px, same content and order |

The plan's `ConfirmDialog` is built as **`OpsConfirm`**, and its `StepUpDialog` as **`StepUpSheet`**. Both use the responsive sheet and drawer pattern above. Behaviour comes from the existing Sheet primitive (Base UI). No Radix, no shadcn runtime, no centred `Dialog`.

Confirm strengths:

| Strength | When | Shape |
| --- | --- | --- |
| `light` | Reversible change | Title, one fact line, Cancel and Confirm |
| `money` | Moves money or minutes | Adds an amount row (`Money`) and a required reason |
| `destructive` | Irreversible | Danger tone, typed confirmation word, Confirm disabled until it matches |

Step-up (slice 5) adds the code field to the same sheet. It never opens a second overlay on top.

## 4. Primitives

| Primitive | Contract |
| --- | --- |
| `PageHeader` | Title, optional count, actions. No subtitle sentence |
| `StatusPill` | Tone plus the word. Never colour alone |
| `Money` | Integer KSh in. `en-KE` grouping. `KSh 0`, never blank. Negatives as `−KSh 1,200` |
| `KpiTile` | Label, value, optional delta and `Sparkline`. Max 6 per row |
| `Sparkline` | Server SVG, fixed height, `aria-label` with first and last value |
| `Skeleton` | Shaped to the content it replaces |
| `EmptyState` | Names the next action. No illustration |
| `ErrorState` | What failed, in plain words, plus Retry |
| `Drawer` | Bottom sheet below `md`, right drawer at `md`+ |
| `OpsConfirm` | §3 strengths |

Later slices add `OpsShell`, `Sidebar`, `TopBar`, `EnvBand`, `CommandPalette`, `DataTable`, chart wrappers and `StepUpSheet`.

## 5. Copy

Plain words, sentence case, no vendor or infrastructure names on screen, no "Coming soon". A banned-word test runs over `lib/ops/**` and the kit page.

## 6. Layout

- Phone-safe at 360 and 390: no horizontal scroll, touch rows 44.
- `md`+: 232px sidebar, 48px top bar, content fluid to 1600px, 24px gutters.
- Below `md`: money and number writes render disabled with the reason; approvals and step-up work on phone (plan question 8, open).
