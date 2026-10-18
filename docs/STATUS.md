---
owner: platform
last_reviewed: 2026-10-18
---

# Scalers status and handoff (start here)

**Last updated Sun 18 Oct 2026, 10:00 EAT.** Checked against `main` (`b66e1661`), `gh pr list`, main's first-parent log, and prod/staging `/healthz` on 18 Oct. Items marked *per team notes* come from lane agents and Alvin, not from the repo. **Update this file in the same PR as any merge to `main`** (see [`CONTRIBUTING.md`](../CONTRIBUTING.md#status-rule)).

New agent or new human: read this whole page before you touch code.

**Read order:** [`AGENTS.md`](../AGENTS.md) → your lane contract in [`docs/reference/lanes/`](reference/lanes/) ([`VOICE.md`](reference/lanes/VOICE.md), [`BRAIN.md`](reference/lanes/BRAIN.md), [`DESK_UX.md`](reference/lanes/DESK_UX.md), [`OPS_BILLING.md`](reference/lanes/OPS_BILLING.md), [`PLATFORM.md`](reference/lanes/PLATFORM.md)) → [`SYSTEM_ARCHITECTURE.md`](explanation/architecture/SYSTEM_ARCHITECTURE.md), [`CURRENT_STATE.md`](explanation/architecture/CURRENT_STATE.md), [`SOURCE_OF_TRUTH.md`](explanation/governance/SOURCE_OF_TRUTH.md) → this file. Glossary: [`CONTEXT.md`](../CONTEXT.md). **One task, one lane, one PR.**

---

## 1. Where we are

