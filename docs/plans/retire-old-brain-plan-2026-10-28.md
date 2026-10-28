---
owner: platform
last_reviewed: 2026-10-28
---

> Copied from the Scalers Chief account box (`/workspace/briefs/retire-old-brain-plan-2026-10-28.md`) on 28 Oct 2026 as part of the handover. Parked; see [`../HANDOVER.md`](../HANDOVER.md) §4.

# Retire the old brain (v1/legacy) — root-cause removal plan
Brain Engineer, 28 Oct 2026 (~15:30 EAT). PLANNING ONLY: no commits, no pushes, staging Supabase SELECT-only, nothing on prod.
Mandate: Alvin in Desk chat, 28 Oct 14:45 EAT: "Yes, ask Brain and Platform to remove the old brain completely on staging and prod". Prod pushes each need his own yes.
Refs read: staging tip `staging/v2-c0-opening-2026-10-21` @ **3895f95b** (#1003, contains #1000 f6557e8e + #1005 ba3ae066); main @ **9af65811** (prod runs **c620b379**, an ancestor of main). Worktrees: `/workspace/wt-retire-stg`, `/workspace/wt-retire-main`.
Folded in: Platform's draft-PR scope, the safe-mode contract `brainMode(tenant, { safeEnv })`, and Platform's prod facts (relayed by the parent).

## 0. Target
Only **v2 engines + KB** remain. There's no v1 fallback anywhere. Every caller turn goes through `liveTurn.run → runBrainEngines` (understanding → plan → tools over the KB snapshot → guarded reply), with the v2 rules/repair template as the only in-brain fallback (it is v2, not v1). One emergency **safe mode** per tenant (default off). Readiness stays as a **quality signal**; it no longer picks the brain.

What "old brain" means in code (the naming is confusing): `BRAIN_V1_DRAFT*` / `modelLead` / `callCore` are **not** the old brain. They are the v2 model-lead path that the engines are built on (`brainEngines.js:17-18` requires `modelLead` and `v1draft`). They stay, and only their *gates* collapse. The old brain is the server.js Gemini-prompt turn (`buildSystemPrompt` + `runGeminiTurn*` + local reply/catalogue mouths), the `/ws/relay` path, the shadow, and the legacy catalogue/coverage readers.

### Key finding (staging, live today)
With `BRAIN_KB_GATE=on`, `kb/live.decision()` returns **false** for a tenant that isn't ready. That makes `flag.tenantAllowed` false (`src/conversation/v2/flag.js:14-20`), so `brainV2Enabled` is false and `v2Live` is false (`server.js:4652`). The call then runs the **old Gemini brain** (`server.js:4841` onward). On staging today, **5 active tenants** are on the old brain: Jirani (78386574), KB Signup Test 1028 (42cad929), KB Signup Test 1028 B (60283fd8), QA Onboarding Two (9301dbca), and the second Grow Tech row (995e30d9, empty). The "readiness picks the brain" design sends unready tenants to v1. This is the root cause the removal fixes.

## 1. Inventory (file:line; S = staging 3895f95b, M = main 9af65811)

### 1a. Brain switch (where v1 gets chosen)
| Item | Staging | Main | Fate |
|---|---|---|---|
| `tenantAllowed` (KB decision or env allowlist) | S `src/conversation/v2/flag.js:14-20` | M `flag.js:12-16` (env list only) | delete; v2 always |
| `brainV2Enabled` / `brainV2Mode` / `brainEnginesOn` / `brainV2ShadowEnabled` | S `flag.js:21-34` | M `flag.js:17-30` | collapse to constants, then delete the module |
| Per-turn switch | S `server.js:4652-4653` (`v2Live`, `v2Owns`) | M `server.js:4598-4599` | always owned |
| Non-owned v2 try, "using v1" catch | S `server.js:4792-4840` | M `server.js:4738-4786` | delete |
| **Old Gemini turn** (lookup plan, catalogue mouths, arbiter, name gate, rejected-create, Gemini stream, recovery) | S `server.js:4841-~6165` (end of `runCallerTurn`, starts 4246) | M `server.js:4787-~6110` (`runCallerTurn` 4192) | delete (~1,330 lines) |
| LLM recovery helpers | S `server.js:4168-4245` | M ~4114-4191 | delete |
| v2 shadow block | S `server.js:4491-~4540`; `src/conversation/v2Shadow.js` (257); `v2/shadowHandlers.js` (16); `voiceTrace.js:544` | M `server.js:4441` | delete |
| System prompt per call | S `server.js:2824,2834,3258,3287,4456,4552` (`buildSystemPrompt`, `src/prompts.js` 400 lines) | same family | delete (v2 builds its own model context) |
| `runGeminiTurnStreaming` / `runGeminiTurn` / `voiceGeminiConfig` / `spokenFromLookupTool` | S `server.js:8907-9272`, `8448-8497` | M `8854-9219` | delete. **Keep `applyGeminiTools` (8498)**: the owned v2 path calls it (`server.js:4672`); rename later |
| `/ws/relay` legacy ConversationRelay ("unused in Phase 2", `server.js:2436`) | S `server.js:2437, 2491-2496, 8133-8420` | M `8080-…` | delete (Voice lane) |
| `held_v1` / `brain_target` | S `src/knowledge/kb/kbLive.js:8,14,34,43,53,61`; `src/db.js:1678-1690,1731,1763`; `scripts/kb-cutover.js:5-6,16-24` | n/a (no KB on main) | Platform: drop `held_v1`; `brain_target` → `brain_mode` |
| `BRAIN_KB_GATE` **brain-switch** role | S `kb/live.js:8-19` (`decision`), `v2/flag.js:12-16`, `v2/v1draft.js:26-28` | n/a | delete |
| `BRAIN_KB_GATE` **KB-read** role | S `kb/live.js:9,35` (`attach` reads the snapshot only when gate on + ready); `dashboard/src/lib/kbLive.server.ts:22-24` | n/a | `attach` always attaches the live snapshot (empty is allowed); gate gone |
| Env allowlists | `BRAIN_V2_TENANTS` S `flag.js:9-11`, `v2Shadow.js:26`; `BRAIN_V1_DRAFT_TENANTS` + hard-coded DnD default S `v1draft.js:21,29` (M `v1draft.js:20-26`) | prod: V2_TENANTS unset, V1_DRAFT_TENANTS = 8 ids | delete. **Today a new prod tenant falls off engines onto the v2 rules turn** because it isn't in the list |

### 1b. v2 prerequisite flags → always-on
All are read as `off` when unset. **Unsetting any of them on today's code sends calls to v1**, so env removal must come *after* the code collapse.
| Flag | Read at (S) | Collapse |
|---|---|---|
| `BRAIN_V2` | `flag.js:22`; `liveTurn.js:205` | always true |
| `BRAIN_V2_MODE` | `flag.js:29`; `liveTurn.js:205` | always `live` |
| `BRAIN_V2_OWNS_CALL` | `ownsCall.js:20-22`; `server.js:1612,4263,4653`; `commitSafety.js:14-17` | always owned; commit safety always on |
| `BRAIN_V1_DRAFT` (+`_TENANTS`) | `v1draft.js:23-32`; `liveTurn.js:210-212,617,623`; `server.js:4691` | always `on` |
| `BRAIN_V1_DRAFT_PHASE_A` | `v1draft.js:37-39`; `server.js:3040,3549,4692,6436`; `speech/fillerCut.js:2` | always on |
| `BRAIN_MODEL_LEAD` | `modelLead.js:18-20`; `server.js:4682,4699`; `turnTaking.js:482` | always on |
| `BRAIN_ENGINES` | `flag.js:31-34`; `brainEngines.js:31-32`; `liveTurn.js:221,377`; `server.js:4699` | always on |
| also gated on the same chain | `BRAIN_CALL_CORE` `callCore.js:22`; `BRAIN_V1_DRAFT_PHASE_B` `callPlan.js:21`; `BRAIN_V2_SHADOW*` | the non-engines branches die (see 1c) |
| `BRAIN_V2_TENANTS` | `flag.js:9-11`; `v2Shadow.js:26` | delete |
| `BRAIN_KB_GATE` | `kb/live.js:9,17`; `kbLive.js:50`; desk `kbLive.server.ts:24` | delete (Platform) |
| sim/test env | `scripts/brain-engines-sim.js:4-8,70`; ~31 test files set these | drop |
Docs: `docs/reference/env.md:39-56`.

### 1c. Non-engines branches inside v2 (dead once collapsed)
`liveTurn.js:205-207` (the null return when v2 is off; a null leads server to v1). `:220-225` → `runBrainEngines` only; the `runModelLead`-without-engines branch goes. `:226-227` `runPhaseB` / callCore (`liveTurn.js:296-~600`). The `vd.turn` #932 draft path (`:228-…`). The v2 rules/receipt template stays as the total fallback. `server.js:4718-4744` (`v1Filler`, the non-engines filler) and the non-engines `onV1Sentence` at `4745-4756`. `modelLead.js`, `v1draft.js`, `callPlan.js`, `callCore.js` stay as libraries for the engines (`modelLead.js:13-14` requires CP/CC). Prune unused exports only.

### 1d. Legacy catalogue / knowledge readers
| Item | Location (S) | Fate |
|---|---|---|
| `services_offered` reads | `src/db.js` (14 refs, select lists 1520-1559); `liveKnowledge.js` (3); `dynamicSpeech.js` (2); `businessAssistantIntro.js` (2); `tenantProfile.js` (1); `provenance.js` (1); `kb/source.js:6-39` legacy mode | legacy mode in `kb/source.js` goes; KB is the one source; column stays derived until Platform drops it |
| `services_catalog` / `product_catalog` on the call | `kb/live.js:39-40` (`docToLegacy` projection); `v2/engineTools.js:49` | engines read `kb/source` only; projection is removed after B3 |
| `liveKnowledge.js` (427) | importers: `prompts.js`, `catalogueMouth.js`, `liveTransferReady.js`, `entityExtraction.js`, `knownFacts.js`, `speech/sttContext.js` | delete after Voice moves `sttContext` to the KB index |
| `catalogueMouth.js` (533), `v2CatalogueTurn.js` (80), `turnProposals.js` (80), `turnPolicy.resolveLocalReply` (373) | old-turn-only mouths (`server.js:379,394,4890-4919`) | delete |
| `src/knowledge/v2/receipts.js` (185), `catalogue.js` (91), `lexicon.js` (156) | **no importers (dead)**; holds the hard-coded DnD "usafi wa …" builders `:14,53-65,127-132`. `knowledge/v2/nlu.js` is used by `knowledge/lookup.js:15` | delete the three; keep nlu until lookup goes |
| **"usafi wa" builders in the live v2 receipts** | `src/conversation/v2/receipts.js:39,83-97,189-193` (DnD ITEM_WORDS, house/deep/office category lines) | delete; categories come from `kb/source` groups (approved names only) |
| `swNameRules` spoken catalogue | `src/knowledge/spokenCatalogue.js:45,59-103,146,236` (export `:415`); still reached via `conversation/spokenCatalogue.speakCatalogueName` (`:128`) from `v2/receipts.js:6,32,215`, plus `v2/machine.js:15,27`, `proposals.js:12`, `intentGate.js:7`, `catalogueStep.js:8` | v2 names come from the KB name lock (`kb/spoken.js`) only; drop `swNameRules`/`explainRules` and the non-KB `speakCatalogueName` calls |
| `knowledge/lookup.js` (1,425) | `server.js:381`, `dynamicSpeech.js`, `router.js` | old-turn lookup tool; delete with B3 if dynamicSpeech/router have no live use (verify) |
| `nextBestAction.js` (564), `goalModel.js` (308), `router.js` (268) | `server.js` pre-turn (`:226` logs `next=`); `brainState.js` | B3 candidate, verify that `brainState` feeds v2 only via `callerFile` |
| `promptFacts.js` (57) | no importers | delete |

### 1e. Old fact readers / coverage_areas
| Item | Location (S) | Fate |
|---|---|---|
| gigo `factReaders.js` (530), `factSchema.js` (334), `factValidate.js` (173), `factTools.js` (158) | only live importer: `confirmedCoverage.js:30` (`readFact`); 6 tests | rewire confirmedCoverage to area picks, then delete gigo (B3) |
| `coverage_areas` readers | `businessPolicies.js` (10 refs, `:123`), `gigo/factSchema.js` (9), `confirmedCoverage.js` (8), `provenance.js` (5, `:432`), `coverageAreas.js`, `visitLocation.js:265,312`, `promptFacts.js`, `listedAreas.js`, `areaTerms.js`, `outsideAreas.js`, `speech/sttContext.js`, `v2/ownerFacts.js:102`, `server.js` (1) | v2 answers coverage only from `tenant_area_picks` (`v2/areaCoverage.js:342`). The legacy-list fallback `areaCoverage.js:7,99,229-234,294-325` goes, and so does its tree "outside" verdict from an unconfirmed list (`:231-232`) |
| `BRAIN_CONFIRMED_COVERAGE` | `confirmedCoverage.js:17` + 10 sites | was already on the 3-engine delete list; folds into area picks |

### 1f. Prior DELETE list (3-engine design, `briefs/ba-arch-brain-input.md:48-52`)
`callFixesD199.js` (1,442; 20 importers), `trustP1.js` (already gone), `speechGuard.js` drop rules, `catalogueMouth.js`, turnPolicy local-reply strings, `toolExecution.js` formatToolConfirmation tree (~1450-1664), `spokenStreamBuffer` marker logic, noAiSlop marker stripping, `events.js isInternalResolutionNote`, callerInfoTrust line builders; flags `BRAIN_CALL_FIXES_D199`, `BRAIN_TRUST_P1`, `BRAIN_GEMINI_CATALOGUE`/`VOICE_GEMINI_CATALOGUE`, `BRAIN_CONFIRMED_COVERAGE`; prompt marker grammar (`prompts.js`, `nextBestAction.js`, `goalModel.js`).
**In this plan:** catalogueMouth, the turnPolicy local reply, the prompt marker grammar and BRAIN_GEMINI_CATALOGUE go in B2/B3. callFixesD199, toolExecution strings and spokenStreamBuffer markers are woven into `applyGeminiTools`, which the v2 owned path still uses. They're a **phase 2** follow-up, not a blocker for "no v1 brain".

### 1g. Legacy golden / snapshot tests
`tests/fixtures/kbLegacyGolden.json`, `tests/helpers/kbLegacySurface.js`, `tests/kbSource.test.js` (legacy byte-equal), `tests/provenanceMirror.test.ts`. Old-turn suites: `brainV2Shadow`, `catalogueMouth`, `geminiVoice`, `llmRecovery`, `turnArbiter`, `tenantPromptFacts` (+35 files use `buildSystemPrompt`/`runGeminiTurn`/`resolveLocalReply`/`planCatalogueMouth`/`BRAIN_V2_SHADOW`; 31 set v2 flags). `src/speech/replayVoice.js:335-336` replays through `prompts`/`geminiVoice` and has to be retargeted to the engines.

## 2. Readiness blockers

### 2a. Staging (SELECT, 28 Oct ~15:10 EAT)
| Tenant | active | KB live/ready | items | area picks (confirmed) | hours | policies / FAQs | brain today |
|---|---|---|---|---|---|---|---|
| Done and Dusted df4ad9d8 | yes | 2/2 | 11 | 11 (11) | yes | 13 / 12 | engines |
| Grow Tech b123e978 | yes | 2/2 | 69 | 1 (1) | yes | 7 / 1 | engines |
| Jirani 78386574 | yes | 2/– | 7 | 5 (0) | yes | 8 / 5 | **old brain** |
| KB Signup Test 1028 42cad929 | yes | 2/– | 3 | 0 | yes | 2 / 0 | **old brain** |
| KB Signup Test 1028 B 60283fd8 | yes | 2/– | 4 (2 offered) | 0 | yes | 2 / 0 | **old brain** |
| QA Onboarding Two 9301dbca | yes | 2/– | 1 | 1 (0) | yes | 1 / 2 | **old brain** |
| Grow Tech (dup) 995e30d9 | yes | 2/– | 0 | 0 | no | 0 / 0 | **old brain**; looks like a duplicate row |
| Jirani da25c497, Test Archive Co | no | 2/– | 0 | 0 | no | 0 | n/a |
Every staging tenant already has a snapshot (live = 2), so Platform's backfill is a no-op for staging except for setting `brain_mode`.

### 2b. Prod (Platform facts, 28 Oct; Platform's per-tenant gap table to follow)
Prod = main **c620b379** (#985), Railway a452a964. **The engines are on prod**: #966/#975/#976 came in via 344055e7, an ancestor of c620b379 (checked). v2 is live for all tenants (`BRAIN_V2=1`, `MODE=live`, `OWNS_CALL=1`, `ENGINES=on`, `V1_DRAFT_TENANTS` = the 8 ids; `full-promotion-prod-prep-2026-10-27.md:11-36`). The KB stack (#991–#1005) **isn't on prod**: no kb_* tables or kb columns, SQL .1/.2/.3 not applied. The prod engines read `services_*` but not `product_catalog`, which is why Grow Tech says "not sure". So **no prod tenant is on v1 today**. The v1 code is still deployed, and an env slip or a missing allowlist entry routes to it (or to the weaker v2 rules turn).
| Prod tenant | Gap (Platform) | Before v1 can go |
|---|---|---|
| Grow Tech | catalogue only in `product_catalog`; areas unconfirmed | SQL + backfill product_catalog → kb_items, publish; areas: owner confirms (until then "team will confirm" per place) |
| Done & Dusted | 1 item; no areas | backfill + owner adds items (until then sparse-catalogue rule, §2c); no areas → every place "team will confirm" |
| Esga | areas unconfirmed | backfill; confirm areas |
| ALFAAL | areas unconfirmed | backfill; confirm areas |
| Grok Test | (await table) | backfill |
| Scalers BS | **empty catalogue, no hours** | empty snapshot; degrades to capture-only (§2c); or safe mode, or mark inactive if not a real line |
| Uwezo | **empty catalogue, no hours** | same as Scalers BS |
| Chapter One | inactive | backfill an empty snapshot so the invariant holds; the inactive gate already blocks calls |

### 2c. Fail-closed degradation (Brain B1; covers these exact cases, EN + SW)
The rule is never to guess. Each gap maps to "the team will confirm" + capture, a callback, or a handover. The guard (`engineGuard` known numbers / `kb/live.knownNumbers`) already blocks unknown numbers. B1 adds receipts and tests for:
| Gap | Caller asks | Brain does |
|---|---|---|
| Empty snapshot (Scalers BS, Uwezo, Grow Tech pre-backfill) | "what do you offer", a price, an item | No list and no price. "I'll have the team confirm that for you. Can I take your name?" Saves a callback request with the asked item as the reason. No "we don't offer that" |
| Sparse catalogue (D&D prod: 1 item) | an item not in KB | **"team will confirm"**, not #1004's "we don't offer that". A plain no only when the catalogue has ≥ N items *and* the owner marked it complete (question 1) |
| Item present, no price | price | "custom quote / site visit" if typed; else "team will confirm the price" + capture |
| No area picks (D&D prod) | "do you come to X" | "I'll have the team confirm X." Never yes or no, no fee. Brain also stops the legacy-list "outside" verdict (`areaCoverage.js:231-232`) |
| Unconfirmed picks (Grow Tech, Esga, ALFAAL) | same | same as no picks; unconfirmed rows are never spoken as fact |
| No hours (Scalers BS, Uwezo) | "when are you open", booking | No hours stated. A booking becomes a request with the caller's preferred time ("the team will confirm the time"), and no slot is offered as available |
| No policies/FAQ | payment, returns, deposits | "team will confirm" + capture |
| No owner alert channel | any capture | still saved to the Desk inbox; readiness flags it (`readiness.js:39-41`) |
| Snapshot load error at call start | anything | treated as an empty snapshot (degrade), logged, and counted on healthz |
| Model outage | any turn | the existing v2 rules/repair template (v2), never v1 |
Tests: one fixture per row × EN/SW, through `runBrainEngines` in text mode (no model, stubbed understanding) and through `readiness` text tests. The rewritten golden replaces `kbLegacyGolden.json`, and proves zero invented numbers, names or yes/no on areas.

### 2d. Safe mode (contract agreed with Platform)
`brainMode(tenant, { safeEnv }) → { mode: 'full' | 'safe', reason }` is pure, lives in `src/knowledge/kb/` next to `isKbLive`, and comes from Platform. Sources: the new `tenants.brain_mode` column (default `'full'`; `brain_target` is dropped in the removal migration), and the global env `BRAIN_SAFE_MODE` (`'all'` means every tenant). Brain calls it **once at call start** (profile load / `/voice/incoming` prefetch, pinned for the call like `profile.kb`) and owns the behaviour:
- **Safe script (rules only, no model needed, EN + SW):** greet with the business name → take the name → confirm the number (caller ID; ask if withheld) → take the reason (free text) → read all three back → get a yes (one correction loop) → save a callback request + owner alert, or hand over when `handoff_mode` allows a transfer (transfer is OFF on prod today) → close.
- No catalogue, prices, areas, hours or bookings. Any such question gets "the team will call you back about that" and the script goes on.
- It runs through the same owned-turn plumbing (`ownsCall.runOwnedTurn`, write receipts, `finishCall` once). The trace and the call summary record `brain_mode=safe` + reason.
- Size: ~250 lines + ~30 tests.

## 3. PR sequence (staging first; each a draft with tests + revert path)
Baseline gates at 3895f95b/ba3ae066: **brain 1462, voice 1429, mvp 2979, desk-bundle 31**, all 0 fail. "No regression" means: 0 failures. Every deleted test is listed in the PR with either its v2 replacement or "tested deleted code". The **v2/engines/KB test count never drops**. The HD/regression replays stay green, with their v1 expectations rewritten as v2 expectations.

| # | Lane | PR | Depends | Contents | Revert |
|---|---|---|---|---|---|
| S1 | Brain | **B1 Degradation + safe mode** (additive) | — | §2c receipts/branches in engines + §2d safe script; consume `brainMode` (stubbed until P1); EN/SW tests; healthz fields (counts) | revert commit; inert while `brain_mode` = full and catalogues are full |
| S2 | Platform | **P1 KB always-on** (Platform's draft) | B1 merged | `isKbLive` always true (readiness = quality signal); remove `held_v1` and `brain_target` 'v1'; remove BRAIN_V2_TENANTS / V1_DRAFT_TENANTS reads in platform code; remove the BRAIN_KB_GATE switch; add `brainMode()` + `tenants.brain_mode` (draft SQL); backfill a published snapshot for every tenant (empty if need be); `brain_target`='v2' for all | revert + `BRAIN_SAFE_MODE=all` as the emergency brake |
| — | | staging deploy, then test calls: D&D (full), Jirani (unready, now engines), KB Signup Test 1028 B (sparse + not-offered), a tenant with empty KB, safe mode on one tenant (EN + SW) | | | |
| S3 | Brain | **B2 Delete the old turn + collapse flags** | P1 green on staging | §1a/§1b/§1c: `server.js` old turn, non-owned v2 block, shadow, recovery, prompt per call, `runGeminiTurn*`; `flag.js` → gone; `v1draft.mode`/`phaseA`/`leadOn`/`brainEnginesOn`/`ownsCallEnabled`/`commitSafetyEnabled` → constants; `liveTurn` engines-only; delete the null-return-to-v1 contract; rewrite v1 tests as v2 | `git revert` the merge. **The env vars are still set**, so the old code works again on revert |
| S4 | Voice | **V1 Old-brain speech** | B2 (same server.js region; Voice rebases after) | delete `/ws/relay` (`server.js:2436-2496, 8133-8420`); non-engines filler (`4718-4756`), `fillerCut` PHASE_A gate, `enginesFillerStanddown` off branch, `turnArbiter` (old-turn only), `replayVoice.js:335-336` → engines replay; `sttContext` + greeting (`greetingWarm`, `callOpening`, `businessAssistantIntro`) → `kb/source` | revert |
| S5 | Desk | **D1 Admin pill + gate-off** | P1 (+B2 for wording) | `BusinessKbBlock.tsx:14,49,59,92-106` (Old brain pill, Hold on old brain); `api/admin/businesses/[id]/kb/route.ts:17,31,38,56-85` (`set_brain_target`); `stepUpCore.ts:85-87`, `stepUpWords.ts:22`; `kbLive.server.ts:11,22-36` (`gate_off`); `kb.server.ts:35,57,67,86`; `kbCaller.server.ts:40`; add a Safe mode control (Unlock + reason) that writes `brain_mode` | revert |
| S6 | Brain | **B3 Dead modules + legacy readers** | B2, V1 | §1d/§1e: `prompts.js`, `geminiVoice.js` (after V1), `v2Shadow`, `llmRecovery`, `catalogueMouth`, `v2CatalogueTurn`, `turnProposals`, the turnPolicy local reply, `knowledge/v2/{receipts,catalogue,lexicon}`, the DnD builders in `conversation/v2/receipts.js`, `swNameRules` + non-KB `speakCatalogueName`, `liveKnowledge`, `promptFacts`, gigo (after the confirmedCoverage rewire), the legacy coverage fallback, `kb/source` legacy mode + `docToLegacy`, `kbLegacyGolden` → v2 golden | revert |
| S7 | Platform | **P2 Env + SQL cleanup** | B2, B3, V1, D1 deployed and healthy ≥ 24 h | remove the env vars (V2, V2_MODE, V2_OWNS_CALL, V2_SHADOW*, V1_DRAFT*, *_TENANTS, MODEL_LEAD, ENGINES, CALL_CORE, KB_GATE) from Railway + Vercel; `env.md`; healthz `brain: 'v2-engines'`, `kb.version`, `safe` count, `empty_kb` count; SQL drop `brain_target` (after a release with no readers); `services_offered` drop later | re-add the env snapshot (kept in the brief) |

**Order rule:** code stops reading a flag *before* the env var goes. Unset means v1 on today's code.

**Prod (each step needs Alvin's yes in Platform's chat):**
- **Prod-1:** the KB stack already planned (#998/#999 → #1000 → #997 → #1001-#1005, SQL .1/.2/.3), with `BRAIN_KB_GATE` unset (no behaviour change).
- **Prod-2:** backfill all 8 tenants (Grow Tech's product_catalog → kb_items; empty snapshots for Scalers BS, Uwezo, Chapter One). Read-back of item counts and the readiness report per tenant.
- **Prod-3:** B1 + P1 (every tenant on KB with degradation). Test calls: Grow Tech (product question, unconfirmed area), D&D (1 item + unknown item, no areas), Scalers BS (empty), Swahili on one. `BRAIN_SAFE_MODE=all` is the brake.
- **Prod-4:** B2 + V1 + D1, then B3.
- **Prod-5:** P2 env removal (snapshot the env first).
- **Prod-6:** SQL drop `brain_target`.
Engines are already on main, so no engines promotion is needed.

### Size estimate
Rough: line counts read off the files, but the B2/B3 module importers aren't all verified.
- **B1:** +600–800 lines (≈ 350 code, 400 tests); ~40 new tests.
- **B2:** about −2,300 to −2,600 code lines (server.js ≈ −2,100: old turn ~1,330, `runGeminiTurn*` ~365, relay/helpers/recovery/shadow ~250, prompt-per-call bits; liveTurn ≈ −300; flag/gate collapse ≈ −100), +~150. Tests: ~30–40 files edited, ~10 deleted.
- **B3:** about −3,000 to −4,500 (prompts 400, geminiVoice 345, v2Shadow 273, catalogueMouth 533, v2CatalogueTurn 80, turnProposals 80, knowledge/v2 dead 432, liveKnowledge 427, gigo ~1,195, legacy areas/receipt builders ~200, plus lookup 1,425 / nextBestAction 564 / router 268 *if* verified dead). Tests: ~15–25 files deleted or rewritten.
- **Total Brain:** roughly **−5,500 to −7,000 lines net**, three PRs. Too big for one reviewable diff, so it's split as B1/B2/B3.

## 4. Risks
1. **Env-before-code:** removing any v2 flag on today's code silently routes to v1, so P2 must come last. This is the riskiest step.
2. **Engines become the only path for tenants that never ran them.** Staging: Jirani and the test tenants (they're on v1 today). Prod: a new tenant outside the `V1_DRAFT_TENANTS` list. Needs staging test calls before Prod-3.
3. **#1004's "we don't offer that"** is wrong on a sparse catalogue (D&D prod has 1 item). B1 has to land the sparse rule before P1 on prod.
4. Without the old Gemini path there's no "second chance" when engines fail mid-turn. Only the v2 repair template is left. Model outage = repair/safe lines, so watch repair rates for 24 h after Prod-3.
5. `applyGeminiTools` + `callFixesD199` + `toolExecution` strings stay (phase 2). The "old brain" name will still show up in write plumbing until then.
6. Merge conflicts: B2 and V1 both cut `server.js`. Voice rebases on B2; there should be no parallel edits in `runCallerTurn`.
7. Desk mirrors (`provenance.ts`, `kbLive.server.ts`) must drop legacy branches in the same release, or the preview diverges from calls.
8. Empty-catalogue tenants on prod (Scalers BS, Uwezo) will sound thin (capture-only). That's honest, but the owners should hear about it.

## 5. Questions for Alvin
1. **Sparse catalogue:** when a caller asks for an item we don't have, should the bot say "the team will confirm" until the owner marks the catalogue complete, and only then "we don't offer that"? (Recommend yes.)
2. **Safe mode trigger:** manual only (Super Admin per business with Unlock + reason, plus the global `BRAIN_SAFE_MODE=all`), or also automatic for a business with an empty catalogue *and* no hours (Scalers BS, Uwezo)? (Recommend manual, plus automatic only when the snapshot fails to load.)
3. **Safe mode ending:** a callback request + owner alert (recommend), or a live handover where the business allows it? (Transfer is off on prod today.)
4. **Scalers BS and Uwezo:** real lines taking calls, or test accounts? If they're tests, mark them inactive instead of running capture-only.
5. **No hours:** take bookings as requests with the caller's preferred time ("the team will confirm"), or no bookings at all until hours are set? (Recommend requests.)
6. **Unconfirmed areas (Grow Tech, Esga, ALFAAL):** never answer yes/no from an unconfirmed list, even an obvious "no" like Kericho for a Nairobi-only business? (Recommend never, until the owner taps "Looks right".)
7. **brain_target:** drop it in the same migration (Platform's contract) or keep it read-free for one release first? (Recommend keeping it one release, then dropping.)
8. **Prod order:** OK to run Prod-1 → Prod-3 in one evening with test calls between steps, with B2/B3 the next day after 24 h of clean calls?
