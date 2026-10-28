---
owner: platform
last_reviewed: 2026-10-28
---

# v2 Knowledge Base (KB v2)

One source for what a Business sells and what callers hear about it. Desk edits `kb_items`; a compile turns them into a
versioned snapshot; the call reads the snapshot in-process. Design and decisions: the "v2 Knowledge Base" Page.

## Data (docs/supabase/kb_v2.sql, version 2026-10-28.1)

| Table | What |
| --- | --- |
| `kb_categories` | Owner groups (Tomatoes, Home cleaning). Swahili name only after owner approval. |
| `kb_items` | One row per service / product / package. Prices as numbers (`price_mode` fixed, range, from, per_unit, quote, free, none). `in_stock`, `popular` (owner flag), `aliases`, `facets`, `delivery_fee_kes` (per-item override; area fees stay in area picks). `name_sw_state`: none, suggested (AI), approved, edited, rejected. `row_version` for edit conflicts. `search_text` / `search_tsv` filled by trigger. |
| `kb_item_variants` | Sizes / options with their own price. |
| `kb_snapshots` | Compiled doc per version (`live`, `failed`, `superseded`); last 10 kept. A failed compile never moves `tenants.kb_live_version`. |
| `kb_readiness` | Every readiness run (checks + scripted tests, one real call sid at the first switch). |
| `tenants.kb_live_version`, `kb_ready_version`, `brain_target` | Live pointer; version that passed readiness; ops hold (`v1`) or let readiness decide (`v2`, default). |

RPCs (service role only, `search_path = ''`): `kb_upsert_items`, `kb_publish_snapshot`, `kb_search_items` (tier 2), `kb_record_readiness`, `kb_import_items` (2026-10-28.3).

### Item states (docs/supabase/kb_v2_item_states.sql, version 2026-10-28.2, after .1)

- `price_mode` adds `site_visit` (priced after the team visits). `quote` and `site_visit` count as priced for readiness;
  callers hear how it is priced plus an offer to take details, and a yes starts the callback capture.
