# Scalers status and handoff (start here)

**Last updated 9 Oct 2026, 00:30 EAT.** Facts below were checked against `main`, `gh`, and the live `/healthz` endpoints at that time. Items marked *per team notes* come from lane agents and Alvin, not from the repo. Update this file when you finish a piece of work, not only at the end of a week.

New agent or new human: read this whole page before you touch code. It takes five minutes.

---

## 1. Start here

Read in this order:

1. [`AGENTS.md`](../AGENTS.md). Lanes, what each lane owns, and the safety protocol.
2. Your lane contract in [`docs/agents/`](agents/): [`VOICE.md`](agents/VOICE.md), [`BRAIN.md`](agents/BRAIN.md), [`DESK_UX.md`](agents/DESK_UX.md), [`OPS_BILLING.md`](agents/OPS_BILLING.md), or [`PLATFORM.md`](agents/PLATFORM.md). Chat starters are in [`PROMPTS.md`](agents/PROMPTS.md).
3. [`docs/architecture/SYSTEM_ARCHITECTURE.md`](architecture/SYSTEM_ARCHITECTURE.md), then [`CURRENT_STATE.md`](architecture/CURRENT_STATE.md) and [`SOURCE_OF_TRUTH.md`](governance/SOURCE_OF_TRUTH.md).
4. This file, for where we are right now.

**One task, one lane, one PR.** Pick one lane. Stay inside its owns paths. Open one pull request into `main`. Schema, RPC, and auth changes go to Platform first. Don't run two agents that both edit `server.js` heavily.

Glossary: [`CONTEXT.md`](../CONTEXT.md). Docs index: [`docs/README.md`](README.md).

---

## 2. What Scalers is

Scalers is a Kenya-focused, multi-tenant **Business Assistant**. A business gets a phone number (DID). When the owner misses a call, the assistant answers, takes the caller's name and reason, and notifies the owner. The owner works in the **Desk** (Next.js).

| Live now | Not live yet |
| --- | --- |
| Voice Business Assistant on a SautiKit number (Soniox speech, Gemini reasoning) | Live Dial to a person during a call (spec only: [`LIVE_TRANSFER.md`](product/LIVE_TRANSFER.md)) |
| Owner notify by SMS, WhatsApp, or email, plus async escalation | Owner self-serve package checkout and M-Pesa (Super Admin assigns packages) |
| Desk: Overview, Inbox, Contacts, Usage, Settings, onboarding | Packages rebuild and landing page (see build order) |
| Super Admin at `/admin` | Billing enforcement (beta tenants are metered, not charged) |

Stack: Voice is `server.js` on Railway. Desk is `dashboard/` on Vercel. Data and auth are on Supabase. SQL is hand-applied from `docs/supabase/`, and there is no migrations folder.

---

## 3. Environments

| | Production | Staging |
| --- | --- | --- |
| Voice (Railway) | `https://scalers-project-production.up.railway.app`. Deploys `main` on every merge. Healthz at 00:30 EAT: `gitSha 87cd6f94` (main tip). | `https://scalers-staging-staging.up.railway.app`. Follows `cursor/staging-voice-468b`. Healthz at 00:30 EAT: `gitSha 9693b8ce`. |
| Live DID | **+254709221536**: Aris, the live customer. Esga +…542 is on the same workspace (*per team notes*). | **+254709221537**: Done and Dusted test tenant. |
| SautiKit workspace | `e0e57aa5` (*per team notes*). Prod SautiKit gets webhooks on `POST /`. | `1f85601c` (*per team notes*). |
| Supabase | ALCR `fjxcdccgyhnvnnlnovcl` | `scalers-staging` `sgcdncjxauhsbunobmob` |
| Desk (Vercel) | `scalers-project` (prod), builds `main` | `https://scalers-staging.vercel.app` (project `scalers-staging`), builds only the staging branch |

**Never release, reassign, or re-point +254709221536.** It is a paying customer's line.

