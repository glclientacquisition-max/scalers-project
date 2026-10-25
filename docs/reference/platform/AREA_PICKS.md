---
owner: platform
last_reviewed: 2026-10-24
---

# Service area picks (Desk ↔ Brain contract)

Owner Desk › Settings › **Service areas** (`/settings/areas`) writes one row per business in
`public.tenant_area_picks`. Brain's KB coverage check reads the same row. SQL:
[`docs/supabase/tenant_area_picks.sql`](../../supabase/tenant_area_picks.sql) (down: `tenant_area_picks_down.sql`).

## Area tree

- Seeded in the repo: `dashboard/src/lib/data/kenyaAreaTree.v1.json`, `version` like `ke-areas-2026-10-24.1`.
- Levels: `ke` (Kenya) › 47 counties (`county:<slug>`) › major towns (`town:<county>:<slug>`) and estates (`estate:<county>:<slug>`).
- Each node: `id`, `name`, `kind`, `parent`, `aliases[]` (other spellings, short names, Kiswahili or street names), `landmarks[]` (malls, hospitals, stations inside it).
- A name that is both a county and a town (Kiambu, Nakuru, Machakos…) has two nodes. Moving old lists over asks the owner which one they meant (default: whole county).
- Tree changes ship as a new `version`. Ids are never reused for a different place. Unknown ids in stored picks are dropped on read.

## Stored shape

One row per pick in `public.tenant_area_picks`:

| Column | Meaning |
| --- | --- |
| `tenant_id` | Business (with `node`, forms the primary key) |
| `node` | Tree id (`county:nairobi`, `town:…`, `estate:…`, or `ke`) |
| `serve` | `true` include, `false` exclude |
| `fee_kes` | Optional extra fee (KES) on serving picks |
| `note` | Optional line for callers |
| `confirmed_at` | Set when the owner taps "Looks right"; `null` = not yet checked |
| `tree_version` | Kenya area tree version for this tenant's picks |
| `moved_from` | Legacy Locations / coverage ids (audit; same on each row when set) |
| `updated_by`, `updated_at` | Last Desk save |

Desk loads rows into `{ version: 1, tree_version, picks: AreaPick[] }` in memory. Brain #960 reads the same columns. Service role only.

## Resolving a place (both sides must do this the same way)

1. Match the caller's words to a node: exact name or alias, then landmark, then loose spelling (edit distance ≤ 1 for 4 letters, ≤ 2 for 5+).
2. Walk from that node up to Kenya. The **nearest pick wins**: `serve: true` = covered, `serve: false` = not covered. **No pick on the chain** = the assistant checks with the owner (never "not covered").
3. Fee and note: the nearest serving pick on the path that sets them (stops at an exclude).
4. No node matched: ask "Which area is that near?" Do not guess.

Reference implementation: `dashboard/src/lib/areaPicks.ts` (`resolveArea`, `matchAreaText`, `callerHears`). Tests: `tests/areaPicks.test.ts`.

## What callers hear (Desk preview = bot target)

- Covered: "Yes, we cover {name}." + " There's an extra KES {fee}." when set + " {note}." when set.
- Explicit exclude (`serve: false` on the chain): "Sorry, we don't cover {name}."
- No pick on the chain: "I'll check with the owner about {name}."
- Not on map: "Which area is that near?"

## Not yet wired

- Voice coverage is Brain PR #960 (`areaCoverage.js`). Until that ships, calls still use legacy `business_policies.coverage_areas` / `tenants.service_areas`. Saving Service areas does not rewrite those columns.
