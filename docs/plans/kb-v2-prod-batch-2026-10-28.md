---
owner: platform
last_reviewed: 2026-10-28
---

> Copied from the Scalers Chief account box (`/workspace/briefs/kb-v2-prod-batch-2026-10-28.md`) on 28 Oct 2026 as part of the handover. Parked; see [`../HANDOVER.md`](../HANDOVER.md) §4.

# KB v2 PROD BATCH (prepared 28 Oct 2026, EAT). NOT RUN. Needs Alvin's separate yes in chat.

Everything below is staged on **staging only** today. Nothing here has touched prod (no prod SQL writes, no prod env,
no prod deploy, no merge to main). Prod reads used for this brief were read-only SELECTs.

## PROMOTION ORDER (authoritative; updated 28 Oct 2026 ~14:00 EAT; staging tip with steps 1–4 = `f6557e8e`). Prepare only — every prod step needs Alvin's yes in chat.

Staging stack, in merge order on `staging/v2-c0-opening-2026-10-21`:
1. KB #991–#994, #996 (in `bbb8a558`, with Desk #990/#995).
2. **Platform #998** (merge `5aa6d9ce`): kb_items is the source of truth.
   - the old-column → kb_items sync is retired
   - onboarding, /api/tenant, website/FAQ import and the old tab are add-only, with no state change and no hide
   - services_offered is only the derived mirror
   - Paste a list Replace (SQL .3)
   - kb actions call memberDenied first
   Then **Platform #999** (merge `4147648d`, current staging tip): the mirror's `pricing.mode` uses fixed/from/range/ask. Without it, every mirror of a quote / site-visit / no-price / free item failed on `catalogue_price_history_mode_check`, found by the fresh-signup test.
3. **Brain #1000** (merge `f6557e8ea422178138e6a9fc02b6fc26e38918e5` into staging, 28 Oct 13:54 EAT; head `e543589e`, merged onto staging tip `7826b391`, so it lands after Desk #997/#1001/#1002). One KB reader `src/knowledge/kb/source.js` for every caller read (liveKnowledge, greeting, matchers, prompt, guard, STT context): paused and not-offered items are never listed and are answered only when a caller names them; `servicesOffered` is not read in KB mode; the stored legacy spoken_catalogue is never used for a KB business; prices are bound to their own item; KB-only name lock. Legacy (gate off) mode byte-for-byte unchanged (golden test). No SQL, no new flag: `BRAIN_KB_GATE` controls it. Gates on the merge: test:brain/voice/mvp/desk-bundle all 0.
4. **Desk #997 / #1001 / #1002** (already on staging before #1000: `3a037cd9`, `c014579c`, `7826b391`): the Catalogue remake, critique fixes, Policies remake; `?tab=catalog` and the retail import redirect to `/settings/knowledge` once the KB tables exist. Rebases on the step-3 tip; the test merge on #998 was clean.
   **#997 must not reach prod before step 2.** The redirect hides the old Catalogue tab, and that's what makes the add-only rule safe.

### P1. Pre-checks
- [ ] Staging at the tip with steps 1–4 merged; staging Voice `/healthz` gitSha = tip, `kb.gate=true`; staging Desk aliased to the READY build at the tip; a fresh staging signup ends with a filled Catalogue + mirror (see build log).
- [ ] Soak: one day on staging with `BRAIN_KB_GATE=on`; two real staging calls graded (Grow Tech, D&D).
- [ ] **Open decision (Alvin):** should a walk-in shop with no delivery (bookstore, stationery) need confirmed service areas to pass readiness? Today it does. That decides whether ALFAAL / Esga can pass without an owner tap.
- [ ] A quiet window agreed (SQL → backfill → merge → re-check runs in minutes, back to back).

### P2. SQL on prod `fjxcdccgyhnvnnlnovcl` (apply_migration, in this order; all additive)
| # | File | Version | Staging migration |
| --- | --- | --- | --- |
| 1 | `docs/supabase/kb_v2.sql` | 2026-10-28.1 | `20261028072250` |
| 2 | `docs/supabase/kb_v2_item_states.sql` | 2026-10-28.2 | `20261028074736` |
| 3 | `docs/supabase/kb_v2_paste_replace.sql` | 2026-10-28.3 (`kb_import_items`, service role only) | `kb_v2_paste_replace` (28 Oct, ~11:50 EAT) |
| — | `docs/supabase/kb_v2_phase8_drop_legacy.sql` | — | **NOT in this batch** (phase 8, separate yes) |
Verify: 5 kb_* tables, 3 tenant columns, 5 RPCs (`kb_upsert_items`, `kb_publish_snapshot`, `kb_search_items`, `kb_record_readiness`, `kb_import_items`), holdable/excludes_en/status_note present; security advisor clean on kb_*.

