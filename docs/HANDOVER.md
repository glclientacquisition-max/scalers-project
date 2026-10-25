---
owner: chief
last_reviewed: 2026-10-25
---

# Scalers handover (start here if you are a new account, owner or agent)

Written 25 Oct 2026, 14:45 EAT, at Alvin's request: "documentation of everything so that even when we switch accounts the other can pick up well".
Facts are as of this date. Current state always wins from `docs/STATUS.md` in the repo; this file is the map for picking the work back up.
**No secret values are in this file.** Only env var names and where they live.

## 1. What Scalers is

Scalers ([scalers.co.ke](https://scalers.co.ke)) is a Kenya-focused multi-tenant Business Assistant. A business gets a phone number. When a call is missed, busy or after hours, the assistant answers, takes the caller's name and reason, and notifies the owner. The owner works in the Desk: setup, the call inbox, contacts, approve-first SMS and WhatsApp, and package usage.

Beachhead: home cleaning (tenant **Done and Dusted, "DnD"**) first; retail (ChapterOne) second. MVP bar: at least 90% fully resolved beachhead calls; escalate to humans only when the playbook says so.

## 2. Architecture

| Part | What | Where it runs |
| --- | --- | --- |
| Voice | `server.js` at repo root: HTTP server, media websocket, turn loop. Telephony via **SautiKit** (Twilio is dead). STT/TTS Soniox; reasoning Gemini (light models, e.g. flash-lite) | Railway (prod service + `staging` env) |
| Brain | Conversation logic in `src/conversation/` (modelLead, areaCoverage, owed answers, guard, playbooks). Runs inside the Voice process | Railway, same as Voice |
| Desk | Next.js App Router app in `dashboard/` (owner desk + marketing landing) | Vercel: prod `app.scalers.co.ke` / `scalers.co.ke`, staging `scalers-staging.vercel.app` |
| Admin | Super Admin inside the Desk (`/admin/...`; Admin v2 behind `ADMIN_V2`, step-up two-step sign-in #922) | Vercel, with Desk |
| Data | Supabase: tenants, calls, transcripts, `voice_turn_traces`, appointments, billing, auth | prod `fjxcdccgyhnvnnlnovcl`, staging `sgcdncjxauhsbunobmob` |

Repo docs for depth: `docs/explanation/architecture/SYSTEM_ARCHITECTURE.md`, `docs/reference/platform/PLATFORM_SYSTEM_MAP.md`, `docs/reference/lanes/*.md`, `CONTEXT.md` (glossary). Two apps, one repo, deployed separately, no npm workspace. Node 22.

## 3. Environments, branches, numbers

| | Staging | Prod |
| --- | --- | --- |
| Branch | `staging/v2-c0-opening-2026-10-21` | `main` |
| Running SHA (25 Oct) | `924878f6` deployed 14:21 EAT (branch tip `2451bc31`, STATUS-only commit) | `0cbedc04` (moved 14:04 EAT, includes #951, #922) |
| DID | **+254709221537** = DnD test line | **+254709221536** = Aris (live customer) |
| Supabase | `sgcdncjxauhsbunobmob` | `fjxcdccgyhnvnnlnovcl` |

**Never release either DID. Never touch Aris's number mapping.**

**Branch fork.** Staging has forked from main: it carries the v2 Brain/Voice work (#926 v1 draft + KB verify, #936 grace queue, #942 owed answers, #946 area notes, #948 alerts, #949 AI-first place fix, Admin v2 #941). Main gets Desk-only ports (e.g. #951 = port of #935) and approved fixes. Anything promoted from staging to main must bring its dependencies. Known one: **#948 needs the Dockerfile line `COPY dashboard/src/lib/alertTypeDefaults.json ./dashboard/src/lib/` (or #955) or prod will crash at boot.** Note: `docs/reference/operations/ENVIRONMENTS.md` and AGENTS.md rule 6 still describe the old `cursor/staging-voice-468b` Stage-PR rebuild; that is stale for current work.

**How to restage (only after Alvin's GO):**
1. Merge the approved PR into the staging branch; run `npm run test:brain` / `test:voice` (3 known failures before 25 Oct, 1 known timeout after).
2. `railway up` from the staging worktree, linked to the staging environment; set `GIT_SHA` to the commit.
3. Check `/healthz` ok and its `gitSha` matches; TTS/STT/Gemini/telephony clear, `billingExhausted` false; DnD catalogue version (v4 on 25 Oct); staging phone balance.
4. If the health check fails, Railway keeps the old deploy running. Read the boot logs (25 Oct cause: missing file in Docker image).
5. Add a STATUS line (docs-only commit). Nobody dials; Alvin dials and an agent scores.

## 4. Accounts and services (names only)

- **GitHub:** `glclientacquisition-max/scalers-project` (one shared account; merges by lanes all show as that account, so record the approver in commit/PR text). `gh` CLI authenticated on the box.
- **Railway:** Voice prod service and staging environment. Railway CLI on box (logs sometimes say "No service linked"; relink before reading logs).
- **Vercel:** Desk prod and `scalers-staging` projects. Vercel MCP connected to the bot.
- **Supabase:** prod and staging projects above; Supabase MCP connected. SQL is manual (`docs/explanation/database/DATABASE_GOVERNANCE.md`). Staging is free tier (cannot edit auth templates without custom SMTP).
- **SautiKit:** telephony, DIDs, phone balances (staging and prod balances are prepaid and run low; Alvin tops up).
- **Soniox** (STT/TTS), **Google Gemini** (model), email via the platform mail provider, Web Push (VAPID) for the installable Desk app.
- **Env var names** (values live in Railway / Vercel project settings, never in the repo): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GEMINI_API_KEY`, `SONIOX_API_KEY`, `SAUTIKIT_*`, `VOICE_INTERNAL_SECRET`, `VOICE_PUBLIC_BASE_URL`, `PUBLIC_BASE_URL`, `GIT_SHA`, VAPID keys for push, admin step-up key. Full generated list: `docs/reference/env.md`.
- **Behaviour flags seen 25 Oct:** `BRAIN_MODEL_LEAD` on (staging), `BRAIN_V1_DRAFT` on (DnD via `BRAIN_V1_DRAFT_TENANTS`), `SPLIT` and `GRACE_QUEUE` unset = on in current staging code, `BRAIN_CALL_FIXES_D199=on` and `VOICE_ENDED_CALL_GUARD=on` (prod), `ADMIN_V2`. Never set `VOICE_GEMINI_CATALOGUE` or `BRAIN_GEMINI_CATALOGUE`.

## 5. Team lanes and seats

All seats report to **Chief of Scalers**, who reports to Alvin. One task, one lane, one PR. Lanes write thick problem-to-done briefs for Cursor cloud agents; Cursor writes code.

| Seat | Owns | Skills (hard-load) |
| --- | --- | --- |
| Chief of Scalers | Product/ops chief, coordinates lanes, carries GOs to the asking lane verbatim, tracks PRs | brief-before-act, scalers-billing-as-is, scalers-call-score, scalers-landing-craft, scalers-prompt-craft |
| Voice Engineer | Telephony, SautiKit + Soniox + Gemini runtime, barge-in, latency. Does not score calls or write copy | brief-before-act, scalers-agents-md-lane-sync, scalers-barge-in-review, scalers-ship-brief, scalers-voice-oss-watch |
| Brain Engineer | Playbooks, turn gates (state/speech/tool), coverage, tools. Hands Prompt criteria, not copy | brief-before-act, scalers-agents-md-lane-sync, scalers-brain-turn-gates, scalers-playbook-research, scalers-prompt-craft |
| Desk Engineer | Owner web / Admin UI, Kenya-mobile density (360/390) | brief-before-act, scalers-desk-cursor-brief, scalers-design-authority, scalers-frontend-design, scalers-kenya-mobile-desk, scalers-ui-review, scalers-responsive-universal, scalers-a11y-audit, scalers-chrome-density, scalers-anti-slop-notes, scalers-landing-craft, scalers-agents-md-lane-sync, shadcn-ui, antislop(+ui, copywriting), avoid-ai-writing, frontend-design, hallmark, awesome-design-md, ui-ux-pro-max, vercel-react-best-practices, web-design-guidelines |
| Ops-Billing Engineer | Money path: packages, minutes, on-demand, Admin Billing home | brief-before-act, scalers-agents-md-lane-sync, scalers-billing-as-is, scalers-metering-event-shape, scalers-package-minute-idempotency |
| Prompt | Owner-facing words the caller hears, thick briefs, no code/deploy | brief-before-act, scalers-prompt-craft, scalers-brain-turn-gates, scalers-design-authority, scalers-anti-slop-notes, scalers-landing-craft, avoid-ai-writing |

Repo lane contracts: `docs/reference/lanes/{VOICE,BRAIN,DESK_UX,OPS_BILLING,PLATFORM}.md`, chat starters in `PROMPTS.md`. Platform is a repo lane without its own seat (Ops-Billing carries a thin watch).

Box skill files: `/home/box/agent-data/workflows/scalers-*` (30 skills; `scalers-wallet-idempotency` is deprecated). Seat profiles: `/home/box/agent-data/agents/<id>/profile.json`.

## 6. Standing rules and locks

1. **Billing = packages + on-demand only.** No prepaid wallet product, no KES credit as the lever. Admin has one Billing home (package, minutes, on-demand, soft/hard, overage).
2. **Alvin-only GOs** for merge, restage, any SQL, any prod change (env, Railway/Vercel settings), releasing a DID, rotating secrets. The GO goes to the lane that asked, in its own question's words. Record approver + time in commit/STATUS.
3. **Agents never dial.** Alvin dials; agents read recordings, transcripts, `voice_turn_traces`, logs and score.
4. **Light models** by default (Cursor and runtime); heavier only when a run stalls.
5. **Owner copy:** no vendor names (no Resend, Soniox, Gemini, SautiKit, API keys or env controls on product screens), no AI slop; run no-ai-slop on new strings.
6. **Root cause first:** trace the symptom to the cause with evidence before proposing a fix; prefer structural fixes over patches.
7. **Phone-sized diagrams** and plain language in reports to Alvin.
8. **Desk is light theme by default** (dark is optional). Marketing tokens: light canvas, CTA `#005CCC`, mark `#0096FF`, DM Sans + Sora.
9. **Transparent icon** for the app/PWA mark.
10. **Per-niche policies** (cancellation, deposit, payment) live per tenant/niche, not hard-coded.
11. **Area tree:** coverage reads only the Desk area tree (tenant picks + surcharges + notes). Unknown place: "which area is that near?", never a guess. Since #949 the place check is AI-first: a place counts only if the model understood one and the caller's own words confirm it; without the model, only exact/landmark names inside a place slot ("in", "kwa", "-ni") with a stoplist.
12. No force-push. Update `docs/STATUS.md` in the same PR as any merge to `main`.

## 7. Open PRs (25 Oct, 114 open; key ones)

| PR | Base | State | What |
| --- | --- | --- | --- |
| #939 | staging | draft, awaiting GO | Voice grace-queue hardening (tenant gate, merge not double reply). Needs two staging settings on at go-live. **Relevant to the double-response issue** |
| #953 | staging | draft | Brain: bare place names that exactly match the tenant's own picks |
| #955 | staging | draft, awaiting GO | Shared JSON in `src/shared`, server never imports `dashboard/` (permanent fix for #948 crash) |
| #952 | main | draft, HOLD | Prod release of Desk service-areas picker (port of #930 + #944) |
| #894 | staging | draft | Brain caller profile v1 (flag off) |
| #848–#856 | main / stacked | draft | Brain v2 C0–C7 stack (one branch of record, commit safety, owns call, fact store, hybrid tool calling) |
| #859 | main | draft | Voice query batching (flag off) |
| #934 | main | draft | Keep 24-hour visit times |
| #886, #885 | main | draft | Number hold clip + SQL (never applied) |
| #872–#876 | main | draft | Voice/Brain flags-off work (transcript resume, recording notice, silence re-invite, admin docs) |
| #887–#891 | desk branches | draft | Admin v2 slices (nav, numbers, billing home) |
| #761, #751 | main | open (not draft) | Brain trusted hours; honest owner text |
| #492 | main | draft | Private-beta marketing landing |
| #529 | main | **closed** | Prepaid dialect hygiene (closed; listed as open in the brief) |
| #935 | — | superseded by #951 (merged to prod on Alvin's "GO prod #951" in Desk chat) |

Full list: `gh pr list -R glclientacquisition-max/scalers-project --state open --limit 200`.

## 8. Open issues

1. **Double response** (Alvin, 25 Oct test after #949): suspected two replies per turn. Not yet scored. Start with the latest DnD call's `voice_turn_traces`; #939 ("merge-not-double-reply") is the candidate fix.
2. **Reconnect dead air** after a media stream reconnect (#875 draft has transcript resume).
3. **"Hello" treated as backchannel**, so a bare hello after the greeting gets no reply (#836 tests).
4. **Swahili not-covered reply comes out in English**; also language lock stuck on English from the greeting (13:15 call).
5. **Desk payment-policy save drops the `sw` line.**
6. **Kiswahili copy needs a native review** (hours wording is still a placeholder; `[PROMPT-PLACEHOLDER]` copy remains).
7. **#948 Dockerfile line must ship with any main promotion** (or #955).
8. #949 gaps: single-word rule still counts places outside tenant picks ("Nataka usafi Kericho kesho"); stoplist must grow; sim does not exercise the model path.
9. TTS gain clipping (+0.47 dBFS); "Can I cancel?" adds an unasked line.
10. Prod pay for Aris: pay RPC 404 at a doubled `/rest/v1/rest/v1/` path (STATUS, 23 Oct).

## 9. DnD sample data and the test script

Tenant `df4ad9d8-28ff-4810-b1e6-94f5495472b0` on staging; catalogue v4. Files: `/workspace/scalers/ops/dnd-sample/` (sample.json, gen-dnd-sample.ts, caller-test-script.md, backups, rebuild SQL), snapshot + restore `/workspace/scalers/ops/dnd-staging-snapshot-2026-10-25.*`, `dnd-staging-restore-2026-10-25.sh`, coverage seed SQL (+ `_down`).

Dial **+254709221537** and ask, in order:
1. "How much is a deep clean?" → KSh 6,000–12,000 by house size.
2. "Sofa cleaning for a 5-seater?" → KSh 700/seat = KSh 3,500.
3. "Do you come to Kilimani?" → Yes, no extra fee.
4. "Do you cover Kibera?" → No.
5. "I'm in Syokimau." / "I'm in Thika." → +KES 500 / +KES 1,500, Thika from 2 bedrooms up.
6. "Do you come to Mlolongo?" → No.
7. "I'm near Kamakis." → "Which area is that near?"
8. "Can I cancel?" → Up to 24 hours before; after that the deposit is kept.
9. "How do I pay?" → M-Pesa or cash; 30% deposit on deep / move-out / post-construction.
10. "Book a standard 2-bedroom clean, Saturday 10am, in Westlands." → KSh 3,500, ~3–4 h, confirms area/price/hours, then name + landmark; booking request logged.
Plus the Kiswahili regression: "Deep cleaning nipo saa ngapi?" (the 13:29 "rogue" call, HD_7a9915837b00).

Call evidence: `/workspace/scalers/voice-qa/` (25 Oct: rogue-call report, root-cause architecture, dial scores), recordings in `/workspace/*.mp3`.

## 10. How to resume on a new account (checklist)

1. Get access: GitHub repo, Railway, Vercel, Supabase (both projects), SautiKit; confirm with Alvin which account owns each. Install `gh`, Railway and Vercel CLIs, Node 22.
2. Clone the repo; read `AGENTS.md` → `docs/STATUS.md` → your lane contract → this file.
3. Re-create the seats (Chief, Voice, Brain, Desk, Ops-Billing, Prompt) using the profile descriptions in section 5 and load the `scalers-*` skills (copy `/home/box/agent-data/workflows/scalers-*` if the box is not carried over).
4. Re-provision secrets from Railway/Vercel into the new tooling; never paste values in chat.
5. Verify state: `/healthz` on staging and prod, SHAs vs section 3, phone balances, DnD catalogue version.
6. Re-read open PRs (section 7) and open issues (section 8); the next action on 25 Oct is scoring Alvin's post-#949 call for the double response, then GO decisions on #939, #953, #955.
7. Follow the rules in section 6, especially Alvin-only GOs and agents never dial.