- `status`: `active`, `paused` (on hold for now, optional `status_note` up to 120), `not_offered` (an explicit "we don't
  do this", so the brain says no instead of "not sure"), `hidden` (removed). Paused and not-offered items live in
  `doc.off`: spoken only when a caller names one, never listed, counted, priced or put in the prompt index.
- `holdable` (product can be held for a caller) and `excludes_en` (what a service does not include, up to 500).
- Backfill: an old-Desk Quote (`pricing.mode` `ask` + `source` owner + `confirmed`, or `quote` in `pricing_mode` /
  `price_mode`) becomes `quote`, or `site_visit` when `site_visit_required`; an untouched ask stays `none`.
- Legacy mirror: not offered leaves `services_catalog` / `product_catalog`; paused reads as out of stock; site visit is
  the old Quote plus `site_visit_required`; `excludes_en` -> `out_of_scope`; `holdable` kept.
- `kb_search_items` returns `status` too (paused / not offered included, hidden never).

### Paste a list Replace (docs/supabase/kb_v2_paste_replace.sql, version 2026-10-28.3, after .2)

- `kb_import_items(p_tenant, p_kind, p_items, p_replace default false)`: upserts the pasted rows (all of `p_kind`);
  with `p_replace` the kind's other rows become `hidden` (soft-removed, restorable) in the same transaction. A stale row
  (`row_version` conflict, errcode 40001) or an empty Replace rolls everything back. Append stays the default.

### Writers (28 Oct: kb_items is the source of truth)

- Owner edits: Catalogue item sheet and Paste a list (`settings/knowledge/actions.ts`, every action calls
  `memberDenied("settings.edit")` first) write through `lib/kbWrite.server.ts` `writeKbItems`.
- Writers that start from catalogue rows are ADD-ONLY (`lib/kbLegacy.ts` `planLegacyImport` / `planTextImport`): setup
  finish and the previous onboarding wizard, `/api/tenant` (`services_offered` text -> one item per line), the
  website/FAQ import (services), and the old Catalogue tab. New rows are inserted; an existing item (same id or name)
  keeps its state (paused, not offered, hold, not included, status note) and nothing is hidden. The old tab may also
  change an existing item's name / price / unit / group / notes / stock, never its state.
- The old `services_catalog` / `product_catalog` -> `kb_items` sync on save is retired: `/internal/desk/spoken-catalogue`
  only recompiles (`KB_COMPILE_ON_SAVE`). `publish.syncFromLegacy` is add-only and used by the backfill only.
- Compat copy: `mirrorKbToLegacy` is the only writer of `services_catalog`, `product_catalog` and `services_offered` for a
  Business with KB tables: derived from `kb_items` (active items; the owner's "Additional notes" kept), read-only for the
  readers not yet on the KB. Before the KB SQL exists the writers store the derived text as before.
- Setup completion (databases without `setup_completed_at`): the catalogue half is at least one `active` kb item.

## Compile (src/knowledge/kb/compile.js)

Rules only (compiler `kb-rules-2026-10-28.1`), no model on the publish path. Spoken names and prices (English digits,
Swahili in words), categories with counts and price spans, the prompt index (item names when they fit about 1,500 tokens,
else categories + popular picks; never prices), issues (no price, odd price, duplicate, sound-alike, alias on two items),
and `preview` lines ("what callers hear") produced by the same call rules. Blocking issues store a `failed` snapshot.

## Call path

- `db.getTenantProfile` loads the live snapshot in parallel (the `/voice/incoming` prefetch warms it); the handle is pinned
  for the call. `src/knowledge/kb/reader.js` indexes it once per (Business, version): inverted index, exact / prefix /
  one-edit matches, named-item and named-group detection. Measured 0.05 to 0.3 ms per lookup on staging catalogues, under
  1 ms median at 10,000 items. Above 10,000 items `kb_search_items` (trigram + FTS) is the fallback; no embeddings on the call.
- The 12 Hick's-law call rules live in `src/knowledge/kb/rules.js`: count first, at most 3 names, a narrowing question,
  price only on a pick, "more" in threes, picks by position, ranges inside the count sentence, at most 2 sentences.
- `engineTools.catalogueReceipt` turns a price / list / pick turn into one receipt; `engineGuard` repairs a reply naming
  more than 3 catalogue items; the verifier accepts only KB numbers.
- For a ready Business the snapshot is projected into `servicesCatalog` / `productCatalog` / `servicesOffered`, so older
  readers read the KB and the old free-text copies are no longer read.

## Brain selector (one kill switch)

`BRAIN_KB_GATE=on`: readiness decides who gets the v2 brain (`flag.tenantAllowed`, `v1draft.mode`), replacing
`BRAIN_V2_TENANTS` / `BRAIN_V1_DRAFT_TENANTS`. A Business is on the new path when `kb_live_version = kb_ready_version`
and `brain_target = 'v2'`. Unset or `off`: the env lists decide exactly as before (the old brain path stays recoverable).

## Readiness (src/knowledge/kb/readiness.js, publish.js)

Checks: compiled and current, every item priced, the reader finds a sample by name, confirmed area picks, hours, a capture
path. Deterministic tests (one price en + sw, a group answer within the rules, overview, coverage, hours) plus model text
tests through the live brain when `GEMINI_API_KEY` is set (`KB_TEXT_TESTS` adds utterances per Business). Runs after every
compile, on Voice boot (`KB_BOOT_READINESS`, every 12 h) and on demand (Super Admin "Check again").

## Env

| Var | Default | Effect |
| --- | --- | --- |
| `BRAIN_KB_GATE` | off | Readiness selects the brain (kill switch). |
| `KB_COMPILE_ON_SAVE` | off | A Desk settings save recompiles the KB and re-checks readiness (the old columns are not synced back). |
| `KB_SW_SUGGEST` | off | AI suggests Swahili names (owner approves). |
| `KB_TEXT_TESTS` | none | JSON `{ "<tenant uuid>": ["utterance", ...] }`. |
| `KB_BOOT_READINESS` | on (with the gate) | Boot + 12 h readiness sweep. |
| `KB_SHADOW` | off | Logs `[kb_shadow]` lines comparing the old price path with the KB answer. |
| `KB_CACHE_MAX_MB` | 256 | Snapshot cache cap. |

## Desk and Admin

- Desk Settings > Catalogue opens `/settings/knowledge` (falls back to the old Catalogue tab when the tables are missing):
  ready card with fix links, what callers hear (English / Swahili), Swahili names to approve, issues, items by group with
  the popular switch, item sheet (price incl. site visit, callers hear: offered / paused / not offered, not included,
  hold), and Paste a list (`previewKbPasteAction` parses one item per line with an optional price for a preview;
  `importKbPasteAction` re-parses on the server and writes one `kb_upsert_items` batch, up to 500, names already in the
  catalogue update that item). Server actions write `kb_items`, mirror the old columns, and ping `/internal/kb/compile`.
- Super Admin Businesses > Calls & quality: brain state, readiness pills, Check again (safe), Hold on old brain / Allow new
  brain (`business-kb:set_brain_target`, Unlock + reason, audited).

## Scripts

- `node scripts/kb-backfill.js [--apply] [--tenant <uuid>]`: legacy columns -> kb_items (ids kept, add-only: an item already there is left as the owner set it), compile, readiness. Idempotent.
- `node scripts/kb-cutover.js [--hold <uuid> | --allow <uuid>]`: readiness table for every Business; optional ops hold.

## Phase 8

`kb_v2_phase8_drop_legacy.sql` drops the old copies. Not applied; needs Alvin's GO after every Business has run on v2.