### P3. Backfill (right after SQL, before the merge; prod Voice still on old code)
- From the candidate branch on the box: `node scripts/kb-backfill.js` (dry run), then `--apply`. Prod service key from the vault, never printed.
- The backfill is add-only on an empty KB, so it imports everything. **Esga's 2 deliberate old-Desk Quotes become `quote`** (priced for readiness).
- Expected: 5 Businesses with items (Grow Tech 69 products, D&D 1, Esga 2, ALFAAL 1, Grok Test 1); 3 with none.
- The KB-backfill compile publishes a live snapshot for each Business with items. Nobody passes readiness yet (P6).

### P4. Merge to main (one candidate branch, merge commit, never force-push)
1. `release/kb-v2-prod-2026-10-xx` from `origin/main`.
2. `git merge --no-ff origin/staging/v2-c0-opening-2026-10-21` at the tip that has steps 1–4.
3. Resolve `docs/supabase/README.md`: keep main's rows plus KB rows 25 / 25.1 / 25.2 / 25.8.
4. Regenerate `docs/reference/schema.md` with `npm run docs:reference`.
5. Gates: test:brain, test:voice, test:mvp, test:desk-bundle (now includes requireMemberGuard), docs:reference:check, docs:check, dashboard lint + build (Node 22, SAUTIKIT_API_KEY unset).
6. PR into main, merge with a **merge commit**.
   - **Live-call check on prod at zero immediately before the merge**: prod Voice redeploys on push.
7. Verify:
   - prod `/healthz` gitSha = merge sha, `kb.gate=false`
   - prod Desk build READY
   - `/settings/knowledge` shows each Business's items
8. Re-run `kb-backfill.js --apply` once. It's add-only, so it picks up any item an owner added in the old tab between P3 and the deploy.
   - Price edits made in that window are not carried over. Check `catalogue_price_history` rows created after P3 and fix any by hand in the Catalogue.

