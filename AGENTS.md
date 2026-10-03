# Scalers agent lanes

Specialized Cursor agents / chats. One task → one lane → one PR.

| Lane | Scope | Contract |
| --- | --- | --- |
| **Voice** | Telephony media, STT/TTS, turn-taking, call latency | [`docs/agents/VOICE.md`](docs/agents/VOICE.md) · speed plan: [`VOICE_SPEED_CONSISTENCY.md`](docs/agents/VOICE_SPEED_CONSISTENCY.md) · live findings: [`LIVE_CALL_FINDINGS.md`](docs/agents/LIVE_CALL_FINDINGS.md) · pronunciation: [`PRONUNCIATION.md`](docs/agents/PRONUNCIATION.md) · ChapterOne setup: [`CHAPTERONE_SETUP_REVIEW.md`](docs/agents/CHAPTERONE_SETUP_REVIEW.md) |
| **Brain** | Prompts, conversation logic, tools, knowledge compile | [`docs/agents/BRAIN.md`](docs/agents/BRAIN.md) · caller CX gaps: [`docs/agents/CALLER_EXPERIENCE_EXCELLENCE.md`](docs/agents/CALLER_EXPERIENCE_EXCELLENCE.md) |
| **Desk UI/UX** | Owner desk + marketing UI | [`docs/agents/DESK_UX.md`](docs/agents/DESK_UX.md) |
| **Ops & Billing** | Wallet, DID pool, Super Admin | [`docs/agents/OPS_BILLING.md`](docs/agents/OPS_BILLING.md) |
| **Platform** | DB surface, auth/RLS, deploy, shared contracts | [`docs/agents/PLATFORM.md`](docs/agents/PLATFORM.md) |
| **Platform tester** | Internal critic / eval vs WhatsApp, Telegram, Instagram | [`docs/agents/PLATFORM_TESTER.md`](docs/agents/PLATFORM_TESTER.md) · scorecard: [`PLATFORM_TESTER_SCORECARD.md`](docs/agents/PLATFORM_TESTER_SCORECARD.md) · Grok Bot: [`GROK_BOT.md`](docs/agents/GROK_BOT.md) |

**Copy-paste chat starters:** [`docs/agents/PROMPTS.md`](docs/agents/PROMPTS.md)

## Rules of engagement

1. Stay inside your lane’s **owns** paths. Ask Platform before changing `src/db.js` API or Supabase SQL.
2. Do not run parallel agents that both edit `server.js` heavily.
3. Paste the lane prompt from `docs/agents/PROMPTS.md` (or `@docs/agents/…`) at the start of each new chat.
4. Prefer fresh chats per ticket; do not keep one eternal mega-thread.
5. Schema / RPC / auth contract changes: **Platform first**, then feature lanes.
6. `.github/workflows/stage-pull-request.yml` rebuilds `cursor/staging-voice-468b` as `main` plus every open pull request (once that workflow is on `main`). Open the pull request into `main` so the rebuild starts immediately. A pull request into another feature branch joins on the next rebuild. Closing a pull request removes it from staging. Promote by squash-merging the tested feature pull request into `main`.

---

## Documentation map (governance baseline)

| Doc | Purpose |
| --- | --- |
| [`docs/architecture/CURRENT_STATE.md`](docs/architecture/CURRENT_STATE.md) | What Scalers **is** today (Aug 2026 baseline) |
| [`docs/platform/PLATFORM_SYSTEM_MAP.md`](docs/platform/PLATFORM_SYSTEM_MAP.md) | Platform as-is map: voice, notify, WhatsApp, wallet, Brain SoR, ladder jobs |
| [`docs/governance/SOURCE_OF_TRUTH.md`](docs/governance/SOURCE_OF_TRUTH.md) | Subsystem ownership |
| [`docs/governance/DEVELOPMENT_WORKFLOW.md`](docs/governance/DEVELOPMENT_WORKFLOW.md) | Branching, lifecycle, PR checklist |
| [`docs/governance/SCALERS_ENGINEERING_PRINCIPLES.md`](docs/governance/SCALERS_ENGINEERING_PRINCIPLES.md) | Permanent engineering rules |
| [`docs/agents/AGENT_ARCHITECTURE.md`](docs/agents/AGENT_ARCHITECTURE.md) | AI agent stack on live calls |
| [`docs/LIVE_TRANSFER.md`](docs/LIVE_TRANSFER.md) | Live human Dial (spec; not shipped) |
| [`docs/ESCALATION.md`](docs/ESCALATION.md) | Async human notify (shipped) |
| [`docs/database/DATABASE_GOVERNANCE.md`](docs/database/DATABASE_GOVERNANCE.md) | Manual SQL model |
| [`docs/frontend/FRONTEND_RECONNAISSANCE.md`](docs/frontend/FRONTEND_RECONNAISSANCE.md) | Desk Frontend 2.0 recon (no UI until constitution) |
| [`docs/agents/PLATFORM_TESTER.md`](docs/agents/PLATFORM_TESTER.md) | Internal critic / eval vs WhatsApp, Telegram, Instagram |
| [`docs/agents/GROK_BOT.md`](docs/agents/GROK_BOT.md) | Grok Bot paste pack (chosen tester runtime) |

