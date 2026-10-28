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
- **One reader: `src/knowledge/kb/source.js` (`catalogueSource(profile)`).** Every caller-facing catalogue read goes
  through it: liveKnowledge (SERVICES / SPOKEN CATALOGUE / SERVICE NOTES), the greeting inputs (server.js greeting calls,
  greetingWarm), provenance fact sheet, speechGuard priced rows, v2 nlu matchers, `engineTools` named-item check, the
  engines guard and reply pack, STT hints and the spoken-catalogue pin. Mode `kb` = this call has a ready snapshot
  attached; mode `legacy` = everything else, and returns exactly the old profile fields (snapshot test
  `tests/kbSource.test.js` against `tests/fixtures/kbLegacyGolden.json`, taken on staging 3a037cd9).
- For a ready Business the snapshot is projected into `servicesCatalog` / `productCatalog` with **offered (active) items
  only**; `servicesOffered` (the derived free text) is set to null. Paused / not-offered items live only in `doc.off`:
  never listed, counted, priced, matched, in the prompt or the greeting; STT still hears their names. A caller who names
  one gets the grounded receipt (`findForCaller`): not offered = a plain no; paused = the owner note in its own language
  (an English note in a Swahili call becomes "timu itathibitisha lini itarudi") plus one offer to have the team call back
  when it's back (capture `when_back`: a yes runs the normal callback with read-back + yes + commit gate).
- Price binding: up to 3 priced names are spoken as item + price pairs; a bigger group may carry one true low-to-high
  range on its count; a single price after a list of names is never built, and the guard drops a model sentence that
  does it (`kb_price_unbound`).
- Name lock: item names come only from the KB (the owner-approved Swahili name in a Swahili call, else the English name
  verbatim). The reply pack carries `ITEM_NAMES` for the call language; the guard finds any other phrase that names a
  catalogue item (same normalised name words, e.g. a made-up "usafi wa kina" for "Deep clean"), repairs it once to the
  locked name, else drops the sentence. The pinned spoken catalogue for a KB business is built from the KB projection
  with locked names; the stored legacy `tenants.spoken_catalogue` is never pinned next to the KB.
- `not_included` (`excludes_en`) is spoken only when the caller asks whether X includes Y; `can_be_held` (`holdable`,
  products) answers "can you keep one for me?" (a hold is a callback capture with read-back + yes).

## Brain selector (retire the old brain: P1)

Plan: `briefs/retire-old-brain-plan-2026-10-28.md` (B1 Brain -> **P1 Platform** -> test calls -> B2 -> V1 -> D1 -> B3 -> P2).

- `BRAIN_KB_GATE=on`: the KB brain answers **every** business (`flag.tenantAllowed`, `v1draft.mode` get `true` from
  `kb/live.decision` for any business id). Readiness no longer picks a brain: an unready business (no area picks, no
  hours, empty catalogue) still runs the KB brain, which degrades safely (Brain B1). `brain_target` is not read (no v1
  hold). `attach` puts the live snapshot on the profile for every business with one (an empty snapshot is allowed).
- Unset or `off`: kill switch until P2 (the env lists decide). P2 removes the switch **after** Brain B2 deletes the old
  turn: unsetting any brain env var on today's code routes calls to the old brain, so no env var is removed before B2.
- Emergency brake: `BRAIN_SAFE_MODE=all` (every business) or `tenants.brain_mode = 'safe'` (one business, Super Admin).

### Shared contract: `isKbLive` and `brainMode` (Voice + Desk, one module)

`src/knowledge/kb/kbLive.js`, pure (no env, no DB, no requires). Voice's selector (`kb/live.js` `decision`, `quality`,
`attach`) and `scripts/kb-cutover.js` call it; Desk calls the same file through the voice closure
(`import { isKbLive, brainMode, loadKbLive, deskKbGate, deskSafeEnv } from "@/lib/kbLive.server"`, server-only).

- `isKbLive(tenant, { gate }) -> { live, reason }`: gate off -> `{ live: false, reason: 'gate_off' }`; gate on ->
  `{ live: true, reason }` for every business, `reason` = quality only: `no_facts` (no row / load error) ->
  `no_live_version` -> `never_ready` (`kb_ready_version` null) -> `ready_stale` -> `ready`. `held_v1` is gone.
  `kbQuality(tenant)` returns the reason alone.
- `brainMode(tenant, { safeEnv }) -> { mode: 'full' | 'safe', reason }`: `global` (`safeEnv` = `'all'`, any case),
  `tenant` (`brain_mode = 'safe'`), else `normal`. No row / no column = full. Voice pins it on `profile.brainMode` in
  `attach` (once per call); Brain owns the safe script. `safeEnvState(v)` (`off` | `all` | `invalid`) feeds `/healthz`
  `kb.safeMode`.
- **Facts:** `public.tenants` `kb_live_version`, `kb_ready_version`, `brain_mode` (`KB_LIVE_COLUMNS`). Before
  `kb_v2_brain_mode.sql` (.4) there is no `brain_mode`: Voice (`db.selectKbTenantFacts`) and Desk read without it (= full).
  Owners/members read their own row; only Super Admin (service role) writes `brain_mode` (no column UPDATE grant for
  `authenticated`; `tenants_update_admin_only` stays restrictive). `db.setBrainMode(id, 'full'|'safe')`,
  `kb-cutover --safe <id>` / `--full <id>`.
