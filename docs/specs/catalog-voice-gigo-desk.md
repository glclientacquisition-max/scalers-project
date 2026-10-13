# Catalog, voice facts, and Settings portrayal

**Status:** Shipped v1 on `main` (2026-10-07, squash **#598** `33af1303`)  
**Lanes:** Desk UI/UX (presentation + import UX), Brain (compile + suggest normalization), Platform (optional RPC batch confirm; schema only if `spoken_name` is added later)

**Goal:** Callers hear clear, confirmed facts. Owners manage catalogue on a phone-first Settings surface aligned with Frontend 2.0.

---

## As-built on `main` (source of truth)

### Owner approval (GIGO)

| Behavior | Implementation |
| --- | --- |
| Settings **Save** attests scoped field paths | `dashboard/src/app/(desk)/settings/actions.ts` → `fieldPathsAttestedOnSettingsSave` + `ownerAttestFields` |
| Alerts / Bulletin **Save** attests notify paths | `alertsActions.ts`, `bulletinActions.ts` |
| Path builder (identity, hours, policies, **catalog**, FAQs, …) | `dashboard/src/lib/fieldPathsFromSettingsSave.ts` |
| Registry + cleanup | `dashboard/src/lib/fieldPathRegistry.ts` |
| Server attest (meta + JSON confirm) | `dashboard/src/lib/ownerAttestFields.ts` |
| Legacy one-off confirm RPC wrapper | `provenanceActions.ts` (thin; desk has **no** Confirm button) |

**Catalog paths on save:** for each non-empty product/service name in the save payload, `catalog.product.{sku\|index}.name` and `catalog.service.{n}.name` are attested when scope includes `productCatalog` / `servicesCatalog`.

**Removed from desk:** `CaptureConfirmList.tsx`, settings nav “N to confirm”, unattested counts driving a separate confirm flow.

**Home:** `HomeReviewSettingsNudge.tsx` points at the next completeness gap (“add, then save”), not a confirm queue.

### Catalog suggest (rule-based v1)

| Piece | Path |
| --- | --- |
| Suggest rules + `source: import` until save | `dashboard/src/lib/catalogSuggest.ts` |
| Unit tests | `tests/catalogSuggest.test.js` |
| Bulk paste + preview in Settings | `TenantForm.tsx` + `CatalogImportSheet.tsx` |
| Ingest merge | `ingestActions.ts` → `suggestImportedServices` on merged services |

**Not wired on `main` yet:** `catalogActions.ts` product URL/CSV import does **not** call `catalogSuggest` (still local parse / optional Gemini extract).

### Settings catalogue UI (partial Track C)

| Shipped | Path / note |
| --- | --- |
| Section shell (vertical blurb, empty copy) | `CatalogSectionShell.tsx` |
| Import **Sheet** (paste, suggested preview, Apply) | `CatalogImportSheet.tsx` |
| Stamp helper (Suggested, Ask price, From) | `catalogStamp.tsx` |
| ListRow wrappers | `CatalogListRow.tsx` (**exported**; **not** used in `TenantForm` yet) |
| Editor module stubs | `ProductCatalogEditor.tsx`, `ServiceCatalogEditor.tsx` (re-export only) |
| Catalogue tab body | Still largely **inline in `TenantForm.tsx`** (mobile grid + desktop tables) |

**Vertical:** `home_services` hides the products block; retail shows services + products stacks. **Products \| Services** `Segmented` on the catalogue tab is **not** shipped yet.

### Voice / compile (tangential in #598)

- `src/conversation/knownFacts.js`, `src/speech/ttsNormalize.js` updates + tests (pronunciation / facts edge cases).

### Automated proof in repo

| Gate | Command / note |
| --- | --- |
| Attest wiring | `node --test tests/fieldPathAttest.test.js` |
| Suggest rules | `node --test tests/catalogSuggest.test.js` |
| Desk lint + build | `cd dashboard && npm run lint && npm run build` |
| Playwright | `e2e/structure.spec.ts` on dev fixtures (`/dev/settings`, `/dev/home`, …); dedicated `/dev/settings-catalog` fixture **not** on `main` |

---

## Problem (original → now)

| # | Original pain | v1 outcome | Still open |
| --- | --- | --- | --- |
| 1 | Import rows not owner facts until confirm | **Save** attests paths; compile still uses `factProducts` / `factServices` + `fieldMeta` | Manual proof on live tenant (playbook below) |
| 2 | One `name` field, messy paste | Rule suggest on paste/ingest; preview before Add | LLM batch polish (B3); `spoken_name` (B4) |
| 3 | Same table UI for all verticals | Blurb + hide products for home services | Retail **Segmented** Products \| Services; full ListRow mobile |
| 4 | Charter kit unused on catalogue | Sheet import + stamp **library** | Wire stamps + `CatalogListRow` into live rows; shrink `TenantForm` |

---

## Principles (unchanged)

- **No silent rewrite of facts.** AI polish (when added) stays **suggested** until owner **Save** (or explicit attest).
- **Use existing fields first:** `aliases`, `price_mode`, `pricing_mode`, `site_visit_required`, `out_of_scope` before new columns.
- **Vertical switches presentation and copy, not duplicate schemas.**
- **Small PRs** with Playwright when catalogue UI changes.

---

## Track A — GIGO at scale

**Status:** **Done** (#598).

**Owner approval model:** Save on Settings / Alerts / Bulletin runs `ownerAttestFields` for that scope. There is **no** separate Confirm control in the desk UI.

| Task | Status |
| --- | --- |
| CI green | Done at merge |
| Wiring tests (no CaptureConfirmList) | `tests/fieldPathAttest.test.js` |
| Spot-check Save attests import rows on catalog panel | **Manual** — [Verification playbook](#verification-playbook) |

---

## Track B — Catalog normalization

**Status:** **B1–B2 done** (rule suggest + main import paths). **B3–B4 deferred.**

### B1. Pure suggest function — **shipped**

Input: product or service row + optional `vertical`.  
Output: cleaned row + `CatalogSuggestMeta` (`confidence`, `changed`); row `source` stays `import` until owner save/attest.

Rules implemented: pg shorthand → alias + expanded name; quotation/quote tails → ask pricing; from-price tail split; trim noise; never drop price text.

### B2. Wire suggest — **shipped / gaps**

| Entry | Status |
| --- | --- |
| Bulk services/products paste in Settings | Shipped (`TenantForm` + `CatalogImportSheet`) |
| Settings ingest merge (services) | Shipped (`ingestActions.ts`) |
| `catalogActions.ts` URL/CSV/Gemini product import | **Gap:** no `catalogSuggest` yet |

Preview copy in sheet: “Suggested cleanup on N rows”.

### B3. LLM batch suggest (Brain) — **not started**

Cap rows per request; same contract as B1; desk shows diff; owner confirms via **Save**.

### B4. `spoken_name` (Platform + Brain) — **deferred**

Only if internal SKU in `name` is insufficient after B1–B2.

---

## Track C — Settings catalog portrayal

**Status:** **Partial** (shell + sheet + stamp lib; form still monolithic).

### Shipped

- C1 partial: `CatalogSectionShell`, `CatalogImportSheet`, stamp/list modules (list not wired).
- C4 partial: “Paste list” opens sheet (services + products); not all legacy `<details>` bulk UI removed.
- C5: **Save is approval** (see Track A).

### Remaining (recommended follow-up PRs)

| ID | Work | Done when |
| --- | --- | --- |
| C1b | Move catalogue state/UI into `ServiceCatalogEditor` / `ProductCatalogEditor`; `TenantForm` composes only | ≥400 lines removed from form |
| C2 | Wire `catalogRowStamp` on every row; priority: Suggested > Ask > From > Range > Out > Visit > Hold | One `Stamp` per row, charter tokens |
| C2b | Mobile: `CatalogListRow` + `divide-y divide-hairline` | Same stamps as desktop |
| C3 | Retail: `Segmented` Products \| Services; home_services: services-only stack | Spec vertical IA table |
| C4b | Single “Paste or import” entry; drop duplicate bulk blocks | One sheet pattern |
| C6 | `/dev/settings-catalog` fixture + Playwright route | 360/390/768/1280 light/dark, no overflow |

---

## Track D — Hospitality

**Status:** Unchanged — blocked on `HOSPITALITY_RESERVATIONS_EXIST` and booking model. No room/rate catalogue in voice until product spec exists.

---

## Verification playbook

Use this to close Track A spot-check and success check #1. Needs a dev or staging tenant with desk login and DB visibility (Supabase `tenant_field_meta` or provenance UI if exposed).

### 1. Suggest on paste (desk only)

1. Open **Settings → Catalogue** (retail or home_services tenant).
2. **Paste list** → enter `Carpet cleaning - quotation` (one line).
3. **Expect:** preview name “Carpet cleaning”, pricing ask / ask stamp signal in preview meta (not necessarily visible stamp until row is added).
4. **Add to services** → row appears with `source: import` (if shown in UI or network payload).

### 2. Save = owner attest (GIGO)

1. Without editing the row name, click **Save** on Settings (catalogue scope included in save).
2. **Expect:** save succeeds; no Confirm button anywhere.
3. **DB / meta:** for path `catalog.service.{n}.name` matching that row, `tenant_field_meta.source` → `owner` (or confirmed flag consistent with `persistOwnerConfirm`).
4. **Recompile:** trigger compile if your env requires it; inspect compiled facts block includes the service name with owner-classified meta.

### 3. Voice fact consumption (Brain / Voice lane)

1. Place a test call (or run compile + `knownFacts` unit path) after step 2.
2. **Expect:** service appears in owner-trusted facts; quotation-style service does not read as literal “Carpet cleaning - quotation” on the line.
3. **Expect:** agent can describe quote-on-visit behavior from `pricing_mode` / policies, not from unconfirmed import meta.

### 4. Regression guards (CI)

```bash
node --test tests/catalogSuggest.test.js tests/fieldPathAttest.test.js
cd dashboard && npm run lint && npm run build
# With dev server on 3020 or 3077:
cd dashboard && E2E_BASE_URL=http://localhost:3020 npx playwright test e2e/structure.spec.ts
```

Record pass/fail and tenant id in the PR or run notes when closing the spot-check.

---

## Success checks (updated)

| # | Check | v1 |
| --- | --- | --- |
| 1 | Import `Carpet cleaning - quotation` → preview cleanup; after **Save**, live call uses trusted facts | Suggest: **automated tests**. End-to-end call: **playbook §1–3** |
| 2 | Retail sees products + services; home_services never sees products block | **Shipped** (no segmented tab yet) |
| 3 | Unconfirmed import shows **Suggested** stamp; approval via **Save**, not nav “N to confirm” | Stamp **component exists**; **not wired** in `TenantForm` rows. No confirm nav (**by design**) |
| 4 | Playwright catalogue at 360 light/dark without overflow | **Partial** via general settings/dev routes; dedicated catalogue fixture **follow-up C6** |

---

## PR history and follow-ups

| # | Title | Status |
| --- | --- | --- |
| 1 | GIGO owner attest (Save = approval) + catalog suggest + sheet/shell | **Merged #598** |
| 2 | Wire `catalogSuggest` in `catalogActions` import | Open |
| 3 | Catalogue ListRow + stamps + segmented vertical IA | Open |
| 4 | Extract editors from `TenantForm` + `/dev/settings-catalog` gate | Open |
| 5 | LLM batch suggest (optional) | Deferred |
| 6 | `spoken_name` (optional) | Deferred |

**Parallel voice work (separate PRs):** list pacing (#597), speak DNA / catalogue mouth (#599–#600) — benefits from cleaner catalogue data but does not block spec closure.

---

## Agent chat starters

**Desk (Track C follow-up):**

```
Desk UI/UX. Read docs/specs/catalog-voice-gigo-desk.md — Track C remaining + Verification playbook.
Wire catalogRowStamp and CatalogListRow in TenantForm (or extracted editors). Retail Segmented Products|Services.
Add /dev/settings-catalog + Playwright. No RPC/compile semantic changes.
```

**Desk (catalogActions gap):**

```
Desk. Wire dashboard/src/lib/catalogSuggest.ts into catalogActions.ts import paths.
Same preview contract as CatalogImportSheet. Tests only; no new LLM.
```

**Brain (Track B3):**

```
Brain. Read docs/specs/catalog-voice-gigo-desk.md Track B3.
Batch LLM suggest behind row cap; output import until Save. Desk shows diff only.
```

**Platform / QA (spot-check):**

```
Run Verification playbook in docs/specs/catalog-voice-gigo-desk.md on staging tenant.
Confirm tenant_field_meta after Settings Save on import catalogue row.
```

---

## File index (quick navigation)

```
dashboard/src/lib/catalogSuggest.ts
dashboard/src/lib/fieldPathsFromSettingsSave.ts
dashboard/src/lib/ownerAttestFields.ts
dashboard/src/lib/fieldPathRegistry.ts
dashboard/src/components/settings/catalog/*
dashboard/src/components/TenantForm.tsx          # catalogue tab (inline + sheet)
dashboard/src/app/(desk)/settings/actions.ts
dashboard/src/app/(desk)/settings/ingestActions.ts
dashboard/src/app/(desk)/settings/catalogActions.ts   # suggest gap
tests/catalogSuggest.test.js
tests/fieldPathAttest.test.js
src/conversation/knownFacts.js                   # voice facts consumer
```
