---
owner: platform
last_reviewed: 2026-10-19
---

# Scalers status and handoff (start here)

**Last updated Mon 19 Oct 2026, 01:40 EAT.** Checked against `main` (`b66e1661`), `gh pr list`, main's first-parent log, and prod/staging `/healthz` on 18 Oct. Items marked *per team notes* come from lane agents and Alvin, not from the repo. **Update this file in the same PR as any merge to `main`** (see [`CONTRIBUTING.md`](../CONTRIBUTING.md#status-rule)).

New agent or new human: read this whole page before you touch code.

**Read order:** [`AGENTS.md`](../AGENTS.md) → your lane contract in [`docs/reference/lanes/`](reference/lanes/) ([`VOICE.md`](reference/lanes/VOICE.md), [`BRAIN.md`](reference/lanes/BRAIN.md), [`DESK_UX.md`](reference/lanes/DESK_UX.md), [`OPS_BILLING.md`](reference/lanes/OPS_BILLING.md), [`PLATFORM.md`](reference/lanes/PLATFORM.md)) → [`SYSTEM_ARCHITECTURE.md`](explanation/architecture/SYSTEM_ARCHITECTURE.md), [`CURRENT_STATE.md`](explanation/architecture/CURRENT_STATE.md), [`SOURCE_OF_TRUTH.md`](explanation/governance/SOURCE_OF_TRUTH.md) → this file. Glossary: [`CONTEXT.md`](../CONTEXT.md). **One task, one lane, one PR.**

---

## 1. Where we are