### P5. Env on prod Voice (stage + accept-deploy, never redeploy; live-call check at zero before each accept)
| Order | Var | Value | Note |
| --- | --- | --- | --- |
| a | `KB_COMPILE_ON_SAVE` | `on` | A Desk save recompiles the KB and re-checks readiness. The old columns are not synced back any more (#998). |
| a | `KB_SW_SUGGEST` | `on` | AI Swahili suggestions, owner-approved only. |
| a | `KB_SHADOW` | `on` | `[kb_shadow]` logs, first week. |
| b | `BRAIN_KB_GATE` | `on` | **Own accept-deploy, last, only once at least one Business passes readiness** (P6). Same step: set `BRAIN_KB_GATE` to match on the prod Desk Vercel project `scalers-project` + fresh Desk build/alias (#1005 isKbLive). |
Never set `VOICE_GEMINI_CATALOGUE` / `BRAIN_GEMINI_CATALOGUE`. Leave `VOICE_UNFINISHED_HOLD_MS`, `VOICE_TRACE`, `VOICE_IDLE_*`, `FACT_HASH_MODE` and `BRAIN_V1_DRAFT_TENANTS` (kill-switch fallback) as they are. No new Desk env.

### P6. Readiness per prod Business (expectation; dry run 28 Oct, read-only)
None pass today. The common blocker is unconfirmed service areas (owner taps "Looks right"):
- Grow Tech: areas
- D&D: areas; 1 item vs 11 on staging
- Esga: areas only (Quotes fixed by #996)
- ALFAAL: areas
- Grok Test: areas
- Scalers Business Solutions and Uwezo: catalogue, hours, areas
- Chapter One: inactive

The walk-in-shop decision (P1) can clear ALFAAL / Esga. After owners confirm, run Check again (Super Admin, safe), then P5b.

### P7. Live-call checks (prod)
Before the merge in P4 and before each accept-deploy in P5:
- Railway prod http logs: no `/voice/incoming` or `/ws/media` in the last 10 min
- `select count(*) from calls where created_at > now() - interval '30 minutes' and status not in ('complete','completed','failed','no-answer','busy','canceled','ended','missed','voicemail')` = 0

After P5b: one real call per switched Business, with the call sid recorded on its readiness row.

### P8. Rollback (fastest first)
1. `BRAIN_KB_GATE=off` (staged + accept-deploy, after the live-call check).
2. Hold one Business: Super Admin > Calls & quality > Hold on old brain, or `kb-cutover.js --hold <id>`.
3. Code: revert the release merge on main with a new revert commit (no force-push). The legacy columns stay current because the mirror (`mirrorKbToLegacy`) keeps writing `services_catalog` / `product_catalog` / `services_offered` from kb_items, so the old code reads correct data.
4. Schema, reverse order:
   - `kb_v2_paste_replace_down.sql` (.3)
   - `kb_v2_item_states_down.sql` (.2: folds paused / not_offered to hidden, site_visit to quote)
   - `kb_v2_down.sql` (.1)
   The legacy columns are never dropped in this batch.

## 0. What ships

Code: KB v2 PRs #991 (schema + compiler), #992 (lookup, 12 call rules, brain tools, readiness selector, compat writer),
#993 (Desk Catalogue editor), #994 (Super Admin brain gate), #996 (item states: site visit, paused, not offered, hold,
not included; honest Quote backfill; Desk paste a list) — merged into `staging/v2-c0-opening-2026-10-21`, tip `bbb8a558`
(includes Desk #990 Identity remake and #995). SQL: `docs/supabase/kb_v2.sql` `2026-10-28.1`, then
`docs/supabase/kb_v2_item_states.sql` `2026-10-28.2`, then `docs/supabase/kb_v2_paste_replace.sql` `2026-10-28.3` (see PROMOTION ORDER above; it supersedes sections 2-6 where they differ).

## 1. Pre-checks (all must be true)

1. Staging soak: staging Voice on the KB tip with `BRAIN_KB_GATE=on` for at least one day, two real calls (Grow Tech,
   D&D) graded, `kb_readiness` rows passing with model text tests.
2. **Decision needed (see 7):** whether readiness requires confirmed service areas for every Business.
3. Live-call check at zero on PROD right before each step that restarts Voice: Railway prod http logs last 10 min with
   no `/voice/incoming` or `/ws/media`, and `select count(*) from calls where created_at > now() - interval '30 minutes'
   and status not in ('completed','failed','no-answer','busy','canceled','ended','missed','voicemail')` = 0.

## 2. SQL, in order (prod project `fjxcdccgyhnvnnlnovcl`)

| # | File | Version | Notes |
| --- | --- | --- | --- |
| 1 | `docs/supabase/kb_v2.sql` | 2026-10-28.1 (staging migration `20261028072250` `kb_v2_2026_10_28_1`) | Additive, idempotent. Installs `pg_trgm` + `btree_gin` in schema `extensions`; 5 tables with RLS (owner SELECT only); 3 tenant columns (`kb_live_version`, `kb_ready_version`, `brain_target` default `v2`); 4 service-role RPCs. Apply with `apply_migration` name `kb_v2_2026_10_28_1`. |
| 2 | `docs/supabase/kb_v2_item_states.sql` | 2026-10-28.2 (staging migration `20261028074736` `kb_v2_item_states_2026_10_28_2`) | Additive, after #1. `price_mode` `site_visit`; `status` `paused` / `not_offered`; `kb_items.holdable`, `excludes_en`, `status_note`; replaces `kb_upsert_items` and `kb_search_items` (now returns `status`). Rollback `kb_v2_item_states_down.sql`. **Must be applied before the Desk release** (Desk selects the new columns). |
| - | `docs/supabase/kb_v2_phase8_drop_legacy.sql` | 2026-10-28.1 | **DO NOT APPLY** in this batch. Phase 8 later, separate yes, after 14 days on v2. |

Verify after #1:
```sql
select (select count(*) from information_schema.tables where table_schema='public' and table_name like 'kb\_%') as kb_tables, -- 5
       (select count(*) from information_schema.columns where table_schema='public' and table_name='tenants'
         and column_name in ('kb_live_version','kb_ready_version','brain_target')) as tenant_cols,                    -- 3
       (select count(*) from pg_proc where proname in ('kb_upsert_items','kb_publish_snapshot','kb_search_items','kb_record_readiness')) as rpcs; -- 4
```
After #2: `select count(*) from information_schema.columns where table_name='kb_items' and column_name in ('holdable','excludes_en','status_note')` = 3.
Then run the Supabase security advisor; expect no new findings on kb_* tables.

## 3. Merge plan (main)

1. Branch `release/kb-v2-prod-2026-10-xx` from `origin/main`, `git merge staging/v2-c0-opening-2026-10-21` (staging is
   otherwise a subset of main; tested 28 Oct: auto-merges except `docs/supabase/README.md` (keep main's 24n/24o rows AND
   the KB rows 25 / 25.1 / 25.8) and `docs/reference/schema.md` (regenerate with `npm run docs:reference`)).
2. Gates on the release branch: `npm run test:voice`, `test:brain`, `test:mvp`, `test:desk-bundle`, `docs:reference:check`,
   `cd dashboard && npm run lint && npm run build` (Node 22, SAUTIKIT_API_KEY unset).
3. PR into main, review, merge (never force-push). Prod Voice deploys from `main` on push (watch patterns include
   `src/**`, `server.js`, `package.json`): **do the live-call check first** and merge in a quiet window.
4. Verify prod `/healthz` `gitSha` = merge sha and `kb.gate` = `off` (the gate stays off in this step: prod behaviour
   is unchanged because readiness does not select brains until step 5).

## 4. Backfill (after SQL + deploy, gate still off)

```
SUPABASE_URL=<prod> SUPABASE_SERVICE_ROLE_KEY=<prod key from the vault, never printed> node scripts/kb-backfill.js          # dry run, check the table
SUPABASE_URL=<prod> SUPABASE_SERVICE_ROLE_KEY=... node scripts/kb-backfill.js --apply
node scripts/kb-cutover.js                                                                                                   # readiness table
```
Idempotent: a second run publishes nothing new (same source hash). It only writes kb_* rows and the two tenant pointers.

## 5. Env changes on prod Voice (Railway service `9b09d8c6-…`, env `8dd0b8ef-…`)

Stage, then accept-deploy (never redeploy), only after the live-call check at zero:

| Var | Value | Why |
| --- | --- | --- |
| `KB_COMPILE_ON_SAVE` | `on` | Desk saves keep kb_items in step. |
| `KB_SW_SUGGEST` | `on` | AI Swahili suggestions (owner approves; never spoken before). |
| `KB_SHADOW` | `on` | `[kb_shadow]` logs for the first week. |
| `BRAIN_KB_GATE` | `on` | **Last, as its own accept-deploy.** Readiness picks the brain instead of `BRAIN_V1_DRAFT_TENANTS`. **Same step: the prod Desk Vercel project (`scalers-project`) must get `BRAIN_KB_GATE` set to the same value (production + preview + development, plain), then a fresh Desk build + alias, so Desk's `isKbLive` (#1005, `dashboard/src/lib/kbLive.server.ts`) matches prod Voice. Missing on Desk = `gate_off` for every Business. Kill switch: flip both back to `off` together.** |

Leave untouched: `VOICE_GEMINI_CATALOGUE` / `BRAIN_GEMINI_CATALOGUE` (never set), `VOICE_UNFINISHED_HOLD_MS`,
`VOICE_TRACE`, `VOICE_IDLE_*`, `FACT_HASH_MODE`, `BRAIN_V1_DRAFT_TENANTS` (kept as the kill-switch fallback).

Desk (Vercel prod) needs `VOICE_INTERNAL_SECRET` (already used by the spoken-catalogue ping) and, from #1005, `BRAIN_KB_GATE` equal to prod Voice's (set in the same step as the Voice gate flip; also flip it back with the kill switch).

## 6. Rollback (fastest first)

1. **Kill switch:** set `BRAIN_KB_GATE=off` (staged + accept-deploy). Brains go back to the env lists at once. Also set it `off` on the prod Desk Vercel project + fresh build so Desk's isKbLive agrees.
2. One Business: Super Admin > Businesses > Calls & quality > Hold on old brain (or `node scripts/kb-cutover.js --hold <id>`).
3. Code: revert the release merge on main (new revert commit, no force-push).
4. Schema: `docs/supabase/kb_v2_down.sql` (drops kb_* and the 3 tenant columns; legacy catalogue columns were never changed,
   Desk mirrors kept them current).

## 7. Per-business readiness on PROD (dry run 28 Oct, read-only; compile run locally on prod catalogue JSON)

| Business | id | Items | Compile | Areas | Hours | Alerts | Would pass today? | Blocking |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Grow Tech Nurseries Ltd | 24ca3d5e | 69 products, 12 groups, all priced | live | 1 pick, not confirmed | yes | yes | **No** | areas (owner taps Looks right) |
| Done and Dusted Cleaning Services | 7c759c85 | 1 service (Carpet Cleaning 2,000) | live | none | yes | yes | **No** | areas; catalogue is 1 item (staging D&D has 11) |
| Esga Stationery | c81b3480 | 2 services, both deliberate old-Desk Quotes (read-only check 10:50 EAT) | live; with #996 they backfill as `quote` and count as priced | 1 pick, not confirmed | yes | yes | **No** | areas only (prices fixed by #996) |
| ALFAAL VENTURES | 61dbbf92 | 1 product (Books 350) | live | 1 pick, not confirmed | yes | yes | **No** | areas |
| Grok Test | ee7b7e84 | 1 service (QA Binding 200) | live | none | yes | yes | **No** | areas |
| Scalers Business Solutions | f75588d4 | none | - | none | no | yes | **No** | catalogue, hours, areas |
| Uwezo enterprises | d3ddb109 | none | - | none | no | yes | **No** | catalogue, hours, areas |
| Chapter One Bookstore (inactive) | 66ad5aa3 | none | - | none | yes | yes | **No** | inactive; catalogue, areas |

**Consequence:** if `BRAIN_KB_GATE=on` today, every prod Business would fall back to the old brain (including any
currently on the v1-draft engines through `BRAIN_V1_DRAFT_TENANTS`). So: run steps 1-4 and the first three env vars,
get owners to confirm areas, re-run readiness (`Check again`), and switch the gate on only when the
Businesses now on v2 pass. **Alvin decision:** should readiness require confirmed service areas for a walk-in shop
(bookstore, stationery) that does not deliver? Today it does (rule from the design: "areas = confirmed picks").

## 7b. Staging findings to weigh before prod (28 Oct)

- Text-test turns on staging took ~4.0 s on Grow Tech and D&D because the model reply timed out on 18 of 21 turns; the
  grounded KB receipt answered correctly every time (lookup 0.04-0.38 ms). Model-ok turns 2.8-3.0 s. Measure on the real
  staging call before the prod gate; this is the brain model path, not the KB lookup.
- One model reply translated "Deep Clean" to "Usafi wa kina" in Swahili without owner approval (the rules path keeps the
  owner's name). Brain follow-up: the verifier should keep item names to the snapshot's approved forms.
- The GitHub "Deploy staging Voice" workflow cannot run: repo secrets `RAILWAY_STAGING_PROJECT_ID`, `_SERVICE_ID`,
  `_ENVIRONMENT_ID` are not set. Staging Voice was moved by a staged source pin + accept-deploy instead.

## 8. After the switch

- Check `/healthz` `kb.gate=on`, `kb.cache.entries` > 0 after the first call.
- One real call per switched Business; record the call sid on its readiness row (first-switch rule).
- Watch `[kb_shadow] agree=false` lines and `opening_prefetch kb_v=` for a week.

- 12:22 EAT: #997 is in staging at 3a037cd9 (squash on top of 4147648d). For the prod candidate, take staging at or after 3a037cd9. Staging Desk alias is dpl_92t2fo5X.

---

## Retire old brain (added 28 Oct 15:28 EAT, Platform) — needs Alvin's yes in chat for every prod step

PRs (all drafts on staging): Brain B1 #1007 → Platform P1 #1008 (stacked on #1007; supersedes #1006) → test calls → B2 → V1 → D1 → B3 → Platform P2 #1009 (last).
Prod already runs the engines for every tenant (c620b379); prod has no kb tables yet (kb_v2.sql … .3 not applied), no brain_target / brain_mode columns, BRAIN_V1_DRAFT_TENANTS = 8 ids.

**Order (prod)**
1. Prod-1 SQL: kb_v2.sql (.1), kb_v2 .2, kb_v2_paste_replace.sql (.3), **kb_v2_brain_mode.sql (2026-10-28.4)**: brain_mode(+_source/_set_by/_set_at), set_brain_mode RPC, kb_catalogue_complete_at/_by, set_kb_catalogue_complete RPC, the two audit tables. Additive.
2. Prod-2 data: `node scripts/kb-backfill.js --apply` (services_catalog **and** product_catalog → kb_items; all 8 businesses, Scalers Business Solutions and Uwezo treated as real businesses), then `node scripts/kb-ensure-live.js --apply` (empty live snapshot for any business still without one). Dry runs first; both idempotent.
3. Prod-3 deploy Voice + Desk with B1 + P1 (main merge), then `BRAIN_KB_GATE=on` on Voice **and** the Desk Vercel project in the same step. Do **not** unset any brain env var here.
4. Prod-4 test calls (D&D, Grow Tech, Esga, an empty business, safe mode EN + SW via set_brain_mode on Grok Test).
5. Prod-5 deploy B2 → V1 → D1 → B3. Only after B2 is live: remove env (snapshot first): BRAIN_KB_GATE (Voice + Desk, with P2), BRAIN_V2, BRAIN_V2_MODE, BRAIN_V2_OWNS_CALL, BRAIN_V2_SHADOW*, BRAIN_V1_DRAFT, BRAIN_V1_DRAFT_PHASE_A/B, BRAIN_V2_TENANTS, BRAIN_V1_DRAFT_TENANTS, BRAIN_MODEL_LEAD, BRAIN_ENGINES, BRAIN_CALL_CORE. Keep BRAIN_SAFE_MODE (unset), BRAIN_V2_MODEL_ID / _BACKUP_ID, KB_*, VOICE_*, FACT_HASH_MODE.
6. Prod-6 P2 deploy; one release later kb_v2_drop_brain_target.sql (2026-10-28.5) after `select proname from pg_proc where prosrc ilike '%brain_target%'` returns 0 rows.

**Per-business after .1–.4 + backfill (read-only prod SELECT + local compile, 28 Oct ~14:55 EAT)**

| Business | id | Active | Calls 14 d | After backfill (kb_items) | Compile | Readiness gaps | Owner data gaps |
|---|---|---|---|---|---|---|---|
| Grow Tech Nurseries | 24ca3d5e | yes | 36 | 69 products, 12 categories | live (no_sw_name, sound_alike notes) | areas | 1 area pick, unconfirmed (legacy area marked confirmed); no catalogue-complete mark |
| Esga Stationery | c81b3480 | yes | 48 | 2 services, 2 categories | live | areas | 1 area pick, unconfirmed; catalogue only 2 items (sparse) |
| Done and Dusted Cleaning | 7c759c85 | yes | 0 | **1 service** | live | areas | no areas at all; D&D catalogue on prod is 1 item (staging has the full list): owner must load the catalogue |
| ALFAAL Ventures | 61dbbf92 | yes | 0 | 1 product | live | areas | 1 area pick, unconfirmed; 1 item |
| Grok Test | ee7b7e84 | yes | 0 | 1 service | live | areas | test business; no areas |
| Scalers Business Solutions | f75588d4 | yes | 0 | **empty** snapshot | live (0 items) | catalogue, reader, areas, hours | no catalogue, no hours, no areas (real business) |
| Uwezo enterprises | d3ddb109 | yes (setup not finished) | 0 | **empty** snapshot | live (0 items) | catalogue, reader, areas, hours | no catalogue, no hours, no areas; setup incomplete (real business) |
| Chapter One Bookstore | 66ad5aa3 | archived | 0 | empty snapshot | live (0 items) | catalogue, reader, areas | archived: no action |

All 8 get a live snapshot; none is blocked. With P1 every one runs the KB brain (B1 degrades: empty → take a message; sparse → "I'll have the team confirm"). No business has a catalogue-complete mark, so every catalogue counts as sparse until the owner marks it.

**Rollback**
- Code: revert the P1 (or P2) merge; brake first with `BRAIN_SAFE_MODE=all` on Voice (every business on "Take messages only").
- Env: re-add from the snapshot taken before step 5 (only relevant after B2; before B2 nothing is removed).
- SQL: kb_v2_brain_mode_down.sql (drops RPCs, audit tables, columns; reads fall back), kb_v2_drop_brain_target_down.sql (restores brain_target as v2). kb data: kb_v2_down.sql as in the earlier batch.
