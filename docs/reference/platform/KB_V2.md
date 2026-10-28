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
- Catalogue asks are typed by the understanding engine (KB businesses only; the legacy request is unchanged):
  `u.catalogue = { kind: 'overview' }` ("what do you offer", "mnauza nini") or `{ kind: 'item', item }` (the caller's own
  words, "do you sell pianos" -> "pianos"), from the model's `asked_item`, else the rules reading
  (`src/conversation/v2/catalogueAsk.js`) when the model is off, slow or silent. `engineTools.catalogueReceipt` answers an
  overview with the count + group names + one narrowing question, and an item that no catalogue word touches (offered,
  paused or not offered) with a `not_in_catalogue` receipt: a plain no plus the biggest offered groups. The reply engine
  gets `not_offered` + `OFFERED_GROUPS` and writes the reply (closest group, one question); with no model the receipt line
  is spoken. A word the catalogue shares ("house cleaning" at a cleaner) is never a miss.
- Group names are spoken through `reader.spokenGroupName` (kb_categories has no spoken column): bracketed asides and a
  spaced dash suffix are dropped ("Capsicum (Hoho) - Green" -> "capsicum"), "/" and "&" become words, approved Swahili
  names only. Applied when a snapshot is opened, so older snapshots speak clean names without a re-publish; two groups
  with the same spoken name are said once.
- A yes to "shall the team call you when it's back?" carries the paused item (`E.flow.about`, turn-stamped
  `machine.kbWhenBack`): the read-back says "about the <item>", the request row gets `item` + notes, and the owner alert
  reason is "Call back when <item> is back (paused item)".

## Brain selector (one kill switch)

`BRAIN_KB_GATE=on`: readiness decides who gets the v2 brain (`flag.tenantAllowed`, `v1draft.mode`), replacing
`BRAIN_V2_TENANTS` / `BRAIN_V1_DRAFT_TENANTS`. A Business is on the new path when `kb_live_version = kb_ready_version`
and `brain_target = 'v2'`. Unset or `off`: the env lists decide exactly as before (the old brain path stays recoverable).

### Shared contract: `isKbLive` (Voice + Desk, one predicate)

The one rule for "this Business's calls are answered from the KB". Voice's selector (`kb/live.js` `decision`, `isReady`,
`attach`) and `scripts/kb-cutover.js` call it; Desk calls the same file through the voice closure. Nobody re-derives it
(not from "has an offered kb_item", not from `kb_readiness.passed`).

- **Function:** `isKbLive(tenant, { gate }) -> { live: boolean, reason }` in `src/knowledge/kb/kbLive.js` (pure: no env,
  no DB, no requires). Also `kbGateOn(gate)`, `kbLiveFacts(tenant)`, `KB_LIVE_COLUMNS`.
  Desk server: `import { isKbLive, loadKbLive, deskKbGate } from "@/lib/kbLive.server"` (`requireVoice` of the same
  module; listed in `dashboard/scripts/voice-modules.cjs`). Server-only; pass the boolean result to client components.
- **Facts (no new SQL):** `public.tenants` columns `kb_live_version int`, `kb_ready_version int`, `brain_target text`
  (`'v1' | 'v2'`, default `'v2'`), from `kb_v2.sql` 2026-10-28.1. Owners/members read their own row (`tenants_select_member`,
  column SELECT for `authenticated`; no UPDATE on these three), service role reads all. `kb_publish_snapshot` moves
  `kb_live_version`; `kb_record_readiness` moves `kb_ready_version` on a pass for the live version; Super Admin
  "Hold on old brain" / `kb-cutover --hold` sets `brain_target`. Snake (`tenants` row) or camel (`{ version, readyVersion,
  brainTarget }`, Voice's `loadKbLive`) keys.
- **Gate:** passed in by the server, like `hashMode`: the raw `BRAIN_KB_GATE` value (or a boolean). Voice passes its env;
  Desk passes `process.env.BRAIN_KB_GATE` of the Desk server (`deskKbGate()`), so the Desk project must carry the same value
  as Voice. Missing = off. Never read on the client.
- **Rule / reasons** (first that applies): `gate_off` (kill switch; Voice selector returns `null` = env lists) ->
  `no_facts` (no row, profile not loaded, KB load error) -> `held_v1` -> `no_live_version` -> `never_ready`
  (`kb_ready_version` null) -> `ready_stale` (`kb_ready_version != kb_live_version`) -> `ready` (`live: true`).
- **Not in the predicate:** a live snapshot whose doc fails to load on the call is still `ready` here; that call reads the
  legacy fields (`kb/source.js` mode `legacy`). The readiness runner's `force` attach is a test path, not a decision.
- Tests: `tests/kbLive.test.js` (gate off / on + ready / on + not ready / per-business hold; old vs new selector over every
  facts x gate combination and every staging tenant).

## Readiness (src/knowledge/kb/readiness.js, publish.js)

Checks: compiled and current, every item priced, the reader finds a sample by name, confirmed area picks, hours, a capture
path. Deterministic tests (one price en + sw, a group answer within the rules, overview, coverage, hours) plus model text
tests through the live brain when `GEMINI_API_KEY` is set (`KB_TEXT_TESTS` adds utterances per Business). Runs after every
compile, on Voice boot (`KB_BOOT_READINESS`, every 12 h) and on demand (Super Admin "Check again").

## Env

| Var | Default | Effect |
| --- | --- | --- |
| `BRAIN_KB_GATE` | off | Readiness selects the brain (kill switch). Voice **and** the Desk server (passed to `isKbLive`); keep both projects equal. |
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
