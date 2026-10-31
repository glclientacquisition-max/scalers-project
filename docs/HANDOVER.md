---
owner: platform
last_reviewed: 2026-10-28
---

# Scalers handover (start here if you are a new account, owner or agent)

Written 28 Oct 2026, ~17:45 EAT, by the **Scalers Chief** Grok Bot account, which is wrapping up. Alvin's decision (28 Oct 17:12 EAT, "A with good instruction"): **park the staging-only work for the other Grok Bot account** and close out this one.
The repo is now the only shared surface. Nothing on the old account's box (`/workspace`, briefs, skills, memory) can be reached from the new account. Everything you need is in this file, [`STATUS.md`](STATUS.md) and [`docs/plans/`](plans/).
**No secret values are in this file.** Only env var names and where they live.

Facts in this file were checked between 17:00 and 17:45 EAT on 28 Oct, read-only: GitHub API, Railway and Vercel deploy lists, `/healthz`, and Supabase SELECTs and advisors. Current state always wins from `docs/STATUS.md`.

## 1. What Scalers is

Scalers ([scalers.co.ke](https://scalers.co.ke)) is a Kenya-focused, multi-tenant Business Assistant. A business gets a phone number, and when a call is missed, busy or after hours, the assistant answers, takes the caller's name and reason, answers from the business's own facts, and notifies the owner. The owner works in the **Desk** (setup, call inbox, contacts, approve-first SMS and WhatsApp, package usage). Super Admin (inside the Desk at `/admin`) runs businesses, numbers, billing and quality.

## 2. Architecture

| Part | What | Where it runs |
| --- | --- | --- |
| Voice | `server.js` at repo root: HTTP, `/ws/media`, turn loop. Telephony **SautiKit**; STT/TTS **Soniox**; model **Gemini** | Railway project `scalers-project`: prod service `9b09d8c6` (env `8dd0b8ef`), staging service `e37d143d` (env `99dd41c1`) |
| Brain | Conversation logic in `src/conversation/` and `src/knowledge/`. Runs inside the Voice process. Prod runs the **v2 three-engine stack** (`BRAIN_ENGINES`) | Railway, same as Voice |
| Desk + Admin | Next.js App Router in `dashboard/` | Vercel project `scalers-project` (prod `app.scalers.co.ke`), staging project `scalers-staging` |
| Data | Supabase | prod ALCR `fjxcdccgyhnvnnlnovcl`, staging `sgcdncjxauhsbunobmob` |

Depth: `docs/explanation/architecture/SYSTEM_ARCHITECTURE.md`, `docs/reference/platform/PLATFORM_SYSTEM_MAP.md`, `docs/reference/lanes/*.md`, `CONTEXT.md`. Node 22. Two apps, one repo, deployed separately.

## 3. Environments right now (28 Oct, ~17:20 EAT)

| | Prod | Staging |
| --- | --- | --- |
| Branch | `main` @ **`9af65811`** (#988, 10:36 EAT) | `staging/v2-c0-opening-2026-10-21` @ **`1a20be8a`** (#1008, 17:00 EAT) |
| Voice running | **`c620b379`** (#985 promotion, deploy `a452a964`, started 00:08 EAT 28 Oct). Main moved on with Desk-only commits #986–#989; Railway **skipped** those (watch paths), so Voice is behind main on purpose | `1a20be8a`, started 17:02 EAT, `kb.gate=true`, 9 tenants, 3 empty KB snapshots |
| Desk running | `dpl_9Wy77hoH…` READY at `9af65811` | follows the staging branch (see the alias issue in §8) |
| Rollback | Desk: `dpl_B1o8GCnP…` (`c620b379`), then `dpl_BMyC15GK…` (`45596057`). Voice: redeploy the previous successful build or `git revert -m 1 c620b379` (new commit, never force-push). `27c536b8` (`45596057`) is marked REMOVED in Railway; confirm it can still roll back before relying on it | Railway keeps the last good deploy if a build fails |
| Migrations | Complete through `20261027144019` (`save_spoken_catalogue_version`) | Prod's set **plus** the 4 KB v2 migrations and `admin_invoice_actions` (§5) |
| Phone balance (SautiKit) | **KES 9.29** (16:53 EAT). DID rental due 1 Nov. **Top up before any test call** | KES 34.05 |
| Soniox | No error on prod since start, but it hasn't spoken since 01:33 EAT | **TTS 402 "organization balance exhausted" at 17:01 EAT.** If prod shares the Soniox org, prod calls will play the downtime clip |
| SMS (TextSMS) | 126 credits | 125 |

**Prod businesses (8):** ALFAAL Ventures, Done and Dusted Cleaning Services, Esga Stationery, Grok Test, Grow Tech Nurseries Ltd, Scalers Business Solutions, Uwezo enterprises (all active), Chapter One Bookstore (archived).
**Live lines (prod):** Esga Stationery **+254709221542**, Grow Tech Nurseries **+254709221536**. The other businesses are waiting for numbers. Staging test line: Done and Dusted **+254709221537** (sample data).
**+254709221536 is releasable** like any other number since 27 Oct (Alvin, 15:54 EAT), but only through Admin with Unlock, a typed reason, confirm and an audit row.
**Calls since the 28 Oct promotion:** one, Grow Tech, 01:33 EAT, 79 s, `complete`. **Nobody has graded it yet.**

**Prod flags (names and values only where non-secret):**
- Vercel prod: `DESK_PLAN_CHANGE=on`, `ADMIN_V2=on`, `BRAIN_CALL_FIXES_D199=on`.
- Railway prod: the v2 Brain env set (`BRAIN_V2`, `BRAIN_V2_MODE=live`, `BRAIN_V2_OWNS_CALL`, `BRAIN_ENGINES=on`, `BRAIN_V1_DRAFT_TENANTS` = all 8 ids, and others). The new brain is on for every prod business.
- Off on prod: live transfer (`/healthz` `liveTransfer.executor=false`), spoken catalogue, `FACT_HASH_MODE` (unset).
- Never set `VOICE_GEMINI_CATALOGUE` or `BRAIN_GEMINI_CATALOGUE`.

## 4. Parked on staging (36 commits, not on prod)

Alvin parked these at 17:12 EAT on 28 Oct, to be promoted from the new account. They're on `staging/v2-c0-opening-2026-10-21` but not on `main` (`git log main..origin/staging/v2-c0-opening-2026-10-21`):

| # | SHA | When (EAT) | Commit |
| --- | --- | --- | --- |
| 1 | `4f7dfbe4` | 28 Oct 09:55 | Desk: Identity settings remake (slice 1) (#989) (#990) |
| 2 | `3293eeb3` | 28 Oct 10:25 | KB v2 (3/4): Desk Catalogue editor on kb_items, Swahili approve, what callers hear, ready card |
| 3 | `f461ac23` | 28 Oct 10:25 | KB v2 (4/4): Super Admin brain gate in the Business pane |
| 4 | `120f8d41` | 28 Oct 10:25 | KB v2 (2/4): lookup, the 12 call rules, brain tools, readiness selector, compat writer |
| 5 | `a79febb8` | 28 Oct 10:25 | KB v2 (1/4): schema, RLS, RPCs and the rules compiler |
| 6 | `3342a5e7` | 28 Oct 10:27 | Merge branch 'platform/kb-v2-2026-10-28-brain' into platform/kb-v2-2026-10-28-desk |
| 7 | `2938f917` | 28 Oct 10:27 | Merge branch 'platform/kb-v2-2026-10-28-desk' into platform/kb-v2-2026-10-28-admin |
| 8 | `f1c8f25a` | 28 Oct 10:27 | Merge branch 'platform/kb-v2-2026-10-28' into platform/kb-v2-2026-10-28-brain |
| 9 | `68a517fe` | 28 Oct 10:27 | docs: regenerate docs/reference/schema.md for kb_v2.sql (npm run docs:reference) |
| 10 | `00679a4a` | 28 Oct 10:27 | Merge branch 'platform/kb-v2-2026-10-28-brain' into platform/kb-v2-2026-10-28-desk |
| 11 | `540d46cf` | 28 Oct 10:27 | Merge branch 'platform/kb-v2-2026-10-28-desk' into platform/kb-v2-2026-10-28-admin |
| 12 | `1e89b307` | 28 Oct 10:27 | docs: regenerate docs/reference/env.md |
| 13 | `ca2ab180` | 28 Oct 10:27 | docs: regenerate docs/reference/env.md on the brain slice |
| 14 | `227583ab` | 28 Oct 10:29 | Merge #994: KB v2 (4/4): Super Admin brain gate in the Business pane |
| 15 | `c21a8dce` | 28 Oct 10:29 | Merge #993: KB v2 (3/4): Desk Catalogue editor, Swahili approve, what callers hear, ready card |
| 16 | `7a449ef9` | 28 Oct 10:29 | Merge #992: KB v2 (2/4): lookup, 12 call rules, brain tools, readiness selector, compat writer |
| 17 | `0fe1b362` | 28 Oct 10:29 | Merge #991: KB v2 (1/4): schema, RLS, RPCs, rules compiler |
| 18 | `39a96998` | 28 Oct 10:39 | Desk: polish D1–D3 (optimistic actions, Overview streaming, Sending texts) onto staging (cherry-pick of #986 d98c8b7b, #987 1d30ad47, #988 9af65811) (#995) |
| 19 | `f362fa70` | 28 Oct 10:51 | KB v2 follow-up: item states (site visit, paused, not offered, hold, not included), honest Quote backfill, paste a list |
| 20 | `bbb8a558` | 28 Oct 10:52 | Merge #996: KB v2 (5/5): item states, honest Quote backfill, paste a list |
| 21 | `c9102832` | 28 Oct 11:44 | Platform: KB v2 writers — retire services_offered writes, add-only catalogue imports, paste Replace, memberDenied on kb actions |
| 22 | `f3a2fac0` | 28 Oct 11:49 | Platform: lint fix; regenerate schema reference (kb_import_items) |
| 23 | `5aa6d9ce` | 28 Oct 11:51 | Merge #998: KB v2 writers — kb_items is the source (services_offered retired, add-only imports, paste Replace, guards) |
| 24 | `43913740` | 28 Oct 12:00 | Platform: KB mirror writes pricing.mode in the old vocabulary (fixed/from/range/ask) so catalogue_price_history accepts it |
| 25 | `4147648d` | 28 Oct 12:05 | Merge #999: KB mirror pricing.mode in the old vocabulary |
| 26 | `3a037cd9` | 28 Oct 12:19 | Desk: Catalogue remake on KB v2 (/settings/knowledge) + Replace my list + kb_items reads (staging) (#997) |
| 27 | `e543589e` | 28 Oct 13:20 | Brain: KB v2 reader - one catalogue door (kb/source.js) for every caller-facing read |
| 28 | `c014579c` | 28 Oct 13:47 | desk: Impeccable critique fixes (identity greeting, item states gate, renames, home, catalogue, copy) (#1001) |
| 29 | `7826b391` | 28 Oct 13:48 | Desk: Policies remake (self-saving cards, gated by business type) (#1002) |
| 30 | `f6557e8e` | 28 Oct 13:54 | Merge #1000: Brain KB v2 reader (one catalogue door for caller reads, BRAIN_KB_GATE) |
| 31 | `ca7b6155` | 28 Oct 14:23 | Platform: shared isKbLive contract (one 'on the KB' predicate for Voice and Desk) |
| 32 | `ba3ae066` | 28 Oct 14:26 | Merge #1005: shared isKbLive contract (one 'on the KB' predicate for Voice and Desk) |
| 33 | `3895f95b` | 28 Oct 14:44 | Desk: KB v2 provenance mirror (offered only, no stale notes) + item states flag gate on save (#1003) |
| 34 | `52108111` | 28 Oct 16:46 | Brain: KB v2 reader follow-ups (typed catalogue asks, clean group names, paused-item callback names the item) (#1004) |
| 35 | `3956afd7` | 28 Oct 16:53 | Brain B1: fail-closed degradation + safe mode (additive; retire-old-brain plan §2c/§2d) (#1007) |
| 36 | `1a20be8a` | 28 Oct 17:00 | Platform P1 (retire old brain), stacked on B1 #1007: KB brain for every business, brainMode.js, safe mode + catalogue-complete RPCs, empty-snapshot fallback, healthz counts (#1008) |

What these are:
- **KB v2:** one knowledge base for each business's catalogue, policies and facts (`kb_items`, snapshots, readiness, the rules compiler). PRs #991–#994 and #996–#1005.
- **The Desk Catalogue remake:** `/settings/knowledge`.
- **Desk polish:** Identity, Policies and critique fixes (#990, #995, #1001–#1003).
- **The first two steps of "retire the old brain":** Brain **B1** #1007 (fail-closed degradation + safe mode) and Platform **P1** #1008 (KB brain for every business, `brainMode`, `tenants.brain_mode`, catalogue-complete RPCs, healthz counts).

Still open as drafts:
- **#1010** B2 (delete the old turn) and **#1009** P2 (env and SQL clean-up). Both are stacked on `platform/kb-p1-on-b1-2026-10-28`.
- **#975** (Brain engines root fixes) stays open: its content went to staging through `824db1b7` and to prod through #985. **Don't close it without Brain's check.**

### 4a. Staging-only migrations (applied on staging, NOT on prod)

| Order | File (`docs/supabase/`) | Staging version | Down file |
| --- | --- | --- | --- |
| 1 | `kb_v2.sql` (2026-10-28.1) | `20261028072250` `kb_v2_2026_10_28_1` | `kb_v2_down.sql` |
| 2 | `kb_v2_item_states.sql` (.2) | `20261028074736` `kb_v2_item_states_2026_10_28_2` | `kb_v2_item_states_down.sql` |
| 3 | `kb_v2_paste_replace.sql` (.3) | `20261028083434` `kb_v2_paste_replace` | `kb_v2_paste_replace_down.sql` |
| 4 | `kb_v2_brain_mode.sql` (.4) | `20261028140049` `kb_v2_brain_mode_2026_10_28_4` | `kb_v2_brain_mode_down.sql` |
| — | `admin_invoice_actions.sql` | `20261025092056` | none in repo (draft #957). Held on purpose: it replaces the live `enqueue_invoice_*` functions and needs its own yes |
| — | `kb_v2_phase8_drop_legacy.sql` | not applied anywhere | phase 8, separate yes, never in the first batch |

These SQL files live on the staging branch only. They reach `main` with the promotion merge.

### 4b. Staging needs a merge from main first

Main has 14 commits staging doesn't: the #985 promotion merges, plus **`16735cf4`**, the prod SQL record. That commit carries STATUS, MIGRATION_LEDGER, the v1.2 / W1 write receipts / area picks + `ke` backfill / spoken catalogue SQL and down files, and two `supabase/migrations/` files. Desk #986–#989 are already on staging as the cherry-picks #990 and #995, so expect conflicts in those Desk files; keep the staging side.
**Step 0 of any promotion:** `git merge origin/main` into the staging branch, resolve, run the gates, and push. Pushing to staging needs Alvin's yes.

### 4c. Exact promotion order (each prod step needs Alvin's yes in that lane's chat)

The full runbooks are in [`plans/kb-v2-prod-batch-2026-10-28.md`](plans/kb-v2-prod-batch-2026-10-28.md) and [`plans/retire-old-brain-plan-2026-10-28.md`](plans/retire-old-brain-plan-2026-10-28.md).

0. **Back-merge main → staging** (§4b). Restage, then check that staging `/healthz` gitSha equals the tip.
1. **Soak on staging:** at least a day with `BRAIN_KB_GATE=on`, plus 2 graded real calls (Grow Tech, D&D) and 1 Swahili call. A fresh signup must end with a filled Catalogue. **Soniox staging must be funded first.**
2. **Alvin decides:** does a walk-in shop with no delivery (bookstore, stationery) need confirmed service areas to pass readiness? This decides whether ALFAAL and Esga pass without an owner tap.
3. **Prod SQL, in order:** .1 → .2 → .3 → .4. All are additive. After them, check: 5 `kb_*` tables, the tenant columns, the RPCs, and a clean security advisor.
4. **Backfill:**
   - `node scripts/kb-backfill.js` dry run, then `--apply`, with the prod service-role key from the vault (never printed).
   - Expected: Grow Tech 69 products, D&D 1, Esga 2, ALFAAL 1, Grok Test 1, and 3 businesses empty.
   - `scripts/kb-ensure-live.js` publishes empty snapshots for the rest.
5. **One promotion PR from staging into main, merged with a merge commit.** Never force-push.
   - Run the live-call check (zero active calls) right before merging; prod Voice redeploys on push.
   - Gates: `test:brain`, `test:voice`, `test:mvp`, `test:desk-bundle`, `docs:check`, `docs:reference:check`, then dashboard lint + build.
   - **#997 (Catalogue redirect) must never reach prod without #998 (kb_items as the source).** One merge carries both.
6. **Re-run the backfill once.** It's add-only and catches owner edits made in the window.
7. **Prod Voice env** (stage + accept-deploy, live-call check before each):
   - first `KB_COMPILE_ON_SAVE=on`, `KB_SW_SUGGEST=on`, `KB_SHADOW=on`
   - last, `BRAIN_KB_GATE=on` on Railway prod and the Vercel prod Desk, with a fresh Desk build
   - Brake: `BRAIN_SAFE_MODE=all`, or `BRAIN_KB_GATE=off`.
8. **Then retire the old brain:**
   - B2 #1010 + Voice V1 + Desk D1, then B3 (staging first, each soaked)
   - then P2 #1009 (env removal, drop `brain_target`), at least 24 h after B2/B3 are healthy
   - snapshot the env before removing anything

### 4d. Risks

- **Unconfirmed service areas.** No prod business passes KB readiness today, because owners haven't confirmed their areas. Until they do, the brain must say "the team will confirm", which B1 does.
- **Grow Tech's catalogue.** It lives only in `product_catalog`, and today's prod engines don't read it ("not sure" answers). Backfill fixes this.
- **The backfill and merge window.** Price edits made between the backfill and the deploy aren't carried over. Check `catalogue_price_history`.
- **Watch paths.** Desk-only merges skip the Voice redeploy, but anything touching Voice paths restarts prod Voice. Always do the live-call check first.
- **Rollback.** Revert the merge commit, then run the SQL downs in reverse (.4 → .1). The legacy catalogue columns are never dropped in this batch, and the mirror keeps them current.
- **Phone and voice balances.** SautiKit and Soniox balances are near zero, so test calls will fail until Alvin tops up.
- **The GitHub "Deploy staging Voice" workflow can't run.** It's missing the `RAILWAY_STAGING_*` repo secrets. Staging deploys happen through Railway's GitHub trigger.

## 5. Open items (not parked work)

1. **Money:** top up SautiKit prod (KES 9.29; rental 1 Nov), and fund Soniox or turn on autopay (staging is already at 402).
2. **Grade the 01:33 EAT Grow Tech call**, then have Alvin dial prod test calls on Esga and Grow Tech (§7).
3. **`DESK_PLAN_CHANGE=on` on Vercel prod:** Alvin hasn't confirmed this is intended. It lets owners change plans themselves.
4. **Spoken catalogue backfill on prod** needs the prod service-role key from the vault (`tenants.spoken_catalogue` is empty on prod; the flags stay off). It becomes moot once KB v2 ships.
5. **5 `billingReviewMoney` test failures** (Ops-Billing lane, known, not yet fixed).
6. **#894 caller profile v1:** parked by Alvin. Draft on staging, flag off.
7. **The staging Desk alias conflict:** Vercel branch-follow and `scripts/stage-desk-alias.js` both move the staging alias. One owner is needed (Platform).
8. **`admin_invoice_actions`:** on staging only, and needs its own yes (§4a).
9. **The legal pack #653:** waiting on Alvin and a lawyer.
10. **Supabase advisors (both projects):**
   - 0 errors. The staging backup table `_backup_tenants_unknown_answer_20261019` got RLS on 28 Oct.
   - Warnings: 53 functions with a mutable `search_path`; **21 SECURITY DEFINER functions executable by `anon`**; 42 (prod) / 44 (staging) executable by `authenticated`; `citext` in `public`; leaked-password protection off (a dashboard setting).
   - The proposed fix for the 21 anon-executable functions is below. **NOT APPLIED.** Platform lane: staging first, then prod, each with Alvin's yes.
   - The riskiest are `upsert_tenant_field_meta`, `backfill_tenant_field_meta_seed`, `confirm_tenant_field` and `_tenant_append_field_history`.
   - **Check before applying:** `current_user_tenant_ids`, `member_can_*` and `current_member_role` are used inside RLS policies. If any page queries those tables while signed out, revoking anon turns an empty result into a permission error.
   - Drafts #864 and #865 (open grants, default privileges) cover related ground.

```sql
-- PROPOSED, NOT APPLIED (28 Oct 2026). Platform lane. Staging first, then prod, each with Alvin's yes.
-- Pre-check: is any of these called while signed out (sign-up trigger, public pages, RLS policies evaluated as anon)? If so, drop it from the list.
begin;
revoke execute on function public._tenant_append_field_history(uuid, text, text, text, jsonb, jsonb) from public, anon;
revoke execute on function public._tenant_assert_member(uuid) from public, anon;
revoke execute on function public._tenant_catalog_product_score(uuid, jsonb, boolean) from public, anon;
revoke execute on function public._tenant_catalog_service_score(uuid, jsonb, boolean) from public, anon;
revoke execute on function public._tenant_field_meta_admin_guard() from public, anon;
revoke execute on function public._tenant_field_meta_source(uuid, text) from public, anon;
revoke execute on function public._tenant_field_score(uuid, text, boolean) from public, anon;
revoke execute on function public._tenant_holds_allowed(uuid, jsonb) from public, anon;
revoke execute on function public._tenant_owner_holdable_product(uuid, jsonb) from public, anon;
revoke execute on function public.backfill_tenant_field_meta_seed() from public, anon;
revoke execute on function public.confirm_tenant_field(uuid, text, uuid) from public, anon;
revoke execute on function public.current_member_role(uuid) from public, anon;
revoke execute on function public.current_user_tenant_ids() from public, anon;
revoke execute on function public.handle_new_user_tenant() from public, anon;
revoke execute on function public.member_can_admin(uuid) from public, anon;
revoke execute on function public.member_can_write(uuid) from public, anon;
revoke execute on function public.platform_soniox_voices_enforce_single_default() from public, anon;
revoke execute on function public.tenant_completeness_score(uuid) from public, anon;
revoke execute on function public.tenant_hold_gate(uuid) from public, anon;
revoke execute on function public.tenant_subscriptions_clear_spend_hold() from public, anon;
revoke execute on function public.upsert_tenant_field_meta(uuid, text, text, text, numeric, integer, text, jsonb, jsonb) from public, anon;
grant execute on function public._tenant_append_field_history(uuid, text, text, text, jsonb, jsonb) to authenticated, service_role;
grant execute on function public._tenant_assert_member(uuid) to authenticated, service_role;
grant execute on function public._tenant_catalog_product_score(uuid, jsonb, boolean) to authenticated, service_role;
grant execute on function public._tenant_catalog_service_score(uuid, jsonb, boolean) to authenticated, service_role;
grant execute on function public._tenant_field_meta_admin_guard() to authenticated, service_role;
grant execute on function public._tenant_field_meta_source(uuid, text) to authenticated, service_role;
grant execute on function public._tenant_field_score(uuid, text, boolean) to authenticated, service_role;
grant execute on function public._tenant_holds_allowed(uuid, jsonb) to authenticated, service_role;
grant execute on function public._tenant_owner_holdable_product(uuid, jsonb) to authenticated, service_role;
grant execute on function public.backfill_tenant_field_meta_seed() to authenticated, service_role;
grant execute on function public.confirm_tenant_field(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.current_member_role(uuid) to authenticated, service_role;
grant execute on function public.current_user_tenant_ids() to authenticated, service_role;
grant execute on function public.handle_new_user_tenant() to authenticated, service_role;
grant execute on function public.member_can_admin(uuid) to authenticated, service_role;
grant execute on function public.member_can_write(uuid) to authenticated, service_role;
grant execute on function public.platform_soniox_voices_enforce_single_default() to authenticated, service_role;
grant execute on function public.tenant_completeness_score(uuid) to authenticated, service_role;
grant execute on function public.tenant_hold_gate(uuid) to authenticated, service_role;
grant execute on function public.tenant_subscriptions_clear_spend_hold() to authenticated, service_role;
grant execute on function public.upsert_tenant_field_meta(uuid, text, text, text, numeric, integer, text, jsonb, jsonb) to authenticated, service_role;
commit;

-- Down (restores today's grants):
-- begin;
-- grant execute on function public._tenant_append_field_history(uuid, text, text, text, jsonb, jsonb) to public, anon;
-- grant execute on function public._tenant_assert_member(uuid) to public, anon;
-- grant execute on function public._tenant_catalog_product_score(uuid, jsonb, boolean) to public, anon;
-- grant execute on function public._tenant_catalog_service_score(uuid, jsonb, boolean) to public, anon;
-- grant execute on function public._tenant_field_meta_admin_guard() to public, anon;
-- grant execute on function public._tenant_field_meta_source(uuid, text) to public, anon;
-- grant execute on function public._tenant_field_score(uuid, text, boolean) to public, anon;
-- grant execute on function public._tenant_holds_allowed(uuid, jsonb) to public, anon;
-- grant execute on function public._tenant_owner_holdable_product(uuid, jsonb) to public, anon;
-- grant execute on function public.backfill_tenant_field_meta_seed() to public, anon;
-- grant execute on function public.confirm_tenant_field(uuid, text, uuid) to public, anon;
-- grant execute on function public.current_member_role(uuid) to public, anon;
-- grant execute on function public.current_user_tenant_ids() to public, anon;
-- grant execute on function public.handle_new_user_tenant() to public, anon;
-- grant execute on function public.member_can_admin(uuid) to public, anon;
-- grant execute on function public.member_can_write(uuid) to public, anon;
-- grant execute on function public.platform_soniox_voices_enforce_single_default() to public, anon;
-- grant execute on function public.tenant_completeness_score(uuid) to public, anon;
-- grant execute on function public.tenant_hold_gate(uuid) to public, anon;
-- grant execute on function public.tenant_subscriptions_clear_spend_hold() to public, anon;
-- grant execute on function public.upsert_tenant_field_meta(uuid, text, text, text, numeric, integer, text, jsonb, jsonb) to public, anon;
-- commit;
```

## 6. Lanes and who owns what

Lane contracts: `docs/reference/lanes/{VOICE,BRAIN,DESK_UX,OPS_BILLING,PLATFORM}.md`, and `AGENTS.md`. **One task, one lane, one PR.**

| Lane | Owns | Parked work it picks up |
| --- | --- | --- |
| Chief | Coordinates the lanes, carries Alvin's yes to the lane that asked, runs Admin and the client Desk front end, keeps STATUS true | This handover, the promotion checklist |
| Platform | Supabase schema/RLS/RPCs, `src/db.js` contracts, auth, Railway/Vercel deploy glue, docs/STATUS | §4b back-merge, §4c SQL + backfill + promotion PR, P1/P2, advisor fixes, the alias conflict |
| Brain | Prompts, turn logic, engines, KB reader, evals | B1 soak, B2 #1010, B3, #975 check, #894 (parked) |
| Voice | Telephony, Soniox, `/ws/media`, latency, fillers | V1 (old-brain speech removal) after B2 |
| Desk | Owner Desk + Admin UI (Apple/iOS design system, light by default) | D1 Admin brain pill + Safe mode control, prod smoke |
| Ops-Billing | Packages, DIDs, wallet metering, Admin billing | the `billingReviewMoney` failures, `admin_invoice_actions` |

## 7. How to verify prod

1. `curl https://scalers-project-production.up.railway.app/healthz` must show:
   - `ok:true`
   - `gitSha` equal to the merge you expect (today `c620b379…`)
   - `soniox.lastError.billingExhausted:false`, and `telephony.lastError.balanceMinor` > 0
   Staging: `https://scalers-staging-staging.up.railway.app/healthz`.
2. Vercel project `scalers-project`: the newest Production deployment is READY at `main`'s SHA.
3. Supabase prod: `list_migrations` ends at `20261027144019` (until the KB batch); the security advisor has 0 ERROR.
4. **Test calls (Alvin dials; agents never dial):**
   - **Esga +254709221542, in English:** ask about a product, hours, a place, then leave a request. Expect the read-back, a saved request and the owner alert.
   - **Grow Tech +254709221536:** ask about a product, an unconfirmed area, then the same in Swahili.
   - After each call, check the `calls` and `service_requests` rows, the transcript, `voice_turn_traces`, the owner SMS/WhatsApp, and the wallet meter.
5. **Admin → Numbers on prod:**
   - lift, move and restore all ask for Unlock
   - a noop shows "Already done"
   - +254709221536 shows as releasable
   - **Don't release a live line.**
6. **Desk smoke on prod:**
   - sign-in, and the Overview loads in parts (D2)
   - Archive, Done, Pin and Favourite with undo (D1)
   - a sent text goes Sending → Sent (D3)
   - the Identity page saves (#989)
   - Locations "We come to you", the areas picker, and viewer read-only

## 8. Rules (carry these over exactly)

1. **Alvin's explicit yes** for: every prod write (SQL, env, Railway/Vercel/SautiKit settings), any merge to `main`, any push to `staging/*` or Railway redeploy, releasing a DID, and rotating secrets. Each lane needs the yes **in its own chat**: a relayed okay or another bot's okay doesn't count. Record the approver and time in the commit, PR or STATUS.
2. **Git identity:** never set git config. Commit with `git -c user.name='Alvin Yegon' -c user.email='alvin@scalers.co.ke'`.
3. **No force-push.** The only historical exception was `cursor/staging-voice-468b`, and Platform was promised no more pushes there.
4. **Never print secrets.** Docs list names only. Secrets go in through masked cards that Alvin fills in.
5. **Agents never dial.** Alvin dials; agents score from recordings, transcripts, traces and logs.
6. **Root cause first**, researched against Vapi, Retell, LiveKit and Pipecat, and done scalable and end to end. Test end to end and report honestly. Keep costs low; build on the box.
7. **Docs are the source of truth:** update `docs/STATUS.md` in the same PR as any merge to `main`, parked plans included.
8. **Owner copy:** no vendor names on product screens, no AI slop. Desk uses the Apple/iOS design system, light by default.
9. **Billing:** packages + on-demand only. No prepaid wallet product.
10. **Live-call check before any prod deploy:** no `/voice/incoming` or `/ws/media` in the last 10 minutes, and no active `calls` rows.

## 9. How to resume on the new account (checklist)

1. **Access** (Alvin grants it): the GitHub repo plus a token for `gh`, and the Railway, Vercel and Supabase MCPs or CLIs for both projects. SautiKit and Soniox dashboards stay with Alvin. Install Node 22, `gh`, and the Railway and Vercel CLIs.
2. Clone the repo and read: `AGENTS.md` → `docs/STATUS.md` → this file → your lane contract → `docs/plans/*-2026-10-28.md`.
3. Set up the seats (Chief, Platform, Brain, Voice, Desk, Ops-Billing) from §6. The old account's skills and memory don't carry over; the lane contracts in the repo replace them.
4. Run §7 checks 1–3 and compare with §3. Anything different means something changed after this handover.
5. Ask Alvin for the top-ups, then do §5 items 1–2.
6. When Alvin says go, start §4c step 0.

## 10. Browser demo tenants (31 Oct 2026, not run)

Desk draft. Not merged, not seeded, no env change, no SQL. Do not touch `+254709221536`.

Three made-up tenants (`demo_home`, `demo_shop`, `demo_other`) resolve to Home services, Shop and Other business. The shop price is the catalogue row. Bookings, notifications and billing stay off for those ids. There is no `tenants.is_demo` column.

Run and remove (Alvin or Chief, staging only): [`docs/how-to/demo-tenants.md`](how-to/demo-tenants.md). An agent does not execute the seed.

## 11. Housekeeping done on 28 Oct (old account)

- **Stale PRs closed:** superseded flag-off drafts from 13–25 Oct and the Brain v2 C-series stack. Each was closed with a comment pointing here. Their branches were kept, so any of them can be reopened.
- **Branches deleted (691):** only those whose PR was **merged** before 28 Oct 00:00 EAT and whose tip equals the merged head. 75 branches with commits added after their merge, and 29 merged on 27–28 Oct, were kept. The list, with SHAs, is in [`plans/branch-deleted-2026-10-28.txt`](plans/branch-deleted-2026-10-28.txt). To restore one: `git push origin <sha>:refs/heads/<name>`.
- **Kept:** `main`, `staging/*`, `backup/*`, `cursor/staging-voice-468b`, every open PR's head and base, and every branch with commits added after its merge.