- **Gate / safe env:** passed in by the server like `hashMode`: Voice its env, Desk its server env (`deskKbGate()`,
  `deskSafeEnv()`). Keep both projects equal.
- **Every business has a document:** `scripts/kb-backfill.js --apply` imports `services_catalog` **and**
  `product_catalog` into kb_items and publishes; `scripts/kb-ensure-live.js --apply` then publishes an empty live snapshot
  for any business still without one (never over a blocked compile with items: those are listed).
- Tests: `tests/kbLive.test.js`.

## Readiness (src/knowledge/kb/readiness.js, publish.js)

Checks: compiled and current, every item priced, the reader finds a sample by name, confirmed area picks, hours, a capture
path. Deterministic tests (one price en + sw, a group answer within the rules, overview, coverage, hours) plus model text
tests through the live brain when `GEMINI_API_KEY` is set (`KB_TEXT_TESTS` adds utterances per Business). Runs after every
compile, on Voice boot (`KB_BOOT_READINESS`, every 12 h) and on demand (Super Admin "Check again").

## Env

| Var | Default | Effect |
| --- | --- | --- |
| `BRAIN_KB_GATE` | off | On: the KB brain for every business (readiness = quality only). Off = kill switch until P2. Voice **and** the Desk server; keep both equal. |
| `BRAIN_SAFE_MODE` | off | `all` = every business on the safe script (emergency brake). Voice and the Desk server. |
| `KB_COMPILE_ON_SAVE` | off | A Desk settings save recompiles the KB and re-checks readiness (the old columns are not synced back). |
| `KB_SW_SUGGEST` | off | AI suggests Swahili names (owner approves). |
| `KB_TEXT_TESTS` | none | JSON `{ "<tenant uuid>": ["utterance", ...] }`. |
| `KB_BOOT_READINESS` | on (with the gate) | Boot + 12 h readiness sweep. |
| `KB_SHADOW` | off | Logs `[kb_shadow]` lines comparing the old price path with the KB answer. |
| `KB_CACHE_MAX_MB` | 256 | Snapshot cache cap. |

## Desk and Admin

- Desk Settings > Catalogue opens `/settings/knowledge` (falls back to the old Catalogue tab when the tables are missing,
  keeping `?filter=unpriced`). `components/catalogue/CatalogueScreen.tsx`, view rules in `lib/catalogueView.ts`:
  a one-line status card ("6 services · 2 need a price", Fix walks the items without a price, readiness checks behind
  "See checks"); "What you sell" as plain rows with the price in words, search from 10 items, Services / Products only
  when both exist (never for home services), and a "Showing N that need a price · Show all" banner for the Overview
  "Add prices" link (`/settings/knowledge?filter=unpriced`). Item sheet: name and price up front (one KSh box; nothing
  is preselected for an unpriced item, so "Needs a price" stays honest), "Price changes?" for from / range / per unit /
  Custom quote / after a site visit / free (the no-number choices save as soon as they are picked), and More for
  offered / paused (note) / not offered, not included (services), in stock and hold (products), group, per, other
  names, short note, popular pick. Remove is separate (hide, with a confirm that points to Paused). Paste a list
  (`previewKbPasteAction` preview with new / update / needs a price / skipped, then `importKbPasteAction`, one
  `kb_upsert_items` batch up to 500) replaces Import for the catalogue: `?tab=catalog` and the retail `?tab=import`
  redirect to `/settings/knowledge` (`?paste=1`) once the tables exist. Viewers read the page without edit controls.
  What callers hear, Kiswahili names to approve and issues sit beside the list from `xl`. Dev fixture: `/dev/catalogue`.
  Paste a list also offers "Replace my list instead" (`importKbPasteAction` mode `replace`, rpc `kb_import_items`): a confirm
  names and counts the items of that kind the paste does not match (paused and not offered included), and refuses lines
  that match an item of the other kind. Desk reads of the catalogue text (Settings Test greeting preview and catalogue
  payload, FAQ compile input) come from kb_items via `lib/kbRead.server.ts` (`mirrorLegacy` + `servicesOfferedFromKb`),
  falling back to the stored `services_offered` / catalogue columns when the KB tables are absent.
- Super Admin Businesses > Calls & quality: brain state, readiness pills, Check again (safe), Hold on old brain / Allow new
  brain (`business-kb:set_brain_target`, Unlock + reason, audited).

## Scripts

- `node scripts/kb-backfill.js [--apply] [--tenant <uuid>]`: legacy columns -> kb_items (ids kept, add-only: an item already there is left as the owner set it), compile, readiness. Idempotent.
- `node scripts/kb-cutover.js [--hold <uuid> | --allow <uuid>]`: readiness table for every Business; optional ops hold.

## Phase 8

`kb_v2_phase8_drop_legacy.sql` drops the old copies. Not applied; needs Alvin's GO after every Business has run on v2.
