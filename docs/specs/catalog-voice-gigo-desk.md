# Catalog, voice facts, and Settings portrayal

**Status:** Plan (2026-10-07)  
**Lanes:** Desk UI/UX (presentation + import UX), Brain (compile + suggest normalization), Platform (optional RPC batch confirm, schema only if `spoken_name` added later)

**Goal:** Callers hear clear, confirmed facts. Owners manage catalogue on a phone-first Settings surface aligned with Frontend 2.0.

---

## Problem (summary)

1. **GIGO:** Import and seed rows are not owner facts until confirm; voice uses `factProducts` / `factServices` only.
2. **Label quality:** One `name` field holds shorthand, matching, and speech; no polish-on-import.
3. **Vertical:** `retail` vs `home_services` differ in data (products hidden), compile (job sections), and inbox queues—but Settings catalog UI is still table-first and looks the same.
4. **Presentation:** Charter `ListRow`, `Stamp`, `Sheet` exist; `TenantForm` catalog blocks do not use them yet.

---

## Principles

- **No silent rewrite of facts.** Any AI polish produces **suggested** rows or a diff the owner confirms (Save + GIGO paths).
- **Use existing fields first:** `aliases`, `price_mode`, `pricing_mode`, `site_visit_required`, `out_of_scope` before new columns.
- **Vertical switches presentation and copy, not duplicate schemas.**
- **Small PRs:** shippable after each phase; Playwright gate on Settings/catalog when UI changes.

---

## Track A — Finish trust path (GIGO at scale)

**Branch:** `cursor/gigo-owner-attest-scale-b27a` (draft PR)  
**Mostly done:** save attestation, meta-driven confirm lists, Home nudge, settings nav counts.

**Owner approval model:** Save on Settings / Alerts / Bulletin runs `ownerAttestFields` for that scope. There is no separate Confirm control in the desk UI.

**Remaining before merge:**

| Task | Owner | Done when |
| --- | --- | --- |
| CI green on PR | Desk | lint, build, desk tests |
| Spot-check Save attests import rows on catalog panel | Desk | meta `source=owner` after save |

**Do not block Track B on merge**, but **Track C stamps** should read the same `fieldMeta` this PR wires.

---

## Track B — Catalog normalization (voice quality at source)

**Lane:** Brain owns suggest logic + compile consumption; Desk owns import UI and applying suggestions.

### B1. Pure suggest function (no LLM required for v1)

**New:** `dashboard/src/lib/catalogSuggest.ts` (and mirror or shared test in `tests/catalogSuggest.test.js`)

Input: raw import row (product or service) + optional `vertical`.  
Output: `{ name, aliases[], price_mode?, pricing_mode?, notes?, confidence: 'rule' | 'weak' }`

**Rules (v1):**

- Expand common abbreviations when unambiguous (`96pg` → alias; propose full `name` if pattern `^\d+\s*pg`).
- Split `Title - quotation|quote|from X` → `name` + `pricing_mode: ask` or `from` + price fragment to `price_range` / `price`.
- Trim punctuation noise on names; never drop price text—move to price fields.
- **Do not** auto-set `source: owner`; tag import as `import` until confirm.

**Tests:** table-driven cases from real owner paste (book shop, carpet cleaning, print shop).

### B2. Wire suggest into import paths

| Entry | File | Behavior |
| --- | --- | --- |
| CSV / paste products | `parseProductCsv` consumer in `TenantForm` / `ingestActions` | Run suggest on each row; preview shows before/after |
| Bulk services paste | `parseBulkServices` in `servicesCatalog.ts` | Same |
| Settings ingest merge | `dashboard/src/app/(desk)/settings/ingestActions.ts` | Suggest on merged rows; meta `source=import` |

Preview copy: “Suggested cleanup” with owner ability to edit before Add.

### B3. Optional B2.5 — LLM polish (Brain)

Only after B1 ships:

- Server action or compile-adjacent job: batch suggest for large imports (cap rows per request).
- Same contract: output is **suggested**; Desk shows diff; confirm via existing GIGO confirm or save attest.

**Voice compile:** No change required if stored rows are clean; optional Brain tweak to prefer `aliases` in matching text only (already in entity extraction).

### B4. Future: `spoken_name` (Platform + Brain)

Only if owners insist on internal SKU in `name`:

- Add optional column/JSON leaf + `field_path` in provenance doc.
- Compile + TTS path: `spoken_name ?? name`.
- Defer until B1–B2 prove insufficient.

---

## Track C — Settings catalog portrayal (Frontend 2.0)

**Lane:** Desk only. **Do not** change RPC or compile semantics in this track.

### C1. Extract catalog sections from `TenantForm.tsx`

**New components** (under `dashboard/src/components/settings/catalog/`):

