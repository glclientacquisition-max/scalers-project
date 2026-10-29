---
owner: platform
last_reviewed: 2026-10-28
---

> Copied from the Scalers Chief account box (`/workspace/briefs/kb-v2-build-log-2026-10-28.md`) on 28 Oct 2026 as part of the handover. Parked; see [`../HANDOVER.md`](../HANDOVER.md) §4.

# KB v2 build log (28 Oct 2026, EAT). Staging only.

## State at resume (10:36 EAT)
- Code: worktree /workspace/wt-kbv2 (branch platform/kb-v2-2026-10-28-admin = 540d46cf), clean. Stack branches pushed:
  platform/kb-v2-2026-10-28 (#991), -brain (#992), -desk (#993), -admin (#994). All four MERGED (stack merged top-down,
  #991 into staging). Staging tip = 0fe1b362 = merge of the KB stack ON TOP OF #990 (4f7dfbe4, Identity remake);
  GitHub merged cleanly, so no rebase needed.
- Gates on 0fe1b362 (/workspace/kbv2-work/gates-tip): test:brain, test:voice, test:mvp, test:desk-bundle,
  docs:reference:check, settings tests, dashboard lint = pass. Local next build failed only on a node_modules symlink
  (Turbopack) in the throwaway worktree; Vercel built the tip READY (scalers-staging dpl_7Qgy5KFSbQqQerCnZ6nAanGdk8b9).
- Supabase staging: kb_v2.sql applied as migration 20261028072250 kb_v2_2026_10_28_1 (10:22 EAT); 5 kb_* tables + RLS,
  3 tenant cols, 4 RPCs, pg_trgm + btree_gin. Backfill --apply done for all 7 staging businesses (v1 snapshots).
  Grow Tech b123e978 Westlands area pick confirmed on staging (was unconfirmed). Readiness (script, no model):
  Grow Tech b123e978 PASS, D&D df4ad9d8 PASS, 995e30d9 FAIL (empty catalogue, no hours/areas).
- Railway staging: no staged changes; Voice still on 824db1b7 (deployment 6bce01b0); service source pinned by sha,
  so pushes don't deploy: use the "Deploy staging Voice" workflow.
- Desk alias scalers-staging.vercel.app still on dpl_AkCj77 (4f7dfbe4).
- Prod batch brief: /workspace/briefs/kb-v2-prod-batch-2026-10-28.md (written).

## Next
1. Live-call check -> dispatch Deploy staging Voice at 0fe1b362 -> healthz sha, kb.gate off.
2. Desk alias -> dpl_7Qgy5; curl /, /admin/login, /signup.
3. Stage env (BRAIN_KB_GATE, KB_COMPILE_ON_SAVE, KB_SW_SUGGEST, KB_SHADOW, KB_TEXT_TESTS) -> live-call check -> accept-deploy.
4. Verify healthz kb.gate on, boot readiness rows with model text tests; record answers + latency.
5. Small follow-up PR (phase-8 comment) if needed; Page update; final report.

## Milestones
- 10:38 EAT: Desk alias scalers-staging.vercel.app -> dpl_7Qgy5KFSbQqQerCnZ6nAanGdk8b9 (0fe1b362). curl / 200, /admin/login 200, /signup 200, /settings/knowledge 200.
- 10:36 EAT: live-call check NOT zero (a staging call started 10:36:13 EAT, non-final). Voice deploy waits.
- 10:40 EAT: Parent relayed the Desk Engineer catalogue review (/workspace/desk-ux-audit/catalogue-review-2026-10-28.md).
  Folding in (follow-up PR, branch platform/kb-v2-2026-10-28-followup, worktree /workspace/wt-kbv2-fu; #991 is merged,
  so the schema change is a new additive file kb_v2_item_states.sql 2026-10-28.2, not an edit of the applied .1):
  1. BUG fixed: backfill legacyPrice read pricing.mode first; old Desk stores Quote as pricing.mode "ask", so quotes became
     "none". Now every mode key is read; ask + source owner + confirmed -> quote (site_visit when site_visit_required);
     untouched ask stays none. Readiness counts quote / site_visit as priced. Quote spoken: "<item> is a custom quote; the
     team will give you a price after checking the job. Shall I take your details for that?" + receipt capture -> the
     caller's yes becomes the callback capture (E.offered = callback).
  2. Item model: price_mode site_visit; status paused (+ status_note) and not_offered; holdable; excludes_en.
  3. Paste a list: Desk previewKbPasteAction (parse, nothing saved) + importKbPasteAction (server re-parse, one
     kb_upsert_items batch, <= 500). Tests: tests/kbV2ItemStates.test.js (17), added to test:brain.
  Also: phase-8 SQL header comment fixed (no BRAIN_KB_LEGACY_ROUTE).

## Contract for Desk (kb_items after 2026-10-28.2)

kb_items (pk tenant_id, id):
| field | type | notes |
| --- | --- | --- |
| tenant_id | uuid | -> tenants.id, cascade |
| id | text 1-80 | keeps svc_ / prd_ ids |
| kind | text | service, product, package |
| name_en | text 1-160 | |
| name_sw / name_sw_state / name_sw_suggested | text / text / text | state none, suggested, approved, edited, rejected; spoken only approved/edited |
| spoken_en | text | owner override of the spoken English name |
| aliases | text[] <= 20 | |
| category_id | text | -> kb_categories.id (same tenant) |
| description_en / description_sw | text | |
| unit | text | job, seat, hour, sqm, seedling, kg, piece, tray, ... (no "per") |
| price_mode | text | fixed, range, from, per_unit, quote, site_visit, free, none |
| price_amount / price_min / price_max | numeric(12,2) | >= 0; min <= max; amount for fixed/per_unit/from (0 for free); min+max for range |
| currency | text | KES |
| needs_visit | bool | true for site_visit |
| bookable | bool | default true |
| in_stock | bool null | null = not tracked |
| popular | bool | owner flag (Hick rule 5) |
| facets | jsonb | narrowing facets |
| delivery_fee_kes | int null 0-100000 | per-item override of the area fee |
| holdable | bool | NEW .2: can be held for a caller |
| excludes_en | text <= 500 | NEW .2: what the service does not include (legacy out_of_scope) |
| status | text | active, paused (NEW), not_offered (NEW), hidden |
| status_note | text <= 120 | NEW .2: paused note ("back next week") |
| sort | int | |
| source | text | owner, import, legacy |
| legacy_ref | text | services_catalog / product_catalog when backfilled |
| row_version | int | optimistic concurrency (send it back on save) |
| search_text / search_tsv | text / tsvector | trigger-maintained; never write |
| created_at / updated_at | timestamptz | |

kb_item_variants (pk tenant_id, item_id, id; fk -> kb_items cascade): label_en text, label_sw text, price_mode (same list
incl. site_visit, default fixed), price_amount / price_min / price_max numeric(12,2), unit text, in_stock bool, sort int, updated_at.

kb_categories (pk tenant_id, id): name_en 1-120, name_sw, name_sw_state, sort, updated_at.

RPCs (service role only; Desk calls them from server actions after the owner check):
- kb_upsert_items(p_tenant uuid, p_items jsonb, p_variants jsonb default '[]', p_hide_missing boolean default false, p_scope text default null) returns jsonb {upserted, hidden, conflicts[]}.
  Absent keys keep stored values for: name_sw, name_sw_state, name_sw_suggested, spoken_en, aliases, description_sw, popular, facets, delivery_fee_kes, holdable, excludes_en, status_note. Item with row_version that does not match -> skipped, id in conflicts. Variants: replaces all variants of each item_id given.
- kb_publish_snapshot(p_tenant uuid, p_doc jsonb, p_source_hash text, p_issues jsonb, p_status text, p_compiler text default 'rules') returns integer (version). Voice only.
- kb_search_items(p_tenant uuid, p_query text, p_limit integer default 5) returns table(id, kind, name_en, category_id, status, score real). status column NEW in .2; hidden never returned.
- kb_record_readiness(p_tenant uuid, p_version integer, p_passed boolean, p_checks jsonb, p_tests jsonb, p_by text default 'script', p_call_sid text default null) returns uuid. Voice only.
Desk server actions (dashboard/src/app/(desk)/settings/knowledge/actions.ts): saveKbItemAction(KbDraft), setKbFlagAction(id,{popular?,in_stock?}), hideKbItemAction(id), decideSwNameAction(id,'approve'|'edit'|'reject',text?), compileKbAction(), previewKbPasteAction(text) -> {ok, rows: KbPasteRow[]}, importKbPasteAction(rows, kind, group).
Pure helpers (dashboard/src/lib/kbCore.ts): parsePasteList(text, existing) -> KbPasteRow {line, raw, name_en, price_mode, price_amount, price_min, price_max, unit, match_id, error}; itemsFromPaste(rows, kind, existing, categoryId); PASTE_MAX_ROWS = 500.
- 10:47 EAT: staging Supabase: applied kb_v2_item_states_2026_10_28_2 (migration 20261028074736). Verified: 3 new cols, status check incl paused/not_offered, kb_search_items returns status. 2 legacy service rows on staging look quote-like (to remap via backfill re-run after deploy).
- 10:52 EAT: PR #996 (follow-up) merged into staging -> bbb8a558. Local gates all 0 (incl. dashboard build with real node_modules); CI Docs + eval:release green.
- 10:53 EAT: GitHub 'Deploy staging Voice' workflow failed: repo secrets RAILWAY_STAGING_PROJECT_ID/SERVICE_ID/ENVIRONMENT_ID not set (run 40652993279). Used the staged path instead: staged source pin 824db1b7 -> bbb8a558 (staging env only), live-call check 0 at 10:54, accept-deploy.
- 10:55 EAT: staging Voice healthz gitSha bbb8a558, kb.gate false.
- 10:58 EAT: staging backfill --apply re-run with bbb8a558 code (first attempt accidentally ran 0fe1b362 code from a stale ref; no new version published by it). All 7 at snapshot v2 compiler kb-rules-2026-10-28.2. Jirani 78386574: Carpet cleaning -> quote, Move-out clean -> site_visit; catalogue check now passes (only areas fail). Ready: b123e978 v2, df4ad9d8 v2.
- 10:57 EAT: staged BRAIN_KB_GATE=on, KB_COMPILE_ON_SAVE=on, KB_SW_SUGGEST=on, KB_SHADOW=on, KB_TEXT_TESTS (8 utterances) on staging Voice; live-call check 0; accept-deploy.
- 10:58 EAT: healthz bbb8a558, kb.gate true, compileOnSave true. Boot sweep (with Gemini) wrote kb_readiness: Grow Tech b123e978 PASS v2 (07:58:29 UTC), D&D df4ad9d8 PASS v2 (07:59:10 UTC); 995e30d9 FAIL catalogue/reader/areas/hours; Jirani 78386574 FAIL areas + test:brain:hours; QA Onboarding Two FAIL areas; Test Archive Co FAIL. kb_shadow: every compare agree=true.
  Latency: lookup 0.04-0.38 ms; full text turn ~4.0 s on Grow Tech/D&D because the model reply TIMED OUT on 18 of 21 turns (grounded KB receipt answered); model ok turns 2.8-3.0 s. Follow-up, not a KB blocker.
- 11:00 EAT: Desk alias scalers-staging.vercel.app -> dpl_DSM5hi6P7pdjRyJ9RF2XZ36SHsbC (bbb8a558, READY; old alias was dpl_FS1d7 for #995). / 200, /signup 200, /admin/login 200 (Admin sign-in), /admin 307 -> /admin/login, /settings/knowledge signed-out -> /login, admin KB API unauth 403.
- 11:00 EAT: prod batch brief updated (#996, SQL #2 kb_v2_item_states, Esga now areas-only, staging findings).
- 11:01 EAT: Page ab5a6eac updated (Build status section, Decisions table complete, Build plan caption). Worktree wt-kbv2-fu left detached at bbb8a558 (hardlinked node_modules, gitignored). Railway staging: no staged changes left. DONE except prod batch (needs Alvin).
- 11:30 EAT: NEW TASK (services_offered retirement PR). Worktree /workspace/wt-kbv2-so branch platform/kb-v2-services-offered-2026-10-28 from bbb8a558.
- 12:05 EAT: services_offered PR built on platform/kb-v2-services-offered-2026-10-28 (c9102832, from bbb8a558). Brain add-on folded in: old-column -> kb_items sync retired (on-save = compile only; syncFromLegacy add-only for backfill); every catalogue-row writer is add-only (no state change, no hide). services_offered only from mirrorKbToLegacy (derived). Paste Replace: kb_import_items 2026-10-28.3 applied on STAGING (self-rollback test OK). Guard fix: 7 kb actions now call memberDenied first. Found + fixed mirror id bug (id: legacy_ref). No conflict with #997 (test merge clean). Gates running.
- 12:25 EAT: #998 merged into staging (merge 5aa6d9ce). Staging Voice: live-call check 0 (last 10 min 0, non-final 30 min 0) -> staged source pin 5aa6d9ce + accept-deploy; /healthz gitSha 5aa6d9ce, kb.gate true. Desk aliased dpl_FDi7bKAD (5aa6d9ce); / /admin/login /signup 200.
- 12:30 EAT: Fresh staging signup #1 (tenant 42cad929): Finish setup -> 3 kb_items active, snapshot live, BUT mirror failed: catalogue_price_history_mode_check (mirror wrote pricing.mode quote). Pre-existing since #993 for any quote/site_visit/none/free item. Fixed in #999 (merge 4147648d; pricing.mode fixed/from/range/ask, exact mode in pricing_mode; round-trip test). Dashboard-only, no Voice deploy. Desk aliased dpl_2DqXV7fG (4147648d); curls 200. Re-ran the mirror for 42cad929 (204).
- 12:40 EAT: Fresh staging signup #2 (tenant 60283fd8) on 4147648d: Finish setup -> /onboarding/line, setup_completed_at set, 3 active kb_items (fixed / range / site_visit), mirror + derived services_offered OK, Catalogue shows "3 services". Live regression: paused Deep clean + not_offered Sofa cleaning, then POST /api/tenant naming both + "Balcony wash - 1800" -> both states unchanged (status_note kept), only Balcony wash added, services_offered lists offered items + notes. Readiness fails only "areas" (expected). Prod brief: PROMOTION ORDER section added.
- 13:50 EAT: NEW TASK merge Brain #1000 (head e543589e) into staging. Tip had moved to 7826b391 (Desk #997/#1001/#1002); merged onto it per parent, clean, no rebase. Local merge e751bb79 gates: test:brain 0 (1462 pass), test:voice 0 (1429), test:mvp 0 (2979), test:desk-bundle 0 (31). No failures (E073 did not fail).
- 13:53 EAT: kb_items status check: constraint kb_items_status allows only active/paused/not_offered/hidden; self-rollback test on staging: kb_upsert_items 'deleted', '' and kb_import_items 'ACTIVE' all raise 23514. Not a hole. Gap: Desk itemFromDraft passes draft status through, so a crafted save can set paused/not_offered/hidden while DESK_KB_ITEM_STATES is off (valid states, authorised editor). Not changed.
- 13:54 EAT: #1000 merged (gh, merge commit) -> f6557e8e (parents 7826b391, e543589e); tree = local gated merge tree 93d63345.
- 13:54 EAT: live-call check 0/0; staged source pin 5aa6d9ce -> f6557e8e, accept-deploy (workflow commitChanges/99dd41c1-.../33ec266a-...). Railway deploy f9d3870a FAILED at CREATE_CONTAINER (registry image pull, infra_error; build + publish OK). Old deploy cb3fd706 (5aa6d9ce) still serving, healthz 5aa6d9ce kb.gate true. Did NOT redeploy (rule); needs parent call.
- 13:57 EAT: Desk aliased scalers-staging.vercel.app -> dpl_FoDeCnDW (f6557e8e READY; old alias dpl_92t2fo5X / 3a037cd9). / /admin/login /signup /settings/knowledge 200.
- 13:58 EAT: smoke on merged code vs staging DB (smoke1000.js, read-only): Grow Tech + D&D mode kb, sentinel servicesOffered not in greeting/prompt/replies, catalogue + price questions OK, simulated paused/not_offered (in memory) never listed, named -> paused receipt w/ note + callback offer / not-offered line. Prod brief step 3 = #1000 f6557e8e.
- 13:58 EAT: parent: fresh build (not redeploy) of f6557e8e on staging Voice. Live-call check 0/0 at 13:58. serviceInstanceDeployV2 (RAILWAY_TOKEN, commitSha f6557e8e) -> deploy 16695b02-5574-4e9c-8568-e03f5217eb6c.
- 13:59 EAT: 16695b02 FAILED at BUILD_IMAGE (different infra error from f9d3870a): "Build Failed: build daemon returned an error < listing workers for Build: failed to list workers: Unavailable: connection error: desc = "error reading server preface: raw-read unix @->/run/buildkit/buildkitd.sock: use of closed network connection" > Event: "Failed to build an image. Please check the build logs for more details." Stopped per instruction (no loop). cb3fd706 (5aa6d9ce) still serving; healthz 5aa6d9ce kb.gate true. Support ids: f9d3870a (image pull at CREATE_CONTAINER), 16695b02 (buildkit workers unavailable at BUILD_IMAGE).
- 14:18 EAT: NEW TASK (Brain Engineer via parent): one shared isKbLive predicate for Voice + Desk. Voice rule found: kb/live.js decision() = BRAIN_KB_GATE on (else null = env lists) AND registry entry from attach (loadKbLive: tenants.kb_live_version/kb_ready_version/brain_target) with isReady = live!=null && ready!=null && live===ready && brain_target==='v2'; load error / not loaded = false; per-business hold brain_target v1. Facts already readable: tenants_select_member + column SELECT for authenticated (no UPDATE on the 3 columns) -> no SQL.
- 14:35 EAT: PR #1005 (platform/kb-live-predicate-2026-10-28, ca7b6155): src/knowledge/kb/kbLive.js isKbLive(tenant, { gate }) -> { live, reason }; live.js decision/isReady/attach + kb-cutover use it; dashboard/src/lib/kbLive.server.ts (requireVoice same module, gate = Desk server BRAIN_KB_GATE) + voice-modules entry; tests/kbLive.test.js (old vs new selector over every facts x gate combo + staging tenants fixture); KB_V2.md contract section; env.md regenerated. Gates: brain 1470/0, voice 1429/0, mvp 2987/0, desk-bundle 31/0; tsc, eslint, docs:check, docs:reference:check, sync-voice-modules OK; CI Docs + eval:release pass.
- 14:37 EAT: #1005 merged -> ba3ae066. Staging Voice healthz still 5aa6d9ce (Railway build failures on f6557e8e), so NOT deployed. Desk Vercel staging has no BRAIN_KB_GATE env (Desk would read gate_off) - not set, needs a yes.
- 14:39 EAT: Desk aliased scalers-staging.vercel.app -> dpl_CEhgXhor (ba3ae066 READY; was dpl_FoDeCnDW). / /admin/login /signup /settings/knowledge 200.
- 14:29 EAT: (approved, staging only) Vercel scalers-staging prj_koYxAaXj: BRAIN_KB_GATE=on, plain, production+preview+development (env id X5pAdpih0nMx9nGO). Prod Vercel project untouched.
- 14:29 EAT: fresh Vercel build of git ref staging/v2-c0-opening-2026-10-21 @ ba3ae066 (create_deployment gitSource, forceNew) -> dpl_BLf3T3zUaA92dyb3K9JatUAqFrcs READY 14:31 ("ships 5 voice entries", kbLive.js in the closure). Alias scalers-staging.vercel.app -> dpl_BLf3T3zU (was dpl_CEhgXhor). / /admin/login /signup /settings/knowledge 200.
- 14:31 EAT: server check (dashboard loadKbLive, staging Supabase, BRAIN_KB_GATE=on as on Vercel): b123e978 + df4ad9d8 live/ready; 42cad929 51a6c7c6 60283fd8 78386574 9301dbca 995e30d9 da25c497 never_ready (live v2, no readiness pass); gate off -> gate_off. Matches Voice's selector (kbLive staging fixture). Prod brief: prod Desk Vercel BRAIN_KB_GATE in the same step as the Voice gate (and kill switch).
- 14:42 EAT: (routine retry) live-call check 0/0 (logs 10 min 0 hits, calls 30 min 0 rows); Railway status degraded (Oct 21 recovery) but builds OK. Fresh serviceInstanceDeployV2 commitSha ba3ae066 -> deploy a5927e87-bc4e-473e-9a8a-4a7bd97400fe SUCCESS; healthz gitSha ba3ae066 (includes f6557e8e #1000 + #1005), kb.gate true, compileOnSave true. Retry routine deleted.

## 14:45–15:28 EAT — Retire the old brain (Platform)
- 14:50 Staging alias → dpl_5kywKuyeS5q9KVx59UDRhZt4ao3e (3895f95b) on scalers-staging.vercel.app (was dpl_BLf3T3zU); /, /admin/login, /signup, /settings/knowledge 200.
- 14:35 Readiness (model off) on the 7 never_ready staging tenants; kb_readiness rows written (by platform-retire-v1-2026-10-28). Gaps are owner data (area picks unconfirmed / missing, hours, empty catalogues); nothing Platform may fill.
- 14:58 #1006 P1 draft (on staging) — superseded by #1008 after B1 #1007 landed as a draft.
- 14:55 Prod read-only SELECTs (fjxcdccgyhnvnnlnovcl) + local compile dry run: all 8 compile live; gap table in the prod batch "Retire old brain".
- 15:22 #1008 P1 draft, stacked on #1007: brainMode.js, brain_mode + set_brain_mode, catalogue-complete mark + set_kb_catalogue_complete, empty-snapshot fallback, healthz counts. SQL 2026-10-28.4 (unapplied). Gates 0/0/0/0.
- 15:27 #1009 P2 draft stacked on #1008: gate removal, healthz brain, SQL 2026-10-28.5 drop brain_target. Brain flag tests red until B2 (expected).
- /tmp inodes hit 100% (ENOSPC in deskVoiceBundle): removed /tmp/node-compile-cache (regenerable cache only).

## 16:33–17:06 EAT — staging merges #1004, #1007, #1008 + SQL .4 + Voice/Desk (Alvin yes 16:33 / 16:36, staging only)
- 16:45 #1004: merged staging into brain/kb-v2-reader-followups (package.json: kbLive + kbReaderFollowups), 5 gates green, live-call 0/0 -> squash merge **52108111**.
- 16:55 #1007: merged staging into brain/b1-degrade-safe-mode (enginePlan/engineTools/package.json both sides; #1004 "we don't offer" tests use a complete catalogue + a sparse "team confirm" case), 5 gates green, live-call 0/0 -> squash merge **3956afd7**.
- 16:58 #1008: merged staging into platform/kb-p1-on-b1-2026-10-28 (head 3a3fa78d), base -> staging (REST), 5 gates green, live-call 0/0 -> squash merge **1a20be8a** (staging tip).
- 16:59 SQL kb_v2_brain_mode.sql 2026-10-28.4 applied to staging sgcdncjxauhsbunobmob (migration kb_v2_brain_mode_2026_10_28_4). Verified: 6 columns, set_brain_mode + set_kb_catalogue_complete (SECURITY DEFINER, search_path pinned, authenticated yes / anon no), both audit tables, no authenticated column UPDATE; 9 tenants brain_mode full.
- 17:00 kb-backfill --apply: 9 businesses, 0 new items, all unchanged at v2; kb-ensure-live --apply: 9 ok, live 2.
- 17:01 live-call 0/0 -> fresh serviceInstanceDeployV2 1a20be8a -> c8e3d3a7-b7e3-42bf-bddd-8c2d05a18428 SUCCESS 17:03; healthz gitSha 1a20be8a, kb.gate true, kb.counts {tenants 9, safe_mode total 0 (env 0 owner 0 admin 0), snapshot_missing 0, snapshot_empty 3}.
- 17:06 Desk alias scalers-staging.vercel.app -> dpl_5yoqeJcL4VNcdWSyWg6yBDYFBk4D (1a20be8a, READY; was dpl_5kyw); / /admin/login /signup /settings/knowledge 200.