Heads up: [`ENVIRONMENTS.md`](operations/ENVIRONMENTS.md) line 86 still calls +254709221536 the staging test DID. That is wrong. Open docs PR #607 fixes it.

### How staging is built

- `.github/workflows/stage-pull-request.yml` rebuilds `cursor/staging-voice-468b` as `main` plus every open pull request, merged newest first. A PR that conflicts is dropped from that run. Drafts are included. There is no live-call guard.
- **Hold.** The `hold-staging` label on any open PR (or the `STAGE_PR_HOLD` repo variable) stops the rebuild, so a pinned staging Voice stays put. See [`ENVIRONMENTS.md#hold-staging-voice`](operations/ENVIRONMENTS.md#hold-staging-voice).
- **Skip.** Draft #615 makes Stage-PR leave out PRs labelled `skip-staging`. That label is already on the parked PRs, but `main` doesn't read it until #615 merges.
- **Vercel ignore-build (#610, merged).** Prod Desk previews build only when `dashboard/` changes. `scalers-staging` builds only `cursor/staging-voice-468b`.
- Check the current staging contents with `git log --oneline origin/main..origin/cursor/staging-voice-468b`. Each `chore: stage PR #N` commit is one included PR.

On 8 Oct, Platform pushed a hand-curated "kitchen" tip because the hold was on. Once #612 merged on 9 Oct the hold label went with it, so Stage-PR is running unheld again and rebuilds staging on every PR event. At 00:16 EAT, staging was `main` `87cd6f94` plus #618, #615, #613, #611, #607, #603, #601, #560, #440, and #356. #602 (Admin Quality read APIs) was **not** in that build. Add `hold-staging` again if you need to pin staging for a test call.

---

## 4. Build order (set by Alvin)

1. **Admin** working end to end and polished.
2. **Settings and onboarding business info (GIGO).** Structured, owner-confirmed facts.
3. **UI/UX sweep** across Desk and Admin.
4. **Packages.**
5. **Landing page.**
6. **Voice and Brain** test and iteration on real calls.

Live-call Voice fixes still ship when a real call shows a bug. Older Desk, landing, and packages drafts wait for their turn in this order.

**Design system.** All UI follows Frontend 2.0. It is Apple/iOS-style: system font, one filled action, sheets, and list rows. Sources, in priority order: [`FRONTEND_2_0_CHARTER.md`](frontend/FRONTEND_2_0_CHARTER.md) (wins), [`design-system/MASTER.md`](frontend/design-system/MASTER.md) tokens, then `.cursor/skills/desk-motion/SKILL.md` for motion. Build from the kit in `dashboard/src/components/ui/`. The rule `.cursor/rules/scalers-design-ux.mdc` always applies. No hex colours in `.tsx`.

---

## 5. Done recently (merged to `main`, 5 to 9 Oct)

| Area | PRs | What it did |
| --- | --- | --- |
| GIGO P0 | #570, #572, #575, #595, #598 | Provenance envelope and completeness score. Seed data counts as unknown, and holds need a confirmed catalogue. Imports score 0% until the owner confirms them. Saving Settings counts as the owner confirming. |
| Caller file A+B | #585, #586 | Caller-file goal, name bind, and summary spine. Voice asks the name in a fixed language and handles an unfinished wait. |
| Speak-DNA | #605, #606, #608 (one squash `7e9d0747`) | HD call fixes for prices, offer consent, and Nakuru. Scorer 1.1. |
| Voice pipeline | #576, #579, #582, #594, #599, #600 | Spoken-reply pipeline, per-turn traces (`voice_turn_traces`) with a replay score gate, SpeakPacket, and speak slots. |
| Voice M0 and M0b | #612 (merged 9 Oct 00:04 EAT), #617 (00:07 EAT) | Coverage grounding, TTS word gaps, price, "what else", and barge-in fixes. M0b keeps Kiswahili hours, closes the handoff after an escalate, adds a filler on tool turns, spaces STT finals, keeps a barged booking, and gives the coverage next step. **These are live on prod Voice now** (healthz `87cd6f94`). |
| Wallet Reject gate | #616 (8 Oct 17:43 EAT) | A minimal re-cut of #588. When the wallet probe sees an empty SautiKit balance or HTTP 402, `POST /` and `/voice/incoming` return `<Reject/>`. It fails open on probe errors. **Live on prod.** |
| Stage-PR / CI | #604, #610 | Hold switch, and the Vercel build cut. |
| Desk / Admin kit | #559, #561 to #568, #573, #574, #577, #581, #589, #590, #592, #593, #596 | Super Admin Overview, Voices, Packages, and billing sheets. Settings polish, Inbox and Contacts on the kit, Appearance segmented control. Wallet ledger product surfaces removed. |

Full list: `gh pr list --state merged --limit 40`.

---

## 6. Open PRs that are on staging but not on `main`

Nothing below merges until Alvin tests staging and says yes.

| PR | Lane | What |
| --- | --- | --- |
| #613 | Platform | Admin falls back cleanly when ops tables are missing, so prod `/admin` stops showing "Setup is incomplete". |
| #602 + #603 | Platform + Desk | Super Admin **Quality** tab reads live voice traces. *Per Platform*, #602 conflicts with #613 on one `test:mvp` line in `package.json`. It was missing from the 00:16 EAT staging build. |
| #611 | Desk | Catalogue import preview shows the full list and service count. |
| #618 | Voice | Draft. Never drop a caller question asked while the agent is thinking (HD_054e). |
| #615 | Platform | Draft. Stage-PR `skip-staging` label filter. |
| #601, #607, #560 | Docs | Catalogue/GIGO as-built spec, staging/prod DID fix, business details and onboarding map. |
| #440, #356 | Docs | Older drafts that the unheld Stage-PR picked up. Not part of the agreed list. |

---

## 7. In flight and next

| Item | Lane | State |
| --- | --- | --- |
| #587 downtime clips | Voice | Stale. Needs a clean re-cut on `main`. The wallet half of #588 already shipped as #616. |
| #434 owner redirect, #499 Admin packages walk, #461 inbox row / home | Ops, Desk | Conflict with `main`. Rebase before the next round. |
| #614 Voice Phase 2 (structured, language-locked output, flagged off) | Voice | Next, now that #612 is on `main`. Staging only. |
| **Coverage moves to Settings > Locations as "Areas you serve"** | Desk | No PR yet. See below. |
| Brain native function calls (#536) | Brain + Voice | Needs a fresh PR rebased on `main`, paired with Voice #537. #535 and #543 are stale and likely to be closed. |
| GIGO P1 | Platform, Desk, Brain | Structured schemas and a Settings panel for all 10 domains, plus Brain tools that read them. |
| GIGO P2 | All | Deep BI loop: unmet demand, staleness re-verify, digest. |
| Prod Admin ops tables and ops alert recipients | Platform | Prod SQL. Gated on Alvin. |
| Separate `SAUTIKIT_WALLET_API_KEY` for the wallet probe | Platform, Voice | So the main Voice key can be full scope. |
| Stream-cost doc fixes | Ops | See section 8. |
| #529 prepaid hygiene, #492 landing, #299/#300/#109/#106/#113/#148 | Desk, Ops | Parked (old prototypes or later build-order items). |

**Coverage to Locations (Desk).** Move `CoverageAreaField` out of Policies, where today it shows for home services only, into a new "Areas you serve" section in Locations for every business type. Build it in the Frontend 2.0 kit. Data stays in `business_policies.coverage_areas` with the same `policies.coverage_areas` field path. There's no SQL, RPC, or compile change. The one required logic change: a Locations save only saves Locations fields today, so it would quietly drop a coverage edit. Add a `coverageAreas` save scope that Locations owns (`dashboard/src/lib/settingsSaveScope.ts`, `settings/actions.ts`, `fieldPathsFromSettingsSave.ts`), and merge only `coverage_areas` into the stored policies. Include before and after screenshots. *Per team notes*, Alvin approved this plan, and it builds locally because Cloud usage is used up.

GIGO roadmap (P0, P1, P2 detail): [`docs/product/BUSINESS_INTELLIGENCE_ROADMAP.md`](product/BUSINESS_INTELLIGENCE_ROADMAP.md) and [`docs/specs/catalog-voice-gigo-desk.md`](specs/catalog-voice-gigo-desk.md).

---

## 8. Known issues and ops risks

- **Prod SautiKit balance is nearly empty.** Prod healthz at 00:08 EAT on 9 Oct showed **KES 8.35**. Prod uses about KES 6.5 a day (*per team notes*), so it runs out around **Saturday 10 Oct**. With #616 live, prod then **rejects every Aris call**. Top up `e0e57aa5`. Staging showed KES 69.00.
- **Voice SautiKit key is read-only.** *Per team notes*: since 7 Oct, `SAUTIKIT_API_KEY` on both Railway Voice services is a `wallet.read`-only key. WhatsApp sends return 403 (`missing scope whatsapp.messages`), and call-recording fetches have returned 403 since 7 Oct 14:48 EAT. The fix is for Alvin to mint a full-scope key per workspace (calls, recordings, WhatsApp messages, numbers, wallet) and for Ops to set it. The old key values can't be recovered. Desk's Vercel SautiKit keys are separate.
- **SautiKit bills inbound streams at about KES 0.50/min** (*per Ops*). These docs still say inbound is KES 0 or free and need fixing: `docs/operations/ONE_WALLET_BILLING.md`, `docs/product/LIVE_TRANSFER.md` (around lines 214 to 225), `docs/governance/SOURCE_OF_TRUTH.md` (rate-card row), `docs/agents/OPS_BILLING.md`, `docs/platform/PLATFORM_SYSTEM_MAP.md`, `docs/operations/ENVIRONMENTS.md`, and the comment at the top of `src/billing/liveTransferLegs.js`.
- **Prod TextSMS is out of credit** (HTTP 402, *per Ops*).
- **Ops alert recipients are not set** on prod (`SCALERS_OPS_ALERT_PHONES`, `SCALERS_OPS_ALERT_EMAILS`, *per team notes*). Alerts reach nobody.
- **Downtime WAVs are not in git.** `src/speech/outageClips.js` expects packaged `downtime-<lang>.wav` files, and none are committed.
- **Staging `sautikit_did_pool` has RLS off** (Supabase advisor, critical, *per Ops*). Not fixed yet. It goes through Platform.
- **Aris has no package.** Aris has no `tenant_subscriptions` row and on-demand is off (*per Ops*). That's harmless while enforcement is off, but calls get rejected once the package gate enforces.
- **Gemini catalogue flags stay OFF.** Leave `VOICE_GEMINI_CATALOGUE` and `BRAIN_GEMINI_CATALOGUE` unset or off.

---

## 9. Rules

- **Model.** Use an economical Cursor model by default. Use a bigger one only when the task needs it (*Alvin's instruction*).
- **Lanes.** Stay in your lane's owns paths ([`AGENTS.md`](../AGENTS.md), `.cursor/rules/*.mdc`).
- **Needs Alvin's explicit yes:** any prod write (SQL, env vars, Railway or Vercel settings), rotating secrets, rewriting migrations, releasing a DID, and merging to `main`. Merging to `main` deploys prod Voice and prod Desk.
- **Secrets.** Never print, paste, or commit a secret. Docs list variable names only.
- **Test gates** from the repo root on Node 22: `npm run test:voice`, `npm run test:brain`, and `npm run test:mvp`, plus `cd dashboard && npm run lint && npm run build` for Desk. Stage-PR changes: `npm run test:stage-pr`. Use your lane contract's gate if it is stricter.
- **Docs-only PRs** must not change runtime code. Say "docs-only" in the PR body.
- **Before you finish:** update this file's sections 5 to 8 if your PR changed what's live, on staging, or in flight.