Prod Voice (Railway) and prod Desk (Vercel `scalers-project`) run **`main` @ `b66e1661`** (#647, merged 17 Oct 22:12 EAT). Prod `/healthz` reports this SHA, started 17 Oct 22:13 EAT. Staging Voice is pinned to **`aa872ade`** (branch `staging/pin-738-main-8ee9`: #738 on top of `main` @ `8ee9b161`); staging `/healthz` reports it, started 17 Oct 21:51 EAT. The old kitchen pin `1374b25d` is gone.

Prod DID **+254709221536** is Aris, the live paying customer: **never release, reassign, or re-point it.** Esga is on prod DID +254709221542. Staging DID is **+254709221537** (staging tenant Jirani Cleaning Services, *per team notes*).

**Product is callbacks only (#658, 11 Oct).** There is no live call transfer: the assistant takes a message and alerts a teammate. [`LIVE_TRANSFER.md`](archive/LIVE_TRANSFER.md) is archived as history.

Billing is **packages + on-demand only**; beta charging is off; no prepaid wallet; no waive overage. Metering is live. Invoices and payments are not on prod. Invoice pay SQL is on staging only (section 3). The pay page stays in #780. Bachs is the chosen payment provider. Prices are about to be raised. The new prices are not decided. Detail in [Billing](#billing).

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
| #763 | `2842c4f4` | 18 Oct 14:59 | Voice: speech guard reads glued clocks and shillings ("KSh500", "from9:30 AM") like the spaced form, for checking only; streamed model stages record where model text loses spaces (VOICE.md invariant 19). No flag. Railway `c4a235da` SUCCESS, `/healthz` ok on `2842c4f4`. Rollback = revert. Approved by Alvin 14:33 EAT via Chief. |
| #760 | `2cb6e075` | 18 Oct 14:57 | Voice: an ended call gets no new media session; every call is finalized once (`VOICE_ENDED_CALL_GUARD`, VOICE.md invariant 18). Merged with the flag off (no behaviour change); flag turned on 15:01 (see below). Railway `508601d2` SUCCESS, `/healthz` ok on `2cb6e075`. Rollback = revert (or flag off). Approved by Alvin 14:33 EAT via Chief. |
| #732 | `13ddf19d` | 18 Oct 14:48 | Brain: a past-booking question in sw/Sheng/en goes to the visit read; honest outcome labels. Live under `BRAIN_CALL_FIXES_D199` (on in prod). Railway `d458494a` SUCCESS, Vercel `dpl_7WNEx3Up` READY. |
| #752 | `1e18b2fa` | 18 Oct 13:28 | Email design system as a standalone package (`packages/email/`): shared layout, owner and ops templates, plain-text versions, render API and previews, branded Supabase Auth templates. Templates only: no send path and no change to the Voice or Desk build. Line-live email offers the Scalers number or one forwarding code `**004*N**20#` (tested on Safaricom and Airtel by Alvin, 18 Oct; Telkom untested), with the airtime note and a button to `/onboarding/line`. Rollback = revert. Deploy: Railway `587661ec` SUCCESS, `/healthz` ok on `1e18b2fa`. Approved by Alvin 13:11 EAT; deploy slot from Voice 13:22 EAT. |
| #755 | `c4719c70` | 18 Oct 13:22 | Desk "Set up your calls" on `/onboarding/line`: use the Scalers number, or forward with pre-filled codes (recommended all-in-one `**004*N**S#` first, other choices `**61*`/`**67*`/`**62*` under a disclosure, each with its own off code, `##002#` for all), ring time 15/20/30, airtime note before dialling, Android-only tap-to-dial, test step with "I tested it", Overview card until tested. Picks in browser storage per tenant (no migration). `**004*N**20#` tested on Safaricom and Airtel by Alvin 18 Oct 13:09; Telkom untested. Deploys: Vercel `dpl_4m1RFPGGbeE7BN2Z7CXkXSq9frp9` READY 13:23, Railway `0182bcff` SUCCESS, `/healthz` ok on `c4719c70`. Rollback = revert. Approved by Alvin 13:11 EAT; deploy slot from Voice 13:22 EAT. |
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

- **18 Oct 14:59 EAT: #762 prod SQL applied** (Supabase `fjxcdccgyhnvnnlnovcl`, `apply_migration` `tenant_call_setup`, file `supabase/migrations/20261018130000_tenant_call_setup.sql`, md5 `5d2069ab…`). SHA: none (the PR is not merged; file from branch head `97ceb174`). Adds the nullable `tenants.call_setup` jsonb column, the CHECK `tenants_call_setup_valid` (via `call_setup_valid()`), and the `save_call_setup(uuid, jsonb)` RPC: security definer, gated by `member_can_admin`, with the v2 `test_from` rule and the 30-minute test-call check. Function definitions are identical to staging (md5 `5ebdb4db…` and `cc5387c3…`). `save_call_setup` can be run by signed-in users and the service role, not anon. Signed-in users can't update the column directly. 0 rows changed (0 tenants have `call_setup`). Snapshot and rollback on the box: `/workspace/reports/call-setup/v2/prod/` (`rollback-762-prod.sql`: drop the RPC, the check, the validator and the column). Approved by Alvin 18 Oct 14:55 EAT; Voice cleared the additive SQL during its window.
- **SMS counter reconcile applied on prod** (09:10 EAT): Esga 440 → 193, Aris 207 → 147, SBS 8 → 4 (counter set to sent units from the ledger). Pre-snapshot and rollback (not applied) are on the box: `/workspace/scalers/ops/2026-10-18_sms_counter_reconcile_pre.txt` and `/workspace/scalers/ops/2026-10-18_sms_counter_reconcile_rollback.sql`.
- **18 Oct 08:40 EAT: Aris `events_url` fixed** (+254709221536, prod workspace). SHA: none (SautiKit provider config). Changed from the dead host `https://scalers-production-production.up.railway.app/voice/events` (typo) to `https://scalers-project-production.up.railway.app/voice/events`, read back with a GET after the change. Every Aris event, including recording ready, had been getting no answer from the dead host. Voice webhook URL and number mapping unchanged (`/`). Rollback: PUT the old value (not recommended; it is a dead host). Approver: Alvin via Chief, 08:40.
- **18 Oct ~08:41 EAT: Esga `events_url` fixed** (+254709221542, prod workspace). SHA: none (provider config). Changed from prod `/` to prod `/voice/events` (`https://scalers-project-production.up.railway.app/voice/events`), read back. Its call events had been reaching the inbound-call handler at `/`. Voice webhook URL and mapping unchanged. Rollback: PUT `https://scalers-project-production.up.railway.app/` (not recommended; it sends events to the inbound handler). Approver: Alvin via Chief, 08:40 (same GO).
- **18 Oct 12:46 EAT: 3 stale prod `calls` rows closed** (Supabase `fjxcdccgyhnvnnlnovcl`). SHA: none (data fix). `status` `in_progress` → `failed` (the terminal status Voice uses for a failed call, `server.js` call-terminal classifier) on `ENVTEST_CALL_001` (Aris, 7 Aug), `sautikit_call_1786211288059` (Aris, 8 Aug) and `HD_c381db747fda` (Esga, 5 Oct), by exact id, guarded by `status = 'in_progress'`. Nothing else changed (`calls` has no `ended_at`; duration and package seconds stay 0). No triggers on `calls`; no billing, metering or alerts fired. In-progress rows older than 1 h: 0. Audit: `ops_audit_log` `close_stale_calls` (`6cd88235`). Backup and rollback (not applied) on the box: `/workspace/scalers/ops/stale-calls-backup-20261018.json`, `/workspace/scalers/ops/stale-calls-rollback-20261018.sql`. Approver: Alvin via Chief, 12:45.
- **Pending: staging Jirani `events_url`** (+254709221537, separate staging workspace; the agents have no staging SautiKit key). SHA: none. Alvin is setting it in the SautiKit dashboard to `https://scalers-staging-staging.up.railway.app/voice/events`. Rollback: restore the previous value in the dashboard. Approver: Alvin.
- **Not shipped: #743 webhook signature shadow** (draft, head `52e9effd`, `hold-staging`). `SAUTIKIT_VALIDATE_WEBHOOKS` and the signing secrets are unset on both envs, so **signature checking is OFF on prod and staging** today. Waits on SautiKit's answer about which secret signs voice and `events_url` posts, then Alvin's GO (staging first). Rollback once live: unset `SAUTIKIT_VALIDATE_WEBHOOKS`. Approver: Alvin, then Chief for prod.
- **Known: no prod recordings.** `VOICE_STREAM_RECORD` is unset on prod, so Voice never asks SautiKit to record and there are no recordings to fetch (the `events_url` fix alone does not change this). SHA: none. Turning it on is one env change after Alvin and Chief's consent decision; rollback is to unset it. Approver: Alvin with Chief.
- **Branded Supabase Auth email templates (#752 @ `9b356cc7`) applied on prod** (`fjxcdccgyhnvnnlnovcl`, 12:03 EAT) through the Management API: 6 templates and 6 subjects (confirm signup, invite, magic link, reset password, change email, reauthentication), read back 12/12. OTP expiry stays 3600. Sender name was already `Scalers`; SMTP settings untouched. **Staging (`sgcdncjxauhsbunobmob`) not applied:** Supabase refuses template edits on a free-tier project with the built-in mailer, so staging needs custom SMTP first. Redirect allow lists unchanged: prod `https://app.scalers.co.ke/**` and staging `https://scalers-staging.vercel.app/**` already cover `/auth/callback?next=/reset-password`. Rollback (pre-change values, PATCH them back): `/workspace/scalers/ops/2026-10-18_auth_templates_rollback_fjxcdccgyhnvnnlnovcl.json` (staging snapshot `..._sgcdncjxauhsbunobmob.json`). Approved by Alvin, 18 Oct 10:59 EAT. No prod test send yet: `yegonalvin20@gmail.com` has no prod account.
- **Desk password reset (#754) merged to `main`, 18 Oct** (merge SHA and deploy time follow in the same-day docs PR). `/forgot-password`, `/reset-password`, "Forgot password?" on sign in, invite page hint now links to reset. Reset emails come back through `/auth/callback?next=/reset-password` (a 15 minute recovery marker gates the new password form). Prod and staging redirect allow lists already cover the reset link. Rollback: revert #754. Approved by Alvin 18 Oct 12:05 EAT (deploy GO 12:43 EAT, Voice slot 12:43 EAT).
- **18 Oct 13:31 EAT: `BRAIN_CALL_FIXES_D199=on` set on Railway prod Voice** (service `9b09d8c6`, env `8dd0b8ef`; only this variable). Value `on` because the code turns it on only when the value is exactly `on` (`src/conversation/callFixesD199.js`). Redeploy: Railway `67413ba8` SUCCESS, same commit `1e18b2fa`, started 13:31:47 EAT; `/healthz` ok on `1e18b2fa`; boot logs clean. No calls were in progress before or after the flip; Aris `line_status` active and the +254709221536 mapping unchanged. Desk Vercel already had it on: `dpl_4m1RFPGG` from `c4719c70`, READY 13:23 EAT. Brain scores the next Aris call; #643 and #731 stay frozen until that review. Rollback: set `BRAIN_CALL_FIXES_D199=off` (or unset it) on Railway prod and redeploy (Desk: same on Vercel, then redeploy). Approver: Alvin (9 Oct GO) via Chief, 18 Oct 13:21 EAT.
- **2026-10-18 — Brain: #732 merged `13ddf19d`** (14:48 EAT): a past-booking question in sw/Sheng/en ("Ni huduma gani nilikuwa nimeitisha?", "what did I book") goes to the visit read; honest outcome labels (an enquiry that needs an owner callback = `needs_human`; a saved hold or a closed info call = resolved; greetings only = abandoned; a prompt reason is never the note; `primary_intent` is `human` only when the caller asked for a person). Live under `BRAIN_CALL_FIXES_D199` (on in prod since 13:31). One part is not behind that flag: with `VOICE_QUESTION_BEFORE_NAME` on (the default), the past-request phrase also counts as a file ask, so it skips the question-before-name step even with D199 off. Deploy: Railway prod Voice `d458494a` SUCCESS, `/healthz` ok on `13ddf19d`; Vercel prod Desk `dpl_7WNEx3UpCP1m5qGHMDQWYkbDXvss` READY; Aris `line_status` active, 0 calls in progress at merge. Rollback: revert `13ddf19d`, or set `BRAIN_CALL_FIXES_D199` off (that undoes the labels and the visit read, not the question-before-name skip). Approved: Alvin (GO 14:20 EAT).
- **18 Oct, #760 ended-call guard merged** (`2cb6e075`, 14:57 EAT; Railway `508601d2` SUCCESS), flag default off so no prod behaviour change; rollback revert. `VOICE_ENDED_CALL_GUARD` (only the exact value `on` enables; VOICE.md invariant 18): an ended call gets no new media session and every call is finalized once (HD_49d726c3dc9b). Approved by Alvin 14:33 EAT via Chief; Voice deploy slot.
- **18 Oct, #763 glued words merged** (`2842c4f4`, 14:59 EAT; Railway `c4a235da` SUCCESS): changes speech-guard behaviour for glued prices and times. The guard now reads a clock or shilling amount glued to the word before it ("from9:30 AM", "KSh500") the same as the spaced form, for checking only (spoken text unchanged; product codes like "A4" are not numbers), so a glued invented price is caught like a spaced one. Streamed model stages also record where model text loses spaces (`stream.unspacedJoins`; VOICE.md invariant 19). No flag. Rollback: revert. Approved by Alvin 14:33 EAT via Chief; Voice deploy slot.
- **18 Oct 15:01 EAT: `VOICE_ENDED_CALL_GUARD=on` set on Railway prod Voice** (service `9b09d8c6`, env `8dd0b8ef`; only this variable). Value `on` because only the exact value `on` enables it (#760, VOICE.md invariant 18). Redeploy: Railway `7b7e28c5` SUCCESS, same commit `2842c4f4`, started 15:01:14 EAT; `/healthz` ok on `2842c4f4`; boot logs clean. No calls were in progress before or after the flip; Aris `line_status` active and the +254709221536 mapping unchanged. Rollback: unset `VOICE_ENDED_CALL_GUARD` (or set it `off`) on Railway prod and redeploy. Approver: Alvin, 14:33 EAT via Chief.

---

## 3. On staging now (not on prod)

Staging Voice runs `aa872ade` (= `main` @ `8ee9b161` + #738, which has since merged). So staging is behind prod: it lacks #631, #650, #647.

- **#737** (Desk Suspend/Archive/Purge): the functions are on staging and on production. Production recorded `admin_business_suspend_737`, `archive_tenant_billing_737` and `purge_archived_tenants_737` at 12:06 EAT on 18 Oct, before the 12:10 EAT merge. Staging has the functions. Those three names are not in staging's migration list. The purge schedule is not applied on either database.
- Caller files memory v2 SQL (#673) is applied on **staging only** (carried from 14 Oct).
- **#762** (Desk call setup per account): `tenants.call_setup` + `save_call_setup()` applied on staging 18 Oct 13:34 EAT; re-applied 14:19 EAT with the test phone fields (`test_from`, `test_started_at`) and the test-call check. Additive, 0 rows changed. **Also on prod since 18 Oct 14:59 EAT** (see Ops changes); the #762 code is not on prod yet.
- **Billing data layer** (`docs/supabase/billing_data_layer.sql`) on staging only, 18 Oct. Live starter/growth/scale prices seeded as version 1, plus an inactive trial (20 minutes, 14 days). Existing subscriptions grandfathered; enforcement, line status, minutes, seconds, and the package clock were unchanged (checksum `e87e060fd7a7f217fbe3fd3325104853` before and after). `voicemail_until` is null on real rows. A synthetic probe rolled back: escalation allowed while trialing, a minute cap does not open voicemail, the trial-ended notice stayed pending, payment replay held, and a quarantined number could not be marked available. Re-applied the same day for Chief's review: expired quarantine can be assigned again, a sending notice older than 15 minutes can be claimed again, and a sent notice stays sent. That probe rolled back too (0 rows left; tenant row hash `ed560e5d36dec3cd055e5c37fe1045b7` unchanged; 6 businesses, 2 pool rows). Not on prod.
- **Invoice pay** (`docs/supabase/invoice_pay.sql`, `docs/supabase/invoice_documents.sql`, `docs/supabase/billing_company.sql`) on staging only, 18 Oct. Migration names: `invoice_pay`, `invoice_pay_functions`, `invoice_pay_attempt`, `invoice_pay_settle`, `invoice_pay_issue_report`, `invoice_documents`, `invoice_documents_notices`, `invoice_documents_numbers`, `invoice_documents_receipts`, `billing_company` (`20261018211943`). Review fixes the same day: `invoice_pay_review_tokens` (`20261018214209`), `invoice_pay_review_return` (`20261018214229`), `invoice_pay_review_attempt` (`20261018214231`), `invoice_pay_review_apply` (`20261018214246`). Round 2, 19 Oct 01:40 EAT: `invoice_pay_review_round2_receipt` (`20261018223857`), `invoice_pay_review_round2_columns` (`20261018223905`), `invoice_pay_review_round2_attempt` (`20261018223932`), `invoice_pay_review_round2_credit` (`20261018223958`). Canonical `finalize_invoice` stays in `billing_company.sql` (flag, `SCL-`, letterhead, beta refusal, negative draft to one `invoice-credit:<id>` credit and a paid zero invoice). `payment_attempts.updated_at` stays `not null default now()` with no volatile rewrite (0 rows). `return_expires_at` is nullable. A cancelled collection credit function and the receipt amount-update trigger are in. Verified: `invoice_pay_tokens`, `invoice_receipts`, `billing_receipt_counters`, `invoices.tax_kes`, `payment_attempts.checkout_expires_at`, `payment_attempts.client_reference`, `payment_attempts.return_id`, unique `payment_attempts_one_pending_part` on `(invoice_id, part_index)` where `status = 'pending'`, `create_invoice_pay_attempt` locks the invoice `for update`, attach refuses a non-https checkout URL, `mint_invoice_pay_token` and `finalize_invoice` refuse `billing_status = 'beta'`, `apply_payment` replaces an issue row, `finalize_invoice` assigns `SCL-` and copies `billing_company` onto `issuer_*`, payments `match_status` includes `issue`, notice kinds include issued, due soon, payment received, and overdue, and `payments_issue_receipt` is revoked from public, anon, and authenticated (service role still executes it). The letterhead row is Scalers Ventures, +254119774470, support@scalers.co.ke. Address, city, and KRA PIN are null and stay off the document. 0 invoices, 0 pay tokens, 0 attempts, 0 receipts. VAT stays unused (`tax_kes` null). Not on prod. No Bachs keys.
- **Owner billing actions** (#781, `docs/supabase/owner_billing_actions.sql`) on staging only (`sgcdncjxauhsbunobmob`), 18 Oct. `extra_seat_monthly_kes` is 500 on starter, growth, and scale (trial stays null). Owner decision 18 Oct, was 1,000. The default spend cap reads `spend_limit_share_percent` on the pinned version when that column exists, and uses 50 when it is absent or null. Spend-limit hooks are on `consume_call_seconds`, `consume_sms_units`, `reserve_notify_send`, and `tenant_escalation_allowed`. A synthetic probe rolled back (`SYNTHETIC_OK`, 8 checks): a beta business returned `beta` with no invoice, an upgrade opened one proration invoice and a replay did not write a second, a downgrade was blocked when members plus a pending invite exceeded the target seats, a fitting downgrade scheduled and cancel cleared it, extra seats landed on a draft next invoice, and a null spend limit on the 7,000 plan was 3,500 (one hold, then calls past the allowance return `minutes_cap`). Review fixes from #784 are on the same staging project: a `billing_status` of beta returns a null spend cap even when enforcement is on; call overage is 0 for beta or enforcement off and otherwise uses the pinned version's per-second rate; `consume_sms_units` is service role only, caps a claim at 30 segments, and meters beta without a debit; a negative draft becomes one `tenant_credits` row when the invoice is issued; a same-interval upgrade on the last day is scheduled (`pending_change` `upgrade`); period roll copies minutes, seats, and message allowances from the pinned version plus extra seats. A second probe rolled back (`SYNTHETIC_OK`: scheduled upgrade, null spend cap, call reason `beta`, amount 0). After that rollback: 0 synthetic rows, tenant hash `43250ca054fbf66eaf63549d65c3840a` unchanged, 6 businesses, 3 subscriptions, 0 invoices, 2 pool rows. Round 2 from #784 is on the same staging project (19 Oct): `finalize_invoice` numbers `SCL-` and sets `scalers.billing_write` for that update, and it keeps the issuer snapshot already on staging. A negative draft still uses credit key `invoice-credit:<id>`. Active billing refuses a null `package_version_id`. An active on-demand business with a null pinned rate returns `rate_missing` and does not add those seconds. A published rate of 0 still meters. `reserve_notify_send` caps SMS units at 30 and keeps `authenticated`, because Desk reserves caller SMS with the member JWT. A probe rolled back (`SYNTHETIC_OK`: invoice `SCL-2026-000001` open, `rate_missing`, a zero rate metered 10 seconds at amount 0, reserve units 30). Hash unchanged, 0 probe rows. Not on prod. Desk plan screens stay behind `DESK_PLAN_CHANGE` (off). Beta businesses are unchanged.

---

## 4. Open PRs

Source: `gh pr list --state open`, 18 Oct. All drafts unless noted. `hold-staging` means Stage-PR leaves it out of the staging pin.

**Queued for the next clean Aris call** (one at a time, in this order unless Alvin says otherwise):

| PR | Lane | What | State |
| --- | --- | --- | --- |
| `BRAIN_CALL_FIXES_D199` | Brain | Turn on the #634 fixes on prod. | **On in prod** 18 Oct 13:31 EAT (Railway `67413ba8`, Vercel `dpl_4m1RFPGG`). Brain scores the next call. |
| #758 | Desk | Settings quick fixes from the owner review (Alvin approved 13:21 EAT): Catalogue / prices links open the Catalogue, plus small Settings copy and display fixes. No SQL, no prompt or call-facing change. | **Shipped 18 Oct 15:08 EAT:** squash `52498db9`; Vercel prod `dpl_DBSyRwgU4eg9bRQwPnvQB2t9XuRT` READY on app, admin and www, no runtime errors; Railway `7dfbf4e9` SUCCESS, `/healthz` ok on `52498db9`. Rollback: promote `dpl_738F4MizcCCtAM87wfGPhqoAiiJx` (`adab1e81`) or revert `52498db9`. GO Alvin 14:55 EAT. |
| #643 | Voice | Phone wallet low-balance alert. | GO'd, frozen. |
| #731 | Voice | One owner alert per call, goodbye hangs up, 10 s no-audio close (main cut of #644 + #646). | GO'd, frozen. |
| #737 | Desk | Admin Suspend/Restore, Archive/Unarchive, scheduled purge. | **Merged** 18 Oct 12:10 EAT (`fbef28a8`). Production SQL was already recorded at 12:06 EAT (`admin_business_suspend_737`, `archive_tenant_billing_737`, `purge_archived_tenants_737`). Staging has the functions. They are not in staging's migration list. Purge schedule is not applied on either database. |
| #733 | Brain | D199 visit read (last one only, paged). (#732 merged 18 Oct 14:48, `13ddf19d`.) | Need Alvin's GO. |
| #762 | Desk | Call setup per account (follow-up to #755): picks saved on the account (one-time copy from the browser); "Forwarding works" only when a call from the owner's named test phone arrives within 30 minutes of starting the test (other calls only show "Calls are reaching your assistant"); fix checklist when the test fails; Settings > Calls & forwarding; Overview note after 7 days without a call. | **Pending ship (18 Oct).** GO Alvin 14:55 EAT. Prod SQL applied 14:59 EAT (Ops changes). Code merges in the next Voice deploy slot, right after #758. Until then prod Desk keeps using browser storage. |

**Ops-Billing (dated per the STATUS rule):**

- **18 Oct 2026, in flight: #775** billing data layer (`cursor/billing-data-layer-cc4b`). Staging SQL only (section 3). No charges, no send-path change, no prod SQL.
- **19 Oct 2026, in flight: #780** invoice pay (`cursor/invoice-pay-0c16`), stacked on #775. Pay tokens, public `/pay/<token>`, mock Bachs checkout, webhook inbox, split parts above KSh 150,000, report-only reconciliation, `SCL-` invoice numbers, invoice and receipt PDF/HTML, an owner billing history API, and a `billing_company` letterhead snapshotted onto each invoice at issue. One pending checkout per part. A failed Bachs cancel reuses an open checkout or blocks with "Previous payment still processing." A collection on a cancelled attempt becomes one `tenant_credits` row. A short terminal SUCCEEDED applies as a partial. An overpay updates the same receipt. The return id expires after 24 hours. "Payment received" only when the invoice is fully paid. SQL is applied on staging only (section 3). Not on prod. No keys. Live mode is refused. `BILLING_NOTICES_SEND` stays off. Desk handoff: [`INVOICE_PAY.md`](reference/operations/INVOICE_PAY.md).
- **18 Oct 2026, in flight: #781** owner billing actions (`cursor/owner-billing-actions-5c64`), stacked on #775. SQL is on staging (section 3), including the #784 review fixes for beta spend and call metering, the SMS claim, negative invoice credits, last-day upgrades, and version allowances on period roll. Round 2 (19 Oct) numbers issued invoices `SCL-`, sets the invoice freeze flag inside `finalize_invoice`, refuses active billing without a pinned version, returns `rate_missing` when that pin has no rate, and caps `reserve_notify_send` at 30 SMS units. No payment provider. Beta returns `beta`. Contract `docs/reference/operations/OWNER_BILLING_ACTIONS.md`. Prod script `docs/supabase/prod/owner_billing_actions.sql` is not applied. `DESK_PLAN_CHANGE` stays off.



- **18 Oct 2026, SHIPPED: #748** (squash merge of branch `ops-billing/rollover-audit-sms-alerts`, head `7e8ecff5`; merge SHA `0f280504e0a706b6efc81b70a50bfbda48549eea`). Approved by Alvin, GO 14:11 EAT; Scalers Voice granted the prod slot 14:16 EAT. **#748 shipped after D199 (flipped 13:31, Railway 67413ba8)**, so Brain can separate the effects.
  - *What it changes:* (1) `package_period_rollover.sql`: a catch-up roll (jumps more than one period, or the new period already has usage) rebuilds `seconds_used` from `calls.package_seconds_applied` and `sms_used_units` from `notify_sms_billable` (+ pending holds) for the new period instead of zeroing; an on-time roll still zeroes. (2) New `on_demand_usage_audit.sql`: `set_tenant_on_demand_usage` writes an `ops_audit_log` row (`set_on_demand_usage`, actor, before, after). (3) `package_state_rules.sql`: assign/unassign Activity rows carry `detail.before` / `detail.after` `{package_sku, package_name, period, period_start, period_end, status}`; existing fields kept. (4) Voice: package SMS 80%/100% ops email (`src/billing/smsUsageAlerts.js`), deduped like the minute notices. (5) `docs/supabase/staging/dnd_usage_counter_reconcile.sql` (staging only).
  - *SQL applied:* staging (scalers-staging) ~14:13 EAT, prod ~14:15 EAT: `package_state_rules.sql`, `package_period_rollover.sql`, `on_demand_usage_audit.sql`. Prod function bodies match staging; cron jobs unchanged (`scalers-package-period-rollover` `5 * * * *`, `notify-stale-release`, `sms-counter-drift-daily`). Staging test on Test Archive Co (rolled back): catch-up rebuilt counters, on-time zeroed, on-demand audit rows, assign/unassign before/after. Staging Done and Dusted reconcile run 14:14 EAT: 0 → 17,792 s, 0 → 150 SMS (audit `usage_counter_reconcile`, SMS drift 0). First prod rollover with the fix: 1 Nov 00:05 EAT.
  - *Rollback:* SQL: `/workspace/scalers/ops/2026-10-18_748_prod_rollback.sql` and `2026-10-18_748_staging_rollback.sql` (pre-apply snapshots `2026-10-18_748_{prod,staging}_pre.sql`; functions only, audit rows stay). Reconcile: the rollback block at the bottom of the script. Code: revert the squash commit (SMS notices stop; nothing else depends on them).

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
| "Desk: Settings quick fixes" (`desk/settings-quick-fixes`, draft) | Desk | **18 Oct, pending ship.** Owner review fixes Alvin approved 13:21 EAT: "Add prices"/"Check prices" open the Catalogue; Policies hide prompt text, starter text shows once, "Holds and deposits" label, "Tap" only on touch; Back gesture asks before dropping edits; remove place/area asks first; forgiving catalogue import (headers, semicolons, "2,500", file picker, row warnings, Update prices); visible phone service labels; honest "Add to catalogue" toast; Identity placeholder and toast; 44 px "Yes, this is right". No schema, prompt or call-field change. |
| #709 (ready, not draft) | Business Assistant | Business Assistant: area travel fees on calls, alert titles, request footers, enquiry mapping. |
| #640 | Platform | Ops alerts on Vercel cron instead of page load. |
| #712–#716, #719–#725 | Voice/Brain | NLU-first intent, outage debounce, Swahili verb lock, booking outranks list, regression-9 pack and fixes (R6–R9). |
| #695, #698, #701, #706, #707, #702, #705, #727 | Voice/Brain/Platform | Mouth lock, no-answer-delete, v2 catalogue, TurnArbiter, spoken catalogue (`hold-staging`). |
| #691, #696, #699, #697, #704 | Platform/Desk | Write receipts, graceful drain, provider-health page, Admin cleanup, smart import. |
| #673, #678, #684 | Platform/Brain | Caller files memory v2; trust P1; fact hash contract. **#684 is folded into #771** (cherry-pick onto `main`). Do not merge #684 as well. |
| #771 | Desk/Platform | Price units on confirm (#685). Yes keeps the owner's price line, including per sq ft, per job, per day, a month, /kg, and wording the label cannot cover. Forward migration `20261018200000_price_unit_preserve.sql` is **not applied**. Staging first, needs backup before prod. |
| #675, #676, #677 | Voice | Silent-caller prompt + stall watchdog; repair-who + carrier-drop callback; language hysteresis. |
| #679, #680, #681, #682, #683 | Brain/Voice | BA v2 Phase 0/1, shadow hook, ack rule, coverage single source. |
| #618, #621, #622, #625, #628, #629, #633, #638 | Voice | Dropped question, score honesty, scorer fixes, wait-barge, junk names, spoken facts, HD_ceba fixes. |
| #644, #646 | Voice | **Closed, not merged** (18 Oct 09:41 EAT): superseded by #731 (main cut). No longer open. |
| #602, #611, #615 | Platform/Desk | Quality read APIs; catalogue import preview; Stage-PR skip-staging filter. |
| #587, #597, #614, #584, #583, #537 | Voice | Parked (`skip-staging`). |
| #653, #492, #560, #440, #434, #356 | Various | Legal pack, landing, docs, ops, tester lane: parked. |
| #639, #642 | Voice | **Closed, not merged** (18 Oct 09:41 EAT): superseded by #651 (line-unavailable gate) and the clips on SautiKit. No longer open. |

---

## 5. Known broken / open issues

- **#685 price units (open, fix in #771, not merged).** Settings "Is this right?" shows and saves "KSh 40 per sq ft" as "KSh 40", so the Business Assistant can quote the short line. Migration `20261018200000_price_unit_preserve.sql` repairs backfilled rows. Not applied. Staging first, needs backup before prod.
- **Prod call recording is off.** `VOICE_STREAM_RECORD` is unset on prod (Railway variable list, 18 Oct), so prod has never recorded. Turning it on waits on Alvin's consent decision (spoken recording notice or not, Kenya Data Protection Act), then one env change.
- **SautiKit media degradation, 17 Oct 21:52 EAT.** Calls `HD_ad18fd9088e0` and `HD_60e56c6acc88`: media socket opened 4.5–6 s after answer (about 1 s normally), inbound audio jitter about ±0.3 s then stalled, both sockets closed 1006, Completed webhooks 13–25 s late. Our server was idle. Ticket drafted; **Alvin to send.** These calls could not sign off #734 (*per team notes*).
- **Aris redial 22:00–22:25 EAT, 17 Oct, never reached SautiKit.** No call in SautiKit's log or ours. Failure sits between the caller's carrier and SautiKit. Add to the ticket and ask for their ingress logs (*per team notes*).
- **#734 not signed off.** On "Saa ngapi" the assistant gave opening hours instead of the time; fix is #741.
- **Webhook signature checks off** on prod and staging (`SAUTIKIT_VALIDATE_WEBHOOKS` unset; not in prod's Railway variable list, 18 Oct): unsigned POSTs get 200. SautiKit has two secrets and it is unclear which signs voice and `events_url` posts. Plan: #743 shadow mode on staging, then enforce on staging, then prod after a clean call (Alvin's GO, 18 Oct). Question for SautiKit is in the ticket.
- **`/ws/media` is unguarded.** Anyone with a call ID could inject audio or start paid STT. Needs a per-call stream token (later).
- **WhatsApp template (alert) sends fail with SautiKit 502.** Session text works. Alerts go by SMS.
- **Staging Jirani `events_url`** still wrong (section 2, ops).
- **Rollover catch-up zeroed usage (fixed 18 Oct, #748; SQL on staging and prod).** A roll that caught up a stale period zeroed the counters even when the new period already had usage; staging Done and Dusted reconciled 14:14 EAT. Hit staging Done and Dusted on 17 Oct 22:05 EAT (Admin/Desk show 0 minutes used for October). Prod has not rolled yet and its counters match the ledgers (read-only check, 18 Oct 09:55 EAT); the first prod roll is 1 Nov 00:05 EAT, so this fix should be live before then.
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

- **Admin:** Suspend/Archive shipped (#737, 18 Oct). Purge schedule not applied. Still to do: business edit / members / owner reset, package catalogue, billing period card, invoices.
- **Settings / onboarding**: shipped (#656, #667, #672). GIGO P1/P2 follow-ups remain.
- **UI/UX sweep** across Desk and Admin.
- **Packages**: state rules and rollover shipped (#631, #650). Staging has the billing data layer (versions, `billing_status` NOT NULL, invoices, notices, `tenant_escalation_allowed`, number quarantine), the invoice pay SQL, and the owner plan-change RPCs (section 3), including the review fixes for beta metering, last-day upgrades, version allowances on roll, `SCL-` invoice numbers, and the active-plan pin. A draft invoice cannot take a number. Notice sends stay off unless `BILLING_NOTICES_SEND=on`, and a reclaimed notice reuses its idempotency key. No charges and no prod SQL. Package catalogue UI remains. The public pay page is in #780 and is not on prod. Desk plan screens stay behind `DESK_PLAN_CHANGE` (off).
- **Landing page** (#492 parked until its turn).
- **Legal pack draft #653** (Terms, Privacy, DPA, call notice, beta terms). Parked; call notice ties to the recording decision.
- **WhatsApp as the assistant doing work** (not just alerts).
- Live call transfer: **not built** (callbacks only since #658; reviving it needs a new ADR and Alvin's yes).

Public copy never mentions unbuilt features.

---

## Billing

Metering is live: packages, usage caps, the SMS reserve, send and settle ledger, and monthly rollover. Production has no invoices and no payments. Staging has the billing data layer, invoice pay SQL, and the owner plan-change RPCs (section 3). They can open an invoice for an enforced business and they do not collect. On staging, a beta subscription is not charged for call or SMS overage, a last-day upgrade waits for the renewal, issued invoices are numbered `SCL-`, and an active on-demand business with no pinned rate is not metered for free. The pay page and Bachs adapter are in #780. Bachs is the chosen payment provider (collection per invoice; Scalers keeps the subscription record). The owner RPCs do not call a provider. Prices are about to be raised. The new prices are not decided, so none are written here.

This is Phase 0 of the 18 Oct 2026 ops and billing plan: correct the #737 and #643 migration records, and revoke anon execute on the seat functions. That seat revoke is on staging (`20261018164459`) and production (`20261018180156`). `create_tenant_invite`, `accept_tenant_invite`, and `transfer_tenant_ownership` allowed the anon role on both databases. Each revoke keeps `service_role` only. Create is on staging (`20261018180447`). Accept and transfer are on staging (`20261018180648`). Production waits for the owner's OK. The admin billing console is not started. Invoice pay SQL is on staging. The page is not on prod. VAT and KRA eTIMS stay off. `tax_kes` is nullable for later.

Paid-mode copy on Usage still says "next invoice". That wording is a Desk hand-off (`billingStateModel.ts`, `usageCap.ts`). Do not ship it as a promise until invoices exist.

---

## 7. Alvin's to-do list

1. **Make a clean Aris test call** on +254709221536; Voice scores it. This unlocks section 4's queue.
2. **Send the SautiKit ticket** (21:52 media degradation, 22:00–22:25 missing dials, which secret signs voice and `events_url` posts).
3. **Recording decision:** record with a spoken notice, record without one, or don't record.
4. **Set staging Jirani `events_url`** in the SautiKit dashboard (staging workspace `1f85601c`).
5. **GO or no** for Brain #733 (#732 merged 18 Oct 14:48).
6. **Carried:** top up TextSMS; staging full-scope SautiKit key for Railway staging Voice (masked card); Meta WhatsApp currency (131042).
7. **Invoice letterhead still open:** physical address, city, and KRA PIN. Legal name (Scalers Ventures), phone (+254119774470), and billing email (support@scalers.co.ke) are on staging `billing_company`. Set the rest with the update in [`INVOICE_PAY.md`](reference/operations/INVOICE_PAY.md). Blank lines stay off the invoice until then. Set `BACHS_MODE=sandbox`, `BACHS_API_KEY`, and `BACHS_WEBHOOK_SECRET` on Vercel Preview. Leave `BILLING_NOTICES_SEND` off.

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
- **Docs-only PRs** must not change runtime code. Say "docs-only" in the PR body.
- **Before you finish:** update sections 1 to 5 of this file in the same PR when it changes what's live, in flight, or broken. Every merge to `main` updates section 2.
