---
owner: platform
last_reviewed: 2026-10-18
---

# Scalers status and handoff (start here)

**Last updated Sun 18 Oct 2026, 15:20 EAT (closing docs for 18 Oct).** Checked against `main` (`408ad368`), `gh pr list`, main's first-parent log, Railway prod deployments, the merged PR bodies and the pending STATUS PRs (#750, #753, #756, #764, folded in here). Items marked *per team notes* come from lane agents and Alvin, not from the repo. Lines marked **`TBD:`** are placeholders for ships still in flight; fill them in when they land. **Update this file in the same PR as any merge to `main`** (see [`CONTRIBUTING.md`](../CONTRIBUTING.md#status-rule)).

New agent or new human: read this whole page before you touch code.

**Read order:** [`AGENTS.md`](../AGENTS.md) → your lane contract in [`docs/reference/lanes/`](reference/lanes/) ([`VOICE.md`](reference/lanes/VOICE.md), [`BRAIN.md`](reference/lanes/BRAIN.md), [`DESK_UX.md`](reference/lanes/DESK_UX.md), [`OPS_BILLING.md`](reference/lanes/OPS_BILLING.md), [`PLATFORM.md`](reference/lanes/PLATFORM.md)) → [`SYSTEM_ARCHITECTURE.md`](explanation/architecture/SYSTEM_ARCHITECTURE.md), [`CURRENT_STATE.md`](explanation/architecture/CURRENT_STATE.md), [`SOURCE_OF_TRUTH.md`](explanation/governance/SOURCE_OF_TRUTH.md) → this file. Glossary: [`CONTEXT.md`](../CONTEXT.md). **One task, one lane, one PR.**

---

## 1. Where we are

