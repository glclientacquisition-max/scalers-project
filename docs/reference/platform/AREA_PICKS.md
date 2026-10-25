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

```json
{
  "version": 1,
  "tree_version": "ke-areas-2026-10-24.1",
  "picks": [
    { "node": "county:nairobi", "serve": true, "fee_kes": null, "note": null },
    { "node": "estate:nairobi:kibera", "serve": false, "fee_kes": null, "note": null },
    { "node": "town:kajiado:kitengela", "serve": true, "fee_kes": 500, "note": "Weekends only", "conditions": [] },
    { "node": "town:kiambu:thika", "serve": true, "fee_kes": 800, "note": null,
      "conditions": [{ "kind": "min_bedrooms", "value": 2 }] }
  ]
}
```

Columns: `tenant_id` (pk), `tree_version`, `picks`, `moved_from` (old Locations / coverage list, audit), `confirmed_at` (owner tapped "Looks right"), `updated_by`, `updated_at`. Service role only.

### Per-pick fields

- `serve` (bool): include or exclude. An exclude under a covered county (Kibera under Nairobi) is one tap on the child row.
- `fee_kes` (integer KES, > 0, max 100000, or null): extra travel fee on top of the job price. Edited in the area sheet.
- `note` (string ≤ 120 or null): short caller note. Free text; never parse it for rules.
- `conditions` (array, default `[]`): structured rules Brain reads. Today only `{ "kind": "min_bedrooms", "value": 1..10 }`
  ("from 2 bedrooms up"). One per kind. Unknown kinds are dropped on read. Excludes always have `[]`, null fee and note.
  Missing on older rows = `[]`.

### Confirm

- `confirmed_at` set = owner confirmed; Brain #942 answers only from confirmed picks.
- The owner's own Save on Service areas confirms too: `confirmed_at` = `updated_at` (same stamp).
- `updated_at` more than 2 s after `confirmed_at` = changed by someone else since confirm ("edited"). Desk shows the
  confirm card on Service areas and an "Is this right?" row on Desk home until the owner confirms.
- Seeding from the old list (`scripts/seed-area-picks-from-old.ts`) writes rows with `confirmed_at` null.

## Resolving a place (both sides must do this the same way)

1. Match the caller's words to a node: exact name or alias, then landmark, then loose spelling (edit distance ≤ 1 for 4 letters, ≤ 2 for 5+).
2. Walk from that node up to Kenya. The **nearest pick wins**: `serve: true` = covered, `serve: false` = not covered. No pick anywhere = not covered.
3. Fee, note and conditions: each from the nearest serving pick on the path that sets it (stops at an exclude).
4. No node matched: ask "Which area is that near?" Do not guess.

Reference implementation: `dashboard/src/lib/areaPicks.ts` (`resolveArea`, `matchAreaText`, `callerHears`). Tests: `tests/areaPicks.test.ts`.

## What callers hear (Desk preview = bot target)

- Covered: "Yes, we cover {name}." + " There's an extra KES {fee}." when set + " In {name} we take jobs from {n} bedrooms up." when `min_bedrooms` is set + " {note}." when set.
- Not covered: "Sorry, we don't cover {name}."
- Not on map: "Which area is that near?"

## Not yet wired

- Voice still reads `business_policies.coverage_areas` / `tenants.service_areas`. Brain switches its KB check to this table behind its own flag; until then the old fields stay the source for calls. Saving here does not rewrite them.