| Component | Responsibility |
| --- | --- |
| `CatalogSectionShell.tsx` | Vertical title, blurb, empty state |
| `ServiceCatalogEditor.tsx` | State for services list + bulk sheet trigger |
| `ProductCatalogEditor.tsx` | Products (retail only); hidden when `vertical === 'home_services'` |
| `CatalogListRow.tsx` | One row: ListRow + Stamp + edit/remove actions |
| `CatalogImportSheet.tsx` | Sheet: paste area, preview list, Apply |

**TenantForm** composes these; target shrink ≥ 400 lines from form over time.

### C2. ListRow + Stamp mapping

Per row, derive:

| Signal | Stamp variant |
| --- | --- |
| Unconfirmed import (`fieldMeta` / `source`) | Suggested |
| `price_mode` / `pricing_mode` ask | Ask price |
| `from` / `range` | From / Range (tonal) |
| `in_stock` no | Out |
| `site_visit_required` true | Visit |
| `holdable` true (product) | Hold |
| Owner confirmed | none or Live (optional, sparingly) |

Use **`Stamp`** from `components/ui/Stamp.tsx`; one stamp per row (charter).

Mobile: `<ul className="divide-y divide-hairline">` of `CatalogListRow`.  
Desktop `lg+`: keep compact table **or** master-detail; same row component for stamps.

### C3. Vertical IA

| Vertical | Catalog tab |
| --- | --- |
| `retail` | `Segmented`: Products \| Services (default Products if catalogue non-empty) |
| `home_services` | Single “Services” stack only |
| `hospitality` / `general` | Services + Products as today until hospitality pack exists; empty state honest |

Copy from `verticalBlurb()` + `/no-ai-slop` pass on empty states and Sheet titles.

### C4. Import via Sheet

Replace catalog `<details>` bulk blocks with:

- Button: “Paste or import” → `CatalogImportSheet`
- Reuse suggest preview from Track B
- On Apply: append rows, open confirm list if import source

Motion: desk-motion Sheet only; no new motion library.

### C5. Save is approval

- No separate Confirm control in Settings. Successful **Save** calls `ownerAttestFields` for every path in that panel’s scope (plus `owner_field_paths` for edited rows).
- Optional Stamp “Suggested” on list rows is display-only until the owner saves that section.

### C6. Proof

- Extend Playwright or `/dev/kit` fixture: retail + home_services catalog rows with stamps visible at 360/390.
- `npm run lint && npm run build && npm run test:e2e` before PR ready.

---

## Track D — Hospitality (later)

**Blocked on product:** `HOSPITALITY_RESERVATIONS_EXIST` and booking model.

Until then:

- Do not promise room/rate catalogue in voice.
- Inbox copy already partial via `nicheCopy`; Settings empty state: bookings not on line yet.

When product exists: new row type or service flags (`room`, `rate_plan`) — separate spec.

---

## Recommended PR order

| # | PR title (draft) | Track | Risk |
| --- | --- | --- | --- |
| 1 | GIGO owner attest + Settings confirm UI | A | Low (in review) |
| 2 | Catalog suggest rules on import | B1–B2 | Low; tests only touch lib |
| 3 | Settings catalog ListRow + vertical shell | C1–C3 | Medium; UI |
| 4 | Catalog import Sheet + suggest preview | C4 + B2 UX | Medium |
| 5 | LLM batch suggest (optional) | B3 | Brain review |
| 6 | spoken_name (optional) | B4 | Platform + Brain |

**Parallelism:** PR 2 can start on `main` after PR 1 merges (or branch from main while 1 is in flight). PR 3 should rebase on main after 1 to avoid `TenantForm` conflicts.

---

## Agent chat starters

**Desk (Track C):**

```
Desk UI/UX. Read docs/specs/catalog-voice-gigo-desk.md Track C.
FRONTEND_2_0_CHARTER + desk-motion. Extract catalog from TenantForm into settings/catalog/*.
ListRow + Stamp + Sheet. No compile/RPC changes.
```

**Brain (Track B):**

```
Brain. Read docs/specs/catalog-voice-gigo-desk.md Track B.
Implement catalogSuggest.ts + tests; wire ingestActions and bulk paste preview.
Output stays import until owner confirm. Do not weaken factProducts/factServices.
```

---

## Success checks

1. Owner imports `Carpet cleaning - quotation` → preview shows name “Carpet cleaning”, pricing ask; after confirm, live call can state service and “we’ll quote on visit” from facts block.
2. Shop owner sees Products vs Services segmented; home services owner never sees Products block.
3. Unconfirmed import rows show **Suggested** stamp and count toward Settings “N to confirm”.
4. Playwright captures catalog at 360 light/dark without table overflow.