---

## AI agent safety protocol (all lanes)

Before changing code:

1. Read this file and the **lane contract** for your task (`docs/agents/{LANE}.md`).
2. Read [`docs/architecture/CURRENT_STATE.md`](docs/architecture/CURRENT_STATE.md) and [`docs/governance/SOURCE_OF_TRUTH.md`](docs/governance/SOURCE_OF_TRUTH.md).
3. Identify the subsystem affected and its **source of truth**.
4. Inspect existing tests for that subsystem.
5. Check `git status` and confirm your branch.
6. Identify dependencies and **production impact**.
7. Formulate a plan before implementation (required for non-trivial changes).

Before destructive operations, agents **must not** without explicit human approval:

- Delete major directories or production integrations
- Delete or rewrite database migrations that may be applied in production
- Rotate secrets or modify production infrastructure
- Remove apparently unused code without verification (classify as LEGACY/UNKNOWN first)
- Replace core architecture (`server.js` split, auth model, wallet logic)
- Rewrite large portions of the codebase in a cleanup PR

Before committing:

1. Run the lane test gate (see lane contract).
2. Inspect `git diff` — no secrets, no accidental files, no unrelated changes.
3. Update relevant documentation if contracts or behavior changed.
4. Distinguish **documentation-only** PRs from **behavioral** PRs.

Distinguish documentation work from architectural rewrites. Governance PRs must not change runtime behavior.

## Agent skills

Composable Matt Pocock skills in `.cursor/skills/` (grill-with-docs, wayfinder, tdd, code-review) plus **desk-motion**, **reticle**, **chisle**, **ui-skills**, and **no-ai-slop**. Vercel/Next packs from `npx skills` live in `.agents/skills/` and are linked from `.cursor/skills/`. They do **not** replace lanes. Index: [`.cursor/skills/README.md`](.cursor/skills/README.md).

### Issue tracker

GitHub for humans; Cloud Agents write specs under `docs/specs/` (read-only `gh`). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context glossary at `CONTEXT.md`. ADRs stay in `docs/adr/`. Lane contracts stay in `docs/agents/`. See `docs/agents/domain.md`.

## Cursor Cloud specific instructions

Two package roots. Install with `npm ci` at the repo root, then `npm ci --prefix dashboard`. Node 22. Do not use a workspace install.

Voice engine listens on port 3000 (`npm start`). It exits unless `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set. Placeholders are enough for `GET /healthz` and `POST /voice/incoming` (SautiKit Stream XML). A missing database still returns the stream document. Live speech needs `SONIOX_API_KEY` and `GEMINI_API_KEY`. `npm run smoke:db` needs a real Supabase project. `npm run test:voice`, `npm run test:mvp`, and `npm run eval:brain` do not.

Owner desk listens on port 3001:

```bash
cd dashboard && DASHBOARD_OPEN=true npm run dev -- --hostname 0.0.0.0 --port 3001
```

Open `http://localhost:3001`. Next.js 16 blocks dev assets when the host is `127.0.0.1`, so client controls (theme, hydration) only attach on `localhost`. `DASHBOARD_OPEN=true` unlocks `/dev/home`, `/dev/desk-shell`, and `/dev/inbox` without a login. `/dev/home` logs a pre-existing `new Date()` prerender warning and still renders. Desk production check is `npm run build` in `dashboard/`.

