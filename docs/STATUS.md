# Scalers status and handoff (start here)

**Last updated Sat 10 Oct 2026, 10:45 EAT.** Checked against `main`, `gh pr list`, `gh pr view`, and main's log at 10:45 EAT. Items marked *per team notes* come from lane agents and Alvin, not from the repo. Update this file when you finish a piece of work, not only at the end of a week.

New agent or new human: read this whole page before you touch code.

**Read order:** [`AGENTS.md`](../AGENTS.md) → your lane contract in [`docs/agents/`](agents/) ([`VOICE.md`](agents/VOICE.md), [`BRAIN.md`](agents/BRAIN.md), [`DESK_UX.md`](agents/DESK_UX.md), [`OPS_BILLING.md`](agents/OPS_BILLING.md), [`PLATFORM.md`](agents/PLATFORM.md)) → [`SYSTEM_ARCHITECTURE.md`](architecture/SYSTEM_ARCHITECTURE.md), [`CURRENT_STATE.md`](architecture/CURRENT_STATE.md), [`SOURCE_OF_TRUTH.md`](governance/SOURCE_OF_TRUTH.md) → this file. Glossary: [`CONTEXT.md`](../CONTEXT.md). **One task, one lane, one PR.**

---

## 1. Where we are

Prod Voice (Railway) and prod Desk (Vercel `scalers-project`) both run **`main` @ `aef7bb62`** (#641, Admin Activity log; healthz `ok`). Staging Voice runs a hand-pinned build **`ffd9e5aa`** (commits ahead of `main`, 11 behind; `hold-staging` label on #618 keeps it pinned). Prod DID **+254709221536** is Aris, the live paying customer: **never release, reassign, or re-point it.** Staging DID is **+254709221537** (Done and Dusted test tenant). Build order set by Alvin: **Admin → Settings/onboarding (GIGO) → UI/UX sweep → Packages → Landing → Voice/Brain on real calls.** Live-call Voice fixes ship any time a real call shows a bug. Billing is **packages + on-demand only**; beta charging is off; no prepaid wallet; no waive overage (removed 6 Oct).

| | Production | Staging |
| --- | --- | --- |
| Voice (Railway) | `scalers-project-production.up.railway.app`, deploys `main` on merge. `aef7bb62` | `scalers-staging-staging.up.railway.app`, pinned `ffd9e5aa` |
| Desk (Vercel) | `scalers-project`, builds `main`. `aef7bb62` | `scalers-staging` (builds the staging branch only) |
| DID | **+254709221536** Aris | **+254709221537** Done and Dusted |
| SautiKit workspace | `e0e57aa5` | `1f85601c` |
| Supabase | `fjxcdccgyhnvnnlnovcl` | `sgcdncjxauhsbunobmob` |

Design: all UI follows Frontend 2.0 ([`FRONTEND_2_0_CHARTER.md`](frontend/FRONTEND_2_0_CHARTER.md) wins, then [`design-system/MASTER.md`](frontend/design-system/MASTER.md)). Staging mechanics: [`ENVIRONMENTS.md`](operations/ENVIRONMENTS.md).

---

## 2. Shipped to prod (6 to 10 Oct)

Times EAT. SHAs are the squash commits on `main`.

| PR | SHA | Merged | What |
| --- | --- | --- | --- |
| #641 | `aef7bb62` | 10 Oct | Admin A1: Activity log for every admin write. |
| #637 | `8dbd682c` | 10 Oct | Admin A2: Today screen + new nav (phone: 4 tabs + More sheet). |
| #636 | `2afe0df6` | 10 Oct | Admin A0: safety fixes, live-number guard, ConfirmSheet, session actor, Archive. |
| #603 | `614d9247` | 10 Oct | Super Admin **Quality** tab reads live voice traces. |
| #651 | `eda862e7` | 9 Oct 21:41 | Archived/suspended tenant plays line-unavailable and hangs up; no charge. Replaces #639. |
| #648 | `1e1581a1` | 9 Oct 21:31 | Ops-Billing hotfix: Admin **grant minutes** always failed (42702 ambiguous column) and showed `[object Object]`. Prod SQL applied (migration `20261009183115`, *per Ops*). |
| #627 | `96ac39eb` | 9 Oct 15:24 | Desk fact-confirm 1: changed-only owner confirm (`FACT_HASH_MODE`, on for staging only, unset on prod), confirm v2 SQL, stable service ids. |
| #635 | `2f5ce569` | 9 Oct 13:41 | Batched `voice_turn_traces` purge + `created_at` index + partitioning plan. Daily cron 03:17 EAT, 30-day retention. |
| #630 | `b3f72f76` | 9 Oct 11:22 | pg_cron daily 30-day purge of `voice_turn_traces` (applied on prod). Superseded in mechanism by #635. |
| #626 | `892ec9f5` | 9 Oct 11:17 | Platform ops alerts read Super Admin emails, email only, env fallback. |
| #623 | `cc85f8dc` | 9 Oct 11:05 | Admin checks sign-in and Super Admin before any data loads (signed-out leak fix). |
| #613 | `db84f5ca` | 9 Oct 10:40 | Admin degrades on missing ops tables, logs real DB errors, traces wallet scope denial. |
| #619, #620, #607, #601, #624 | various | 9 Oct 11:15–11:19 | Docs: this handoff, stream cost (KES 0.50/min), staging/prod DID fix, catalogue/GIGO as-built, prod Admin schema gap list. |
| #612, #617 | `9b2b7426`, `87cd6f94` | 9 Oct 00:04, 00:07 | Voice M0 / M0b: coverage grounding, TTS word gaps, price/what-else/barge-in, Kiswahili hours, handoff close after escalate, filler on tool turns. |
| #616 | `9706426c` | 8 Oct 17:43 | Voice rejects inbound calls when the SautiKit wallet is empty (fails open on probe errors). |
| #561–#600 range | various | 6–8 Oct | GIGO P0, caller file A+B, Speak-DNA, voice pipeline/traces, Admin kit, Desk kit, wallet-ledger surfaces removed. `gh pr list --state merged --limit 60`. |

Ops changes on prod (not PRs, *per team notes*):

- **Prod call traces on** (`VOICE_TRACE=on`). First rows written on the 9 Oct 20:18 EAT Aris call.
- **Prod SautiKit key swapped** to `scalers-prod-voice-v2` on Railway prod Voice, 9 Oct 19:31 EAT. Wallet probe, `calls.read`, and WhatsApp session messages verified OK.
- **Line-unavailable clips** (en/sw) uploaded to prod SautiKit via `POST /v1/uploads/audio`.
- **Prod Aris number (alcr) WhatsApp events webhook** repointed from staging to `https://scalers-project-production.up.railway.app/whatsapp/events`, 10 Oct ~10:40 EAT (Alvin).
- **`CRON_SECRET` set on Vercel prod** (Alvin). Unblocks #640.
- **Aris test call** 9 Oct 22:37 EAT, `HD_6480a5e68777`: greeting 1.36 s, score 92.9 (*per team notes*).

---

## 3. Shipping now

Admin chain (#603, #636, #637, #641) is **done on prod**. #651 is live.

| Step | PR / item | What | State at 10:45 |
| --- | --- | --- | --- |
| 1 | **#649** | Admin billing cleanup: readable errors, one assign path, Change package confirm. | Open, mergeable, base `main` (stacked chain already merged) |

Close #639 if still open (#651 superseded it).

---

## 4. Ready, waiting on Alvin's GO

| PR | Lane | What | Notes |
| --- | --- | --- | --- |
| #645 | Voice | **Prod dead-air fix** (HD_d3900): greeting pre-rendered per tenant, webhook answers from an in-memory tenant directory (~2 ms vs 2.05 s), drains buffered caller audio so it can't barge the greeting, shorter end-of-turn wait (360 ms), hold line past 700 ms, true per-channel notify outcome (`owner_notified`), URLs spoken properly, **recording fetch fixed (prod fetched 0 recordings in 21 days)**. Each fix has its own off switch. | Draft, base `main`, CI green. Staging test call first. |
| #644, #646 | Voice | Bundle: one owner message per call after the call, goodbye ends the call, carrier duration, greeting as spoken, language invite retired for all businesses. | #646 is based on `voice/call-ceba-fixes` (#638), not `main`; needs a main-based cut before prod. |
| #634 | Brain | `BRAIN_CALL_FIXES_D199`: junk slots cleaned, cut-off turns write nothing, reschedule bypasses the coverage gate, Swahili "saa nane" time handling. | Draft |
| #632 | Brain | `BRAIN_CONFIRMED_COVERAGE` Phase 0 + handoff-record spec. | Draft |
| #643 | Voice | Phone wallet low-balance alert (webhook + poll, restart-safe). | Draft |
| #628 | Voice | Junk caller names never make a shared line; no saved request without caller content. | Draft |
| #631 | Voice / Ops | Beta never rejects at the package cap; ops email at 80%/100%; draft period rollover cron. | Draft |
| #647 | Ops-Billing | SMS reserve → send → settle + reconcile (e.g. Aris 42 → 18). | Draft, base `main` |
| #650 | Ops-Billing | Package rules: explicit no-package/unassign, upgrades now with prorated minutes, downgrades next period, `tenant_billing_state` view. | Draft, **stacked on #631**. Alvin's decisions made: granted minutes expire at period end; a first package mid-month gets full minutes; annual packages billed yearly with the monthly allowance reset. |
| #640 | Platform | Ops alerts on a Vercel cron instead of page load. | Draft. `CRON_SECRET` is on Vercel prod; needs GO and deploy. |
| #587 | Voice | Speak a clip before a billing hangup (Swahili fallback recordings). | Needs a named reviewer. |

Other open drafts (staging or parked): #633 spoken facts, #625 wait-barge re-prompt, #622/#629 scorer, #621 score honesty, #618 (holds staging pin), #615 skip-staging label, #614 Voice Phase 2, #611 catalogue import preview, #602 Quality read APIs, #597, #584, #583, #560, **#537**, #492 landing, #440, #434, #356. #642 is superseded (clips now uploaded to SautiKit).

---

## 5. Known broken / open issues

- **SautiKit wallet low on prod:** ~KES 5.5 (*healthz* 9 Oct 22:51). #616 rejects inbound at zero. Top-up urgent.
- **TextSMS zero credit** (HTTP 402) on prod and staging.
- **Staging Railway Voice** still uses a wallet.read-only SautiKit key (WhatsApp and recordings 403). Full-scope staging key is on Vercel only; paste the same key on Railway staging (*per Ops*).
- **Prod voice webhooks** still point at `/` (works via root route). Optional repoint to `/voice/incoming` and `/voice/events`.
- **Webhook signature checks off** in prod and staging (`SAUTIKIT_VALIDATE_WEBHOOKS` unset; prod lacks `SAUTIKIT_WEBHOOK_SECRET`). Turn on only after launch with Voice watching.
- **Meta WhatsApp currency not configured** (error 131042).
- **WhatsApp template (alert) sends get SautiKit 502.** Session text works. Raised with SautiKit support. Alerts fall back to email.
- **Prod recordings still null** (fix in #645).
- **Old SautiKit keys to revoke after swaps:** Key A (confirm label in Admin › Telecom), old `scalers-prod-voice`, and the "call end" wallet-only key (after Desk gets its own read key on Vercel `SAUTIKIT_API_KEY`). **Key B held** until Vercel `SAUTIKIT_ADMIN_OPS_KEY` is repointed to a key with `numbers.claim` + `webhooks.manage`. Preview shares the prod ops key today, so a preview can claim prod numbers; previews should get a staging-workspace key.
- **Owner alerts sent twice per call**, and the first can say "missed-call lead" on an answered call (fix in #644/#646).
- **Native functions stay off on Aris** until speech-hold is staging-tested.
- **Aris facts backfill** by Brain is pending.
- **Gemini catalogue flags stay OFF** (`VOICE_GEMINI_CATALOGUE`, `BRAIN_GEMINI_CATALOGUE`).
- **Supabase advisor warnings** (SECURITY DEFINER anon execute, `search_path`, one RLS table without a policy, leaked-password protection). Platform fixing on staging first.

---

## 6. Not built yet / planned (internal only)

- **Legal pack draft #653** (Terms, Privacy, DPA, call notice, beta terms). Parked until after launch.
- **Admin:** suspend business, business edit / members / owner reset, package catalogue and create package, billing period card, invoices (after #631).
- **Settings / onboarding** (GIGO P1/P2, coverage moves to Settings › Locations as "Areas you serve").
- **UI/UX sweep** across Desk and Admin.
- **Landing page** (#492 parked until its turn).
- **WhatsApp as the assistant doing work** (not just alerts).
- Live Dial to a person during a call: spec only ([`LIVE_TRANSFER.md`](product/LIVE_TRANSFER.md)).

Billing model is fixed: packages + on-demand only, beta charging off, no prepaid wallet, no waive overage. Public copy never mentions unbuilt features.

---

## 7. Alvin's to-do list

1. **Top up SautiKit** prod wallet (`e0e57aa5`).
2. **Top up TextSMS.**
3. **Paste the staging SautiKit key** (full scope, workspace `1f85601c`) to Ops for Railway staging Voice.
4. **Meta WhatsApp currency** (fixes 131042).
5. **Webhook signing after launch** (`SAUTIKIT_VALIDATE_WEBHOOKS` + secrets); Voice watches first calls.
6. **GOs** for section 4 (#645, Voice bundle #644/#646, #634, #632, #643, #628, #631, #647, #650, #640, #587 reviewer).

---

## 8. Rules

- **Model.** Use an economical model by default; a bigger one only when the task needs it.
- **Lanes.** Stay in your lane's owns paths ([`AGENTS.md`](../AGENTS.md), `.cursor/rules/*.mdc`). Schema, RPC, and auth changes go to Platform first.
- **Needs Alvin's explicit yes:** any prod write (SQL, env vars, Railway or Vercel settings), rotating secrets, releasing a DID, and merging to `main`. Merging to `main` deploys prod Voice and prod Desk. Ops-Billing and Brain need his GO in their own chats.
- **Secrets.** Never print, paste, or commit a secret. Docs list variable names only. Secrets go in through masked secret cards entered by Alvin.
- **Git identity.** Never set git config. Commit with `git -c user.name='Alvin Yegon' -c user.email='alvin@scalers.co.ke'`.
- **Test gates** (Node 22): `npm run test:voice`, `npm run test:brain`, `npm run test:mvp`, and `cd dashboard && npm run lint && npm run build`. Stage-PR changes: `npm run test:stage-pr`.
- **Docs-only PRs** must not change runtime code. Say "docs-only" in the PR body.
- **Before you finish:** update sections 2 to 5 of this file if your PR changed what's live, in flight, or broken.
