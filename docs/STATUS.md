---
owner: platform
last_reviewed: 2026-10-14
---

# Scalers status and handoff (start here)

**Last updated Wed 14 Oct 2026, 20:30 EAT.** Checked against `main` (`7d870a75`), `gh pr list`, main's first-parent log, and prod/staging `/healthz` at 20:15 EAT. Items marked *per team notes* come from lane agents and Alvin, not from the repo. **Update this file in the same PR as any merge to `main`** (see [`CONTRIBUTING.md`](../CONTRIBUTING.md#status-rule)).

New agent or new human: read this whole page before you touch code.

**Read order:** [`AGENTS.md`](../AGENTS.md) → your lane contract in [`docs/reference/lanes/`](reference/lanes/) ([`VOICE.md`](reference/lanes/VOICE.md), [`BRAIN.md`](reference/lanes/BRAIN.md), [`DESK_UX.md`](reference/lanes/DESK_UX.md), [`OPS_BILLING.md`](reference/lanes/OPS_BILLING.md), [`PLATFORM.md`](reference/lanes/PLATFORM.md)) → [`SYSTEM_ARCHITECTURE.md`](explanation/architecture/SYSTEM_ARCHITECTURE.md), [`CURRENT_STATE.md`](explanation/architecture/CURRENT_STATE.md), [`SOURCE_OF_TRUTH.md`](explanation/governance/SOURCE_OF_TRUTH.md) → this file. Glossary: [`CONTEXT.md`](../CONTEXT.md). **One task, one lane, one PR.**

---

## 1. Where we are