Prod Voice (Railway) and prod Desk (Vercel `scalers-project`) run **`main` @ `408ad368`** (#762, merged 18 Oct 15:13 EAT; Railway `4e311b26` SUCCESS, Vercel `dpl_8q6Xfe2j` READY). Brain's #733, #751 and #761 ship next, one at a time (section 4); when they land, update this line to **`TBD:#761-sha`** (or the last of the three). Staging Voice is pinned to **`9fb557ff`** (branch `staging/pin-759-760-763-main-1e18`: #759, #760 and #763 on top of `main` @ `1e18b2fa`; Railway staging `321b1fb6`, 18 Oct 14:21 EAT).

**Prod flags flipped 18 Oct:** `BRAIN_CALL_FIXES_D199=on` (13:31 EAT) and `VOICE_ENDED_CALL_GUARD=on` (15:01 EAT). Details in section 2, "Flag flips".

Prod DID **+254709221536** is Aris, the live paying customer: **never release, reassign, or re-point it.** Esga is on prod DID +254709221542. Staging DID is **+254709221537** (staging tenant Jirani Cleaning Services, *per team notes*).

**Product is callbacks only (#658, 11 Oct).** There is no live call transfer: the assistant takes a message and alerts a teammate. [`LIVE_TRANSFER.md`](archive/LIVE_TRANSFER.md) is archived as history.

Billing is **packages + on-demand only**; beta charging is off; no prepaid wallet; no waive overage.

**Gate right now:** Brain scores the next Aris call against D199 + #732 (and #733/#751 once shipped). #643 and #731 stay frozen until that review. The speech-check redesign is being built on staging only (section 4a).

**Deploy rule (read before any merge):** prod Railway auto-deploys `main` with **no watch paths**, so **every merge, docs-only included, restarts prod Voice** and drops live calls. Merge only with **0 `in_progress` calls**, **one at a time through the deploy-slot holder**, then `/healthz` (SHA + `ok`) and an Aris check before the next merge. See section 8.

| | Production | Staging |
| --- | --- | --- |
| Voice (Railway) | `scalers-project-production.up.railway.app`, deploys `main` on every merge (no watch paths). `408ad368` | `scalers-staging-staging.up.railway.app`, pinned `9fb557ff` |
| Desk (Vercel) | `scalers-project`, builds `main`. `408ad368` (`dpl_8q6Xfe2j`) | `scalers-staging` (one debounced API deploy, #665) |
| DID | **+254709221536** Aris, +254709221542 Esga | **+254709221537** Jirani |
| SautiKit workspace | `e0e57aa5` | `1f85601c` |
| Supabase | `fjxcdccgyhnvnnlnovcl` | `sgcdncjxauhsbunobmob` |

Design: all UI follows Frontend 2.0 ([`FRONTEND_2_0_CHARTER.md`](explanation/frontend/FRONTEND_2_0_CHARTER.md) wins, then [`design-system/MASTER.md`](reference/design-system/MASTER.md)). Staging mechanics: [`ENVIRONMENTS.md`](reference/operations/ENVIRONMENTS.md).

---

## 2. Shipped to prod

Times EAT (git and Railway report UTC; +3 h). SHAs are the squash commits on `main`. Railway ids are prod Voice deploys (service `9b09d8c6`, env `8dd0b8ef`); `dpl_` ids are prod Desk on Vercel. "Not recorded" means neither the PR nor an earlier STATUS line names it. Older history: `git log --first-parent origin/main` and the previous STATUS in git (`30086771`, #686).

### 2.1 Prod ships, 18 Oct (newest first)

| PR | SHA | Merged | What | Deploys | Rollback | Approver |
| --- | --- | --- | --- | --- | --- | --- |
| #761 | **`TBD:#761-sha`** | **`TBD:#761-time`** | Brain: trusted hours, honest hours summary, name gate. Merged with `BRAIN_TRUSTED_HOURS` **off** (inert). Prerequisite for the fact sheet (section 4a). | Railway **`TBD:#761-railway`**, Vercel **`TBD:#761-vercel`** | Revert (flag stays off) | Alvin 15:12 EAT, Chief's chat |
| #751 | **`TBD:#751-sha`** | **`TBD:#751-time`** | Brain: owner text honest (stacked on #732). Runs under `BRAIN_CALL_FIXES_D199` (on), so it changes live behaviour. | Railway **`TBD:#751-railway`**, Vercel **`TBD:#751-vercel`** | Revert, or D199 off | Alvin 15:12 EAT, Chief's chat |
| #733 | **`TBD:#733-sha`** | **`TBD:#733-time`** | Brain: D199 visit read (last one only) + paged open read. Under D199 (on), live behaviour change. | Railway **`TBD:#733-railway`**, Vercel **`TBD:#733-vercel`** | Revert, or D199 off | Alvin 15:12 EAT, Chief's chat |
| #762 | `408ad368` | 15:13 | Desk call setup per account (follow-up to #755): picks saved on the account (one-time copy from browser storage, which stays the fallback); "Forwarding works" only when a call from the owner's named test phone arrives within 30 min of starting the test; fix checklist; Settings › Calls & forwarding; Overview nudge after 7 quiet days. Prod SQL applied first at 14:59 (2.3). | Railway `4e311b26` SUCCESS, Vercel `dpl_8q6Xfe2j` READY | Promote `dpl_DBSyRwgU` (#758) or revert; SQL rollback in 2.3 | Alvin 14:55 EAT, Desk's chat |
| #758 | `52498db9` | 15:08 | Desk Settings quick fixes from the owner review: "Add/Check prices" open the Catalogue; Policies copy and starter text; Back asks before dropping edits; forgiving catalogue import; small labels and toasts. No SQL, no prompt or call-facing change. | Railway `7dfbf4e9` SUCCESS, Vercel `dpl_DBSyRwgU4eg9bRQwPnvQB2t9XuRT` READY (app, admin, www) | Promote `dpl_738F4MizcCCtAM87wfGPhqoAiiJx` (`adab1e81`) or revert | Alvin 14:55 EAT, Desk's chat (fixes approved 13:21) |
| #765 | `adab1e81` | 15:04 | Docs: STATUS lines for #760, #763, `VOICE_ENDED_CALL_GUARD=on`, Brain #732. | Railway `45f5df30`, Vercel `dpl_738F4Miz` | Revert | Alvin's standing docs rule (18 Oct 09:40, Chief's chat); slot released by Chief |
| #763 | `2842c4f4` | 14:59 | Voice: speech guard reads glued clocks and shillings ("KSh500", "from9:30 AM") like the spaced form, for checking only; streamed model stages record where text loses spaces (VOICE.md invariant 19). No flag. | Railway `c4a235da` SUCCESS | Revert | Alvin 14:33 EAT via Chief |
| #760 | `2cb6e075` | 14:57 | Voice: an ended call gets no new media session; every call finalized once (`VOICE_ENDED_CALL_GUARD`, VOICE.md invariant 18; HD_49d726c3dc9b). Merged flag-off; flag on at 15:01 (2.2). | Railway `508601d2` SUCCESS | Flag off, or revert | Alvin 14:33 EAT via Chief |
| #732 | `13ddf19d` | 14:48 | Brain: past-booking question (sw/Sheng/en) goes to the visit read; honest outcome labels (enquiry needing a callback = `needs_human`; saved hold or closed info call = resolved; greetings only = abandoned; `primary_intent` `human` only when the caller asked for a person). Live under D199. **Not behind D199:** with `VOICE_QUESTION_BEFORE_NAME` on (default), the past-request phrase counts as a file ask and skips question-before-name. 0 calls in progress at merge. | Railway `d458494a` SUCCESS, Vercel `dpl_7WNEx3UpCP1m5qGHMDQWYkbDXvss` READY | Revert, or D199 off (does not undo the question-before-name skip) | Alvin 14:20 EAT |
| #757 | `0c920541` | 14:23 | Docs: STATUS line for `BRAIN_CALL_FIXES_D199=on`; #752 SHA. | Railway `1c97356f` | Revert | Alvin's standing docs rule (18 Oct 09:40, Chief's chat); slot released by Chief |
| #748 | `0f280504` | 14:18 | Ops-Billing: rollover catch-up rebuilds counters instead of zeroing; on-demand usage audit; Activity before/after on assign/unassign; package SMS 80%/100% ops email (`src/billing/smsUsageAlerts.js`). Shipped after the D199 flip so Brain can separate effects. SQL in 2.3. | Railway `5b6ac74a`; Vercel not recorded | Revert code (SMS notices stop); SQL rollback in 2.3 | Alvin 14:11 EAT; slot from Voice 14:16 |
| #752 | `1e18b2fa` | 13:28 | Email design system (`packages/email/`): layout, owner/ops templates, plain text, render API, previews, branded Supabase Auth templates. Templates only, no send path. Line-live email offers the Scalers number or `**004*N**20#` (tested Safaricom + Airtel by Alvin; Telkom untested). | Railway `587661ec` SUCCESS | Revert | Alvin 13:11 EAT; slot from Voice 13:22 |
| #755 | `c4719c70` | 13:22 | Desk "Set up your calls" on `/onboarding/line`: Scalers number or pre-filled forwarding codes (`**004*N**S#` first; `**61*`/`**67*`/`**62*` under a disclosure; `##002#` off), ring time, airtime note, Android-only tap-to-dial, test step, Overview card. Browser storage per tenant (moved to the account by #762). | Railway `0182bcff` SUCCESS, Vercel `dpl_4m1RFPGGbeE7BN2Z7CXkXSq9frp9` READY 13:23 | Revert | Alvin 13:11 EAT; slot from Voice 13:22 |
| #746 | `ae8508ea` | 12:59 | Docs: STATUS ops lines (events_url fixes, signature checks off, no prod recordings). | Railway `fcd141ba`, Vercel `dpl_A9joeVvUN5Lf2vF7gFdSJsLJAowE` | Revert | Alvin's standing docs rule (18 Oct 09:40, Chief's chat); slot released by Chief |
| #749 | `5520659c` | 12:53 | Desk owner-trust fixes from the 18 Oct review: no prefetch storm, parallel call detail, timeouts; one count selector (Home, Inbox, badge); Usage reads `tenant_billing_state`; setup checklist Confirmed/To check/Missing; copy; transcripts sort by `seq` when present. No SQL, no env. | Railway `f672d18c` SUCCESS, Vercel `dpl_Gs9xgvGR3eqPcRso7ZPKfENRJSVG` READY | Promote `dpl_7i6p9UVTdzQdmYp6JHrjKMz64hBt` / Railway redeploy `c902ba3a`, or revert | Alvin 12:04 EAT, Desk's chat; slot from Ops-Billing 12:50 |
| #754 | `a5beb387` | 12:47 | Desk password reset: "Forgot password?", `/forgot-password` (same answer for every address, rate limited), `/reset-password` behind a 15-min recovery marker, invite-page link. Redirect allow lists already covered it. | Railway `c902ba3a`, Vercel `dpl_7i6p9UVTdzQdmYp6JHrjKMz64hBt` READY | Revert | Alvin 12:05 EAT (deploy GO 12:43, Voice slot 12:43) |
| #737 | `fbef28a8` | 12:10 | Super Admin lifecycle: Suspend / Restore line (`line_status='suspended'`, Voice gate #651), Archive / Unarchive (closes line, hides, stops charging, blocks owner sign-in), permanent delete removed; purge is a dry-run-by-default RPC, **schedule not applied**. Every action needs a typed reason and writes `ops_audit_log`. No tenant was suspended or archived. Prod SQL at 12:06 (2.3). | Railway `d18956e1` SUCCESS, Vercel `dpl_AdHZ1KhTKQM5T9pJirVxiNiQsiwV` READY | Promote `dpl_Hms48Q2MoZ9NKDecHQ56mD5rXtz6` / Railway redeploy `15c23e72` (both `4c3d8932`), or revert; SQL rollback in 2.3 | Alvin 12:04 EAT, Desk's chat; slot from Voice with Chief's GO 12:05 |
| #744 | `4c3d8932` | 09:43 | Docs: STATUS refresh 18 Oct. | Railway `15c23e72` | Revert | Alvin 18 Oct 09:40, Chief's chat ("close them and ship #744"; the same message closed #639, #642, #644, #646) |

### 2.2 Flag flips, 18 Oct

| When | Flag | Where | Deploy | Rollback | Approver |
| --- | --- | --- | --- | --- | --- |
| 15:01 | `VOICE_ENDED_CALL_GUARD=on` (only the exact value `on` enables; #760, VOICE.md invariant 18) | Railway prod Voice, only this variable | Redeploy `7b7e28c5` SUCCESS, same commit `2842c4f4`, started 15:01:14; `/healthz` ok; boot logs clean; 0 calls before/after; Aris `line_status` active, +254709221536 mapping unchanged | Unset (or `off`) and redeploy | Alvin 14:33 EAT via Chief |
| 13:31 | `BRAIN_CALL_FIXES_D199=on` (code enables only on exact `on`, `src/conversation/callFixesD199.js`) | Railway prod Voice, only this variable | Redeploy `67413ba8` SUCCESS, same commit `1e18b2fa`, started 13:31:47; `/healthz` ok; 0 calls before/after; Aris active | Set `off` (or unset) and redeploy | Alvin 9 Oct 21:43; unfrozen by Chief 18 Oct 13:21 after the clean media path on HD_49d726c3dc9b |
| 13:22 | `BRAIN_CALL_FIXES_D199=on` | Vercel prod Desk (`scalers-project`, Production only; env created 13:22:48) | Picked up by the #755 build `dpl_4m1RFPGGbeE7BN2Z7CXkXSq9frp9` (READY 13:23:31). A later Desk deploy `dpl_7DFn1nMi` also carries it (*per team notes*). Effect: Desk's starter-text filter matches Brain's (`isSeedPolicyText`). | Delete the env var and redeploy, or promote `dpl_A9joeVvUN5Lf2vF7gFdSJsLJAowE` (`ae8508ea`, also drops #755) | Chief via Brain, ~13:22 |

Brain scores the next Aris call against D199; #643 and #731 stay frozen until that review.

### 2.3 Ops changes (not code), 18 Oct (newest first)

- **14:59 — #762 prod SQL** (Supabase `fjxcdccgyhnvnnlnovcl`, `apply_migration` `tenant_call_setup`, file `supabase/migrations/20261018130000_tenant_call_setup.sql`, md5 `5d2069ab…`, from branch head `97ceb174`). Adds nullable `tenants.call_setup` jsonb, CHECK `tenants_call_setup_valid` (via `call_setup_valid()`), and RPC `save_call_setup(uuid, jsonb)` (security definer, `member_can_admin`, v2 `test_from` rule, 30-minute test-call check; signed-in users and service role, not anon; no direct column update). Function bodies identical to staging. 0 rows changed. Snapshot and rollback: `/workspace/reports/call-setup/v2/prod/` (`rollback-762-prod.sql`). Approver: Alvin 14:55; Voice cleared the additive SQL during its window.
- **~14:15 — #748 SQL on prod** (staging ~14:13): `package_state_rules.sql`, `package_period_rollover.sql`, `on_demand_usage_audit.sql`. Prod function bodies match staging; cron jobs unchanged (`scalers-package-period-rollover` `5 * * * *`, `notify-stale-release`, `sms-counter-drift-daily`). First prod rollover with the fix: **1 Nov 00:05 EAT**. Staging Done and Dusted reconcile 14:14 (0 → 17,792 s, 0 → 150 SMS; audit `usage_counter_reconcile`). Rollback: `/workspace/scalers/ops/2026-10-18_748_prod_rollback.sql` and `..._staging_rollback.sql` (pre-apply snapshots `2026-10-18_748_{prod,staging}_pre.sql`). Approver: Alvin 14:11.
- **13:02 — Prod Auth recovery template uses token-hash links** (`{{ .SiteURL }}/auth/callback?next=/reset-password&token_hash={{ .TokenHash }}&type=recovery` instead of the PKCE `{{ .ConfirmationURL }}`, which only worked in the requesting browser). Only `mailer_templates_recovery_content` changed (read back); mirrored in #752 (`7dce6190`). One test reset sent to the Aris owner account. Rollback: PATCH back `/workspace/scalers/ops/2026-10-18_recovery_template_pre_tokenhash.json`. Approver: Alvin 13:00. (From #756.)
- **12:46 — 3 stale prod `calls` rows closed** (Supabase `fjxcdccgyhnvnnlnovcl`, data fix, no SHA). `status` `in_progress` → `failed` (the terminal status Voice uses for a failed call) on `ENVTEST_CALL_001` (Aris, 7 Aug), `sautikit_call_1786211288059` (Aris, 8 Aug) and `HD_c381db747fda` (Esga, 5 Oct), by exact id, guarded by `status = 'in_progress'`. Nothing else changed (no `ended_at` column; duration and package seconds stay 0; no triggers, billing, metering or alerts fired). In-progress rows older than 1 h after: 0. Audit: `ops_audit_log` `close_stale_calls` `6cd88235-8e5e-4750-afba-23390328bdb2`. Backup and rollback (not applied): `/workspace/scalers/ops/stale-calls-backup-20261018.json`, `/workspace/scalers/ops/stale-calls-rollback-20261018.sql`. Approver: Alvin 12:45, Chief's chat.
- **12:06 — #737 prod SQL** in order: `admin_business_suspend.sql`, `archive_tenant_billing.sql`, `purge_archived_tenants.sql` (unchanged since `1768482f`, same as staging 17 Oct). All 7 function definitions match staging md5; new RPCs service-role only; `tenants.suspended_at/_by` added; `refresh_line_status`/`suspend_line_for_nonpayment` absent on prod, so skipped. **Not applied:** `purge_archived_tenants_schedule.sql` (purge stays off) and `line_rental_grace.sql`. Dry run `purge_archived_tenants(p_days => 30, p_dry_run => true)` → 0 rows (Chapter One eligible 9 Nov 12:50 EAT). Snapshot and rollback: `/workspace/reports/admin-lifecycle/prod/` (`rollback-737-prod.sql`). Approver: Alvin 12:04. (From #750.)
- **12:03 — Branded Supabase Auth templates (#752 @ `9b356cc7`) on prod** through the Management API: 6 templates + 6 subjects, read back 12/12; OTP expiry 3600; SMTP untouched. **Staging not applied** (free tier with the built-in mailer refuses template edits; needs custom SMTP first). Rollback: PATCH back `/workspace/scalers/ops/2026-10-18_auth_templates_rollback_fjxcdccgyhnvnnlnovcl.json`. Approver: Alvin 10:59.
- **11:00 — Prod Desk ops mail env** (Vercel Production): `RESEND_API_KEY` (sensitive), `OPS_EMAIL_FROM`, `SCALERS_OPS_ALERT_EMAILS`. Desk `opsMail.ts` had been skipping every platform ops email (`ops_mail_unconfigured`). Redeploy `dpl_Hms48Q2MoZ9NKDecHQ56mD5rXtz6` (same commit `4c3d8932`, env only). Test send HTTP 200. Rollback: remove the three vars and redeploy the prior production deployment. Approver: Alvin 10:46 (Ops-Billing chat). (From #753.)
- **10:17 — Esga Stationery prod data** (no SHA): (a) on-demand usage **off** via `set_tenant_on_demand_usage(c81b3480…, false)`, audit `set_on_demand_usage` `fe9629cf`; rollback `select * from set_tenant_on_demand_usage('c81b3480-0cc5-4224-b0e7-24c641d78db2', true)`. (b) Cleared the unconfirmed seeded `business_policies.delivery` ("Same-day Nairobi delivery…"); Nakuru coverage untouched; `llm_system_prompt` unchanged; audit `clear_seed_policy` `1ab1fd8a` keeps the old text. Approver: Alvin 10:15. (From #750.)
- **09:10 — SMS counter reconcile on prod:** Esga 440 → 193, Aris 207 → 147, SBS 8 → 4 (counter set to sent units from the ledger). Pre-snapshot and rollback (not applied): `/workspace/scalers/ops/2026-10-18_sms_counter_reconcile_pre.txt`, `/workspace/scalers/ops/2026-10-18_sms_counter_reconcile_rollback.sql`. Approver: Alvin 18 Oct 09:09, Ops-Billing's chat.
- **~08:41 — Esga `events_url` fixed** (+254709221542, prod workspace, PUT, read back with GET). Was prod `/` (events hit the inbound-call handler); now `https://scalers-project-production.up.railway.app/voice/events`. Voice webhook URL and number mapping unchanged. Rollback: PUT the old `/` value (not recommended). Approver: Alvin 18 Oct 08:40, Chief's chat.
- **08:40 — Aris `events_url` fixed** (+254709221536, prod workspace, PUT, read back). Was the typo host `https://scalers-production-production.up.railway.app/voice/events` (dead; every Aris event including recording-ready got no answer); now `https://scalers-project-production.up.railway.app/voice/events`. Mapping unchanged. Rollback: PUT the old value (not recommended, dead host). Approver: Alvin 18 Oct 08:40, Chief's chat.
- **Pending — staging Jirani `events_url`** (+254709221537, staging workspace `1f85601c`; agents have no staging SautiKit key). Alvin sets it in the SautiKit dashboard to `https://scalers-staging-staging.up.railway.app/voice/events`. Rollback: restore the previous value. Approver: Alvin.

### 2.4 Admin lifecycle (#737), end to end

- **17 Oct ~21:55:** SQL applied on **staging only** (files from `cd8db691`); staging test on Test Archive Co (`51a6c7c6`): suspend, refused second suspend, restore, archive, dry-run purge. Approver and rollback for the staging apply: not recorded (*per team notes*).
- **18 Oct 12:06:** prod SQL (2.3). **12:10:** code merged `fbef28a8` (2.1).
- **Not live:** the purge schedule (`purge_archived_tenants_schedule.sql`) is applied nowhere. A real purge needs `p_days >= 30` and skips any business that still has recordings in `call-recordings` (Storage blocks deletes from SQL), so it waits for a recordings deletion route. `ARCHIVE_RESTORE_DAYS = 30`.

### 2.5 SMS billing and reconcile

- **17 Oct 22:12:** #647 SMS reserve → send → settle; the ledger is the SMS bill.
- **18 Oct 09:10:** prod SMS counters reconciled to the ledger (2.3).
- **18 Oct 14:18:** #748 adds the package SMS 80%/100% ops email and makes catch-up rollovers rebuild `sms_used_units` from `notify_sms_billable` (+ pending holds) instead of zeroing. Prod has not rolled yet; counters matched ledgers on a read-only check (18 Oct 09:55). **#748 must be live before the first prod rollover, 1 Nov 00:05 EAT** — it is (merged 14:18, SQL ~14:15).

### 2.6 Prod ships, evening of 17 Oct

| PR | SHA | Merged | What | Deploys | Rollback | Approver |
| --- | --- | --- | --- | --- | --- | --- |
| #647 | `b66e1661` | 17 Oct 22:12 | Billing: SMS reserve → send → settle; the ledger is the SMS bill. | Railway `10049e86` | Revert | Alvin 17 Oct 21:49, Ops-Billing's chat |
| #650 | `730ddee1` | 17 Oct 22:08 | Ops-Billing: explicit no-package state, package change rules, `tenant_billing_state` view. | Railway `afdc619c` | Revert | Alvin 17 Oct 21:49, Ops-Billing's chat |
| #631 | `134b493a` | 17 Oct 22:01 | Beta never rejects at the package minute cap; ops email at 80%/100%; period rollover cron (`5 * * * *`, in `docs/supabase/package_period_rollover.sql`). | Railway `dbd4ce81` | Revert | Alvin 17 Oct 21:49, Ops-Billing's chat |
| #738 | `b568c288` | 17 Oct 21:56 | Closed-tenant guard for sends, Desk re-ping, tool writes, transfer and greeting warm (`VOICE_CLOSED_TENANT_GUARD`, default on). Passed on staging at `aa872ade`. | Railway `ef9bea89` | `VOICE_CLOSED_TENANT_GUARD=off`, or revert | Alvin 17 Oct 21:48, Desk's chat |
| #734 | `8ee9b161` | 17 Oct 21:28 | Guard keeps correct time answers and never silences a direct question. **Merged without Alvin's retest;** Alvin chose to keep it. Not signed off (section 5). | Railway `a472c7c4` | Revert | merged by the Voice watchdog OUTSIDE the GO; Alvin chose to keep it at 21:46 in Chief's chat. |
| #735 | `41a63296` | 17 Oct 20:14 | Bare "Hello"/"Yes" after the greeting gets a spoken re-invite (`VOICE_BARE_GREETING_REPLY`, off). | Railway `c9bc8615` | Revert | Alvin's GO to stage, then ship after his staging test call (Chief's chat) |
| #736 | `be0acea4` | 17 Oct 20:10 | Re-speak a line the TTS socket lost; never crash on a TTS close (`VOICE_TTS_RESPEAK`, on). | Railway `fb46d6dd` | `VOICE_TTS_RESPEAK` off, or revert | Alvin's GO to stage, then ship after his staging test call (Chief's chat) |
| #645 | `0340e46e` | 17 Oct 17:10 | Prod greeting dead air at pickup + call-path gaps, recordings fetch. | Railway `145e438e` | Revert | Alvin's GO to stage, then ship after his staging test call (Chief's chat) |
| #717, #718 | `74eff40e`, `1c5a617e` | 17 Oct 12:02, 12:00 | CI: docs workflow; bug-test-pack gate on PRs and pushes to `main`. | | Revert | Not recorded |
| #708 | `925aec26` | 17 Oct 01:34 | Calls: result label "Visit booked" → "Visit requested" (no migration). | | Revert | Not recorded |

Earlier merges since 9 Oct (see git log for detail):

- **15 Oct:** #687 tool-turn smoothness (`VOICE_TOOL_SMOOTH`, off); #694 Swahili clock speech (`VOICE_SW_TIME`); #674 owed booking confirm fold; #693 failed SMS recorded + backoff; #692 run-once finalize (`CALL_FINALIZE_ONCE`, off); #690 recording degrades on 403; #703 onboarding scroll hotfix; #689, #688, #686 docs restructure and previous STATUS refresh; #649 Admin billing cleanup.
- **13 Oct:** #634 Brain `BRAIN_CALL_FIXES_D199`; #632 `BRAIN_CONFIRMED_COVERAGE` Phase 0; #672 Locations outside areas.
- **12 Oct:** #671 insights/outcomes/reviews/Updates; #670 Appearance; #669 contrast; #668 /calls SSR guard; #667 Locations with delivery fees; #663 Payments and Policies; #666 Catalogue price save; #661 design leftovers; #664 speed; #662 Overview insights; #660 UI polish.
- **11 Oct:** #665 Vercel deploy cut; #659 structured data; #658 callbacks only; #657 capability gates; #656 onboarding rebuild; #655 team invites; #654 QA fixes.
- **9–10 Oct:** #652 STATUS refresh; Admin A0–A2 + Activity log (#636, #637, #641); Quality tab (#603); line-unavailable gate (#651); grant-minutes hotfix (#648); fact-confirm (#627); traces purge (#630, #635); ops alerts (#626); Admin sign-in check (#623, #613); docs (#601, #607, #619, #620, #624).

---

## 3. On staging now (not on prod)

Staging Voice runs `9fb557ff` (`staging/pin-759-760-763-main-1e18`: `main` @ `1e18b2fa` + #759 + #760 + #763). #760 and #763 have since merged; **#759 is superseded** (section 4a), so reset staging to `main` before fact-guard step 3 goes on staging. It carries `main` up to `1e18b2fa` only, so it lacks #748, #732, #757 onward, #758 and #762.

- Caller files memory v2 SQL (#673) is applied on **staging only** (carried from 14 Oct).
- #737 and #762 SQL: on staging and prod (section 2).
- #748 SQL: on staging and prod; staging Done and Dusted reconciled 14:14.
- Branded Auth templates: **prod only** (staging needs custom SMTP first).

---

## 4. Open PRs

Source: `gh pr list --state open`, 18 Oct 15:15 EAT. All drafts unless noted. `hold-staging` means Stage-PR leaves it out of the staging pin.

**In the deploy queue now** (one at a time, Brain holds the slot, then hands it back to Voice):

| PR | Head | Lane | What | State |
| --- | --- | --- | --- | --- |
| #733 | `a698f77a` | Brain | D199 visit read: last one only + paged open read. Changes live behaviour (D199 on). | GO Alvin 15:12 EAT, Chief's chat. Shipping first. Fill section 2.1 when merged. |
| #751 | `b442b168` | Brain | Owner text honest (stacked on #732). Changes live behaviour (D199 on). | GO 15:12. Ships after #733. |
| #761 | `d9518310` | Brain | Trusted hours, honest hours summary, name gate (`BRAIN_TRUSTED_HOURS`, **stays off**). Prerequisite for fact-sheet step 1. | GO 15:12 (flag off). Ships after #751. Draft until then. |

Brain puts each STATUS line in its own PR (no separate docs merge).

**Frozen until Brain's D199 call review:**

| PR | Head | Lane | What |
| --- | --- | --- | --- |
| #643 | `24503713` | Voice | Phone wallet low-balance alert (webhook + poll, restart-safe). GO'd, frozen. |
| #731 | `83557c49` | Voice | One owner alert per call, goodbye hangs up, 10 s no-audio close (main cut of #644 + #646). GO'd, frozen. |

**Live-call voice fixes** (`hold-staging`, flags default off; each needs its own GO):

| PR | Head | Flag | What |
| --- | --- | --- | --- |
| #739 | `82e5f340` | `VOICE_BUSINESS_PLACES` | Trust the business's own address, landmarks and aliases in the place guard. Overlaps fact-guard step 6. |
| #740 | `e5c0e9f6` | `VOICE_NO_SILENCE_AFTER_FILLER` | Always speak the tool receipt; no silence after "Let me check". |
| #741 | `2132ca9b` | `VOICE_TIME_ANSWER_ENFORCE` | Speak the current time on a time question; keep unresolved outcomes. Time-answer part folds into fact-guard step 4. |
| #742 | `b0e00786` | `VOICE_MEDIA_PACING` | Pace outbound audio in 20 ms frames, plus always-on media link logs. |
| #743 | `52e9effd` | `SAUTIKIT_VALIDATE_WEBHOOKS=shadow` | Webhook signature shadow mode: two secrets, raw bytes, log which matched, fail open on missing secret. **Waits on SautiKit's answer on which secret signs** voice and `events_url` posts, then Alvin's GO (staging first). Signature checking is **off** on prod and staging today. Rollback once live: unset the variable. |

**Other Voice drafts from 18 Oct:**

| PR / branch | Flag | State |
| --- | --- | --- |
| #745 | `VOICE_TRANSCRIPT_ORDER` (off) | Greeting keeps its transcript slot; adds `transcripts.seq`. **Migration not applied** anywhere. Desk already sorts by `seq` when present (#749). |
| #747 | none | `/api/tts/preview` `greeting=1` speaks the exact live greeting (Desk Settings › Test uses it, #749). |
| #759 | — | **Superseded** by the fact-guard redesign (section 4a). Do not merge; its intent signal and tests move into steps 0 and 3. On the staging pin only. |
| #766 (`voice/contact-name-lock`, head `9fe2b8a0`) | `VOICE_CONTACT_NAME_LOCK` (off) | **In progress.** In `src/db.js` `upsertContact`: when `contacts.metadata.name_locked` (or `single_person`) is set, skip the name and alternate merge; never re-add a name in `metadata.alternate_names_dismissed`; keep other metadata keys. Alvin GO 15:09 EAT for staging, draft, no merge. Brain builds the near-spelling fold (`brain/name-fold`, `BRAIN_NAME_FOLD`) and lock-aware caller memory; Desk builds the toggle and remove button. Chief ruling 15:08: STT near-spellings are one person. |
| Fact-guard stack (`voice/guard-replay-suite` and follow-ups, no PR yet) | `VOICE_FACT_GUARD`, `VOICE_FACT_REPAIR`, `VOICE_LOCAL_HOURS_CONTEXT`, `VOICE_FACT_GUARD_PRICES`, `VOICE_PLACE_TENANT_FIRST`, `BRAIN_PRICE_CONFIRM_GATE` (all off) | **In progress**, staging first (section 4a). |

**Docs PRs folded into this closing PR, #768** (docs merge under Alvin's standing docs rule, 18 Oct 09:40, Chief's chat; slot released by Chief; Chief checks it before merge). Close these after it merges: #750 (ship log), #753 (Desk ops mail env), #756 (#754 merge + recovery template), #764 (#732 lines).

**Other open PRs:**

| PR | Lane | What |
| --- | --- | --- |
| #709 (ready, not draft) | Business Assistant | Area travel fees on calls, alert titles, request footers, enquiry mapping. |
| #727 | Business Assistant | Staging fixes (request wording, catalogue freshness, v2 owner alert, payment + compound answers). |
| #640 | Platform | Ops alerts on Vercel cron instead of page load. |
| #712–#716, #719–#725 | Voice/Brain | NLU-first intent, outage debounce, Swahili verb lock, booking outranks list, regression-9 pack and fixes (R6–R9). |
| #695, #698, #701, #706, #707, #702, #705 | Voice/Brain/Platform | Mouth lock, no-answer-delete, v2 catalogue, TurnArbiter, spoken catalogue (`hold-staging`). |
| #691, #696, #699, #697, #704 | Platform/Desk | Write receipts, graceful drain, provider-health page, Admin cleanup, smart import. |
| #673, #678, #684 | Platform/Brain | Caller files memory v2; trust P1; fact hash contract. |
| #675, #676, #677 | Voice | Silent-caller prompt + stall watchdog; repair-who + carrier-drop callback; language hysteresis. |
| #679, #680, #681, #682, #683 | Brain/Voice | BA v2 Phase 0/1, shadow hook, ack rule, coverage single source. |
| #628, #629, #633, #638 | Voice | Junk names, scorer, spoken facts (`VOICE_SPOKEN_FACTS`), HD_ceba fixes. |
| #653 | Various | Legal pack (parked; call notice ties to the recording decision). |

Closed, not merged (18 Oct 09:41 EAT): #644, #646 (superseded by #731), #639, #642 (superseded by #651 and the SautiKit clips).

---

## 4a. Speech-check redesign (fact sheet + fact guard)

Plan and audit: [`rfcs/speech-check-fact-sheet.md`](rfcs/speech-check-fact-sheet.md). Approved by Alvin 15:07 EAT in Voice's chat ("execute end to end"); ownership rulings by Chief 15:08; build is **staging only, every flag off**; prod needs a GO per step.

**Audit (prod, 9–18 Oct, 57 calls, 330 model turns):** 32 number/place drops, **26 fully correct**, 5 a 3-minute-stale clock, 1 correct hours plus a false claim; **0 invented values caught**; **7 of 7** "not on file" were false; **30** silent drops. Root cause: the guard gates facts on the caller's wording, not on the value vs the right key on file.

| Step | Flag | Owner | State |
| --- | --- | --- | --- |
| 0 Replay suite (32 prod + 2 staging drops + synthetic invented, en/sw/Sheng) | none | Voice | In progress |
| 1 Fact sheet built and traced | `BRAIN_FACT_SHEET` | Brain | Waits on #761 merged flag-off |
| 2 Fact guard shadow | `VOICE_FACT_GUARD=shadow` | Voice | Not started |
| 3 Hours/clock bound by day, wording gate retired | `VOICE_FACT_GUARD=on` | Voice (Brain reviews the hook) | Not started |
| 4 Repair not delete; true "not on file"; never silent | `VOICE_FACT_REPAIR` | Voice (+ Brain templates) | Not started |
| 5 Local hours line uses the named day | `VOICE_LOCAL_HOURS_CONTEXT` | Voice | Not started |
| 6 Prices bound to item; tenant-first places | `VOICE_FACT_GUARD_PRICES`, `VOICE_PLACE_TENANT_FIRST` | Voice | Not started |
| 6 (with) Unconfirmed-price gate: `canSpeakPrice` in `src/conversation/pricingTrust.js` | `BRAIN_PRICE_CONFIRM_GATE` | Brain (Voice wires `catalogueMouth.fileServicePriceLine` and `speechGuard.groundFilePriceLine`) | In progress |
| 7 FACT CARD in prompt; contradicting FAQs out of compile; Desk "Check this" | `BRAIN_FACT_CARD` | Brain + Desk | Not started |

**Chief's rulings (18 Oct 15:08):** Voice owns `src/speech/factGuard.js` and `src/speech/spokenFacts/`; Brain owns the claim checks in `src/conversation/speechGuard.js` and the fact sheet builder, and reviews the single hook. `pricing.confirmed=false` prices (not owner-typed, not legacy) are **never spoken as fact**: the assistant says the team will confirm the price, and the owner confirms it through Desk's "Check this" card.

---

## 5. Known broken / open issues

- **Prod call recording is off.** `VOICE_STREAM_RECORD` is unset on prod, so prod has never recorded (the `events_url` fix alone does not change this). Turning it on waits on the consent decision (section 7), then one env change; rollback is to unset it.
- **Webhook signature checks off** on prod and staging (`SAUTIKIT_VALIDATE_WEBHOOKS` unset): unsigned POSTs get 200. Plan: #743 shadow on staging, then enforce on staging, then prod after a clean call. Blocked on SautiKit's answer on which secret signs.
- **Speech check drops correct answers** (audit in section 4a). Fix in progress behind flags.
- **Aris FAQ contradicts the hours grid:** FAQ "Are you open on Monday? No, we will be closed on Monday" vs grid Mon 09:30–18:00; the compiled prompt carries both. Fact-guard step 7 removes contradicting FAQs from the compile; until then it needs Alvin's call (section 7).
- **Quick hours answer can answer the wrong day** when a question arrives in two pieces (staging HD_af5868852bc7: "And on Saturday… are you open?" → "closed today"). Older code; fix is fact-guard step 5.
- **SautiKit media degradation, 17 Oct 21:52 EAT** (`HD_ad18fd9088e0`, `HD_60e56c6acc88`) and **Aris redial 22:00–22:25, 17 Oct, never reached SautiKit.** Ticket drafted; Alvin to send (*per team notes*).
- **#734 not signed off.** On "Saa ngapi" the assistant gave opening hours instead of the time; fix is #741 / fact-guard step 4.
- **CI `bug-test-pack` may be flaky:** hung about 17 min after "home services playbooks" on `a1c979f3`; a rerun passed (*per team notes*, Brain).
- **`/ws/media` is unguarded.** Anyone with a call ID could inject audio or start paid STT. Needs a per-call stream token (later).
- **WhatsApp template (alert) sends fail with SautiKit 502.** Session text works. Alerts go by SMS.
- **Staging Jirani `events_url`** still wrong (section 2.3).
- **Staging data:** two "Jirani Cleaning Services" tenants (`78386574` has the line, `da25c497` does not); placeholder tenants without a line. Clean up or keep: Alvin to decide (*per team notes*).

*Carried from 14 Oct, not re-verified on 18 Oct. Lane owners: confirm or delete.*

- **TextSMS zero credit** (HTTP 402) on prod and staging.
- **Staging Railway Voice** uses a wallet.read-only SautiKit key (WhatsApp and recordings 403).
- **Meta WhatsApp currency not configured** (error 131042).
- **Old SautiKit keys to revoke after swaps** (Key A, old `scalers-prod-voice`, the "call end" wallet-only key). Key B held until Vercel `SAUTIKIT_ADMIN_OPS_KEY` is repointed. Previews share the prod ops key.
- **Owner alerts sent twice per call** (fix in #731, frozen).
- **Aris facts backfill** by Brain pending.
- **Gemini catalogue flags stay OFF** (`VOICE_GEMINI_CATALOGUE`, `BRAIN_GEMINI_CATALOGUE`).
- **Supabase advisor warnings** (SECURITY DEFINER anon execute, `search_path`, one RLS table without a policy, leaked-password protection).

---

## 6. Build order and what's not built (internal only)

**Build order:** Admin → Settings/onboarding → UI/UX sweep → Packages → Landing → Voice/Brain on real calls. Live-call voice fixes ship any time, one at a time.

- **Admin:** Suspend/Archive shipped 18 Oct (#737; purge schedule not applied); still to do: business edit / members / owner reset, package catalogue, billing period card, invoices.
- **Settings / onboarding**: shipped (#656, #667, #672). GIGO P1/P2 follow-ups remain.
- **UI/UX sweep** across Desk and Admin.
- **Packages**: state rules and rollover shipped (#631, #650); package catalogue and invoices remain.
- **Landing page** (#492 parked until its turn).
- **Legal pack draft #653** (Terms, Privacy, DPA, call notice, beta terms). Parked; call notice ties to the recording decision.
- **WhatsApp as the assistant doing work** (not just alerts).
- Live call transfer: **not built** (callbacks only since #658; reviving it needs a new ADR and Alvin's yes).

Public copy never mentions unbuilt features.

---

## 7. Pending Alvin decisions and to-dos

Items without repo detail are written as open questions; don't fill them in from memory.

1. **Recording consent / `VOICE_STREAM_RECORD`** (unset on prod; Chief handling): record with a spoken notice, record without one, or don't record? Ties to the call notice in legal pack #653.
2. **Esga beta and on-demand:** on-demand was turned off 18 Oct 10:17 with Alvin's approval (2.3). Open question: does Esga stay on beta, and should on-demand stay off? (Also raised in #749.)
3. **Aris Monday FAQ** contradicts the hours grid (section 5). Open question: delete or correct the FAQ now in Settings, or wait for fact-guard step 7 and Desk's "Check this" card?
4. **Staging Jirani `events_url`:** set it in the SautiKit dashboard (staging workspace `1f85601c`) to `https://scalers-staging-staging.up.railway.app/voice/events`.
5. **SautiKit support ticket:** send it (17 Oct 21:52 media degradation, 22:00–22:25 missing dials, and which of the two secrets signs voice and `events_url` posts). The answer unblocks #743.
6. **Top-up:** open question. The repo does not record which account (TextSMS shows HTTP 402 zero credit, section 5; a SautiKit top-up was also mentioned by the team), the amount, or the timing.
7. **#748 before 1 Nov:** #748 is merged and its SQL is on prod (2.3), so the 1 Nov 00:05 EAT rollover runs the fixed catch-up. Open question for Alvin: anything else he wants checked before 1 Nov (for example a staging rollover rehearsal)?
8. **Fact-guard steps to prod:** each step needs its own GO after a staging call.
9. **Carried:** staging full-scope SautiKit key for Railway staging Voice (masked card); Meta WhatsApp currency (131042); staging duplicate Jirani tenants.

---

## 8. Rules

- **Deploys (no watch paths).** Prod Railway Voice auto-deploys from `main` with **no watch paths** (Railway service config, 18 Oct; `railway.toml` sets none), so **every merge to `main`, docs-only included, rebuilds and restarts prod Voice** and drops live calls. Prod Desk (Vercel) also rebuilds. Therefore: merge only with **0 `in_progress` calls**, **one merge at a time through the current deploy-slot holder**, then check prod `/healthz` (SHA and `ok`) and the Aris line before handing the slot on. Batch STATUS lines into the PR they describe rather than a separate docs merge.
- **Ship log.** Every prod ship, SQL apply (prod or staging) and flag flip gets a dated line in section 2: SHA, time EAT, what, deploy ids, rollback, approver.
- **Billing.** Packages + on-demand only; beta charging off; no prepaid wallet; no waive overage.
- **Prod flags:** `FACT_HASH_MODE` and `VOICE_STREAM_RECORD` are unset on prod; keep `VOICE_STREAM_RECORD` unset until the consent decision. `BRAIN_CALL_FIXES_D199` and `VOICE_ENDED_CALL_GUARD` are `on` (18 Oct). Native functions stay off on Aris until speech-hold is staging-tested (*per team notes*).
- **DID.** Never release, reassign or re-point **+254709221536** (Aris).
- **Model.** Use an economical model by default; a bigger one only when the task needs it.
- **Lanes.** Stay in your lane's owns paths ([`AGENTS.md`](../AGENTS.md), `.cursor/rules/*.mdc`). Schema, RPC, and auth changes go to Platform first. Speech check: Voice owns `src/speech/factGuard.js` and `src/speech/spokenFacts/`; Brain owns `src/conversation/speechGuard.js` claim checks and the fact sheet.
- **Needs Alvin's explicit yes:** any prod write (SQL, env vars, Railway, Vercel or SautiKit settings), rotating secrets, releasing a DID, and merging to `main`. Ops-Billing and Brain need his GO in their own chats.
- **Secrets.** Never print, paste, or commit a secret. Docs list variable names only. Secrets go in through masked secret cards entered by Alvin.
- **Git identity.** Never set git config. Commit with `git -c user.name='Alvin Yegon' -c user.email='alvin@scalers.co.ke'`.
- **Test gates** (Node 22): `npm run test:voice`, `npm run test:brain`, `npm run test:mvp`, and `cd dashboard && npm run lint && npm run build`. Stage-PR changes: `npm run test:stage-pr`. Docs: `npm run docs:check`, `npm run docs:reference:check`.
- **Docs-only PRs** must not change runtime code. Say "docs-only" in the PR body. They still restart prod Voice when merged.
- **Before you finish:** update sections 1 to 5 of this file in the same PR when it changes what's live, in flight, or broken. Every merge to `main` updates section 2.