Prod Voice (Railway) and prod Desk (Vercel `scalers-project`) run **`main` @ `b66e1661`** (#647, merged 17 Oct 22:12 EAT). Prod `/healthz` reports this SHA, started 17 Oct 22:13 EAT. Staging Voice is pinned to **`aa872ade`** (branch `staging/pin-738-main-8ee9`: #738 on top of `main` @ `8ee9b161`); staging `/healthz` reports it, started 17 Oct 21:51 EAT. The old kitchen pin `1374b25d` is gone.

Prod DID **+254709221536** is Aris, the live paying customer: **never release, reassign, or re-point it.** Esga is on prod DID +254709221542. Staging DID is **+254709221537** (staging tenant Jirani Cleaning Services, *per team notes*).

**Product is callbacks only (#658, 11 Oct).** There is no live call transfer: the assistant takes a message and alerts a teammate. [`LIVE_TRANSFER.md`](archive/LIVE_TRANSFER.md) is archived as history.

Billing is **packages + on-demand only**; beta charging is off; no prepaid wallet; no waive overage.

**Gate right now:** the next step is a clean, scored Aris call on prod. Until then, nothing else ships except live-call voice fixes Alvin approves (see section 4).

| | Production | Staging |
| --- | --- | --- |
| Voice (Railway) | `scalers-project-production.up.railway.app`, deploys `main` on merge. `b66e1661` | `scalers-staging-staging.up.railway.app`, pinned `aa872ade` |
| Desk (Vercel) | `scalers-project`, builds `main`. `b66e1661` | `scalers-staging` (one debounced API deploy, #665) |
| DID | **+254709221536** Aris, +254709221542 Esga | **+254709221537** Jirani |
| SautiKit workspace | `e0e57aa5` | `1f85601c` |
| Supabase | `fjxcdccgyhnvnnlnovcl` | `sgcdncjxauhsbunobmob` |

Design: all UI follows Frontend 2.0 ([`FRONTEND_2_0_CHARTER.md`](explanation/frontend/FRONTEND_2_0_CHARTER.md) wins, then [`design-system/MASTER.md`](reference/design-system/MASTER.md)). Staging mechanics: [`ENVIRONMENTS.md`](reference/operations/ENVIRONMENTS.md).

---

## 2. Shipped to prod (since 14 Oct)

Times EAT. SHAs are the squash commits on `main` (first-parent log). Older history: `git log --first-parent origin/main` and the previous STATUS in git (`30086771`, #686).

| PR | SHA | Merged | What |
| --- | --- | --- | --- |
| #647 | `b66e1661` | 17 Oct 22:12 | Billing: SMS reserve → send → settle; the ledger is the SMS bill. |
| #650 | `730ddee1` | 17 Oct 22:08 | Ops-Billing: explicit no-package state, package change rules, `tenant_billing_state` view. |
| #631 | `134b493a` | 17 Oct 22:01 | Beta never rejects at the package minute cap; ops email at 80%/100%; period rollover cron (`5 * * * *`, hourly at :05, in `docs/supabase/package_period_rollover.sql`). |
| #738 | `b568c288` | 17 Oct 21:56 | Closed-tenant guard for sends, Desk re-ping, tool writes, transfer and greeting warm (`VOICE_CLOSED_TENANT_GUARD`, on). Passed on staging at `aa872ade`. |
| #734 | `8ee9b161` | 17 Oct 21:28 | Guard keeps correct time answers and never silences a direct question. **Merged without Alvin's retest;** Alvin chose to keep it on prod. Not yet signed off (see section 5). |
| #735 | `41a63296` | 17 Oct 20:14 | Bare "Hello"/"Yes" after the greeting gets a spoken re-invite (`VOICE_BARE_GREETING_REPLY`, off). |
| #736 | `be0acea4` | 17 Oct 20:10 | Re-speak a line the TTS socket lost; never crash on a TTS close (`VOICE_TTS_RESPEAK`, on). |
| #645 | `0340e46e` | 17 Oct 17:10 | Prod greeting dead air at pickup + call-path gaps, recordings fetch. |
| #717 | `74eff40e` | 17 Oct 12:02 | CI: docs workflow. |
| #718 | `1c5a617e` | 17 Oct 12:00 | CI: bug-test-pack gate on PRs and pushes to `main`. |
| #708 | `925aec26` | 17 Oct 01:34 | Calls: result label "Visit booked" → "Visit requested" (no migration). |
| #687, #694, #674, #693, #692, #690, #703, #689, #688, #686, #649 | | 15 Oct | Tool-turn smoothness (`VOICE_TOOL_SMOOTH`, off); Swahili clock speech (`VOICE_SW_TIME`); owed booking confirm fold; failed SMS recorded + backoff; run-once finalize (`CALL_FINALIZE_ONCE`, off); recording degrades on 403; onboarding scroll hotfix; docs restructure and previous STATUS refresh; Admin billing cleanup. |

Billing state after #631/#650/#647 (*per team notes*): monthly rollover is live; current period ends 1 Nov 00:00 EAT.

Earlier merges since 9 Oct (see git log for detail):

- **13 Oct:** #634 Brain `BRAIN_CALL_FIXES_D199`; #632 `BRAIN_CONFIRMED_COVERAGE` Phase 0; #672 Locations outside areas.
- **12 Oct:** #671 insights/outcomes/reviews/Updates; #670 Appearance; #669 contrast; #668 /calls SSR guard; #667 Locations with delivery fees; #663 Payments and Policies; #666 Catalogue price save; #661 design leftovers; #664 speed; #662 Overview insights; #660 UI polish.
- **11 Oct:** #665 Vercel deploy cut; #659 structured data; #658 callbacks only; #657 capability gates; #656 onboarding rebuild; #655 team invites; #654 QA fixes.
- **9–10 Oct:** #652 STATUS refresh; Admin A0–A2 + Activity log (#636, #637, #641); Quality tab (#603); line-unavailable gate (#651); grant-minutes hotfix (#648); fact-confirm (#627); traces purge (#630, #635); ops alerts (#626); Admin sign-in check (#623, #613); docs (#601, #607, #619, #620, #624).

### Ops changes (not code), 18 Oct

- **SMS counter reconcile applied on prod** (09:10 EAT): Esga 440 → 193, Aris 207 → 147, SBS 8 → 4 (counter set to sent units from the ledger). Pre-snapshot and rollback (not applied) are on the box: `/workspace/scalers/ops/2026-10-18_sms_counter_reconcile_pre.txt` and `/workspace/scalers/ops/2026-10-18_sms_counter_reconcile_rollback.sql`.
- **SautiKit `events_url` fixed on prod** (*per team notes*, read back after the change). Aris pointed at a dead host (`scalers-production-production…`, typo), so every Aris event, including recording ready, got 404. Esga pointed at `/`, so its call events reached the incoming-call handler. Both now use `https://scalers-project-production.up.railway.app/voice/events`. Voice webhooks and number mapping unchanged (both still `/`).
- **Staging Jirani +254709221537 not fixed.** It is in the separate staging workspace; Alvin sets `events_url` to `https://scalers-staging-staging.up.railway.app/voice/events` in the dashboard.

### Ship log (prod ships, SQL applies, flag flips)

One dated line per event: SHA, change, rollback, approver. Newest first. Times in EAT.

- 2026-10-18 12:04 EAT — **#749 Desk owner-trust fixes: pending ship** (GO'd, still draft, not merged; deploy slot held by #754). Head `80337e78` (main @ `fbef28a8` merged in, CI green). Desk only; no SQL. The Brain seed-filter twin follows `BRAIN_CALL_FIXES_D199` (on only when exactly `on`); not set on the Desk Vercel project, so it stays off: exact starter text only, same as main. Rollback once shipped: Vercel promote the previous prod Desk deployment, or revert the squash commit. Approved by Alvin 2026-10-18 12:04 EAT.
- 2026-10-18 12:10 EAT — **#737 Super Admin Suspend / Archive shipped:** squash-merged `fbef28a8` (head `8b3cc3a6`, main merged in; CI green). Railway prod Voice `d18956e1` SUCCESS, `/healthz` ok on `fbef28a8` (started 12:11 EAT); Vercel prod Desk `dpl_AdHZ1KhTKQM5T9pJirVxiNiQsiwV` READY, no runtime errors. Aris Kenya after: active, line `active`, not suspended or archived. No tenant was suspended or archived. Rollback: Vercel promote `dpl_Hms48Q2MoZ9NKDecHQ56mD5rXtz6` / Railway redeploy `15c23e72` (both `4c3d8932`), or revert `fbef28a8`. Approved by Alvin 2026-10-18 12:04 EAT; deploy slot from Voice with Chief's GO 12:05 EAT.
- 2026-10-18 12:06 EAT — **#737 prod SQL (ALCR), in order:** `admin_business_suspend.sql`, `archive_tenant_billing.sql`, `purge_archived_tenants.sql` (files unchanged since `1768482f`, same as staging 17 Oct; file md5 concat `e9f15556…`). Function definitions on prod match staging md5 for all 7 (e.g. `purge_archived_tenants` `830c412f…`, `admin_set_business_suspended` `b4fc65be…`); new RPCs service-role only; `tenants.suspended_at/_by` added; `refresh_line_status`/`suspend_line_for_nonpayment` absent on prod, so skipped; `notify_sends_deny_mutation` unchanged (already the #647 text). **Not applied:** `purge_archived_tenants_schedule.sql` (purge stays off), `line_rental_grace.sql`. Dry run `purge_archived_tenants(p_days => 30, p_dry_run => true)` → 0 rows (Chapter One eligible 9 Nov 12:50 EAT); tenant state md5 and ops_audit_log count (17) unchanged. Snapshot + rollback on the box: `/workspace/reports/admin-lifecycle/prod/` (`pre-sql-snapshot-20261018T1206EAT.txt`, `rollback-737-prod.sql`: drop the 5 new functions + guard trigger). Approved by Alvin 2026-10-18 12:04 EAT.
- 2026-10-18 10:17 EAT — **Esga Stationery prod data (Esga only, no SHA, data change):** on-demand usage turned OFF via `set_tenant_on_demand_usage(c81b3480…, false)` (tenant_billing_state.on_demand_enabled true → false); ops_audit_log `set_on_demand_usage` fe9629cf, actor `desk-engineer (Alvin approved 2026-10-18)`. Rollback: `select * from set_tenant_on_demand_usage('c81b3480-0cc5-4224-b0e7-24c641d78db2', true)`. Approved by Alvin 2026-10-18 10:15 EAT.
- 2026-10-18 10:17 EAT — **Esga Stationery prod data (Esga only):** cleared the unconfirmed seeded `business_policies.delivery` (source seed, `backfill:roadmap_10_5`, "Same-day Nairobi delivery…") to empty; confirmed Nakuru `service_areas`/`coverage_areas` untouched; `llm_system_prompt` unchanged (it never contained the seed line). ops_audit_log `clear_seed_policy` 1ab1fd8a keeps the old text. Rollback: restore the old text from that audit row with `jsonb_set(business_policies,'{delivery}',…)`. Approved by Alvin 2026-10-18 10:15 EAT.
- 2026-10-17 21:57 EAT — #738 closed-tenant send guard (VOICE_CLOSED_TENANT_GUARD, default on) merged b568c288, Railway ef9bea89; rollback: set VOICE_CLOSED_TENANT_GUARD=off or revert b568c288; approved by Alvin via Chief of Scalers.
- 2026-10-17 ~21:55 EAT — #737 Desk Suspend/Archive/Purge SQL applied on **staging only** (SQL files from cd8db691); not applied on prod, purge schedule not applied; rollback: not recorded; approver: not recorded (*per team notes*).

---

## 3. On staging now (not on prod)

Staging Voice runs `aa872ade` (= `main` @ `8ee9b161` + #738, which has since merged). So staging is behind prod: it lacks #631, #650, #647.

- **#737** (Desk Suspend/Archive/Purge): SQL applied on **staging only** (*per team notes*).
- Caller files memory v2 SQL (#673) is applied on **staging only** (carried from 14 Oct).

---

## 4. Open PRs

Source: `gh pr list --state open`, 18 Oct. All drafts unless noted. `hold-staging` means Stage-PR leaves it out of the staging pin.

**Queued for the next clean Aris call** (one at a time, in this order unless Alvin says otherwise):

| PR | Lane | What | State |
| --- | --- | --- | --- |
| `BRAIN_CALL_FIXES_D199` | Brain | Turn on the #634 fixes on prod. | GO'd, frozen until a clean scored call. |
| #643 | Voice | Phone wallet low-balance alert. | GO'd, frozen. |
| #731 | Voice | One owner alert per call, goodbye hangs up, 10 s no-audio close (main cut of #644 + #646). | GO'd, frozen. |
| #737 | Desk | Admin Suspend/Restore, Archive/Unarchive, scheduled purge. | Prod SQL and merge wait for a scored Aris call. Purge schedule not applied until a recordings deletion route exists. |
| #732, #733 | Brain | Outcome labels past booking; D199 visit read (last one only, paged). | Need Alvin's GO. |

**Live-call voice fixes** (`hold-staging`, flags default off):

| PR | Flag | What |
| --- | --- | --- |
| #739 | `VOICE_BUSINESS_PLACES` | Trust the business's own address, landmarks and aliases in the place guard (shop address was dropped). |
| #740 | `VOICE_NO_SILENCE_AFTER_FILLER` | Always speak the tool receipt; no silence after "Let me check". |
| #741 | `VOICE_TIME_ANSWER_ENFORCE` | Speak the current time on a time question; keep unresolved outcomes. |
| #742 | `VOICE_MEDIA_PACING` | Pace outbound audio in 20 ms frames, plus always-on media link logs. |
| #743 | `SAUTIKIT_VALIDATE_WEBHOOKS=shadow` | Webhook signature shadow mode: two secrets, raw bytes, log which matched, fail open on missing secret. |

**Other open PRs:**

| PR | Lane | What |
| --- | --- | --- |
| #709 (ready, not draft) | Business Assistant | Business Assistant: area travel fees on calls, alert titles, request footers, enquiry mapping. |
| #640 | Platform | Ops alerts on Vercel cron instead of page load. |
| #712–#716, #719–#725 | Voice/Brain | NLU-first intent, outage debounce, Swahili verb lock, booking outranks list, regression-9 pack and fixes (R6–R9). |
| #695, #698, #701, #706, #707, #702, #705, #727 | Voice/Brain/Platform | Mouth lock, no-answer-delete, v2 catalogue, TurnArbiter, spoken catalogue (`hold-staging`). |
| #691, #696, #699, #697, #704 | Platform/Desk | Write receipts, graceful drain, provider-health page, Admin cleanup, smart import. |
| #673, #678, #684 | Platform/Brain | Caller files memory v2; trust P1; fact hash contract. |
| #675, #676, #677 | Voice | Silent-caller prompt + stall watchdog; repair-who + carrier-drop callback; language hysteresis. |
| #679, #680, #681, #682, #683 | Brain/Voice | BA v2 Phase 0/1, shadow hook, ack rule, coverage single source. |
| #618, #621, #622, #625, #628, #629, #633, #638 | Voice | Dropped question, score honesty, scorer fixes, wait-barge, junk names, spoken facts, HD_ceba fixes. |
| #644, #646 | Voice | Carried into #731 (main cut). |
| #602, #611, #615 | Platform/Desk | Quality read APIs; catalogue import preview; Stage-PR skip-staging filter. |
| #587, #597, #614, #584, #583, #537 | Voice | Parked (`skip-staging`). |
| #653, #492, #560, #440, #434, #356 | Various | Legal pack, landing, docs, ops, tester lane: parked. |
| #639, #642 | Voice | Superseded (#651; clips on SautiKit). Close. |

---

## 5. Known broken / open issues

- **Prod call recording is off.** `VOICE_STREAM_RECORD` is unset on prod (Railway variable list, 18 Oct), so prod has never recorded. Turning it on waits on Alvin's consent decision (spoken recording notice or not, Kenya Data Protection Act), then one env change.
- **SautiKit media degradation, 17 Oct 21:52 EAT.** Calls `HD_ad18fd9088e0` and `HD_60e56c6acc88`: media socket opened 4.5–6 s after answer (about 1 s normally), inbound audio jitter about ±0.3 s then stalled, both sockets closed 1006, Completed webhooks 13–25 s late. Our server was idle. Ticket drafted; **Alvin to send.** These calls could not sign off #734 (*per team notes*).
- **Aris redial 22:00–22:25 EAT, 17 Oct, never reached SautiKit.** No call in SautiKit's log or ours. Failure sits between the caller's carrier and SautiKit. Add to the ticket and ask for their ingress logs (*per team notes*).
- **#734 not signed off.** On "Saa ngapi" the assistant gave opening hours instead of the time; fix is #741.
- **Webhook signature checks off** on prod and staging (`SAUTIKIT_VALIDATE_WEBHOOKS` unset; not in prod's Railway variable list, 18 Oct): unsigned POSTs get 200. SautiKit has two secrets and it is unclear which signs voice and `events_url` posts. Plan: #743 shadow mode on staging, then enforce on staging, then prod after a clean call (Alvin's GO, 18 Oct). Question for SautiKit is in the ticket.
- **`/ws/media` is unguarded.** Anyone with a call ID could inject audio or start paid STT. Needs a per-call stream token (later).
- **WhatsApp template (alert) sends fail with SautiKit 502.** Session text works. Alerts go by SMS.
- **Staging Jirani `events_url`** still wrong (section 2, ops).
- **Staging data:** two "Jirani Cleaning Services" tenants (`78386574` has the line, `da25c497` does not); placeholder tenants without a line (prod "Grok Test", two staging QA tenants). Clean up or keep: Alvin to decide (*per team notes*).

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

- **Admin:** Suspend/Archive/Purge in #737; still to do: business edit / members / owner reset, package catalogue, billing period card, invoices.
- **Settings / onboarding**: shipped (#656, #667, #672). GIGO P1/P2 follow-ups remain.
- **UI/UX sweep** across Desk and Admin.
- **Packages**: state rules and rollover shipped (#631, #650); package catalogue and invoices remain.
- **Landing page** (#492 parked until its turn).
- **Legal pack draft #653** (Terms, Privacy, DPA, call notice, beta terms). Parked; call notice ties to the recording decision.
- **WhatsApp as the assistant doing work** (not just alerts).
- Live call transfer: **not built** (callbacks only since #658; reviving it needs a new ADR and Alvin's yes).

Public copy never mentions unbuilt features.

---

## 7. Alvin's to-do list

1. **Make a clean Aris test call** on +254709221536; Voice scores it. This unlocks section 4's queue.
2. **Send the SautiKit ticket** (21:52 media degradation, 22:00–22:25 missing dials, which secret signs voice and `events_url` posts).
3. **Recording decision:** record with a spoken notice, record without one, or don't record.
4. **Set staging Jirani `events_url`** in the SautiKit dashboard (staging workspace `1f85601c`).
5. **GO or no** for Brain #732/#733.
6. **Carried:** top up TextSMS; staging full-scope SautiKit key for Railway staging Voice (masked card); Meta WhatsApp currency (131042).

---

## 8. Rules

- **Billing.** Packages + on-demand only; beta charging off; no prepaid wallet; no waive overage.
- **Prod flags:** `FACT_HASH_MODE` and `VOICE_STREAM_RECORD` are unset on prod (Railway variable list, 18 Oct); keep `VOICE_STREAM_RECORD` unset until the consent decision. Native functions stay off on Aris until speech-hold is staging-tested (*per team notes*).
- **Deploys.** One deploy at a time. After each: check prod `/healthz` (SHA and `ok`), then an Aris check before the next one. Prod Voice has **no watch paths** (Railway service config, 18 Oct; `railway.toml` sets none), so every merge to `main`, docs-only included, rebuilds and restarts prod Voice and drops live calls. Merge when no call is active.
- **DID.** Never release, reassign or re-point **+254709221536** (Aris).
- **Model.** Use an economical model by default; a bigger one only when the task needs it.
- **Lanes.** Stay in your lane's owns paths ([`AGENTS.md`](../AGENTS.md), `.cursor/rules/*.mdc`). Schema, RPC, and auth changes go to Platform first.
- **Needs Alvin's explicit yes:** any prod write (SQL, env vars, Railway, Vercel or SautiKit settings), rotating secrets, releasing a DID, and merging to `main`. Merging to `main` deploys prod Voice and prod Desk. Ops-Billing and Brain need his GO in their own chats.
- **Secrets.** Never print, paste, or commit a secret. Docs list variable names only. Secrets go in through masked secret cards entered by Alvin.
- **Git identity.** Never set git config. Commit with `git -c user.name='Alvin Yegon' -c user.email='alvin@scalers.co.ke'`.
- **Test gates** (Node 22): `npm run test:voice`, `npm run test:brain`, `npm run test:mvp`, and `cd dashboard && npm run lint && npm run build`. Stage-PR changes: `npm run test:stage-pr`.
- **Ship log.** Every prod ship, SQL apply (prod or staging) and flag flip gets a dated line in "Ship log" (section 2): SHA, change, rollback, approver.
- **Docs-only PRs** must not change runtime code. Say "docs-only" in the PR body.
- **Before you finish:** update sections 1 to 5 of this file in the same PR when it changes what's live, in flight, or broken. Every merge to `main` updates section 2.