Prod Voice (Railway) and prod Desk (Vercel `scalers-project`) both run **`main` @ `7d870a75`** (#634, merged 13 Oct 14:29 EAT; prod `/healthz` reports this SHA, started 13 Oct 15:35 EAT). Staging Voice runs a curated "kitchen" build **`1374b25d`** = `main` + #674 + #680 + #681 + #682 + #683 (*per team notes*; staging `/healthz` reports `1374b25d`). The `hold-staging` label is on **#674, #681, #682, #683**, so Stage-PR keeps that pin. Prod DID **+254709221536** is Aris, the live paying customer: **never release, reassign, or re-point it.** Staging DID is **+254709221537** (Done and Dusted test tenant).

**Product is callbacks only (#658, 11 Oct).** There is no live call transfer: the assistant takes a message and alerts a teammate on WhatsApp or email. `handoff_mode = live_transfer` is no longer offered in Desk. [`LIVE_TRANSFER.md`](archive/LIVE_TRANSFER.md) is archived as history.

Billing is **packages + on-demand only**; beta charging is off; no prepaid wallet; no waive overage.

| | Production | Staging |
| --- | --- | --- |
| Voice (Railway) | `scalers-project-production.up.railway.app`, deploys `main` on merge. `7d870a75` | `scalers-staging-staging.up.railway.app`, pinned `1374b25d` |
| Desk (Vercel) | `scalers-project`, builds `main`. `7d870a75` | `scalers-staging` (one debounced API deploy, #665) |
| DID | **+254709221536** Aris | **+254709221537** Done and Dusted |
| SautiKit workspace | `e0e57aa5` | `1f85601c` |
| Supabase | `fjxcdccgyhnvnnlnovcl` | `sgcdncjxauhsbunobmob` |

Design: all UI follows Frontend 2.0 ([`FRONTEND_2_0_CHARTER.md`](explanation/frontend/FRONTEND_2_0_CHARTER.md) wins, then [`design-system/MASTER.md`](reference/design-system/MASTER.md)). Staging mechanics: [`ENVIRONMENTS.md`](reference/operations/ENVIRONMENTS.md).

---

## 2. Shipped to prod (since 10 Oct)

Times EAT. SHAs are the squash commits on `main` (first-parent log). Older history: `git log --first-parent origin/main` and the previous STATUS in git (`bb68df70`).

| PR | SHA | Merged | What |
| --- | --- | --- | --- |
| #634 | `7d870a75` | 13 Oct 14:29 | Brain `BRAIN_CALL_FIXES_D199`: junk slots cleaned, cut-off turns write nothing, reschedule bypasses coverage gate, Swahili "saa nane". |
| #632 | `01d02ae9` | 13 Oct 14:25 | Brain `BRAIN_CONFIRMED_COVERAGE` Phase 0 + [handoff-record spec](rfcs/handoff-record.md). |
| #672 | `7cd263de` | 13 Oct 09:23 | Locations: "Do you go outside these areas?" (anywhere in Kenya). |
| #671 | `38ae42d8` | 13 Oct 07:11 | Honest insights, callbacks-only outcomes, durable reviews, Updates. |
| #670 | `3bc2f76d` | 12 Oct 20:53 | Appearance: one worded control everywhere. |
| #669 | `8a37abbc` | 12 Oct 20:20 | Contrast: attention/error text meets 4.5:1 in light mode. |
| #668 | `916444d2` | 12 Oct 19:54 | Calls: SSR guard test for `document` on /calls. |
| #667 | `5a9ced74` | 12 Oct 18:51 | Locations: areas you serve, with delivery fees. |
| #663 | `e7f30281` | 12 Oct 14:30 | Payments and Policies: typed payments v2, policy rules. |
| #666 | `465a5773` | 12 Oct 14:25 | Catalogue: a Save never undoes a confirmed price. |
| #661 | `47fad32a` | 12 Oct 12:35 | Design leftovers: type tokens, kit Button, sentence-case labels. |
| #664 | `330a22f4` | 12 Oct 12:33 | Speed: London region, router cache, local session check, cached tenant row, skeletons. |
| #662 | `987589b1` | 12 Oct 12:26 | Overview call insights from `call_facts`. |
| #660 | `70c03cab` | 12 Oct 12:21 | UI polish: kit text fields, phone account Sheet, mobile and a11y sweep. |
| #665 | `db5b7f17` | 11 Oct 23:56 | Vercel: only `main` auto-deploys; one debounced API deploy for staging. |
| #659 | `d6c56df6` | 11 Oct 20:07 | Structured data foundation. |
| #658 | `871fea0a` | 11 Oct 19:45 | **Callbacks only**: live transfer promises replaced by a Callbacks capability. |
| #657 | `3d16cc8b` | 11 Oct 16:23 | Unified capability gates. |
| #656 | `e51b2d6e` | 11 Oct 15:03 | Onboarding rebuild. |
| #655 | `e4b30a88` | 11 Oct 12:20 | Team invites with roles (behind `TEAM_INVITES`). |
| #654 | `d9823cd6` | 11 Oct 12:15 | QA fixes: onboarding, validation, wrong-number SMS, import, checklist, marketing. |
| #652 | `bb68df70` | 10 Oct 10:50 | Docs: previous STATUS refresh. |
| #641 and earlier | | ≤ 10 Oct | Admin A0–A2 + Activity log (#636, #637, #641), Quality tab (#603), line-unavailable (#651), grant-minutes hotfix (#648), fact-confirm (#627), traces purge (#630, #635), ops alerts (#626), Voice M0/M0b (#612, #617), wallet-empty reject (#616). |

---

## 3. On staging now (not on prod)

Curated kitchen `1374b25d` (*per team notes*), all flags default off on prod:

| PR | Lane | What |
| --- | --- | --- |
| #674 | Voice | Fold owed booking confirm into the next reply (`VOICE_OWED_CONFIRM_FOLD`). |
| #680 | Brain | BA v2 Phase 1 behind `BRAIN_V2` (off). |
| #681 | Voice | BA v2 shadow hook on `/ws/media` (`BRAIN_V2_SHADOW`). |
| #682 | Voice | Joint ack rule (`VOICE_ACK_RULE`, off). |
| #683 | Voice | Coverage single source (`VOICE_COVERAGE_SINGLE_SOURCE`, off). |

Caller files memory v2 SQL (#673) is applied on **staging only**.

---

## 4. Open PRs waiting on Alvin's GO

Source: `gh pr list --state open` at 20:15 EAT, 14 Oct. All drafts unless noted.

| PR | Lane | What |
| --- | --- | --- |
| #649 (ready) | Ops-Billing | Admin billing cleanup: readable errors, one assign path, Change package confirm. |
| #684 | Brain/Platform | Fact hash contract: drop pricing envelope; `confirmPriceAction` re-stamps `.price`. |
| #673, #678 | Platform / Brain | Caller files memory v2 (schema + retention); trust P1 + returning caller (stacked on #673). |
| #675, #676, #677 | Voice | Silent-caller prompt + stall watchdog; repair-who + carrier-drop callback; language hysteresis. |
| #679, #680 | Brain | BA v2 Phase 0 eval harness; Phase 1 (both `skip-staging`). |
| #645, #644, #646, #638 | Voice | Prod dead-air fix; one owner message per call; goodbye ends call; HD_ceba fixes. |
| #643, #631, #628, #625, #633, #621, #618 | Voice | Wallet low alert; beta never rejects at cap; junk names; wait-barge; spoken facts; score honesty; dropped question. |
| #647, #650 | Ops-Billing | SMS reserve→send→settle; package change rules (stacked on #631). |
| #640, #602, #615 | Platform | Ops alerts on Vercel cron; Quality read APIs; Stage-PR skip-staging filter. |
| #622, #629 | Voice | Scorer fixes. |
| #611 | Desk | Catalogue import preview. |
| #587, #597, #614, #584, #583, #537 | Voice | Parked (`skip-staging`). #597 on hold. |
| #653, #492, #560, #440, #434, #356 | Various | Legal pack, landing, docs, ops, tester lane: parked. |
| #639, #642 | — | Superseded (#651; clips on SautiKit). Close. |

---

## 5. Known broken / open issues

*Carried from 10 Oct; not re-verified on 14 Oct unless noted. Lane owners: confirm or delete your rows.*

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
- **Settings / onboarding**: shipped (#656, #667, #672). GIGO P1/P2 follow-ups remain.
- **UI/UX sweep** across Desk and Admin.
- **Landing page** (#492 parked until its turn).
- **WhatsApp as the assistant doing work** (not just alerts).
- Live call transfer: **not built** (callbacks only since #658; reviving it needs a new ADR and Alvin's yes). History: [`archive/LIVE_TRANSFER.md`](archive/LIVE_TRANSFER.md).

Billing model is fixed: packages + on-demand only, beta charging off, no prepaid wallet, no waive overage. Public copy never mentions unbuilt features.

---

## 7. Alvin's to-do list

1. **Top up SautiKit** prod wallet (`e0e57aa5`).
2. **Top up TextSMS.**
3. **Paste the staging SautiKit key** (full scope, workspace `1f85601c`) to Ops for Railway staging Voice.
4. **Meta WhatsApp currency** (fixes 131042).
5. **Webhook signing after launch** (`SAUTIKIT_VALIDATE_WEBHOOKS` + secrets); Voice watches first calls.
6. **GOs** for section 4.

---

## 8. Rules

- **Model.** Use an economical model by default; a bigger one only when the task needs it.
- **Lanes.** Stay in your lane's owns paths ([`AGENTS.md`](../AGENTS.md), `.cursor/rules/*.mdc`). Schema, RPC, and auth changes go to Platform first.
- **Needs Alvin's explicit yes:** any prod write (SQL, env vars, Railway or Vercel settings), rotating secrets, releasing a DID, and merging to `main`. Merging to `main` deploys prod Voice and prod Desk. Ops-Billing and Brain need his GO in their own chats.
- **Secrets.** Never print, paste, or commit a secret. Docs list variable names only. Secrets go in through masked secret cards entered by Alvin.
- **Git identity.** Never set git config. Commit with `git -c user.name='Alvin Yegon' -c user.email='alvin@scalers.co.ke'`.
- **Test gates** (Node 22): `npm run test:voice`, `npm run test:brain`, `npm run test:mvp`, and `cd dashboard && npm run lint && npm run build`. Stage-PR changes: `npm run test:stage-pr`.
- **Docs-only PRs** must not change runtime code. Say "docs-only" in the PR body.
- **Before you finish:** update sections 1 to 5 of this file in the same PR when it changes what's live, in flight, or broken. Every merge to `main` updates section 2.
